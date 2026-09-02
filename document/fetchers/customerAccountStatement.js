/**
 * DOC-CSTMT-001..005 — customerStatement fetcher.
 *
 * Loads a Customer + a window of Invoices + TreasuryTransactions and
 * shapes the result into the canonical CUSTOMER_STATEMENT DocumentData.
 *
 * CLOSES THE OPENING-BALANCE BUG (audit flag, originally written as
 * "for simplicity in this iteration, we start from 0" in
 * services/customerService.getStatement).
 *
 *   - openingBalance = customer.openBalance
 *                     + Σ Invoice.total where date < startDate
 *                     - Σ TreasuryTransaction.amount (INCOME only)
 *                       where date < startDate
 *                     + Σ TreasuryTransaction.amount (EXPENSE only)
 *                       where date < startDate (refunds)
 *
 *   - runningBalance on each line is openingBalance + Σ(debit - credit)
 *     up to and including that line.
 *
 *   - closingBalance is the running balance on the last line; this MUST
 *     equal customer.balance within ±1 EGP rounding (the renderer shows
 *     any delta in the footer so the user sees the discrepancy).
 *
 * Type disambiguation: this fetcher ONLY returns success for Customer
 * partners. Supplier-side statement (DOC-SSTMT) lives in Sprint 6.
 */

import dbConnect from '../../lib/db.js';
import Customer from '../../models/Customer.js';
import Invoice from '../../models/Invoice.js';
import TreasuryTransaction from '../../models/TreasuryTransaction.js';
import Debt from '../../models/Debt.js';
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

async function getOpeningBalance(customerId, startDate) {
    const open = Number(await Customer.findById(customerId).select('openBalance').lean()
        .then(c => (c ? c.openBalance : 0)) || 0);

    // Debits before window: sum of Invoice.total
    const invAgg = await Invoice.aggregate([
        { $match: { customer: customerId, date: { $lt: startDate } } },
        { $group: { _id: null, total: { $sum: '$total' } } }
    ]);
    const preDebits = invAgg[0]?.total || 0;

    // Credits before window: INCOME TreasuryTransactions
    const txCreditAgg = await TreasuryTransaction.aggregate([
        { $match: { partnerId: customerId, type: 'INCOME', date: { $lt: startDate } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const preCredits = txCreditAgg[0]?.total || 0;

    // Refunds before window: EXPENSE TreasuryTransactions
    const txRefundAgg = await TreasuryTransaction.aggregate([
        { $match: { partnerId: customerId, type: 'EXPENSE', date: { $lt: startDate } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const preRefunds = txRefundAgg[0]?.total || 0;

    return open + preDebits - preCredits + preRefunds;
}

export async function fetch({ customerId, startDate, endDate, user }) {
    if (!isValidObjectId(customerId)) {
        throw new NotFoundError('Customer not found');
    }

    await dbConnect();

    const customer = await Customer.findById(customerId).select(
        'name phone address taxNumber balance creditBalance openBalance linkedSupplier'
    ).lean();
    if (!customer) throw new NotFoundError('Customer not found');

    // T-PERF-01 — same hard cap as the legacy endpoint (1 year max)
    const range = boundedRange({ startDate, endDate }, { defaultDays: 30, maxDays: STATEMENT_MAX_DAYS });
    const windowQuery = { date: { $gte: range.startDate, $lte: range.endDate } };

    // 1. Opening balance — the bug fix
    const openingBalance = await getOpeningBalance(customerId, range.startDate);

    // 2. Invoices in the window (debits)
    const invoices = await Invoice.find({
        customer: customerId,
        ...windowQuery
    }).select('number date total type status paymentStatus').lean();

    // 3. Treasury transactions in the window (credits + refunds)
    const transactions = await TreasuryTransaction.find({
        $or: [
            { partnerId: customerId },
            { referenceType: 'Invoice', referenceId: { $in: invoices.map(i => i._id) } },
            { referenceType: 'Customer', referenceId: customerId }
        ],
        ...windowQuery
    }).sort({ date: 1 }).lean();

    // 4. Build raw lines
    const rawLines = [
        ...invoices.map(inv => buildLine({
            date: inv.date,
            type: 'INVOICE',
            reference: inv.number,
            label: `فاتورة مبيعات #${inv.number}`,
            description: `فاتورة مبيعات #${inv.number}`,
            debit: inv.total,
            credit: 0,
            referenceId: inv._id,
            partnerId: customerId,
            ref: inv
        })),
        ...transactions.map(tx => buildLine({
            date: tx.date,
            type: tx.type === 'INCOME' ? 'PAYMENT' : 'REFUND',
            reference: tx.receiptNumber || '-',
            label: tx.type === 'INCOME' ? 'تحصيل نقدي' : 'مرتجع / صرف',
            description: tx.description,
            debit: tx.type === 'EXPENSE' ? tx.amount : 0,
            credit: tx.type === 'INCOME' ? tx.amount : 0,
            referenceId: tx._id,
            partnerId: tx.partnerId ?? customerId,
            ref: tx
        }))
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    // 5. Decorate with running balance (now correct, starting at openingBalance)
    let running = openingBalance;
    const lines = rawLines.map(line => {
        running += (line.debit - line.credit);
        return { ...line, balance: running };
    });

    const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
    const closingBalance = openingBalance + totalDebits - totalCredits;
    const balanceDelta = Number(closingBalance - Number(customer.balance || 0)).toFixed(2);

    const branding = await getBranding();

    return {
        type: 'customer_statement',
        title: 'كشف حساب عميل',
        documentType: 'CUSTOMER_STATEMENT',
        branding,

        customer: {
            id: customer._id,
            name: customer.name,
            phone: customer.phone || '',
            address: customer.address || '',
            taxNumber: customer.taxNumber || '',
            linkedSupplier: customer.linkedSupplier || null
        },

        period: {
            startDate: range.startDate.toISOString(),
            endDate: range.endDate.toISOString(),
            days: Math.ceil((range.endDate - range.startDate) / 86400000)
        },

        openingBalance: Number(openingBalance),
        closingBalance: Number(closingBalance),
        currentSnapshotBalance: Number(customer.balance || 0),
        balanceDelta, // 0.00 = reconciled; ±X = investigate

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
