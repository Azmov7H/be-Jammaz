import InvoiceSettings from '../models/InvoiceSettings.js';
import { AppError } from '../middlewares/errorHandler.js';

export const SettingsController = {
    async getInvoiceDesign(req, res) {
        const settings = await InvoiceSettings.getSettings();
        res.json({
            status: 'success',
            data: settings
        });
    },

    async updateInvoiceDesign(req, res) {
        const updates = req.body;
        // Basic validation or filtering can be added here

        let settings = await InvoiceSettings.findOne({ isActive: true });
        if (!settings) {
            settings = await InvoiceSettings.create(updates);
        } else {
            Object.assign(settings, updates);
            await settings.save();
        }

        res.json({
            status: 'success',
            data: settings
        });
    }
};
