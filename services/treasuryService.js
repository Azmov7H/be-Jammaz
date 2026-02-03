import TreasuryTransaction from '../models/TreasuryTransaction.js';
import CashboxDaily from '../models/CashboxDaily.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import InvoiceSettings from '../models/InvoiceSettings.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Debt from '../models/Debt.js';
import SalesReturn from '../models/SalesReturn.js';

/**
 * Treasury/Cashbox Management Service
 * Handles all financial transactions and daily cashbox operations
 */
export const TreasuryService = {
    /**
     * Record income from a sale (invoice)
     */
    async recordSaleIncome(invoice, userId, session = null) {
        // Generate receipt number
        const receiptNumber = await this.getNextReceiptNumber(session);

        // Create treasury transaction
        const transaction = await TreasuryTransaction.create([{
            type: 'INCOME',
            receiptNumber,
            amount: invoice.total,
            description: `مبيعات - فاتورة #${invoice.number} (العميل: ${invoice.customerName || invoice.customer?.name || 'نقدي'})`,
            referenceType: 'Invoice',
            referenceId: invoice._id,
            partnerId: invoice.customer || invoice.customerId,
            date: invoice.date || new Date(),
            createdBy: userId
        }], { session });

        // Update daily cashbox only if it's a cash transaction
        if (invoice.paymentType === 'cash' || !invoice.paymentType) {
            await this.updateDailyCashbox(invoice.date || new Date(), {
                salesIncome: invoice.total
            }, session);
        }

        return transaction[0];
    },

    /**
     * Record collection of a payment for an invoice (Debt repayment)
     */
    async recordPaymentCollection(invoice, amount, userId, method = 'cash', note = '', meta = {}, session = null) {
        const methodLabel = method === 'bank' ? '(بنك)' : method === 'wallet' ? '(محفظة)' : '';
        const customerName = invoice.customer?.name || invoice.customerName || '';

        // Generate receipt number
        const receiptNumber = await this.getNextReceiptNumber(session);

        const transaction = await TreasuryTransaction.create([{
            type: 'INCOME',
            receiptNumber,
            amount: amount,
            description: `تحصيل دفعة - فاتورة #${invoice.number} - العميل: ${customerName} ${methodLabel} ${note ? `- ${note}` : ''}`,
            referenceType: 'Invoice',
            referenceId: invoice._id,
            partnerId: invoice.customer || invoice.customerId,
            date: new Date(),
            createdBy: userId,
            meta: meta
        }], { session });

        return transaction[0];
    },

    /**
     * Record Unified Collection (Payment against total balance)
     */
    async recordUnifiedCollection(customer, amount, userId, method = 'cash', note = '', meta = {}, session = null) {
        const methodLabel = method === 'bank' ? '(بنك)' : method === 'wallet' ? '(محفظة)' : '';

        // Generate receipt number
        const receiptNumber = await this.getNextReceiptNumber(session);

        const transaction = await TreasuryTransaction.create([{
            type: 'INCOME',
            receiptNumber,
            amount: amount,
            description: `تحصيل مجمع - ${customer.name} ${methodLabel} ${note ? `- ${note}` : ''}`,
            referenceType: 'UnifiedCollection',
            referenceId: customer._id,
            partnerId: customer._id,
            date: new Date(),
            createdBy: userId,
            meta: meta
        }], { session });

        // Update daily cashbox only if it's a cash transaction
        if (method === 'cash') {
            await this.updateDailyCashbox(new Date(), {
                salesIncome: amount
            }, session);
        }

        return transaction[0];
    },

    /**
     * Record a transaction (collection/payment) for a generic debt (Manual/Opening Balance)
     */
    async recordDebtTransaction(debtId, partnerId, amount, type, userId, description, method = 'cash', meta = {}, session = null) {
        let receiptNumber = null;
        if (type === 'INCOME') {
            receiptNumber = await this.getNextReceiptNumber(session);
        }

        const transaction = await TreasuryTransaction.create([{
            type: type, // 'INCOME' or 'EXPENSE'
            receiptNumber,
            amount: amount,
            description: description,
            referenceType: 'Debt',
            referenceId: debtId,
            partnerId: partnerId,
            date: new Date(),
            createdBy: userId,
            meta: meta
        }], { session });

        if (method === 'cash') {
            await this.updateDailyCashbox(new Date(), {
                [type === 'INCOME' ? 'salesIncome' : 'purchaseExpenses']: amount
            }, session);
        }

        return transaction[0];
    },

    /**
     * Record expense from a purchase
     */
    async recordPurchaseExpense(purchaseOrder, userId, session = null) {
        // Create treasury transaction
        const typeLabel = purchaseOrder.paymentType === 'wallet' ? '(محفظة)' :
            purchaseOrder.paymentType === 'bank' ? '(بنك)' : '';

        const transaction = await TreasuryTransaction.create([{
            type: 'EXPENSE',
            amount: purchaseOrder.totalCost,
            description: `مشتريات ${typeLabel} - أمر شراء #${purchaseOrder.poNumber} (المورد: ${purchaseOrder.supplier?.name || '---'})`,
            referenceType: 'PurchaseOrder',
            referenceId: purchaseOrder._id,
            partnerId: purchaseOrder.supplier,
            date: purchaseOrder.receivedDate || new Date(),
            createdBy: userId
        }], { session });

        // Update daily cashbox only if it's a cash transaction
        if (purchaseOrder.paymentType === 'cash' || !purchaseOrder.paymentType) {
            await this.updateDailyCashbox(purchaseOrder.receivedDate || new Date(), {
                purchaseExpenses: purchaseOrder.totalCost
            }, session);
        }

        return transaction[0];
    },

    /**
     * Record payment made to a supplier (Debt repayment)
     */
    async recordSupplierPayment(supplier, amount, poNumber, poId, userId, method = 'cash', note = '', meta = {}, session = null) {
        const methodLabel = method === 'bank' ? '(بنك)' : method === 'wallet' ? '(محفظة)' : '';
        const transaction = await TreasuryTransaction.create([{
            type: 'EXPENSE',
            amount: amount,
            description: `سداد للمورد: ${supplier?.name || '---'} - أمر #${poNumber} ${methodLabel} ${note ? `- ${note}` : ''}`,
            referenceType: 'PurchaseOrder',
            referenceId: poId,
            partnerId: supplier?._id || supplier,
            date: new Date(),
            createdBy: userId,
            meta: meta
        }], { session });

        // Update daily cashbox only if it's a cash transaction
        // (Assuming 'bank' and 'wallet' are handled in separate systems or the user wants them tracked differently)
        // If the user wants ALL recorded in CashboxDaily, remove the if check.
        // However, usually Cashbox is physical cash.
        if (method === 'cash') {
            await this.updateDailyCashbox(new Date(), {
                purchaseExpenses: amount
            }, session);
        }

        return transaction[0];
    },

    /**
     * Update daily cashbox summary
     */
    async updateDailyCashbox(date, updates, session = null) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        // Find or create daily cashbox record
        let cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);

        if (!cashbox) {
            // Get previous day's closing balance
            const yesterday = new Date(startOfDay);
            yesterday.setDate(yesterday.getDate() - 1);
            const previousDay = await CashboxDaily.findOne({ date: yesterday }).session(session);

            const created = await CashboxDaily.create([{
                date: startOfDay,
                openingBalance: previousDay?.closingBalance || 0,
                salesIncome: 0,
                purchaseExpenses: 0
            }], { session });
            cashbox = created[0];
        }

        // Update with increments
        if (updates.salesIncome) {
            cashbox.salesIncome += updates.salesIncome;
        }
        if (updates.purchaseExpenses) {
            cashbox.purchaseExpenses += updates.purchaseExpenses;
        }

        await cashbox.save({ session });
        return cashbox;
    },

    /**
     * Add manual income entry
     */
    async addManualIncome(date, amount, reason, userId, session = null) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        let cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);

        if (!cashbox) {
            const yesterday = new Date(startOfDay);
            yesterday.setDate(yesterday.getDate() - 1);
            const previousDay = await CashboxDaily.findOne({ date: yesterday }).session(session);

            const created = await CashboxDaily.create([{
                date: startOfDay,
                openingBalance: previousDay?.closingBalance || 0
            }], { session });
            cashbox = created[0];
        }

        await cashbox.addIncome(amount, reason, userId, session);

        // Also record in treasury transactions
        await TreasuryTransaction.create([{
            type: 'INCOME',
            amount,
            description: reason,
            referenceType: 'Manual',
            date: new Date(),
            createdBy: userId
        }], { session });

        return cashbox;
    },

    /**
     * Add manual expense entry
     */
    async addManualExpense(date, amount, reason, category, userId, session = null) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        let cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);

        if (!cashbox) {
            const yesterday = new Date(startOfDay);
            yesterday.setDate(yesterday.getDate() - 1);
            const previousDay = await CashboxDaily.findOne({ date: yesterday }).session(session);

            const created = await CashboxDaily.create([{
                date: startOfDay,
                openingBalance: previousDay?.closingBalance || 0
            }], { session });
            cashbox = created[0];
        }

        await cashbox.addExpense(amount, reason, category, userId, session);

        // Also record in treasury transactions
        await TreasuryTransaction.create([{
            type: 'EXPENSE',
            amount,
            description: reason,
            referenceType: 'Manual',
            date: new Date(),
            createdBy: userId
        }], { session });

        return cashbox;
    },

    /**
     * Record refund for Sales Return
     */
    async recordReturnRefund(salesReturn, amount, userId, session = null) {
        // Update daily cashbox
        await this.updateDailyCashbox(new Date(), {
            purchaseExpenses: 0 // We don't want to increment purchaseExpenses? Or maybe we do?
            // Actually CashboxDaily tracks 'manualExpenses' separately. 
            // Sales Refund is cash OUT.
            // If we don't have a specific field for it in CashboxDaily, we might need to put it in manualExpenses or just 'purchaseExpenses'
            // But 'purchaseExpenses' implies buying goods.
            // Let's treat it as a reduction of Sales Income?
            // CashboxDaily has 'salesIncome'.
        }, session);

        // Better: Update Cashbox directly to reduce Sales Income? 
        // Or add a new field 'returns'.
        // For simplicity/compatibility with existing CashboxDaily (which has salesIncome, purchaseExpenses, manualIncome, manualExpenses):
        // We will add it as a 'Manual Expense' BUT with a specific note, OR subtract from SalesIncome.
        // Subtracting from SalesIncome makes sense for "Net Sales" in Cashbox.

        await this.updateDailyCashbox(new Date(), {
            salesIncome: -amount // Negative income
        }, session);

        const transaction = await TreasuryTransaction.create([{
            type: 'EXPENSE',
            amount: amount,
            description: `استرداد نقدي - مرتجع #${salesReturn.returnNumber}`,
            referenceType: 'SalesReturn',
            referenceId: salesReturn._id,
            partnerId: salesReturn.customer,
            date: new Date(),
            createdBy: userId
        }], { session });

        return transaction[0];
    },

    /**
     * Reconcile daily cashbox
     */
    async reconcileCashbox(date, actualClosingBalance, userId, notes = '', session = null) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);

        if (!cashbox) {
            throw new Error('لم يتم العثور على سجل الخزينة لهذا اليوم');
        }

        await cashbox.reconcile(actualClosingBalance, userId, notes, session);

        return cashbox;
    },

    /**
     * Get current balance
     */
    async getCurrentBalance() {
        // Get latest cashbox record
        const latestCashbox = await CashboxDaily.findOne()
            .sort({ date: -1 })
            .lean();

        if (!latestCashbox) {
            return 0;
        }

        // If reconciled, use closing balance
        if (latestCashbox.isReconciled) {
            return latestCashbox.closingBalance;
        }

        // Otherwise calculate expected balance
        return latestCashbox.openingBalance + latestCashbox.netChange;
    },

    /**
     * Get cashbox for specific date
     */
    async getDailyCashbox(date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        return await CashboxDaily.findOne({ date: startOfDay })
            .populate('createdBy', 'name')
            .populate('reconciledBy', 'name')
            .lean();
    },

    /**
     * Get cashbox history for date range
     */
    async getCashboxHistory(startDate, endDate) {
        return await CashboxDaily.find({
            date: {
                $gte: startDate,
                $lte: endDate
            }
        })
            .sort({ date: -1 })
            .lean();
    },

    /**
     * Get all transactions for date range
     */
    async getTransactions(startDate, endDate, type = null, partnerId = null) {
        const query = {};

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        if (type && type !== 'ALL') {
            query.type = type;
        }

        if (partnerId) {
            query.partnerId = partnerId;
        }

        return await TreasuryTransaction.find(query)
            .sort({ date: -1 })
            .populate('createdBy', 'name')
            .populate({
                path: 'referenceId',
                options: { strictPopulate: false },
                populate: [
                    { path: 'customer', select: 'name phone', options: { strictPopulate: false } },
                    { path: 'supplier', select: 'name phone', options: { strictPopulate: false } },
                    { path: 'debtorId', select: 'name phone', options: { strictPopulate: false } }
                ]
            })
            .lean();
    },

    /**
     * Get treasury summary (balance, income, expense) for a period
     */
    async getSummary(startDate, endDate) {
        let periodStart = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 7));
        let periodEnd = endDate ? new Date(endDate) : new Date();

        // Ensure endDate covers the whole day
        periodEnd.setHours(23, 59, 59, 999);
        periodStart.setHours(0, 0, 0, 0);

        const transactions = await this.getTransactions(periodStart, periodEnd);

        // 1. Calculate totals for this period
        const totals = transactions.reduce((acc, tx) => {
            if (tx.type === 'INCOME') acc.income += tx.amount;
            if (tx.type === 'EXPENSE') acc.expense += tx.amount;
            return acc;
        }, { income: 0, expense: 0 });

        // 2. Calculate Profit from Invoices in this period (Sales only)
        const profitAgg = await Invoice.aggregate([
            { $match: { date: { $gte: periodStart, $lte: periodEnd }, status: { $ne: 'CANCELLED' } } },
            { $group: { _id: null, totalProfit: { $sum: '$profit' } } }
        ]);
        const salesProfit = profitAgg[0]?.totalProfit || 0;

        // 3. Calculate Total Outstanding Debt (Receivables from Customers)
        const debtAgg = await Debt.aggregate([
            { $match: { debtorType: 'Customer', status: { $in: ['active', 'overdue'] } } },
            { $group: { _id: null, total: { $sum: '$remainingAmount' } } }
        ]);
        const totalOutstandingDebt = debtAgg[0]?.total || 0;

        const currentBalance = await this.getCurrentBalance();

        return {
            balance: currentBalance,
            periodBalance: totals.income - totals.expense,
            totalIncome: totals.income,
            totalExpense: totals.expense,
            salesProfit: salesProfit,
            totalOutstandingDebt: totalOutstandingDebt,
            transactions
        };
    },

    /**
     * Undo/Reverse a manual transaction
     */
    async undoTransaction(transactionId, userId, session = null) {
        const transaction = await TreasuryTransaction.findById(transactionId).session(session);
        if (!transaction) throw new Error('المعاملة غير موجودة');

        // Allow reversing Invoice/PurchaseOrder/Manual
        // if (transaction.referenceType !== 'Manual') {
        //     throw new Error('يمكن التراجع عن المعاملات اليدوية فقط');
        // }

        // 1. Find and update CashboxDaily
        const startOfDay = new Date(transaction.date);
        startOfDay.setHours(0, 0, 0, 0);

        const cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);
        if (cashbox) {
            if (transaction.type === 'INCOME') {
                // Find and remove from manualIncome
                const index = cashbox.manualIncome.findIndex(mi =>
                    mi.amount === transaction.amount &&
                    mi.reason === transaction.description
                );
                if (index > -1) {
                    cashbox.manualIncome.splice(index, 1);
                } else {
                    // If not in manualIncome, it might be in salesIncome accumulator
                    // We should decrease salesIncome if it was a Sale
                    if (transaction.referenceType === 'Invoice') {
                        cashbox.salesIncome -= transaction.amount;
                    }
                }
            } else {
                // Find and remove from manualExpenses
                const index = cashbox.manualExpenses.findIndex(me =>
                    me.amount === transaction.amount &&
                    me.reason === transaction.description
                );
                if (index > -1) {
                    cashbox.manualExpenses.splice(index, 1);
                } else {
                    // Purchase Expenses accumulator
                    if (transaction.referenceType === 'PurchaseOrder') {
                        cashbox.purchaseExpenses -= transaction.amount;
                    }
                }
            }
            await cashbox.save({ session });
        }

        // 2. Delete the transaction record
        await transaction.deleteOne({ session });

        return { success: true };
    },

    /**
     * Delete transaction by Reference (e.g. when deleting a whole Invoice)
     */
    async deleteTransactionByRef(refType, refId, session = null) {
        const transactions = await TreasuryTransaction.find({ referenceType: refType, referenceId: refId }).session(session);

        for (const transaction of transactions) {
            // Revert Cashbox impact
            const startOfDay = new Date(transaction.date);
            startOfDay.setHours(0, 0, 0, 0);

            const cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);
            if (cashbox) {
                if (transaction.type === 'INCOME') {
                    // Check manual first
                    const mIdx = cashbox.manualIncome.findIndex(x => x.amount === transaction.amount && x.reason === transaction.description);
                    if (mIdx > -1) {
                        cashbox.manualIncome.splice(mIdx, 1);
                    } else if (cashbox.salesIncome >= transaction.amount) {
                        cashbox.salesIncome -= transaction.amount;
                    }
                } else if (transaction.type === 'EXPENSE') {
                    const mIdx = cashbox.manualExpenses.findIndex(x => x.amount === transaction.amount && x.reason === transaction.description);
                    if (mIdx > -1) {
                        cashbox.manualExpenses.splice(mIdx, 1);
                    } else if (cashbox.purchaseExpenses >= transaction.amount) {
                        cashbox.purchaseExpenses -= transaction.amount;
                    }
                }
                await cashbox.save({ session });
            }

            await transaction.deleteOne({ session });
        }
    },

    /**
     * Helper to get and increment the next receipt number
     */
    async getNextReceiptNumber(session = null) {
        // We use a simple incrementing number stored in InvoiceSettings
        const settings = await InvoiceSettings.findOneAndUpdate(
            { isActive: true },
            { $inc: { lastReceiptNumber: 1 } },
            {
                new: true,
                upsert: true,
                session
            }
        );

        return `REC-${settings.lastReceiptNumber}`;
    }
};



