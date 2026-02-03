import Customer from '../models/Customer.js';
import { CACHE_TAGS } from '../lib/cache.js';
import dbConnect from '../lib/db.js';

export const CustomerService = {
    async getAll({ page = 1, limit = 20, search }) {
        await dbConnect();

        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        // Use standard pagination
        const skip = (page - 1) * limit;
        const [customers, total] = await Promise.all([
            Customer.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            Customer.countDocuments(query)
        ]);

        return {
            customers,
            pagination: {
                total,
                pages: Math.ceil(total / limit),
                page: Number(page),
                limit: Number(limit)
            }
        };
    },

    async getById(id) {
        await dbConnect();
        const customer = await Customer.findById(id).lean();
        if (!customer) throw 'Customer not found';
        return customer;
    },

    async create(data) {
        await dbConnect();

        // Extract opening balance data
        const { openingBalance, openingBalanceType, ...customerData } = data;

        const existing = await Customer.findOne({ phone: customerData.phone });
        if (existing) {
            throw 'رقم الهاتف مستخدم بالفعل لعميل آخر';
        }

        // Initialize credit balance (pre-paid)
        let initialCreditBalance = 0;
        if (openingBalance && openingBalance > 0 && openingBalanceType === 'credit') {
            initialCreditBalance = parseFloat(openingBalance);
        }

        const customer = await Customer.create({
            ...customerData,
            balance: 0,
            creditBalance: initialCreditBalance
        });

        // Handle Opening Balance Effects
        if (openingBalance && openingBalance > 0) {
            const AccountingEntry = (await import('../models/AccountingEntry.js')).default;
            const { DebtService } = await import('../services/financial/debtService.js');

            if (openingBalanceType === 'debit') {
                // Customer owes us (Debit)
                // 1. Create Debt Record (Handles Customer Balance Update)
                await DebtService.createDebt({
                    debtorType: 'Customer',
                    debtorId: customer._id,
                    amount: parseFloat(openingBalance),
                    dueDate: new Date(),
                    referenceType: 'Manual',
                    referenceId: customer._id,
                    description: 'رصيد افتتاحي (مديونية سابقة)'
                });

                // 2. Create Accounting Entry
                await AccountingEntry.createEntry({
                    type: 'ADJUSTMENT',
                    debitAccount: 'Accounts Receivable', // Or specific Customer Account? Usually AR.
                    creditAccount: 'Opening Balance Equity',
                    amount: initialBalance,
                    description: `رصيد افتتاحي للعميل: ${customer.name}`,
                    refType: 'Manual',
                    refId: customer._id
                });

            } else {
                // We owe customer (Credit)
                await AccountingEntry.createEntry({
                    type: 'ADJUSTMENT',
                    debitAccount: 'Opening Balance Equity',
                    creditAccount: 'Accounts Payable', // technically Customer Deposits/Credit
                    amount: initialCreditBalance,
                    description: `رصيد افتتاحي دائن للعميل: ${customer.name}`,
                    refType: 'Manual',
                    refId: customer._id
                });
            }
        }

        return customer;
    },

    async update(id, data) {
        await dbConnect();

        if (data.phone) {
            const existing = await Customer.findOne({ phone: data.phone, _id: { $ne: id } });
            if (existing) throw 'رقم الهاتف مستخدم بالفعل لعميل آخر';
        }

        const customer = await Customer.findByIdAndUpdate(id, data, { new: true });
        if (!customer) throw 'Customer not found';

        return customer;
    },

    async delete(id) {
        await dbConnect();

        const customer = await Customer.findById(id);
        if (!customer) throw 'Customer not found';

        // Check if customer has any invoices or debts before deleting
        const Invoice = (await import('../models/Invoice.js')).default;
        const Debt = (await import('../models/Debt.js')).default;

        const [hasInvoices, hasDebts] = await Promise.all([
            Invoice.exists({ customer: id }),
            Debt.exists({ debtorId: id, debtorType: 'Customer' })
        ]);

        if (hasInvoices || hasDebts) {
            throw 'لا يمكن حذف العميل لوجود معاملات مالية أو فواتير مرتبطة به. يمكنك إيقاف تنشيطه بدلاً من ذلك.';
        }

        await Customer.findByIdAndDelete(id);

        return { message: 'Customer deleted permanently' };
    },

    async getStatement(id, { startDate, endDate }) {
        await dbConnect();

        const customer = await Customer.findById(id).select('name phone balance creditBalance openBalance');
        if (!customer) throw 'Customer not found';

        const Invoice = (await import('../models/Invoice.js')).default;
        const TreasuryTransaction = (await import('../models/TreasuryTransaction.js')).default;

        // Date Filter
        const dateQuery = {};
        if (startDate || endDate) {
            dateQuery.date = {};
            if (startDate) dateQuery.date.$gte = new Date(startDate);
            if (endDate) dateQuery.date.$lte = new Date(endDate);
        }

        // 1. Get Invoices (Debits)
        const invoices = await Invoice.find({
            customer: id,
            ...dateQuery
        }).select('number date total type status paymentStatus').lean();

        // 2. Get Payments/Transactions (Credits)
        // We look for transactions linked to this customer OR their invoices
        // Since TreasuryTransaction stores referenceId, we might need to look up invoice IDs first if we want strict linking,
        // but typically payments are linked to Debt or Invoice.
        // For simplified statement, we look for direct customer transactions or those linked to their invoices.

        const transactions = await TreasuryTransaction.find({
            $or: [
                { partnerId: id }, // Direct link
                { referenceType: 'Invoice', referenceId: { $in: invoices.map(i => i._id) } },
                { referenceType: 'Customer', referenceId: id } // Some legacy might use referenceId as customerId directly
            ],
            ...dateQuery
        }).sort({ date: 1 }).lean();

        // 3. Merge and Sort
        const statementItems = [
            ...invoices.map(inv => ({
                id: inv._id,
                referenceId: inv._id,
                date: inv.date,
                type: 'SALES',
                reference: inv.number,
                label: `فاتورة مبيعات #${inv.number}`,
                description: `فاتورة مبيعات #${inv.number}`,
                debit: inv.total,
                credit: 0
            })),
            ...transactions.map(tx => ({
                id: tx._id,
                referenceId: tx._id,
                date: tx.date,
                type: tx.type === 'INCOME' ? 'PAYMENT' : 'REFUND',
                reference: tx.receiptNumber || '-',
                label: tx.type === 'INCOME' ? 'تحصيل نقدي' : 'صرف نقدي (مرتجع)',
                description: tx.description,
                // If Type is EXPENSE (We paid money/Refund), it's a DEBIT? Or Credit Reversal?
                // Usually Refund is Credit note. 
                // Let's assume INCOME = Credit, EXPENSE = Debit (e.g. we paid him for returned goods in cash).
                credit: tx.type === 'INCOME' ? tx.amount : 0,
                debit: tx.type === 'EXPENSE' ? tx.amount : 0
            }))
        ].sort((a, b) => new Date(a.date) - new Date(b.date));

        // 4. Calculate Running Balance
        let runningBalance = customer.openBalance || 0; // Start with opening balance if tracked separate, or 0
        // Actually, 'balance' field in Customer is the current snapshot.
        // To get point-in-time balance, we'd need to calculate backwards or forwards.
        // For simplicity in this iteration, we start from 0 + (everything before startDate) if we want strict period.
        // But for "Get Statement" usually it shows the activity.

        // Let's just run through the list.
        const decoratedItems = statementItems.map(item => {
            runningBalance += (item.debit - item.credit);
            return { ...item, balance: runningBalance };
        });

        return {
            customer: {
                id: customer._id,
                name: customer.name,
                currentBalance: customer.balance
            },
            period: { startDate, endDate },
            transactions: decoratedItems,
            summary: {
                totalDebits: decoratedItems.reduce((sum, item) => sum + item.debit, 0),
                totalCredits: decoratedItems.reduce((sum, item) => sum + item.credit, 0),
                closingBalance: runningBalance
            }
        };
    }
};
