import PDFDocument from 'pdfkit';
import { FONT_PATHS, fontFor } from './fonts.js';
import { visual } from './text.js';

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

export function createPdf({ margin = 36, title = 'Document' } = {}) {
    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: margin, bottom: margin, left: margin, right: margin },
        info: { Title: title, Producer: 'Jammaz ERP' },
        bufferPages: true,
    });
    doc.registerFont('ar', FONT_PATHS.regular);
    doc.registerFont('ar-bold', FONT_PATHS.bold);
    doc.registerFont('latin', 'Helvetica');
    doc.registerFont('latin-bold', 'Helvetica-Bold');
    doc.font('ar');
    doc.fillColor('#111827');
    return doc;
}

export function toBuffer(doc) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}

export function contentWidth(doc) {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

export function pageBottom(doc) {
    return doc.page.height - doc.page.margins.bottom;
}

export function putText(doc, logical, x, y, { size = 9, bold = false, color = '#111827', width, align = 'right', role = 'text' } = {}) {
    doc.font(fontFor(logical, bold)).fontSize(size).fillColor(color);
    doc.text(visual(logical, role), x, y, { width, align });
    return doc;
}

export function titleLine(doc, logical, x, y, { size = 16, bold = true, color = '#111827', width, align = 'right' } = {}) {
    return putText(doc, logical, x, y, { size, bold, color, width, align });
}

export function footerLine(doc, logical, { size = 8, color = '#1B3C73' } = {}) {
    const m = doc.page.margins;
    putText(doc, logical, m.left, doc.page.height - m.bottom - 24, {
        size, color, width: contentWidth(doc), align: 'center',
    });
    return doc;
}

function rowHeight(doc, cells, columns, fontSize) {
    doc.font('ar-bold').fontSize(fontSize);
    let h = fontSize + 5;
    cells.forEach((cell, i) => {
        h = Math.max(h, doc.heightOfString(visual(cell, columns[i].role), { width: columns[i].width - 8 }) + 8);
    });
    return h;
}

export function rtlTable(doc, { columns, rows, x, y, fontSize = 9, headerFill = '#1f2937', headerColor = '#ffffff', zebra = true } = {}) {
    const widths = columns.map((c) => c.width);
    const tableWidth = widths.reduce((s, w) => s + w, 0);
    const top = doc.page.margins.top;

    const drawHeaderAt = (hy) => {
        doc.rect(x, hy, tableWidth, 22).fill(headerFill);
        doc.fillColor(headerColor);
        let cx = x + tableWidth;
        columns.forEach((c, i) => {
            cx -= widths[i];
            putText(doc, c.header, cx + 4, hy + 7, {
                size: fontSize, bold: true, color: headerColor, width: widths[i] - 8, align: 'right',
            });
        });
        return hy + 24;
    };

    let cy = drawHeaderAt(y);
    rows.forEach((cells, idx) => {
        const h = rowHeight(doc, cells, columns, fontSize);
        if (cy + h > pageBottom(doc) - 24) {
            doc.addPage();
            cy = drawHeaderAt(top);
        }
        if (zebra && idx % 2 === 1) {
            doc.rect(x, cy, tableWidth, h).fill('#f9fafb');
        }
        doc.fillColor('#111827');
        doc.font('ar').fontSize(fontSize);
        let cx = x + tableWidth;
        cells.forEach((cell, i) => {
            cx -= widths[i];
            putText(doc, cell, cx + 4, cy + 4, {
                size: fontSize, width: widths[i] - 8, align: 'right', role: columns[i].role,
            });
        });
        cy += h;
    });
    doc.fillColor('#111827');
    return cy;
}

export function infoGrid(doc, { left = [], right = [], x, y, width, fontSize = 9 } = {}) {
    const colW = width / 2;
    const block = (items, bx, by) => {
        let cy = by;
        for (const [label, value] of items) {
            putText(doc, label, bx, cy, { size: fontSize, color: '#6b7280', width: colW / 2, align: 'right' });
            putText(doc, value ?? '', bx + colW / 2, cy, { size: fontSize, bold: true, width: colW / 2, align: 'right' });
            cy += 14;
        }
        return cy;
    };
    const leftEnd = block(left, x, y);
    const rightEnd = block(right, x + colW, y);
    return Math.max(leftEnd, rightEnd) + 8;
}

export function totalsBox(doc, { rows = [], grand = null, x, y, width = 240, currency = 'ج.م' } = {}) {
    const boxH = 16 + rows.length * 14 + (grand ? 24 : 0);
    doc.rect(x, y, width, boxH).fill('#f3f4f6');
    let cy = y;
    doc.font('ar').fontSize(9);
    rows.forEach((r) => {
        putText(doc, r.label, x + 8, cy + 4, { size: 9, color: '#374151', width: width / 2 - 16, align: 'right' });
        putText(doc, `${r.value ?? ''} ${currency}`, x + width / 2, cy + 4, {
            size: 9, bold: true, width: width / 2 - 8, align: 'right',
        });
        cy += 14;
    });
    if (grand) {
        cy += 4;
        doc.moveTo(x + 8, cy).lineTo(x + width - 8, cy).strokeColor('#1B3C73').lineWidth(1).stroke();
        cy += 4;
        putText(doc, grand.label, x + 8, cy, { size: 11, bold: true, color: '#1B3C73', width: width / 2 - 16, align: 'right' });
        putText(doc, `${grand.value ?? ''} ${currency}`, x + width / 2, cy, {
            size: 11, bold: true, color: '#1B3C73', width: width / 2 - 8, align: 'right',
        });
        cy += 16;
    }
    doc.fillColor('#111827');
    return cy + 8;
}
