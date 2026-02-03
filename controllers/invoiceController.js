import { InvoiceService } from '../services/invoiceService.js';
import { ReturnService } from '../services/financial/returnService.js';
import { z } from 'zod';
import { AppError } from '../middlewares/errorHandler.js';

const invoiceItemSchema = z.object({
    productId: z.string().optional(),
    name: z.string().min(1),
    qty: z.number().min(0.01),
    unitPrice: z.number().min(0),
    isService: z.boolean().default(false),
    source: z.enum(['shop', 'warehouse']).default('shop'),
    buyPrice: z.number().optional() // Optional, but if provided should be verified
});

const createInvoiceSchema = z.object({
    items: z.array(invoiceItemSchema).min(1),
    customerId: z.string().optional().nullable(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    paymentType: z.enum(['cash', 'credit', 'bank']),
    tax: z.number().default(0),
    dueDate: z.string().or(z.date()).optional(),
    notes: z.string().optional()
});

export const InvoiceController = {
    async create(req) {
        const data = createInvoiceSchema.parse(req.body);
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
