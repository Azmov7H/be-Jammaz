/**
 * T-UNIT-FETCH-007 — customerTransactionStatement fetcher unit tests.
 *
 * Locks:
 *  - the canonical DocumentData shape (type, customer, period,
 *    typeFilter, availableTypes, totals, lines, branding, ...)
 *  - the type filter contract: null when unset, one of
 *    INVOICE/PAYMENT/REFUND/DEBT when set, otherwise null
 *    (unknown values are silently ignored, NOT 400'd)
 *  - per-type line shapes:
 *      - INVOICE: debit = total, credit = 0
 *      - PAYMENT (INCOME): credit = amount, debit = 0
 *      - REFUND (EXPENSE / SalesReturn): debit or credit
 *        depending on source
 *      - DEBT: depends on direction (increase = debit, decrease = credit)
 *  - PII masking for sourceNumber on electronic channels
 *  - lines are sorted by date ascending
 *  - guard rails: invalid id, missing customer
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    customer: { findById: vi.fn() },
    invoice: { find: vi.fn() },
    tx: { find: vi.fn() },
    salesReturn: { find: vi.fn() },
    debt: { find: vi.fn() },
    branding: {
        getBranding: vi.fn(async () => ({
            companyName: 'مؤسستي',
            primaryColor: '#1B3C73',
            headerBgColor: '#1B3C73',
            address: '', phone: '', additionalPhones: [],
            email: '', website: '', footerText: 'شكراً',
        })),
    },
    db: { default: async () => ({}) },
}));

vi.mock('../../models/Customer.js', () => ({ default: mocks.customer }));
vi.mock('../../models/Invoice.js', () => ({ default: mocks.invoice }));
vi.mock('../../models/TreasuryTransaction.js', () => ({ default: mocks.tx }));
vi.mock('../../models/SalesReturn.js', () => ({ default: mocks.salesReturn }));
vi.mock('../../models/Debt.js', () => ({ default: mocks.debt }));
vi.mock('../../lib/branding.js', () => mocks.branding);
vi.mock('../../lib/db.js', () => mocks.db);

import { fetch } from './customerTransactionStatement.js';

const OID = 'a'.repeat(24);
const user = { _id: 'u1', name: 'Owner', role: 'owner' };
const userCashier = { _id: 'u2', name: 'Cashier', role: 'cashier' };

function makeCustomerChain(c) {
    return { select: vi.fn(() => ({ lean: vi.fn(async () => c) })) };
}

function makeFindChain(rows) {
    return {
        select: vi.fn(() => ({ lean: vi.fn(async () => rows) })),
        sort: vi.fn(() => ({ lean: vi.fn(async () => rows) }))
    };
}

function dateAt(yyyy, mm, dd) { return new Date(Date.UTC(yyyy, mm - 1, dd)); }

beforeEach(() => {
    vi.clearAllMocks();
    mocks.customer.findById.mockReturnValue(makeCustomerChain({
        _id: OID, name: 'شركة الأمل', phone: '010', address: 'Cairo',
        taxNumber: 'T1', balance: 1000, creditBalance: 0, linkedSupplier: null
    }));
    // Default: empty
    mocks.invoice.find.mockReturnValue(makeFindChain([]));
    mocks.tx.find.mockReturnValue(makeFindChain([]));
    mocks.salesReturn.find.mockReturnValue(makeFindChain([]));
    mocks.debt.find.mockReturnValue(makeFindChain([]));
});

describe('customerTransactionStatement fetcher — guards', () => {
    it('rejects an invalid id', async () => {
        await expect(fetch({ customerId: 'not-an-id', startDate: null, endDate: null, user }))
            .rejects.toThrow(/Customer not found/);
    });

    it('throws when customer is missing', async () => {
        mocks.customer.findById.mockReturnValue(makeCustomerChain(null));
        await expect(fetch({ customerId: OID, startDate: null, endDate: null, user }))
            .rejects.toThrow(/Customer not found/);
    });
});

describe('customerTransactionStatement fetcher — type filter', () => {
    it('no typeFilter when unset', async () => {
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        expect(data.typeFilter).toBe(null);
        expect(data.availableTypes).toHaveLength(4);
        expect(data.availableTypes.map(t => t.value)).toEqual(['INVOICE', 'PAYMENT', 'REFUND', 'DEBT']);
    });

    it('respects a valid type filter (INVOICE)', async () => {
        mocks.invoice.find.mockReturnValue(makeFindChain([
            { _id: OID, number: 'INV-1', date: dateAt(2026, 8, 10), total: 1000, type: 'sales', status: 'completed', paymentStatus: 'unpaid', paymentType: 'cash' }
        ]));
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'p', receiptNumber: 'R-1', type: 'INCOME', amount: 500, description: 'd', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, type: 'INVOICE', user });
        expect(data.typeFilter).toBe('INVOICE');
        expect(data.lineCount).toBe(1);
        expect(data.lines[0].type).toBe('INVOICE');
    });

    it('respects a valid type filter (PAYMENT)', async () => {
        mocks.invoice.find.mockReturnValue(makeFindChain([
            { _id: OID, number: 'INV-1', date: dateAt(2026, 8, 10), total: 1000, type: 'sales', status: 'completed', paymentStatus: 'unpaid', paymentType: 'cash' }
        ]));
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'p', receiptNumber: 'R-1', type: 'INCOME', amount: 500, description: 'd', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, type: 'PAYMENT', user });
        expect(data.typeFilter).toBe('PAYMENT');
        expect(data.lineCount).toBe(1);
        expect(data.lines[0].type).toBe('PAYMENT');
    });

    it('silently ignores an unknown type filter (does not 400)', async () => {
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, type: 'WAT', user });
        expect(data.typeFilter).toBe(null);
    });
});

describe('customerTransactionStatement fetcher — line shapes', () => {
    it('INVOICE: debit = total, credit = 0', async () => {
        mocks.invoice.find.mockReturnValue(makeFindChain([
            { _id: OID, number: 'INV-1', date: dateAt(2026, 8, 10), total: 1000, type: 'sales', status: 'completed', paymentStatus: 'unpaid', paymentType: 'cash' }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].debit).toBe(1000);
        expect(data.lines[0].credit).toBe(0);
        expect(data.lines[0].typeLabel).toBe('فاتورة مبيعات');
    });

    it('PAYMENT (INCOME): credit = amount, debit = 0', async () => {
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'p', receiptNumber: 'R-1', type: 'INCOME', amount: 500, description: 'تحصيل', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].credit).toBe(500);
        expect(data.lines[0].debit).toBe(0);
        expect(data.lines[0].typeLabel).toBe('تحصيل');
    });

    it('REFUND (EXPENSE): debit = amount, credit = 0', async () => {
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'r', receiptNumber: 'R-2', type: 'EXPENSE', amount: 200, description: 'مرتجع', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].debit).toBe(200);
        expect(data.lines[0].credit).toBe(0);
        expect(data.lines[0].typeLabel).toBe('مرتجع / صرف');
    });

    it('REFUND (SalesReturn): credit = totalRefund', async () => {
        mocks.salesReturn.find.mockReturnValue(makeFindChain([
            { _id: OID + 'sr', returnNumber: 'RET-1', date: dateAt(2026, 8, 5), totalRefund: 300 }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].credit).toBe(300);
        expect(data.lines[0].debit).toBe(0);
    });

    it('DEBT: increase → debit, decrease → credit', async () => {
        mocks.debt.find.mockReturnValue(makeFindChain([
            { _id: OID + 'd1', referenceNumber: 'DBT-1', date: dateAt(2026, 8, 1), amount: 100, status: 'open', direction: 'increase' },
            { _id: OID + 'd2', referenceNumber: 'DBT-2', date: dateAt(2026, 8, 2), amount: 50, status: 'settled', direction: 'decrease' },
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        // Sorted ascending: DBT-1 (increase, 100) then DBT-2 (decrease, 50)
        expect(data.lines[0].debit).toBe(100);
        expect(data.lines[0].credit).toBe(0);
        expect(data.lines[1].debit).toBe(0);
        expect(data.lines[1].credit).toBe(50);
    });

    it('lines are sorted by date ascending', async () => {
        mocks.invoice.find.mockReturnValue(makeFindChain([
            { _id: OID + 'i2', number: 'INV-2', date: dateAt(2026, 8, 20), total: 200, type: 'sales', status: 'completed', paymentStatus: 'unpaid', paymentType: 'cash' }
        ]));
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'p1', receiptNumber: 'R-1', type: 'INCOME', amount: 100, description: '', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        // First line should be the earlier date (2026-08-05)
        expect(new Date(data.lines[0].date).toISOString()).toContain('2026-08-05');
        expect(new Date(data.lines[1].date).toISOString()).toContain('2026-08-20');
    });
});

describe('customerTransactionStatement fetcher — PII', () => {
    it('hides sourceNumber for non-electronic channels (cash)', async () => {
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID, receiptNumber: 'R-1', type: 'INCOME', amount: 100, description: '', method: 'cash', sourceNumber: 'NOPE-1234', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].sourceNumber).toBe('');
    });

    it('masks sourceNumber for electronic channels when role is not privileged', async () => {
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID, receiptNumber: 'R-1', type: 'INCOME', amount: 100, description: '', method: 'instapay', sourceNumber: 'IPX-9988776655', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user: userCashier });
        expect(data.lines[0].sourceNumber).not.toContain('IPX-');
        expect(data.lines[0].sourceNumber).toMatch(/•+/);
    });

    it('shows sourceNumber for owner on electronic channels', async () => {
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID, receiptNumber: 'R-1', type: 'INCOME', amount: 100, description: '', method: 'instapay', sourceNumber: 'IPX-9988776655', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].sourceNumber).toBe('IPX-9988776655');
    });
});

describe('customerTransactionStatement fetcher — totals', () => {
    it('totals aggregate across all 4 event types', async () => {
        mocks.invoice.find.mockReturnValue(makeFindChain([
            { _id: OID + 'i', number: 'INV-1', date: dateAt(2026, 8, 10), total: 1000, type: 'sales', status: 'completed', paymentStatus: 'unpaid', paymentType: 'cash' }
        ]));
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'p', receiptNumber: 'R-1', type: 'INCOME', amount: 500, description: '', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        mocks.salesReturn.find.mockReturnValue(makeFindChain([
            { _id: OID + 'sr', returnNumber: 'RET-1', date: dateAt(2026, 8, 20), totalRefund: 100 }
        ]));
        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        expect(data.totals.debits).toBe(1000);
        expect(data.totals.credits).toBe(600); // 500 + 100
        expect(data.totals.net).toBe(400); // 1000 - 500 - 100
        expect(data.lineCount).toBe(3);
    });
});
