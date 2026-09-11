import { InvoiceRepository } from '../repositories/invoiceRepository.js';
import { literalContains } from '../lib/safeRegex.js';
import { ProductRepository } from '../repositories/productRepository.js';
import { CustomerRepository } from '../repositories/customerRepository.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import { SaleService } from './financial/saleService.js';
import dbConnect from '../lib/db.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';
import { nextDocumentNumber } from '../lib/counters.js';
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
                { number: literalContains(search) },
                { customerName: literalContains(search) }
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
            const { items, customerId, customerName, customerPhone, paymentType, tax = 0, dueDate, notes, sourceNumber, usedCreditBalance = 0 } = data;

            // 1. Load customer first: item prices are validated against the
            // server-resolved price (custom > tier > retail), never trusted
            // from the client (T1b).
            const invoiceCustomer = customerId
                ? await Customer.findById(customerId).session(session)
                : null;
            if (customerId && !invoiceCustomer) throw new NotFoundError('العميل غير موجود');

            // 2. Calculate Totals & Validate Products (+ prices)
            const { processedItems, subtotal, totalCost } = await this._processInvoiceItems(items, session, invoiceCustomer);

            const total = Number((subtotal + Number(tax)).toFixed(2));
            const profit = total - totalCost;

            // FIN-OVERDEDUCT: the credit decrement in recordSale is a guarded
            // no-op on insufficient funds — without this check the invoice
            // would book a discount that was never deducted (double-spend).
            const creditToUse = Number(usedCreditBalance || 0);
            if (creditToUse > 0 && paymentType !== 'credit') {
                if (!invoiceCustomer) throw new NotFoundError('العميل غير موجود');
                const availableCredit = Number(Number(invoiceCustomer.creditBalance || 0).toFixed(2));
                const maxUsable = Math.min(total, availableCredit);
                if (creditToUse - maxUsable > 0.01) {
                    throw new BadRequestError(
                        `رصيد العميل الدائن المتاح (${availableCredit.toLocaleString()}) لا يكفي لخصم (${creditToUse.toLocaleString()}) من هذه الفاتورة`
                    );
                }
            }

            // 2. Resolve Customer Info
            const { finalName, finalPhone } = await this._resolveCustomerDetails(customerId, customerName, customerPhone, session);

            // 3. Resolve priceType snapshot for the invoice (audit trail)
            let customerPriceType;
            if (customerId) {
                const customer = await CustomerRepository.findById(customerId, session);
                customerPriceType = customer?.priceType || 'retail';
            }

            // 4. Create Invoice Record
            const invoiceData = {
                number: await nextDocumentNumber('INV'),
                items: processedItems,
                subtotal,
                tax,
                total,
                paymentType,
                sourceNumber,
                dueDate,
                totalCost,
                profit,
                customer: customerId,
                customerName: finalName,
                customerPhone: finalPhone,
                customerPriceType,
                createdBy: userId,
                paymentStatus: paymentType === 'credit' ? 'pending' : 'paid',
                // If the user opted to apply the customer's creditBalance,
                // reduce the paidAmount accordingly so the accounting
                // ledger reflects the actual cash in.
                paidAmount: paymentType === 'credit' ? 0 : Math.max(0, Number((total - Number(usedCreditBalance)).toFixed(2))),
                // FIN-CREDIT-CHOICE — persist the deduction so the audit
                // trail on the invoice shows how much credit was applied.
                usedCreditBalance: Number(usedCreditBalance) > 0 ? Number(usedCreditBalance) : 0,
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
    /**
     * Server-resolved sell price for one product/customer pair.
     * Priority mirrors PricingService.getPrice: custom > tier > retail.
     */
    _resolveServerPrice(product, customer) {
        if (customer) {
            const custom = customer.getPriceForProduct
                ? customer.getPriceForProduct(product._id)
                : null;
            if (custom !== null && custom !== undefined) return Number(custom);
            const tier = customer.priceType || 'retail';
            if (tier === 'wholesale' && product.wholesalePrice != null) return Number(product.wholesalePrice);
            if (tier === 'special' && product.specialPrice != null) return Number(product.specialPrice);
        }
        return Number(product.retailPrice);
    },

    async _processInvoiceItems(items, session, customer = null) {
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
            let unitPrice = Number(item.unitPrice);

            if (productId && !isService) {
                const pid = toIdString(productId);
                const product = productMap.get(pid);
                if (!product) throw new AppError(`المنتج غير موجود: ${JSON.stringify(productId)}`, 400);

                productName = product.name;
                costPrice = product.buyPrice || 0;

                // Flexible pricing: the client may charge ABOVE the
                // system price (price fluctuations). Only a price BELOW
                // the server-resolved price is rejected; the sent price
                // is kept as-is so profit reflects what was charged.
                const serverPrice = this._resolveServerPrice(product, customer);
                if (!Number.isFinite(unitPrice) || unitPrice < serverPrice - 0.005) {
                    throw new AppError(
                        `السعر المرسل (${item.unitPrice}) أقل من سعر النظام (${serverPrice}) للمنتج: ${productName}`,
                        400
                    );
                }
            }

            const itemTotal = Number((item.qty * unitPrice).toFixed(2));
            const lineCost = Number((item.qty * costPrice).toFixed(2));
            const lineProfit = itemTotal - lineCost;

            subtotal += itemTotal;
            totalCost += lineCost;

            processedItems.push({
                productId: isService ? undefined : productId,
                productName,
                qty: item.qty,
                unitPrice,
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
        // T-VAL-04 defense vs stale ids: schema refine guarantees credit sales
        // carry a customerId; here we guarantee that id is real.
        if (!customer) throw new NotFoundError('العميل غير موجود');
        return {
            finalName: customer.name,
            finalPhone: customer.phone
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



