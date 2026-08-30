import express from 'express';
import { TreasuryService } from '../services/treasuryService.js';
import { maskSourceInResult } from '../lib/pii.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../lib/validate.js';
import { reconcileSchema, manualIncomeSchema, expenseSchema, sourceRequiredRefine, sourceNumberSchema } from '../validations/index.js';
import { z } from 'zod';

const router = express.Router();

router.use(authMiddleware);

// Get current treasury balance
router.get('/balance', routeHandler(async () => {
    return await TreasuryService.getCurrentBalance();
}));

// Get treasury summary (balance, income, expense)
router.get('/summary', routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    const result = await TreasuryService.getSummary(startDate, endDate);
    return maskSourceInResult(result, req.user.role);
}));

// Get daily cashbox
router.get('/daily', routeHandler(async (req) => {
    const { date } = req.query;
    return await TreasuryService.getDailyCashbox(date || new Date());
}));

// Reconcile cashbox
router.post('/reconcile', roleMiddleware(['owner', 'manager']), validate(reconcileSchema), routeHandler(async (req) => {
    const { date, actualClosingBalance, notes } = req.body;
    return await TreasuryService.reconcileCashbox(date || new Date(), actualClosingBalance, req.user._id, notes);
}));

// Get transactions history
router.get('/transactions', routeHandler(async (req) => {
    const { startDate, endDate, type, page, limit } = req.query;
    const result = await TreasuryService.getTransactions(startDate, endDate, type, null, { page, limit });
    return maskSourceInResult(result, req.user.role);
}));

// Add manual income
const manualIncomeBody = sourceRequiredRefine(
    manualIncomeSchema.extend({
        method: z.enum(['cash', 'bank', 'wallet', 'check', 'adjustment', 'instapay']).optional(),
        sourceNumber: sourceNumberSchema,
    })
);
router.post('/manual-income', roleMiddleware(['owner', 'manager']), validate(manualIncomeBody), routeHandler(async (req) => {
    const { amount, reason, date, method, sourceNumber } = req.body;
    return await TreasuryService.addManualIncome(date || new Date(), amount, reason, req.user._id, method || 'cash', null, sourceNumber);
}));

// Add manual expense
router.post('/manual-expense', roleMiddleware(['owner', 'manager']), validate(expenseSchema), routeHandler(async (req) => {
    const { amount, reason, category, date, method, sourceNumber } = req.body;
    return await TreasuryService.addManualExpense(date || new Date(), amount, reason, category, req.user._id, method || 'cash', null, sourceNumber);
}));

// Undo a manual transaction
router.delete('/transactions/:id', roleMiddleware(['owner']), routeHandler(async (req) => {
    return await TreasuryService.undoTransaction(req.params.id, req.user._id);
}));

export default router;
