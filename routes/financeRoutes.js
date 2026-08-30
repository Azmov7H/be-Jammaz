import express from 'express';
import { FinanceService } from '../services/financeService.js';
import { DebtService } from '../services/financial/debtService.js';
import { TreasuryService } from '../services/treasuryService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateParams } from '../lib/validate.js';
import {
    customerPaymentSchema, supplierPaymentSchema, debtPaymentSchema,
    counterpartyPaymentSchema, saleReturnSchema, expenseSchema,
    installmentPlanSchema, treasuryTransactionSchema, idSchema,
} from '../validations/index.js';
import { z } from 'zod';

const money = counterpartyPaymentSchema.shape.amount;
const method = counterpartyPaymentSchema.shape.method;
const note = counterpartyPaymentSchema.shape.note;

const router = express.Router();

router.use(authMiddleware);

// Record a customer payment
router.post('/payments/customer', validate(customerPaymentSchema), routeHandler(async (req) => {
    const { invoice, amount, method, note, sourceNumber } = req.body;
    return await FinanceService.recordCustomerPayment(invoice, amount, method, note, req.user._id, sourceNumber);
}));

// Unified collection: manager+ (T-ACL-02)
router.post('/payments/unified', roleMiddleware(['owner', 'manager']), validate(z.object({ customerId: idSchema, amount: money, method: method, note: note, sourceNumber: z.string().max(100).optional() })), routeHandler(async (req) => {
    const { customerId, amount, method, note, sourceNumber } = req.body;
    return await FinanceService.recordTotalCustomerPayment(customerId, amount, method, note, req.user._id, sourceNumber);
}));

// Supplier payment: manager+ (T-ACL-02)
router.post('/payments/supplier', roleMiddleware(['owner', 'manager']), validate(supplierPaymentSchema), routeHandler(async (req) => {
    const { po, amount, method, note, sourceNumber } = req.body;
    return await FinanceService.recordSupplierPayment(po, amount, method, note, req.user._id, sourceNumber);
}));

// Manual debt payment: manager+ (T-ACL-02)
router.post('/payments/debt', roleMiddleware(['owner', 'manager']), validate(debtPaymentSchema), routeHandler(async (req) => {
    const { debt, amount, method, note, sourceNumber } = req.body;
    return await FinanceService.recordManualDebtPayment(debt, amount, method, note, req.user._id, sourceNumber);
}));

// Process a sales return
router.post('/returns', roleMiddleware(['owner', 'manager']), validate(saleReturnSchema), routeHandler(async (req) => {
    const { invoice, returnData, refundMethod } = req.body;
    return await FinanceService.processSaleReturn(invoice, returnData, refundMethod, req.user._id);
}));

// Record a general expense
router.post('/expenses', roleMiddleware(['owner', 'manager']), validate(expenseSchema), routeHandler(async (req) => {
    return await FinanceService.recordExpense(req.body, req.user._id);
}));

// Get debts overview
router.get('/debts/overview', routeHandler(async () => {
    return await DebtService.getDebtOverview();
}));

// Get debtors with balance (Aggregated)
router.get('/debts/debtors', routeHandler(async (req) => {
    const { type, search, page, limit } = req.query;
    return await DebtService.getDebtorsWithBalance(type || 'Customer', { search }, { page, limit });
}));

// Get specific debts
router.get('/debts', routeHandler(async (req) => {
    // Validate debtorId to prevent CastError
    if (req.query.debtorId === 'undefined' || req.query.debtorId === '') {
        delete req.query.debtorId;
    }
    return await DebtService.getDebts(req.query, { page: req.query.page, limit: req.query.limit });
}));

// Canonical: Get Installments for Debt
router.get('/debts/:debtId/installments', routeHandler(async (req) => {
    return await DebtService.getInstallments(req.params.debtId);
}));

// Installment plans: manager+ (T-ACL-02)
router.post('/debts/:debtId/installments', validateParams(z.object({ debtId: idSchema })), roleMiddleware(['owner', 'manager']), validate(installmentPlanSchema), routeHandler(async (req) => {
    return await DebtService.createInstallmentPlan({ ...req.body, debtId: req.params.debtId, userId: req.user._id });
}));

const deprecated = (_req, res, next) => {
    res.set('Deprecation', 'true');
    next();
};

// DEPRECATED legacy paths — kept until frontend migrates to /debts/:debtId/installments
router.post('/installments', deprecated, roleMiddleware(['owner', 'manager']), validate(installmentPlanSchema), routeHandler(async (req) => {
    return await DebtService.createInstallmentPlan({ ...req.body, userId: req.user._id });
}));

router.get('/installments/:debtId', deprecated, routeHandler(async (req) => {
    return await DebtService.getInstallments(req.params.debtId);
}));

// Dispatcher: manager+ (can reach supplier/unified paths; cashiers use /payments/customer) [T-ACL-02]
router.post('/payments', roleMiddleware(['owner', 'manager']), validate(counterpartyPaymentSchema), routeHandler(async (req) => {
    const { customerId, supplierId, debtId, amount, method, note, sourceNumber } = req.body;
    return await FinanceService.resolvePayment({ customerId, supplierId, debtId, amount, method, note, sourceNumber }, req.user._id);
}));

// Get receipt by transaction ID
router.get('/receipts/:id', routeHandler(async (req) => {
    return await TreasuryService.buildReceipt(req.params.id);
}));

// NEW: Get treasury summary for date range
router.get('/treasury', routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    return await TreasuryService.getSummary(startDate, endDate);
}));

// NEW: Record manual transaction
router.post('/transaction', validate(treasuryTransactionSchema), routeHandler(async (req) => {
    const { amount, description, type, category, date, method, sourceNumber } = req.body;

    if (type === 'INCOME') {
        return await TreasuryService.addManualIncome(date || new Date(), amount, description, req.user._id, method || 'cash', null, sourceNumber);
    } else {
        return await TreasuryService.addManualExpense(date || new Date(), amount, description, category || 'other', req.user._id, method || 'cash', null, sourceNumber);
    }
}));

// NEW: Undo transaction
router.delete('/transaction/:id', validateParams(z.object({ id: idSchema })), roleMiddleware(['owner']), routeHandler(async (req) => {
    return await TreasuryService.undoTransaction(req.params.id, req.user._id);
}));

// NEW: Get daily cashbox details
router.get('/daily', routeHandler(async (req) => {
    const { date } = req.query;
    return await TreasuryService.getDailyCashbox(date || new Date());
}));

// NEW: Get transactions for a specific partner (Customer/Supplier)
router.get('/partner/:id/transactions', routeHandler(async (req) => {
    const { id } = req.params;
    const { startDate, endDate, type, page, limit } = req.query;
    return await TreasuryService.getTransactions(startDate, endDate, type, id, { page, limit });
}));

export default router;
