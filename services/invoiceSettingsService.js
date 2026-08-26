import { logger } from '../lib/logger.js';
import InvoiceSettings from '../models/InvoiceSettings.js';

/**
 * Fields a client may set on invoice settings.
 * Interim mass-assignment stopgap until Zod schemas land (T-VAL-01).
 * System-managed fields (isActive, lastReceiptNumber) are NOT settable.
 */
const ALLOWED_FIELDS = [
    'companyName',
    'companyLogo',
    'phone',
    'additionalPhones',
    'address',
    'email',
    'website',
    'primaryColor',
    'secondaryColor',
    'headerBgColor',
    'showLogo',
    'showQRCode',
    'footerText',
    'invoiceTemplate',
    'stockAlertThreshold',
    'supplierPaymentAlertDays',
    'customerCollectionAlertDays',
    'defaultCustomerTerms',
    'defaultSupplierTerms',
    'minDebtNotificationAmount',
    'inactiveCustomerThresholdDays'
];

export const InvoiceSettingsService = {
    async getSettings() {
        return InvoiceSettings.getSettings();
    },

    /**
     * Update invoice design with explicit field allowlist.
     * Unknown fields are ignored and logged.
     */
    async updateInvoiceDesign(payload) {
        const rejected = Object.keys(payload || {}).filter(k => !ALLOWED_FIELDS.includes(k));
        if (rejected.length > 0) {
            logger.warn('[InvoiceSettings] ignored non-allowed fields:', rejected.join(', '));
        }

        const updates = {};
        for (const field of ALLOWED_FIELDS) {
            if (payload && payload[field] !== undefined) updates[field] = payload[field];
        }

        let settings = await InvoiceSettings.findOne({ isActive: true });
        if (!settings) {
            return InvoiceSettings.create(updates);
        }
        Object.assign(settings, updates);
        await settings.save();
        return settings;
    }
};
