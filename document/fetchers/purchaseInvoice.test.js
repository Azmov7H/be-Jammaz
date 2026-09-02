/**
 * T-UNIT-FETCH-004 — purchaseInvoice fetcher unit tests.
 *
 * Locks:
 *  - the canonical DocumentData shape (type, supplier, items,
 *    totals, payment, ...)
 *  - PII masking for sourceNumber (electronic channel only,
 *    only owner/manager sees full)
 *  - the type-distinct contract vs SALE_INVOICE:
 *      - title is "فاتورة مشتريات"
 *      - the partner is `supplier` (not `customer`)
 *      - there is no `returns` block
 *      - payment direction is "we owe them" (positive balance)
 *  - subtotal = Σ(qtyReceived × costPrice) (received-only basis)
 *  - PO status enum maps to Arabic labels
 *  - guard rails: invalid id, missing PO
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    po: { findById: vi.fn() },
    supplier: { findById: vi.fn() },
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

vi.mock('../../models/PurchaseOrder.js', () => ({ default: mocks.po }));
vi.mock('../../models/Supplier.js', () => ({ default: mocks.supplier }));
vi.mock('../../lib/branding.js', () => mocks.branding);
vi.mock('../../lib/db.js', () => mocks.db);

import { fetch } from './purchaseInvoice.js';

const OID = 'a'.repeat(24);
const user = { _id: 'u1', name: 'Owner', role: 'owner' };
const userCashier = { _id: 'u2', name: 'Cashier', role: 'cashier' };

function makePO(overrides = {}) {
    return {
        _id: OID,
        poNumber: 'PO-100',
        supplier: { _id: OID, name: 'مورد الأمل', phone: '010', address: 'الجيزة', taxNumber: 'T-S1', balance: 5000 },
        items: [
            { _id: 'i1', productId: { _id: 'p1', name: 'منتج أ', code: 'A1' }, quantity: 10, receivedQty: 10, costPrice: 100 },
            { _id: 'i2', productId: { _id: 'p2', name: 'منتج ب', code: 'B2' }, quantity: 5, receivedQty: 3, costPrice: 50 },
        ],
        status: 'RECEIVED',
        totalCost: 1150, // 10*100 + 3*50
        expectedDate: new Date('2026-08-15T00:00:00.000Z'),
        receivedDate: new Date('2026-08-20T00:00:00.000Z'),
        createdBy: { name: 'علي' },
        notes: 'ملاحظات',
        paymentType: 'cash',
        sourceNumber: '',
        paidAmount: 500,
        paymentStatus: 'partial',
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    // po.findById().populate().populate().populate().lean() — we only need the last .lean
    mocks.po.findById.mockReturnValue({
        populate: () => ({
            populate: () => ({
                populate: () => ({
                    lean: async () => makePO()
                })
            })
        })
    });
    // supplier.findById().select().lean() for the live balance
    mocks.supplier.findById.mockReturnValue({
        select: () => ({ lean: async () => ({ balance: 5000 }) })
    });
});

describe('purchaseInvoice fetcher — guards', () => {
    it('rejects an empty id', async () => {
        await expect(fetch({}, { user })).rejects.toThrow(/مطلوب/);
    });

    it('throws when the PO is missing', async () => {
        mocks.po.findById.mockReturnValue({
            populate: () => ({ populate: () => ({ populate: () => ({ lean: async () => null }) }) })
        });
        await expect(fetch({ id: OID }, { user })).rejects.toThrow(/أمر الشراء غير موجود/);
    });
});

describe('purchaseInvoice fetcher — shape & type distinction', () => {
    it('returns the canonical document data shape (PURCHASE_INVOICE)', async () => {
        const data = await fetch({ id: OID }, { user });
        expect(data.type).toBe('PURCHASE_INVOICE');
        expect(data.title).toBe('فاتورة مشتريات');
        expect(data.number).toBe('PO-100');
        expect(data.branding).toBeTruthy();
        expect(data.supplier.name).toBe('مورد الأمل');
        expect(data.supplier.taxNumber).toBe('T-S1');
        expect(data.supplier.balance).toBe(5000); // current credit owed-to-supplier
        // No customer block, no returns block — type-distinct from SALE_INVOICE
        expect(data.customer).toBeUndefined();
        expect(data.returns).toBeUndefined();
        expect(data.hasReturns).toBe(false);
    });

    it('uses Arabic PO status label', async () => {
        const data = await fetch({ id: OID }, { user });
        expect(data.status).toBe('مستلم');
        expect(data.purchaseOrder.statusLabel).toBe('مستلم');
    });

    it('maps payment status to Arabic label', async () => {
        const data = await fetch({ id: OID }, { user });
        expect(data.paymentStatusLabel).toBe('مدفوع جزئياً');
    });

    it('items list has productName + qty + lineTotal', async () => {
        const data = await fetch({ id: OID }, { user });
        expect(data.items).toHaveLength(2);
        expect(data.items[0].productName).toBe('منتج أ');
        expect(data.items[0].qty).toBe(10); // received = ordered
        expect(data.items[0].lineTotal).toBe(1000);
        expect(data.items[1].qty).toBe(3); // received only
        expect(data.items[1].lineTotal).toBe(150);
    });

    it('totals = subtotal from items, paidAmount + remaining', async () => {
        const data = await fetch({ id: OID }, { user });
        expect(data.totals.subtotal).toBe(1150); // 1000 + 150
        expect(data.totals.total).toBe(1150);    // matches po.totalCost
        expect(data.totals.paidAmount).toBe(500);
        expect(data.totals.remaining).toBe(650);
    });

    it('fallback supplier name when populate is missing', async () => {
        const po = { ...makePO(), supplier: null, supplierName: 'مورد قديم' };
        mocks.po.findById.mockReturnValue({
            populate: () => ({ populate: () => ({ populate: () => ({ lean: async () => po }) }) })
        });
        const data = await fetch({ id: OID }, { user });
        expect(data.supplier.name).toBe('مورد قديم');
        expect(data.supplier.balance).toBe(0); // no live lookup
    });
});

describe('purchaseInvoice fetcher — PII masking', () => {
    it('non-electronic payment: sourceNumber is empty (cash / bank / check)', async () => {
        const po = makePO({ paymentType: 'cash', sourceNumber: 'NOPE-1234' });
        mocks.po.findById.mockReturnValue({
            populate: () => ({ populate: () => ({ populate: () => ({ lean: async () => po }) }) })
        });
        const data = await fetch({ id: OID }, { user });
        expect(data.payment.method).toBe('cash');
        expect(data.payment.isElectronic).toBe(false);
        expect(data.payment.sourceNumber).toBe('');
    });

    it('electronic payment: sourceNumber masked for non-privileged role', async () => {
        const po = makePO({ paymentType: 'instapay', sourceNumber: 'IPX-9988776655' });
        mocks.po.findById.mockReturnValue({
            populate: () => ({ populate: () => ({ populate: () => ({ lean: async () => po }) }) })
        });
        const data = await fetch({ id: OID }, { user: userCashier });
        expect(data.payment.isElectronic).toBe(true);
        expect(data.payment.sourceNumber).not.toContain('IPX-');
        expect(data.payment.sourceNumber).toMatch(/•+/);
    });

    it('electronic payment: sourceNumber visible for owner', async () => {
        const po = makePO({ paymentType: 'instapay', sourceNumber: 'IPX-9988776655' });
        mocks.po.findById.mockReturnValue({
            populate: () => ({ populate: () => ({ populate: () => ({ lean: async () => po }) }) })
        });
        const data = await fetch({ id: OID }, { user });
        expect(data.payment.sourceNumber).toBe('IPX-9988776655');
    });
});

describe('purchaseInvoice fetcher — supplier balance', () => {
    it('reads the live supplier balance via a second query', async () => {
        await fetch({ id: OID }, { user });
        expect(mocks.supplier.findById).toHaveBeenCalledTimes(1);
    });

    it('returns 0 balance when the supplier cannot be looked up', async () => {
        mocks.supplier.findById.mockReturnValue({
            select: () => ({ lean: async () => null })
        });
        const data = await fetch({ id: OID }, { user });
        expect(data.supplier.balance).toBe(0);
    });
});
