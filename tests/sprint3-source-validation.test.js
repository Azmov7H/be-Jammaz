import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
    sourceRequired,
    sourceMissing,
    sourceRequiredMethods,
    sourceRequiredRefine,
    customerPaymentSchema,
    supplierPaymentSchema,
    debtPaymentSchema,
    counterpartyPaymentSchema,
    expenseSchema,
    treasuryTransactionSchema,
    invoiceSchema,
    purchaseOrderSchema,
} from '../validations/validators.js';
import { maskSource } from '../services/treasuryService.js';

const ID = 'a'.repeat(24);
const PID = 'b'.repeat(24);

// Sprint 3 — FIN-VAL-002/003: transfer-source validation. InstaPay & Cash
// Wallet payments MUST carry a sourceNumber; cash/bank/check/adjustment/credit
// must accept it empty (REQ-VAL-003/004).
describe('Sprint 3 — requiresSourceNumber helpers (FIN-VAL-002)', () => {
    it('sourceRequired is true only for instapay and wallet', () => {
        expect(sourceRequired('instapay')).toBe(true);
        expect(sourceRequired('wallet')).toBe(true);
        expect(sourceRequired('cash')).toBe(false);
        expect(sourceRequired('bank')).toBe(false);
        expect(sourceRequired('check')).toBe(false);
        expect(sourceRequired('adjustment')).toBe(false);
        expect(sourceRequired('credit')).toBe(false);
        expect(sourceRequired(undefined)).toBe(false);
    });

    it('sourceMissing flags blank source only for required methods', () => {
        expect(sourceMissing('instapay', undefined)).toBe(true);
        expect(sourceMissing('wallet', '')).toBe(true);
        expect(sourceMissing('wallet', '   ')).toBe(true);
        expect(sourceMissing('instapay', '12345')).toBe(false);
        expect(sourceMissing('cash', undefined)).toBe(false);
        expect(sourceMissing('bank', '')).toBe(false);
    });

    it('sourceRequiredMethods is [instapay, wallet]', () => {
        expect(sourceRequiredMethods).toEqual(['instapay', 'wallet']);
    });
});

const expectFieldErr = (r, field = 'sourceNumber') => {
    expect(r.success).toBe(false);
    expect(r.error.issues.some(i => i.path[0] === field)).toBe(true);
};
const expectOk = (r) => expect(r.success).toBe(true);

describe('Sprint 3 — payment schemas reject missing source for instapay/wallet', () => {
    it('customerPaymentSchema: wallet w/o source -> reject; w/ source -> ok; cash -> ok', () => {
        expectFieldErr(customerPaymentSchema.safeParse({ invoice: ID, amount: 100, method: 'wallet' }));
        expectOk(customerPaymentSchema.safeParse({ invoice: ID, amount: 100, method: 'wallet', sourceNumber: '12345' }));
        expectOk(customerPaymentSchema.safeParse({ invoice: ID, amount: 100, method: 'instapay', sourceNumber: 'X' }));
        expectOk(customerPaymentSchema.safeParse({ invoice: ID, amount: 100, method: 'cash' }));
    });

    it('supplierPaymentSchema: instapay w/o source -> reject', () => {
        expectFieldErr(supplierPaymentSchema.safeParse({ po: ID, amount: 100, method: 'instapay' }));
        expectOk(supplierPaymentSchema.safeParse({ po: ID, amount: 100, method: 'instapay', sourceNumber: 'S' }));
        expectOk(supplierPaymentSchema.safeParse({ po: ID, amount: 100, method: 'check' }));
    });

    it('debtPaymentSchema: wallet w/o source -> reject', () => {
        expectFieldErr(debtPaymentSchema.safeParse({ debt: ID, amount: 100, method: 'wallet' }));
        expectOk(debtPaymentSchema.safeParse({ debt: ID, amount: 100, method: 'wallet', sourceNumber: 'W' }));
    });

    it('counterpartyPaymentSchema: dispatcher form rejects missing source', () => {
        expectFieldErr(counterpartyPaymentSchema.safeParse({ customerId: ID, amount: 100, method: 'instapay' }));
        expectOk(counterpartyPaymentSchema.safeParse({ customerId: ID, amount: 100, method: 'instapay', sourceNumber: 'D' }));
    });

    it('expenseSchema: instapay w/o source -> reject', () => {
        expectFieldErr(expenseSchema.safeParse({ amount: 50, reason: 'test', category: 'other', method: 'instapay' }));
        expectOk(expenseSchema.safeParse({ amount: 50, reason: 'test', category: 'other', method: 'instapay', sourceNumber: 'E' }));
    });

    it('treasuryTransactionSchema: wallet w/o source -> reject; cash -> ok', () => {
        expectFieldErr(treasuryTransactionSchema.safeParse({ amount: 50, description: 'test', type: 'INCOME', method: 'wallet' }));
        expectOk(treasuryTransactionSchema.safeParse({ amount: 50, description: 'test', type: 'INCOME', method: 'wallet', sourceNumber: 'T' }));
        expectOk(treasuryTransactionSchema.safeParse({ amount: 50, description: 'test', type: 'EXPENSE', method: 'cash' }));
    });

    it('invoiceSchema: instapay sale w/o source -> reject; w/ source -> ok; cash -> ok', () => {
        const base = { items: [{ qty: 1, unitPrice: 10 }] };
        expectFieldErr(invoiceSchema.safeParse({ ...base, paymentType: 'instapay' }));
        expectOk(invoiceSchema.safeParse({ ...base, paymentType: 'instapay', sourceNumber: 'I' }));
        expectOk(invoiceSchema.safeParse({ ...base, paymentType: 'cash' }));
    });

    it('purchaseOrderSchema: wallet PO w/o source -> reject; w/ source -> ok; cash -> ok', () => {
        const base = { supplierId: ID, items: [{ productId: PID, quantity: 1, costPrice: 10 }] };
        expectFieldErr(purchaseOrderSchema.safeParse({ ...base, paymentType: 'wallet' }));
        expectOk(purchaseOrderSchema.safeParse({ ...base, paymentType: 'wallet', sourceNumber: 'P' }));
        expectOk(purchaseOrderSchema.safeParse({ ...base, paymentType: 'cash' }));
    });

    it('invoiceSchema switch from credit to instapay still enforces source', () => {
        // credit requires customer; instapay requires source. Both applied.
        const r = invoiceSchema.safeParse({ items: [{ qty: 1, unitPrice: 10 }], paymentType: 'instapay' });
        expectFieldErr(r);
    });
});

describe('Sprint 3 — sourceRequiredRefine wiring', () => {
    it('returns a superRefine-able schema that rejects at sourceNumber path', () => {
        const schema = sourceRequiredRefine(
            z.object({ method: z.string().optional(), sourceNumber: z.string().optional() })
        );
        const parsed = schema.safeParse({ method: 'wallet' });
        expectFieldErr(parsed);
    });
});

describe('Sprint 3 — maskSource (FIN-SVC-002)', () => {
    it('masks long sources keeping head+tail, hides short ones', () => {
        expect(maskSource('12345678')).toBe('123****78');
        expect(maskSource('1234')).toBe('****');
        expect(maskSource('')).toBe('');
        expect(maskSource(undefined)).toBe('');
        expect(maskSource(null)).toBe('');
    });
});
