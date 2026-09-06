import mongoose from 'mongoose';

const collectionPeriodSchema = new mongoose.Schema({
    debtId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Debt',
        required: true
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    startDate: {
        type: Date,
        default: Date.now
    },
    endDate: Date,
    status: {
        type: String,
        enum: ['pending', 'contacted', 'promise_to_pay', 'failed', 'collected'],
        default: 'pending'
    },
    notes: [{
        content: String,
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        date: { type: Date, default: Date.now }
    }],
    targetDate: Date
}, {
    timestamps: true
});

// T-DB-01 (kept above model compilation so ensureIndexes picks them up)
collectionPeriodSchema.index({ debtId: 1 });
collectionPeriodSchema.index({ assignedTo: 1, status: 1 });

export default mongoose.models.CollectionPeriod || mongoose.model('CollectionPeriod', collectionPeriodSchema);
