export const SettingsController = {
    async getInvoiceDesign() {
        // routeHandler wraps into the standard success envelope
        return InvoiceSettings.getSettings();
    },

    async updateInvoiceDesign(req) {
        const settings = await InvoiceSettings.findOne({ isActive: true });
        if (!settings) {
            return InvoiceSettings.create(req.body);
        }
        Object.assign(settings, req.body);
        await settings.save();
        return settings;
    }
};
