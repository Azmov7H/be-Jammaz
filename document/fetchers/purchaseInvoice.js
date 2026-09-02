/**
 * DOC-PINV-001..005 — purchaseInvoice fetcher.
 *
 * Loads a single PurchaseOrder + its supplier + the live branding
 * and shapes the result into the canonical PURCHASE_INVOICE
 * DocumentData.
 *
 * Conventions:
 *  - read-only (no writes, no balance mutations)
 *  - applies PII masking to sourceNumber based on the user's role
 *  - returns sensible defaults so the renderer never crashes on a
 *    missing field
 *  - is the single source of truth for "what a purchase invoice
 *    looks like" — every renderer reads from this shape
 *
 * Type distinction from SALE_INVOICE:
 *  - "فاتورة مشتريات" / "مورد" / no returns block / no customer
 *    block (the supplier is on the LEFT, not the right)
 *  - The supplier's outstanding balance is shown as the credit
 *    owed-to-supplier (positive balance = we owe them)
 *  - The paidAmount field tracks what we've already paid; the
 *    remaining is the outstanding payable
 */

import dbConnect from '../../lib/db.js';
import PurchaseOrder from '../../models/PurchaseOrder.js';
import Supplier from '../../models/Supplier.js';
import { getBranding } from '../../lib/branding.js';
import { methodToChannel, channelLabelAr } from '../../lib/methodToChannel.js';
import { canSeeFullSourceNumber } from '../../lib/pii.js';
import { NotFoundError } from '../../lib/errors.js';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

const PAYMENT_STATUS_AR = Object.freeze({
    paid: 'مدفوع بالكامل',
    partial: 'مدفوع جزئياً',
    pending: 'غير مدفوع',
});

const PO_STATUS_AR = Object.freeze({
    PENDING: 'قيد الانتظار',
    RECEIVED: 'مستلم',
    CANCELLED: 'ملغي',
});

const PAYMENT_METHOD_LABELS = Object.freeze({
    cash: 'نقدي',
    bank: 'تحويل بنكي',
    wallet: 'محفظة كاش',
    check: 'شيك',
    instapay: 'انستا باي',
    credit: 'آجل',
});

function labelMethod(method) {
    if (!method) return '—';
    return PAYMENT_METHOD_LABELS[method] || method;
}

function labelPaymentStatus(status) {
    if (!status) return '';
    return PAYMENT_STATUS_AR[status] || status;
}

function labelPOStatus(status) {
    if (!status) return '';
    return PO_STATUS_AR[status] || status;
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

function maskIt(value) {
    if (value == null || String(value).trim() === '') return '';
    const s = String(value).trim();
    if (s.length <= 4) return '••••';
    return `•••• ${s.slice(-4)}`;
}

/**
 * @param {{ id: string, ...rest: any }} params
 * @param {{ user: { role: string, _id: string, name?: string } }} ctx
 * @returns {Promise<object>} the shaped PURCHASE_INVOICE DocumentData
 */
export async function fetch(params, { user }) {
    if (!params?.id) {
        throw new NotFoundError('رقم أمر الشراء مطلوب');
    }
    await dbConnect();

    const po = await PurchaseOrder.findById(params.id)
        .populate('supplier', 'name phone address taxNumber balance')
        .populate('items.productId', 'name code')
        .populate('createdBy', 'name')
        .lean();

    if (!po) throw new NotFoundError('أمر الشراء غير موجود');

    // Fetch the live supplier balance separately so the on-page number
    // is always the current credit owed-to-supplier snapshot, not a
    // stale populate.
    const liveSupplier = po.supplier && typeof po.supplier === 'object'
        ? po.supplier
        : null;
    let currentBalance = 0;
    if (liveSupplier?._id) {
        const fresh = await Supplier.findById(liveSupplier._id).select('balance').lean();
        currentBalance = Number(fresh?.balance || 0);
    }

    const branding = await getBranding();

    // Supplier block (prefer populated, fall back to snapshotted name)
    const supplier = {
        id: liveSupplier?._id || po.supplier || null,
        name: liveSupplier?.name || po.supplierName || 'مورد نقدي',
        phone: liveSupplier?.phone || po.supplierPhone || '',
        address: liveSupplier?.address || '',
        taxNumber: liveSupplier?.taxNumber || '',
        balance: currentBalance, // current credit owed to this supplier
    };

    // Items
    const items = (po.items || []).map((it) => {
        const product = it.productId && typeof it.productId === 'object'
            ? it.productId
            : null;
        const qty = Number(it.receivedQty && it.receivedQty > 0 ? it.receivedQty : it.quantity) || 0;
        const cost = Number(it.costPrice) || 0;
        return {
            id: it._id,
            productId: product?._id || it.productId || null,
            productCode: product?.code || '',
            productName: product?.name || 'منتج',
            qtyOrdered: Number(it.quantity) || 0,
            qtyReceived: Number(it.receivedQty) || 0,
            qty,
            unitPrice: cost,
            lineTotal: qty * cost,
            source: 'warehouse',
        };
    });

    // Compute totals (received-only basis mirrors the legacy
    // PurchaseOrderService.getById contract — what the supplier
    // actually delivered, not what was ordered)
    const subtotal = items.reduce((s, it) => s + it.lineTotal, 0);
    const tax = 0; // not modeled on PO
    const total = Number(po.totalCost) || subtotal;
    const paidAmount = Number(po.paidAmount) || 0;
    const remaining = Math.max(total - paidAmount, 0);

    const paymentMethod = po.paymentType || 'cash';
    const paymentChannel = methodToChannel(paymentMethod);
    const isElectronic = paymentMethod === 'instapay' || paymentMethod === 'wallet';
    const canSeeSource = canSeeFullSourceNumber(user?.role);
    const rawSource = po.sourceNumber || '';

    const poDate = po.receivedDate || po.createdAt;
    const expectedDate = po.expectedDate || null;

    return {
        type: 'PURCHASE_INVOICE',
        title: 'فاتورة مشتريات',
        number: po.poNumber,
        date: formatDateAr(poDate),
        time: formatTimeAr(poDate),
        status: labelPOStatus(po.status),
        paymentStatus: po.paymentStatus || 'pending',
        paymentStatusLabel: labelPaymentStatus(po.paymentStatus),
        hasReturns: false,
        branding,

        supplier,

        purchaseOrder: {
            id: po._id,
            number: po.poNumber,
            date: poDate,
            expectedDate,
            receivedDate: po.receivedDate || null,
            status: po.status,
            statusLabel: labelPOStatus(po.status),
            notes: po.notes || '',
            createdBy: po.createdBy?.name || '',
        },

        items,

        totals: {
            subtotal,
            tax,
            discount: 0,
            total,
            paidAmount,
            remaining,
        },

        payment: {
            method: paymentMethod,
            methodLabel: labelMethod(paymentMethod),
            channel: paymentChannel,
            channelLabel: channelLabelAr(paymentChannel),
            sourceNumber: isElectronic
                ? (canSeeSource ? (rawSource || '') : (rawSource ? maskIt(rawSource) : ''))
                : '',
            isElectronic,
            dueDate: expectedDate ? formatDateAr(expectedDate) : '',
        },

        generatedAt: new Date(),
        generatedBy: { _id: user?._id, name: user?.name || 'النظام' },
        filters: {},
    };
}

export default { fetch };
