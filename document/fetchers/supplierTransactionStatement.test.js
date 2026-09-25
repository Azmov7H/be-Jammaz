/**
 * T-UNIT-FETCH-008 — supplierTransactionStatement fetcher unit tests.
 *
 * Mirror of customerTransactionStatement.test.js for the supplier side.
 *
 * Locks:
 *  - the canonical DocumentData shape (type, supplier, period,
 *    typeFilter, availableTypes, totals, lines, branding, ...)
 *  - the type filter contract: null when unset, one of
 *    PURCHASE/PAYMENT/REFUND/DEBT when set, otherwise null
 *    (unknown values are silently ignored, NOT 400'd)
 *  - per-type line shapes:
 *      - PURCHASE (received PO): debit = totalCost, credit = 0
 *      - PAYMENT (EXPENSE): credit = amount, debit = 0
 *      - REFUND (INCOME): debit = amount, credit = 0
 *      - DEBT: depends on direction (increase = debit, decrease = credit)
 *  - PII masking for sourceNumber on electronic channels
 *  - lines are sorted by date ascending
 *  - guard rails: invalid id, missing supplier
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    supplier: { findById: vi.fn() },
    purchaseOrder: { find: vi.fn() },
    tx: { find: vi.fn() },
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

vi.mock('../../models/Supplier.js', () => ({ default: mocks.supplier }));
vi.mock('../../models/PurchaseOrder.js', () => ({ default: mocks.purchaseOrder }));
vi.mock('../../models/TreasuryTransaction.js', () => ({ default: mocks.tx }));
vi.mock('../../models/Debt.js', () => ({ default: mocks.debt }));
vi.mock('../../lib/branding.js', () => mocks.branding);
vi.mock('../../lib/db.js', () => mocks.db);

import { fetch } from './supplierTransactionStatement.js';

const OID = 'a'.repeat(24);
const user = { _id: 'u1', name: 'Owner', role: 'owner' };
const userCashier = { _id: 'u2', name: 'Cashier', role: 'cashier' };

function makeSupplierChain(s) {
    return { select: vi.fn(() => ({ lean: vi.fn(async () => s) })) };
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
    mocks.supplier.findById.mockReturnValue(makeSupplierChain({
        _id: OID, name: 'شركة الأمل', phone: '010', address: 'Cairo',
        taxNumber: 'T1', balance: 1000, creditBalance: 0
    }));
    // Default: empty
    mocks.purchaseOrder.find.mockReturnValue(makeFindChain([]));
    mocks.tx.find.mockReturnValue(makeFindChain([]));
    mocks.debt.find.mockReturnValue(makeFindChain([]));
});

describe('supplierTransactionStatement fetcher — guards', () => {
    it('rejects an invalid id', async () => {
        await expect(fetch({ supplierId: 'not-an-id', startDate: null, endDate: null, user }))
            .rejects.toThrow(/Supplier not found/);
    });

    it('throws when supplier is missing', async () => {
        mocks.supplier.findById.mockReturnValue(makeSupplierChain(null));
        await expect(fetch({ supplierId: OID, startDate: null, endDate: null, user }))
            .rejects.toThrow(/Supplier not found/);
    });
});

describe('supplierTransactionStatement fetcher — type filter', () => {
    it('no typeFilter when unset', async () => {
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        expect(data.typeFilter).toBe(null);
        expect(data.availableTypes).toHaveLength(4);
        expect(data.availableTypes.map(t => t.value)).toEqual(['PURCHASE', 'PAYMENT', 'REFUND', 'DEBT']);
    });

    it('respects a valid type filter (PURCHASE)', async () => {
        mocks.purchaseOrder.find.mockReturnValue(makeFindChain([
            { _id: OID, poNumber: 'PO-1', receivedDate: dateAt(2026, 8, 10), totalCost: 1000, status: 'RECEIVED' }
        ]));
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'p', receiptNumber: 'R-1', type: 'EXPENSE', amount: 500, description: 'd', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, type: 'PURCHASE', user });
        expect(data.typeFilter).toBe('PURCHASE');
        expect(data.lineCount).toBe(1);
        expect(data.lines[0].type).toBe('PURCHASE');
    });

    it('respects a valid type filter (PAYMENT)', async () => {
        mocks.purchaseOrder.find.mockReturnValue(makeFindChain([
            { _id: OID, poNumber: 'PO-1', receivedDate: dateAt(2026, 8, 10), totalCost: 1000, status: 'RECEIVED' }
        ]));
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'p', receiptNumber: 'R-1', type: 'EXPENSE', amount: 500, description: 'd', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, type: 'PAYMENT', user });
        expect(data.typeFilter).toBe('PAYMENT');
        expect(data.lineCount).toBe(1);
        expect(data.lines[0].type).toBe('PAYMENT');
    });

    it('silently ignores an unknown type filter (does not 400)', async () => {
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, type: 'WAT', user });
        expect(data.typeFilter).toBe(null);
    });
});

describe('supplierTransactionStatement fetcher — line shapes', () => {
    it('PURCHASE: debit = totalCost, credit = 0', async () => {
        mocks.purchaseOrder.find.mockReturnValue(makeFindChain([
            { _id: OID, poNumber: 'PO-1', receivedDate: dateAt(2026, 8, 10), totalCost: 1000, status: 'RECEIVED' }
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].debit).toBe(1000);
        expect(data.lines[0].credit).toBe(0);
        expect(data.lines[0].typeLabel).toBe('فاتورة مشتريات');
    });

    it('PAYMENT (EXPENSE): credit = amount, debit = 0', async () => {
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'p', receiptNumber: 'R-1', type: 'EXPENSE', amount: 500, description: 'دفعة للمورد', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].credit).toBe(500);
        expect(data.lines[0].debit).toBe(0);
        expect(data.lines[0].typeLabel).toBe('دفعة للمورد');
    });

    it('REFUND (INCOME): debit = amount, credit = 0', async () => {
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'r', receiptNumber: 'R-2', type: 'INCOME', amount: 200, description: 'استرداد من المورد', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].debit).toBe(200);
        expect(data.lines[0].credit).toBe(0);
        expect(data.lines[0].typeLabel).toBe('استرداد من المورد');
    });

    it('DEBT: increase → debit, decrease → credit', async () => {
        mocks.debt.find.mockReturnValue(makeFindChain([
            { _id: OID + 'd1', referenceNumber: 'DBT-1', date: dateAt(2026, 8, 1), amount: 100, status: 'open', direction: 'increase' },
            { _id: OID + 'd2', referenceNumber: 'DBT-2', date: dateAt(2026, 8, 2), amount: 50, status: 'settled', direction: 'decrease' },
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        // Sorted ascending: DBT-1 (increase, 100) then DBT-2 (decrease, 50)
        expect(data.lines[0].debit).toBe(100);
        expect(data.lines[0].credit).toBe(0);
        expect(data.lines[1].debit).toBe(0);
        expect(data.lines[1].credit).toBe(50);
    });

    it('lines are sorted by date ascending', async () => {
        mocks.purchaseOrder.find.mockReturnValue(makeFindChain([
            { _id: OID + 'po2', poNumber: 'PO-2', receivedDate: dateAt(2026, 8, 20), totalCost: 200, status: 'RECEIVED' }
        ]));
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'p1', receiptNumber: 'R-1', type: 'EXPENSE', amount: 100, description: '', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        // First line should be the earlier date (2026-08-05)
        expect(new Date(data.lines[0].date).toISOString()).toContain('2026-08-05');
        expect(new Date(data.lines[1].date).toISOString()).toContain('2026-08-20');
    });
});

describe('supplierTransactionStatement fetcher — PII', () => {
    it('hides sourceNumber for non-electronic channels (cash)', async () => {
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID, receiptNumber: 'R-1', type: 'EXPENSE', amount: 100, description: '', method: 'cash', sourceNumber: 'NOPE-1234', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].sourceNumber).toBe('');
    });

    it('masks sourceNumber for electronic channels when role is not privileged', async () => {
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID, receiptNumber: 'R-1', type: 'EXPENSE', amount: 100, description: '', method: 'instapay', sourceNumber: 'IPX-9988776655', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user: userCashier });
        expect(data.lines[0].sourceNumber).not.toContain('IPX-');
        expect(data.lines[0].sourceNumber).toMatch(/•+/);
    });

    it('shows sourceNumber for owner on electronic channels', async () => {
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID, receiptNumber: 'R-1', type: 'EXPENSE', amount: 100, description: '', method: 'instapay', sourceNumber: 'IPX-9988776655', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        expect(data.lines[0].sourceNumber).toBe('IPX-9988776655');
    });
});

describe('supplierTransactionStatement fetcher — totals', () => {
    it('totals aggregate across all 3 event types', async () => {
        mocks.purchaseOrder.find.mockReturnValue(makeFindChain([
            { _id: OID + 'po', poNumber: 'PO-1', receivedDate: dateAt(2026, 8, 10), totalCost: 1000, status: 'RECEIVED' }
        ]));
        mocks.tx.find.mockReturnValue(makeFindChain([
            { _id: OID + 'p', receiptNumber: 'R-1', type: 'EXPENSE', amount: 500, description: '', method: 'cash', date: dateAt(2026, 8, 5), partnerId: OID }
        ]));
        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        expect(data.totals.debits).toBe(1000);
        expect(data.totals.credits).toBe(500);
        expect(data.totals.net).toBe(500); // 1000 - 500
        expect(data.lineCount).toBe(2);
    });
});