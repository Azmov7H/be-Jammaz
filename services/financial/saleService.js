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
                const remainingDebt = invoice.total - invoice.paidAmount;
                if (remainingDebt > 0) {
                    const settings = await InvoiceSettings.getSettings();
                    const defaultDays = settings.defaultCustomerTerms || 15;

                    await DebtService.createDebt({
                        debtorType: 'Customer',
                        debtorId: invoice.customer,
                        amount: remainingDebt,
                        dueDate: invoice.dueDate || new Date(Date.now() + defaultDays * 24 * 60 * 60 * 1000),
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
        await dbConnect();
        try {
            const invoice = await Invoice.findById(invoiceId).populate('items.productId');
            if (!invoice) throw new Error('الفاتورة غير موجودة');

            // 1. Reverse Stock
            for (const item of invoice.items) {
                if (item.isService || !item.productId) continue;

                const product = await Product.findById(item.productId);
                if (product) {
                    product.shopQty += item.qty;
                    product.stockQty = (product.warehouseQty || 0) + product.shopQty;
                    await product.save();

                    const StockMovement = (await import('../../models/StockMovement.js')).default;
                    await StockMovement.create([{
                        productId: product._id,
                        type: 'IN',
                        qty: item.qty,
                        note: `إلغاء فاتورة #${invoice.number}`,
                        refId: invoice._id,
                        createdBy: userId,
                        snapshot: {
                            warehouseQty: product.warehouseQty,
                            shopQty: product.shopQty
                        }
                    }]);
                }
            }

            // 2. Reverse Treasury Transactions
            await TreasuryService.deleteTransactionByRef('Invoice', invoice._id);

            // 3. Update Customer Balance & Debt
            if (invoice.customer) {
                const remainingDebt = invoice.total - invoice.paidAmount;
                if (remainingDebt > 0) {
                    const Debt = (await import('../../models/Debt.js')).default;
                    const debt = await Debt.findOne({ referenceType: 'Invoice', referenceId: invoice._id });
                    if (debt) {
                        await DebtService.deleteDebt(debt._id);
                    }
                }
            }

            // 4. Delete Invoice
            await invoice.deleteOne();

            // 5. Logging
            await LogService.logAction({
                userId,
                action: 'REVERSE_INVOICE',
                entity: 'Invoice',
                entityId: invoice._id,
                note: `Invoice #${invoice.number} cancelled and reversed`
            });

            return { success: true };
        } catch (error) {
            throw error;
        }
    }
};



