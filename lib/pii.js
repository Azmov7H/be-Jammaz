/**
 * Shared sourceNumber PII policy (SEC-PII-001 / SEC-PII-002).
 *
 * `sourceNumber` is a sensitive identifier (bank / electronic-wallet transfer
 * reference). Only privileged roles must ever receive the full value; all other
 * roles (cashier, warehouse, viewer) get it masked to `•••• <last4>`.
 *
 * These helpers are applied at the response boundary so the masking rule lives
 * in ONE place and is reused across list/detail/receipt endpoints.
 */

const PRIVILEGED_ROLES = ['owner', 'manager'];

/**
 * True when `role` may see the full (unmasked) source number.
 * @param {string|undefined} role
 * @returns {boolean}
 */
export function canSeeFullSourceNumber(role) {
    return PRIVILEGED_ROLES.includes(role);
}

/**
 * Mask a transfer source number for display (PII-friendly, UX-005).
 * Shows `••••` + last 4 digits (e.g. `•••• 4821`); blank/short collapse.
 * @param {*} value
 * @returns {string}
 */
export function maskSource(value) {
    if (value == null || String(value).trim() === '') return '';
    const s = String(value).trim();
    if (s.length <= 4) return '••••';
    return `•••• ${s.slice(-4)}`;
}

/**
 * In-place mask of a single lean document's `sourceNumber` according to role.
 * Idempotent: a value that is already masked is left unchanged (head is `••••`).
 * @param {object|null} doc
 * @param {string|undefined} role
 * @returns {object|null}
 */
export function maskDocSource(doc, role) {
    if (doc && doc.sourceNumber != null) {
        if (canSeeFullSourceNumber(role)) return doc;
        const masked = maskSource(doc.sourceNumber);
        if (masked) doc.sourceNumber = masked;
    }
    return doc;
}

/**
 * In-place mask across a collection of docs. Accepts a plain array, or an
 * object whose `data`/`invoices`/`transactions`/`recentTransactions` field is
 * an array, or a single doc. Returns the same reference for chaining.
 * @param {*} result
 * @param {string|undefined} role
 * @returns {*}
 */
export function maskSourceInResult(result, role) {
    if (!result || typeof result !== 'object') return result;

    if (Array.isArray(result)) {
        for (const d of result) maskDocSource(d, role);
        return result;
    }

    for (const key of ['data', 'invoices', 'transactions', 'recentTransactions']) {
        const val = result[key];
        if (Array.isArray(val)) {
            for (const d of val) maskDocSource(d, role);
        } else if (val && typeof val === 'object') {
            maskDocSource(val, role);
        }
    }
    return result;
}
