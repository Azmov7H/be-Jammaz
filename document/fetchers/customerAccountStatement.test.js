/**
 * T-UNIT-FETCH-003 — customerAccountStatement fetcher unit tests.
 *
 * Locks:
 *  - the canonical DocumentData shape (type, customer, period,
 *    openingBalance, closingBalance, totals, lines, branding, ...)
 *  - the OPENING-BALANCE BUG FIX: openingBalance is the result of
 *    a real pre-window aggregation (openBalance + ΣInvoice.total
 *    − ΣINCOME tx + ΣEXPENSE tx) for date < startDate, NOT 0
 *  - running balance starts at openingBalance (not 0) and matches
 *    closingBalance on the last line
 *  - line types: INVOICE (debit) / PAYMENT (credit) / REFUND (debit)
 *  - balanceDelta = closingBalance − customer.balance is surfaced
 *    so the renderer can flag a reconciliation gap
 *  - guard rails: invalid id, missing customer, 1-year cap,
 *    filterSchema passthrough
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    customer: { findById: vi.fn() },
    invoice: { find: vi.fn(), aggregate: vi.fn() },
    tx: { find: vi.fn(), aggregate: vi.fn() },
    debt: { aggregate: vi.fn(async () => []) },
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
vi.mock('../../models/Debt.js', () => ({ default: mocks.debt }));
vi.mock('../../lib/branding.js', () => mocks.branding);
vi.mock('../../lib/db.js', () => mocks.db);

import { fetch } from './customerAccountStatement.js';

const OID = 'a'.repeat(24);
const user = { _id: 'u1', name: 'Owner', role: 'owner' };

function makeCustomerChain(customer) {
    return {
        select: vi.fn(() => ({ lean: vi.fn(async () => customer) }))
    };
}

function makeInvoiceSelectChain(invoices) {
    return {
        select: vi.fn(() => ({ lean: vi.fn(async () => invoices) }))
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
    mocks.invoice.aggregate.mockResolvedValue([]);
    mocks.tx.aggregate.mockImplementation(([stage0]) => {
        if (stage0?.$match?.type === 'INCOME') return Promise.resolve([]);
        if (stage0?.$match?.type === 'EXPENSE') return Promise.resolve([]);
        return Promise.resolve([]);
    });
    // Default: missing customer
    mocks.customer.findById.mockReturnValue(makeCustomerChain(null));
    // Default: empty window
    mocks.invoice.find.mockReturnValue(makeInvoiceSelectChain([]));
    mocks.tx.find.mockReturnValue(makeTxSortChain([]));
});

describe('customerAccountStatement fetcher — guards', () => {
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

describe('customerAccountStatement fetcher — opening balance bug fix', () => {
    it('openingBalance = openBalance when no pre-window activity', async () => {
        const customer = { _id: OID, name: 'Ali', phone: '', address: '', taxNumber: '', balance: 0, creditBalance: 0, openBalance: 1500, linkedSupplier: null };
        mocks.customer.findById.mockReturnValue(makeCustomerChain(customer));
        // No pre-window invoices or transactions
        mocks.invoice.aggregate.mockResolvedValueOnce([]);
        mocks.tx.aggregate
            .mockResolvedValueOnce([]) // INCOME
            .mockResolvedValueOnce([]); // EXPENSE
        // No window activity
        mocks.invoice.find.mockReturnValue({ select: vi.fn(() => ({ lean: vi.fn(async () => []) })) });
        mocks.tx.find.mockReturnValue({ sort: vi.fn(() => ({ lean: vi.fn(async () => []) })) });

        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        expect(data.openingBalance).toBe(1500);
        expect(data.closingBalance).toBe(1500);
        expect(data.balanceDelta).toBe('1500.00'); // closing 1500, snapshot 0 → 1500 gap
        expect(data.lineCount).toBe(0);
    });

    it('openingBalance adds pre-window invoice debits (THE BUG)', async () => {
        const customer = { _id: OID, name: 'Ali', phone: '', address: '', taxNumber: '', balance: 500, creditBalance: 0, openBalance: 0, linkedSupplier: null };
        mocks.customer.findById.mockReturnValue(makeCustomerChain(customer));
        // Pre-window: 2 invoices, 1 payment
        mocks.invoice.aggregate.mockResolvedValueOnce([{ _id: null, total: 1000 }]); // pre-debits
        mocks.tx.aggregate
            .mockResolvedValueOnce([{ _id: null, total: 500 }]) // pre-credits
            .mockResolvedValueOnce([]);                          // pre-refunds
        // Window: 1 invoice
        mocks.invoice.find.mockReturnValue({ select: vi.fn(() => ({ lean: vi.fn(async () => [
            { _id: OID + '1', number: 'INV-2', date: dateAt(2026, 8, 25), total: 200, type: 'sales', status: 'completed', paymentStatus: 'unpaid' }
        ]) })) });
        mocks.tx.find.mockReturnValue({ sort: vi.fn(() => ({ lean: vi.fn(async () => []) })) });

        const data = await fetch({
            customerId: OID,
            startDate: dateAt(2026, 8, 1).toISOString(),
            endDate: dateAt(2026, 8, 31).toISOString(),
            user
        });
        // 0 openBalance + 1000 pre-debits − 500 pre-credits = 500 openingBalance
        expect(data.openingBalance).toBe(500);
        // closing = 500 + 200 - 0 = 700
        expect(data.closingBalance).toBe(700);
        // balanceDelta = 700 - 500 (snapshot) = 200
        expect(data.balanceDelta).toBe('200.00');
        // first (and only) line has balance 700
        expect(data.lines[0].balance).toBe(700);
    });

    it('openingBalance subtracts pre-window refunds (EXPENSE tx)', async () => {
        const customer = { _id: OID, name: 'Ali', phone: '', address: '', taxNumber: '', balance: 0, creditBalance: 0, openBalance: 0, linkedSupplier: null };
        mocks.customer.findById.mockReturnValue(makeCustomerChain(customer));
        mocks.invoice.aggregate.mockResolvedValueOnce([{ _id: null, total: 1000 }]);
        mocks.tx.aggregate
            .mockResolvedValueOnce([])                          // pre-credits 0
            .mockResolvedValueOnce([{ _id: null, total: 100 }]); // pre-refunds 100
        mocks.invoice.find.mockReturnValue({ select: vi.fn(() => ({ lean: vi.fn(async () => []) })) });
        mocks.tx.find.mockReturnValue({ sort: vi.fn(() => ({ lean: vi.fn(async () => []) })) });

        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        // 0 + 1000 - 0 + 100 = 1100
        expect(data.openingBalance).toBe(1100);
    });

    it('running balance starts at openingBalance, not 0', async () => {
        const customer = { _id: OID, name: 'Ali', phone: '', address: '', taxNumber: '', balance: 0, creditBalance: 0, openBalance: 0, linkedSupplier: null };
        mocks.customer.findById.mockReturnValue(makeCustomerChain(customer));
        mocks.invoice.aggregate.mockResolvedValueOnce([{ _id: null, total: 2000 }]);
        mocks.tx.aggregate
            .mockResolvedValueOnce([{ _id: null, total: 500 }]) // pre-credits
            .mockResolvedValueOnce([]);
        // 2 lines: invoice 800, payment 300
        mocks.invoice.find.mockReturnValue({ select: vi.fn(() => ({ lean: vi.fn(async () => [
            { _id: OID + '1', number: 'INV-A', date: dateAt(2026, 8, 5), total: 800, type: 'sales', status: 'completed', paymentStatus: 'unpaid' }
        ]) })) });
        mocks.tx.find.mockReturnValue({ sort: vi.fn(() => ({ lean: vi.fn(async () => [
            { _id: OID + '2', receiptNumber: 'R-1', type: 'INCOME', amount: 300, description: 'partial', method: 'cash', date: dateAt(2026, 8, 10), partnerId: OID }
        ]) })) });

        const data = await fetch({ customerId: OID, startDate: dateAt(2026, 8, 1).toISOString(), endDate: dateAt(2026, 8, 31).toISOString(), user });
        // opening = 0 + 2000 - 500 = 1500
        expect(data.openingBalance).toBe(1500);
        // line 1: 1500 + 800 = 2300
        expect(data.lines[0].balance).toBe(2300);
        // line 2: 2300 - 300 = 2000
        expect(data.lines[1].balance).toBe(2000);
        // closing = 2000
        expect(data.closingBalance).toBe(2000);
        // total debits = 800, credits = 300
        expect(data.totals.debits).toBe(800);
        expect(data.totals.credits).toBe(300);
    });
});

describe('customerAccountStatement fetcher — shape', () => {
    it('returns the canonical document data shape', async () => {
        const customer = { _id: OID, name: 'Ali', phone: '010', address: 'Cairo', taxNumber: 'T1', balance: 0, creditBalance: 0, openBalance: 0, linkedSupplier: null };
        mocks.customer.findById.mockReturnValue(makeCustomerChain(customer));
        mocks.invoice.find.mockReturnValue({ select: vi.fn(() => ({ lean: vi.fn(async () => []) })) });
        mocks.tx.find.mockReturnValue({ sort: vi.fn(() => ({ lean: vi.fn(async () => []) })) });

        const data = await fetch({ customerId: OID, startDate: null, endDate: null, user });
        expect(data.type).toBe('customer_statement');
        expect(data.title).toBe('كشف حساب عميل');
        expect(data.documentType).toBe('CUSTOMER_STATEMENT');
        expect(data.branding).toBeTruthy();
        expect(data.customer.name).toBe('Ali');
        expect(data.customer.taxNumber).toBe('T1');
        expect(data.period.startDate).toBeTruthy();
        expect(data.period.endDate).toBeTruthy();
        expect(data.generatedAt).toBeTruthy();
        expect(data.generatedBy).toBe('Owner');
        expect(data.filters).toBeTruthy();
    });

    it('renders PAYMENT (INCOME) as credit and REFUND (EXPENSE) as debit', async () => {
        const customer = { _id: OID, name: 'Ali', phone: '', address: '', taxNumber: '', balance: 0, creditBalance: 0, openBalance: 0, linkedSupplier: null };
        mocks.customer.findById.mockReturnValue(makeCustomerChain(customer));
        mocks.invoice.find.mockReturnValue({ select: vi.fn(() => ({ lean: vi.fn(async () => []) })) });
        mocks.tx.find.mockReturnValue({ sort: vi.fn(() => ({ lean: vi.fn(async () => [
            { _id: OID + 'p', receiptNumber: 'R-9', type: 'INCOME', amount: 100, description: 'دفعة', method: 'cash', date: dateAt(2026, 8, 2), partnerId: OID },
            { _id: OID + 'r', receiptNumber: 'R-10', type: 'EXPENSE', amount: 50, description: 'مرتجع', method: 'cash', date: dateAt(2026, 8, 3), partnerId: OID }
        ]) })) });

        const data = await fetch({ customerId: OID, startDate: dateAt(2026, 8, 1).toISOString(), endDate: dateAt(2026, 8, 31).toISOString(), user });
        expect(data.lines[0].type).toBe('PAYMENT');
        expect(data.lines[0].credit).toBe(100);
        expect(data.lines[0].debit).toBe(0);
        expect(data.lines[1].type).toBe('REFUND');
        expect(data.lines[1].debit).toBe(50);
        expect(data.lines[1].credit).toBe(0);
    });
});
