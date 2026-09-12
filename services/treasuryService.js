import TreasuryTransaction from '../models/TreasuryTransaction.js';
import TreasuryBalance from '../models/TreasuryBalance.js';
import { boundedRange, endOfDayIfDateOnly, MAX_LIMIT } from '../lib/paginate.js';
import CashboxDaily from '../models/CashboxDaily.js';
import Invoice from '../models/Invoice.js';
import InvoiceSettings from '../models/InvoiceSettings.js';

import Debt from '../models/Debt.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';
import { withTransaction } from '../utils/dbUtils.js';

// Sprint 2 (FIN-SVC-001): canonical method -> CashboxDaily field mapping.
// Replaces the scattered inline ternaries everywhere so instapay (and any
// future channel) is handled consistently. 'cash' is the default for any
// unknown/legacy method.
export const METHOD_INCOME_FIELD = {
    cash: 'salesIncome',
    bank: 'bankIncome',
    wallet: 'walletIncome',
    check: 'checkIncome',
    instapay: 'instapayIncome',
};
export const METHOD_EXPENSE_FIELD = {
    cash: 'purchaseExpenses',
    bank: 'bankExpenses',
    wallet: 'walletExpenses',
    check: 'checkExpenses',
    instapay: 'instapayExpenses',
};

// FIN-CASHBOX-01: bucket lists for the atomic rollup recompute in
// updateDailyCashbox. Must stay identical to the sums in CashboxDaily
// pre('save') — both encode the same derived totals.
export const CASHBOX_INCOME_BUCKETS = [
    'salesIncome', 'bankIncome', 'walletIncome', 'checkIncome', 'instapayIncome'
];
export const CASHBOX_EXPENSE_BUCKETS = [
    'purchaseExpenses', 'bankExpenses', 'walletExpenses', 'checkExpenses', 'instapayExpenses'
];

/**
 * Resolve the CashboxDaily aggregate field for a (method, type) pair.
 * @param {string} method payment method (cash/bank/wallet/check/instapay/...)
 * @param {'INCOME'|'EXPENSE'} type transaction direction
 * @returns {string} the numeric CashboxDaily field to increment/decrement
 */
export function fieldFor(method, type) {
    const map = type === 'INCOME' ? METHOD_INCOME_FIELD : METHOD_EXPENSE_FIELD;
    return map[method] || map.cash;
}

/**
 * Short label suffix used inside transaction descriptions (cosmetic).
 */
export function methodLabel(method) {
    switch (method) {
        case 'bank': return '(بنك)';
        case 'wallet': return '(محفظة)';
        case 'check': return '(شيك)';
        case 'instapay': return '(انستا باي)';
        default: return '';
    }
}

/**
 * Mask a transfer source number for display (PII-friendly). Keeps the last 2
 * digits (e.g. `123****78`); empty/undefined values pass through unchanged.
 */
export function maskSource(sourceNumber) {
    if (sourceNumber == null || String(sourceNumber).trim() === '') return '';
    const s = String(sourceNumber).trim();
    if (s.length <= 4) return '****';
    return `${s.slice(0, 3)}****${s.slice(-2)}`;
}

/**
 * Treasury/Cashbox Management Service
 * Handles all financial transactions and daily cashbox operations
 */
export const TreasuryService = {
    /**
     * Record income from a sale (invoice)
     */
    async recordSaleIncome(invoice, userId, session = null) {
        // Generate receipt number
        const receiptNumber = await this.getNextReceiptNumber(session);

        // Create treasury transaction
        const method = invoice.paymentType || 'cash';
        const transaction = await this._createTransactions([{
            type: 'INCOME',
            receiptNumber,
            amount: invoice.total,
            description: `مبيعات - فاتورة #${invoice.number} (العميل: ${invoice.customerName || invoice.customer?.name || 'نقدي'})`,
            referenceType: 'Invoice',
            referenceId: invoice._id,
            partnerId: invoice.customer || invoice.customerId,
            date: invoice.date || new Date(),
            method: method,
            sourceNumber: invoice.sourceNumber, // FIN-SVC-004 (Sprint 3)
            createdBy: userId
        }], session);

        // Update daily cashbox based on method
        const updateField = fieldFor(method, 'INCOME');

        await this.updateDailyCashbox(invoice.date || new Date(), {
            [updateField]: invoice.total
        }, session);

        return transaction[0];
    },

    /**
     * Record collection of a payment for an invoice (Debt repayment)
     */
    async recordPaymentCollection(invoice, amount, userId, method = 'cash', note = '', meta = {}, session = null, sourceNumber = '') {
        return this._recordCollection({
            amount,
            userId,
            method,
            note,
            meta,
            session,
            referenceType: 'Invoice',
            referenceId: invoice._id,
            partnerId: invoice.customer || invoice.customerId,
            description: `تحصيل دفعة - فاتورة #${invoice.number} - العميل: ${invoice.customer?.name || invoice.customerName || ''}`,
            sourceNumber
        });
    },

    /**
     * Record Unified Collection (Payment against total balance)
     */
    async recordUnifiedCollection(customer, amount, userId, method = 'cash', note = '', meta = {}, session = null, sourceNumber = '') {
        return this._recordCollection({
            amount,
            userId,
            method,
            note,
            meta,
            session,
            referenceType: 'UnifiedCollection',
            referenceId: customer._id,
            partnerId: customer._id,
            description: `تحصيل مجمع - ${customer.name}`,
            sourceNumber
        });
    },

    /**
     * Generic helper for recording collections (Internal)
     * @private
     */
    async _recordCollection({ amount, userId, method, note, meta, session, referenceType, referenceId, partnerId, description, sourceNumber = '' }) {
        const methodLabelText = methodLabel(method);
        const receiptNumber = await this.getNextReceiptNumber(session);

        const transaction = await this._createTransactions([{
            type: 'INCOME',
            receiptNumber,
            amount: amount,
            description: `${description} ${methodLabelText} ${note ? `- ${note}` : ''}`,
            referenceType,
            referenceId,
            partnerId,
            date: new Date(),
            createdBy: userId,
            method: method,
            sourceNumber: sourceNumber || undefined, // FIN-SVC-002 (Sprint 3)
            meta: meta
        }], session);

        // Update daily cashbox based on method
        const updateField = fieldFor(method, 'INCOME');

        await this.updateDailyCashbox(new Date(), { [updateField]: amount }, session);

        return transaction[0];
    },

    /**
     * Record a transaction (collection/payment) for a generic debt (Manual/Opening Balance)
     */
    async recordDebtTransaction(debtId, partnerId, amount, type, userId, description, method = 'cash', meta = {}, session = null, sourceNumber = '') {
        // CONCURRENCY FIX (Sprint 08): omit the key for EXPENSE rows instead of
        // storing receiptNumber: null — the sparse unique index treats explicit
        // null as a value, so the SECOND null-receipt insert died with E11000.
        let receiptNumber;
        if (type === 'INCOME') {
            receiptNumber = await this.getNextReceiptNumber(session);
        }

        const debtTxDoc = {
            type: type, // 'INCOME' or 'EXPENSE'
            amount: amount,
            description: description,
            referenceType: 'Debt',
            referenceId: debtId,
            partnerId: partnerId,
            date: new Date(),
            method: method,
            sourceNumber: sourceNumber || undefined, // FIN-SVC-002 (Sprint 3)
            createdBy: userId,
            meta: meta
        };
        if (receiptNumber !== undefined) debtTxDoc.receiptNumber = receiptNumber;

        const transaction = await this._createTransactions([debtTxDoc], session);

        // Update daily cashbox based on method
        const updateField = fieldFor(method, type);

        await this.updateDailyCashbox(new Date(), { [updateField]: amount }, session);

        return transaction[0];
    },

    /**
     * Record expense from a purchase
     */
    async recordPurchaseExpense(purchaseOrder, userId, session = null) {
        // Create treasury transaction
        // FIX (Sprint 08): 'credit' is not a valid TreasuryTransaction method —
        // coerce to cash (the movement itself only happens for non-credit POs).
        const payMethod = ['bank', 'wallet', 'check', 'instapay'].includes(purchaseOrder.paymentType)
            ? purchaseOrder.paymentType : 'cash';
        const typeLabelText = methodLabel(purchaseOrder.paymentType);

        const transaction = await this._createTransactions([{
            type: 'EXPENSE',
            amount: purchaseOrder.totalCost,
            description: `مشتريات ${typeLabelText} - أمر شراء #${purchaseOrder.poNumber} (المورد: ${purchaseOrder.supplier?.name || '---'})`,
            referenceType: 'PurchaseOrder',
            referenceId: purchaseOrder._id,
            partnerId: purchaseOrder.supplier,
            date: purchaseOrder.receivedDate || new Date(),
            method: payMethod,
            sourceNumber: purchaseOrder.sourceNumber, // FIN-SVC-004 (Sprint 3)
            createdBy: userId
        }], session);

        // Update daily cashbox based on method
        const method = purchaseOrder.paymentType || 'cash';
        const updateField = fieldFor(method, 'EXPENSE');

        await this.updateDailyCashbox(purchaseOrder.receivedDate || new Date(), {
            [updateField]: purchaseOrder.totalCost
        }, session);

        return transaction[0];
    },

    /**
     * Record payment made to a supplier (Debt repayment)
     */
    async recordSupplierPayment(supplier, amount, poNumber, poId, userId, method = 'cash', note = '', meta = {}, session = null, sourceNumber = '') {
        const supplierMethodLabel = methodLabel(method);
        const transaction = await this._createTransactions([{
            type: 'EXPENSE',
            amount: amount,
            description: `سداد للمورد: ${supplier?.name || '---'} - أمر #${poNumber} ${supplierMethodLabel} ${note ? `- ${note}` : ''}`,
            referenceType: 'PurchaseOrder',
            referenceId: poId,
            partnerId: supplier?._id || supplier,
            date: new Date(),
            method: method,
            sourceNumber: sourceNumber || undefined, // FIN-SVC-002 (Sprint 3)
            createdBy: userId,
            meta: meta
        }], session);

        // Update daily cashbox based on method
        const updateField = fieldFor(method, 'EXPENSE');

        await this.updateDailyCashbox(new Date(), {
            [updateField]: amount
        }, session);

        return transaction[0];
    },

    /**
     * Update daily cashbox summary
     */
    async updateDailyCashbox(date, updates, session = null) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        // Find or create daily cashbox record
        let cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);

        if (!cashbox) {
            // Get previous day's closing balances
            const yesterday = new Date(startOfDay);
            yesterday.setDate(yesterday.getDate() - 1);
            const previousDay = await CashboxDaily.findOne({ date: yesterday }).session(session);

            const created = await CashboxDaily.create([{
                date: startOfDay,
                openingBalance: previousDay?.closingBalance || 0,
                openingBankBalance: previousDay?.closingBankBalance || 0,
                openingWalletBalance: previousDay?.closingWalletBalance || 0,
                openingCheckBalance: previousDay?.closingCheckBalance || 0,
                salesIncome: 0,
                purchaseExpenses: 0,
                bankIncome: 0,
                bankExpenses: 0,
                walletIncome: 0,
                walletExpenses: 0,
                checkIncome: 0,
                checkExpenses: 0
            }], { session });
            cashbox = created[0];
        }

        // T-DB-06: atomic increment — no read-modify-write on balances.
        const allowedFields = [
            'salesIncome', 'purchaseExpenses',
            'bankIncome', 'bankExpenses',
            'walletIncome', 'walletExpenses',
            'checkIncome', 'checkExpenses',
            'instapayIncome', 'instapayExpenses',
            'adjustment'
        ];

        const incUpdate = {};
        for (const [field, amount] of Object.entries(updates)) {
            if (allowedFields.includes(field) && amount) incUpdate[field] = amount;
        }

        if (Object.keys(incUpdate).length > 0) {
            // FIN-CASHBOX-01 (T-03/M2): pipeline update applies the increments
            // AND recomputes the derived rollups in the same atomic write.
            // The old $inc bypassed pre('save'), leaving totalIncome /
            // totalExpenses / netChange / closings stale until the next
            // .save(). Formulas mirror CashboxDaily pre('save') — keep both
            // in sync if either changes.
            const nz = (f) => ({ $ifNull: [`$${f}`, 0] });
            const applyStage = { $set: {} };
            for (const [field, amount] of Object.entries(incUpdate)) {
                applyStage.$set[field] = { $add: [nz(field), amount] };
            }
            const incomeExpr = { $add: [
                ...CASHBOX_INCOME_BUCKETS.map(nz),
                { $ifNull: [{ $sum: '$manualIncome.amount' }, 0] }
            ] };
            const expenseExpr = { $add: [
                ...CASHBOX_EXPENSE_BUCKETS.map(nz),
                { $ifNull: [{ $sum: '$manualExpenses.amount' }, 0] }
            ] };
            cashbox = await CashboxDaily.findOneAndUpdate(
                { _id: cashbox._id },
                [
                    applyStage,
                    { $set: { totalIncome: incomeExpr, totalExpenses: expenseExpr } },
                    { $set: {
                        netChange: { $subtract: ['$totalIncome', '$totalExpenses'] },
                        closingBankBalance: { $subtract: [
                            { $add: [nz('openingBankBalance'), nz('bankIncome')] }, nz('bankExpenses')
                        ] },
                        closingWalletBalance: { $subtract: [
                            { $add: [nz('openingWalletBalance'), nz('walletIncome')] }, nz('walletExpenses')
                        ] },
                        closingCheckBalance: { $subtract: [
                            { $add: [nz('openingCheckBalance'), nz('checkIncome')] }, nz('checkExpenses')
                        ] },
                        closingInstapayBalance: { $subtract: [
                            { $add: [nz('openingInstapayBalance'), nz('instapayIncome')] }, nz('instapayExpenses')
                        ] },
                        difference: { $subtract: [
                            nz('closingBalance'),
                            { $add: [nz('openingBalance'), '$netChange'] }
                        ] }
                    } }
                ],
                { new: true, session }
            );
        }
        return cashbox;
    },

    /**
     * Add manual income entry
     */
    async addManualIncome(date, amount, reason, userId, method = 'cash', session = null, sourceNumber = '') {
        // FIN-ATOMIC-01 (T-04): standalone calls (routes) run in their own
        // transaction; callers that already hold one pass their session and
        // must NOT nest (withTransaction always opens a new session).
        if (session) return this._addManualIncome(date, amount, reason, userId, method, session, sourceNumber);
        return withTransaction((s) => this._addManualIncome(date, amount, reason, userId, method, s, sourceNumber));
    },

    async _addManualIncome(date, amount, reason, userId, method = 'cash', session = null, sourceNumber = '') {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        let cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);

        if (!cashbox) {
            const yesterday = new Date(startOfDay);
            yesterday.setDate(yesterday.getDate() - 1);
            const previousDay = await CashboxDaily.findOne({ date: yesterday }).session(session);

            const created = await CashboxDaily.create([{
                date: startOfDay,
                openingBalance: previousDay?.closingBalance || 0
            }], { session });
            cashbox = created[0];
        }

        // FIN-CASHBOX-01 (T-03): exactly ONE counting location. Channeled
        // methods land in their method bucket (which feeds the totals);
        // only cash/adjustment use manual[] (they have no bucket). The old
        // code pushed manual[] AND $inc'd the bucket for non-cash methods,
        // doubling totalIncome. The ledger row below keeps the full audit
        // trail (description/createdBy/sourceNumber) either way.
        if (method !== 'cash' && method !== 'adjustment') {
            const updateField = fieldFor(method, 'INCOME');
            cashbox = await this.updateDailyCashbox(date, { [updateField]: amount }, session);
        } else {
            await cashbox.addIncome(amount, reason, userId, session);
        }

        // Also record in treasury transactions. The ledger row carries the
        // same business date as the cashbox day (not wall-clock now), so
        // undo/lookups that derive the day from the transaction find it.
        await this._createTransactions([{
            type: 'INCOME',
            amount,
            description: reason,
            referenceType: 'Manual',
            date: new Date(date),
            method,
            sourceNumber: sourceNumber || undefined, // FIN-SVC-002 (Sprint 3)
            createdBy: userId
        }], session);

        return cashbox;
    },
    async addManualExpense(date, amount, reason, category, userId, method = 'cash', session = null, sourceNumber = '') {
        // FIN-ATOMIC-01 (T-04): same conditional-wrap contract as addManualIncome.
        if (session) return this._addManualExpense(date, amount, reason, category, userId, method, session, sourceNumber);
        return withTransaction((s) => this._addManualExpense(date, amount, reason, category, userId, method, s, sourceNumber));
    },

    async _addManualExpense(date, amount, reason, category, userId, method = 'cash', session = null, sourceNumber = '') {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        let cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);

        if (!cashbox) {
            const yesterday = new Date(startOfDay);
            yesterday.setDate(yesterday.getDate() - 1);
            const previousDay = await CashboxDaily.findOne({ date: yesterday }).session(session);

            const created = await CashboxDaily.create([{
                date: startOfDay,
                openingBalance: previousDay?.closingBalance || 0
            }], { session });
            cashbox = created[0];
        }

        // FIN-CASHBOX-01 (T-03): exactly ONE counting location — method
        // bucket for channeled methods, manual[] for cash/adjustment only
        // (same single-count rule as addManualIncome).
        if (method !== 'cash' && method !== 'adjustment') {
            const updateField = fieldFor(method, 'EXPENSE');
            cashbox = await this.updateDailyCashbox(date, { [updateField]: amount }, session);
        } else {
            await cashbox.addExpense(amount, reason, category, userId, session);
        }

        // Also record in treasury transactions. Same business-date rule
        // as _addManualIncome: the ledger row must land on the cashbox day
        // so undo/lookups that derive the day from the transaction find it.
        await this._createTransactions([{
            type: 'EXPENSE',
            amount,
            description: reason,
            referenceType: 'Manual',
            date: new Date(date),
            method,
            sourceNumber: sourceNumber || undefined, // FIN-SVC-002 (Sprint 3)
            createdBy: userId
        }], session);

        return cashbox;
    },

    /**
     * Record refund for Sales Return
     */
    async recordReturnRefund(salesReturn, amount, userId, session = null) {
        // Update daily cashbox based on method
        const method = salesReturn.refundMethod || 'cash';
        const updateField = fieldFor(method, 'INCOME');

        await this.updateDailyCashbox(new Date(), {
            [updateField]: -amount // Negative income reflects a refund
        }, session);

        const transaction = await this._createTransactions([{
            type: 'EXPENSE',
            amount: amount,
            description: `استرداد نقدي - مرتجع #${salesReturn.returnNumber}`,
            referenceType: 'SalesReturn',
            referenceId: salesReturn._id,
            partnerId: salesReturn.customer,
            date: new Date(),
            method: method,
            // Refund destination account — OPTIONAL (flagged ambiguity, REQ-VAL).
            sourceNumber: salesReturn.sourceNumber || salesReturn.destinationNumber || undefined,
            createdBy: userId
        }], session);

        return transaction[0];
    },

    /**
     * Reconcile daily cashbox
     */
    async reconcileCashbox(date, actualClosingBalance, userId, notes = '', session = null) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);

        if (!cashbox) {
            throw new NotFoundError('لم يتم العثور على سجل الخزينة لهذا اليوم');
        }

        await cashbox.reconcile(actualClosingBalance, userId, notes, session);

        return cashbox;
    },

    /**
     * T-PERF-03: transactionally bump the running balance doc.
     */
    async _applyBalanceDelta(delta, session = null) {
        await TreasuryBalance.findOneAndUpdate(
            { _id: TreasuryBalance.DOC_ID },
            [
                { $set: {
                    balance: { $add: [{ $ifNull: ['$balance', 0] }, delta] },
                    updatedAt: '$$NOW'
                } }
            ],
            { upsert: true, session }
        );
    },

    /**
     * T-PERF-03: single choke point for treasury writes — creates the
     * transactions and moves the running balance in the same session.
     */
    async _createTransactions(docs, session = null) {
        const created = await TreasuryTransaction.create(docs, { session });
        const delta = docs.reduce(
            (sum, d) => sum + (d.type === 'INCOME' ? d.amount : -d.amount), 0
        );
        await this._applyBalanceDelta(delta, session);
        return created;
    },

    /**
     * T-PERF-03: reverse a deleted transaction's balance effect.
     */
    async _deleteTransaction(transaction, session = null) {
        await transaction.deleteOne({ session });
        const delta = transaction.type === 'INCOME' ? -transaction.amount : transaction.amount;
        await this._applyBalanceDelta(delta, session);
    },

    /**
     * Get current balance — reads the running-balance doc; lazily rebuilds
     * from the full ledger when missing (first run / manual rollback).
     */
    async getCurrentBalance() {
        const doc = await TreasuryBalance.findById(TreasuryBalance.DOC_ID).lean();
        if (doc && typeof doc.balance === 'number') return doc.balance;
        return this._rebuildBalance();
    },

    /**
     * Full-ledger recompute; upserts the running doc.
     */
    async _rebuildBalance() {
        const result = await TreasuryTransaction.aggregate([
            {
                $group: {
                    _id: null,
                    totalIncome: {
                        $sum: {
                            $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0]
                        }
                    },
                    totalExpense: {
                        $sum: {
                            $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0]
                        }
                    }
                }
            }
        ]);

        const balance = (!result || result.length === 0)
            ? 0
            : (result[0].totalIncome || 0) - (result[0].totalExpense || 0);
        await TreasuryBalance.findOneAndUpdate(
            { _id: TreasuryBalance.DOC_ID },
            [{ $set: { balance, updatedAt: '$$NOW' } }],
            { upsert: true }
        );
        return balance;
    },

    /**
     * Get cashbox for specific date
     */
    async getDailyCashbox(date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        return await CashboxDaily.findOne({ date: startOfDay })
            .populate('createdBy', 'name')
            .populate('reconciledBy', 'name')
            .lean();
    },

    /**
     * Get cashbox history for date range
     */
    async getCashboxHistory(startDate, endDate) {
        return await CashboxDaily.find({
            date: {
                $gte: startDate,
                $lte: endDate
            }
        })
            .sort({ date: -1 })
            .lean();
    },

    /**
     * Get transactions for a date range — paginated, with an optional
     * dashboard `category` (supplier_payments / shop_expenses) using the
     * same taxonomy as the summary splits and the CSV/PDF export.
     * Returns `{ transactions, total, page, limit }`; `total` covers the
     * whole window so the UI never mistakes a page for the full ledger.
     */
    async getTransactions(startDate, endDate, type = null, partnerId = null, { page = 1, limit = 100, maxDays = 90, category = null } = {}) {
        // T-PERF-01: default 30d window, hard-capped. The cap is configurable
        // per-call (e.g. the dedicated history endpoint widens to 365 days).
        // Day-scoped callers (the dashboard sends YYYY-MM-DD) mean the whole
        // end day — otherwise rows created after 00:00 today are silently
        // excluded from the list.
        const range = boundedRange({ startDate, endDate: endOfDayIfDateOnly(endDate) }, { defaultDays: 30, maxDays });

        const isSupplier = category === 'supplier_payments';
        const isShop = category === 'shop_expenses';

        const match = { date: { $gte: range.startDate, $lte: range.endDate } };
        if (type && type !== 'ALL') match.type = type;
        if (partnerId) match.partnerId = partnerId;
        if (isSupplier || isShop) match.type = 'EXPENSE';
        if (isShop) match.referenceType = { $in: ['Manual', 'SalesReturn'] };
        if (isSupplier) match.$or = [{ referenceType: 'PurchaseOrder' }, { referenceType: 'Debt' }];

        // T-PERF-01: bounded page size (default 100, max MAX_LIMIT).
        // The skip MUST derive from the same capped limit, not the
        // helper's default, or pages beyond the first come back empty.
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const cappedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 100), MAX_LIMIT);
        const skip = (pageNum - 1) * cappedLimit;

        // Supplier narrowing needs the linked debt's debtorType — one
        // $lookup inside the aggregation so both the total and the page
        // agree (a customer-debt EXPENSE is never a supplier payment).
        const lookupStages = isSupplier
            ? [{ $lookup: { from: 'debts', localField: 'referenceId', foreignField: '_id', as: '_debt' } }]
            : [];
        const narrowStages = isSupplier
            ? [{ $match: { $or: [{ referenceType: 'PurchaseOrder' }, { referenceType: 'Debt', '_debt.debtorType': 'Supplier' }] } }]
            : [];

        const [countRes] = await TreasuryTransaction.aggregate([
            { $match: match },
            ...lookupStages,
            ...narrowStages,
            { $count: 'n' },
        ]);
        const total = countRes?.n || 0;

        const idRows = await TreasuryTransaction.aggregate([
            { $match: match },
            ...lookupStages,
            ...narrowStages,
            { $sort: { date: -1 } },
            { $skip: skip },
            { $limit: cappedLimit },
            { $project: { _id: 1 } },
        ]);
        if (!idRows.length) return { transactions: [], total, page: pageNum, limit: cappedLimit };

        const ids = idRows.map((r) => r._id);
        const docs = await TreasuryTransaction.find({ _id: { $in: ids } })
            .populate('createdBy', 'name')
            .populate({
                path: 'referenceId',
                options: { strictPopulate: false },
                populate: [
                    { path: 'customer', select: 'name phone', options: { strictPopulate: false } },
                    { path: 'supplier', select: 'name phone', options: { strictPopulate: false } },
                    { path: 'debtorId', select: 'name phone', options: { strictPopulate: false } }
                ]
            })
            .lean();
        const order = new Map(ids.map((id, i) => [String(id), i]));
        docs.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));

        // UnifiedCollection rows point at a customer that refPath cannot
        // populate (no such model) — attach the name in one batched lookup
        // so the ledger never renders a '---' party for collections.
        const refIdOf = (d) => {
            const r = d.referenceId;
            if (!r) return null;
            if (typeof r === 'object') return r.name ? null : (r._id ? String(r._id) : null);
            return String(r);
        };
        const ucIds = [...new Set(docs
            .filter((d) => d.referenceType === 'UnifiedCollection')
            .map(refIdOf)
            .filter(Boolean))];
        if (ucIds.length) {
            const Customer = (await import('../models/Customer.js')).default;
            const customers = await Customer.find({ _id: { $in: ucIds } }).select('name').lean();
            const byId = new Map(customers.map((c) => [String(c._id), c]));
            for (const d of docs) {
                if (d.referenceType === 'UnifiedCollection' && d.referenceId) {
                    const c = byId.get(String(d.referenceId));
                    if (c) d.referenceId = { _id: c._id, name: c.name };
                }
            }
        }

        return { transactions: docs, total, page: pageNum, limit: cappedLimit };
    },

    /**
     * Get treasury summary (balance, income, expense) for a period
     */
    async getSummary(startDate, endDate) {
        let periodStart = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 7));
        let periodEnd = endDate ? new Date(endDate) : new Date();

        // Ensure endDate covers the whole day
        periodEnd.setHours(23, 59, 59, 999);
        periodStart.setHours(0, 0, 0, 0);

        // T-PERF-01: aggregate in DB — getTransactions is now page-capped,
        // so summaries must never depend on it.
        const totalsAgg = await TreasuryTransaction.aggregate([
            { $match: { date: { $gte: periodStart, $lte: periodEnd } } },
            { $group: { _id: '$type', total: { $sum: '$amount' } } }
        ]);
        const totals = { income: 0, expense: 0 };
        for (const row of totalsAgg) {
            if (row._id === 'INCOME') totals.income = row.total;
            if (row._id === 'EXPENSE') totals.expense = row.total;
        }

        // 1b. Expense-category split over the SAME period window, using the
        // same taxonomy as the treasury dashboard so the stat cards, chart
        // subtitles and exports always agree (never recomputed client-side
        // over a page-capped list):
        //   supplier payments = EXPENSE on a PurchaseOrder or a Supplier Debt
        //   shop expenses     = EXPENSE on a Manual entry or SalesReturn
        const categoryAgg = await TreasuryTransaction.aggregate([
            { $match: { date: { $gte: periodStart, $lte: periodEnd }, type: 'EXPENSE' } },
            { $lookup: { from: 'debts', localField: 'referenceId', foreignField: '_id', as: '_debt' } },
            {
                $group: {
                    _id: {
                        referenceType: '$referenceType',
                        debtorType: { $arrayElemAt: ['$_debt.debtorType', 0] }
                    },
                    total: { $sum: '$amount' }
                }
            }
        ]);
        let supplierPayments = 0;
        let shopExpenses = 0;
        for (const row of categoryAgg) {
            const ref = row._id?.referenceType;
            if (ref === 'PurchaseOrder' || (ref === 'Debt' && row._id?.debtorType === 'Supplier')) {
                supplierPayments += row.total || 0;
            } else if (ref === 'Manual' || ref === 'SalesReturn') {
                shopExpenses += row.total || 0;
            }
        }

        // 1c. Full-period transaction count — the ledger endpoint is
        // page-capped, so the UI must not present a page size as a total.
        const transactionCount = await TreasuryTransaction.countDocuments({
            date: { $gte: periodStart, $lte: periodEnd }
        });

        // 2. Calculate Profit from Invoices in this period (Sales only)
        const profitAgg = await Invoice.aggregate([
            { $match: { date: { $gte: periodStart, $lte: periodEnd }, status: { $ne: 'CANCELLED' } } },
            { $group: { _id: null, totalProfit: { $sum: '$profit' } } }
        ]);
        const salesProfit = profitAgg[0]?.totalProfit || 0;

        // 3. Calculate Total Outstanding Debt (Receivables from Customers)
        const debtAgg = await Debt.aggregate([
            { $match: { debtorType: 'Customer', status: { $in: ['active', 'overdue'] } } },
            { $group: { _id: null, total: { $sum: '$remainingAmount' } } }
        ]);
        const totalOutstandingDebt = debtAgg[0]?.total || 0;

        // Calculate breakdown by payment method from all transactions
        const breakdownAgg = await TreasuryTransaction.aggregate([
            {
                $group: {
                    _id: '$method',
                    income: {
                        $sum: {
                            $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0]
                        }
                    },
                    expense: {
                        $sum: {
                            $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0]
                        }
                    }
                }
            }
        ]);

        // Initialize breakdown (instapay added in Sprint 2 — FIN-SVC-001)
        const breakdown = { cash: 0, bank: 0, wallet: 0, check: 0, instapay: 0 };

        // Populate breakdown from aggregation
        for (const item of breakdownAgg) {
            const method = item._id || 'cash';
            const net = (item.income || 0) - (item.expense || 0);
            if (method === 'bank') {
                breakdown.bank = net;
            } else if (method === 'wallet') {
                breakdown.wallet = net;
            } else if (method === 'check') {
                breakdown.check = net;
            } else if (method === 'instapay') {
                breakdown.instapay = net;
            } else {
                breakdown.cash += net; // cash or null/undefined
            }
        }

        const currentBalance = await this.getCurrentBalance();

        // T-PERF-03: summary no longer returns the FULL transaction list —
        // aggregates above plus the latest 20 in the period. Contract change:
        // `transactions` -> `recentTransactions`.
        const recentTransactions = await TreasuryTransaction.find({
            date: { $gte: periodStart, $lte: periodEnd }
        })
            .sort({ date: -1 })
            .limit(20)
            .populate('createdBy', 'name')
            .lean();

        return {
            balance: currentBalance,
            breakdown,
            periodBalance: totals.income - totals.expense,
            totalIncome: totals.income,
            totalExpense: totals.expense,
            supplierPayments,
            shopExpenses,
            transactionCount,
            salesProfit: salesProfit,
            totalOutstandingDebt: totalOutstandingDebt,
            recentTransactions
        };
    },

    /**
     * Full-period cash-flow buckets for the treasury chart. Unlike the
     * page-capped ledger endpoint this aggregates the ENTIRE window in the
     * database, so the chart always agrees with the summary stat cards.
     * Daily buckets for short ranges, monthly once the span exceeds 60 days
     * (same rule as the dashboard taxonomy).
     * @returns {{ granularity: 'day'|'month', buckets: Array<{key:string,income:number,expense:number}> }}
     */
    async getCashFlow(startDate, endDate) {
        const range = boundedRange({ startDate, endDate: endOfDayIfDateOnly(endDate) }, { defaultDays: 30, maxDays: 365 });
        const spanDays = (range.endDate.getTime() - range.startDate.getTime()) / 86400000;
        const granularity = spanDays > 60 ? 'month' : 'day';

        const buckets = await TreasuryTransaction.aggregate([
            { $match: { date: { $gte: range.startDate, $lte: range.endDate } } },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: granularity === 'month' ? '%Y-%m' : '%Y-%m-%d',
                            date: '$date',
                            // Business runs on Egypt wall-clock: without this,
                            // late-evening Cairo transactions bucket into the
                            // next UTC day on the chart.
                            timezone: 'Africa/Cairo'
                        }
                    },
                    income: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] } },
                    expense: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] } }
                }
            },
            { $sort: { _id: 1 } },
            {
                $project: {
                    _id: 0,
                    key: '$_id',
                    income: 1,
                    expense: 1
                }
            }
        ]);

        return { granularity, buckets };
    },

    async undoTransaction(transactionId, userId, session = null) {
        // FIN-ATOMIC-01 (T-04): standalone undo (routes) is atomic; nested
        // callers pass their session.
        if (session) return this._undoTransaction(transactionId, userId, session);
        return withTransaction((s) => this._undoTransaction(transactionId, userId, s));
    },

    /**
     * Undo/Reverse a manual transaction
     */
    async _undoTransaction(transactionId, userId, session = null) {
        const transaction = await TreasuryTransaction.findById(transactionId).session(session);
        if (!transaction) throw new NotFoundError('المعاملة غير موجودة');

        // Allow reversing Invoice/PurchaseOrder/Manual
        // if (transaction.referenceType !== 'Manual') {
        //     throw new Error('يمكن التراجع عن المعاملات اليدوية فقط');
        // }

        // 1. Find and update CashboxDaily
        const startOfDay = new Date(transaction.date);
        startOfDay.setHours(0, 0, 0, 0);

        const cashbox = await CashboxDaily.findOne({ date: startOfDay }).session(session);
        if (cashbox) {
            if (transaction.type === 'INCOME') {
                // Find and remove from manualIncome
                const index = cashbox.manualIncome.findIndex(mi =>
                    mi.amount === transaction.amount &&
                    mi.reason === transaction.description
                );
                if (index > -1) {
                    cashbox.manualIncome.splice(index, 1);
                } else {
                    // If not in manualIncome, it might be in salesIncome accumulator
                    // We should decrease salesIncome if it was a Sale
                    if (transaction.referenceType === 'Invoice') {
                        cashbox.salesIncome -= transaction.amount;
                    }
                }
            } else {
                // Find and remove from manualExpenses
                const index = cashbox.manualExpenses.findIndex(me =>
                    me.amount === transaction.amount &&
                    me.reason === transaction.description
                );
                if (index > -1) {
                    cashbox.manualExpenses.splice(index, 1);
                } else {
                    // Purchase Expenses accumulator
                    if (transaction.referenceType === 'PurchaseOrder') {
                        cashbox.purchaseExpenses -= transaction.amount;
                    }
                }
            }

            // Sync method fields
            if (transaction.method !== 'cash') {
                const methodField = fieldFor(transaction.method, transaction.type);
                cashbox[methodField] -= transaction.amount;
            }

            await cashbox.save({ session });
        }

        // 2. Delete the transaction record (reverses running balance)
        await this._deleteTransaction(transaction, session);

        return { success: true };
    },

    /**
     * Delete transaction by Reference (e.g. when deleting a whole Invoice)
     */
    async deleteTransactionByRef(refType, refId, session = null) {
        const transactions = await TreasuryTransaction.find({ referenceType: refType, referenceId: refId }).session(session);
        if (transactions.length === 0) return;

        // T-PERF-04: single pass — group by day so each affected CashboxDaily
        // is read/written once, then one deleteMany + one balance delta.
        const byDay = new Map();
        for (const tx of transactions) {
            const startOfDay = new Date(tx.date);
            startOfDay.setHours(0, 0, 0, 0);
            if (!byDay.has(startOfDay.getTime())) {
                byDay.set(startOfDay.getTime(), { date: startOfDay, txs: [] });
            }
            byDay.get(startOfDay.getTime()).txs.push(tx);
        }

        for (const { date, txs } of byDay.values()) {
            const cashbox = await CashboxDaily.findOne({ date }).session(session);
            if (!cashbox) continue;

            for (const transaction of txs) {
                if (transaction.type === 'INCOME') {
                    // Check manual first
                    const mIdx = cashbox.manualIncome.findIndex(x => x.amount === transaction.amount && x.reason === transaction.description);
                    if (mIdx > -1) {
                        cashbox.manualIncome.splice(mIdx, 1);
                    } else if (cashbox.salesIncome >= transaction.amount) {
                        cashbox.salesIncome -= transaction.amount;
                    }
                } else if (transaction.type === 'EXPENSE') {
                    const mIdx = cashbox.manualExpenses.findIndex(x => x.amount === transaction.amount && x.reason === transaction.description);
                    if (mIdx > -1) {
                        cashbox.manualExpenses.splice(mIdx, 1);
                    } else if (cashbox.purchaseExpenses >= transaction.amount) {
                        cashbox.purchaseExpenses -= transaction.amount;
                    }
                }

                // Sync method fields
                if (transaction.method !== 'cash') {
                    const methodField = fieldFor(transaction.method, transaction.type);
                    cashbox[methodField] -= transaction.amount;
                }
            }

            await cashbox.save({ session });
        }

        await TreasuryTransaction.deleteMany(
            { _id: { $in: transactions.map(t => t._id) } },
            { session }
        );
        const netDelta = transactions.reduce(
            (sum, t) => sum + (t.type === 'INCOME' ? -t.amount : t.amount), 0
        );
        await this._applyBalanceDelta(netDelta, session);
    },

    /**
     * Helper to get and increment the next receipt number
     */
    async getNextReceiptNumber(session = null) {
        // We use a simple incrementing number stored in InvoiceSettings.
        //
        // CONCURRENCY FIX (Sprint 08): the $inc deliberately runs OUTSIDE the
        // caller's transaction (session ignored). Inside a txn, two parallel
        // payments both read the same snapshot value, mint identical REC-n
        // values, and one dies on the unique index with a NON-retryable
        // E11000. Numbers may burn on abort — acceptable for receipts.
        void session;
        const settings = await InvoiceSettings.findOneAndUpdate(
            { isActive: true },
            { $inc: { lastReceiptNumber: 1 } },
            {
                new: true,
                upsert: true,
            }
        );

        return `REC-${settings.lastReceiptNumber}`;
    },

    /**
     * Assemble a printable receipt (transaction + partner + company settings).
     */
    async buildReceipt(transactionId) {
        if (!transactionId || transactionId === 'undefined' || transactionId.length !== 24) {
            throw new BadRequestError('رقم السند غير صحيح');
        }

        const Customer = (await import('../models/Customer.js')).default;
        const Supplier = (await import('../models/Supplier.js')).default;

        const transaction = await TreasuryTransaction.findById(transactionId)
            .populate('referenceId')
            .populate('createdBy', 'name')
            .lean();

        if (!transaction) throw new NotFoundError('السند غير موجود');

        const settings = await InvoiceSettings.findOne().lean() || {
            companyName: 'شركتكم',
            showLogo: false
        };

        let partner = null;
        let remainingBalance = 0;

        if (transaction.referenceType === 'Customer' || transaction.referenceType === 'UnifiedCollection') {
            partner = await Customer.findById(transaction.referenceId).lean();
            remainingBalance = partner?.balance || 0;
        }

        if (transaction.referenceType === 'PurchaseOrder' || transaction.referenceType === 'Supplier') {
            partner = await Supplier.findById(transaction.referenceId).lean();
            remainingBalance = partner?.balance || 0;
        }

        return {
            transaction,
            partner,
            settings,
            remainingBalance,
            // FIN-SVC-002 (Sprint 3): masked transfer source for display.
            sourceNumberDisplay: maskSource(transaction.sourceNumber)
        };
    }
};



