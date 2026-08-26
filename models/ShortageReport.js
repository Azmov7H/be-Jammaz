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

export default mongoose.models.ShortageReport || mongoose.model('ShortageReport', ShortageReportSchema);

// T-DB-01
ShortageReportSchema.index({ product: 1 });
ShortageReportSchema.index({ status: 1 });
