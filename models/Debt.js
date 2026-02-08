import mongoose from 'mongoose';

const debtSchema = new mongoose.Schema({
    // Debtor Info
    debtorType: {
        type: String,
        enum: ['Customer', 'Supplier'],
        required: true
    },
    debtorId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'debtorType'
    },

    // Financials
    originalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    remainingAmount: {
        type: Number,
        required: true,
        min: 0
    },
    currency: {
        type: String,
        default: 'EGP'
    },

    // Status tracking
    status: {
        type: String,
        enum: ['active', 'overdue', 'settled', 'written-off'],
        default: 'active',
        index: true
    },
    dueDate: {
        type: Date,
        required: true,
        index: true
    },

    // Origin
    referenceType: {
        type: String,
        enum: ['Invoice', 'PurchaseOrder', 'Manual', 'Customer', 'Supplier'],
        required: true
    },
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'referenceType'
    },

    // Meta
    description: String,
    tags: [String],
    meta: {
        type: Map,
        of: mongoose.Schema.Types.Mixed
    },

    // Audit
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for common queries
debtSchema.index({ debtorType: 1, debtorId: 1, status: 1 });
debtSchema.index({ dueDate: 1, status: 1 }); // For overdue checks

// Virtual for progress
debtSchema.virtual('progress').get(function () {
    if (this.originalAmount === 0) return 100;
    return ((this.originalAmount - this.remainingAmount) / this.originalAmount) * 100;
});

export default mongoose.models.Debt || mongoose.model('Debt', debtSchema);


