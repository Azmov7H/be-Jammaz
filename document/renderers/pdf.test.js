/**
 * PDF-EXP-500 — purchase-invoice PDF export must not 500.
 *
 * Regression: GET /api/documents/PURCHASE_INVOICE/:id/export?format=pdf
 * returned 500 because (a) no PURCHASE_INVOICE renderer was registered
 * and (b) the not-implemented throw was a plain Error, which mapError()
 * collapses to 500 instead of the intended 501.
 *
 * Locks:
 *  - renderPdf('PURCHASE_INVOICE', data) returns a %PDF buffer
 *  - still-missing renderers reject with an AppError 501 (never a 500)
 */
import { describe, it, expect } from 'vitest';

import { renderPdf, renderPurchaseInvoicePdf } from './pdf.js';
import { render } from './index.js';
import { AppError } from '../../lib/errors.js';

function makePurchaseData(overrides = {}) {
    return {
        branding: { companyName: 'شركتكم', primaryColor: '#1B3C73' },
        number: 'PO-100',
        date: '20 أغسطس 2026',
        paymentStatusLabel: 'مدفوع جزئياً',
        supplier: { name: 'مورد الأمل', phone: '010', taxNumber: 'T-S1', address: 'الجيزة', balance: 650 },
        purchaseOrder: { statusLabel: 'مستلم', notes: 'ملاحظات', createdBy: 'علي' },
        items: [
            { productName: 'منتج أ', qtyOrdered: 10, qtyReceived: 10, unitPrice: 100, lineTotal: 1000 },
            { productName: 'منتج ب', qtyOrdered: 5, qtyReceived: 3, unitPrice: 50, lineTotal: 150 },
        ],
        totals: { subtotal: 1150, paidAmount: 500, remaining: 650, total: 1150 },
        payment: { methodLabel: 'نقدي', isElectronic: false, sourceNumber: '', dueDate: '' },
        ...overrides,
    };
}

describe('renderPurchaseInvoicePdf', () => {
    it('returns a PDF buffer for the fetcher shape', async () => {
        const buf = await renderPurchaseInvoicePdf(makePurchaseData());
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('survives sparse data (missing supplier/items/notes)', async () => {
        const buf = await renderPurchaseInvoicePdf({ branding: {}, totals: {} });
        expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    });
});

describe('renderPdf dispatcher', () => {
    it('routes PURCHASE_INVOICE to the new renderer', async () => {
        const buf = await renderPdf('PURCHASE_INVOICE', makePurchaseData());
        expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('rejects unimplemented types with AppError 501, not a 500', async () => {
        await expect(renderPdf('SUPPLIER_PAYMENT_RECEIPT', {}))
            .rejects.toMatchObject({ statusCode: 501 });
        try {
            await renderPdf('SUPPLIER_PAYMENT_RECEIPT', {});
            expect.unreachable();
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
        }
    });

    it('rejects unknown formats with AppError 501', async () => {
        await expect(render('xlsx', 'PURCHASE_INVOICE', {}))
            .rejects.toMatchObject({ statusCode: 501 });
    });
});
