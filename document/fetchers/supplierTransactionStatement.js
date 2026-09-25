/**
 * DOC-STX-001..005 — supplierTransactionStatement fetcher.
 *
 * Mirror of customerTransactionStatement.js for the supplier side.
 *
 * Loads a Supplier + a window of every transaction that touched the
 * supplier (PurchaseOrders, TreasuryTransactions, Debts) and shapes
 * the result into the canonical SUPPLIER_TRANSACTION_STATEMENT
 * DocumentData.
 *
 * This is the RAW LEDGER, not the running-balance statement
 * (supplierAccountStatement / DOC-SSTMT). Two key differences:
 *
 *   - no running balance column; each line is independent
 *   - supports a `type` filter (PURCHASE | PAYMENT | REFUND |
 *     DEBT) so the user can isolate one kind of activity
 *   - the primary output formats are CSV / XLSX / Print
 *     (per the registry), not just Print/PDF, so every line carries
 *     a full column contract (see below)
 *
 * Data shape (every line is a single event with the same
 * column contract, regardless of type):
 *   - date (ISO)
 *   - type: 'PURCHASE' | 'PAYMENT' | 'REFUND' | 'DEBT'
 *   - typeLabel: Arabic label
 *   - reference: po number / receipt number / debt ref
 *   - label: short Arabic description
 *   - description: free text
 *   - debit / credit / net (numeric)
 *   - method / methodLabel / channel / channelLabel /
 *     sourceNumber (PII-masked)
 *   - createdBy
 */

import dbConnect from '../../lib/db.js';
import Supplier from '../../models/Supplier.js';
import PurchaseOrder from '../../models/PurchaseOrder.js';
import TreasuryTransaction from '../../models/TreasuryTransaction.js';
import Debt from '../../models/Debt.js';
import { getBranding } from '../../lib/branding.js';
import { boundedRange } from '../../lib/paginate.js';
import { methodToChannel, channelLabelAr } from '../../lib/methodToChannel.js';
import { canSeeFullSourceNumber } from '../../lib/pii.js';
import { NotFoundError } from '../../lib/errors.js';

const STATEMENT_MAX_DAYS = 365;

const TYPE_LABELS = Object.freeze({
    PURCHASE: 'فاتورة مشتريات',
    PAYMENT: 'دفعة للمورد',
    REFUND: 'استرداد من المورد',
    DEBT: 'مديونية',
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

export async function fetch({ id, supplierId, startDate, endDate, type, user }) {
    // The document engine passes the route param as `id`; accept the
    // explicit supplierId too so direct callers keep working.
    supplierId = supplierId ?? id;
    if (!isValidObjectId(supplierId)) {
        throw new NotFoundError('Supplier not found');
    }

    const typeFilter = type && ALLOWED_TYPES.has(String(type).toUpperCase())
        ? String(type).toUpperCase()
        : null;

    await dbConnect();

    const supplier = await Supplier.findById(supplierId).select(
        'name phone address taxNumber balance creditBalance'
    ).lean();
    if (!supplier) throw new NotFoundError('Supplier not found');

    const range = boundedRange({ startDate, endDate }, { defaultDays: 30, maxDays: STATEMENT_MAX_DAYS });
    const windowQuery = { date: { $gte: range.startDate, $lte: range.endDate } };

    // Pull every event that touched the supplier in the window
    const [purchases, transactions, debts] = await Promise.all([
        // Received purchase orders are the full, visible purchases.
        PurchaseOrder.find({
            supplier: supplierId,
            status: 'RECEIVED',
            receivedDate: { $gte: range.startDate, $lte: range.endDate }
        })
            .select('poNumber receivedDate totalCost status createdBy')
            .lean(),
        TreasuryTransaction.find({
            $or: [
                { partnerId: supplierId },
                { referenceType: 'Supplier', referenceId: supplierId }
            ],
            ...windowQuery
        }).sort({ date: 1 }).lean(),
        Debt.find({ debtorId: supplierId, debtorType: 'Supplier', ...windowQuery })
            .select('referenceNumber date amount status direction')
            .lean(),
    ]);

    const canSeeSource = canSeeFullSourceNumber(user?.role);

    const purchaseLines = purchases.map(po => ({
        date: po.receivedDate,
        type: 'PURCHASE',
        typeLabel: TYPE_LABELS.PURCHASE,
        reference: po.poNumber || '-',
        label: `فاتورة مشتريات #${po.poNumber || ''}`,
        description: po.status || '',
        debit: Number(po.totalCost) || 0,
        credit: 0,
        net: Number(po.totalCost) || 0,
        method: '',
        methodLabel: '',
        channel: '',
        channelLabel: '',
        sourceNumber: '',
        createdBy: '',
    }));

    const txLines = transactions.map(tx => {
        const isExpense = tx.type === 'EXPENSE';
        return {
            date: tx.date,
            type: isExpense ? 'PAYMENT' : 'REFUND',
            typeLabel: isExpense ? TYPE_LABELS.PAYMENT : TYPE_LABELS.REFUND,
            reference: tx.receiptNumber || '-',
            label: isExpense ? 'دفعة للمورد' : 'استرداد من المورد',
            description: tx.description || '',
            debit: isExpense ? 0 : (Number(tx.amount) || 0),
            credit: isExpense ? (Number(tx.amount) || 0) : 0,
            net: isExpense ? -(Number(tx.amount) || 0) : (Number(tx.amount) || 0),
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

    let allLines = [...purchaseLines, ...txLines, ...debtLines]
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
        type: 'supplier_transaction_statement',
        title: 'حركات مورد',
        documentType: 'SUPPLIER_TRANSACTION_STATEMENT',
        branding,

        supplier: {
            id: supplier._id,
            name: supplier.name,
            phone: supplier.phone || '',
            address: supplier.address || '',
            taxNumber: supplier.taxNumber || '',
        },

        period: {
            startDate: range.startDate.toISOString(),
            endDate: range.endDate.toISOString(),
            days: Math.ceil((range.endDate - range.startDate) / 86400000)
        },

        typeFilter, // null = all; otherwise 'PURCHASE' | 'PAYMENT' | 'REFUND' | 'DEBT'

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