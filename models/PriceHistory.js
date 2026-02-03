import mongoose from 'mongoose';

const PriceHistorySchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true
    },
    productName: String, // Snapshot for reporting
    productCode: String, // Snapshot for reporting
    priceType: {
        type: String,
        enum: ['retail', 'wholesale', 'special', 'buy'],
        required: true
    },
    oldPrice: {
        type: Number,
        required: true
    },
    newPrice: {
        type: Number,
        required: true
    },
    changeAmount: {
        type: Number
    }, // newPrice - oldPrice
    changePercentage: {
        type: Number
    }, // ((newPrice - oldPrice) / oldPrice) * 100
    changeReason: {
        type: String,
        required: true
    },
    changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true
});

// Pre-save middleware to calculate change
PriceHistorySchema.pre('save', function (next) {
    this.changeAmount = this.newPrice - this.oldPrice;
    if (this.oldPrice !== 0) {
        this.changePercentage = ((this.newPrice - this.oldPrice) / this.oldPrice) * 100;
    }
    next();
});

// Indexes
PriceHistorySchema.index({ productId: 1, date: -1 });
PriceHistorySchema.index({ priceType: 1 });
PriceHistorySchema.index({ date: -1 });

// Static method to log a price change
PriceHistorySchema.statics.logChange = async function ({
    productId,
    productName,
    productCode,
    priceType,
    oldPrice,
    newPrice,
    changeReason,
    changedBy
}) {
    // Only log if there's an actual change
    if (oldPrice === newPrice) return null;

    return await this.create({
        productId,
        productName,
        productCode,
        priceType,
        oldPrice,
        newPrice,
        changeReason,
        changedBy
    });
};

export default mongoose.models.PriceHistory || mongoose.model('PriceHistory', PriceHistorySchema);


