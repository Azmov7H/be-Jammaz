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

// CANONICAL treasury paths. The /api/financial/* duplicates (/treasury,
// /transaction, /transaction/:id, /daily) are deprecated aliases kept for
// the /financial dashboard — new code should use these paths.

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

// Full-period cash-flow buckets for the treasury chart (DB-aggregated,
// never page-capped so the chart agrees with the summary cards).
router.get('/cashflow', routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    return await TreasuryService.getCashFlow(startDate, endDate);
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
    const { startDate, endDate, type, page, limit, category } = req.query;
    // T-RPT-02: the dedicated history endpoint serves a "transaction log"
    // surface where the user may legitimately want a year of data. Allow
    // up to 365 days here (vs the default 90-day cap used by the
    // /summary endpoint) so manual switching to "Year" doesn't blank
    // the page. Hard cap is still enforced server-side.
    const result = await TreasuryService.getTransactions(startDate, endDate, type, null, { page, limit, maxDays: 365, category });
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
