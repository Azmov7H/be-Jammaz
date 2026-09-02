/**
 * T-UNIT-DOC-006 — HTML renderer smoke tests.
 *
 * The renderer is pure HTML string assembly. We lock the structural
 * contracts (RTL, branding color, sections present, escaping).
 */
import { describe, it, expect } from 'vitest';
import { renderHtml } from './html.js';
import { renderPrintHtml } from './print.js';
import { DOCUMENT_TYPES } from '../../lib/documentRegistry.js';

const OID = 'a'.repeat(24);

function sampleData(overrides = {}) {
    return {
        type: DOCUMENT_TYPES.SALE_INVOICE,
        title: 'فاتورة مبيعات',
        number: 'INV-1',
        date: '30/08/2026',
        time: '14:30',
        status: 'مدفوع بالكامل',
        branding: {
            companyName: 'مؤسستي',
            companyLogo: '',
            showLogo: false,
            primaryColor: '#1B3C73',
            headerBgColor: '#1B3C73',
            address: 'القاهرة',
            phone: '010',
            additionalPhones: [],
            email: '',
            website: '',
            footerText: 'شكراً',
        },
        customer: { name: 'علي', phone: '010', address: '', taxNumber: '' },
        invoice: { id: OID, number: 'INV-1', notes: '', createdBy: 'علي' },
        items: [
            { productName: 'منتج 1', qty: 2, unitPrice: 50, lineTotal: 100 },
            { productName: 'منتج 2', qty: 1, unitPrice: 30, lineTotal: 30 },
        ],
        totals: { subtotal: 130, tax: 0, total: 130, paidAmount: 130, remaining: 0 },
        payment: {
            method: 'cash', methodLabel: 'نقدي',
            channel: 'private_treasury', channelLabel: 'الخزينة الخاصة',
            sourceNumber: '', isElectronic: false, dueDate: '',
        },
        payments: [],
        returns: [],
        hasReturns: false,
        ...overrides,
    };
}

describe('renderHtml — SALE_INVOICE', () => {
    it('returns RTL HTML with the company name in the header', () => {
        const html = renderHtml(DOCUMENT_TYPES.SALE_INVOICE, sampleData());
        expect(html).toContain('<html lang="ar" dir="rtl">');
        expect(html).toContain('مؤسستي');
        expect(html).toContain('فاتورة مبيعات');
        expect(html).toContain('INV-1');
    });

    it('uses the company primary color as the accent', () => {
        const html = renderHtml(DOCUMENT_TYPES.SALE_INVOICE, sampleData({
            branding: { ...sampleData().branding, primaryColor: '#ff00ff' }
        }));
        expect(html).toContain('--primary: #ff00ff');
    });

    it('renders every item row + the totals block', () => {
        const html = renderHtml(DOCUMENT_TYPES.SALE_INVOICE, sampleData());
        expect(html).toContain('منتج 1');
        expect(html).toContain('منتج 2');
        expect(html).toContain('130.00'); // total
    });

    it('escapes user-supplied content (XSS)', () => {
        const data = sampleData({
            customer: { name: '<script>alert(1)</script>', phone: '', address: '', taxNumber: '' },
            items: [{ productName: '"&<x>', qty: 1, unitPrice: 1, lineTotal: 1 }],
        });
        const html = renderHtml(DOCUMENT_TYPES.SALE_INVOICE, data);
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('"');
    });

    it('shows the source number for electronic channels when present', () => {
        const data = sampleData({
            payment: {
                method: 'instapay', methodLabel: 'انستا باي',
                channel: 'instapay', channelLabel: 'انستا باي',
                sourceNumber: 'IP-1234', isElectronic: true, dueDate: '',
            },
        });
        const html = renderHtml(DOCUMENT_TYPES.SALE_INVOICE, data);
        expect(html).toContain('IP-1234');
        expect(html).toContain('رقم التحويل');
    });

    it('hides the source number for cash even if the model has one', () => {
        const data = sampleData({
            payment: {
                method: 'cash', methodLabel: 'نقدي',
                channel: 'private_treasury', channelLabel: 'الخزينة الخاصة',
                sourceNumber: 'should-not-appear', isElectronic: false, dueDate: '',
            },
        });
        const html = renderHtml(DOCUMENT_TYPES.SALE_INVOICE, data);
        expect(html).not.toContain('should-not-appear');
    });

    it('renders the returns block when hasReturns is true', () => {
        const data = sampleData({
            hasReturns: true,
            returns: [
                {
                    returnNumber: 'RET-1',
                    date: new Date('2026-08-31T10:00:00Z').toISOString(),
                    totalRefund: 50,
                    items: [{ productName: 'منتج 1', qty: 1, refundAmount: 50 }],
                },
            ],
        });
        const html = renderHtml(DOCUMENT_TYPES.SALE_INVOICE, data);
        expect(html).toContain('سجل المرتجعات');
        expect(html).toContain('RET-1');
        expect(html).toContain('50.00');
    });

    it('renders the payments history block when there are multiple payments', () => {
        const data = sampleData({
            payment: {
                method: 'credit', methodLabel: 'آجل',
                channel: 'unknown', channelLabel: 'غير محدد',
                sourceNumber: '', isElectronic: false, dueDate: '15/09/2026',
            },
            totals: { ...sampleData().totals, paidAmount: 50, remaining: 80 },
            payments: [
                { amount: 50, date: '2026-08-30T10:00:00Z', method: 'instapay',
                  methodLabel: 'انستا باي', channel: 'instapay', channelLabel: 'انستا باي',
                  sourceNumber: 'IP-1234', note: '' },
                { amount: 30, date: '2026-08-31T10:00:00Z', method: 'cash',
                  methodLabel: 'نقدي', channel: 'private_treasury', channelLabel: 'الخزينة الخاصة',
                  sourceNumber: '', note: '' },
            ],
        });
        const html = renderHtml(DOCUMENT_TYPES.SALE_INVOICE, data);
        expect(html).toContain('سجل المدفوعات');
        expect(html).toContain('انستا باي');
    });

    it('does not render the payments history block for a single payment', () => {
        // The single-payment case is rendered in the main "Payment" block.
        const html = renderHtml(DOCUMENT_TYPES.SALE_INVOICE, sampleData());
        expect(html).not.toContain('سجل المدفوعات');
    });

    it('falls back to a placeholder for a not-yet-implemented type', () => {
        // COMPANY_FINANCIAL_STATEMENT lands in S9; before that, the
        // placeholder is the right behavior.
        const html = renderHtml(DOCUMENT_TYPES.COMPANY_FINANCIAL_STATEMENT, {
            branding: { companyName: 'X' },
        });
        expect(html).toContain('COMPANY_FINANCIAL_STATEMENT');
        expect(html).toContain('Sprint 9');
    });
});

describe('renderPrintHtml', () => {
    it('adds the print CSS to the embedded style block', () => {
        const html = renderPrintHtml(DOCUMENT_TYPES.SALE_INVOICE, sampleData());
        expect(html).toMatch(/@page\s*\{\s*size:\s*A4/);
        expect(html).toContain('print-color-adjust: exact');
    });

    it('injects an auto-print script when autoPrint is true', () => {
        const html = renderPrintHtml(
            DOCUMENT_TYPES.SALE_INVOICE, sampleData(), { autoPrint: true }
        );
        expect(html).toContain('window.print()');
    });

    it('does NOT inject the auto-print script by default', () => {
        const html = renderPrintHtml(DOCUMENT_TYPES.SALE_INVOICE, sampleData());
        expect(html).not.toContain('window.print()');
    });
});

// ---------------------------------------------------------------------------
// CUSTOMER_COLLECTION_RECEIPT
// ---------------------------------------------------------------------------

function sampleReceipt(overrides = {}) {
    return {
        type: DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT,
        title: 'سند تحصيل من عميل',
        documentType: 'customer-collection-receipt',
        receiptNumber: 'REC-100',
        date: '30/08/2026',
        time: '14:30',
        status: 'مدفوع',
        branding: {
            companyName: 'مؤسستي',
            primaryColor: '#1B3C73',
            headerBgColor: '#1B3C73',
            address: 'القاهرة',
            phone: '010',
            additionalPhones: [],
            email: '',
            website: '',
            footerText: 'شكراً',
        },
        customer: { name: 'شركة عينة', phone: '010', address: 'القاهرة', taxNumber: '12345' },
        transaction: {
            id: 'tx-1',
            amount: 500,
            description: 'تحصيل دفعة',
            referenceType: 'UnifiedCollection',
            referenceTypeLabel: 'تحصيل مجمع',
            referenceNumber: '—',
            createdBy: 'علي',
        },
        previousBalance: 2000,
        remainingBalance: 1500,
        collectedAmount: 500,
        payment: {
            method: 'cash', methodLabel: 'نقدي',
            channel: 'private_treasury', channelLabel: 'الخزينة الخاصة',
            sourceNumber: '', isElectronic: false,
        },
        ...overrides,
    };
}

describe('renderHtml — CUSTOMER_COLLECTION_RECEIPT', () => {
    it('renders the receipt with the customer-collection title', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT, sampleReceipt());
        expect(html).toContain('سند تحصيل من عميل');
        expect(html).toContain('REC-100');
        expect(html).toContain('data-document-type="customer-collection-receipt"');
    });

    it('renders the amount box with the collected amount + currency', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT, sampleReceipt({
            collectedAmount: 1234.5,
        }));
        expect(html).toContain('1,234.50');
        expect(html).toContain('المبلغ المستلم');
    });

    it('renders the previous / collected / remaining balance trio', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT, sampleReceipt({
            previousBalance: 3000,
            collectedAmount: 1500,
            remainingBalance: 1500,
        }));
        expect(html).toContain('الرصيد السابق');
        expect(html).toContain('المبلغ المحصل');
        expect(html).toContain('الرصيد المتبقي');
        expect(html).toContain('3,000.00');
        expect(html).toContain('1,500.00');
    });

    it('shows the source number for electronic channels when present', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT, sampleReceipt({
            payment: {
                method: 'instapay', methodLabel: 'انستا باي',
                channel: 'instapay', channelLabel: 'انستا باي',
                sourceNumber: '**** 4321', isElectronic: true,
            },
        }));
        expect(html).toContain('**** 4321');
        expect(html).toContain('رقم التحويل');
    });

    it('hides the source number for cash / bank / check', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT, sampleReceipt());
        expect(html).not.toContain('رقم التحويل');
    });

    it('renders the description block when present', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT, sampleReceipt({
            transaction: { ...sampleReceipt().transaction, description: 'دفعة عن الفاتورة 123' },
        }));
        expect(html).toContain('دفعة عن الفاتورة 123');
        expect(html).toContain('وذلك عن / البيان');
    });

    it('escapes XSS attempts in the description', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT, sampleReceipt({
            transaction: { ...sampleReceipt().transaction, description: '<script>alert(1)</script>' },
        }));
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('renders a badge for the status (always "paid" for collections)', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT, sampleReceipt());
        expect(html).toContain('badge-paid');
        expect(html).toContain('مدفوع');
    });

    it('uses the receiptNumber as the document identifier (no separate invoice#)', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT, sampleReceipt());
        expect(html).toContain('REC-100');
        // No "فاتورة" title.
        expect(html).not.toContain('فاتورة مبيعات');
    });
});

function sampleStatement(overrides = {}) {
    return {
        type: 'customer_statement',
        title: 'كشف حساب عميل',
        documentType: 'CUSTOMER_STATEMENT',
        branding: {
            companyName: 'مؤسستي',
            primaryColor: '#1B3C73',
            headerBgColor: '#1B3C73',
            address: '', phone: '', additionalPhones: [],
            email: '', website: '', footerText: 'شكراً',
        },
        customer: {
            id: OID,
            name: 'شركة الأمل',
            phone: '01012345678',
            address: 'القاهرة',
            taxNumber: 'T-100',
            linkedSupplier: null,
        },
        period: {
            startDate: '2026-08-01T00:00:00.000Z',
            endDate: '2026-08-31T23:59:59.000Z',
            days: 30,
        },
        openingBalance: 1500,
        closingBalance: 2200,
        currentSnapshotBalance: 2200,
        balanceDelta: '0.00',
        totals: { debits: 1000, credits: 300, net: 700 },
        lines: [
            { id: '1', type: 'INVOICE', reference: 'INV-1', label: 'فاتورة مبيعات #INV-1', description: '...', debit: 1000, credit: 0, balance: 2500, dateFormatted: '2026-08-10T00:00:00.000Z', debitFormatted: '1000.00', creditFormatted: '0.00', balanceFormatted: '2500.00' },
            { id: '2', type: 'PAYMENT', reference: 'R-1', label: 'تحصيل نقدي', description: '...', debit: 0, credit: 300, balance: 2200, dateFormatted: '2026-08-15T00:00:00.000Z', debitFormatted: '0.00', creditFormatted: '300.00', balanceFormatted: '2200.00' },
        ],
        generatedAt: '2026-09-01T10:00:00.000Z',
        generatedBy: 'Owner',
        filters: { startDate: '2026-08-01T00:00:00.000Z', endDate: '2026-08-31T23:59:59.000Z' },
        ...overrides,
    };
}

describe('renderHtml — CUSTOMER_STATEMENT', () => {
    it('renders the statement header + customer block', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT, sampleStatement());
        expect(html).toContain('كشف حساب عميل');
        expect(html).toContain('شركة الأمل');
        expect(html).toContain('data-document-type="customer-statement"');
    });

    it('shows the opening, total-debits, total-credits summary cards', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT, sampleStatement());
        expect(html).toContain('الرصيد الافتتاحي');
        expect(html).toContain('إجمالي المدين');
        expect(html).toContain('إجمالي الدائن');
        expect(html).toContain('1,500.00');   // opening
        expect(html).toContain('1,000.00');   // debits
        expect(html).toContain('300.00');     // credits
    });

    it('renders the closing balance and current snapshot', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT, sampleStatement());
        expect(html).toContain('الرصيد الختامي');
        expect(html).toContain('الرصيد المسجل بالنظام');
    });

    it('shows a reconciliation OK banner when balanceDelta is 0', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT, sampleStatement({ balanceDelta: '0.00' }));
        expect(html).toContain('الرصيد متطابق مع السجل');
    });

    it('shows a reconciliation WARN banner when balanceDelta is non-zero', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT, sampleStatement({ balanceDelta: '150.50', currentSnapshotBalance: 2050 }));
        expect(html).toContain('تنبيه: فرق تسوية');
        expect(html).toContain('150.50');
        expect(html).toContain('delta-banner warn');
    });

    it('renders one row per line and the running balance', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT, sampleStatement());
        expect(html).toContain('INV-1');
        expect(html).toContain('R-1');
        expect(html).toContain('2,500.00'); // running after invoice
        expect(html).toContain('2,200.00'); // running after payment (closing)
    });

    it('escapes XSS in customer name and description', () => {
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT, sampleStatement({
            customer: { id: OID, name: '<script>alert(1)</script>', phone: '', address: '', taxNumber: '', linkedSupplier: null },
            lines: [
                { id: '1', type: 'INVOICE', reference: 'X', label: '<img src=x>', description: 'bad', debit: 1, credit: 0, balance: 1, dateFormatted: '2026-08-10T00:00:00.000Z', debitFormatted: '1.00', creditFormatted: '0.00', balanceFormatted: '1.00' }
            ]
        }));
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).not.toContain('<img src=x>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('paginates long statements (multi-page)', () => {
        const lines = Array.from({ length: 35 }, (_, i) => ({
            id: String(i), type: 'INVOICE', reference: `INV-${i}`, label: `فاتورة #${i}`,
            description: '', debit: 100, credit: 0, balance: 1500 + (i + 1) * 100,
            dateFormatted: '2026-08-10T00:00:00.000Z',
            debitFormatted: '100.00', creditFormatted: '0.00', balanceFormatted: String(1500 + (i + 1) * 100)
        }));
        const html = renderHtml(DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT, sampleStatement({ lines }));
        expect(html).toContain('صفحة 1 من 2');
        expect(html).toContain('صفحة 2 من 2');
    });
});
