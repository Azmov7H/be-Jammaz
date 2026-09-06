import { createPdf, toBuffer, titleLine, putText, rtlTable, contentWidth } from '../lib/pdf/index.js';

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

const COLUMNS = [
    { key: 'date', header: 'التاريخ', width: 70, role: 'date' },
    { key: 'type', header: 'النوع', width: 50 },
    { key: 'method', header: 'الطريقة', width: 70 },
    { key: 'amount', header: 'المبلغ', width: 75, role: 'money' },
    { key: 'receiptNumber', header: 'رقم السند', width: 80, role: 'id' },
    { key: 'description', header: 'الوصف', width: 0 },
];

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
    const doc = createPdf({ title: 'كشف حركة الخزينة' });
    const width = contentWidth(doc);

    titleLine(doc, 'كشف حركة الخزينة', MARGIN, MARGIN, { size: 16, width });
    const range = [from, to].filter(Boolean).join(' – ');
    putText(doc, range ? `الفترة: ${range}` : 'كامل السجل', MARGIN, MARGIN + 24, {
        size: 9, color: '#6b7280', width,
    });
    putText(doc, `تاريخ الاستخراج: ${new Date().toISOString().slice(0, 10)} • عدد الحركات: ${rows.length}`, MARGIN, MARGIN + 38, {
        size: 9, color: '#6b7280', width,
    });

    const tableColumns = COLUMNS.map((c, i, all) => ({
        header: c.header,
        width: i === all.length - 1
            ? width - all.slice(0, -1).reduce((s, x) => s + x.width, 0)
            : c.width,
        role: c.role,
    }));

    let y = rtlTable(doc, {
        columns: tableColumns,
        rows: rows.map((row) => COLUMNS.map((c) => String(cellText(c, row)))),
        x: MARGIN, y: MARGIN + 62,
    });

    let income = 0;
    let expense = 0;
    for (const row of rows) {
        if (row.type === 'INCOME') income += Number(row.amount) || 0;
        else expense += Number(row.amount) || 0;
    }

    y += 10;
    if (y > 770) {
        doc.addPage();
        y = MARGIN;
    }
    putText(doc, `إجمالي الوارد: ${fmtAmount(income)}`, MARGIN, y, { size: 11, bold: true, width });
    putText(doc, `إجمالي الصادر: ${fmtAmount(expense)}`, MARGIN, y + 16, { size: 11, bold: true, width });
    putText(doc, `الصافي: ${fmtAmount(income - expense)}`, MARGIN, y + 32, { size: 11, bold: true, width });

    return toBuffer(doc);
}
