import mongoose from 'mongoose';
import { BadRequestError } from '../lib/errors.js';

const InvoiceSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now },
    items: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // Optional for service items
        productName: { type: String, required: true },
        qty: { type: Number, required: true, min: 0 }, // T-DB-02
        unitPrice: { type: Number, required: true, min: 0 }, // T-DB-02
        source: { type: String, enum: ['shop', 'warehouse'], default: 'shop' },
        isService: { type: Boolean, default: false }, // Service/custom items (no stock tracking)
        total: { type: Number, required: true, min: 0 }, // T-DB-02
        costPrice: { type: Number },
        profit: { type: Number }
    }],
    subtotal: { type: Number, required: true, min: 0 }, // T-DB-02
    tax: { type: Number, default: 0, min: 0 }, // T-DB-02
    total: { type: Number, required: true, min: 0 }, // T-DB-02
    usedCreditBalance: { type: Number, default: 0 },

    paymentType: {
        type: String,
        enum: ['cash', 'credit', 'bank', 'wallet', 'check', 'instapay'],
        default: 'cash'
    },
    // Transfer-source identifier (e.g. InstaPay tx id). Optional; required on
    // entry for NEW instapay/wallet sales via Zod (Sprint 3, FIN-VAL-003).
    sourceNumber: { type: String, maxlength: 100 },
    paymentStatus: {
        type: String,
        enum: ['paid', 'partial', 'pending'],
        default: 'paid'
    },
    paidAmount: { type: Number, default: 0, min: 0 }, // T-DB-02
    dueDate: { type: Date },

    payments: [{
        amount: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        method: { type: String, enum: ['cash', 'bank', 'wallet', 'check', 'credit_balance', 'instapay'], default: 'cash' },
        sourceNumber: { type: String, maxlength: 100 },
        note: String,
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],

    totalCost: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName: String,
    customerPhone: String,
    customerPriceType: { type: String, enum: ['retail', 'wholesale', 'special'] },

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    hasReturns: { type: Boolean, default: false },
    notes: String
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Method to record payment
InvoiceSchema.methods.recordPayment = function (amount, method, note, userId, session = null, sourceNumber = '') {
    // T-DB-06: negative/zero amounts rejected at entry; the mutation is a
    // single atomic pipeline update — no read-modify-write race.
    if (!(amount > 0)) {
        throw new BadRequestError('قيمة الدفعة يجب أن تكون أكبر من صفر');
    }
    const payment = { amount, method, note, recordedBy: userId, date: new Date(), sourceNumber: sourceNumber || undefined };

    return this.constructor.findOneAndUpdate(
        { _id: this._id },
        [
            { $set: {
                payments: { $concatArrays: [{ $ifNull: ['$payments', []] }, [payment]] },
                paidAmount: { $min: [{ $add: [{ $ifNull: ['$paidAmount', 0] }, amount] }, '$total'] }
            } },
            { $set: {
                paymentStatus: {
                    $cond: [{ $gte: ['$paidAmount', '$total'] }, 'paid',
                        { $cond: [{ $gt: ['$paidAmount', 0] }, 'partial', 'pending'] }]
                }
            } }
        ],
        { new: true, session }
    );
};

// Indexes for common queries
InvoiceSchema.index({ dueDate: 1 });
InvoiceSchema.index({ date: -1 });
InvoiceSchema.index({ customer: 1 });
InvoiceSchema.index({ paymentStatus: 1, date: -1 });  // For filtered lists
InvoiceSchema.index({ customer: 1, date: -1 });  // For customer history

InvoiceSchema.virtual('remainingBalance').get(function () {
    return this.total - this.paidAmount;
});

export default mongoose.models.Invoice || mongoose.model('Invoice', InvoiceSchema);


