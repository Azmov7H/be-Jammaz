import express from 'express';
import { DailySalesService } from '../services/dailySalesService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

// Get daily sales for a specific date
router.get('/', routeHandler(async (req) => {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    return await DailySalesService.getDailySales(targetDate);
}));

// Get sales summary for date range
router.get('/summary', routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();
    return await DailySalesService.getSalesSummary(start, end);
}));

// Get best sellers
router.get('/best-sellers', routeHandler(async (req) => {
    const { startDate, endDate, limit } = req.query;
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();
    return await DailySalesService.getBestSellers(start, end, parseInt(limit) || 10);
}));

export default router;
