/**
 * DOC-SSTMT-001..005 — supplierAccountStatement fetcher.
 *
 * Loads a Supplier + a window of PurchaseOrders + TreasuryTransactions
 * and shapes the result into the canonical SUPPLIER_ACCOUNT_STATEMENT
 * DocumentData.
 *
 * Mirror of customerAccountStatement.js for the supplier side.
 *
 * CLOSES THE OPENING-BALANCE BUG (the supplier side has the same
 * risk that customerAccountStatement closes for the customer side):
 *
 *   openingBalance = supplier.openBalance (default 0; suppliers
 *                   don't track a manual openBalance today, so this
 *                   is 0 unless the schema is extended)
 *                 + Σ PurchaseOrder.totalCost  (date < startDate)
 *                 − Σ TreasuryTransaction     (EXPENSE, date <
 *                   startDate, partnerId = supplier)
 *                 + Σ TreasuryTransaction     (INCOME, date <
 *                   startDate, partnerId = supplier — refunds
 *                   from supplier back to us)
 *
 *   runningBalance on each line is openingBalance + Σ(debit − credit)
 *     up to and including that line, where:
 *       debit  = PurchaseOrder.totalCost (we owe them more)
 *       credit = TreasuryTransaction.amount with type=EXPENSE
 *                (we paid them)
 *
 *   closingBalance is the running balance on the last line; this
 *   MUST equal supplier.balance within ±1 EGP rounding (the
 *   renderer shows any delta in the footer so the user sees the
 *   discrepancy).
 *
 * Type disambiguation: this fetcher ONLY returns success for
 * Supplier partners. Customer-side statement (DOC-CSTMT) lives
 * in Sprint 5.
 */

import dbConnect from '../../lib/db.js';
import Supplier from '../../models/Supplier.js';
import PurchaseOrder from '../../models/PurchaseOrder.js';
import TreasuryTransaction from '../../models/TreasuryTransaction.js';
import { getBranding } from '../../lib/branding.js';
import { boundedRange } from '../../lib/paginate.js';
import { NotFoundError } from '../../lib/errors.js';

const STATEMENT_MAX_DAYS = 365;

function isValidObjectId(id) {
    return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id);
}

function fmt(n) {
    return Number(n || 0).toFixed(2);
}

function buildLine({ date, type, reference, label, description, debit, credit, balance, referenceId, partnerId, ref }) {
    return {
        id: ref?._id,
        referenceId: ref?._id ?? referenceId ?? null,
        partnerId: partnerId ?? null,
        date,
        type,
        reference,
        label,
        description: description || label,
        debit: Number(debit || 0),
        credit: Number(credit || 0),
        balance: Number(balance || 0)
    };
}

async function getOpeningBalance(supplierId, startDate) {
    const sup = await Supplier.findById(supplierId).select('openBalance balance').lean();
    const open = Number(sup?.openBalance || 0);

    // Debits before window: sum of PurchaseOrder.totalCost
    const poAgg = await PurchaseOrder.aggregate([
        { $match: { supplier: supplierId, receivedDate: { $lt: startDate }, status: { $in: ['RECEIVED', 'PENDING'] } } },
        { $group: { _id: null, total: { $sum: '$totalCost' } } }
    ]);
    const preDebits = poAgg[0]?.total || 0;

    // Credits before window: EXPENSE TreasuryTransactions
    const txCreditAgg = await TreasuryTransaction.aggregate([
        { $match: { partnerId: supplierId, type: 'EXPENSE', date: { $lt: startDate } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const preCredits = txCreditAgg[0]?.total || 0;

    // Refunds before window: INCOME TreasuryTransactions (rare; only
    // when a supplier refunds us in cash)
    const txRefundAgg = await TreasuryTransaction.aggregate([
        { $match: { partnerId: supplierId, type: 'INCOME', date: { $lt: startDate } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const preRefunds = txRefundAgg[0]?.total || 0;

    return open + preDebits - preCredits + preRefunds;
}

export async function fetch({ supplierId, startDate, endDate, user }) {
    if (!isValidObjectId(supplierId)) {
        throw new NotFoundError('Supplier not found');
    }

    await dbConnect();

    const supplier = await Supplier.findById(supplierId).select(
        'name phone address taxNumber balance openBalance linkedCustomer'
    ).lean();
    if (!supplier) throw new NotFoundError('Supplier not found');

    // T-PERF-01 — same hard cap as the customer statement
    const range = boundedRange({ startDate, endDate }, { defaultDays: 30, maxDays: STATEMENT_MAX_DAYS });
    const windowQuery = { date: { $gte: range.startDate, $lte: range.endDate } };
    const poWindowQuery = { receivedDate: { $gte: range.startDate, $lte: range.endDate } };

    // 1. Opening balance
    const openingBalance = await getOpeningBalance(supplierId, range.startDate);

    // 2. Purchase orders in the window (debits)
    const purchaseOrders = await PurchaseOrder.find({
        supplier: supplierId,
        ...poWindowQuery,
        status: { $in: ['RECEIVED', 'PENDING'] }
    }).select('poNumber receivedDate totalCost status paymentStatus paymentType paidAmount').lean();

    // 3. Treasury transactions in the window (credits + refunds)
    const transactions = await TreasuryTransaction.find({
        partnerId: supplierId,
        ...windowQuery
    }).sort({ date: 1 }).lean();

    // 4. Build raw lines
    const rawLines = [
        ...purchaseOrders.map(po => buildLine({
            date: po.receivedDate,
            type: 'PURCHASE_ORDER',
            reference: po.poNumber,
            label: `أمر شراء #${po.poNumber}`,
            description: `أمر شراء #${po.poNumber}`,
            debit: po.totalCost,
            credit: 0,
            referenceId: po._id,
            partnerId: supplierId,
            ref: po
        })),
        ...transactions.map(tx => buildLine({
            date: tx.date,
            type: tx.type === 'EXPENSE' ? 'PAYMENT' : 'REFUND',
            reference: tx.receiptNumber || '-',
            label: tx.type === 'EXPENSE' ? 'سداد للمورد' : 'استرداد من المورد',
            description: tx.description,
            debit: tx.type === 'INCOME' ? tx.amount : 0,
            credit: tx.type === 'EXPENSE' ? tx.amount : 0,
            referenceId: tx._id,
            partnerId: tx.partnerId ?? supplierId,
            ref: tx
        }))
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    // 5. Decorate with running balance
    let running = openingBalance;
    const lines = rawLines.map(line => {
        running += (line.debit - line.credit);
        return { ...line, balance: running };
    });

    const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
    const closingBalance = openingBalance + totalDebits - totalCredits;
    const balanceDelta = Number(closingBalance - Number(supplier.balance || 0)).toFixed(2);

    const branding = await getBranding();

    return {
        type: 'supplier_statement',
        title: 'كشف حساب مورد',
        documentType: 'SUPPLIER_ACCOUNT_STATEMENT',
        branding,

        supplier: {
            id: supplier._id,
            name: supplier.name,
            phone: supplier.phone || '',
            address: supplier.address || '',
            taxNumber: supplier.taxNumber || '',
            linkedCustomer: supplier.linkedCustomer || null
        },

        period: {
            startDate: range.startDate.toISOString(),
            endDate: range.endDate.toISOString(),
            days: Math.ceil((range.endDate - range.startDate) / 86400000)
        },

        openingBalance: Number(openingBalance),
        closingBalance: Number(closingBalance),
        currentSnapshotBalance: Number(supplier.balance || 0),
        balanceDelta,

        totals: {
            debits: Number(totalDebits),
            credits: Number(totalCredits),
            net: Number(totalDebits - totalCredits)
        },

        lines: lines.map(l => ({
            ...l,
            debitFormatted: fmt(l.debit),
            creditFormatted: fmt(l.credit),
            balanceFormatted: fmt(l.balance),
            dateFormatted: l.date instanceof Date ? l.date.toISOString() : new Date(l.date).toISOString()
        })),

        lineCount: lines.length,

        generatedAt: new Date().toISOString(),
        generatedBy: user?.name || '',
        filters: { startDate: range.startDate.toISOString(), endDate: range.endDate.toISOString() }
    };
}

export default { fetch };
