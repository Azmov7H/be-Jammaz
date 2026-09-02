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
