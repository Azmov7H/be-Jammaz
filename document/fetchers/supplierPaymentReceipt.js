/**
 * DOC-SPR-001..003 — supplierPaymentReceipt fetcher.
 *
 * Loads a single TreasuryTransaction (EXPENSE) and the live supplier
 * + branding, shaping the result into the canonical
 * SUPPLIER_PAYMENT_RECEIPT DocumentData.
 *
 * Mirror of customerCollectionReceipt.js for the supplier side.
 * Type disambiguation: this fetcher ONLY returns success for
 * supplier-side payments (EXPENSE + supplier partnerId). Customer
 * / income transactions throw NotFoundError so the customer
 * fetcher (S4) can take over.
 *
 * Convention: 'previousBalance' is the supplier's pre-transaction
 * balance (positive = we owed them); 'remainingBalance' is
 * post-transaction. Both are derived from the live supplier
 * snapshot — we approximate 'previous' as 'current + amount' for
 * an EXPENSE supplier payment.
 *
 * PII: sourceNumber is masked unless the role is owner | manager.
 */

import dbConnect from '../../lib/db.js';
import TreasuryTransaction from '../../models/TreasuryTransaction.js';
import Supplier from '../../models/Supplier.js';
import PurchaseOrder from '../../models/PurchaseOrder.js';
import { getBranding } from '../../lib/branding.js';
import { methodToChannel, channelLabelAr } from '../../lib/methodToChannel.js';
import { canSeeFullSourceNumber } from '../../lib/pii.js';
import { NotFoundError } from '../../lib/errors.js';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

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

const REFERENCE_TYPE_LABELS = Object.freeze({
    PurchaseOrder: 'أمر شراء',
    Manual: 'دفع يدوي',
    Debt: 'مديونية سابقة',
});

function labelMethod(method) {
    if (!method) return '—';
    return PAYMENT_METHOD_LABELS[method] || method;
}

function labelReferenceType(type) {
    if (!type) return '';
    return REFERENCE_TYPE_LABELS[type] || type;
}

function isValidObjectId(id) {
    return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id);
}

function formatDateAr(d) {
    if (!d) return '';
    try { return format(new Date(d), 'dd MMMM yyyy', { locale: ar }); } catch { return ''; }
}

function formatTimeAr(d) {
    if (!d) return '';
    try { return format(new Date(d), 'HH:mm', { locale: ar }); } catch { return ''; }
}

function maskIt(value) {
    if (value == null || String(value).trim() === '') return '';
    const s = String(value).trim();
    if (s.length <= 4) return '••••';
    return `•••• ${s.slice(-4)}`;
}

async function resolveReference({ referenceType, referenceId }) {
    if (!referenceType || !referenceId) return null;
    if (referenceType === 'PurchaseOrder') {
        const po = await PurchaseOrder.findById(referenceId).select('poNumber status totalCost paidAmount').lean();
        if (po) return { number: po.poNumber, total: po.totalCost, paid: po.paidAmount, status: po.status };
    }
    return null;
}

/**
 * @param {{ id: string }} params
 * @param {{ user: { role: string, _id: string, name?: string } }} ctx
 * @returns {Promise<object>} the shaped SUPPLIER_PAYMENT_RECEIPT DocumentData
 */
export async function fetch({ id }, { user }) {
    if (!isValidObjectId(id)) {
        throw new NotFoundError('سند السداد غير موجود');
    }

    await dbConnect();

    const tx = await TreasuryTransaction.findById(id)
        .populate('createdBy', 'name')
        .lean();
    if (!tx) throw new NotFoundError('سند السداد غير موجود');

    // Type disambiguation (mirror of customer side):
    //  - EXPENSE only (INCOME throws so the customer fetcher wins)
    //  - must have a partnerId (or a referenceId resolving to a PO)
    if (tx.type !== 'EXPENSE') {
        throw new NotFoundError('سند السداد غير موجود');
    }
    const partnerOk = isValidObjectId(tx.partnerId);
    const refOk = tx.referenceType === 'PurchaseOrder' && isValidObjectId(tx.referenceId);
    if (!partnerOk && !refOk) {
        throw new NotFoundError('سند السداد غير موجود');
    }

    // Resolve the live supplier (partnerId takes precedence; otherwise
    // fall back to the PO's supplier).
    let supplier = null;
    if (partnerOk) {
        supplier = await Supplier.findById(tx.partnerId).select('name phone address taxNumber balance linkedCustomer').lean();
    }
    if (!supplier && refOk) {
        const po = await PurchaseOrder.findById(tx.referenceId).select('supplier').lean();
        if (po?.supplier) {
            supplier = await Supplier.findById(po.supplier).select('name phone address taxNumber balance linkedCustomer').lean();
        }
    }
    if (!supplier) throw new NotFoundError('المورد غير موجود');

    const reference = await resolveReference({ referenceType: tx.referenceType, referenceId: tx.referenceId });

    const branding = await getBranding();
    const paymentMethod = tx.method || 'cash';
    const paymentChannel = methodToChannel(paymentMethod);
    const isElectronic = paymentMethod === 'instapay' || paymentMethod === 'wallet';
    const canSeeSource = canSeeFullSourceNumber(user?.role);
    const rawSource = tx.sourceNumber || '';

    const currentBalance = Number(supplier.balance || 0);
    const amount = Number(tx.amount) || 0;
    // For an EXPENSE supplier payment:
    //   previousBalance = currentBalance + amount
    //   remainingBalance = currentBalance
    const previousBalance = currentBalance + amount;
    const remainingBalance = currentBalance;

    return {
        type: 'supplier_payment_receipt',
        title: 'سند سداد لمورد',
        documentType: 'SUPPLIER_PAYMENT_RECEIPT',
        number: tx.receiptNumber || `EXP-${(tx._id || '').slice(-6)}`,
        receiptNumber: tx.receiptNumber || `EXP-${(tx._id || '').slice(-6)}`,
        date: formatDateAr(tx.date),
        time: formatTimeAr(tx.date),
        status: 'مدفوع',
        branding,

        supplier: {
            id: supplier._id,
            name: supplier.name || 'مورد نقدي',
            phone: supplier.phone || '',
            address: supplier.address || '',
            taxNumber: supplier.taxNumber || '',
            balance: Number(supplier.balance || 0),
            linkedCustomer: supplier.linkedCustomer || null,
        },

        transaction: {
            id: tx._id,
            referenceType: tx.referenceType,
            referenceTypeLabel: labelReferenceType(tx.referenceType),
            referenceNumber: reference?.number || (tx.referenceId ? String(tx.referenceId) : ''),
            reference: reference,
            description: tx.description || '',
            createdBy: tx.createdBy?.name || 'النظام',
        },

        payment: {
            method: paymentMethod,
            methodLabel: labelMethod(paymentMethod),
            channel: paymentChannel,
            channelLabel: channelLabelAr(paymentChannel),
            // For non-electronic channels the source number has no
            // business meaning — show it only when electronic.
            sourceNumber: isElectronic
                ? (canSeeSource ? (rawSource || '') : (rawSource ? maskIt(rawSource) : ''))
                : '',
            isElectronic,
        },

        paidAmount: amount,
        previousBalance,
        remainingBalance,
        currentSupplierBalance: currentBalance,

        generatedAt: new Date().toISOString(),
        generatedBy: user?.name || 'النظام',
        filters: {},
    };
}

export default { fetch };
