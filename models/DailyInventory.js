import mongoose from 'mongoose';

const DailyInventorySchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
        unique: true,
        index: true
    },
    productSnapshots: [{
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        name: String,
        code: String,
        warehouseQty: {
            type: Number,
            default: 0,
            min: 0
        },
        shopQty: {
            type: Number,
            default: 0,
            min: 0
        },
        totalQty: {
            type: Number,
            default: 0,
            min: 0
        },
        buyPrice: Number,
        value: Number, // totalQty * buyPrice
        category: String
    }],
    totalValue: {
        type: Number,
        default: 0,
        min: 0
    },
    totalWarehouseValue: {
        type: Number,
        default: 0,
        min: 0
    },
    totalShopValue: {
        type: Number,
        default: 0,
        min: 0
    },
    totalProducts: {
        type: Number,
        default: 0
    },
    lowStockCount: {
        type: Number,
        default: 0
    },
    outOfStockCount: {
        type: Number,
        default: 0
    },
    discrepancies: [{
        productId: mongoose.Schema.Types.ObjectId,
        name: String,
        expected: Number,
        actual: Number,
        difference: Number,
        reason: String
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Calculate totals before saving
DailyInventorySchema.pre('save', function (next) {
    let totalVal = 0;
    let warehouseVal = 0;
    let shopVal = 0;
    let lowStock = 0;
    let outOfStock = 0;

    this.productSnapshots.forEach(snapshot => {
        snapshot.totalQty = snapshot.warehouseQty + snapshot.shopQty;
        snapshot.value = snapshot.totalQty * (snapshot.buyPrice || 0);

        totalVal += snapshot.value;
        warehouseVal += snapshot.warehouseQty * (snapshot.buyPrice || 0);
        shopVal += snapshot.shopQty * (snapshot.buyPrice || 0);

        if (snapshot.totalQty === 0) outOfStock++;
        else if (snapshot.totalQty <= 5) lowStock++; // Assuming minLevel = 5
    });

    this.totalValue = totalVal;
    this.totalWarehouseValue = warehouseVal;
    this.totalShopValue = shopVal;
    this.totalProducts = this.productSnapshots.length;
    this.lowStockCount = lowStock;
    this.outOfStockCount = outOfStock;

    next();
});

DailyInventorySchema.index({ date: -1 });

export default mongoose.models.DailyInventory || mongoose.model('DailyInventory', DailyInventorySchema);


