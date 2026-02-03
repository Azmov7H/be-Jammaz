import mongoose from 'mongoose';

const InvoiceSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now },
    items: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // Optional for service items
        productName: { type: String, required: true },
        qty: { type: Number, required: true },
        unitPrice: { type: Number, required: true },
        source: { type: String, enum: ['shop', 'warehouse'], default: 'shop' },
        isService: { type: Boolean, default: false }, // Service/custom items (no stock tracking)
        total: { type: Number, required: true },
        costPrice: { type: Number },
        profit: { type: Number }
    }],
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    usedCreditBalance: { type: Number, default: 0 },

    paymentType: {
        type: String,
        enum: ['cash', 'credit', 'bank'],
        default: 'cash'
    },
    paymentStatus: {
        type: String,
        enum: ['paid', 'partial', 'pending'],
        default: 'paid'
    },
    paidAmount: { type: Number, default: 0 },
    dueDate: { type: Date },

    payments: [{
        amount: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        method: { type: String, enum: ['cash', 'bank', 'credit_balance'], default: 'cash' },
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
InvoiceSchema.methods.recordPayment = function (amount, method, note, userId, session = null) {
    this.payments.push({
        amount,
        method,
        note,
        recordedBy: userId,
        date: new Date()
    });

    this.paidAmount = (this.paidAmount || 0) + amount;

    // Update status
    if (this.paidAmount >= this.total) {
        this.paymentStatus = 'paid';
        // Cap paid amount if it slightly exceeds due to rounding
        if (this.paidAmount > this.total) this.paidAmount = this.total;
    } else if (this.paidAmount > 0) {
        this.paymentStatus = 'partial';
    } else {
        this.paymentStatus = 'pending';
    }

    return this.save({ session });
};

// Indexes for common queries
InvoiceSchema.index({ date: -1 });
InvoiceSchema.index({ customer: 1 });

InvoiceSchema.virtual('remainingBalance').get(function () {
    return this.total - this.paidAmount;
});

export default mongoose.models.Invoice || mongoose.model('Invoice', InvoiceSchema);


