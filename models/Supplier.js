import mongoose from 'mongoose';

const SupplierSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: String,
    address: String,
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    // Financials
    balance: { type: Number, default: 0 }, // Positive = You owe them (Credit)
    isActive: { type: Boolean, default: true },

    lastSupplyDate: Date,

    // Financial Tracking / Debt Control
    financialTrackingEnabled: { type: Boolean, default: true },
    paymentDay: {
        type: String,
        enum: ['None', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        default: 'None'
    },
    supplyTerms: { type: Number, default: 0 } // 0 means use global default
}, { timestamps: true });

export default mongoose.models.Supplier || mongoose.model('Supplier', SupplierSchema);


