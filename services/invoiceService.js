import { InvoiceRepository } from '../repositories/invoiceRepository.js';
import { ProductRepository } from '../repositories/productRepository.js';
import { CustomerRepository } from '../repositories/customerRepository.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import { SaleService } from './financial/saleService.js';
import dbConnect from '../lib/db.js';
import mongoose from 'mongoose';
import { AppError } from '../middlewares/errorHandler.js';

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
        await dbConnect();
        // Transactions are only supported on Replica Sets.
        // For local development (standalone), we proceed without transactions.
        let session = null;
        try {
            // session = await mongoose.startSession();
            // session.startTransaction();
        } catch (error) {
            // Failed to start session/transaction (likely standalone)
            session = null;
        }

        try {
            const { items, customerId, customerName, customerPhone, paymentType, tax = 0, dueDate, notes } = data;

            // 1. Calculate Totals & Validate Products (Backend Truth)
            let subtotal = 0;
            let totalCost = 0;
            const processedItems = [];

            for (const item of items) {
                let productName = item.name;
                let costPrice = item.buyPrice || 0;
                let productId = item.productId;
                const isService = !!item.isService || !productId;

                if (productId && !isService) {
                    const product = await ProductRepository.findById(productId, session);
                    if (!product) throw new AppError(`المنتج غير موجود: ${productId}`, 400);

                    productName = product.name;
                    costPrice = product.buyPrice || 0; // Use current average cost from DB
                }

                const itemTotal = Number((item.qty * item.unitPrice).toFixed(2));
                const lineCost = Number((item.qty * costPrice).toFixed(2));
                const lineProfit = itemTotal - lineCost;

                subtotal += itemTotal;
                totalCost += lineCost;

                processedItems.push({
                    productId,
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

            const total = Number((subtotal + Number(tax)).toFixed(2));
            const profit = total - totalCost;

            // 2. Resolve Customer Info
            let finalCustomerName = customerName;
            let finalCustomerPhone = customerPhone;

            if (customerId) {
                const customer = await CustomerRepository.findById(customerId, session);
                if (customer) {
                    finalCustomerName = customer.name;
                    finalCustomerPhone = customer.phone;
                }
            }

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
                customerName: finalCustomerName,
                customerPhone: finalCustomerPhone,
                createdBy: userId,
                paymentStatus: paymentType === 'cash' ? 'paid' : 'pending',
                paidAmount: paymentType === 'cash' ? total : 0,
                notes
            };

            const invoice = await InvoiceRepository.create(invoiceData, session);

            // 4. Trigger Side Effects (Stock, Debt, Treasury)
            await SaleService.recordSale(invoice, userId, session);

            // if (session) {
            //     await session.commitTransaction();
            //     session.endSession();
            // }

            return invoice;
        } catch (error) {
            // if (session) {
            //     await session.abortTransaction();
            //     session.endSession();
            // }
            throw error;
        }
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



