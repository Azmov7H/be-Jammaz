/**
 * DOC-SINV-001..007 — saleInvoice fetcher.
 *
 * Loads a single Invoice + its SalesReturn history + the live
 * branding, and shapes the result into the canonical DocumentData
 * contract (see docs/invoice-document-redesign/03-document-catalog.md).
 *
 * Conventions:
 *  - read-only (no writes, no balance mutations)
 *  - applies PII masking to sourceNumber based on the user's role
 *  - returns sensible defaults so the renderer never crashes on a
 *    missing field
 *  - is the single source of truth for "what a sales invoice looks
 *    like" — every renderer reads from this shape
 */

import dbConnect from '../../lib/db.js';
import Invoice from '../../models/Invoice.js';
import SalesReturn from '../../models/SalesReturn.js';
import Customer from '../../models/Customer.js';
import { getBranding } from '../../lib/branding.js';
import { methodToChannel, channelLabelAr } from '../../lib/methodToChannel.js';
import { maskDocSource, canSeeFullSourceNumber } from '../../lib/pii.js';
import { NotFoundError } from '../../lib/errors.js';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

const PAYMENT_STATUS_AR = Object.freeze({
    paid: 'مدفوع بالكامل',
    partial: 'مدفوع جزئياً',
    pending: 'غير مدفوع',
});

const PAYMENT_METHOD_LABELS = Object.freeze({
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
    if (!method) return '—';
    return PAYMENT_METHOD_LABELS[method] || method;
}

function labelStatus(status) {
    if (!status) return '';
    return PAYMENT_STATUS_AR[status] || status;
}

function formatDateAr(d) {
    if (!d) return '';
    try {
        return format(new Date(d), 'dd MMMM yyyy', { locale: ar });
    } catch {
        return new Date(d).toISOString().slice(0, 10);
    }
}

function formatTimeAr(d) {
    if (!d) return '';
    try {
        return format(new Date(d), 'HH:mm', { locale: ar });
    } catch {
        return '';
    }
}

function formatMoney(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * @param {{ id: string, ...rest: any }} params
 * @param {{ user: { role: string, _id: string, name?: string } }} ctx
 * @returns {Promise<object>} the shaped SALE_INVOICE DocumentData
 */
export async function fetch(params, { user }) {
    if (!params?.id) {
        // SALE_INVOICE is requiresId in the registry; this is a safety net.
        throw new NotFoundError('رقم الفاتورة مطلوب');
    }
    await dbConnect();

    const invoice = await Invoice.findById(params.id)
        .populate('customer', 'name phone taxNumber address')
        .populate('createdBy', 'name')
        .populate('items.productId', 'name code')
        .lean();

    if (!invoice) throw new NotFoundError('الفاتورة غير موجودة');

    const returns = await SalesReturn.find({ originalInvoice: invoice._id })
        .populate('items.productId', 'name')
        .sort({ date: -1 })
        .lean();

    const branding = await getBranding();

    // Resolve the live customer block (prefer the populated customer
    // doc; fall back to the snapshotted name/phone on the invoice
    // which is what older sales invoices carry).
    const liveCustomer = invoice.customer && typeof invoice.customer === 'object'
        ? invoice.customer
        : null;

    const customer = {
        id: liveCustomer?._id || invoice.customer || null,
        name: liveCustomer?.name || invoice.customerName || 'عميل نقدي',
        phone: liveCustomer?.phone || invoice.customerPhone || '',
        address: liveCustomer?.address || '',
        taxNumber: liveCustomer?.taxNumber || '',
    };

    // Items (denormalized to renderer-friendly shape).
    const items = (invoice.items || []).map((it) => {
        const product = it.productId && typeof it.productId === 'object'
            ? it.productId
            : null;
        return {
            id: it._id,
            productId: product?._id || it.productId || null,
            productCode: product?.code || '',
            productName: it.productName || product?.name || 'منتج',
            qty: Number(it.qty) || 0,
            unitPrice: Number(it.unitPrice) || 0,
            lineTotal: Number(it.total) || (Number(it.qty) || 0) * (Number(it.unitPrice) || 0),
            source: it.source || 'shop',
            isService: !!it.isService,
            unit: '—', // unit is not stored on invoice items (flag in plan)
        };
    });

    // Payment method + channel display (single source of truth).
    const paymentMethod = invoice.paymentType || 'cash';
    const paymentChannel = methodToChannel(paymentMethod);
    const isElectronic = paymentMethod === 'instapay' || paymentMethod === 'wallet';
    const canSeeSource = canSeeFullSourceNumber(user?.role);
    const rawSource = invoice.sourceNumber || '';

    // Payments history (multiple partial payments, e.g. cash + later instapay).
    const payments = (invoice.payments || []).map((p) => {
        const m = methodToChannel(p.method);
        const isElec = p.method === 'instapay' || p.method === 'wallet';
        const src = p.sourceNumber || '';
        return {
            amount: Number(p.amount) || 0,
            date: p.date ? new Date(p.date).toISOString() : null,
            method: p.method || 'cash',
            methodLabel: labelMethod(p.method),
            channel: m,
            channelLabel: channelLabelAr(m),
            sourceNumber: isElec && src
                ? (canSeeSource ? src : maskIt(src))
                : '',
            note: p.note || '',
        };
    });

    // Returns (most recent first).
    const returnsList = (returns || []).map((r) => ({
        id: r._id,
        returnNumber: r.returnNumber,
        date: r.date ? new Date(r.date).toISOString() : null,
        totalRefund: Number(r.totalRefund) || 0,
        items: (r.items || []).map((it) => {
            const product = it.productId && typeof it.productId === 'object'
                ? it.productId
                : null;
            return {
                productName: it.productName || product?.name || 'منتج',
                qty: Number(it.qty) || 0,
                refundAmount: Number(it.refundAmount) || 0,
            };
        }),
    }));

    const subtotal = Number(invoice.subtotal) || 0;
    const tax = Number(invoice.tax) || 0;
    const total = Number(invoice.total) || 0;
    const paidAmount = Number(invoice.paidAmount) || 0;
    const remaining = Math.max(total - paidAmount, 0);

    const invoiceDate = invoice.date || invoice.createdAt;
    const dueDate = invoice.dueDate || null;

    return {
        type: 'SALE_INVOICE',
        title: 'فاتورة مبيعات',
        number: invoice.number,
        date: formatDateAr(invoiceDate),
        time: formatTimeAr(invoiceDate),
        status: labelStatus(invoice.paymentStatus),
        paymentStatus: invoice.paymentStatus || 'paid',
        hasReturns: !!invoice.hasReturns || returnsList.length > 0,
        branding,

        customer,
        invoice: {
            id: invoice._id,
            number: invoice.number,
            date: invoiceDate,
            dueDate,
            customerPriceType: invoice.customerPriceType || 'retail',
            notes: invoice.notes || '',
            createdBy: invoice.createdBy?.name || '',
        },

        items,

        totals: {
            subtotal,
            tax,
            discount: 0, // invoice-level discount not stored (flag in plan)
            total,
            paidAmount,
            remaining,
        },

        payment: {
            method: paymentMethod,
            methodLabel: labelMethod(paymentMethod),
            channel: paymentChannel,
            channelLabel: channelLabelAr(paymentChannel),
            // For non-electronic channels the source number has no
            // business meaning (cash / bank-receipt / check have
            // their own reference numbers, not the transfer-source
            // number). Show it ONLY when the channel is electronic.
            sourceNumber: isElectronic
                ? (canSeeSource ? (rawSource || '') : (rawSource ? maskIt(rawSource) : ''))
                : '',
            isElectronic,
            dueDate: dueDate ? formatDateAr(dueDate) : '',
        },

        payments,

        returns: returnsList,

        generatedAt: new Date(),
        generatedBy: { _id: user?._id, name: user?.name || 'النظام' },
        filters: {},
    };
}

// Default export for callers that want the module as an object (e.g.
// tests that do `import fetcher from './saleInvoice.js'; fetcher.fetch(...)`).
// The runtime contract used by loadFetcher is the NAMED `fetch` above.
export default { fetch };

/**
 * Local PII mask. Mirrors lib/pii.js maskSource but lives here so
 * the fetcher doesn't pull in the response-boundary helpers (those
 * are for Express responses, not DocumentData shaping).
 */
function maskIt(value) {
    if (value == null || String(value).trim() === '') return '';
    const s = String(value).trim();
    if (s.length <= 4) return '••••';
    return `•••• ${s.slice(-4)}`;
}
