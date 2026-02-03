import mongoose from 'mongoose';

const StockMovementSchema = new mongoose.Schema({
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    type: {
        type: String,
        enum: ['IN', 'OUT', 'SALE', 'ADJUST', 'TRANSFER_TO_SHOP', 'TRANSFER_TO_WAREHOUSE', 'INITIAL_BALANCE'],
        required: true
    },
    qty: { type: Number, required: true }, // Always positive absolute value
    note: String,
    refId: String, // Invoice ID or other ref
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    date: { type: Date, default: Date.now },

    // Snapshot of post-movement levels for auditing
    snapshot: {
        warehouseQty: Number,
        shopQty: Number
    }
}, { timestamps: true });

// Index for product history
StockMovementSchema.index({ productId: 1, date: -1 });

export default mongoose.models.StockMovement || mongoose.model('StockMovement', StockMovementSchema);


