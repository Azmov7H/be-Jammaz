import { describe, it, expect } from 'vitest';
// T-TST-05: repointed to the canonical barrel (validations/index.js) so the
// test fails if anyone re-splits schemas into parallel modules.
import {
    idSchema,
    paginationSchema,
    loginSchema,
    userSchema,
    productSchema,
    invoiceSchema,
    expenseSchema,
} from '../validations/index.js';

const OID = 'a'.repeat(24);

describe('Validators sanity check (canonical barrel)', () => {
    it('expense schema accepts a valid expense', () => {
        const result = expenseSchema.safeParse({
            amount: 100,
            reason: 'Test Expense',
            category: 'General',
        });
        expect(result.success).toBe(true);
    });

    it('invoice schema rejects an empty payload', () => {
        expect(invoiceSchema.safeParse({}).success).toBe(false);
    });

    it('product schema enforces Arabic min-length messages', () => {
        // missing fields yield invalid_type; empty strings hit the Arabic min(1) messages
        const result = productSchema.safeParse({ name: '', code: '' });
        expect(result.success).toBe(false);
        const messages = JSON.stringify(result.error?.issues ?? []);
        expect(messages).toContain('اسم المنتج مطلوب');
        expect(messages).toContain('كود المنتج مطلوب');
    });
});

describe('T-VAL-03 bounds — idSchema', () => {
    it('accepts 24-char hex, rejects everything else', () => {
        expect(idSchema.safeParse(OID).success).toBe(true);
        expect(idSchema.safeParse('f'.repeat(24)).success).toBe(true);
        expect(idSchema.safeParse('short').success).toBe(false);
        expect(idSchema.safeParse('z'.repeat(24)).success).toBe(false); // non-hex
        expect(idSchema.safeParse(OID + 'ff').success).toBe(false);
        expect(idSchema.safeParse(12345).success).toBe(false);
    });
});

describe('T-VAL-03 bounds — paginationSchema', () => {
    it('applies defaults and coerces numeric strings', () => {
        const parsed = paginationSchema.parse({});
        expect(parsed).toMatchObject({ page: 1, limit: 20 });

        const coerced = paginationSchema.parse({ page: '3', limit: '50' });
        expect(coerced).toMatchObject({ page: 3, limit: 50 });
    });

    it('rejects page<1, non-integer page, and limit>100', () => {
        expect(paginationSchema.safeParse({ page: 0 }).success).toBe(false);
        expect(paginationSchema.safeParse({ page: -2 }).success).toBe(false);
        expect(paginationSchema.safeParse({ page: 1.5 }).success).toBe(false);
        expect(paginationSchema.safeParse({ limit: 101 }).success).toBe(false);
        expect(paginationSchema.safeParse({ limit: 0 }).success).toBe(false);
        // boundary values pass
        expect(paginationSchema.safeParse({ page: 1, limit: 100 }).success).toBe(true);
    });

    it('caps search length at 200', () => {
        expect(paginationSchema.safeParse({ search: 'x'.repeat(200) }).success).toBe(true);
        expect(paginationSchema.safeParse({ search: 'x'.repeat(201) }).success).toBe(false);
    });
});

describe('T-VAL-03 bounds — money & quantity caps', () => {
    const baseItem = { name: 'x', qty: 1, unitPrice: 10 };

    it('rejects prices above the 1e9 money ceiling', () => {
        expect(productSchema.safeParse({
            name: 'p', code: 'c', buyPrice: 1e9 + 1, retailPrice: 1,
        }).success).toBe(false);
        expect(invoiceSchema.safeParse({
            items: [{ ...baseItem, unitPrice: Number.MAX_SAFE_INTEGER }],
        }).success).toBe(false);
    });

    it('rejects negative prices and quantities', () => {
        expect(productSchema.safeParse({
            name: 'p', code: 'c', buyPrice: -1,
        }).success).toBe(false);
        expect(invoiceSchema.safeParse({
            items: [{ ...baseItem, qty: -5 }],
        }).success).toBe(false);
    });

    it('enforces positive qty with 1e6 ceiling on invoice items', () => {
        expect(invoiceSchema.safeParse({
            items: [{ ...baseItem, qty: 0 }],
        }).success).toBe(false);
        expect(invoiceSchema.safeParse({
            items: [{ ...baseItem, qty: 1e6 + 1 }],
        }).success).toBe(false);
        // boundary passes
        expect(invoiceSchema.safeParse({
            items: [{ ...baseItem, qty: 1e6 }],
        }).success).toBe(true);
    });

    it('caps invoice items array at 500', () => {
        const items = Array.from({ length: 501 }, () => ({ ...baseItem }));
        expect(invoiceSchema.safeParse({ items }).success).toBe(false);
    });
});

describe('Domain refinements', () => {
    const baseItem = { name: 'x', qty: 1, unitPrice: 10 };
    it('credit invoices require a customer (id or name+phone)', () => {
        const creditBase = { items: [baseItem], paymentType: 'credit' };
        expect(invoiceSchema.safeParse(creditBase).success).toBe(false);
        expect(invoiceSchema.safeParse({
            ...creditBase, customerId: OID,
        }).success).toBe(true);
        expect(invoiceSchema.safeParse({
            ...creditBase, customerName: 'علي', customerPhone: '0790000000',
        }).success).toBe(true);
    });

    it('login schema enforces email format and non-empty password', () => {
        expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
        expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
        expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    });

    it('user schema rejects dead roles (admin removed in Sprint 02)', () => {
        const result = userSchema.safeParse({
            name: 'Manager One', email: 'm@b.co', password: 'longenough', role: 'admin',
        });
        expect(result.success).toBe(false);
        expect(JSON.stringify(result.error?.issues ?? [])).toContain('الدور الوظيفي غير صالح');
        for (const role of ['owner', 'manager', 'cashier', 'warehouse', 'viewer']) {
            expect(userSchema.safeParse({
                name: 'Manager One', email: 'm@b.co', password: 'longenough', role,
            }).success).toBe(true);
        }
    });
});
