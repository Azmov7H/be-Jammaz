import mongoose from 'mongoose';

const StockMovementSchema = new mongoose.Schema({
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    type: {
        type: String,
        enum: ['IN', 'OUT', 'SALE', 'ADJUST', 'TRANSFER_TO_SHOP', 'TRANSFER_TO_WAREHOUSE', 'TRANSFER', 'INITIAL_BALANCE', 'REVERSAL'],
        required: true
    },
    qty: { type: Number, min: 1, required: true }, // Always positive absolute value
    note: String,
    refId: String, // Invoice ID or other ref
    // Optional warehouse context for multi-warehouse movements. Absent/null
    // means the primary warehouse (legacy semantics).
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
    // Inter-warehouse transfer endpoints (type 'TRANSFER').
    fromWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
    toWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
    // Undo link: set on REVERSAL movements pointing at the original transfer.
    // A movement can be reversed at most once (unique partial index below).
    reverses: { type: mongoose.Schema.Types.ObjectId, ref: 'StockMovement' },
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
// T-DB-01
StockMovementSchema.index({ refId: 1 });
// Reversal lookup (annotate movements + one-reversal-per-movement guard).
// Concurrency: two simultaneous reverse() calls race inside separate
// transactions; the loser rolls back on the duplicate-key abort (409).
StockMovementSchema.index({ reverses: 1 }, {
    unique: true,
    partialFilterExpression: { reverses: { $type: 'objectId' } }
});

export default mongoose.models.StockMovement || mongoose.model('StockMovement', StockMovementSchema);


