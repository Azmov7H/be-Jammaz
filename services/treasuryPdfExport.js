import { createArabicDoc, docToBuffer, shapeArabic } from './arabicPdf.js';

const TYPE_AR = { INCOME: 'وارد', EXPENSE: 'صادر' };
const METHOD_AR = {
    cash: 'كاش',
    bank: 'بنك',
    wallet: 'محفظة',
    check: 'شيك',
    instapay: 'انستا باي',
    adjustment: 'تسوية',
};

const MARGIN = 36;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLUMNS = [
    { key: 'date', header: 'التاريخ', width: 70 },
    { key: 'type', header: 'النوع', width: 50 },
    { key: 'method', header: 'الطريقة', width: 70 },
    { key: 'amount', header: 'المبلغ', width: 75 },
    { key: 'receiptNumber', header: 'رقم السند', width: 80 },
    { key: 'description', header: 'الوصف', width: 0 },
];
COLUMNS[COLUMNS.length - 1].width =
    CONTENT_WIDTH - COLUMNS.slice(0, -1).reduce((s, c) => s + c.width, 0);

function fmtAmount(n) {
    return Number(n ?? 0).toLocaleString('en-US');
}

function cellText(col, row) {
    if (col.key === 'type') return TYPE_AR[row.type] || row.type || '';
    if (col.key === 'method') return METHOD_AR[row.method] || row.method || '';
    if (col.key === 'amount') return fmtAmount(row.amount);
    return row[col.key] ?? '';
}

export async function buildTreasuryPdf(rows, { from = '', to = '' } = {}) {
    const doc = createArabicDoc();

    doc.font('ar-bold').fontSize(16).fillColor('#111827');
    doc.text(shapeArabic('كشف حركة الخزينة'), MARGIN, MARGIN, { width: CONTENT_WIDTH, align: 'right' });
    doc.font('ar').fontSize(9).fillColor('#6b7280');
    const range = [from, to].filter(Boolean).join(' ← ');
    doc.text(shapeArabic(range ? `الفترة: ${range}` : 'كامل السجل'), MARGIN, MARGIN + 24, {
        width: CONTENT_WIDTH,
        align: 'right',
    });
    doc.text(
        shapeArabic(`تاريخ الاستخراج: ${new Date().toISOString().slice(0, 10)} • عدد الحركات: ${rows.length}`),
        MARGIN,
        MARGIN + 38,
        { width: CONTENT_WIDTH, align: 'right' }
    );

    let y = MARGIN + 62;
    const rowHeight = (texts, bold) => {
        doc.font(bold ? 'ar-bold' : 'ar');
        doc.fontSize(9);
        let h = 14;
        for (const col of COLUMNS) {
            const t = shapeArabic(texts[col.key] ?? '');
            h = Math.max(h, doc.heightOfString(t, { width: col.width - 8 }) + 8);
        }
        return h;
    };

    const drawRow = (texts, { header = false } = {}) => {
        const h = rowHeight(texts, header);
        if (y + h > 806) {
            doc.addPage();
            y = MARGIN;
        }
        if (header) {
            doc.rect(MARGIN, y, CONTENT_WIDTH, h).fill('#1f2937');
            doc.fillColor('#ffffff');
        } else {
            doc.fillColor('#111827');
        }
        doc.font(header ? 'ar-bold' : 'ar').fontSize(9);
        let x = PAGE_WIDTH - MARGIN;
        for (const col of COLUMNS) {
            x -= col.width;
            doc.text(shapeArabic(texts[col.key] ?? ''), x + 4, y + 4, {
                width: col.width - 8,
                align: 'right',
            });
        }
        y += h;
        doc.fillColor('#111827');
        return h;
    };

    drawRow(Object.fromEntries(COLUMNS.map((c) => [c.key, c.header])), { header: true });
    let income = 0;
    let expense = 0;
    for (const row of rows) {
        if (row.type === 'INCOME') income += Number(row.amount) || 0;
        else expense += Number(row.amount) || 0;
        drawRow(Object.fromEntries(COLUMNS.map((c) => [c.key, cellText(c, row)])));
    }

    y += 10;
    if (y > 770) {
        doc.addPage();
        y = MARGIN;
    }
    doc.font('ar-bold').fontSize(11);
    doc.text(shapeArabic(`إجمالي الوارد: ${fmtAmount(income)}`), MARGIN, y, { width: CONTENT_WIDTH, align: 'right' });
    doc.text(shapeArabic(`إجمالي الصادر: ${fmtAmount(expense)}`), MARGIN, y + 16, { width: CONTENT_WIDTH, align: 'right' });
    doc.text(shapeArabic(`الصافي: ${fmtAmount(income - expense)}`), MARGIN, y + 32, { width: CONTENT_WIDTH, align: 'right' });

    return docToBuffer(doc);
}
