import mongoose from 'mongoose';

const TreasuryTransactionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['INCOME', 'EXPENSE'],
        required: true
    },
    receiptNumber: {
        type: String,
        unique: false, // We'll handle uniqueness in service/app logic for simplicity with legacy data
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
        enum: ['Invoice', 'PurchaseOrder', 'Manual', 'SalesReturn', 'Debt', 'UnifiedCollection'],
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
        enum: ['cash', 'bank', 'wallet', 'check', 'adjustment'],
        default: 'cash'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, { timestamps: true });

// Register a surrogate model for UnifiedCollection if it hasn't been registered yet.
// This is used as an alias for Customer in TreasuryTransaction refPath.
if (mongoose.models && !mongoose.models.UnifiedCollection) {
    mongoose.model('UnifiedCollection', new mongoose.Schema({}, { strict: false }), 'customers');
}

// Compound indexes for dashboard and report queries
TreasuryTransactionSchema.index({ type: 1, date: -1 });
TreasuryTransactionSchema.index({ type: 1, referenceType: 1, date: -1 });
TreasuryTransactionSchema.index({ date: -1 });

export default mongoose.models.TreasuryTransaction || mongoose.model('TreasuryTransaction', TreasuryTransactionSchema);


