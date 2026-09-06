import { describe, it, expect } from 'vitest';

import {
    createPdf, toBuffer, putText, titleLine, footerLine,
    rtlTable, infoGrid, totalsBox, contentWidth,
} from './layout.js';

describe('createPdf', () => {
    it('registers all four faces', () => {
        const doc = createPdf();
        for (const name of ['ar', 'ar-bold', 'latin', 'latin-bold']) {
            expect(() => doc.font(name)).not.toThrow();
        }
    });

    it('produces a valid PDF buffer', async () => {
        const doc = createPdf({ title: 'probe' });
        titleLine(doc, 'فاتورة مشتريات', 36, 36, { width: contentWidth(doc) });
        const buf = await toBuffer(doc);
        expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    });
});

describe('putText', () => {
    it('renders mixed strings without throwing', async () => {
        const doc = createPdf();
        putText(doc, 'رصيد 1,250.50 ج.م', 36, 36, { width: 400 });
        putText(doc, 'PO-100', 36, 60, { width: 400 });
        footerLine(doc, 'شكراً لتعاملكم');
        const buf = await toBuffer(doc);
        expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    });
});

describe('rtlTable', () => {
    const columns = [
        { header: 'التاريخ', width: 70 },
        { header: 'النوع', width: 50 },
        { header: 'الوصف', width: 200 },
    ];

    it('draws header plus rows and returns the end position', async () => {
        const doc = createPdf();
        const endY = rtlTable(doc, {
            columns,
            rows: [['2026-09-06', 'وارد', 'تحصيل من العميل أحمد PO-100']],
            x: 36, y: 36,
        });
        expect(endY).toBeGreaterThan(36);
        const buf = await toBuffer(doc);
        expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('flows across pages with repeated headers', async () => {
        const doc = createPdf();
        const rows = Array.from({ length: 120 }, (_, i) => [
            '2026-09-06', 'وارد', `عملية رقم ${i + 1} تحصيل`,
        ]);
        rtlTable(doc, { columns, rows, x: 36, y: 36 });
        expect(doc.bufferedPageRange().count).toBeGreaterThan(1);
        const buf = await toBuffer(doc);
        expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    });
});

describe('infoGrid and totalsBox', () => {
    it('renders without throwing and advances the cursor', async () => {
        const doc = createPdf();
        const w = contentWidth(doc);
        const y1 = infoGrid(doc, {
            left: [['اسم المورد', 'مورد الأمل'], ['الهاتف', '010']],
            right: [['طريقة الدفع', 'نقدي']],
            x: 36, y: 36, width: w,
        });
        expect(y1).toBeGreaterThan(36);
        const y2 = totalsBox(doc, {
            rows: [{ label: 'المدفوع', value: '500.00' }],
            grand: { label: 'الإجمالي', value: '1,150.00' },
            x: 36, y: y1, width: 240,
        });
        expect(y2).toBeGreaterThan(y1);
        const buf = await toBuffer(doc);
        expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    });
});
