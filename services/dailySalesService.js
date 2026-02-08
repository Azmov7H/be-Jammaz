import DailySales from '../models/DailySales.js';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import { toIdString } from '../utils/idUtils.js';

/**
 * Daily Sales Tracking Service
 * Handles daily sales summary calculations
 */
export const DailySalesService = {
    /**
     * Update daily sales summary when invoice is created
     */
    async updateDailySales(invoice, userId, session = null) {
        const startOfDay = new Date(invoice.date);
        startOfDay.setHours(0, 0, 0, 0);

        // Find or create daily sales record
        let dailySales = await DailySales.findOne({ date: startOfDay }).session(session);

        if (!dailySales) {
            const created = await DailySales.create([{
                date: startOfDay,
                totalRevenue: 0,
                totalCost: 0,
                invoiceCount: 0,
                itemsSold: 0,
                cashReceived: 0,
                invoices: [],
                topProducts: []
            }], { session });
            dailySales = created[0];
        }

        // Update totals using pre-calculated values from invoice
        dailySales.totalRevenue += invoice.total;
        dailySales.totalCost += (invoice.totalCost || 0);

        for (const item of invoice.items) {
            dailySales.itemsSold += item.qty;

            // Update top products using item snapshot (skip service items/no productId)
            if (item.productId) {
                const existingProduct = dailySales.topProducts.find(
                    p => p.productId && p.productId.toString() === item.productId.toString()
                );

                if (existingProduct) {
                    existingProduct.quantitySold += item.qty;
                    existingProduct.revenue += item.total;
                } else {
                    dailySales.topProducts.push({
                        productId: item.productId,
                        name: item.productName || item.name || 'Product',
                        quantitySold: item.qty,
                        revenue: item.total
                    });
                }
            }
        }

        if (invoice.paymentType === 'credit') {
            dailySales.creditSales = (dailySales.creditSales || 0) + invoice.total;
        } else {
            dailySales.cashReceived += invoice.total;
        }

        dailySales.invoiceCount += 1;
        dailySales.invoices.push(invoice._id);

        // Sort top products by revenue
        dailySales.topProducts.sort((a, b) => b.revenue - a.revenue);
        // Keep only top 10
        dailySales.topProducts = dailySales.topProducts.slice(0, 10);

        dailySales.updatedBy = userId;
        await dailySales.save({ session });

        return dailySales;
    },

    /**
     * Get daily sales for a specific date
     */
    async getDailySales(date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        return await DailySales.findOne({ date: startOfDay })
            .populate('invoices')
            .populate('topProducts.productId', 'name code')
            .lean();
    },

    /**
     * Get sales summary for date range
     */
    async getSalesSummary(startDate, endDate) {
        const sales = await DailySales.find({
            date: {
                $gte: startDate,
                $lte: endDate
            }
        })
            .sort({ date: -1 })
            .lean();

        // Calculate totals
        const summary = {
            totalRevenue: 0,
            totalCost: 0,
            totalProfit: 0,
            totalInvoices: 0,
            totalItems: 0,
            dailyBreakdown: sales
        };

        sales.forEach(day => {
            summary.totalRevenue += (day.totalRevenue || 0);
            summary.totalCost += (day.totalCost || 0);
            summary.totalProfit += (day.grossProfit || 0);
            summary.totalInvoices += (day.invoiceCount || 0);
            summary.totalItems += (day.itemsSold || 0);
        });

        return summary;
    },

    /**
     * Get best selling products for date range
     */
    async getBestSellers(startDate, endDate, limit = 10) {
        const sales = await DailySales.find({
            date: {
                $gte: startDate,
                $lte: endDate
            }
        }).lean();

        const productMap = new Map();

        sales.forEach(day => {
            day.topProducts.forEach(product => {
                if (!product.productId) return;
                const key = toIdString(product.productId);
                if (productMap.has(key)) {
                    const existing = productMap.get(key);
                    existing.quantitySold += product.quantitySold;
                    existing.revenue += product.revenue;
                } else {
                    productMap.set(key, {
                        productId: product.productId,
                        name: product.name,
                        quantitySold: product.quantitySold,
                        revenue: product.revenue
                    });
                }
            });
        });

        const bestSellers = Array.from(productMap.values());
        bestSellers.sort((a, b) => b.revenue - a.revenue);

        return bestSellers.slice(0, limit);
    },
    /**
     * Reverse daily sales summary when invoice is cancelled
     */
    async reverseDailySales(invoice, userId, session = null) {
        const startOfDay = new Date(invoice.date);
        startOfDay.setHours(0, 0, 0, 0);

        const dailySales = await DailySales.findOne({ date: startOfDay }).session(session);
        if (!dailySales) return null;

        // Update totals
        dailySales.totalRevenue -= invoice.total;
        dailySales.totalCost -= (invoice.totalCost || 0);
        dailySales.invoiceCount -= 1;
        dailySales.itemsSold -= invoice.items.reduce((sum, item) => sum + item.qty, 0);

        // Remove invoice reference
        dailySales.invoices = dailySales.invoices.filter(id => id.toString() !== invoice._id.toString());

        // Reverse top products
        for (const item of invoice.items) {
            if (item.productId) {
                const pid = toIdString(item.productId);
                const existingProduct = dailySales.topProducts.find(
                    p => p.productId && toIdString(p.productId) === pid
                );

                if (existingProduct) {
                    existingProduct.quantitySold -= item.qty;
                    existingProduct.revenue -= item.total;

                    // Cleanup if quantity becomes 0 or less
                    if (existingProduct.quantitySold <= 0) {
                        dailySales.topProducts = dailySales.topProducts.filter(
                            p => toIdString(p.productId) !== pid
                        );
                    }
                }
            }
        }

        if (invoice.paymentType === 'credit') {
            dailySales.creditSales = (dailySales.creditSales || 0) - invoice.total;
        } else {
            dailySales.cashReceived -= invoice.total;
        }

        // Re-sort top products
        dailySales.topProducts.sort((a, b) => b.revenue - a.revenue);
        dailySales.updatedBy = userId;

        await dailySales.save({ session });
        return dailySales;
    },
};



