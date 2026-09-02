/**
 * DOC-CCR-001..003 — customerCollectionReceipt fetcher.
 *
 * Loads a single TreasuryTransaction (INCOME) and the live customer
 * + branding, shaping the result into the canonical
 * CUSTOMER_COLLECTION_RECEIPT DocumentData.
 *
 * Type disambiguation: this fetcher ONLY returns success for
 * customer-side receipts. Supplier / expense transactions throw
 * NotFoundError so the supplier fetcher (S7) can take over.
 *
 * Convention: 'previousBalance' is the customer's pre-transaction
 * balance; 'remainingBalance' is post-transaction. Both are
 * computed from the same live customer doc snapshot (we read the
 * balance before applying the transaction's effect, then the balance
 * after the model has reconciled it — in practice these arrive
 * already-applied so we approximate 'previous' as
 * 'current + amount' for an INCOME collection).
 *
 * PII: sourceNumber is masked unless the role is owner | manager.
 */

import dbConnect from '../../lib/db.js';
import TreasuryTransaction from '../../models/TreasuryTransaction.js';
import Customer from '../../models/Customer.js';
import Invoice from '../../models/Invoice.js';
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
    Invoice: 'فاتورة مبيعات',
    Debt: 'مديونية سابقة',
    UnifiedCollection: 'تحصيل مجمع',
    Manual: 'تحصيل يدوي',
});

function labelMethod(method) {
    if (!method) return '—';
    return PAYMENT_METHOD_LABELS[method] || method;
}

function labelReferenceType(rt) {
    if (!rt) return 'تحصيل يدوي';
    return REFERENCE_TYPE_LABELS[rt] || 'تحصيل';
}

function formatDateAr(d) {
    if (!d) return '';
    try { return format(new Date(d), 'dd MMMM yyyy', { locale: ar }); }
    catch { return new Date(d).toISOString().slice(0, 10); }
}

function formatTimeAr(d) {
    if (!d) return '';
    try { return format(new Date(d), 'HH:mm', { locale: ar }); }
    catch { return ''; }
}

function formatMoney(n) {
    return (Number(n) || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
}

function maskIt(value) {
    if (value == null || String(value).trim() === '') return '';
    const s = String(value).trim();
    if (s.length <= 4) return '••••';
    return `•••• ${s.slice(-4)}`;
}

/**
 * Decide whether the transaction is a CUSTOMER collection.
 * Returns the partnerId to look up, or null if this isn't a customer
 * receipt (and the caller should throw NotFoundError so the supplier
 * fetcher can take over).
 */
function pickCustomerPartnerId(tx) {
    // UnifiedCollection + Customer referenceType → customer
    if (tx.referenceType === 'UnifiedCollection') {
        return tx.referenceId || tx.partnerId || null;
    }
    if (tx.referenceType === 'Customer') {
        return tx.referenceId || tx.partnerId || null;
    }
    // Debt payments where the debt is owed by a customer
    if (tx.referenceType === 'Debt') {
        return tx.partnerId || null;
    }
    // Invoice collections (a customer pays an invoice) — partnerId
    // is set when the request targets a specific customer.
    if (tx.referenceType === 'Invoice' && tx.partnerId) {
        return tx.partnerId;
    }
    // Manual income entries with a customer partnerId
    if (tx.referenceType === 'Manual' && tx.partnerId) {
        return tx.partnerId;
    }
    return null;
}

/**
 * @param {{ id: string }} params
 * @param {{ user: { role: string, _id: string, name?: string } }} ctx
 * @returns {Promise<object>} CUSTOMER_COLLECTION_RECEIPT DocumentData
 */
export async function fetch(params, { user }) {
    if (!params?.id) {
        throw new NotFoundError('رقم السند مطلوب');
    }
    await dbConnect();

    const tx = await TreasuryTransaction.findById(params.id)
        .populate('referenceId')
        .populate('createdBy', 'name')
        .lean();
    if (!tx) throw new NotFoundError('السند غير موجود');

    // Type disambiguation: only INCOME transactions with a customer
    // partner are valid here. Supplier / expense / transfer transactions
    // throw so the supplier fetcher (S7) handles them.
    if (tx.type !== 'INCOME') {
        throw new NotFoundError('هذا السند ليس سند تحصيل عميل');
    }

    const partnerObjectId = pickCustomerPartnerId(tx);
    if (!partnerObjectId) {
        throw new NotFoundError('هذا السند ليس سند تحصيل عميل');
    }

    // Load the customer.
    const customer = await Customer.findById(partnerObjectId)
        .select('name phone address taxNumber balance creditBalance isSupplier linkedSupplier')
        .lean();
    if (!customer) {
        // The transaction references a customer that no longer exists;
        // surface a clear error so the user can investigate.
        throw new NotFoundError('العميل المرتبط بهذا السند غير موجود');
    }

    // Compute previous balance (best-effort, since the live balance
    // already reflects this transaction's effect). For INCOME, the
    // customer's balance dropped by `tx.amount`, so previous = current
    // + amount. For returns (EXPENSE), previous = current - amount, but
    // a return is never a customer collection — we already rejected
    // non-INCOME.
    const currentBalance = Number(customer.balance) || 0;
    const txAmount = Number(tx.amount) || 0;
    const previousBalance = currentBalance + txAmount;
    const remainingBalance = currentBalance;

    const branding = await getBranding();

    // Resolve the original invoice reference (for the "مرجع العملية" block).
    let referenceNumber = '';
    if (tx.referenceType === 'Invoice' && tx.referenceId && typeof tx.referenceId === 'object') {
        referenceNumber = tx.referenceId.number || '';
    } else if (tx.referenceType === 'UnifiedCollection') {
        referenceNumber = 'تحصيل مجمع';
    } else if (tx.receiptNumber) {
        referenceNumber = tx.receiptNumber;
    } else {
        referenceNumber = '—';
    }

    const canSeeSource = canSeeFullSourceNumber(user?.role);
    const rawSource = tx.sourceNumber || '';
    const isElectronic = tx.method === 'instapay' || tx.method === 'wallet';
    const maskedSource = isElectronic && rawSource
        ? (canSeeSource ? rawSource : maskIt(rawSource))
        : '';

    const method = tx.method || 'cash';
    const channel = methodToChannel(method);
    const txDate = tx.date || tx.createdAt;

    return {
        type: 'CUSTOMER_COLLECTION_RECEIPT',
        title: 'سند تحصيل من عميل',
        documentType: 'customer-collection-receipt',
        receiptNumber: tx.receiptNumber
            || `TR-${String(tx._id).slice(-6).toUpperCase()}`,
        date: formatDateAr(txDate),
        time: formatTimeAr(txDate),
        status: 'مدفوع',
        branding,

        customer: {
            id: customer._id,
            name: customer.name || 'عميل',
            phone: customer.phone || '',
            address: customer.address || '',
            taxNumber: customer.taxNumber || '',
            linkedSupplier: customer.linkedSupplier || null,
        },

        transaction: {
            id: tx._id,
            amount: txAmount,
            description: tx.description || '',
            referenceType: tx.referenceType || 'Manual',
            referenceTypeLabel: labelReferenceType(tx.referenceType),
            referenceNumber,
            referenceId: tx.referenceId && typeof tx.referenceId === 'object'
                ? tx.referenceId._id
                : tx.referenceId || null,
            createdBy: tx.createdBy?.name || '',
        },

        previousBalance,
        remainingBalance,
        collectedAmount: txAmount,

        payment: {
            method,
            methodLabel: labelMethod(method),
            channel,
            channelLabel: channelLabelAr(channel),
            // For non-electronic channels, the source number has no
            // business meaning — hide it entirely.
            sourceNumber: isElectronic ? maskedSource : '',
            isElectronic,
        },

        generatedAt: new Date(),
        generatedBy: { _id: user?._id, name: user?.name || 'النظام' },
        filters: {},
    };
}

export default { fetch };
