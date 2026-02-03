import express from 'express';
import { TreasuryService } from '../services/treasuryService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

// Get current treasury balance
router.get('/balance', routeHandler(async () => {
    return await TreasuryService.getCurrentBalance();
}));

// Get treasury summary (balance, income, expense)
router.get('/summary', routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    return await TreasuryService.getSummary(startDate, endDate);
}));

// Get daily cashbox
router.get('/daily', routeHandler(async (req) => {
    const { date } = req.query;
    return await TreasuryService.getDailyCashbox(date || new Date());
}));

// Reconcile cashbox
router.post('/reconcile', roleMiddleware(['admin', 'manager']), routeHandler(async (req) => {
    const { date, actualClosingBalance, notes } = req.body;
    return await TreasuryService.reconcileCashbox(date || new Date(), actualClosingBalance, req.user._id, notes);
}));

// Get transactions history
router.get('/transactions', routeHandler(async (req) => {
    const { startDate, endDate, type } = req.query;
    return await TreasuryService.getTransactions(
        startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30)),
        endDate ? new Date(endDate) : new Date(),
        type
    );
}));

// Add manual income
router.post('/manual-income', routeHandler(async (req) => {
    const { amount, reason, date } = req.body;
    return await TreasuryService.addManualIncome(date || new Date(), amount, reason, req.user._id);
}));

// Add manual expense
router.post('/manual-expense', routeHandler(async (req) => {
    const { amount, reason, category, date } = req.body;
    return await TreasuryService.addManualExpense(date || new Date(), amount, reason, category, req.user._id);
}));

// Undo a manual transaction
router.delete('/transactions/:id', roleMiddleware(['admin']), routeHandler(async (req) => {
    return await TreasuryService.undoTransaction(req.params.id, req.user._id);
}));

export default router;
