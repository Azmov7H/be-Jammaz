import express from 'express';
import { AccountingService } from '../services/accountingService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

// Get Ledger
router.get('/ledger', routeHandler(async (req) => {
    const { account, startDate, endDate } = req.query;
    return await AccountingService.getLedger(account, startDate, endDate);
}));

// Get Trial Balance
router.get('/trial-balance', routeHandler(async (req) => {
    const { date } = req.query;
    return await AccountingService.getTrialBalance(date ? new Date(date) : new Date());
}));

// Get Entries
router.get('/entries', routeHandler(async (req) => {
    const { startDate, endDate, type, account, limit } = req.query;
    return await AccountingService.getEntries({ startDate, endDate, type, account, limit });
}));

// Manual Entry (Expense)
router.post('/entries/expense', routeHandler(async (req) => {
    const { amount, category, description, date } = req.body;
    return await AccountingService.createExpenseEntry(amount, category, description, req.user._id, date ? new Date(date) : new Date());
}));

// Manual Entry (Income)
router.post('/entries/income', routeHandler(async (req) => {
    const { amount, description, date } = req.body;
    return await AccountingService.createIncomeEntry(amount, description, req.user._id, date ? new Date(date) : new Date());
}));

export default router;
