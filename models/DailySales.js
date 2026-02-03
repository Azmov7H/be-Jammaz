import mongoose from 'mongoose';

const DailySalesSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
        unique: true, // One record per day
        index: true
    },
    totalRevenue: {
        type: Number,
        default: 0,
        min: 0
    },
    totalCost: {
        type: Number,
        default: 0,
        min: 0
    },
    grossProfit: {
        type: Number,
        default: 0
    },
    netProfit: {
        type: Number,
        default: 0
    },
    invoiceCount: {
        type: Number,
        default: 0,
        min: 0
    },
    itemsSold: {
        type: Number,
        default: 0,
        min: 0
    },
    cashReceived: {
        type: Number,
        default: 0,
        min: 0
    },
    creditSales: {
        type: Number,
        default: 0,
        min: 0
    },
    topProducts: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        name: String,
        quantitySold: Number,
        revenue: Number
    }],
    invoices: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Invoice'
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Calculate profit before saving
DailySalesSchema.pre('save', async function () {
    this.grossProfit = this.totalRevenue - this.totalCost;
    this.netProfit = this.grossProfit; // Can subtract expenses later
});

// Index for date range queries
DailySalesSchema.index({ date: -1 });

export default mongoose.models.DailySales || mongoose.model('DailySales', DailySalesSchema);


