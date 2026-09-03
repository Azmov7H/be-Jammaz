/**
 * T-UNIT-FETCH-006 — supplierAccountStatement fetcher unit tests.
 *
 * Locks (mirror of customerAccountStatement tests):
 *  - the canonical DocumentData shape (type, supplier, period,
 *    openingBalance, closingBalance, totals, lines, branding, ...)
 *  - the OPENING-BALANCE BUG FIX: openingBalance is the result
 *    of a real pre-window aggregation (openBalance +
 *    ΣPurchaseOrder.totalCost − ΣEXPENSE tx + ΣINCOME tx)
 *  - running balance starts at openingBalance (not 0) and
 *    matches closingBalance on the last line
 *  - line types: PURCHASE_ORDER (debit) / PAYMENT (credit) /
 *    REFUND (debit)
 *  - balanceDelta = closingBalance − supplier.balance is
 *    surfaced so the renderer can flag a reconciliation gap
 *  - guard rails: invalid id, missing supplier
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    supplier: { findById: vi.fn() },
    po: { find: vi.fn(), aggregate: vi.fn() },
    tx: { find: vi.fn(), aggregate: vi.fn() },
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
vi.mock('../../models/PurchaseOrder.js', () => ({ default: mocks.po }));
vi.mock('../../models/TreasuryTransaction.js', () => ({ default: mocks.tx }));
vi.mock('../../lib/branding.js', () => mocks.branding);
vi.mock('../../lib/db.js', () => mocks.db);

import { fetch } from './supplierAccountStatement.js';

const OID = 'a'.repeat(24);
const user = { _id: 'u1', name: 'Owner', role: 'owner' };

function makeSupplierChain(supplier) {
    return {
        select: vi.fn(() => ({ lean: vi.fn(async () => supplier) }))
    };
}

function makePOFindChain(pos) {
    return {
        select: vi.fn(() => ({ lean: vi.fn(async () => pos) }))
    };
}

function makeTxSortChain(txs) {
    return {
        sort: vi.fn(() => ({ lean: vi.fn(async () => txs) }))
    };
}

function dateAt(yyyy, mm, dd) { return new Date(Date.UTC(yyyy, mm - 1, dd)); }

beforeEach(() => {
    vi.clearAllMocks();
    // Pre-window aggregate defaults: empty
    mocks.po.aggregate.mockResolvedValue([]);
    mocks.tx.aggregate.mockImplementation(([stage0]) => {
        if (stage0?.$match?.type === 'EXPENSE') return Promise.resolve([]);
        if (stage0?.$match?.type === 'INCOME') return Promise.resolve([]);
        return Promise.resolve([]);
    });
    mocks.supplier.findById.mockReturnValue(makeSupplierChain(null));
    mocks.po.find.mockReturnValue(makePOFindChain([]));
    mocks.tx.find.mockReturnValue(makeTxSortChain([]));
});

describe('supplierAccountStatement fetcher — guards', () => {
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

describe('supplierAccountStatement fetcher — opening balance bug fix', () => {
    it('openingBalance = 0 (no openBalance) when no pre-window activity', async () => {
        const supplier = { _id: OID, name: 'مورد', phone: '', address: '', taxNumber: '', balance: 0, openBalance: 0, linkedCustomer: null };
        mocks.supplier.findById.mockReturnValue(makeSupplierChain(supplier));
        mocks.po.aggregate.mockResolvedValueOnce([]);
        mocks.tx.aggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        expect(data.openingBalance).toBe(0);
        expect(data.closingBalance).toBe(0);
        expect(data.balanceDelta).toBe('0.00');
    });

    it('openingBalance adds pre-window PO debits (THE BUG)', async () => {
        const supplier = { _id: OID, name: 'مورد', phone: '', address: '', taxNumber: '', balance: 500, openBalance: 0, linkedCustomer: null };
        mocks.supplier.findById.mockReturnValue(makeSupplierChain(supplier));
        // Pre-window: 2 POs (total 1500), 1 EXPENSE payment (500)
        mocks.po.aggregate.mockResolvedValueOnce([{ _id: null, total: 1500 }]); // pre-debits
        mocks.tx.aggregate
            .mockResolvedValueOnce([{ _id: null, total: 500 }]) // pre-credits
            .mockResolvedValueOnce([]);                          // pre-refunds
        // Window: 1 PO (200)
        mocks.po.find.mockReturnValue(makePOFindChain([
            { _id: OID + '1', poNumber: 'PO-2', receivedDate: dateAt(2026, 8, 25), totalCost: 200, status: 'RECEIVED', paymentStatus: 'unpaid', paymentType: 'cash', paidAmount: 0 }
        ]));
        mocks.tx.find.mockReturnValue(makeTxSortChain([]));

        const data = await fetch({
            supplierId: OID,
            startDate: dateAt(2026, 8, 1).toISOString(),
            endDate: dateAt(2026, 8, 31).toISOString(),
            user
        });
        // 0 openBalance + 1500 pre-debits - 500 pre-credits = 1000 openingBalance
        expect(data.openingBalance).toBe(1000);
        // closing = 1000 + 200 - 0 = 1200
        expect(data.closingBalance).toBe(1200);
        // balanceDelta = 1200 - 500 (snapshot) = 700
        expect(data.balanceDelta).toBe('700.00');
        // first (and only) line has balance 1200
        expect(data.lines[0].balance).toBe(1200);
    });

    it('openingBalance subtracts pre-window payments (EXPENSE tx)', async () => {
        const supplier = { _id: OID, name: 'مورد', phone: '', address: '', taxNumber: '', balance: 0, openBalance: 0, linkedCustomer: null };
        mocks.supplier.findById.mockReturnValue(makeSupplierChain(supplier));
        mocks.po.aggregate.mockResolvedValueOnce([{ _id: null, total: 1000 }]);
        mocks.tx.aggregate
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ _id: null, total: 100 }]); // pre-refunds (INCOME)
        mocks.po.find.mockReturnValue(makePOFindChain([]));
        mocks.tx.find.mockReturnValue(makeTxSortChain([]));

        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        // 0 + 1000 - 0 + 100 = 1100
        expect(data.openingBalance).toBe(1100);
    });

    it('running balance starts at openingBalance, not 0', async () => {
        const supplier = { _id: OID, name: 'مورد', phone: '', address: '', taxNumber: '', balance: 0, openBalance: 0, linkedCustomer: null };
        mocks.supplier.findById.mockReturnValue(makeSupplierChain(supplier));
        mocks.po.aggregate.mockResolvedValueOnce([{ _id: null, total: 2000 }]);
        mocks.tx.aggregate
            .mockResolvedValueOnce([{ _id: null, total: 500 }]) // pre-credits
            .mockResolvedValueOnce([]);
        // 2 lines: PO 800, payment 300
        mocks.po.find.mockReturnValue(makePOFindChain([
            { _id: OID + '1', poNumber: 'PO-A', receivedDate: dateAt(2026, 8, 5), totalCost: 800, status: 'RECEIVED', paymentStatus: 'unpaid', paymentType: 'cash', paidAmount: 0 }
        ]));
        mocks.tx.find.mockReturnValue(makeTxSortChain([
            { _id: OID + '2', receiptNumber: 'EXP-1', type: 'EXPENSE', amount: 300, description: 'partial', method: 'cash', date: dateAt(2026, 8, 10), partnerId: OID }
        ]));

        const data = await fetch({ supplierId: OID, startDate: dateAt(2026, 8, 1).toISOString(), endDate: dateAt(2026, 8, 31).toISOString(), user });
        // opening = 0 + 2000 - 500 = 1500
        expect(data.openingBalance).toBe(1500);
        // line 1 (PO): 1500 + 800 = 2300
        expect(data.lines[0].balance).toBe(2300);
        // line 2 (payment): 2300 - 300 = 2000
        expect(data.lines[1].balance).toBe(2000);
        // closing = 2000
        expect(data.closingBalance).toBe(2000);
        // total debits = 800, credits = 300
        expect(data.totals.debits).toBe(800);
        expect(data.totals.credits).toBe(300);
    });
});

describe('supplierAccountStatement fetcher — shape', () => {
    it('returns the canonical document data shape', async () => {
        const supplier = { _id: OID, name: 'مورد', phone: '010', address: 'Cairo', taxNumber: 'T1', balance: 0, openBalance: 0, linkedCustomer: null };
        mocks.supplier.findById.mockReturnValue(makeSupplierChain(supplier));
        mocks.po.find.mockReturnValue(makePOFindChain([]));
        mocks.tx.find.mockReturnValue(makeTxSortChain([]));

        const data = await fetch({ supplierId: OID, startDate: null, endDate: null, user });
        expect(data.type).toBe('supplier_statement');
        expect(data.title).toBe('كشف حساب مورد');
        expect(data.documentType).toBe('SUPPLIER_ACCOUNT_STATEMENT');
        expect(data.branding).toBeTruthy();
        expect(data.supplier.name).toBe('مورد');
        expect(data.supplier.taxNumber).toBe('T1');
        expect(data.period.startDate).toBeTruthy();
        expect(data.period.endDate).toBeTruthy();
        expect(data.generatedAt).toBeTruthy();
        expect(data.generatedBy).toBe('Owner');
        expect(data.filters).toBeTruthy();
    });

    it('PAYMENT (EXPENSE) is a credit and REFUND (INCOME) is a debit', async () => {
        const supplier = { _id: OID, name: 'مورد', phone: '', address: '', taxNumber: '', balance: 0, openBalance: 0, linkedCustomer: null };
        mocks.supplier.findById.mockReturnValue(makeSupplierChain(supplier));
        mocks.po.find.mockReturnValue(makePOFindChain([]));
        mocks.tx.find.mockReturnValue(makeTxSortChain([
            { _id: OID + 'p', receiptNumber: 'EXP-9', type: 'EXPENSE', amount: 100, description: 'سداد', method: 'cash', date: dateAt(2026, 8, 2), partnerId: OID },
            { _id: OID + 'r', receiptNumber: 'INC-10', type: 'INCOME', amount: 50, description: 'استرداد', method: 'cash', date: dateAt(2026, 8, 3), partnerId: OID }
        ]));

        const data = await fetch({ supplierId: OID, startDate: dateAt(2026, 8, 1).toISOString(), endDate: dateAt(2026, 8, 31).toISOString(), user });
        expect(data.lines[0].type).toBe('PAYMENT');
        expect(data.lines[0].credit).toBe(100);
        expect(data.lines[0].debit).toBe(0);
        expect(data.lines[1].type).toBe('REFUND');
        expect(data.lines[1].debit).toBe(50);
        expect(data.lines[1].credit).toBe(0);
    });
});
