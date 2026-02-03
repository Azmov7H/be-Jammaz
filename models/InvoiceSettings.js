import mongoose from 'mongoose';

const InvoiceSettingsSchema = new mongoose.Schema({
    // ... same structure ...
    // Company Information
    companyName: {
        type: String,
        default: 'مؤسستي'
    },
    companyLogo: {
        type: String, // URL to uploaded logo
        default: ''
    },
    phone: {
        type: String,
        default: ''
    },
    additionalPhones: {
        type: [String],
        default: []
    },
    address: {
        type: String,
        default: ''
    },
    email: {
        type: String,
        default: ''
    },
    website: {
        type: String,
        default: ''
    },

    // Design Customization
    primaryColor: {
        type: String,
        default: '#3b82f6' // Blue
    },
    secondaryColor: {
        type: String,
        default: '#64748b' // Slate
    },
    headerBgColor: {
        type: String,
        default: '#f8fafc' // Light slate
    },

    // Display Options
    showLogo: {
        type: Boolean,
        default: true
    },
    showQRCode: {
        type: Boolean,
        default: true
    },
    footerText: {
        type: String,
        default: 'شكراً لتعاملكم معنا'
    },

    // Template Type
    invoiceTemplate: {
        type: String,
        enum: ['modern', 'classic', 'minimal'],
        default: 'modern'
    },

    // Notification Settings
    stockAlertThreshold: {
        type: Number,
        default: 5
    },
    supplierPaymentAlertDays: {
        type: Number,
        default: 3
    },
    customerCollectionAlertDays: {
        type: Number,
        default: 3
    },
    defaultCustomerTerms: {
        type: Number,
        default: 15
    },
    defaultSupplierTerms: {
        type: Number,
        default: 15
    },
    minDebtNotificationAmount: {
        type: Number,
        default: 10
    },

    // Inactivity Alerts
    inactiveCustomerThresholdDays: {
        type: Number,
        default: 30
    },

    // Sequences
    lastReceiptNumber: {
        type: Number,
        default: 1000
    },


    // Only one settings document should exist
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Original static method for internal use or server-side without cache
InvoiceSettingsSchema.statics.getSettingsBase = async function () {
    let settings = await this.findOne({ isActive: true });
    if (!settings) {
        settings = await this.create({});
    }
    return settings;
};

// Singleton pattern - without Next.js unstable_cache
InvoiceSettingsSchema.statics.getSettings = async function () {
    return this.getSettingsBase();
};

export default mongoose.models.InvoiceSettings || mongoose.model('InvoiceSettings', InvoiceSettingsSchema);


