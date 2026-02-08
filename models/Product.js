import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide a name'],
        trim: true,
        index: true
    },
    code: {
        type: String,
        required: [true, 'Please provide a code'],
        unique: true,
        trim: true,
        index: true
    },
    brand: { type: String, trim: true, index: true },
    category: { type: String, trim: true, index: true },
    subsection: { type: String, trim: true, index: true },
    size: { type: String, trim: true },
    color: { type: String, trim: true },
    gender: {
        type: String,
        enum: ['men', 'women', 'unisex', 'kids', 'none'],
        default: 'none'
    },
    season: { type: String, trim: true },
    unit: { type: String, default: 'piece' },

    // Pricing
    buyPrice: { type: Number, required: true, min: 0 },
    retailPrice: { type: Number, required: true, min: 0 },
    wholesalePrice: { type: Number, min: 0 },
    specialPrice: { type: Number, min: 0 },

    // Profit margin settings
    minProfitMargin: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    lastPriceChange: { type: Date },

    // Inventory
    stockQty: { type: Number, default: 0 },
    warehouseQty: { type: Number, default: 0, min: 0 },
    shopQty: { type: Number, default: 0, min: 0 },

    // Handover / Initial state
    openingWarehouseQty: { type: Number, default: 0 },
    openingShopQty: { type: Number, default: 0 },
    openingBuyPrice: { type: Number, default: 0 },

    minLevel: { type: Number, default: 5 },
    images: [String],
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes
ProductSchema.index({ category: 1, isActive: 1 });
ProductSchema.index({ stockQty: 1 });
ProductSchema.index({ warehouseQty: 1, shopQty: 1 }); // Optimized for quantity checks
ProductSchema.index({ createdAt: -1 });

// Middleware to sync stockQty
ProductSchema.pre('save', function () {
    this.stockQty = (this.warehouseQty || 0) + (this.shopQty || 0);
});

if (mongoose.models.Product) {
    delete mongoose.models.Product;
}

export default mongoose.models.Product || mongoose.model('Product', ProductSchema);


