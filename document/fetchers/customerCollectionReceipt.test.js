/**
 * T-UNIT-FETCH-002 — customerCollectionReceipt fetcher unit tests.
 *
 * Locks:
 *  - the canonical DocumentData shape (type, customer, payment, ...)
 *  - type disambiguation: EXPENSE / missing partner / wrong reference
 *    type all throw NotFoundError so the supplier fetcher (S7) can
 *    take over
 *  - previous/remaining balance math
 *  - PII masking for sourceNumber (only shown for electronic channels)
 *  - the legacy `credit` invoice case is NOT a customer collection
 *    receipt — `credit` only appears as an `Invoice.paymentType`,
 *    not a `TreasuryTransaction.method`, so the fetcher doesn't
 *    need a special branch for it
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    tx: { findById: vi.fn() },
    customer: { findById: vi.fn() },
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
vi.mock('../../models/Customer.js', () => ({ default: mocks.customer }));
vi.mock('../../lib/branding.js', () => mocks.branding);
vi.mock('../../lib/db.js', () => mocks.db);

import { fetch } from './customerCollectionReceipt.js';

const OID = 'a'.repeat(24);
const user = { _id: 'u1', name: 'Owner', role: 'owner' };

function makeTx(overrides = {}) {
    return {
        _id: OID,
        type: 'INCOME',
        receiptNumber: 'REC-100',
        amount: 500,
        description: 'تحصيل دفعة',
        referenceType: 'UnifiedCollection',
        referenceId: OID,
        partnerId: OID,
        method: 'cash',
        sourceNumber: '',
        date: new Date('2026-08-30T14:30:00Z'),
        createdBy: { name: 'علي' },
        ...overrides,
    };
}

function makeCustomer(overrides = {}) {
    return {
        _id: OID,
        name: 'شركة عينة',
        phone: '010',
        address: 'القاهرة',
        taxNumber: '12345',
        balance: 1500,
        creditBalance: 0,
        isSupplier: false,
        linkedSupplier: null,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.findById.mockImplementation(() => ({
        populate: vi.fn(() => ({
            populate: vi.fn(() => ({
                lean: vi.fn(async () => makeTx()),
            })),
        })),
    }));
    mocks.customer.findById.mockImplementation(() => ({
        select: vi.fn(() => ({ lean: vi.fn(async () => makeCustomer()) })),
    }));
});

describe('customerCollectionReceipt — happy path', () => {
    it('returns the full DocumentData shape', async () => {
        const data = await fetch({ id: OID }, { user });
        expect(data.type).toBe('CUSTOMER_COLLECTION_RECEIPT');
        expect(data.title).toBe('سند تحصيل من عميل');
        expect(data.documentType).toBe('customer-collection-receipt');
        expect(data.receiptNumber).toBe('REC-100');
        expect(data.customer.name).toBe('شركة عينة');
        expect(data.transaction.amount).toBe(500);
        expect(data.collectedAmount).toBe(500);
        expect(data.branding.companyName).toBe('مؤسستي');
    });

    it('falls back to a generated receipt number when none is stored', async () => {
        mocks.tx.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    lean: vi.fn(async () => makeTx({ receiptNumber: undefined })),
                })),
            })),
        }));
        const data = await fetch({ id: OID }, { user });
        expect(data.receiptNumber).toMatch(/^TR-[A-F0-9]{6}$/);
    });

    it('computes previousBalance = remainingBalance + amount (INCOME reconciliation)', async () => {
        mocks.customer.findById.mockImplementation(() => ({
            select: vi.fn(() => ({ lean: vi.fn(async () => makeCustomer({ balance: 1500 })) })),
        }));
        const data = await fetch({ id: OID }, { user });
        // current = 1500, amount = 500, so previous = 2000
        expect(data.previousBalance).toBe(2000);
        expect(data.remainingBalance).toBe(1500);
        expect(data.collectedAmount).toBe(500);
    });
});

describe('customerCollectionReceipt — payment method display (REQ-DOC-010)', () => {
    const cases = [
        ['cash',     'نقدي',       'الخزينة الخاصة',  false],
        ['bank',     'تحويل بنكي', 'البنك',           false],
        ['wallet',   'محفظة كاش',  'محفظة الكاش',     true],
        ['instapay', 'انستا باي',  'انستا باي',       true],
        ['check',    'شيك',        'الشيكات',         false],
    ];

    it.each(cases)('method=%s → label="%s" / channel="%s" / electronic=%s',
        async (method, methodLabel, channelLabel, isElectronic) => {
            mocks.tx.findById.mockImplementation(() => ({
                populate: vi.fn(() => ({
                    populate: vi.fn(() => ({
                        lean: vi.fn(async () => makeTx({
                            method, sourceNumber: 'IP-1234',
                        })),
                    })),
                })),
            }));
            const data = await fetch({ id: OID }, { user });
            expect(data.payment.methodLabel).toBe(methodLabel);
            expect(data.payment.channelLabel).toBe(channelLabel);
            expect(data.payment.isElectronic).toBe(isElectronic);
        });
});

describe('customerCollectionReceipt — PII masking (REQ-DOC-008)', () => {
    it('masks sourceNumber for non-privileged roles on electronic channels', async () => {
        mocks.tx.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    lean: vi.fn(async () => makeTx({
                        method: 'instapay',
                        sourceNumber: 'IP-9876543210',
                    })),
                })),
            })),
        }));
        const data = await fetch(
            { id: OID },
            { user: { _id: 'u', role: 'cashier', name: 'C' } }
        );
        expect(data.payment.sourceNumber).toMatch(/^••••\s+\d{4}$/);
        expect(data.payment.sourceNumber).not.toBe('IP-9876543210');
    });

    it('shows full sourceNumber for owner on electronic channels', async () => {
        mocks.tx.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    lean: vi.fn(async () => makeTx({
                        method: 'instapay',
                        sourceNumber: 'IP-9876543210',
                    })),
                })),
            })),
        }));
        const data = await fetch({ id: OID }, { user });
        expect(data.payment.sourceNumber).toBe('IP-9876543210');
    });

    it('hides sourceNumber entirely on non-electronic channels', async () => {
        mocks.tx.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    lean: vi.fn(async () => makeTx({
                        method: 'cash',
                        sourceNumber: 'should-not-appear',
                    })),
                })),
            })),
        }));
        const data = await fetch({ id: OID }, { user });
        expect(data.payment.sourceNumber).toBe('');
        expect(data.payment.sourceNumber).not.toContain('should-not-appear');
    });
});

describe('customerCollectionReceipt — type disambiguation (REQ-CCR-001)', () => {
    it('throws NotFoundError when the transaction is missing', async () => {
        mocks.tx.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({ lean: vi.fn(async () => null) })),
            })),
        }));
        await expect(fetch({ id: OID }, { user })).rejects.toThrow(/غير موجود/);
    });

    it('throws when the transaction is an EXPENSE (supplier / not customer)', async () => {
        mocks.tx.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    lean: vi.fn(async () => makeTx({ type: 'EXPENSE' })),
                })),
            })),
        }));
        await expect(fetch({ id: OID }, { user })).rejects.toThrow(/ليس سند تحصيل عميل/);
    });

    it('throws when the transaction has no customer partner', async () => {
        // Manual income without a partnerId — not a customer collection.
        mocks.tx.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    lean: vi.fn(async () => makeTx({
                        referenceType: 'Manual',
                        partnerId: null,
                        referenceId: null,
                    })),
                })),
            })),
        }));
        await expect(fetch({ id: OID }, { user })).rejects.toThrow(/ليس سند تحصيل عميل/);
    });

    it('throws when the linked customer no longer exists', async () => {
        mocks.customer.findById.mockImplementation(() => ({
            select: vi.fn(() => ({ lean: vi.fn(async () => null) })),
        }));
        await expect(fetch({ id: OID }, { user })).rejects.toThrow(/غير موجود/);
    });

    it('throws when no id is provided', async () => {
        await expect(fetch({}, { user })).rejects.toThrow(/مطلوب/);
    });
});

describe('customerCollectionReceipt — reference resolution', () => {
    it('uses the invoice number when referenceType=Invoice', async () => {
        mocks.tx.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    lean: vi.fn(async () => makeTx({
                        referenceType: 'Invoice',
                        referenceId: { _id: 'inv-1', number: 'INV-2026-001' },
                    })),
                })),
            })),
        }));
        const data = await fetch({ id: OID }, { user });
        expect(data.transaction.referenceType).toBe('Invoice');
        expect(data.transaction.referenceTypeLabel).toBe('فاتورة مبيعات');
        expect(data.transaction.referenceNumber).toBe('INV-2026-001');
    });

    it('labels UnifiedCollection correctly', async () => {
        const data = await fetch({ id: OID }, { user });
        expect(data.transaction.referenceType).toBe('UnifiedCollection');
        expect(data.transaction.referenceTypeLabel).toBe('تحصيل مجمع');
    });

    it('labels Manual as تحصيل يدوي when no reference is set', async () => {
        mocks.tx.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    lean: vi.fn(async () => makeTx({
                        referenceType: 'Manual',
                        referenceId: null,
                        partnerId: OID,
                    })),
                })),
            })),
        }));
        const data = await fetch({ id: OID }, { user });
        expect(data.transaction.referenceTypeLabel).toBe('تحصيل يدوي');
    });
});
