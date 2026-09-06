import mongoose from 'mongoose';

const ShortageReportSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, required: true }, // Snapshot in case product is deleted
    requestedQty: { type: Number, required: true },
    availableQty: { type: Number, required: true },
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requesterName: String,
    status: {
        type: String,
        enum: ['PENDING', 'VIEWED', 'RESOLVED'],
        default: 'PENDING'
    },
    notes: String
}, { timestamps: true });

// T-DB-01 (kept above model compilation so ensureIndexes picks them up)
ShortageReportSchema.index({ product: 1 });
ShortageReportSchema.index({ status: 1 });

export default mongoose.models.ShortageReport || mongoose.model('ShortageReport', ShortageReportSchema);
