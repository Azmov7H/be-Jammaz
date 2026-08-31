/**
 * DOC-SHARED-002 — Payment method → treasury channel mapping.
 *
 * The system stores a single `method` enum on every financial record
 * (cash / bank / wallet / check / adjustment / instapay). Documents must
 * show the user-friendly channel label (e.g. "الخزينة الخاصة" for cash,
 * "انستا باي" for instapay) alongside the method label.
 *
 * This module is the SINGLE source of truth for that mapping. Documents
 * and the TreasuryService share the same channel vocabulary.
 */

export const TREASURY_CHANNELS = Object.freeze({
    PRIVATE_TREASURY: 'private_treasury',
    BANK: 'bank',
    CASH_WALLET: 'cash_wallet',
    INSTAPAY: 'instapay',
    CHECK: 'check',
    ADJUSTMENT: 'adjustment',
    UNKNOWN: 'unknown',
});

const METHOD_TO_CHANNEL = Object.freeze({
    cash: TREASURY_CHANNELS.PRIVATE_TREASURY,
    bank: TREASURY_CHANNELS.BANK,
    wallet: TREASURY_CHANNELS.CASH_WALLET,
    instapay: TREASURY_CHANNELS.INSTAPAY,
    check: TREASURY_CHANNELS.CHECK,
    adjustment: TREASURY_CHANNELS.ADJUSTMENT,
});

/**
 * Resolve a payment method to its treasury channel.
 * Returns 'unknown' for null/undefined/unrecognized values so documents
 * can render a fallback label instead of crashing.
 *
 * @param {string|null|undefined} method
 * @returns {string} one of TREASURY_CHANNELS
 */
export function methodToChannel(method) {
    if (method == null) return TREASURY_CHANNELS.UNKNOWN;
    const m = String(method).toLowerCase();
    return METHOD_TO_CHANNEL[m] || TREASURY_CHANNELS.UNKNOWN;
}

export const CHANNEL_LABELS_AR = Object.freeze({
    [TREASURY_CHANNELS.PRIVATE_TREASURY]: 'الخزينة الخاصة',
    [TREASURY_CHANNELS.BANK]: 'البنك',
    [TREASURY_CHANNELS.CASH_WALLET]: 'محفظة الكاش',
    [TREASURY_CHANNELS.INSTAPAY]: 'انستا باي',
    [TREASURY_CHANNELS.CHECK]: 'الشيكات',
    [TREASURY_CHANNELS.ADJUSTMENT]: 'تسويات',
    [TREASURY_CHANNELS.UNKNOWN]: 'غير محدد',
});

/**
 * Arabic label for a channel value.
 * @param {string} channel
 * @returns {string}
 */
export function channelLabelAr(channel) {
    return CHANNEL_LABELS_AR[channel] || channel;
}
