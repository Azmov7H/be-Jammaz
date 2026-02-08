import dbConnect from '../../lib/db.js';
import SalesReturn from '../../models/SalesReturn.js';
import Customer from '../../models/Customer.js';
import { StockService } from '../stockService.js';
import { TreasuryService } from '../treasuryService.js';
import { toIdString } from '../../utils/idUtils.js';

/**
 * Return Service
 * Handles processing of sales returns
 */
export const ReturnService = {
    /**
     * Get all returns for a specific invoice
     */
    async getReturnsByInvoice(invoiceId) {
        await dbConnect();
        const returns = await SalesReturn.find({ originalInvoice: invoiceId })
            .populate('items.productId', 'name')
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 })
            .lean();

        return returns;
    },

    /**
     * Create a return (Wrapper for processSaleReturn to match Controller expectation)
     */
    async createReturn(invoiceId, data, userId) {
        const Invoice = (await import('../../models/Invoice.js')).default;
        const invoice = await Invoice.findById(invoiceId);
        if (!invoice) throw new Error('Invoice not found');

        // Map frontend items [{invoiceItemId, qty}] to service expected format
        const returnItems = [];
        let totalRefund = 0;

        for (const reqItem of data.items) {
            const originalItem = invoice.items.find(i => i._id.toString() === reqItem.invoiceItemId);
            if (originalItem) {
                returnItems.push({
                    invoiceItemId: reqItem.invoiceItemId,
                    productId: originalItem.productId,
                    productName: originalItem.productName || originalItem.name, // Fallback
                    qty: reqItem.qty,
                    unitPrice: originalItem.unitPrice,
                    refundAmount: reqItem.qty * originalItem.unitPrice
                });
                totalRefund += (reqItem.qty * originalItem.unitPrice);
            }
        }

        return await this.processSaleReturn(invoice, { returnItems, totalRefund }, data.refundMethod, userId);
    },

    /**
     * Process a Sales Return
     */
    async processSaleReturn(invoice, returnData, refundMethod, userId) {
        await dbConnect();
        try {
            const { returnItems, totalRefund } = returnData;

            // 1. Update Original Invoice items
            invoice.items = invoice.items.map(invItem => {
                const retItem = returnItems.find(r =>
                    (r.invoiceItemId && toIdString(r.invoiceItemId) === toIdString(invItem._id)) ||
                    (r.productId && invItem.productId && toIdString(r.productId) === toIdString(invItem.productId))
                );

                if (retItem) {
                    const newQty = invItem.qty - retItem.qty;
                    if (newQty > 0) {
                        return {
                            ...invItem.toObject(),
                            qty: newQty,
                            total: newQty * invItem.unitPrice,
                            profit: newQty * invItem.unitPrice - newQty * (invItem.costPrice || 0)
                        };
                    }
                    return null;
                }
                return invItem;
            }).filter(Boolean);

            const newSubtotal = invoice.items.reduce((sum, item) => sum + item.total, 0);
            invoice.total = newSubtotal + (invoice.tax || 0);
            invoice.totalCost = invoice.items.reduce((sum, item) => sum + (item.qty * (item.costPrice || 0)), 0);
            invoice.profit = invoice.total - invoice.totalCost;

            if (invoice.paidAmount > 0) {
                invoice.paidAmount = Math.max(0, invoice.paidAmount - totalRefund);
            }
            invoice.hasReturns = true;
            await invoice.save();

            // 2. Create SalesReturn document
            const salesReturn = await SalesReturn.create([{
                returnNumber: `RET-${Date.now()}`,
                originalInvoice: invoice._id,
                customer: invoice.customer,
                items: returnItems,
                totalRefund,
                refundMethod,
                customerBalanceAdded: refundMethod === 'customerBalance' ? totalRefund : 0,
                treasuryDeducted: refundMethod === 'cash' ? totalRefund : 0,
                createdBy: userId
            }]);

            const salesReturnDoc = salesReturn[0];

            // 3. Stock re-entry
            await StockService.increaseStockForReturn(returnItems, salesReturnDoc.returnNumber, userId);

            // 4. Financial Settlement
            if (refundMethod === 'cash') {
                await TreasuryService.recordReturnRefund(salesReturnDoc, totalRefund, userId);
            } else if (refundMethod === 'customerBalance' && invoice.customer) {
                const customer = await Customer.findById(invoice.customer);
                if (customer) {
                    let remaining = totalRefund;
                    if (customer.balance > 0) {
                        const reduction = Math.min(customer.balance, remaining);
                        customer.balance -= reduction;
                        remaining -= reduction;
                    }
                    if (remaining > 0) {
                        customer.creditBalance = (customer.creditBalance || 0) + remaining;
                    }
                    await customer.save();
                }
            }

            return { salesReturn: salesReturnDoc, invoice };
        } catch (error) {
            throw error;
        }
    }
};



