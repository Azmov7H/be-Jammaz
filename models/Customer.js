import mongoose from 'mongoose';

const CustomerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    address: String,
    notes: String,
    shippingCompany: String,
    priceType: {
        type: String,
        enum: ['retail', 'wholesale', 'special'],
        default: 'retail'
    },

    // Credit Management
    balance: {
        type: Number,
        default: 0
    },
    creditBalance: {
        type: Number,
        default: 0
    },
    creditLimit: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
    financialTrackingEnabled: { type: Boolean, default: true },
    collectionDay: {
        type: String,
        enum: ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'None'],
        default: 'None'
    },
    paymentTerms: { type: Number, default: 0 },

    totalPurchases: { type: Number, default: 0 },
    lastPurchaseDate: Date,

    customPricing: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        customPrice: { type: Number, required: true },
        setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        setAt: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

// Helper method to get custom price for a product
CustomerSchema.methods.getPriceForProduct = function (productId) {
    const pricing = this.customPricing?.find(p => p.productId?.toString() === productId?.toString());
    return pricing ? pricing.customPrice : null;
};

CustomerSchema.index({ balance: 1 });

export default mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);


