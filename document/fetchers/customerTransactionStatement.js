/**
 * DOC-CTX-001..005 — customerTransactionStatement fetcher.
 *
 * Loads a Customer + a window of every transaction that touched
 * the customer (Invoices, TreasuryTransactions, SalesReturns) and
 * shapes the result into the canonical CUSTOMER_TRANSACTION_STATEMENT
 * DocumentData.
 *
 * This is the RAW LEDGER, not the running-balance statement
 * (customerAccountStatement / S15). Two key differences:
 *
 *   - no running balance column; each line is independent
 *   - supports a `type` filter (INVOICE | PAYMENT | REFUND |
 *     DEBT) so the user can isolate one kind of activity
 *   - the primary output formats are CSV / XLSX / Print
 *     (per the registry), not just Print/PDF
 *
 * Data shape (every line is a single event with the same
 * column contract, regardless of type):
 *   - date (ISO)
 *   - type: 'INVOICE' | 'PAYMENT' | 'REFUND' | 'DEBT'
 *   - typeLabel: Arabic label
 *   - reference: invoice number / receipt number / return number
 *   - label: short Arabic description
 *   - description: free text
 *   - debit / credit / net (numeric)
 *   - method / methodLabel / channel / channelLabel /
 *     sourceNumber (PII-masked)
 *   - createdBy
 */

import dbConnect from '../../lib/db.js';
import Customer from '../../models/Customer.js';
import Invoice from '../../models/Invoice.js';
import TreasuryTransaction from '../../models/TreasuryTransaction.js';
import SalesReturn from '../../models/SalesReturn.js';
import Debt from '../../models/Debt.js';
import { getBranding } from '../../lib/branding.js';
import { boundedRange } from '../../lib/paginate.js';
import { methodToChannel, channelLabelAr } from '../../lib/methodToChannel.js';
import { canSeeFullSourceNumber } from '../../lib/pii.js';
import { NotFoundError } from '../../lib/errors.js';

const STATEMENT_MAX_DAYS = 365;

const TYPE_LABELS = Object.freeze({
    INVOICE: 'فاتورة مبيعات',
    PAYMENT: 'تحصيل',
    REFUND: 'مرتجع / صرف',
    DEBT: 'مديونية'
});

const ALLOWED_TYPES = new Set(Object.keys(TYPE_LABELS));

const METHOD_LABELS = Object.freeze({
    cash: 'نقدي',
    bank: 'تحويل بنكي',
    wallet: 'محفظة كاش',
    check: 'شيك',
    instapay: 'انستا باي',
    credit: 'آجل',
    credit_balance: 'رصيد دائن',
    adjustment: 'تسوية',
});

function labelMethod(method) {
    if (!method) return '';
    return METHOD_LABELS[method] || method;
}

function isValidObjectId(id) {
    return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id);
}

function maskIt(value) {
    if (value == null || String(value).trim() === '') return '';
    const s = String(value).trim();
    if (s.length <= 4) return '••••';
    return `•••• ${s.slice(-4)}`;
}

export async function fetch({ customerId, startDate, endDate, type, user }) {
    if (!isValidObjectId(customerId)) {
        throw new NotFoundError('Customer not found');
    }
    const typeFilter = type && ALLOWED_TYPES.has(String(type).toUpperCase())
        ? String(type).toUpperCase()
        : null;

    await dbConnect();

    const customer = await Customer.findById(customerId).select(
        'name phone address taxNumber balance creditBalance linkedSupplier'
    ).lean();
    if (!customer) throw new NotFoundError('Customer not found');

    const range = boundedRange({ startDate, endDate }, { defaultDays: 30, maxDays: STATEMENT_MAX_DAYS });
    const windowQuery = { date: { $gte: range.startDate, $lte: range.endDate } };

    // Pull every event that touched the customer in the window
    const [invoices, transactions, returns, debts] = await Promise.all([
        Invoice.find({ customer: customerId, ...windowQuery })
            .select('number date total type status paymentStatus paymentType sourceNumber createdBy')
            .lean(),
        TreasuryTransaction.find({
            $or: [
                { partnerId: customerId },
                { referenceType: 'Customer', referenceId: customerId }
            ],
            ...windowQuery
        }).sort({ date: 1 }).lean(),
        SalesReturn.find({ customer: customerId, ...windowQuery })
            .select('returnNumber date totalRefund')
            .lean(),
        Debt.find({ debtorId: customerId, debtorType: 'Customer', ...windowQuery })
            .select('referenceNumber date amount status direction')
            .lean(),
    ]);

    const canSeeSource = canSeeFullSourceNumber(user?.role);

    const invoiceLines = invoices.map(inv => ({
        date: inv.date,
        type: 'INVOICE',
        typeLabel: TYPE_LABELS.INVOICE,
        reference: inv.number,
        label: `فاتورة مبيعات #${inv.number}`,
        description: inv.status || '',
        debit: Number(inv.total) || 0,
        credit: 0,
        net: Number(inv.total) || 0,
        method: inv.paymentType || '',
        methodLabel: labelMethod(inv.paymentType),
        channel: methodToChannel(inv.paymentType),
        channelLabel: channelLabelAr(methodToChannel(inv.paymentType)),
        sourceNumber: '',
        createdBy: '',
    }));

    const txLines = transactions.map(tx => {
        const isIncome = tx.type === 'INCOME';
        return {
            date: tx.date,
            type: isIncome ? 'PAYMENT' : 'REFUND',
            typeLabel: isIncome ? TYPE_LABELS.PAYMENT : TYPE_LABELS.REFUND,
            reference: tx.receiptNumber || '-',
            label: isIncome ? 'تحصيل' : 'مرتجع / صرف',
            description: tx.description || '',
            debit: isIncome ? 0 : (Number(tx.amount) || 0),
            credit: isIncome ? (Number(tx.amount) || 0) : 0,
            net: isIncome ? -(Number(tx.amount) || 0) : (Number(tx.amount) || 0),
            method: tx.method || '',
            methodLabel: labelMethod(tx.method),
            channel: methodToChannel(tx.method),
            channelLabel: channelLabelAr(methodToChannel(tx.method)),
            sourceNumber: (tx.method === 'instapay' || tx.method === 'wallet') && tx.sourceNumber
                ? (canSeeSource ? tx.sourceNumber : maskIt(tx.sourceNumber))
                : '',
            createdBy: '',
        };
    });

    const returnLines = returns.map(r => ({
        date: r.date,
        type: 'REFUND',
        typeLabel: TYPE_LABELS.REFUND,
        reference: r.returnNumber || '-',
        label: `مرتجع #${r.returnNumber || ''}`,
        description: '',
        debit: 0,
        credit: Number(r.totalRefund) || 0,
        net: -(Number(r.totalRefund) || 0),
        method: '',
        methodLabel: '',
        channel: '',
        channelLabel: '',
        sourceNumber: '',
        createdBy: '',
    }));

    const debtLines = debts.map(d => {
        const isIncrease = d.direction === 'increase';
        return {
            date: d.date,
            type: 'DEBT',
            typeLabel: TYPE_LABELS.DEBT,
            reference: d.referenceNumber || '-',
            label: isIncrease ? 'زيادة مديونية' : 'تخفيض مديونية',
            description: d.status || '',
            debit: isIncrease ? (Number(d.amount) || 0) : 0,
            credit: isIncrease ? 0 : (Number(d.amount) || 0),
            net: isIncrease ? (Number(d.amount) || 0) : -(Number(d.amount) || 0),
            method: '',
            methodLabel: '',
            channel: '',
            channelLabel: '',
            sourceNumber: '',
            createdBy: '',
        };
    });

    let allLines = [...invoiceLines, ...txLines, ...returnLines, ...debtLines]
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (typeFilter) {
        allLines = allLines.filter(l => l.type === typeFilter);
    }

    const totals = allLines.reduce((acc, l) => {
        acc.debits += l.debit;
        acc.credits += l.credit;
        acc.net += l.net;
        return acc;
    }, { debits: 0, credits: 0, net: 0 });

    const branding = await getBranding();

    return {
        type: 'customer_transaction_statement',
        title: 'حركات عميل',
        documentType: 'CUSTOMER_TRANSACTION_STATEMENT',
        branding,

        customer: {
            id: customer._id,
            name: customer.name,
            phone: customer.phone || '',
            address: customer.address || '',
            taxNumber: customer.taxNumber || '',
            linkedSupplier: customer.linkedSupplier || null,
        },

        period: {
            startDate: range.startDate.toISOString(),
            endDate: range.endDate.toISOString(),
            days: Math.ceil((range.endDate - range.startDate) / 86400000)
        },

        typeFilter, // null = all; otherwise 'INVOICE' | 'PAYMENT' | 'REFUND' | 'DEBT'

        availableTypes: Object.keys(TYPE_LABELS).map(k => ({ value: k, label: TYPE_LABELS[k] })),

        totals: {
            debits: Number(totals.debits.toFixed(2)),
            credits: Number(totals.credits.toFixed(2)),
            net: Number(totals.net.toFixed(2)),
        },

        lines: allLines.map(l => ({
            ...l,
            date: l.date instanceof Date ? l.date.toISOString() : new Date(l.date).toISOString(),
        })),

        lineCount: allLines.length,

        generatedAt: new Date().toISOString(),
        generatedBy: user?.name || '',
        filters: {
            startDate: range.startDate.toISOString(),
            endDate: range.endDate.toISOString(),
            type: typeFilter,
        }
    };
}

export default { fetch };
