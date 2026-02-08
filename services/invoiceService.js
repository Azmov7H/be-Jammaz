import { InvoiceRepository } from '../repositories/invoiceRepository.js';
import { ProductRepository } from '../repositories/productRepository.js';
import { CustomerRepository } from '../repositories/customerRepository.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import { SaleService } from './financial/saleService.js';
import dbConnect from '../lib/db.js';
import mongoose from 'mongoose';
import { AppError } from '../middlewares/errorHandler.js';
import { withTransaction } from '../utils/dbUtils.js';
import { toIdString } from '../utils/idUtils.js';

export const InvoiceService = {
    async getAll(params) {
        await dbConnect();
        const { page = 1, limit = 50, search, customerId, status } = params;

        const query = {};
        if (search) {
            query.$or = [
                { number: { $regex: search, $options: 'i' } },
                { customerName: { $regex: search, $options: 'i' } }
            ];
        }
        if (customerId) query.customer = customerId;
        if (status) query.paymentStatus = status;

        const skip = (Number(page) - 1) * Number(limit);

        const [invoices, total] = await Promise.all([
            InvoiceRepository.findAll({ query, skip, limit: Number(limit) }),
            InvoiceRepository.count(query)
        ]);

        return {
            invoices,
            pagination: {
                total,
                pages: Math.ceil(total / Number(limit)),
                page: Number(page),
                limit: Number(limit)
            }
        };
    },

    async create(data, userId) {
        return await withTransaction(async (session) => {
            const { items, customerId, customerName, customerPhone, paymentType, tax = 0, dueDate, notes } = data;

            // 1. Calculate Totals & Validate Products
            const { processedItems, subtotal, totalCost } = await this._processInvoiceItems(items, session);

            const total = Number((subtotal + Number(tax)).toFixed(2));
            const profit = total - totalCost;

            // 2. Resolve Customer Info
            const { finalName, finalPhone } = await this._resolveCustomerDetails(customerId, customerName, customerPhone, session);

            // 3. Create Invoice Record
            const invoiceData = {
                number: `INV-${Date.now()}`,
                items: processedItems,
                subtotal,
                tax,
                total,
                paymentType,
                dueDate,
                totalCost,
                profit,
                customer: customerId,
                customerName: finalName,
                customerPhone: finalPhone,
                createdBy: userId,
                paymentStatus: paymentType === 'credit' ? 'pending' : 'paid',
                paidAmount: paymentType === 'credit' ? 0 : total,
                notes
            };

            const invoice = await InvoiceRepository.create(invoiceData, session);

            // 4. Trigger Side Effects (Stock, Debt, Treasury)
            await SaleService.recordSale(invoice, userId, session);

            return invoice;
        });
    },

    /**
     * Internal helper to process and validate items
     * @private
     */
    async _processInvoiceItems(items, session) {
        let subtotal = 0;
        let totalCost = 0;
        const processedItems = [];

        const productIds = items
            .filter(i => i.productId && !i.isService)
            .map(i => i.productId);

        const products = productIds.length > 0
            ? await ProductRepository.findByIds(productIds, session)
            : [];
        const productMap = new Map(products.map(p => [toIdString(p), p]));

        for (const item of items) {
            let productName = item.name;
            let costPrice = item.buyPrice || 0;
            let productId = item.productId;
            const isService = !!item.isService || !productId;

            if (productId && !isService) {
                const pid = toIdString(productId);
                const product = productMap.get(pid);
                if (!product) throw new AppError(`المنتج غير موجود: ${JSON.stringify(productId)}`, 400);

                productName = product.name;
                costPrice = product.buyPrice || 0;
            }

            const itemTotal = Number((item.qty * item.unitPrice).toFixed(2));
            const lineCost = Number((item.qty * costPrice).toFixed(2));
            const lineProfit = itemTotal - lineCost;

            subtotal += itemTotal;
            totalCost += lineCost;

            processedItems.push({
                productId: isService ? undefined : productId,
                productName,
                qty: item.qty,
                unitPrice: item.unitPrice,
                source: item.source || 'shop',
                isService,
                total: itemTotal,
                costPrice,
                profit: lineProfit
            });
        }

        return { processedItems, subtotal, totalCost };
    },

    /**
     * Internal helper to resolve customer name/phone
     * @private
     */
    async _resolveCustomerDetails(customerId, providedName, providedPhone, session) {
        if (!customerId) return { finalName: providedName, finalPhone: providedPhone };

        const customer = await CustomerRepository.findById(customerId, session);
        return {
            finalName: customer?.name || providedName,
            finalPhone: customer?.phone || providedPhone
        };
    },

    async getById(id) {
        await dbConnect();
        return await InvoiceRepository.findById(id);
    },

    async deleteInvoice(id, userId) {
        // Refactored to use generic logic
        return await SaleService.reverseSale(id, userId);
    }
};



