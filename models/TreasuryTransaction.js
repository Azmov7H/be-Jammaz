import mongoose from 'mongoose';
import './UnifiedCollection.js'; // surrogate for refPath population

const TreasuryTransactionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['INCOME', 'EXPENSE'],
        required: true
    },
    receiptNumber: {
        type: String,
        unique: true, // T-DB-03 (pre-flight dupe check + dedupe script required before rollout)
        sparse: true, // T-PERF-03 fix: expense/manual rows carry no receiptNumber —
                      // non-sparse unique made the SECOND such insert a 11000 conflict
        index: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    description: {
        type: String,
        required: true
    },
    referenceType: {
        type: String,
        enum: ['Invoice', 'PurchaseOrder', 'Manual', 'SalesReturn', 'Debt', 'UnifiedCollection',
            // FIN-TAHWEESH-01 (T-09): internal set-aside moves. Paired legs
            // (source EXPENSE + tahweesh INCOME) sharing meta.transferId.
            // Aggregations treat these as relocation, never revenue/expense.
            'TahweeshTransfer',
            // FIN-REV-01 (T-REV): compensating reversal of another ledger row.
            // The original row is KEPT (marked isReversed); the reversal is a
            // visible counter-entry that flips the type and restores states.
            'Reversal'],
        default: 'Manual'
    },
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'referenceType'
    },
    partnerId: {
        type: mongoose.Schema.Types.ObjectId,
        required: false, // Optional for manual generic entries
        index: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    method: {
        type: String,
        enum: ['cash', 'bank', 'wallet', 'check', 'adjustment', 'instapay',
            // FIN-TAHWEESH-01 (T-09): the set-aside account as a funding
            // channel. getSummary maps it to breakdown.tahweesh (never cash).
            'tahweesh'],
        default: 'cash'
    },
    // Transfer-source / reference number (e.g. InstaPay transaction ID).
    // Optional at the DB layer; required only for NEW instapay/wallet transactions via Zod (Sprint 3, FIN-VAL-002).
    sourceNumber: {
        type: String,
        maxlength: 200,
        index: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // Free-form audit context (e.g. { isCreditRefund: true, debtId }).
    // Mixed (not Map) so .lean() reads stay plain objects. Several
    // services already pass meta — without this field strict mode
    // silently dropped it.
    meta: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    // FIN-REV-01 (T-REV): compensating-reversal linkage. `reversalOf` is set
    // ONLY on the Reversal row (no default — sparse unique indexes treat an
    // explicit null as a value, so a default of null would collide on the
    // second ordinary row); `isReversed` is set on the original to keep its
    // history while marking it as voided. The partial unique index on
    // `reversalOf` is the replay guard — a row can be reversed exactly once.
    reversalOf: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TreasuryTransaction'
    },
    isReversed: {
        type: Boolean,
        default: false,
        index: true
    },
    reason: {
        type: String,
        maxlength: 500,
        default: ''
    },
    reversedAt: {
        type: Date,
        default: null
    },
    reversedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, { timestamps: true });

// Compound indexes for dashboard and report queries
TreasuryTransactionSchema.index({ type: 1, date: -1 });
TreasuryTransactionSchema.index({ type: 1, referenceType: 1, date: -1 });
TreasuryTransactionSchema.index({ date: -1 });
// FIN-TAHWEESH-01 (T-09): set-aside balance reads aggregate by method.
TreasuryTransactionSchema.index({ method: 1, date: -1 });
// FIN-RPT-01 (number report): per-number movement queries always scope by
// method + date and group/filter on the trimmed sourceNumber.
TreasuryTransactionSchema.index({ method: 1, sourceNumber: 1, date: -1 });
// FIN-REV-01 (T-REV): replay guard — one Reversal row per original.
TreasuryTransactionSchema.index({ reversalOf: 1 }, { unique: true, sparse: true });

export default (() => {
    const TreasuryTransaction = mongoose.models.TreasuryTransaction || mongoose.model('TreasuryTransaction', TreasuryTransactionSchema);
    // FIN-REV-01 (T-REV): `referenceId` is refPath('referenceType'), and
    // Mongoose only resolves REGISTERED model names. Any Reversal row that
    // still carries a referenceId (e.g. legacy rows created before the field
    // was dropped) would otherwise throw MissingSchemaError for model
    // "Reversal" on every ledger populate. Register a surrogate bound to the
    // SAME collection, mirroring the UnifiedCollection surrogate import above.
    if (!mongoose.models.Reversal) {
        mongoose.model('Reversal', TreasuryTransactionSchema, TreasuryTransaction.collection.name);
    }
    return TreasuryTransaction;
})();


