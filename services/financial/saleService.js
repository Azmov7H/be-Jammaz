import dbConnect from '../../lib/db.js';
import Product from '../../models/Product.js';
import Invoice from '../../models/Invoice.js';
import Customer from '../../models/Customer.js';
import { StockService } from '../stockService.js';
import { TreasuryService } from '../treasuryService.js';
import { DailySalesService } from '../dailySalesService.js';
import { DebtService } from './debtService.js';
import { LogService } from '../logService.js';
import InvoiceSettings from '../../models/InvoiceSettings.js';
import { withTransaction } from '../../utils/dbUtils.js';
import mongoose from 'mongoose';

/**
 * Sale Service
 * Handles recording and reversing sales (invoices)
 */
export const SaleService = {
    /**
     * Record a Sale (Invoice)
     */
    async recordSale(invoice, userId, session = null) {
        await dbConnect();
        try {
            // 1. Stock reduction
            await StockService.reduceStockForSale(invoice.items, invoice._id, userId, session);

            // 2. Treasury & Customer Balance
            const netCashReceived = invoice.paidAmount - (invoice.usedCreditBalance || 0);

            if (netCashReceived > 0) {
                await TreasuryService.recordSaleIncome({
                    ...invoice.toObject(),
                    total: netCashReceived,
                    number: invoice.usedCreditBalance > 0 ? `${invoice.number} (بعد الخصم)` : invoice.number
                }, userId, session);
            }

            // 3. Update Customer Balance & Create Debt Record
            if (invoice.customer && (invoice.paymentType === 'credit' || invoice.paymentType === 'partial')) {
                const remainingDebt = invoice.total - (invoice.paidAmount || 0);
                if (remainingDebt > 0) {
                    const settings = await InvoiceSettings.getSettings();
                    const defaultDays = settings.defaultCustomerTerms || 15;

                    // Ensure dueDate is valid or use fallback
                    let finalDueDate = (invoice.dueDate && invoice.dueDate !== "")
                        ? new Date(invoice.dueDate)
                        : new Date(Date.now() + defaultDays * 24 * 60 * 60 * 1000);

                    await DebtService.createDebt({
                        debtorType: 'Customer',
                        debtorId: invoice.customer,
                        amount: remainingDebt,
                        dueDate: finalDueDate,
                        referenceType: 'Invoice',
                        referenceId: invoice._id,
                        description: `فاتورة مبيعات #${invoice.number}`,
                        createdBy: userId
                    }, session);
                }
            }

            // 4. Daily Sales & Stats
            await DailySalesService.updateDailySales(invoice, userId, session);

            if (invoice.customer) {
                await Customer.findByIdAndUpdate(invoice.customer, {
                    $inc: { totalPurchases: invoice.total },
                    lastPurchaseDate: new Date()
                }).session(session);
            }

            // 5. Logging
            await LogService.logAction({
                userId,
                action: 'CREATE_INVOICE',
                entity: 'Invoice',
                entityId: invoice._id,
                diff: { total: invoice.total, paymentType: invoice.paymentType },
                note: `Invoice #${invoice.number} processed by SaleService`
            }, session);

            return invoice;
        } catch (error) {
            throw error;
        }
    },

    /**
     * Reverse a Sale (Delete Invoice Logic)
     */
    async reverseSale(invoiceId, userId) {
        return await withTransaction(async (session) => {
            const invoice = await Invoice.findById(invoiceId).populate('items.productId').session(session);
            if (!invoice) throw new Error('الفاتورة غير موجودة');

            // 1. Reverse Stock
            const trackableItems = invoice.items.filter(item => !item.isService && item.productId);
            if (trackableItems.length > 0) {
                await StockService.increaseStockForReturn(
                    trackableItems,
                    invoice._id,
                    userId,
                    session,
                    `إلغاء فاتورة #${invoice.number}`
                );
            }

            // 2. Reverse Treasury Transactions
            await TreasuryService.deleteTransactionByRef('Invoice', invoice._id, session);

            // 3. Update Customer Balance & Debt
            if (invoice.customer) {
                const Debt = (await import('../../models/Debt.js')).default;
                const debt = await Debt.findOne({ referenceType: 'Invoice', referenceId: invoice._id }).session(session);
                if (debt) {
                    await DebtService.deleteDebt(debt._id, session);
                }
            }

            // 4. Daily Sales & Customer purchases
            await DailySalesService.reverseDailySales(invoice, userId, session);

            if (invoice.customer) {
                await Customer.findByIdAndUpdate(invoice.customer, {
                    $inc: { totalPurchases: -invoice.total }
                }).session(session);
            }

            // 5. Delete Invoice
            await invoice.deleteOne({ session });

            // 5. Logging
            await LogService.logAction({
                userId,
                action: 'REVERSE_INVOICE',
                entity: 'Invoice',
                entityId: invoice._id,
                note: `Invoice #${invoice.number} cancelled and reversed (Atomic)`
            }, session);

            return { success: true };
        });
    }
};



