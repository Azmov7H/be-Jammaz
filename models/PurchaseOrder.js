import mongoose from 'mongoose';

const PurchaseOrderSchema = new mongoose.Schema({
    poNumber: { type: String, required: true, unique: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    items: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        quantity: { type: Number, required: true },
        costPrice: { type: Number, required: true }, // Cost at time of order
        receivedQty: { type: Number, default: 0 }
    }],
    status: {
        type: String,
        enum: ['PENDING', 'RECEIVED', 'CANCELLED'],
        default: 'PENDING'
    },
    totalCost: { type: Number, default: 0 },
    expectedDate: Date,
    receivedDate: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: String,
    paymentType: { type: String, enum: ['cash', 'credit', 'bank', 'bank_transfer', 'wallet', 'cash_wallet'], default: 'cash' },
    paidAmount: { type: Number, default: 0 },
    paymentStatus: {
        type: String,
        enum: ['pending', 'partial', 'paid'],
        default: 'pending'
    }
}, { timestamps: true });

// Performance Indices
PurchaseOrderSchema.index({ supplier: 1 });
PurchaseOrderSchema.index({ status: 1 });
PurchaseOrderSchema.index({ createdAt: -1 });

export default mongoose.models.PurchaseOrder || mongoose.model('PurchaseOrder', PurchaseOrderSchema);


