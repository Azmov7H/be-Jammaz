import { InvoiceService } from '../services/invoiceService.js';
import { ReturnService } from '../services/financial/returnService.js';
import { invoiceSchema } from '../validations/index.js';
import { AppError } from '../middlewares/errorHandler.js';

export const InvoiceController = {
    async create(req) {
        const data = invoiceSchema.parse(req.body);
        return await InvoiceService.create(data, req.user._id);
    },

    async getAll(req) {
        return await InvoiceService.getAll(req.query);
    },

    async getById(req) {
        const invoice = await InvoiceService.getById(req.params.id);
        if (!invoice) throw new AppError('Fatoora not found', 404);
        return invoice;
    },

    async delete(req) {
        return await InvoiceService.deleteInvoice(req.params.id, req.user._id);
    },

    async getReturns(req) {
        return await ReturnService.getReturnsByInvoice(req.params.id);
    },

    async createReturn(req) {
        return await ReturnService.createReturn(req.params.id, req.body, req.user._id);
    }
};
