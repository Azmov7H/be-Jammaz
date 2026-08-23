import { InvoiceSettingsService } from '../services/invoiceSettingsService.js';

export const SettingsController = {
    async getInvoiceDesign() {
        // routeHandler wraps into the standard success envelope
        return InvoiceSettingsService.getSettings();
    },

    async updateInvoiceDesign(req) {
        return InvoiceSettingsService.updateInvoiceDesign(req.body);
    }
};
