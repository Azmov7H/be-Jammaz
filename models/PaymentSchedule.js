import mongoose from 'mongoose';

const PaymentScheduleSchema = new mongoose.Schema({
    // Entity Reference
    entityType: {
        type: String,
        enum: ['Customer', 'Supplier'],
        required: true
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'entityType',
        required: true
    },
    debtId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Debt',
        index: true
    },

    // Payment Details
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    dueDate: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'],
        default: 'PENDING'
    },

    // Optional metadata
    notes: String,
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Index for efficient querying by entity and due date
PaymentScheduleSchema.index({ entityType: 1, entityId: 1, status: 1 });
PaymentScheduleSchema.index({ dueDate: 1, status: 1 });

// Force model refresh if schema changed

export default mongoose.models.PaymentSchedule || mongoose.model('PaymentSchedule', PaymentScheduleSchema);


