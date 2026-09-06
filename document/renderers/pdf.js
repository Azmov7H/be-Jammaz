import { DOCUMENT_TYPES } from '../../lib/documentRegistry.js';
import { AppError } from '../../lib/errors.js';
import {
    createPdf, toBuffer, putText, titleLine, rtlTable, infoGrid, totalsBox,
} from '../../lib/pdf/index.js';

const MARGIN = 40;
const PAGE_WIDTH = 595.28;
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

function newDoc({ primaryColor = '#1B3C73', title = 'Document' } = {}) {
    const doc = createPdf({ margin: MARGIN, title });
    doc._primaryColor = primaryColor;
    return doc;
}

function drawHeader(doc, { branding = {}, title, number, date, badgeText, badgeKind, numberRole = 'text', dateRole = 'text' }) {
    const { companyName = 'شركتكم', address, phone, email } = branding;

    putText(doc, companyName, MARGIN, MARGIN, { size: 16, bold: true, color: doc._primaryColor, width: CONTENT_WIDTH / 2 });
    let by = MARGIN + 22;
    doc.fontSize(8);
    for (const line of [address, phone, email]) {
        if (!line) continue;
        putText(doc, line, MARGIN, by, { size: 8, color: '#6b7280', width: CONTENT_WIDTH / 2 });
        by += 11;
    }

    const rightX = MARGIN + CONTENT_WIDTH / 2;
    doc.rect(rightX, MARGIN, CONTENT_WIDTH / 2, 24).fill(doc._primaryColor);
    putText(doc, title, rightX + 6, MARGIN + 7, { size: 11, bold: true, color: '#ffffff', width: CONTENT_WIDTH / 2 - 12, align: 'center' });
    putText(doc, number || '—', rightX + 6, MARGIN + 28, { size: 13, bold: true, color: doc._primaryColor, width: CONTENT_WIDTH / 2 - 12, align: 'center', role: numberRole });
    putText(doc, fmtDateAr(date), rightX + 6, MARGIN + 46, { size: 8, color: '#6b7280', width: CONTENT_WIDTH / 2 - 12, align: 'center', role: dateRole });

    if (badgeText) {
        const badgeColor = badgeKind === 'paid' ? '#d1fae5' :
            badgeKind === 'partial' ? '#fef3c7' :
                badgeKind === 'pending' ? '#fee2e2' : '#e5e7eb';
        const badgeTextColor = badgeKind === 'paid' ? '#065f46' :
            badgeKind === 'partial' ? '#92400e' :
                badgeKind === 'pending' ? '#991b1b' : '#374151';
        doc.rect(rightX + 30, MARGIN + 58, CONTENT_WIDTH / 2 - 60, 14).fill(badgeColor);
        putText(doc, badgeText, rightX + 30, MARGIN + 60, {
            size: 8, bold: true, color: badgeTextColor, width: CONTENT_WIDTH / 2 - 60, align: 'center',
        });
    }

    doc.moveTo(MARGIN, MARGIN + 80).lineTo(PAGE_WIDTH - MARGIN, MARGIN + 80)
        .lineWidth(1.5).strokeColor(doc._primaryColor).stroke();
    doc.y = MARGIN + 92;
    doc.fillColor('#1f2937');
}

function drawInfoGrid(doc, left, right) {
    doc.y = infoGrid(doc, { left, right, x: MARGIN, y: doc.y, width: CONTENT_WIDTH });
    doc.fillColor('#1f2937');
}

function moneyTable(doc, columns, rowStrings) {
    doc.y = rtlTable(doc, {
        columns: columns.map((c) => ({ header: c.header, width: c.width, role: c.role })),
        rows: rowStrings,
        x: MARGIN, y: doc.y, fontSize: 9,
        headerFill: doc._primaryColor, headerColor: '#ffffff', zebra: true,
    }) + 6;
    doc.fillColor('#1f2937');
}

function drawTotalsBox(doc, rows, grand) {
    doc.y = totalsBox(doc, { rows, grand, x: MARGIN, y: doc.y + 8, width: 240 });
    doc.fillColor('#1f2937');
}

function drawFooter(doc, branding) {
    const { footerText = 'شكراً لتعاملكم' } = branding || {};
    putText(doc, footerText, MARGIN, PAGE_HEIGHT - MARGIN - 24, {
        size: 8, bold: true, color: doc._primaryColor, width: CONTENT_WIDTH, align: 'center',
    });
    putText(doc, 'صدر إلكترونياً — Jammaz ERP', MARGIN, PAGE_HEIGHT - MARGIN - 12, {
        size: 7, color: '#9ca3af', width: CONTENT_WIDTH, align: 'center',
    });
}

function badgeKindFor(status) {
    if (!status) return null;
    const s = String(status).toLowerCase();
    if (s.includes('جزئي')) return 'partial';
    if (s.includes('مدفوع') && !s.includes('غير')) return 'paid';
    return 'pending';
}

function renderSaleInvoicePdf(data) {
    const {
        branding = {}, number = '', date = '', status = '',
        customer = {}, items = [], totals = {},
        payment = {}, payments = [], returns = [], hasReturns = false,
    } = data || {};

    const doc = newDoc({ primaryColor: branding.primaryColor || '#1B3C73', title: number || 'SALE_INVOICE' });
    drawHeader(doc, {
        branding, title: 'فاتورة مبيعات', number, date,
        badgeText: status, badgeKind: badgeKindFor(status),
        numberRole: 'id',
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

    moneyTable(doc, [
        { header: 'المنتج', width: CONTENT_WIDTH * 0.45 },
        { header: 'الكمية', width: CONTENT_WIDTH * 0.15, role: 'money' },
        { header: 'سعر الوحدة', width: CONTENT_WIDTH * 0.2, role: 'money' },
        { header: 'الإجمالي', width: CONTENT_WIDTH * 0.2, role: 'money' },
    ], items.map((r) => [
        r.productName ?? '', fmtQty(r.qty), fmtMoney(r.unitPrice), fmtMoney(r.lineTotal),
    ]));

    drawTotalsBox(doc, [
        { label: 'المجموع الفرعي', value: fmtMoney(totals.subtotal) },
        { label: 'الضريبة', value: fmtMoney(totals.tax) },
        { label: 'المدفوع', value: fmtMoney(totals.paidAmount) },
        { label: 'المتبقي', value: fmtMoney(totals.remaining) },
    ], { label: 'الإجمالي', value: fmtMoney(totals.total) });

    if (hasReturns && returns.length > 0) {
        doc.moveDown(1);
        titleLine(doc, 'سجل المرتجعات', MARGIN, doc.y, { size: 11, bold: true, color: doc._primaryColor, width: CONTENT_WIDTH });
        doc.moveDown(0.3);
        returns.forEach((r) => {
            putText(doc, `${r.returnNumber} — ${fmtDateAr(r.date)} — ${fmtMoney(r.totalRefund)} ج.م`, MARGIN, doc.y, {
                size: 9, bold: true, color: '#b45309', width: CONTENT_WIDTH,
            });
            (r.items || []).forEach((it) => {
                putText(doc, `• ${it.productName} × ${fmtQty(it.qty)} = ${fmtMoney(it.refundAmount)} ج.م`, MARGIN + 12, doc.y, {
                    size: 8, width: CONTENT_WIDTH - 12,
                });
            });
            doc.moveDown(0.5);
            if (doc.y > PAGE_HEIGHT - MARGIN - 60) doc.addPage();
        });
    }

    if (payments && payments.length > 1) {
        doc.moveDown(1);
        titleLine(doc, 'سجل المدفوعات', MARGIN, doc.y, { size: 11, bold: true, color: doc._primaryColor, width: CONTENT_WIDTH });
        doc.moveDown(0.3);
        moneyTable(doc, [
            { header: 'التاريخ', width: CONTENT_WIDTH * 0.2, role: 'date' },
            { header: 'الطريقة', width: CONTENT_WIDTH * 0.25 },
            { header: 'القناة', width: CONTENT_WIDTH * 0.2 },
            { header: 'رقم التحويل', width: CONTENT_WIDTH * 0.2, role: 'id' },
            { header: 'المبلغ', width: CONTENT_WIDTH * 0.15, role: 'money' },
        ], payments.map((r) => [
            fmtDateAr(r.date), r.methodLabel ?? '', r.channelLabel ?? '',
            r.sourceNumber ?? '', fmtMoney(r.amount),
        ]));
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

    const doc = newDoc({ primaryColor: branding.primaryColor || '#1B3C73', title: number || 'PURCHASE_INVOICE' });
    drawHeader(doc, {
        branding, title: 'فاتورة مشتريات', number, date,
        badgeText: paymentStatusLabel, badgeKind: badgeKindFor(paymentStatusLabel),
        numberRole: 'id',
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

    moneyTable(doc, [
        { header: 'المنتج', width: CONTENT_WIDTH * 0.34 },
        { header: 'المطلوب', width: CONTENT_WIDTH * 0.12, role: 'money' },
        { header: 'المستلم', width: CONTENT_WIDTH * 0.12, role: 'money' },
        { header: 'سعر الوحدة', width: CONTENT_WIDTH * 0.19, role: 'money' },
        { header: 'الإجمالي', width: CONTENT_WIDTH * 0.23, role: 'money' },
    ], items.map((r) => [
        r.productName ?? '', fmtQty(r.qtyOrdered), fmtQty(r.qtyReceived),
        fmtMoney(r.unitPrice), fmtMoney(r.lineTotal),
    ]));

    drawTotalsBox(doc, [
        { label: 'المجموع الفرعي', value: fmtMoney(totals.subtotal) },
        { label: 'المدفوع', value: fmtMoney(totals.paidAmount) },
        { label: 'المتبقي', value: fmtMoney(totals.remaining) },
    ], { label: 'الإجمالي', value: fmtMoney(totals.total) });

    if (purchaseOrder.notes) {
        doc.rect(MARGIN, doc.y, CONTENT_WIDTH, 40).fill('#f9fafb');
        putText(doc, 'ملاحظات', MARGIN + 12, doc.y + 8, { size: 8, color: '#6b7280', width: CONTENT_WIDTH - 24 });
        putText(doc, purchaseOrder.notes, MARGIN + 12, doc.y + 20, {
            size: 10, bold: true, width: CONTENT_WIDTH - 24,
        });
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

    const doc = newDoc({ primaryColor: branding.primaryColor || '#1B3C73', title: receiptNumber || 'RECEIPT' });
    drawHeader(doc, {
        branding, title: 'سند تحصيل من عميل', number: receiptNumber, date,
        badgeText: status, badgeKind: 'paid',
        numberRole: 'id',
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

    const boxY = doc.y + 12;
    const boxH = 70;
    doc.rect(MARGIN, boxY, CONTENT_WIDTH, boxH).fill(doc._primaryColor);
    putText(doc, 'المبلغ المستلم', MARGIN + 16, boxY + 12, { size: 9, color: '#ffffff', width: CONTENT_WIDTH - 32 });
    putText(doc, `${fmtMoney(collectedAmount)} ج.م`, MARGIN + 16, boxY + 26, {
        size: 28, bold: true, color: '#ffffff', width: CONTENT_WIDTH - 32,
    });
    putText(doc, `${payment.methodLabel || ''}${payment.channelLabel ? ` — ${payment.channelLabel}` : ''}`,
        MARGIN + 16, boxY + boxH - 16, { size: 9, color: '#ffffff', width: CONTENT_WIDTH - 32 });
    doc.y = boxY + boxH + 12;

    const cardW = (CONTENT_WIDTH - 16) / 3;
    const cards = [
        { label: 'الرصيد السابق', value: previousBalance, color: '#6b7280' },
        { label: 'المبلغ المحصل', value: collectedAmount, color: '#1B3C73' },
        { label: 'الرصيد المتبقي', value: remainingBalance, color: '#b91c1c' },
    ];
    cards.forEach((c, i) => {
        const x = MARGIN + i * (cardW + 8);
        doc.rect(x, doc.y, cardW, 50).fill('#f9fafb').stroke('#e5e7eb');
        putText(doc, c.label, x + 8, doc.y + 8, { size: 8, color: '#6b7280', width: cardW - 16, align: 'center' });
        putText(doc, `${fmtMoney(c.value)} ج.م`, x + 8, doc.y + 22, {
            size: 14, bold: true, color: c.color, width: cardW - 16, align: 'center',
        });
    });
    doc.y += 60;

    if (transaction.description) {
        doc.rect(MARGIN, doc.y, CONTENT_WIDTH, 40).fill('#f9fafb');
        putText(doc, 'وذلك عن / البيان', MARGIN + 12, doc.y + 8, { size: 8, color: '#6b7280', width: CONTENT_WIDTH - 24 });
        putText(doc, transaction.description, MARGIN + 12, doc.y + 20, {
            size: 10, bold: true, width: CONTENT_WIDTH - 24,
        });
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

    const doc = newDoc({ primaryColor: branding.primaryColor || '#1B3C73', title: 'CUSTOMER_STATEMENT' });
    drawHeader(doc, { branding, title: 'كشف حساب عميل', number: customer.name, date: generatedAt });

    putText(doc, `الفترة: من ${fmtDateAr(period.startDate)} إلى ${fmtDateAr(period.endDate)}`, MARGIN, doc.y, {
        size: 9, width: CONTENT_WIDTH,
    });
    doc.moveDown(0.3);
    putText(doc, `الهاتف: ${customer.phone || '—'}    الرقم الضريبي: ${customer.taxNumber || '—'}`, MARGIN, doc.y, {
        size: 9, width: CONTENT_WIDTH,
    });
    doc.moveDown(0.5);

    const cardW = (CONTENT_WIDTH - 16) / 3;
    const cards = [
        { label: 'الرصيد الافتتاحي', value: openingBalance, color: '#6b7280' },
        { label: 'إجمالي المدين', value: totals.debits, color: '#b91c1c' },
        { label: 'إجمالي الدائن', value: totals.credits, color: '#047857' },
    ];
    cards.forEach((c, i) => {
        const x = MARGIN + i * (cardW + 8);
        doc.rect(x, doc.y, cardW, 40).fill('#ffffff').stroke('#e5e7eb');
        putText(doc, c.label, x + 8, doc.y + 6, { size: 8, color: '#6b7280', width: cardW - 16, align: 'center' });
        putText(doc, `${fmtMoney(c.value)} ج.م`, x + 8, doc.y + 18, {
            size: 13, bold: true, color: c.color, width: cardW - 16, align: 'center',
        });
    });
    doc.y += 50;

    const cw = (CONTENT_WIDTH - 8) / 2;
    doc.rect(MARGIN, doc.y, cw, 50).fill('#eff6ff').stroke('#bfdbfe');
    putText(doc, 'الرصيد الختامي للفترة', MARGIN + 8, doc.y + 8, {
        size: 8, color: '#1B3C73', width: cw - 16, align: 'center',
    });
    putText(doc, `${fmtMoney(closingBalance)} ج.م`, MARGIN + 8, doc.y + 22, {
        size: 15, bold: true, color: '#1B3C73', width: cw - 16, align: 'center',
    });

    doc.rect(MARGIN + cw + 8, doc.y - 50, cw, 50).fill('#f3f4f6').stroke('#e5e7eb');
    putText(doc, 'الرصيد المسجّل بالنظام', MARGIN + cw + 16, doc.y - 50 + 8, {
        size: 8, color: '#6b7280', width: cw - 16, align: 'center',
    });
    putText(doc, `${fmtMoney(currentSnapshotBalance)} ج.م`, MARGIN + cw + 16, doc.y - 50 + 22, {
        size: 15, bold: true, color: '#1f2937', width: cw - 16, align: 'center',
    });

    doc.y += 8;

    const hasDelta = Math.abs(Number(balanceDelta)) >= 0.01;
    const bannerColor = hasDelta ? '#fef3c7' : '#ecfdf5';
    const bannerText = hasDelta ? '#92400e' : '#065f46';
    doc.rect(MARGIN, doc.y, CONTENT_WIDTH, 24).fill(bannerColor).stroke(bannerText);
    putText(doc, hasDelta
        ? `تنبيه: فرق تسوية ${fmtMoney(balanceDelta)} ج.م — راجع القيود قبل التسليم`
        : 'الرصيد متطابق مع السجل',
    MARGIN + 8, doc.y + 8, { size: 9, bold: true, color: bannerText, width: CONTENT_WIDTH - 16 });
    doc.y += 32;

    moneyTable(doc, [
        { header: 'م', width: CONTENT_WIDTH * 0.05, role: 'id' },
        { header: 'التاريخ', width: CONTENT_WIDTH * 0.13, role: 'date' },
        { header: 'البيان', width: CONTENT_WIDTH * 0.27 },
        { header: 'المرجع', width: CONTENT_WIDTH * 0.15, role: 'id' },
        { header: 'مدين', width: CONTENT_WIDTH * 0.13, role: 'money' },
        { header: 'دائن', width: CONTENT_WIDTH * 0.13, role: 'money' },
        { header: 'الرصيد', width: CONTENT_WIDTH * 0.14, role: 'money' },
    ], lines.map((r, i) => [
        String(i + 1),
        fmtDateAr(r.dateFormatted || r.date),
        r.label ?? '',
        r.reference ?? '',
        Number(r.debit) > 0 ? fmtMoney(r.debit) : '—',
        Number(r.credit) > 0 ? fmtMoney(r.credit) : '—',
        fmtMoney(r.balance),
    ]));

    drawFooter(doc, branding);
    return toBuffer(doc);
}

const RENDERERS = Object.create(null);
RENDERERS[DOCUMENT_TYPES.SALE_INVOICE] = renderSaleInvoicePdf;
RENDERERS[DOCUMENT_TYPES.PURCHASE_INVOICE] = renderPurchaseInvoicePdf;
RENDERERS[DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT] = renderCustomerCollectionReceiptPdf;
RENDERERS[DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT] = renderCustomerStatementPdf;

export async function renderPdf(type, data) {
    const fn = RENDERERS[type];
    if (!fn) {
        throw new AppError(`PDF renderer for ${type} is not implemented`, 501, 'NOT_IMPLEMENTED');
    }
    return await fn(data);
}

export { renderSaleInvoicePdf, renderPurchaseInvoicePdf, renderCustomerCollectionReceiptPdf, renderCustomerStatementPdf };
