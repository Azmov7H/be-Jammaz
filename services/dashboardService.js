import dbConnect from '../lib/db.js';
import Product from '../models/Product.js';
import Invoice from '../models/Invoice.js';
import StockMovement from '../models/StockMovement.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import TreasuryTransaction from '../models/TreasuryTransaction.js';
import { TreasuryService } from '../services/treasuryService.js';
import { createTTLCache } from '../lib/ttlCache.js';
import { startOfDay, startOfMonth, startOfWeek, endOfDay, subMonths } from 'date-fns';

// T-PERF-02: short-TTL dashboard cache keyed per role scope.
// Invalidation = TTL expiry only (no event invalidation needed at this
// horizon). Set DASHBOARD_CACHE_TTL=0 to disable.
const DASHBOARD_CACHE_TTL_S = parseInt(process.env.DASHBOARD_CACHE_TTL ?? '30', 10);
const kpiCache = createTTLCache(Math.max(0, DASHBOARD_CACHE_TTL_S) * 1000);
const statsCache = createTTLCache(Math.max(0, DASHBOARD_CACHE_TTL_S) * 1000);

// Role scope buckets — cache keys never cross these lines even though the
// payloads currently coincide; future role-scoped filtering stays safe.
function roleScope(role) {
    return ['owner', 'manager'].includes(role) ? 'privileged' : 'staff';
}

// exported for deterministic test control (clear between scenarios)
export const __dashboardCaches = { kpiCache, statsCache };

export const DashboardService = {
    async getKPIs(role = 'viewer') {
        const cacheKey = `kpis:${roleScope(role)}`;
        if (DASHBOARD_CACHE_TTL_S > 0) {
            const hit = kpiCache.get(cacheKey);
            if (hit) return hit;
        }
        const result = await this._computeKPIs();
        if (DASHBOARD_CACHE_TTL_S > 0) kpiCache.set(cacheKey, result);
        return result;
    },

    async _computeKPIs() {
        await dbConnect();
        const now = new Date();
        const todayStart = startOfDay(now);
        const todayEnd = endOfDay(now);
        const monthStart = startOfMonth(now);

        // T-PERF-02: today+month merged into single faceted scans (was 4).
        const [
            invoiceWindows,
            expenseWindows,
            financials,
            inventoryStats,
            pendingPOsCount,
            recentActivity
        ] = await Promise.all([
            Invoice.aggregate([
                { $match: { date: { $gte: monthStart } } },
                { $facet: {
                    today: [
                        { $match: { date: { $gte: todayStart, $lte: todayEnd } } },
                        { $group: {
                            _id: null,
                            sales: { $sum: "$total" },
                            profit: { $sum: { $subtract: ["$total", "$totalCost"] } }, // Assuming totalCost is reliable
                            grossProfit: { $sum: "$profit" }, // If profit field exists
                            count: { $sum: 1 }
                        } }
                    ],
                    month: [
                        { $group: {
                            _id: null,
                            sales: { $sum: "$total" },
                            grossProfit: { $sum: "$profit" },
                            count: { $sum: 1 }
                        } }
                    ]
                } }]),
            TreasuryTransaction.aggregate([
                { $match: { type: 'EXPENSE', referenceType: 'Manual', date: { $gte: monthStart } } },
                { $facet: {
                    today: [
                        { $match: { date: { $gte: todayStart, $lte: todayEnd } } },
                        { $group: { _id: null, total: { $sum: "$amount" } } }
                    ],
                    month: [
                        { $group: { _id: null, total: { $sum: "$amount" } } }
                    ]
                } }]),
            // Financials (Receivables & Payables & Cash)
            Promise.all([
                Customer.aggregate([{ $match: { balance: { $ne: 0 } } }, { $group: { _id: null, total: { $sum: "$balance" } } }]),
                Supplier.aggregate([{ $match: { balance: { $ne: 0 } } }, { $group: { _id: null, total: { $sum: "$balance" } } }]),
                TreasuryService.getCurrentBalance()
            ]),
            // Inventory Stats
            Product.aggregate([
                {
                    $group: {
                        _id: null,
                        totalStockValue: { $sum: { $multiply: ["$stockQty", "$buyPrice"] } },
                        lowStockCount: {
                            $sum: { $cond: [{ $and: [{ $gt: ["$stockQty", 0] }, { $lte: ["$stockQty", "$minLevel"] }] }, 1, 0] }
                        },
                        outOfStockCount: {
                            $sum: { $cond: [{ $eq: ["$stockQty", 0] }, 1, 0] }
                        }
                    }
                }
            ]),
            PurchaseOrder.countDocuments({ status: { $ne: 'RECEIVED' } }),
            Invoice.find().sort({ date: -1 }).limit(5).lean().select('number total date customerName')
        ]);

        const tStats = invoiceWindows[0]?.today?.[0] || { sales: 0, profit: 0, grossProfit: 0, count: 0 };
        const mStats = invoiceWindows[0]?.month?.[0] || { sales: 0, grossProfit: 0, count: 0 };
        const tExp = expenseWindows[0]?.today?.[0]?.total || 0;
        const mExp = expenseWindows[0]?.month?.[0]?.total || 0;
        const invStats = inventoryStats[0] || { totalStockValue: 0, lowStockCount: 0, outOfStockCount: 0 };

        const [receivablesRes, payablesRes, cashBalance] = financials;
        const totalReceivables = receivablesRes[0]?.total || 0;
        const totalPayables = payablesRes[0]?.total || 0;

        // Fetch low stock products separately (small limit)
        const lowStockProducts = await Product.find(
            { $expr: { $lte: ["$stockQty", "$minLevel"] } }
        ).select('name stockQty minLevel images').limit(5).lean();

        return {
            kpis: {
                todaySales: tStats.sales,
                todayProfit: (tStats.grossProfit || 0) - tExp, // Net Profit
                todayGrossProfit: tStats.grossProfit || 0,
                todayExpenses: tExp,
                todayInvoices: tStats.count,
                cashBalance: cashBalance || 0,
                totalStockValue: invStats.totalStockValue,
                lowStockCount: invStats.lowStockCount,
                outOfStockCount: invStats.outOfStockCount,
                totalReceivables,
                totalPayables,
                pendingPOs: pendingPOsCount
            },
            monthSummary: {
                totalRevenue: mStats.sales,
                totalProfit: (mStats.grossProfit || 0) - mExp,
                totalExpenses: mExp,
                totalInvoices: mStats.count
            },
            recentActivity,
            lowStockProducts
        };
    },

    async getStats() {
        await dbConnect();

        const [
            productsCount,
            lowStockCount,
            invoicesCount,
            totalSalesResult,
            recentInvoices,
            topSellingProducts,
            monthlySales
        ] = await Promise.all([
            Product.countDocuments(),
            Product.countDocuments({ $expr: { $lte: ["$stockQty", "$minLevel"] } }),
            Invoice.countDocuments(),
            Invoice.aggregate([{ $group: { _id: null, total: { $sum: "$total" } } }]),
            Invoice.find().sort({ createdAt: -1 }).limit(5).populate('createdBy', 'name'),
            StockMovement.aggregate([
                { $match: { type: 'SALE' } },
                { $group: { _id: "$productId", totalQty: { $sum: "$quantity" } } },
                { $sort: { totalQty: -1 } },
                { $limit: 5 },
                { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "product" } },
                { $unwind: "$product" },
                { $project: { name: "$product.name", totalQty: 1 } }
            ]),
            Invoice.aggregate([
                { $match: { date: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 6)) } } },
                { $group: { _id: { $month: "$date" }, sales: { $sum: "$total" } } },
                { $sort: { "_id": 1 } }
            ])
        ]);

        const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
        const chartData = monthlySales.map(item => ({
            name: months[item._id - 1],
            sales: item.sales
        }));

        return {
            stats: {
                products: productsCount,
                lowStock: lowStockCount,
                invoices: invoicesCount,
                sales: totalSalesResult[0]?.total || 0,
            },
            chartData: chartData.length > 0 ? chartData : [{ name: 'لا يوجد بيانات', sales: 0 }],
            topSelling: topSellingProducts,
            recentInvoices
        };
    },

    async getStrategy() {
        await dbConnect();

        // 1. Bundle Suggestions (Optimized with Aggregation)
        // We look for invoices with > 1 item, unwind, self-lookup to find pairs
        // Note: Full pair mining is heavy in Mongo too, so we limit to recent 1000 invoices and simplify.
        // A simpler approach for Vercel Free: Just find top selling products and suggest random pairs or 
        // rely on a pre-calculated collection.
        // For now, let's just get top 2 selling products and suggest them.

        // T-PERF-02: one scan serves both bundle + ABC suggestions (was 2)
        const fastMovers = await StockMovement.aggregate([
            { $match: { type: 'SALE' } },
            { $group: { _id: "$productId", totalQty: { $sum: "$quantity" } } },
            { $sort: { totalQty: -1 } },
            { $limit: 5 },
            { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "product" } },
            { $unwind: "$product" }
        ]);
        const topSelling = fastMovers.slice(0, 2);

        const bundleSuggestions = [];
        if (topSelling.length >= 2) {
            const p1 = topSelling[0].product;
            const p2 = topSelling[1].product;
            bundleSuggestions.push({
                title: 'اقتراح حزمة منتجات (Best Sellers)',
                desc: `المنتجات "${p1.name}" و "${p2.name}" هي الأكثر مبيعاً. قم بعمل عرض خاص عند شرائهما معاً لزيادة المبيعات.`,
                impact: 'عالي',
                type: 'bundle'
            });
        }

        // 2. ABC Analysis (Optimized)
        // Instead of fetching all products + all invoices, let's just use the 'sales' field if we had it.
        // Since we don't track total sales in Product, we rely on StockMovement for velocity.

        const abcSuggestion = {
            title: 'تحليل ABC للمخزون (Top Sellers)',
            desc: `أهم المنتجات لديك حالياً: ${fastMovers.map(i => i.product.name).join('، ')}. حافظ على توفرها.`,
            impact: 'عالي',
            type: 'abc'
        };

        // Slow movers? Products created > 1 month ago with 0 movements in last month?
        // That's complex query. Let's just pick random low stock items for reorder as a placeholder for "optimization" 
        // or finding products with high stock but low sales (requires sophisticated query).
        // For speed, we will skip the complex "Anti-join" for slow movers in this iteration.

        return {
            suggestions: [...bundleSuggestions, abcSuggestion],
            stats: {
                bundleCount: bundleSuggestions.length,
                abcReady: true
            }
        };
    },

    async getUnifiedData(role = 'viewer') {
        const cacheKey = `unified:${roleScope(role)}`;
        if (DASHBOARD_CACHE_TTL_S > 0) {
            const hit = kpiCache.get(cacheKey);
            if (hit) return hit;
        }
        const [kpiData, statsData, strategyData] = await Promise.all([
            this.getKPIs(role),
            this.getStats(),
            this.getStrategy()
        ]);
        const unified = {
            ...kpiData,
            ...statsData,
            strategy: strategyData
        };
        if (DASHBOARD_CACHE_TTL_S > 0) kpiCache.set(cacheKey, unified);
        return unified;
    }
};



