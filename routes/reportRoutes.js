import express from 'express';
import { DashboardService } from '../services/dashboardService.js';
import { ReportingService } from '../services/reportingService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

// Consolidated dashboard endpoint - returns all data in one call
router.get('/dashboard', routeHandler(async (req) => {
    // Use getUnifiedData which combines getKPIs, getStats, and getStrategy
    return await DashboardService.getUnifiedData();
}));

router.get('/dashboard/stats', routeHandler(async (req) => {
    return await DashboardService.getStats();
}));

router.get('/dashboard/kpis', routeHandler(async (req) => {
    return await DashboardService.getKPIs();
}));

router.get('/dashboard/strategy', routeHandler(async (req) => {
    return await DashboardService.getStrategy();
}));

import { DailySalesService } from '../services/dailySalesService.js';

router.get('/reports/sales', routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    return await DailySalesService.getSalesSummary(
        startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30)),
        endDate ? new Date(endDate) : new Date()
    );
}));

router.get('/reports/shortage', routeHandler(async (req) => {
    const { status } = req.query;
    return await ReportingService.getShortageReports(status === 'ALL' ? null : status);
}));


router.get('/reports/inventory', routeHandler(async (req) => {
    return await ReportingService.getInventoryReport();
}));

router.get('/reports/financial', routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    return await ReportingService.getFinancialReport(startDate, endDate);
}));

router.get('/reports/customer-profit', routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    return await ReportingService.getCustomerProfitReport(startDate, endDate);
}));

router.get('/reports/price-history', routeHandler(async (req) => {
    const { productId } = req.query;
    return await ReportingService.getPriceHistory(productId);
}));

router.get('/reports/price-history/:productId', routeHandler(async (req) => {
    return await ReportingService.getPriceHistory(req.params.productId);
}));

export default router;
