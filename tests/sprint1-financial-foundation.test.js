import { describe, it, expect } from 'vitest';
import {
    treasuryTransactionSchema,
    invoiceSchema,
    purchaseOrderSchema,
    poStatusSchema,
    poReceiveSchema,
    customerPaymentSchema,
    supplierPaymentSchema,
    counterpartyPaymentSchema,
    debtPaymentSchema,
    expenseSchema,
} from '../validations/index.js';
import TreasuryTransaction from '../models/TreasuryTransaction.js';
import CashboxDaily from '../models/CashboxDaily.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';

const OID = 'a'.repeat(24);

describe('Sprint 1 — financial foundation (FIN-MDL / FIN-VAL)', () => {
    it('Zod paymentMethod enum now accepts instapay and adjustment', () => {
        for (const m of ['instapay', 'adjustment', 'cash', 'bank', 'wallet', 'check']) {
            expect(
                treasuryTransactionSchema.safeParse({
                    amount: 10, description: 'sale', type: 'INCOME', method: m,
                }).success
            ).toBe(true);
        }
    });

    it('treasuryTransaction accepts sourceNumber (optional, DB-backward-compatible)', () => {
        expect(
            treasuryTransactionSchema.safeParse({
                amount: 10, description: 'sale', type: 'INCOME', method: 'instapay', sourceNumber: 'IP-123',
            }).success
        ).toBe(true);
        // omitted sourceNumber still valid (required only for NEW instapay/wallet in Sprint 3)
        expect(
            treasuryTransactionSchema.safeParse({
                amount: 10, description: 'sale', type: 'INCOME', method: 'cash',
            }).success
        ).toBe(true);
    });

    it('invoice & PO paymentType accept instapay', () => {
        expect(invoiceSchema.safeParse({
            items: [{ name: 'p', qty: 1, unitPrice: 10 }],
            paymentType: 'instapay',
        }).success).toBe(true);
        expect(purchaseOrderSchema.safeParse({
            items: [{ productId: OID, quantity: 1, costPrice: 5 }],
            paymentType: 'instapay',
        }).success).toBe(true);
        expect(poStatusSchema.safeParse({ status: 'RECEIVED', paymentType: 'instapay' }).success).toBe(true);
        expect(poReceiveSchema.safeParse({ paymentType: 'instapay' }).success).toBe(true);
    });

    it('invoice payments array accepts instapay method + sourceNumber', () => {
        const r = invoiceSchema.safeParse({
            items: [{ name: 'p', qty: 1, unitPrice: 10 }],
            paymentType: 'instapay',
            payments: [{ amount: 10, method: 'instapay', sourceNumber: 'IP-9' }],
        });
        expect(r.success).toBe(true);
    });

    it('payment schemas accept sourceNumber (Sprint 3 will require it for instapay/wallet)', () => {
        const base = { amount: 10, method: 'instapay', sourceNumber: 'IP-1' };
        expect(customerPaymentSchema.safeParse({ ...base, invoice: OID }).success).toBe(true);
        expect(supplierPaymentSchema.safeParse({ ...base, po: OID }).success).toBe(true);
        expect(counterpartyPaymentSchema.safeParse({ ...base, customerId: OID }).success).toBe(true);
        expect(debtPaymentSchema.safeParse({ ...base, debt: OID }).success).toBe(true);
        expect(expenseSchema.safeParse({
            amount: 10, reason: 'rent', category: 'util', method: 'instapay', sourceNumber: 'IP-1',
        }).success).toBe(true);
    });

    it('TreasuryTransaction model enum includes instapay + adjustment', () => {
        const enumValues = TreasuryTransaction.schema.path('method').enumValues;
        expect(enumValues).toContain('instapay');
        expect(enumValues).toContain('adjustment');
        expect(TreasuryTransaction.schema.path('sourceNumber')).toBeDefined();
    });

    it('CashboxDaily model has instapay breakdown fields', () => {
        const s = CashboxDaily.schema;
        for (const f of ['openingInstapayBalance', 'instapayIncome', 'instapayExpenses', 'closingInstapayBalance']) {
            expect(s.path(f)).toBeDefined();
        }
    });

    it('Invoice model paymentType/payments enum includes instapay + sourceNumber', () => {
        expect(Invoice.schema.path('paymentType').enumValues).toContain('instapay');
        const pm = Invoice.schema.path('payments').schema.path('method');
        expect(pm.enumValues).toContain('instapay');
        expect(Invoice.schema.path('payments').schema.path('sourceNumber')).toBeDefined();
    });

    it('PurchaseOrder model paymentType enum includes instapay', () => {
        expect(PurchaseOrder.schema.path('paymentType').enumValues).toContain('instapay');
    });

    it('Customer/Supplier models carry unification fields (FIN-MDL-005)', () => {
        expect(Customer.schema.path('taxNumber')).toBeDefined();
        expect(Customer.schema.path('isSupplier')).toBeDefined();
        expect(Customer.schema.path('linkedSupplier')).toBeDefined();
        expect(Supplier.schema.path('taxNumber')).toBeDefined();
        expect(Supplier.schema.path('isCustomer')).toBeDefined();
        expect(Supplier.schema.path('linkedCustomer')).toBeDefined();
    });
});
