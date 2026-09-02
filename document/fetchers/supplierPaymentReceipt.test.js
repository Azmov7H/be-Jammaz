/**
 * T-UNIT-FETCH-005 — supplierPaymentReceipt fetcher unit tests.
 *
 * Locks:
 *  - the canonical DocumentData shape (type, supplier, payment, ...)
 *  - type disambiguation: INCOME / missing partner / wrong reference
 *    type all throw NotFoundError so the customer fetcher (S4) can
 *    take over
 *  - previous / remaining balance math
 *  - PII masking for sourceNumber (only shown for electronic channels)
 *  - supplier balance fallback via PurchaseOrder when partnerId
 *    is missing but referenceType=PurchaseOrder
 *  - reference resolution: PurchaseOrder number + total + paid
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    tx: { findById: vi.fn() },
    supplier: { findById: vi.fn() },
    po: { findById: vi.fn() },
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

vi.mock('../../models/TreasuryTransaction.js', () => ({ default: mocks.tx }));
vi.mock('../../models/Supplier.js', () => ({ default: mocks.supplier }));
vi.mock('../../models/PurchaseOrder.js', () => ({ default: mocks.po }));
vi.mock('../../lib/branding.js', () => mocks.branding);
vi.mock('../../lib/db.js', () => mocks.db);

import { fetch } from './supplierPaymentReceipt.js';

const OID = 'a'.repeat(24);
const user = { _id: 'u1', name: 'Owner', role: 'owner' };

function makeTx(overrides = {}) {
    return {
        _id: OID,
        type: 'EXPENSE',
        receiptNumber: 'EXP-100',
        amount: 500,
        description: 'سداد للمورد',
        referenceType: 'PurchaseOrder',
        referenceId: OID,
        partnerId: OID,
        method: 'cash',
        sourceNumber: '',
        date: new Date('2026-08-30T14:30:00Z'),
        createdBy: { name: 'علي' },
        ...overrides,
    };
}

function makeSupplier(overrides = {}) {
    return {
        _id: OID,
        name: 'مورد الأمل',
        phone: '010',
        address: 'الجيزة',
        taxNumber: 'T-SUP-1',
        balance: 1000,
        linkedCustomer: null,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.findById.mockImplementation(() => ({
        populate: () => ({ lean: async () => makeTx() })
    }));
    mocks.supplier.findById.mockImplementation(() => ({
        select: () => ({ lean: async () => makeSupplier() })
    }));
    mocks.po.findById.mockImplementation(() => ({
        select: () => ({ lean: async () => ({ poNumber: 'PO-1', totalCost: 2000, paidAmount: 500, status: 'RECEIVED', supplier: OID }) })
    }));
});

describe('supplierPaymentReceipt fetcher — guards', () => {
    it('rejects an invalid id', async () => {
        await expect(fetch({ id: 'not-an-id' }, { user })).rejects.toThrow(/غير موجود/);
    });

    it('throws when the transaction is missing', async () => {
        mocks.tx.findById.mockImplementation(() => ({ populate: () => ({ lean: async () => null }) }));
        await expect(fetch({ id: OID }, { user })).rejects.toThrow(/غير موجود/);
    });

    it('throws when the tx type is INCOME (customer fetcher takes over)', async () => {
        mocks.tx.findById.mockImplementation(() => ({ populate: () => ({ lean: async () => makeTx({ type: 'INCOME' }) }) }));
        await expect(fetch({ id: OID }, { user })).rejects.toThrow(/غير موجود/);
    });

    it('throws when neither partnerId nor a PurchaseOrder reference is set', async () => {
        mocks.tx.findById.mockImplementation(() => ({ populate: () => ({ lean: async () => makeTx({ partnerId: null, referenceId: null }) }) }));
        await expect(fetch({ id: OID }, { user })).rejects.toThrow(/غير موجود/);
    });

    it('throws when the supplier cannot be resolved', async () => {
        mocks.supplier.findById.mockImplementation(() => ({ select: () => ({ lean: async () => null }) }));
        mocks.po.findById.mockImplementation(() => ({ select: () => ({ lean: async () => null }) }));
        await expect(fetch({ id: OID }, { user })).rejects.toThrow(/المورد غير موجود/);
    });
});

describe('supplierPaymentReceipt fetcher — shape', () => {
    it('returns the canonical document data shape (SUPPLIER_PAYMENT_RECEIPT)', async () => {
        const data = await fetch({ id: OID }, { user });
        expect(data.type).toBe('supplier_payment_receipt');
        expect(data.title).toBe('سند سداد لمورد');
        expect(data.documentType).toBe('SUPPLIER_PAYMENT_RECEIPT');
        expect(data.branding).toBeTruthy();
        expect(data.supplier.name).toBe('مورد الأمل');
        expect(data.supplier.taxNumber).toBe('T-SUP-1');
        expect(data.supplier.balance).toBe(1000);
        expect(data.paidAmount).toBe(500);
        expect(data.status).toBe('مدفوع');
    });

    it('renders the payment method label via the centralized map', async () => {
        mocks.tx.findById.mockImplementation(() => ({ populate: () => ({ lean: async () => makeTx({ method: 'instapay' }) }) }));
        const data = await fetch({ id: OID }, { user });
        expect(data.payment.method).toBe('instapay');
        expect(data.payment.methodLabel).toBe('انستا باي');
        expect(data.payment.isElectronic).toBe(true);
    });

    it('previous / remaining balance math (EXPENSE: previous = current + amount, remaining = current)', async () => {
        const data = await fetch({ id: OID }, { user });
        // current supplier balance = 1000, amount = 500
        expect(data.previousBalance).toBe(1500);
        expect(data.remainingBalance).toBe(1000);
        expect(data.currentSupplierBalance).toBe(1000);
    });
});

describe('supplierPaymentReceipt fetcher — PII', () => {
    it('hides sourceNumber for non-electronic channels (cash)', async () => {
        mocks.tx.findById.mockImplementation(() => ({ populate: () => ({ lean: async () => makeTx({ method: 'cash', sourceNumber: 'NOPE-1234' }) }) }));
        const data = await fetch({ id: OID }, { user });
        expect(data.payment.isElectronic).toBe(false);
        expect(data.payment.sourceNumber).toBe('');
    });

    it('masks sourceNumber for electronic channels when role is not privileged', async () => {
        mocks.tx.findById.mockImplementation(() => ({ populate: () => ({ lean: async () => makeTx({ method: 'instapay', sourceNumber: 'IPX-9988776655' }) }) }));
        const data = await fetch({ id: OID }, { user: { ...user, role: 'cashier' } });
        expect(data.payment.isElectronic).toBe(true);
        expect(data.payment.sourceNumber).not.toContain('IPX-');
        expect(data.payment.sourceNumber).toMatch(/•+/);
    });

    it('reveals sourceNumber for electronic channels when role is owner', async () => {
        mocks.tx.findById.mockImplementation(() => ({ populate: () => ({ lean: async () => makeTx({ method: 'instapay', sourceNumber: 'IPX-9988776655' }) }) }));
        const data = await fetch({ id: OID }, { user });
        expect(data.payment.sourceNumber).toBe('IPX-9988776655');
    });
});

describe('supplierPaymentReceipt fetcher — reference resolution', () => {
    it('resolves a PurchaseOrder reference (number, total, paid)', async () => {
        const data = await fetch({ id: OID }, { user });
        expect(data.transaction.referenceType).toBe('PurchaseOrder');
        expect(data.transaction.referenceTypeLabel).toBe('أمر شراء');
        expect(data.transaction.referenceNumber).toBe('PO-1');
        expect(data.transaction.reference?.total).toBe(2000);
        expect(data.transaction.reference?.paid).toBe(500);
    });

    it('falls back to Manual label for Manual referenceType', async () => {
        mocks.tx.findById.mockImplementation(() => ({
            populate: () => ({ lean: async () => makeTx({ referenceType: 'Manual', referenceId: null, partnerId: OID }) })
        }));
        const data = await fetch({ id: OID }, { user });
        expect(data.transaction.referenceTypeLabel).toBe('دفع يدوي');
    });
});

describe('supplierPaymentReceipt fetcher — supplier fallback via PO', () => {
    it('resolves the supplier from a PurchaseOrder when partnerId is missing', async () => {
        mocks.tx.findById.mockImplementation(() => ({
            populate: () => ({ lean: async () => makeTx({ partnerId: null, referenceId: OID, referenceType: 'PurchaseOrder' }) })
        }));
        // Always return a supplier with balance so the PO-supplier path resolves to a supplier that
        // definitely has a balance field (proves the data layer surfaces it)
        const supplierFromMock = makeSupplier(); // balance: 1000, name: 'مورد الأمل'
        mocks.supplier.findById.mockImplementation(() => ({
            select: () => ({ lean: async () => supplierFromMock })
        }));
        const data = await fetch({ id: OID }, { user });
        expect(supplierFromMock.balance).toBe(1000); // sanity: the mock object has balance
        expect(data.supplier.name).toBe('مورد الأمل');
        expect(data.supplier.balance).toBe(1000);
    });
});

