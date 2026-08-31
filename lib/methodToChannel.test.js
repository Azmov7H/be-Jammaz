/**
 * T-UNIT-DOC-008 — methodToChannel mapping.
 *
 * Single source of truth for translating the financial `method` enum
 * (cash / bank / wallet / check / adjustment / instapay) into the
 * user-facing treasury channel vocabulary used across every document.
 */

import { describe, it, expect } from 'vitest';
import {
    TREASURY_CHANNELS,
    methodToChannel,
    channelLabelAr,
    CHANNEL_LABELS_AR,
} from './methodToChannel.js';

describe('methodToChannel', () => {
    const cases = [
        ['cash', TREASURY_CHANNELS.PRIVATE_TREASURY],
        ['bank', TREASURY_CHANNELS.BANK],
        ['wallet', TREASURY_CHANNELS.CASH_WALLET],
        ['instapay', TREASURY_CHANNELS.INSTAPAY],
        ['check', TREASURY_CHANNELS.CHECK],
        ['adjustment', TREASURY_CHANNELS.ADJUSTMENT],
    ];

    it.each(cases)('maps %s → %s', (method, expected) => {
        expect(methodToChannel(method)).toBe(expected);
    });

    it('returns "unknown" for null / undefined / empty', () => {
        expect(methodToChannel(null)).toBe(TREASURY_CHANNELS.UNKNOWN);
        expect(methodToChannel(undefined)).toBe(TREASURY_CHANNELS.UNKNOWN);
        expect(methodToChannel('')).toBe(TREASURY_CHANNELS.UNKNOWN);
    });

    it('returns "unknown" for an unrecognized method', () => {
        expect(methodToChannel('credit')).toBe(TREASURY_CHANNELS.UNKNOWN);
        expect(methodToChannel('credit_balance')).toBe(TREASURY_CHANNELS.UNKNOWN);
        expect(methodToChannel('garbage')).toBe(TREASURY_CHANNELS.UNKNOWN);
    });

    it('is case-insensitive', () => {
        expect(methodToChannel('CASH')).toBe(TREASURY_CHANNELS.PRIVATE_TREASURY);
        expect(methodToChannel('InstaPay')).toBe(TREASURY_CHANNELS.INSTAPAY);
    });

    it('TREASURY_CHANNELS is frozen', () => {
        expect(Object.isFrozen(TREASURY_CHANNELS)).toBe(true);
    });
});

describe('channelLabelAr', () => {
    it('returns the Arabic label for every known channel', () => {
        for (const [channel, label] of Object.entries(CHANNEL_LABELS_AR)) {
            expect(channelLabelAr(channel)).toBe(label);
        }
    });

    it('returns the channel value itself for unknown channels', () => {
        expect(channelLabelAr('mystery_channel')).toBe('mystery_channel');
    });

    it('every documented channel has an Arabic label', () => {
        const knownChannels = [
            TREASURY_CHANNELS.PRIVATE_TREASURY,
            TREASURY_CHANNELS.BANK,
            TREASURY_CHANNELS.CASH_WALLET,
            TREASURY_CHANNELS.INSTAPAY,
            TREASURY_CHANNELS.CHECK,
            TREASURY_CHANNELS.ADJUSTMENT,
        ];
        for (const c of knownChannels) {
            expect(CHANNEL_LABELS_AR[c]).toBeTruthy();
        }
    });
});
