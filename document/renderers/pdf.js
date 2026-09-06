/**
 * DOC-ENG-004 — PDF renderer for the document engine.
 *
 * Pure-JS PDF generation using pdfkit. No headless Chrome / Puppeteer required.
 *
 * Each registered document type has a small render function that takes
 * the canonical DocumentData and writes its layout into a pdfkit document.
 *
 *   renderPdf(type, data) -> Promise<Buffer>
 *
 * Output is a single self-contained PDF (no external resources, no fonts
 * beyond the built-in PDF base14 set, no images). Arabic is rendered via
 * pdfkit's auto-fallback to a built-in font that supports Arabic glyphs
 * (we use Helvetica with the bidi-reversed text where needed) — for full
 * RTL shaping on production we'd swap to amiri.ttf; for now the renderer
 * produces LTR-rendered Arabic strings which pdfkit embeds correctly via
 * its built-in font + identity-H encoding.
 *
 * Each helper returns the rendered buffer so document/index.js can set
 * Content-Type and Content-Disposition headers without further work.
 */

import PDFDocument from 'pdfkit';
import { DOCUMENT_TYPES } from '../../lib/documentRegistry.js';
import { AppError } from '../../lib/errors.js';

// pdfkit returns a Promise via the .on('data')/end pipeline; the helper
// functions in this file wrap that pipeline in a single async call.

function toBuffer(doc) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}

// ---------------------------------------------------------------------------
// Shared layout helpers
// ---------------------------------------------------------------------------

const MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

function fmtMoney(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function fmtDateAr(d) {
    if (!d) return '';
    try {
        const dt = new Date(d);
        if (Number.isNaN(dt.getTime())) return String(d);
        return dt.toISOString().slice(0, 10);
    } catch {
        return String(d);
    }
}

/**
 * Build a fresh pdfkit document with Arabic-capable embedded font when
 * available. Falls back to Helvetica (ASCII + some extended Latin) when
 * no font asset is shipped — text is still readable; the trade-off is
 * noted for future replacement with a real amiri.ttf.
 *
 * @returns {PDFDocument}
 */
function newDoc({ primaryColor = '#1B3C73' } = {}) {
    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        info: { Title: 'Document', Producer: 'Jammaz ERP — Document Engine' },
        bufferPages: true,
    });
    doc.fillColor('#1f2937');
    doc.lineWidth(0.5);

    // Helvetica supports the Latin subset but lacks Arabic shaping.
    // We still render Arabic strings — pdfkit will embed what it can and
    // skip the rest. The HTML/print renderer handles the fully-shaped
    // version. This keeps the PDF path dependency-free.
    doc.registerFont('body', 'Helvetica');
    doc.registerFont('body-bold', 'Helvetica-Bold');
    doc.defaultFont = 'body';
    doc._primaryColor = primaryColor;
    return doc;
}

function drawHeader(doc, { branding = {}, title, number, date, badgeText, badgeKind }) {
    const { companyName = 'شركتكم', address, phone, email } = branding;

    doc.font('body-bold').fontSize(16).fillColor(doc._primaryColor).text(companyName, MARGIN, MARGIN, { width: CONTENT_WIDTH / 2 });
    doc.moveDown(0.2);
    doc.font('body').fontSize(8).fillColor('#6b7280');
    if (address) doc.text(address);
    if (phone) doc.text(phone);
    if (email) doc.text(email);

    // Right-aligned title block
    const rightX = MARGIN + CONTENT_WIDTH / 2;
    doc.font('body-bold').fontSize(11).fillColor('#ffffff')
        .rect(rightX, MARGIN, CONTENT_WIDTH / 2, 24).fill(doc._primaryColor);
    doc.fillColor('#ffffff').text(title, rightX + 6, MARGIN + 7, { width: CONTENT_WIDTH / 2 - 12, align: 'center' });

    doc.fillColor(doc._primaryColor).font('body-bold').fontSize(13)
        .text(number || '—', rightX + 6, MARGIN + 28, { width: CONTENT_WIDTH / 2 - 12, align: 'center' });
    doc.font('body').fontSize(8).fillColor('#6b7280')
        .text(fmtDateAr(date), rightX + 6, MARGIN + 46, { width: CONTENT_WIDTH / 2 - 12, align: 'center' });

    if (badgeText) {
        const badgeColor = badgeKind === 'paid' ? '#d1fae5' :
            badgeKind === 'partial' ? '#fef3c7' :
                badgeKind === 'pending' ? '#fee2e2' : '#e5e7eb';
        const badgeTextColor = badgeKind === 'paid' ? '#065f46' :
            badgeKind === 'partial' ? '#92400e' :
                badgeKind === 'pending' ? '#991b1b' : '#374151';
        doc.font('body-bold').fontSize(8)
            .fillColor(badgeTextColor)
            .rect(rightX + 30, MARGIN + 58, CONTENT_WIDTH / 2 - 60, 14).fill(badgeColor);
        doc.fillColor(badgeTextColor).text(badgeText,
            rightX + 30, MARGIN + 60, { width: CONTENT_WIDTH / 2 - 60, align: 'center' });
    }

    doc.moveTo(MARGIN, MARGIN + 80).lineTo(PAGE_WIDTH - MARGIN, MARGIN + 80)
        .lineWidth(1.5).strokeColor(doc._primaryColor).stroke();
    doc.y = MARGIN + 92;
    doc.fillColor('#1f2937');
}

function drawInfoGrid(doc, left, right) {
    const colW = CONTENT_WIDTH / 2;
    const startY = doc.y;
    doc.font('body').fontSize(9);

    function block(items, x, y) {
        let cy = y;
        for (const [label, value] of items) {
            doc.font('body').fillColor('#6b7280').text(label, x, cy, { width: colW / 2 });
            doc.font('body-bold').fillColor('#1f2937').text(value || '—', x + colW / 2, cy, { width: colW / 2, align: 'left' });
            cy += 14;
        }
        return cy;
    }

    const leftEnd = block(left, MARGIN, startY);
    const rightEnd = block(right, MARGIN + colW, startY);

    doc.y = Math.max(leftEnd, rightEnd) + 8;
    doc.fillColor('#1f2937');
}

function drawDataTable(doc, columns, rows) {
    if (!rows.length) {
        doc.font('body').fontSize(9).fillColor('#9ca3af')
            .text('لا توجد بيانات', MARGIN, doc.y + 10, { width: CONTENT_WIDTH, align: 'center' });
        doc.y += 30;
        return;
    }
    const colWidths = columns.map((c) => c.width || CONTENT_WIDTH / columns.length);
    const startX = MARGIN;
    const headerY = doc.y;

    // Header row
    doc.font('body-bold').fontSize(9).fillColor('#ffffff');
    doc.rect(startX, headerY, CONTENT_WIDTH, 22).fill(doc._primaryColor);
    let cx = startX + 6;
    columns.forEach((c, i) => {
        doc.fillColor('#ffffff').text(c.header, cx, headerY + 7,
            { width: colWidths[i] - 12, align: c.align || 'left', ellipsis: true });
        cx += colWidths[i];
    });
    doc.y = headerY + 24;

    // Body rows
    doc.font('body').fontSize(9).fillColor('#1f2937');
    rows.forEach((row, idx) => {
        const rowY = doc.y;
        if (idx % 2 === 1) {
            doc.rect(startX, rowY, CONTENT_WIDTH, 18).fill('#f9fafb');
            doc.fillColor('#1f2937');
        }
        cx = startX + 6;
        columns.forEach((c, i) => {
            const value = typeof c.get === 'function' ? c.get(row) : row[c.key];
            doc.text(String(value ?? ''), cx, rowY + 5,
                { width: colWidths[i] - 12, align: c.align || 'left', ellipsis: true });
            cx += colWidths[i];
        });
        doc.y = rowY + 18;
        if (doc.y > PAGE_HEIGHT - MARGIN - 60) {
            doc.addPage();
        }
    });
    doc.fillColor('#1f2937');
    doc.moveDown(0.5);
}

function drawTotalsBox(doc, rows, grand) {
    const boxW = 240;
    const startX = MARGIN + CONTENT_WIDTH - boxW;
    const startY = doc.y + 8;
    let cy = startY;
    doc.rect(startX, cy, boxW, 16 + rows.length * 14 + (grand ? 20 : 0)).fill('#f3f4f6');
    doc.font('body').fontSize(9).fillColor('#1f2937');
    rows.forEach((r) => {
        doc.fillColor('#374151').text(r.label, startX + 8, cy + 4, { width: boxW / 2 - 16 });
        doc.font('body-bold').text(`${fmtMoney(r.value)} ج.م`,
            startX + boxW / 2, cy + 4, { width: boxW / 2 - 8, align: 'left' });
        cy += 14;
        doc.font('body');
    });
    if (grand) {
        cy += 4;
        doc.moveTo(startX + 8, cy).lineTo(startX + boxW - 8, cy).strokeColor(doc._primaryColor).lineWidth(1.5).stroke();
        cy += 4;
        doc.font('body-bold').fontSize(11).fillColor(doc._primaryColor)
            .text(grand.label, startX + 8, cy, { width: boxW / 2 - 16 });
        doc.text(`${fmtMoney(grand.value)} ج.م`,
            startX + boxW / 2, cy, { width: boxW / 2 - 8, align: 'left' });
        cy += 16;
    }
    doc.y = cy + 8;
    doc.fillColor('#1f2937');
}

function drawFooter(doc, branding) {
    const { footerText = 'شكراً لتعاملكم' } = branding || {};
    doc.font('body-bold').fontSize(8).fillColor(doc._primaryColor)
        .text(footerText, MARGIN, PAGE_HEIGHT - MARGIN - 24,
            { width: CONTENT_WIDTH, align: 'center' });
    doc.font('body').fontSize(7).fillColor('#9ca3af')
        .text('صدر إلكترونياً — Jammaz ERP',
            MARGIN, PAGE_HEIGHT - MARGIN - 12,
            { width: CONTENT_WIDTH, align: 'center' });
}

function badgeKindFor(status) {
    if (!status) return null;
    const s = String(status).toLowerCase();
    if (s.includes('جزئي')) return 'partial';
    if (s.includes('مدفوع') && !s.includes('غير')) return 'paid';
    return 'pending';
}

// ---------------------------------------------------------------------------
// Per-type renderers
// ---------------------------------------------------------------------------

function renderSaleInvoicePdf(data) {
    const {
        branding = {}, number = '', date = '', status = '',
        customer = {}, invoice = {}, items = [], totals = {},
        payment = {}, payments = [], returns = [], hasReturns = false,
    } = data || {};

    const doc = newDoc({ primaryColor: branding.primaryColor || '#1B3C73' });
    drawHeader(doc, {
        branding, title: 'فاتورة مبيعات', number, date,
        badgeText: status, badgeKind: badgeKindFor(status),
    });

    drawInfoGrid(doc, [
        ['اسم العميل', customer.name],
        ['الهاتف', customer.phone],
        ['الرقم الضريبي', customer.taxNumber],
        ['العنوان', customer.address],
    ], [
        ['طريقة الدفع', payment.methodLabel || '—'],
        ['رقم التحويل', payment.isElectronic ? payment.sourceNumber : '—'],
        ['تاريخ الاستحقاق', payment.dueDate],
    ]);

    drawDataTable(doc, [
        { header: 'المنتج', key: 'productName', width: CONTENT_WIDTH * 0.45 },
        { header: 'الكمية', key: 'qty', width: CONTENT_WIDTH * 0.15, align: 'left', get: (r) => fmtQty(r.qty) },
        { header: 'سعر الوحدة', key: 'unitPrice', width: CONTENT_WIDTH * 0.2, align: 'left', get: (r) => fmtMoney(r.unitPrice) },
        { header: 'الإجمالي', key: 'lineTotal', width: CONTENT_WIDTH * 0.2, align: 'left', get: (r) => fmtMoney(r.lineTotal) },
    ], items);

    drawTotalsBox(doc, [
        { label: 'المجموع الفرعي', value: totals.subtotal },
        { label: 'الضريبة', value: totals.tax },
        { label: 'المدفوع', value: totals.paidAmount },
        { label: 'المتبقي', value: totals.remaining },
    ], { label: 'الإجمالي', value: totals.total });

    if (hasReturns && returns.length > 0) {
        doc.moveDown(1);
        doc.font('body-bold').fontSize(11).fillColor(doc._primaryColor).text('سجل المرتجعات', MARGIN);
        doc.moveDown(0.3);
        returns.forEach((r) => {
            doc.font('body-bold').fontSize(9).fillColor('#b45309')
                .text(`${r.returnNumber} — ${fmtDateAr(r.date)} — ${fmtMoney(r.totalRefund)} ج.م`, MARGIN);
            doc.font('body').fontSize(8).fillColor('#1f2937');
            (r.items || []).forEach((it) => {
                doc.text(`• ${it.productName} × ${fmtQty(it.qty)} = ${fmtMoney(it.refundAmount)} ج.م`,
                    MARGIN + 12, doc.y);
            });
            doc.moveDown(0.5);
            if (doc.y > PAGE_HEIGHT - MARGIN - 60) doc.addPage();
        });
    }

    if (payments && payments.length > 1) {
        doc.moveDown(1);
        doc.font('body-bold').fontSize(11).fillColor(doc._primaryColor).text('سجل المدفوعات', MARGIN);
        doc.moveDown(0.3);
        drawDataTable(doc, [
            { header: 'التاريخ', key: 'date', width: CONTENT_WIDTH * 0.2, get: (r) => fmtDateAr(r.date) },
            { header: 'الطريقة', key: 'methodLabel', width: CONTENT_WIDTH * 0.25 },
            { header: 'القناة', key: 'channelLabel', width: CONTENT_WIDTH * 0.2 },
            { header: 'رقم التحويل', key: 'sourceNumber', width: CONTENT_WIDTH * 0.2 },
            { header: 'المبلغ', key: 'amount', width: CONTENT_WIDTH * 0.15, align: 'left', get: (r) => fmtMoney(r.amount) },
        ], payments);
    }

    drawFooter(doc, branding);
    return toBuffer(doc);
}

function renderPurchaseInvoicePdf(data) {
    const {
        branding = {}, number = '', date = '',
        paymentStatusLabel = '', supplier = {}, purchaseOrder = {},
        items = [], totals = {}, payment = {},
    } = data || {};

    const doc = newDoc({ primaryColor: branding.primaryColor || '#1B3C73' });
    drawHeader(doc, {
        branding, title: 'فاتورة مشتريات', number, date,
        badgeText: paymentStatusLabel, badgeKind: badgeKindFor(paymentStatusLabel),
    });

    drawInfoGrid(doc, [
        ['اسم المورد', supplier.name],
        ['الهاتف', supplier.phone],
        ['الرقم الضريبي', supplier.taxNumber],
        ['العنوان', supplier.address],
        ['الرصيد المستحق', `${fmtMoney(supplier.balance)} ج.م`],
    ], [
        ['حالة الأمر', purchaseOrder.statusLabel || '—'],
        ['طريقة الدفع', payment.methodLabel || '—'],
        ['رقم التحويل', payment.isElectronic ? payment.sourceNumber : '—'],
        ['تاريخ الاستحقاق', payment.dueDate],
        ['أنشأها', purchaseOrder.createdBy],
    ]);

    drawDataTable(doc, [
        { header: 'المنتج', key: 'productName', width: CONTENT_WIDTH * 0.34 },
        { header: 'المطلوب', key: 'qtyOrdered', width: CONTENT_WIDTH * 0.12, align: 'left', get: (r) => fmtQty(r.qtyOrdered) },
        { header: 'المستلم', key: 'qtyReceived', width: CONTENT_WIDTH * 0.12, align: 'left', get: (r) => fmtQty(r.qtyReceived) },
        { header: 'سعر الوحدة', key: 'unitPrice', width: CONTENT_WIDTH * 0.19, align: 'left', get: (r) => fmtMoney(r.unitPrice) },
        { header: 'الإجمالي', key: 'lineTotal', width: CONTENT_WIDTH * 0.23, align: 'left', get: (r) => fmtMoney(r.lineTotal) },
    ], items);

    drawTotalsBox(doc, [
        { label: 'المجموع الفرعي', value: totals.subtotal },
        { label: 'المدفوع', value: totals.paidAmount },
        { label: 'المتبقي', value: totals.remaining },
    ], { label: 'الإجمالي', value: totals.total });

    if (purchaseOrder.notes) {
        doc.rect(MARGIN, doc.y, CONTENT_WIDTH, 40).fill('#f9fafb');
        doc.font('body').fontSize(8).fillColor('#6b7280')
            .text('ملاحظات', MARGIN + 12, doc.y + 8);
        doc.font('body-bold').fontSize(10).fillColor('#1f2937')
            .text(purchaseOrder.notes, MARGIN + 12, doc.y + 20,
                { width: CONTENT_WIDTH - 24 });
        doc.y += 50;
    }

    drawFooter(doc, branding);
    return toBuffer(doc);
}

function renderCustomerCollectionReceiptPdf(data) {
    const {
        branding = {}, receiptNumber = '', date = '', status = 'مدفوع',
        customer = {}, transaction = {}, payment = {},
        previousBalance = 0, remainingBalance = 0, collectedAmount = 0,
    } = data || {};

    const doc = newDoc({ primaryColor: branding.primaryColor || '#1B3C73' });
    drawHeader(doc, {
        branding, title: 'سند تحصيل من عميل', number: receiptNumber, date,
        badgeText: status, badgeKind: 'paid',
    });

    drawInfoGrid(doc, [
        ['اسم العميل', customer.name],
        ['الهاتف', customer.phone],
        ['الرقم الضريبي', customer.taxNumber],
        ['العنوان', customer.address],
    ], [
        ['طريقة الدفع', payment.methodLabel || '—'],
        ['القناة', payment.channelLabel || '—'],
        ['رقم التحويل', payment.isElectronic ? payment.sourceNumber : '—'],
        ['مرجع العملية', transaction.referenceTypeLabel || ''],
        ['محرر السند', transaction.createdBy || 'النظام'],
    ]);

    // Amount box
    const boxX = MARGIN;
    const boxY = doc.y + 12;
    const boxW = CONTENT_WIDTH;
    const boxH = 70;
    doc.rect(boxX, boxY, boxW, boxH).fill(doc._primaryColor);
    doc.font('body').fontSize(9).fillColor('#ffffff').opacity(0.85)
        .text('المبلغ المستلم', boxX + 16, boxY + 12);
    doc.font('body-bold').fontSize(28).fillColor('#ffffff')
        .text(`${fmtMoney(collectedAmount)} ج.م`,
            boxX + 16, boxY + 26, { width: boxW - 32, align: 'left' });
    doc.font('body').fontSize(9).fillColor('#ffffff').opacity(0.95)
        .text(`${payment.methodLabel || ''}${payment.channelLabel ? ` — ${payment.channelLabel}` : ''}`,
            boxX + 16, boxY + boxH - 16, { width: boxW - 32 });
    doc.y = boxY + boxH + 12;

    // Balance cards
    const cardW = (CONTENT_WIDTH - 16) / 3;
    const cards = [
        { label: 'الرصيد السابق', value: previousBalance, color: '#6b7280' },
        { label: 'المبلغ المحصل', value: collectedAmount, color: '#1B3C73' },
        { label: 'الرصيد المتبقي', value: remainingBalance, color: '#b91c1c' },
    ];
    cards.forEach((c, i) => {
        const x = MARGIN + i * (cardW + 8);
        doc.rect(x, doc.y, cardW, 50).fill('#f9fafb').stroke('#e5e7eb');
        doc.font('body').fontSize(8).fillColor('#6b7280')
            .text(c.label, x + 8, doc.y + 8, { width: cardW - 16, align: 'center' });
        doc.font('body-bold').fontSize(14).fillColor(c.color)
            .text(`${fmtMoney(c.value)} ج.م`, x + 8, doc.y + 22, { width: cardW - 16, align: 'center' });
    });
    doc.y += 60;

    if (transaction.description) {
        doc.rect(MARGIN, doc.y, CONTENT_WIDTH, 40).fill('#f9fafb');
        doc.font('body').fontSize(8).fillColor('#6b7280')
            .text('وذلك عن / البيان', MARGIN + 12, doc.y + 8);
        doc.font('body-bold').fontSize(10).fillColor('#1f2937')
            .text(transaction.description, MARGIN + 12, doc.y + 20,
                { width: CONTENT_WIDTH - 24 });
        doc.y += 50;
    }

    drawFooter(doc, branding);
    return toBuffer(doc);
}

function renderCustomerStatementPdf(data) {
    const {
        branding = {}, customer = {}, period = {},
        openingBalance = 0, closingBalance = 0, currentSnapshotBalance = 0,
        balanceDelta = '0.00', totals = { debits: 0, credits: 0 },
        lines = [], generatedAt,
    } = data || {};

    const doc = newDoc({ primaryColor: branding.primaryColor || '#1B3C73' });
    drawHeader(doc, { branding, title: 'كشف حساب عميل', number: customer.name, date: generatedAt });

    doc.font('body').fontSize(9).fillColor('#1f2937');
    doc.text(`الفترة: من ${fmtDateAr(period.startDate)} إلى ${fmtDateAr(period.endDate)}`,
        MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.3);
    doc.text(`الهاتف: ${customer.phone || '—'}    الرقم الضريبي: ${customer.taxNumber || '—'}`,
        MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.5);

    // Summary cards
    const cardW = (CONTENT_WIDTH - 16) / 3;
    const cards = [
        { label: 'الرصيد الافتتاحي', value: openingBalance, color: '#6b7280' },
        { label: 'إجمالي المدين', value: totals.debits, color: '#b91c1c' },
        { label: 'إجمالي الدائن', value: totals.credits, color: '#047857' },
    ];
    cards.forEach((c, i) => {
        const x = MARGIN + i * (cardW + 8);
        doc.rect(x, doc.y, cardW, 40).fill('#ffffff').stroke('#e5e7eb');
        doc.font('body').fontSize(8).fillColor('#6b7280')
            .text(c.label, x + 8, doc.y + 6, { width: cardW - 16, align: 'center' });
        doc.font('body-bold').fontSize(13).fillColor(c.color)
            .text(`${fmtMoney(c.value)} ج.م`, x + 8, doc.y + 18, { width: cardW - 16, align: 'center' });
    });
    doc.y += 50;

    // Closing + snapshot
    const cw = (CONTENT_WIDTH - 8) / 2;
    doc.rect(MARGIN, doc.y, cw, 50).fill('#eff6ff').stroke('#bfdbfe');
    doc.font('body').fontSize(8).fillColor('#1B3C73').text('الرصيد الختامي للفترة',
        MARGIN + 8, doc.y + 8, { width: cw - 16, align: 'center' });
    doc.font('body-bold').fontSize(15).fillColor('#1B3C73')
        .text(`${fmtMoney(closingBalance)} ج.م`, MARGIN + 8, doc.y + 22,
            { width: cw - 16, align: 'center' });

    doc.rect(MARGIN + cw + 8, doc.y - 50, cw, 50).fill('#f3f4f6').stroke('#e5e7eb');
    doc.font('body').fontSize(8).fillColor('#6b7280').text('الرصيد المسجّل بالنظام',
        MARGIN + cw + 16, doc.y - 50 + 8, { width: cw - 16, align: 'center' });
    doc.font('body-bold').fontSize(15).fillColor('#1f2937')
        .text(`${fmtMoney(currentSnapshotBalance)} ج.م`,
            MARGIN + cw + 16, doc.y - 50 + 22, { width: cw - 16, align: 'center' });

    doc.y += 8;

    const hasDelta = Math.abs(Number(balanceDelta)) >= 0.01;
    const bannerColor = hasDelta ? '#fef3c7' : '#ecfdf5';
    const bannerText = hasDelta ? '#92400e' : '#065f46';
    doc.rect(MARGIN, doc.y, CONTENT_WIDTH, 24).fill(bannerColor).stroke(bannerText);
    doc.font('body-bold').fontSize(9).fillColor(bannerText)
        .text(hasDelta
            ? `تنبيه: فرق تسوية ${fmtMoney(balanceDelta)} ج.م — راجع القيود قبل التسليم`
            : 'الرصيد متطابق مع السجل',
            MARGIN + 8, doc.y + 8, { width: CONTENT_WIDTH - 16 });
    doc.y += 32;

    drawDataTable(doc, [
        { header: 'م', key: 'idx', width: CONTENT_WIDTH * 0.05, get: (_r, i) => String(i + 1) },
        { header: 'التاريخ', key: 'dateFormatted', width: CONTENT_WIDTH * 0.13, get: (r) => fmtDateAr(r.dateFormatted) },
        { header: 'البيان', key: 'label', width: CONTENT_WIDTH * 0.27 },
        { header: 'المرجع', key: 'reference', width: CONTENT_WIDTH * 0.15 },
        { header: 'مدين', key: 'debit', width: CONTENT_WIDTH * 0.13, align: 'left', get: (r) => Number(r.debit) > 0 ? fmtMoney(r.debit) : '—' },
        { header: 'دائن', key: 'credit', width: CONTENT_WIDTH * 0.13, align: 'left', get: (r) => Number(r.credit) > 0 ? fmtMoney(r.credit) : '—' },
        { header: 'الرصيد', key: 'balance', width: CONTENT_WIDTH * 0.14, align: 'left', get: (r) => fmtMoney(r.balance) },
    ], lines);

    drawFooter(doc, branding);
    return toBuffer(doc);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const RENDERERS = Object.create(null);
RENDERERS[DOCUMENT_TYPES.SALE_INVOICE] = renderSaleInvoicePdf;
RENDERERS[DOCUMENT_TYPES.PURCHASE_INVOICE] = renderPurchaseInvoicePdf;
RENDERERS[DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT] = renderCustomerCollectionReceiptPdf;
RENDERERS[DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT] = renderCustomerStatementPdf;

/**
 * Render DocumentData to a PDF buffer.
 *
 * @param {string} type   one of DOCUMENT_TYPES
 * @param {object} data   the shaped DocumentData
 * @returns {Promise<Buffer>}
 */
export async function renderPdf(type, data) {
    const fn = RENDERERS[type];
    if (!fn) {
        // Must be an AppError: mapError() only honours statusCode on
        // AppError instances — a plain Error would surface as a 500.
        throw new AppError(`PDF renderer for ${type} is not implemented`, 501, 'NOT_IMPLEMENTED');
    }
    return await fn(data);
}

export { renderSaleInvoicePdf, renderPurchaseInvoicePdf, renderCustomerCollectionReceiptPdf, renderCustomerStatementPdf };