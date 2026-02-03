import express from 'express';
import { FinanceService } from '../services/financeService.js';
import { DebtService } from '../services/financial/debtService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

// Record a customer payment
router.post('/payments/customer', routeHandler(async (req) => {
    const { invoice, amount, method, note } = req.body;
    return await FinanceService.recordCustomerPayment(invoice, amount, method, note, req.user._id);
}));

// Record a unified customer payment (collection against total balance)
router.post('/payments/unified', routeHandler(async (req) => {
    const { customerId, amount, method, note } = req.body;
    return await FinanceService.recordTotalCustomerPayment(customerId, amount, method, note, req.user._id);
}));

// Record a supplier payment
router.post('/payments/supplier', routeHandler(async (req) => {
    const { po, amount, method, note } = req.body;
    return await FinanceService.recordSupplierPayment(po, amount, method, note, req.user._id);
}));

// Record a manual debt payment
router.post('/payments/debt', routeHandler(async (req) => {
    const { debt, amount, method, note } = req.body;
    return await FinanceService.recordManualDebtPayment(debt, amount, method, note, req.user._id);
}));

// Process a sales return
router.post('/returns', routeHandler(async (req) => {
    const { invoice, returnData, refundMethod } = req.body;
    return await FinanceService.processSaleReturn(invoice, returnData, refundMethod, req.user._id);
}));

// Record a general expense
router.post('/expenses', routeHandler(async (req) => {
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

// Get Installments for Debt (legacy path)
router.get('/debts/:debtId/installments', routeHandler(async (req) => {
    return await DebtService.getInstallments(req.params.debtId);
}));

// Create Installment Plan
router.post('/installments', routeHandler(async (req) => {
    return await DebtService.createInstallmentPlan({ ...req.body, userId: req.user._id });
}));

// Get Installments for Debt
router.get('/installments/:debtId', routeHandler(async (req) => {
    return await DebtService.getInstallments(req.params.debtId);
}));

// Generic payments endpoint (routes to unified by default)
router.post('/payments', routeHandler(async (req) => {
    const { customerId, supplierId, debtId, amount, method, note } = req.body;

    if (debtId) {
        // Fetch the debt document first - the service expects an object, not just an ID
        const Debt = (await import('../models/Debt.js')).default;
        const debt = await Debt.findById(debtId);
        if (!debt) throw new Error('الدين غير موجود');
        return await FinanceService.recordManualDebtPayment(debt, amount, method, note, req.user._id);
    } else if (supplierId) {
        const PurchaseOrder = (await import('../models/PurchaseOrder.js')).default;
        const po = await PurchaseOrder.findOne({ supplier: supplierId, status: 'RECEIVED', paymentStatus: { $ne: 'paid' } });
        if (!po) throw new Error('لا توجد طلبات شراء مستلمة غير مدفوعة');
        return await FinanceService.recordSupplierPayment(po, amount, method, note, req.user._id);
    } else if (customerId) {
        return await FinanceService.recordTotalCustomerPayment(customerId, amount, method, note, req.user._id);
    } else {
        throw new Error('يجب تحديد العميل أو المورد أو الدين');
    }
}));

// Get receipt by transaction ID
router.get('/receipts/:id', routeHandler(async (req) => {
    const { id } = req.params;
    if (!id || id === 'undefined' || id.length !== 24) {
        throw new Error('رقم السند غير صحيح');
    }

    const TreasuryTransaction = (await import('../models/TreasuryTransaction.js')).default;
    const InvoiceSettings = (await import('../models/InvoiceSettings.js')).default;

    const transaction = await TreasuryTransaction.findById(id)
        .populate('referenceId')
        .populate('createdBy', 'name')
        .lean();

    if (!transaction) throw new Error('السند غير موجود');

    // Get company settings
    const settings = await InvoiceSettings.findOne().lean() || {
        companyName: 'شركتكم',
        showLogo: false
    };

    let partner = null;
    let remainingBalance = 0;

    // If it's a customer payment, fetch customer details
    if (transaction.referenceType === 'Customer' || transaction.referenceType === 'UnifiedCollection') {
        const Customer = (await import('../models/Customer.js')).default;
        partner = await Customer.findById(transaction.referenceId).lean();
        remainingBalance = partner?.balance || 0;
    }

    // If it's a supplier payment, fetch supplier details
    if (transaction.referenceType === 'PurchaseOrder' || transaction.referenceType === 'Supplier') {
        const Supplier = (await import('../models/Supplier.js')).default;
        partner = await Supplier.findById(transaction.referenceId).lean();
        remainingBalance = partner?.balance || 0;
    }

    return { transaction, partner, settings, remainingBalance };
}));

// NEW: Get treasury summary for date range
router.get('/treasury', routeHandler(async (req) => {
    const { TreasuryService } = await import('../services/treasuryService.js');
    const { startDate, endDate } = req.query;
    return await TreasuryService.getSummary(startDate, endDate);
}));

// NEW: Record manual transaction
router.post('/transaction', routeHandler(async (req) => {
    const { TreasuryService } = await import('../services/treasuryService.js');
    const { amount, description, type, category, date } = req.body;

    if (type === 'INCOME') {
        return await TreasuryService.addManualIncome(date || new Date(), amount, description, req.user._id);
    } else {
        return await TreasuryService.addManualExpense(date || new Date(), amount, description, category || 'other', req.user._id);
    }
}));

// NEW: Undo transaction
router.delete('/transaction/:id', roleMiddleware(['admin']), routeHandler(async (req) => {
    const { TreasuryService } = await import('../services/treasuryService.js');
    return await TreasuryService.undoTransaction(req.params.id, req.user._id);
}));

// NEW: Get daily cashbox details
router.get('/daily', routeHandler(async (req) => {
    const { TreasuryService } = await import('../services/treasuryService.js');
    const { date } = req.query;
    return await TreasuryService.getDailyCashbox(date || new Date());
}));

// NEW: Get transactions for a specific partner (Customer/Supplier)
router.get('/partner/:id/transactions', routeHandler(async (req) => {
    const { TreasuryService } = await import('../services/treasuryService.js');
    const { id } = req.params;
    const { startDate, endDate, type } = req.query;
    return await TreasuryService.getTransactions(startDate, endDate, type, id);
}));

export default router;
