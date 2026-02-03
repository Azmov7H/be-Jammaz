import dbConnect from '../lib/db.js';
import AccountingEntry from '../models/AccountingEntry.js';
import Invoice from '../models/Invoice.js';
import ShortageReport from '../models/ShortageReport.js';
import PriceHistory from '../models/PriceHistory.js';
import { ACCOUNTS } from '../services/accountingService.js';
import { NotificationService } from '../services/notificationService.js';

const expenseAccountsList = [
    ACCOUNTS.COGS,
    ACCOUNTS.RENT_EXPENSE,
    ACCOUNTS.UTILITIES_EXPENSE,
    ACCOUNTS.SALARIES_EXPENSE,
    ACCOUNTS.SUPPLIES_EXPENSE,
    ACCOUNTS.OTHER_EXPENSE,
    ACCOUNTS.SHORTAGE_EXPENSE,
    ACCOUNTS.SALES_RETURNS
];

export const ReportingService = {
    /**
     * Financial Profit & Loss Report
     */
    async getFinancialReport(startDate, endDate) {
        await dbConnect();

        // Run both aggregations in parallel to reduce execution time
        const [revenueEntries, expenseEntries] = await Promise.all([
            // Revenue (Credits)
            AccountingEntry.aggregate([
                {
                    $match: {
                        date: { $gte: startDate, $lte: endDate },
                        creditAccount: { $in: [ACCOUNTS.SALES_REVENUE, ACCOUNTS.OTHER_INCOME, ACCOUNTS.SURPLUS_INCOME] }
                    }
                },
                {
                    $group: {
                        _id: '$creditAccount',
                        total: { $sum: '$amount' }
                    }
                }
            ]),

            // Expenses (Debits)
            AccountingEntry.aggregate([
                {
                    $match: {
                        date: { $gte: startDate, $lte: endDate },
                        debitAccount: { $in: expenseAccountsList }
                    }
                },
                {
                    $group: {
                        _id: '$debitAccount',
                        total: { $sum: '$amount' }
                    }
                }
            ])
        ]);

        const revenueMap = revenueEntries.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.total }), {});
        const expenseMap = expenseEntries.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.total }), {});

        const totalRevenue = Object.values(revenueMap).reduce((a, b) => a + b, 0);
        const cogs = expenseMap[ACCOUNTS.COGS] || 0;
        const grossProfit = totalRevenue - cogs;

        const operatingExpenses = expenseAccountsList
            .filter(acc => acc !== ACCOUNTS.COGS)
            .reduce((sum, acc) => sum + (expenseMap[acc] || 0), 0);

        const netProfit = grossProfit - operatingExpenses;

        return {
            period: { startDate, endDate },
            financials: {
                revenue: { total: totalRevenue, breakdown: revenueMap },
                cogs,
                grossProfit,
                operatingExpenses: {
                    total: operatingExpenses,
                    breakdown: Object.fromEntries(Object.entries(expenseMap).filter(([k]) => k !== ACCOUNTS.COGS))
                },
                netProfit
            }
        };
    },

    /**
     * Customer Profitability Report
     */
    async getCustomerProfitReport(startDate, endDate) {
        await dbConnect();

        const dateQuery = {};
        if (startDate && endDate) {
            dateQuery.date = { $gte: startDate, $lte: endDate };
        }

        const report = await Invoice.aggregate([
            { $match: dateQuery },
            {
                $group: {
                    _id: '$customer',
                    totalRevenue: { $sum: '$total' },
                    totalProfit: { $sum: '$profit' },
                    invoiceCount: { $sum: 1 }
                }
            },
            {
                $lookup: {
                    from: 'customers',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'customerDetails'
                }
            },
            { $unwind: '$customerDetails' },
            {
                $project: {
                    _id: 1,
                    customerName: '$customerDetails.name',
                    totalRevenue: 1,
                    totalProfit: 1,
                    invoiceCount: 1,
                    profitMargin: {
                        $cond: [
                            { $eq: ['$totalRevenue', 0] },
                            0,
                            { $multiply: [{ $divide: ['$totalProfit', '$totalRevenue'] }, 100] }
                        ]
                    }
                }
            },
            { $sort: { totalProfit: -1 } }
        ]);

        return report;
    },

    /**
     * Shortage Reports
     */
    async getShortageReports(status) {
        await dbConnect();
        const query = {};
        if (status) query.status = status;

        return await ShortageReport.find(query).sort({ createdAt: -1 }).limit(50).lean();
    },

    /**
     * Create Shortage Report
     */
    async createShortageReport(data, userId, userName) {
        await dbConnect();
        const report = await ShortageReport.create({
            ...data,
            requester: userId,
            requesterName: userName
        });

        // Trigger Notification
        await NotificationService.create({
            title: `بلاغ نقص: ${data.productName}`,
            message: `قام ${userName} بالإبلاغ عن نقص في ${data.productName}. الكمية المطلوبة: ${data.requestedQty}. الملاحظات: ${data.notes || 'لا يوجد'}`,
            type: 'business',
            severity: 'warning',
            source: 'InventoryService',
            targetRole: 'manager',
            link: '/reports/shortage',
            deduplicationKey: `shortage_${data.product}_${Date.now()}`, // Unique enough
            metadata: { reportId: report._id, productId: data.product }
        });

        return report;
    },

    /**
     * Price History
     */
    async getPriceHistory(productId, limit = 50) {
        await dbConnect();
        const query = {};
        if (productId) query.productId = productId;

        return await PriceHistory.find(query)
            .sort({ date: -1 })
            .limit(limit)
            .populate('productId', 'name code')
            .populate('changedBy', 'name')
            .lean();
    },

    /**
     * Debt Maturity & Cash Flow Projection
     */
    async getDebtMaturityReport() {
        await dbConnect();
        const { default: PaymentSchedule } = await import('../models/PaymentSchedule.js');

        const now = new Date();
        const thirtyDays = new Date();
        thirtyDays.setDate(thirtyDays.getDate() + 30);
        const sixtyDays = new Date();
        sixtyDays.setDate(sixtyDays.getDate() + 60);

        return await PaymentSchedule.aggregate([
            {
                $match: {
                    status: { $in: ['PENDING', 'OVERDUE'] }
                }
            },
            {
                $project: {
                    amount: 1,
                    entityType: 1,
                    dueDate: 1,
                    range: {
                        $cond: [
                            { $lt: ['$dueDate', now] }, 'overdue',
                            {
                                $cond: [
                                    { $lte: ['$dueDate', thirtyDays] }, '0-30',
                                    { $cond: [{ $lte: ['$dueDate', sixtyDays] }, '31-60', '61+'] }
                                ]
                            }
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: { range: '$range', type: '$entityType' },
                    total: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: '$_id.range',
                    breakdown: {
                        $push: {
                            type: '$_id.type',
                            amount: '$total',
                            count: '$count'
                        }
                    },
                    total: { $sum: '$total' }
                }
            },
            { $sort: { _id: 1 } }
        ]);
    }
};



