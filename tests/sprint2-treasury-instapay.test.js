import { describe, it, expect } from 'vitest';
import {
    fieldFor,
    methodLabel,
    METHOD_INCOME_FIELD,
    METHOD_EXPENSE_FIELD,
} from '../services/treasuryService.js';

// Sprint 2 — FIN-SVC-001: the canonical method -> CashboxDaily field map must
// cover every supported channel (including instapay) for both directions. These
// are pure helpers; the money-path behaviour they feed is covered by the HTTP
// integration suites (treasuryBalance / moneyFlow).
describe('Sprint 2 — treasury instapay channel (FIN-SVC-001)', () => {
    it('METHOD_INCOME_FIELD covers instapay + all legacy methods', () => {
        expect(METHOD_INCOME_FIELD).toEqual({
            cash: 'salesIncome',
            bank: 'bankIncome',
            wallet: 'walletIncome',
            check: 'checkIncome',
            instapay: 'instapayIncome',
        });
    });

    it('METHOD_EXPENSE_FIELD covers instapay + all legacy methods', () => {
        expect(METHOD_EXPENSE_FIELD).toEqual({
            cash: 'purchaseExpenses',
            bank: 'bankExpenses',
            wallet: 'walletExpenses',
            check: 'checkExpenses',
            instapay: 'instapayExpenses',
        });
    });

    it('fieldFor resolves income fields for every method incl. instapay', () => {
        for (const [method, field] of Object.entries(METHOD_INCOME_FIELD)) {
            expect(fieldFor(method, 'INCOME')).toBe(field);
        }
    });

    it('fieldFor resolves expense fields for every method incl. instapay', () => {
        for (const [method, field] of Object.entries(METHOD_EXPENSE_FIELD)) {
            expect(fieldFor(method, 'EXPENSE')).toBe(field);
        }
    });

    it('fieldFor falls back to cash for unknown/legacy methods (backward compatible)', () => {
        expect(fieldFor(undefined, 'INCOME')).toBe('salesIncome');
        expect(fieldFor(null, 'EXPENSE')).toBe('purchaseExpenses');
        expect(fieldFor('unknown', 'INCOME')).toBe('salesIncome');
        expect(fieldFor('credit', 'EXPENSE')).toBe('purchaseExpenses');
    });

    it('methodLabel renders an Arabic suffix for instapay and blanks for cash', () => {
        expect(methodLabel('instapay')).toBe('(انستا باي)');
        expect(methodLabel('bank')).toBe('(بنك)');
        expect(methodLabel('wallet')).toBe('(محفظة)');
        expect(methodLabel('check')).toBe('(شيك)');
        expect(methodLabel('cash')).toBe('');
        expect(methodLabel('adjustment')).toBe('');
    });
});
