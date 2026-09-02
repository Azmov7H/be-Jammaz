/**
 * T-UNIT-FETCH-001 — saleInvoice fetcher unit tests.
 *
 * Tests the data-shaping layer in isolation by stubbing the three
 * Mongoose models the fetcher depends on. The integration path
 * (T-INT-DOC-001) runs the same fetcher against a real in-memory DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks MUST be declared before importing the fetcher -----------------
const mocks = vi.hoisted(() => ({
    invoice: { findById: vi.fn() },
    salesReturn: { find: vi.fn() },
    customer: { name: 'C' },
    branding: {
        getBranding: vi.fn(async () => ({
            companyName: 'مؤسستي',
            companyLogo: '',
            showLogo: false,
            showQRCode: true,
            primaryColor: '#1B3C73',
            headerBgColor: '#1B3C73',
            address: 'القاهرة',
            phone: '010',
            additionalPhones: [],
            email: '',
            website: '',
            footerText: 'شكراً',
        })),
    },
    db: { default: async () => ({}) },
}));

vi.mock('../../models/Invoice.js', () => ({ default: mocks.invoice }));
vi.mock('../../models/SalesReturn.js', () => ({ default: mocks.salesReturn }));
vi.mock('../../models/Customer.js', () => ({ default: mocks.customer }));
vi.mock('../../lib/branding.js', () => mocks.branding);
vi.mock('../../lib/db.js', () => mocks.db);

import fetcher from './saleInvoice.js';

const OID = 'a'.repeat(24);
const user = { _id: 'u1', name: 'Owner', role: 'owner' };

function makeInvoiceDoc(overrides = {}) {
    return {
        _id: OID,
        number: 'INV-2026-001',
        date: new Date('2026-08-30T14:30:00Z'),
        items: [
            { _id: 'i1', productId: null, productName: 'منتج 1', qty: 2, unitPrice: 50, total: 100, isService: false },
            { _id: 'i2', productId: null, productName: 'خدمة', qty: 1, unitPrice: 30, total: 30, isService: true },
        ],
        subtotal: 130,
        tax: 0,
        total: 130,
        paidAmount: 130,
        paymentType: 'cash',
        sourceNumber: '',
        paymentStatus: 'paid',
        customer: { _id: OID, name: 'علي', phone: '010', taxNumber: '', address: 'القاهرة' },
        customerName: 'علي',
        customerPhone: '010',
        createdBy: { name: 'علي' },
        hasReturns: false,
        payments: [],
        ...overrides,
    };
}

function makeReturnsChain(docs = []) {
    // Returns find().sort().lean() chainable.
    const chain = {
        populate: vi.fn(() => chain),
        sort: vi.fn(() => chain),
        lean: vi.fn(async () => docs),
    };
    return chain;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoice.findById.mockImplementation(() => ({
        populate: vi.fn(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    lean: vi.fn(async () => ({
                        _id: OID,
                        number: 'INV-1',
                        date: new Date('2026-08-30T14:30:00Z'),
                        items: [],
                        subtotal: 0, tax: 0, total: 0, paidAmount: 0,
                        paymentType: 'cash', sourceNumber: '',
                        paymentStatus: 'paid',
                        customer: null, customerName: '', customerPhone: '',
                        createdBy: { name: '' },
                        payments: [], hasReturns: false,
                    })),
                })),
            })),
        })),
    }));
    mocks.salesReturn.find.mockReturnValue(makeReturnsChain([]));
});

describe('saleInvoice fetcher — base shape', () => {
    it('returns a SALE_INVOICE DocumentData with all top-level fields', async () => {
        mocks.invoice.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    populate: vi.fn(() => ({
                        lean: vi.fn(async () => makeInvoiceDoc()),
                    })),
                })),
            })),
        }));

        const data = await fetcher.fetch({ id: OID }, { user });
        expect(data.type).toBe('SALE_INVOICE');
        expect(data.title).toBe('فاتورة مبيعات');
        expect(data.number).toBe('INV-2026-001');
        expect(data.branding.companyName).toBe('مؤسستي');
        expect(data.customer.name).toBe('علي');
        expect(data.items).toHaveLength(2);
        expect(data.totals.subtotal).toBe(130);
        expect(data.totals.total).toBe(130);
        expect(data.totals.remaining).toBe(0);
        expect(data.payment.methodLabel).toBe('نقدي');
        expect(data.payment.channelLabel).toBe('الخزينة الخاصة');
        expect(data.payment.isElectronic).toBe(false);
    });

    it('throws NotFoundError when the invoice does not exist', async () => {
        mocks.invoice.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    populate: vi.fn(() => ({ lean: vi.fn(async () => null) })),
                })),
            })),
        }));
        await expect(fetcher.fetch({ id: OID }, { user })).rejects.toThrow(/غير موجودة/);
    });

    it('throws when no id is provided', async () => {
        await expect(fetcher.fetch({}, { user })).rejects.toThrow(/مطلوب/);
    });
});

describe('saleInvoice fetcher — payment method labels (REQ-DOC-010)', () => {
    const cases = [
        ['cash',     'نقدي',           'الخزينة الخاصة', false],
        ['bank',     'تحويل بنكي',     'البنك',           false],
        ['wallet',   'محفظة كاش',      'محفظة الكاش',     true],
        ['instapay', 'انستا باي',      'انستا باي',       true],
        ['check',    'شيك',            'الشيكات',         false],
        ['credit',   'آجل',            'غير محدد',        false],
    ];

    it.each(cases)('method %s → label "%s" / channel "%s" / electronic=%s',
        async (method, methodLabel, channelLabel, isElectronic) => {
            mocks.invoice.findById.mockImplementation(() => ({
                populate: vi.fn(() => ({
                    populate: vi.fn(() => ({
                        populate: vi.fn(() => ({
                            lean: vi.fn(async () => makeInvoiceDoc({
                                paymentType: method,
                                paymentStatus: method === 'credit' ? 'pending' : 'paid',
                                paidAmount: method === 'credit' ? 0 : 130,
                            })),
                        })),
                    })),
                })),
            }));
            const data = await fetcher.fetch({ id: OID }, { user });
            expect(data.payment.methodLabel).toBe(methodLabel);
            expect(data.payment.channelLabel).toBe(channelLabel);
            expect(data.payment.isElectronic).toBe(isElectronic);
        });
});

describe('saleInvoice fetcher — PII masking (REQ-DOC-008)', () => {
    it('masks sourceNumber for non-privileged roles (electronic channel)', async () => {
        mocks.invoice.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    populate: vi.fn(() => ({
                        lean: vi.fn(async () => makeInvoiceDoc({
                            paymentType: 'instapay',
                            sourceNumber: 'IP-1234567890',
                        })),
                    })),
                })),
            })),
        }));

        // cashier sees a masked source number
        const data = await fetcher.fetch(
            { id: OID },
            { user: { _id: 'u', role: 'cashier', name: 'C' } }
        );
        expect(data.payment.sourceNumber).toMatch(/^••••\s+\d{4}$/);
        expect(data.payment.sourceNumber).not.toBe('IP-1234567890');

        // owner sees the full value
        const data2 = await fetcher.fetch({ id: OID }, { user });
        expect(data2.payment.sourceNumber).toBe('IP-1234567890');
    });

    it('hides sourceNumber entirely on non-electronic channels', async () => {
        mocks.invoice.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    populate: vi.fn(() => ({
                        lean: vi.fn(async () => makeInvoiceDoc({
                            paymentType: 'cash',
                            sourceNumber: 'should-not-appear',
                        })),
                    })),
                })),
            })),
        }));
        const data = await fetcher.fetch({ id: OID }, { user });
        expect(data.payment.sourceNumber).toBe('');
        expect(data.payment.sourceNumber).not.toContain('should-not-appear');
    });
});

describe('saleInvoice fetcher — items + returns', () => {
    it('flattens items into a renderer-friendly shape', async () => {
        mocks.invoice.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    populate: vi.fn(() => ({
                        lean: vi.fn(async () => makeInvoiceDoc()),
                    })),
                })),
            })),
        }));
        const data = await fetcher.fetch(
            { id: OID },
            { user }
        );
        expect(data.items[0]).toMatchObject({
            productName: 'منتج 1',
            qty: 2,
            unitPrice: 50,
            lineTotal: 100,
            unit: '—', // explicit fallback per catalog
        });
    });

    it('attaches returns when present', async () => {
        mocks.invoice.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    populate: vi.fn(() => ({
                        lean: vi.fn(async () => makeInvoiceDoc({ hasReturns: true })),
                    })),
                })),
            })),
        }));
        mocks.salesReturn.find.mockReturnValue(makeReturnsChain([
            {
                _id: 'r1',
                returnNumber: 'RET-1',
                date: new Date('2026-08-31T10:00:00Z'),
                totalRefund: 50,
                items: [{ productName: 'منتج 1', qty: 1, refundAmount: 50 }],
            },
        ]));
        const data = await fetcher.fetch({ id: OID }, { user });
        expect(data.returns).toHaveLength(1);
        expect(data.returns[0].returnNumber).toBe('RET-1');
        expect(data.returns[0].items[0].refundAmount).toBe(50);
        expect(data.hasReturns).toBe(true);
    });

    it('returns empty returns when none exist', async () => {
        mocks.invoice.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    populate: vi.fn(() => ({
                        lean: vi.fn(async () => makeInvoiceDoc()),
                    })),
                })),
            })),
        }));
        const data = await fetcher.fetch({ id: OID }, { user });
        expect(data.returns).toEqual([]);
        expect(data.hasReturns).toBe(false);
    });
});

describe('saleInvoice fetcher — payments history', () => {
    it('lists each payment with its own method + masked source', async () => {
        mocks.invoice.findById.mockImplementation(() => ({
            populate: vi.fn(() => ({
                populate: vi.fn(() => ({
                    populate: vi.fn(() => ({
                        lean: vi.fn(async () => makeInvoiceDoc({
                            paidAmount: 80,
                            paymentType: 'credit',
                            payments: [
                                { amount: 50, date: new Date('2026-08-30T10:00:00Z'),
                                  method: 'instapay', sourceNumber: 'IP-AAAA' },
                                { amount: 30, date: new Date('2026-08-31T10:00:00Z'),
                                  method: 'cash' },
                            ],
                        })),
                    })),
                })),
            })),
        }));
        const data = await fetcher.fetch(
            { id: OID },
            { user: { _id: 'u', role: 'cashier', name: 'C' } }
        );
        expect(data.payments).toHaveLength(2);
        expect(data.payments[0].methodLabel).toBe('انستا باي');
        // last 4 chars are "AAAA" — the mask format is "•••• <last4>".
        expect(data.payments[0].sourceNumber).toMatch(/^••••\s+\S{1,4}$/);
        expect(data.payments[1].methodLabel).toBe('نقدي');
        expect(data.payments[1].sourceNumber).toBe(''); // cash → not electronic
    });
});
