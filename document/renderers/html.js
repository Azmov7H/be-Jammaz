/**
 * DOC-ENG-001 / DOC-SINV-001..007 — Shared HTML renderer for the
 * document engine.
 *
 * Produces a self-contained HTML page (with embedded <style> for
 * print) for the supplied DocumentData. The renderer is
 * type-dispatched: every DOCUMENT_TYPES entry has its own template
 * function that knows how to lay out the body, totals, and any
 * document-specific blocks (returns for sales invoices, payments
 * for receipts, statement rows for statements, etc.).
 *
 * S3 ships the SALE_INVOICE template. S4..S9 add the rest as
 * they land. A safe placeholder is rendered for any not-yet-
 * implemented type so the preview endpoint is never broken.
 *
 * Output: { body: string, contentType: 'text/html; charset=utf-8' }
 */

import { getDocumentEntry, DOCUMENT_TYPES } from '../../lib/documentRegistry.js';

const RENDERERS = Object.create(null);

// ---------------------------------------------------------------------------
// SALE_INVOICE
// ---------------------------------------------------------------------------

RENDERERS[DOCUMENT_TYPES.SALE_INVOICE] = function renderSaleInvoice(data) {
    const {
        branding = {},
        title = 'فاتورة مبيعات',
        number = '',
        date = '',
        time = '',
        status = '',
        customer = {},
        invoice = {},
        items = [],
        totals = {},
        payment = {},
        payments = [],
        returns = [],
        hasReturns = false,
    } = data || {};

    const itemRows = items.map((it) => `
        <tr>
            <td>${esc(it.productName)}</td>
            <td class="num">${fmtNum(it.qty)}</td>
            <td class="num">${fmtMoney(it.unitPrice)}</td>
            <td class="num">${fmtMoney(it.lineTotal)}</td>
        </tr>
    `).join('');

    const paymentHistoryRows = (payments && payments.length > 1) ? `
        <section class="block">
            <h3 class="section-title">سجل المدفوعات</h3>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>التاريخ</th>
                        <th>الطريقة</th>
                        <th>القناة</th>
                        <th>رقم التحويل</th>
                        <th class="num">المبلغ</th>
                    </tr>
                </thead>
                <tbody>
                    ${payments.map((p) => `
                        <tr>
                            <td>${esc(p.date ? new Date(p.date).toLocaleDateString('ar-EG') : '')}</td>
                            <td>${esc(p.methodLabel)}</td>
                            <td>${esc(p.channelLabel)}</td>
                            <td class="mono">${esc(p.sourceNumber || '—')}</td>
                            <td class="num">${fmtMoney(p.amount)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </section>
    ` : '';

    const returnsBlock = (hasReturns && returns.length > 0) ? `
        <section class="block">
            <h3 class="section-title">سجل المرتجعات</h3>
            ${returns.map((r) => `
                <div class="return-card">
                    <div class="return-head">
                        <span class="return-number">${esc(r.returnNumber || '')}</span>
                        <span>${esc(r.date ? new Date(r.date).toLocaleDateString('ar-EG') : '')}</span>
                    </div>
                    <ul>
                        ${(r.items || []).map((it) => `
                            <li>
                                <span>${esc(it.productName)} × ${fmtNum(it.qty)}</span>
                                <span>${fmtMoney(it.refundAmount)}</span>
                            </li>
                        `).join('')}
                    </ul>
                    <div class="return-total">
                        <span>إجمالي المسترد</span>
                        <span>${fmtMoney(r.totalRefund)}</span>
                    </div>
                </div>
            `).join('')}
        </section>
    ` : '';

    const sourceRow = payment.isElectronic ? `
        <tr>
            <td class="label">رقم التحويل</td>
            <td class="value mono">${esc(payment.sourceNumber || '—')}</td>
        </tr>
    ` : '';

    const body = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(title)} — ${esc(branding.companyName || '')}</title>
<style>
    :root {
        --primary: ${esc(branding.primaryColor || '#1B3C73')};
        --header-bg: ${esc(branding.headerBgColor || '#1B3C73')};
    }
    * { box-sizing: border-box; }
    body {
        font-family: "Segoe UI", system-ui, Arial, sans-serif;
        margin: 0;
        padding: 32px;
        color: #1f2937;
        background: #fff;
    }
    .doc {
        max-width: 800px;
        margin: 0 auto;
    }
    .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 24px;
        padding-bottom: 16px;
        border-bottom: 2px solid var(--primary);
        margin-bottom: 24px;
    }
    .brand h1 {
        font-size: 24px;
        margin: 0;
        color: var(--primary);
    }
    .brand .meta { color: #6b7280; font-size: 12px; margin-top: 4px; }
    .brand .contacts { color: #6b7280; font-size: 11px; margin-top: 8px; line-height: 1.6; }
    .title-box {
        background: var(--primary);
        color: #fff;
        padding: 6px 16px;
        border-radius: 6px 6px 0 0;
        font-weight: 700;
        text-align: center;
    }
    .meta-box {
        border: 1px solid #e5e7eb;
        border-top: 0;
        border-radius: 0 0 6px 6px;
        padding: 12px;
        text-align: center;
        min-width: 200px;
    }
    .meta-box .num { font-family: ui-monospace, Menlo, monospace; font-size: 20px; font-weight: 700; color: var(--primary); }
    .meta-box .when { color: #6b7280; font-size: 11px; margin-top: 4px; }
    .meta-box .badge { display: inline-block; margin-top: 8px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .badge-paid { background: #d1fae5; color: #065f46; }
    .badge-partial { background: #fef3c7; color: #92400e; }
    .badge-pending { background: #fee2e2; color: #991b1b; }
    .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        background: #f9fafb;
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 16px;
        font-size: 13px;
    }
    .info-grid h3 { margin: 0 0 8px; color: var(--primary); font-size: 14px; }
    .info-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .info-row .label { color: #6b7280; }
    .info-row .value { font-weight: 600; }
    .info-row .value.mono { font-family: ui-monospace, Menlo, monospace; }
    .data-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
    .data-table thead { background: var(--header-bg); color: #fff; }
    .data-table th, .data-table td { padding: 10px 12px; text-align: right; }
    .data-table th { font-weight: 700; }
    .data-table .num { text-align: left; font-family: ui-monospace, Menlo, monospace; }
    .data-table .mono { font-family: ui-monospace, Menlo, monospace; }
    .totals {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 16px;
    }
    .totals-box {
        width: 320px;
        background: #f9fafb;
        padding: 16px;
        border-radius: 8px;
        border: 2px solid #e5e7eb;
    }
    .totals-box .row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 13px;
    }
    .totals-box .grand {
        margin-top: 8px;
        padding-top: 12px;
        border-top: 2px solid var(--primary);
        font-weight: 700;
        font-size: 20px;
        color: var(--primary);
    }
    .block { margin-bottom: 24px; }
    .section-title {
        color: var(--primary);
        font-size: 14px;
        margin: 0 0 8px;
        padding-bottom: 4px;
        border-bottom: 1px solid #e5e7eb;
    }
    .return-card {
        border: 1px dashed #fbbf24;
        background: #fffbeb;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 8px;
    }
    .return-head { display: flex; justify-content: space-between; font-weight: 700; font-size: 12px; }
    .return-number { color: #b45309; }
    .return-card ul { list-style: none; padding: 0; margin: 8px 0; font-size: 12px; }
    .return-card li { display: flex; justify-content: space-between; padding: 2px 0; }
    .return-total { display: flex; justify-content: space-between; font-weight: 700; border-top: 1px solid #fbbf24; padding-top: 6px; }
    .footer {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid #e5e7eb;
        text-align: center;
        font-size: 12px;
        color: #6b7280;
    }
    .footer .msg { font-weight: 700; color: var(--primary); margin-bottom: 4px; }
    @media print {
        @page { size: A4; margin: 20mm; }
        body { padding: 0; }
    }
</style>
</head>
<body>
<div class="doc">
    <header class="header">
        <div class="brand">
            <h1>${esc(branding.companyName || 'شركتكم')}</h1>
            ${branding.address ? `<div class="meta">${esc(branding.address)}</div>` : ''}
            ${(branding.phone || (branding.additionalPhones && branding.additionalPhones.length))
                ? `<div class="contacts">${esc([branding.phone, ...(branding.additionalPhones || [])].filter(Boolean).join(' — '))}</div>`
                : ''}
            ${branding.email ? `<div class="contacts">${esc(branding.email)}</div>` : ''}
        </div>
        <div>
            <div class="title-box">${esc(title)}</div>
            <div class="meta-box">
                <div class="num">${esc(number)}</div>
                <div class="when">${esc(date)}${time ? ` — ${esc(time)}` : ''}</div>
                ${status ? `<span class="badge ${badgeClass(status)}">${esc(status)}</span>` : ''}
            </div>
        </div>
    </header>

    <section class="info-grid">
        <div>
            <h3>بيانات العميل</h3>
            <div class="info-row"><span class="label">الاسم</span><span class="value">${esc(customer.name || '—')}</span></div>
            ${customer.phone ? `<div class="info-row"><span class="label">الهاتف</span><span class="value mono">${esc(customer.phone)}</span></div>` : ''}
            ${customer.taxNumber ? `<div class="info-row"><span class="label">الرقم الضريبي</span><span class="value mono">${esc(customer.taxNumber)}</span></div>` : ''}
            ${customer.address ? `<div class="info-row"><span class="label">العنوان</span><span class="value">${esc(customer.address)}</span></div>` : ''}
        </div>
        <div>
            <h3>تفاصيل الفاتورة</h3>
            <div class="info-row"><span class="label">الحالة</span><span class="value">${esc(status || '—')}</span></div>
            <div class="info-row"><span class="label">طريقة الدفع</span><span class="value">${esc(payment.methodLabel || '—')}</span></div>
            <div class="info-row"><span class="label">القناة</span><span class="value">${esc(payment.channelLabel || '—')}</span></div>
            ${sourceRow}
            ${payment.dueDate ? `<div class="info-row"><span class="label">تاريخ الاستحقاق</span><span class="value">${esc(payment.dueDate)}</span></div>` : ''}
            ${invoice.createdBy ? `<div class="info-row"><span class="label">بواسطة</span><span class="value">${esc(invoice.createdBy)}</span></div>` : ''}
        </div>
    </section>

    <section>
        <table class="data-table">
            <thead>
                <tr>
                    <th>المنتج</th>
                    <th class="num">الكمية</th>
                    <th class="num">سعر الوحدة</th>
                    <th class="num">الإجمالي</th>
                </tr>
            </thead>
            <tbody>
                ${itemRows || `<tr><td colspan="4" style="text-align:center;padding:24px;color:#6b7280">لا توجد عناصر</td></tr>`}
            </tbody>
        </table>
    </section>

    ${paymentHistoryRows}

    <section class="totals">
        <div class="totals-box">
            <div class="row"><span>المجموع الفرعي</span><span>${fmtMoney(totals.subtotal)} ج.م</span></div>
            <div class="row"><span>الضريبة</span><span>${fmtMoney(totals.tax)} ج.م</span></div>
            <div class="row grand"><span>الإجمالي</span><span>${fmtMoney(totals.total)} ج.م</span></div>
            <div class="row" style="margin-top:8px"><span>المدفوع</span><span>${fmtMoney(totals.paidAmount)} ج.م</span></div>
            <div class="row" style="color:#b91c1c"><span>المتبقي</span><span>${fmtMoney(totals.remaining)} ج.م</span></div>
        </div>
    </section>

    ${returnsBlock}

    ${invoice.notes ? `<section class="block"><h3 class="section-title">ملاحظات</h3><p>${esc(invoice.notes)}</p></section>` : ''}

    <footer class="footer">
        <p class="msg">${esc(branding.footerText || 'شكراً لتعاملكم')}</p>
        <p>تم إصدار هذه الفاتورة إلكترونياً</p>
    </footer>
</div>
</body>
</html>`;

    return body;
};

// ---------------------------------------------------------------------------
// PURCHASE_INVOICE
// ---------------------------------------------------------------------------

RENDERERS[DOCUMENT_TYPES.PURCHASE_INVOICE] = function renderPurchaseInvoice(data) {
    const {
        branding = {},
        title = 'فاتورة مشتريات',
        number = '',
        date = '',
        time = '',
        status = '',
        paymentStatusLabel = '',
        supplier = {},
        purchaseOrder = {},
        items = [],
        totals = {},
        payment = {},
    } = data || {};

    const sub = Number(totals.subtotal || 0);
    const tax = Number(totals.tax || 0);
    const total = Number(totals.total || 0);
    const paid = Number(totals.paidAmount || 0);
    const remaining = Number(totals.remaining || 0);
    const dueDate = payment?.dueDate || '';

    const sourceRow = payment?.sourceNumber
        ? `<div class="info-row"><span class="label">مرجع التحويل</span><span class="value mono">${esc(payment.sourceNumber)}</span></div>`
        : '';

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(title)} — ${esc(number)}</title>
<style>
    :root { --primary: ${branding.primaryColor || '#1B3C73'}; --header-bg: ${branding.headerBgColor || '#1B3C73'}; }
    * { box-sizing: border-box; }
    body { font-family: 'Cairo', 'Tahoma', sans-serif; padding: 24px; color: #1f2937; background: #f9fafb; margin: 0; }
    .doc { background: #fff; max-width: 210mm; margin: 0 auto; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid var(--primary); margin-bottom: 24px; }
    .header .brand h1 { margin: 0; font-size: 22px; color: var(--primary); }
    .header .meta { color: #6b7280; font-size: 12px; margin-top: 4px; }
    .header .contacts { color: #6b7280; font-size: 12px; margin-top: 2px; }
    .header .title-box { background: var(--primary); color: #fff; padding: 8px 18px; border-radius: 6px; font-weight: 700; font-size: 16px; display: inline-block; }
    .header .meta-box { text-align: start; margin-top: 8px; font-size: 13px; }
    .header .num { font-weight: 700; font-size: 16px; color: var(--primary); }
    .header .when { color: #6b7280; font-size: 12px; margin-top: 2px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; margin-top: 4px; }
    .badge-paid { background: #d1fae5; color: #065f46; }
    .badge-partial { background: #fef3c7; color: #92400e; }
    .badge-pending { background: #fee2e2; color: #991b1b; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .info-grid h3 { margin: 0 0 8px; font-size: 12px; color: #6b7280; font-weight: 700; letter-spacing: 0.04em; }
    .info-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed #e5e7eb; }
    .info-row .label { color: #6b7280; }
    .info-row .value { font-weight: 600; }
    .info-row .value.mono { font-family: 'Cairo', monospace; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
    th { background: var(--header-bg); color: #fff; padding: 10px 8px; text-align: start; font-weight: 700; font-size: 12px; }
    th.num, td.num { text-align: end; }
    td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
    td.mono { font-family: 'Cairo', monospace; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    .totals { display: grid; grid-template-columns: 1fr 240px; gap: 16px; margin-bottom: 16px; }
    .notes { background: #f9fafb; padding: 12px 16px; border-radius: 8px; font-size: 12px; }
    .notes h4 { margin: 0 0 6px; color: #6b7280; font-size: 11px; font-weight: 700; }
    .totals-card { background: #f3f4f6; padding: 14px 18px; border-radius: 8px; }
    .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
    .totals-row.muted { color: #6b7280; }
    .totals-row.grand { border-top: 2px solid var(--primary); margin-top: 8px; padding-top: 10px; font-size: 16px; font-weight: 800; color: var(--primary); }
    .totals-row.remaining { color: #b91c1c; font-weight: 700; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; }
    .footer .msg { font-weight: 700; color: var(--primary); margin-bottom: 4px; }
    @media print {
        @page { size: A4; margin: 14mm; }
        body { padding: 0; background: #fff; }
        .doc { box-shadow: none; padding: 0; }
    }
</style>
</head>
<body>
<div class="doc" data-document-type="purchase-invoice">
    <header class="header">
        <div class="brand">
            <h1>${esc(branding.companyName || 'شركتكم')}</h1>
            ${branding.address ? `<div class="meta">${esc(branding.address)}</div>` : ''}
            ${(branding.phone || (branding.additionalPhones && branding.additionalPhones.length))
                ? `<div class="contacts">${esc([branding.phone, ...(branding.additionalPhones || [])].filter(Boolean).join(' — '))}</div>`
                : ''}
            ${branding.email ? `<div class="contacts">${esc(branding.email)}</div>` : ''}
        </div>
        <div>
            <div class="title-box">${esc(title)}</div>
            <div class="meta-box">
                <div class="num">${esc(number)}</div>
                <div class="when">${esc(date)}${time ? ` — ${esc(time)}` : ''}</div>
                ${status ? `<span class="badge ${esc(badgeClass(status))}">${esc(status)}</span>` : ''}
            </div>
        </div>
    </header>

    <section class="info-grid">
        <div>
            <h3>بيانات المورد</h3>
            <div class="info-row"><span class="label">الاسم</span><span class="value">${esc(supplier.name || '—')}</span></div>
            ${supplier.phone ? `<div class="info-row"><span class="label">الهاتف</span><span class="value mono">${esc(supplier.phone)}</span></div>` : ''}
            ${supplier.taxNumber ? `<div class="info-row"><span class="label">الرقم الضريبي</span><span class="value mono">${esc(supplier.taxNumber)}</span></div>` : ''}
            ${supplier.address ? `<div class="info-row"><span class="label">العنوان</span><span class="value">${esc(supplier.address)}</span></div>` : ''}
            ${supplier.balance ? `<div class="info-row"><span class="label">رصيد المورد الحالي</span><span class="value mono" style="color: #b91c1c;">${fmtMoney(supplier.balance)} ج.م</span></div>` : ''}
        </div>
        <div>
            <h3>تفاصيل أمر الشراء</h3>
            <div class="info-row"><span class="label">رقم الأمر</span><span class="value mono">${esc(number)}</span></div>
            <div class="info-row"><span class="label">الحالة</span><span class="value">${esc(status || '—')}</span></div>
            <div class="info-row"><span class="label">طريقة الدفع</span><span class="value">${esc(payment?.methodLabel || '—')}</span></div>
            <div class="info-row"><span class="label">القناة</span><span class="value">${esc(payment?.channelLabel || '—')}</span></div>
            ${sourceRow}
            <div class="info-row"><span class="label">المحرر</span><span class="value">${esc(purchaseOrder?.createdBy || 'النظام')}</span></div>
            ${dueDate ? `<div class="info-row"><span class="label">تاريخ الاستلام المتوقع</span><span class="value">${esc(dueDate)}</span></div>` : ''}
        </div>
    </section>

    <table>
        <thead>
            <tr>
                <th style="width: 40px;">م</th>
                <th>المنتج</th>
                <th style="width: 80px;">الكود</th>
                <th style="width: 70px;" class="num">الكمية</th>
                <th style="width: 110px;" class="num">سعر الوحدة</th>
                <th style="width: 120px;" class="num">الإجمالي</th>
            </tr>
        </thead>
        <tbody>
            ${items.length === 0
                ? `<tr><td colspan="6" style="text-align:center; padding: 24px; color: #9ca3af;">لا توجد عناصر</td></tr>`
                : items.map((it, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td>${esc(it.productName || '—')}</td>
                        <td class="mono">${esc(it.productCode || '—')}</td>
                        <td class="num mono">${fmtNum(it.qty)}</td>
                        <td class="num mono">${fmtMoney(it.unitPrice)}</td>
                        <td class="num mono"><strong>${fmtMoney(it.lineTotal)}</strong></td>
                    </tr>
                `).join('')}
        </tbody>
    </table>

    <div class="totals">
        <div>
            ${purchaseOrder?.notes ? `<div class="notes"><h4>ملاحظات</h4>${esc(purchaseOrder.notes)}</div>` : ''}
        </div>
        <div class="totals-card">
            <div class="totals-row muted"><span>الإجمالي قبل الضريبة</span><span class="mono">${fmtMoney(sub)} ج.م</span></div>
            ${tax > 0 ? `<div class="totals-row muted"><span>الضريبة</span><span class="mono">${fmtMoney(tax)} ج.م</span></div>` : ''}
            <div class="totals-row grand"><span>الإجمالي</span><span class="mono">${fmtMoney(total)} ج.م</span></div>
            <div class="totals-row muted" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;"><span>المدفوع</span><span class="mono">${fmtMoney(paid)} ج.م</span></div>
            ${remaining > 0 ? `<div class="totals-row remaining"><span>المتبقي</span><span class="mono">${fmtMoney(remaining)} ج.م</span></div>` : ''}
            ${paymentStatusLabel ? `<div class="totals-row" style="margin-top: 6px;"><span class="badge ${esc(badgeClass(paymentStatusLabel))}">${esc(paymentStatusLabel)}</span></div>` : ''}
        </div>
    </div>

    <div class="footer">
        <div class="msg">${esc(branding.footerText || 'شكراً لتعاملكم معنا')}</div>
    </div>
</div>
</body>
</html>`;
};

// ---------------------------------------------------------------------------
// CUSTOMER_COLLECTION_RECEIPT
// ---------------------------------------------------------------------------

RENDERERS[DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT] = function renderCustomerCollectionReceipt(data) {
    const {
        branding = {},
        title = 'سند تحصيل من عميل',
        receiptNumber = '',
        date = '',
        time = '',
        status = 'مدفوع',
        customer = {},
        transaction = {},
        previousBalance = 0,
        remainingBalance = 0,
        collectedAmount = 0,
        payment = {},
    } = data || {};

    const sourceRow = payment.isElectronic ? `
        <div class="info-row"><span class="label">رقم التحويل</span><span class="value mono">${esc(payment.sourceNumber || '—')}</span></div>
    ` : '';

    const body = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(title)} — ${esc(branding.companyName || '')}</title>
<style>
    :root {
        --primary: ${esc(branding.primaryColor || '#1B3C73')};
        --header-bg: ${esc(branding.headerBgColor || '#1B3C73')};
    }
    * { box-sizing: border-box; }
    body {
        font-family: "Segoe UI", system-ui, Arial, sans-serif;
        margin: 0; padding: 32px; color: #1f2937; background: #fff;
    }
    .doc { max-width: 800px; margin: 0 auto; }
    .header {
        display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
        padding-bottom: 16px; border-bottom: 2px solid var(--primary); margin-bottom: 24px;
    }
    .brand h1 { font-size: 24px; margin: 0; color: var(--primary); }
    .brand .meta { color: #6b7280; font-size: 12px; margin-top: 4px; }
    .brand .contacts { color: #6b7280; font-size: 11px; margin-top: 8px; line-height: 1.6; }
    .title-box {
        background: var(--primary); color: #fff; padding: 6px 16px;
        border-radius: 6px 6px 0 0; font-weight: 700; text-align: center;
    }
    .meta-box {
        border: 1px solid #e5e7eb; border-top: 0;
        border-radius: 0 0 6px 6px; padding: 12px; text-align: center; min-width: 220px;
    }
    .meta-box .num { font-family: ui-monospace, Menlo, monospace; font-size: 18px; font-weight: 700; color: var(--primary); }
    .meta-box .when { color: #6b7280; font-size: 11px; margin-top: 4px; }
    .meta-box .badge { display: inline-block; margin-top: 8px; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .badge-paid { background: #d1fae5; color: #065f46; }
    .info-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
        background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 16px; font-size: 13px;
    }
    .info-grid h3 { margin: 0 0 8px; color: var(--primary); font-size: 14px; }
    .info-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .info-row .label { color: #6b7280; }
    .info-row .value { font-weight: 600; }
    .info-row .value.mono { font-family: ui-monospace, Menlo, monospace; }
    .amount-box {
        background: var(--primary); color: #fff; padding: 24px;
        border-radius: 12px; margin-bottom: 16px; text-align: center;
        position: relative; overflow: hidden;
    }
    .amount-box .label { display: block; font-size: 12px; opacity: 0.85; margin-bottom: 6px; }
    .amount-box .amount {
        font-family: ui-monospace, Menlo, monospace; font-size: 36px; font-weight: 700;
        letter-spacing: -0.5px;
    }
    .amount-box .currency { font-size: 18px; opacity: 0.9; margin-inline-start: 6px; }
    .amount-box .method { margin-top: 12px; font-size: 12px; opacity: 0.95; }
    .balance-grid {
        display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px;
    }
    .balance-card {
        background: #f9fafb; padding: 12px; border-radius: 8px; text-align: center; border: 1px solid #e5e7eb;
    }
    .balance-card .label { color: #6b7280; font-size: 11px; font-weight: 700; }
    .balance-card .value { font-family: ui-monospace, Menlo, monospace; font-size: 18px; font-weight: 700; margin-top: 4px; color: var(--primary); }
    .balance-card.remaining .value { color: #b91c1c; }
    .description-block {
        background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 16px;
        border-inline-start: 4px solid var(--primary);
    }
    .description-block .label { color: #6b7280; font-size: 11px; font-weight: 700; margin-bottom: 4px; }
    .description-block .text { font-size: 14px; font-weight: 600; }
    .footer {
        margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;
        text-align: center; font-size: 12px; color: #6b7280;
    }
    .footer .msg { font-weight: 700; color: var(--primary); margin-bottom: 4px; }
    @media print {
        @page { size: A4; margin: 20mm; }
        body { padding: 0; }
    }
</style>
</head>
<body>
<div class="doc" data-document-type="customer-collection-receipt">
    <header class="header">
        <div class="brand">
            <h1>${esc(branding.companyName || 'شركتكم')}</h1>
            ${branding.address ? `<div class="meta">${esc(branding.address)}</div>` : ''}
            ${(branding.phone || (branding.additionalPhones && branding.additionalPhones.length))
                ? `<div class="contacts">${esc([branding.phone, ...(branding.additionalPhones || [])].filter(Boolean).join(' — '))}</div>`
                : ''}
            ${branding.email ? `<div class="contacts">${esc(branding.email)}</div>` : ''}
        </div>
        <div>
            <div class="title-box">${esc(title)}</div>
            <div class="meta-box">
                <div class="num">${esc(receiptNumber)}</div>
                <div class="when">${esc(date)}${time ? ` — ${esc(time)}` : ''}</div>
                ${status ? `<span class="badge badge-paid">${esc(status)}</span>` : ''}
            </div>
        </div>
    </header>

    <section class="info-grid">
        <div>
            <h3>بيانات العميل</h3>
            <div class="info-row"><span class="label">الاسم</span><span class="value">${esc(customer.name || '—')}</span></div>
            ${customer.phone ? `<div class="info-row"><span class="label">الهاتف</span><span class="value mono">${esc(customer.phone)}</span></div>` : ''}
            ${customer.taxNumber ? `<div class="info-row"><span class="label">الرقم الضريبي</span><span class="value mono">${esc(customer.taxNumber)}</span></div>` : ''}
            ${customer.address ? `<div class="info-row"><span class="label">العنوان</span><span class="value">${esc(customer.address)}</span></div>` : ''}
        </div>
        <div>
            <h3>تفاصيل التحصيل</h3>
            <div class="info-row"><span class="label">طريقة الدفع</span><span class="value">${esc(payment.methodLabel || '—')}</span></div>
            <div class="info-row"><span class="label">القناة</span><span class="value">${esc(payment.channelLabel || '—')}</span></div>
            ${sourceRow}
            <div class="info-row"><span class="label">مرجع العملية</span><span class="value">${esc(transaction.referenceTypeLabel || '')}${transaction.referenceNumber ? ` — ${esc(transaction.referenceNumber)}` : ''}</div>
            <div class="info-row"><span class="label">محرر السند</span><span class="value">${esc(transaction.createdBy || 'النظام')}</span></div>
        </div>
    </section>

    <section class="amount-box">
        <span class="label">المبلغ المستلم</span>
        <div>
            <span class="amount">${fmtMoney(collectedAmount)}</span>
            <span class="currency">ج.م</span>
        </div>
        <div class="method">${esc(payment.methodLabel || '')}${payment.channelLabel ? ` — ${esc(payment.channelLabel)}` : ''}</div>
    </section>

    <section class="balance-grid">
        <div class="balance-card">
            <div class="label">الرصيد السابق</div>
            <div class="value">${fmtMoney(previousBalance)} ج.م</div>
        </div>
        <div class="balance-card">
            <div class="label">المبلغ المحصل</div>
            <div class="value">${fmtMoney(collectedAmount)} ج.م</div>
        </div>
        <div class="balance-card remaining">
            <div class="label">الرصيد المتبقي</div>
            <div class="value">${fmtMoney(remainingBalance)} ج.م</div>
        </div>
    </section>

    ${transaction.description ? `
    <section class="description-block">
        <div class="label">وذلك عن / البيان</div>
        <div class="text">${esc(transaction.description)}</div>
    </section>
    ` : ''}

    <footer class="footer">
        <p class="msg">${esc(branding.footerText || 'شكراً لتعاملكم')}</p>
        <p>تم إصدار هذا السند إلكترونياً</p>
    </footer>
</div>
</body>
</html>`;

    return body;
};

// ---------------------------------------------------------------------------
// SUPPLIER_PAYMENT_RECEIPT
// ---------------------------------------------------------------------------

RENDERERS[DOCUMENT_TYPES.SUPPLIER_PAYMENT_RECEIPT] = function renderSupplierPaymentReceipt(data) {
    const {
        branding = {},
        title = 'سند سداد لمورد',
        receiptNumber = '',
        date = '',
        time = '',
        status = 'مدفوع',
        supplier = {},
        transaction = {},
        payment = {},
        paidAmount = 0,
        previousBalance = 0,
        remainingBalance = 0,
        currentSupplierBalance = 0,
    } = data || {};

    const sourceRow = payment?.sourceNumber
        ? `<div class="info-row"><span class="label">مرجع التحويل</span><span class="value mono">${esc(payment.sourceNumber)}</span></div>`
        : '';

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(title)} — ${esc(receiptNumber)}</title>
<style>
    :root { --primary: ${branding.primaryColor || '#1B3C73'}; --header-bg: ${branding.headerBgColor || '#1B3C73'}; }
    * { box-sizing: border-box; }
    body { font-family: 'Cairo', 'Tahoma', sans-serif; padding: 24px; color: #1f2937; background: #f9fafb; margin: 0; }
    .doc { background: #fff; max-width: 210mm; margin: 0 auto; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid var(--primary); margin-bottom: 24px; }
    .header .brand h1 { margin: 0; font-size: 22px; color: var(--primary); }
    .header .meta { color: #6b7280; font-size: 12px; margin-top: 4px; }
    .header .contacts { color: #6b7280; font-size: 12px; margin-top: 2px; }
    .header .title-box { background: var(--primary); color: #fff; padding: 8px 18px; border-radius: 6px; font-weight: 700; font-size: 16px; display: inline-block; }
    .header .meta-box { text-align: start; margin-top: 8px; font-size: 13px; }
    .header .meta-box .num { font-weight: 700; font-size: 16px; color: var(--primary); }
    .header .meta-box .when { color: #6b7280; font-size: 12px; margin-top: 2px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; margin-top: 4px; }
    .badge-paid { background: #d1fae5; color: #065f46; }
    .badge-partial { background: #fef3c7; color: #92400e; }
    .badge-pending { background: #fee2e2; color: #991b1b; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .info-grid h3 { margin: 0 0 8px; font-size: 12px; color: #6b7280; font-weight: 700; letter-spacing: 0.04em; }
    .info-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed #e5e7eb; }
    .info-row .label { color: #6b7280; }
    .info-row .value { font-weight: 600; }
    .info-row .value.mono { font-family: 'Cairo', monospace; }
    .amount-box { background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 70%, #000)); color: #fff; padding: 24px; border-radius: 12px; text-align: center; margin-bottom: 20px; }
    .amount-box .label { font-size: 12px; opacity: 0.85; font-weight: 600; letter-spacing: 0.04em; }
    .amount-box .amount { display: block; font-size: 36px; font-weight: 800; margin: 8px 0; font-family: 'Cairo', monospace; }
    .amount-box .currency { font-size: 18px; opacity: 0.85; margin-inline-start: 4px; }
    .amount-box .method { font-size: 13px; opacity: 0.85; margin-top: 6px; }
    .balance-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    .balance-card { background: #f3f4f6; padding: 14px 16px; border-radius: 8px; text-align: center; }
    .balance-card .label { font-size: 11px; color: #6b7280; font-weight: 700; letter-spacing: 0.04em; }
    .balance-card .value { font-size: 18px; font-weight: 800; color: var(--primary); margin-top: 4px; font-family: 'Cairo', monospace; }
    .balance-card.paid .value { color: #b91c1c; }
    .balance-card.remaining .value { color: #92400e; }
    .description-block { background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 16px; border-inline-start: 4px solid var(--primary); }
    .description-block .label { color: #6b7280; font-size: 11px; font-weight: 700; margin-bottom: 4px; }
    .description-block .text { font-size: 14px; font-weight: 600; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; }
    .footer .msg { font-weight: 700; color: var(--primary); margin-bottom: 4px; }
    @media print {
        @page { size: A4; margin: 20mm; }
        body { padding: 0; }
    }
</style>
</head>
<body>
<div class="doc" data-document-type="supplier-payment-receipt">
    <header class="header">
        <div class="brand">
            <h1>${esc(branding.companyName || 'شركتكم')}</h1>
            ${branding.address ? `<div class="meta">${esc(branding.address)}</div>` : ''}
            ${(branding.phone || (branding.additionalPhones && branding.additionalPhones.length))
                ? `<div class="contacts">${esc([branding.phone, ...(branding.additionalPhones || [])].filter(Boolean).join(' — '))}</div>`
                : ''}
            ${branding.email ? `<div class="contacts">${esc(branding.email)}</div>` : ''}
        </div>
        <div>
            <div class="title-box">${esc(title)}</div>
            <div class="meta-box">
                <div class="num">${esc(receiptNumber)}</div>
                <div class="when">${esc(date)}${time ? ` — ${esc(time)}` : ''}</div>
                ${status ? `<span class="badge ${esc(badgeClass(status))}">${esc(status)}</span>` : ''}
            </div>
        </div>
    </header>

    <section class="info-grid">
        <div>
            <h3>بيانات المورد</h3>
            <div class="info-row"><span class="label">الاسم</span><span class="value">${esc(supplier.name || '—')}</span></div>
            ${supplier.phone ? `<div class="info-row"><span class="label">الهاتف</span><span class="value mono">${esc(supplier.phone)}</span></div>` : ''}
            ${supplier.taxNumber ? `<div class="info-row"><span class="label">الرقم الضريبي</span><span class="value mono">${esc(supplier.taxNumber)}</span></div>` : ''}
            ${supplier.address ? `<div class="info-row"><span class="label">العنوان</span><span class="value">${esc(supplier.address)}</span></div>` : ''}
            ${Number(supplier.balance || 0) !== 0 ? `<div class="info-row"><span class="label">الرصيد الحالي (مدين لنا)</span><span class="value mono" style="color: #b91c1c;">${fmtMoney(supplier.balance)} ج.م</span></div>` : ''}
        </div>
        <div>
            <h3>تفاصيل السداد</h3>
            <div class="info-row"><span class="label">طريقة الدفع</span><span class="value">${esc(payment.methodLabel || '—')}</span></div>
            <div class="info-row"><span class="label">القناة</span><span class="value">${esc(payment.channelLabel || '—')}</span></div>
            ${sourceRow}
            <div class="info-row"><span class="label">مرجع العملية</span><span class="value">${esc(transaction.referenceTypeLabel || '')}${transaction.referenceNumber ? ` — ${esc(transaction.referenceNumber)}` : ''}</div>
            <div class="info-row"><span class="label">محرر السند</span><span class="value">${esc(transaction.createdBy || 'النظام')}</span></div>
        </div>
    </section>

    <section class="amount-box">
        <span class="label">المبلغ المدفوع</span>
        <div>
            <span class="amount">${fmtMoney(paidAmount)}</span>
            <span class="currency">ج.م</span>
        </div>
        <div class="method">${esc(payment.methodLabel || '')}${payment.channelLabel ? ` — ${esc(payment.channelLabel)}` : ''}</div>
    </section>

    <section class="balance-grid">
        <div class="balance-card">
            <div class="label">الرصيد السابق</div>
            <div class="value">${fmtMoney(previousBalance)} ج.م</div>
        </div>
        <div class="balance-card paid">
            <div class="label">المبلغ المدفوع</div>
            <div class="value">${fmtMoney(paidAmount)} ج.م</div>
        </div>
        <div class="balance-card remaining">
            <div class="label">الرصيد المتبقي</div>
            <div class="value">${fmtMoney(remainingBalance)} ج.م</div>
        </div>
    </section>

    <div class="description-block">
        <div class="label">وذلك عن</div>
        <div class="text">${esc(transaction.description || '—')}</div>
    </div>

    <div class="footer">
        <div class="msg">${esc(branding.footerText || 'شكراً لتعاملكم معنا')}</div>
    </div>
</div>
</body>
</html>`;
};

// ---------------------------------------------------------------------------
// Safe placeholder for not-yet-implemented types
// ---------------------------------------------------------------------------

function renderPlaceholder(entry, data) {
    const branding = data?.branding || {};
    const items = Array.isArray(data?.rows) ? data.rows.length
        : Array.isArray(data?.transactions) ? data.transactions.length
        : 0;
    return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>${esc(entry.labelAr)} — ${esc(branding.companyName || '')}</title></head>
<body style="font-family: system-ui, Arial, sans-serif; padding: 2rem;">
<h1 style="color:${esc(branding.primaryColor || '#1B3C73')}">${esc(branding.companyName || 'شركتكم')}</h1>
<h2>${esc(entry.labelAr)}</h2>
<p>نوع المستند: <code>${esc(entry.id)}</code></p>
<p>عدد السجلات: <strong>${items}</strong></p>
<p>قالب المستند الكامل سيُسلَّم في Sprint ${nextSprintFor(entry.id)}.</p>
</body>
</html>`;
}

function nextSprintFor(type) {
    // Mapping for the placeholder text only; the real templates land
    // in their respective sprints.
    const map = {
        CUSTOMER_ACCOUNT_STATEMENT: '5',
        PURCHASE_INVOICE: '6',
        SUPPLIER_PAYMENT_RECEIPT: '7',
        SUPPLIER_ACCOUNT_STATEMENT: '8',
        COMPANY_FINANCIAL_STATEMENT: '9',
        TREASURY_STATEMENT: '9',
        FINANCIAL_MOVEMENT_REPORT: '9',
        DATE_RANGE_REPORT: '9',
        PAYMENT_METHOD_REPORT: '9',
    };
    return map[type] || '10';
}

// ---------------------------------------------------------------------------
// CUSTOMER_STATEMENT
// ---------------------------------------------------------------------------

RENDERERS[DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT] = function renderCustomerStatement(data) {
    const {
        branding = {},
        title = 'كشف حساب عميل',
        customer = {},
        period = {},
        openingBalance = 0,
        closingBalance = 0,
        currentSnapshotBalance = 0,
        balanceDelta = '0.00',
        totals = { debits: 0, credits: 0, net: 0 },
        lines = [],
        generatedAt,
        generatedBy
    } = data || {};

    const startDate = period.startDate ? new Date(period.startDate).toLocaleDateString('ar-EG') : '—';
    const endDate = period.endDate ? new Date(period.endDate).toLocaleDateString('ar-EG') : '—';
    const generatedAtStr = generatedAt ? new Date(generatedAt).toLocaleString('ar-EG') : '—';

    const rowLimit = 28;
    const pages = Math.max(1, Math.ceil(lines.length / rowLimit));
    const pageChunks = [];
    for (let p = 0; p < pages; p++) {
        pageChunks.push(lines.slice(p * rowLimit, (p + 1) * rowLimit));
    }

    const hasDelta = Math.abs(Number(balanceDelta)) >= 0.01;
    const deltaClass = hasDelta ? 'badge-partial' : 'badge-paid';
    const deltaLabel = hasDelta
        ? `تنبيه: فرق تسوية ${fmtMoney(balanceDelta)} ج.م`
        : 'الرصيد متطابق مع السجل';

    const pagesHtml = pageChunks.map((chunk, p) => `
        <div class="page" data-page="${p + 1}">
            <table class="stmt-table">
                <thead>
                    <tr>
                        <th style="width: 60px;">م</th>
                        <th style="width: 110px;">التاريخ</th>
                        <th>البيان</th>
                        <th style="width: 100px;">المرجع</th>
                        <th style="width: 110px;" class="num">مدين</th>
                        <th style="width: 110px;" class="num">دائن</th>
                        <th style="width: 120px;" class="num">الرصيد</th>
                    </tr>
                </thead>
                <tbody>
                    ${chunk.length === 0
                        ? `<tr><td colspan="7" class="empty">لا توجد حركات في هذه الصفحة</td></tr>`
                        : chunk.map((line, i) => `
                            <tr>
                                <td>${p * rowLimit + i + 1}</td>
                                <td>${esc(line.dateFormatted ? new Date(line.dateFormatted).toLocaleDateString('ar-EG') : '—')}</td>
                                <td>${esc(line.label || line.description || '—')}</td>
                                <td class="mono">${esc(line.reference || '—')}</td>
                                <td class="num mono">${Number(line.debit) > 0 ? fmtMoney(line.debit) : '—'}</td>
                                <td class="num mono">${Number(line.credit) > 0 ? fmtMoney(line.credit) : '—'}</td>
                                <td class="num mono strong">${fmtMoney(line.balance)}</td>
                            </tr>
                        `).join('')}
                </tbody>
            </table>
            <div class="page-footer">صفحة ${p + 1} من ${pages}</div>
        </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(title)} — ${esc(customer.name || '')}</title>
<style>
    :root { --primary: ${branding.primaryColor || '#1B3C73'}; --header-bg: ${branding.headerBgColor || '#1B3C73'}; }
    * { box-sizing: border-box; }
    body { font-family: 'Cairo', 'Tahoma', sans-serif; padding: 24px; color: #1f2937; background: #f9fafb; margin: 0; }
    .doc { background: #fff; max-width: 210mm; margin: 0 auto; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid var(--primary); margin-bottom: 24px; }
    .header .brand h1 { margin: 0; font-size: 22px; color: var(--primary); }
    .header .meta { color: #6b7280; font-size: 12px; margin-top: 4px; }
    .header .contacts { color: #6b7280; font-size: 12px; margin-top: 2px; }
    .header .title-box { background: var(--primary); color: #fff; padding: 8px 18px; border-radius: 6px; font-weight: 700; font-size: 16px; display: inline-block; }
    .header .meta-box { text-align: start; margin-top: 8px; font-size: 13px; }
    .customer-card { background: #f3f4f6; padding: 14px 18px; border-radius: 8px; margin-bottom: 20px; border-inline-start: 4px solid var(--primary); }
    .customer-card h3 { margin: 0 0 8px; font-size: 12px; color: #6b7280; font-weight: 700; letter-spacing: 0.04em; }
    .customer-card .name { font-size: 18px; font-weight: 700; }
    .customer-card .info { color: #4b5563; font-size: 12px; margin-top: 4px; }
    .period { display: flex; justify-content: space-between; align-items: center; background: #eff6ff; padding: 10px 16px; border-radius: 6px; margin-bottom: 20px; font-size: 13px; }
    .period strong { color: var(--primary); }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    .summary-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; }
    .summary-card .label { font-size: 11px; color: #6b7280; font-weight: 700; }
    .summary-card .value { font-size: 18px; font-weight: 700; color: var(--primary); margin-top: 4px; font-family: 'Cairo', monospace; }
    .summary-card.opening .value { color: #6b7280; }
    .summary-card.closing .value { color: var(--primary); }
    .summary-card.closing.negative .value { color: #b91c1c; }
    .summary-card.closing.positive .value { color: #047857; }
    .delta-banner { padding: 10px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; font-weight: 600; }
    .delta-banner.ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .delta-banner.warn { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
    .stmt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .stmt-table th { background: var(--header-bg); color: #fff; padding: 8px; text-align: start; font-weight: 700; }
    .stmt-table th.num, .stmt-table td.num { text-align: end; }
    .stmt-table td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; }
    .stmt-table tr:nth-child(even) td { background: #f9fafb; }
    .stmt-table td.empty { text-align: center; color: #9ca3af; padding: 24px; }
    .stmt-table td.mono { font-family: 'Cairo', monospace; }
    .stmt-table td.strong { font-weight: 700; color: var(--primary); }
    .totals-row td { background: #f3f4f6 !important; font-weight: 700; padding-top: 10px; padding-bottom: 10px; }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .page-footer { text-align: center; color: #9ca3af; font-size: 11px; margin-top: 12px; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; }
    .footer .msg { font-weight: 700; color: var(--primary); margin-bottom: 4px; }
    @media print {
        @page { size: A4; margin: 14mm; }
        body { padding: 0; background: #fff; }
        .doc { box-shadow: none; padding: 0; }
    }
</style>
</head>
<body>
<div class="doc" data-document-type="customer-statement">
    <header class="header">
        <div class="brand">
            <h1>${esc(branding.companyName || 'شركتكم')}</h1>
            ${branding.address ? `<div class="meta">${esc(branding.address)}</div>` : ''}
            ${(branding.phone || (branding.additionalPhones && branding.additionalPhones.length))
                ? `<div class="contacts">${esc([branding.phone, ...(branding.additionalPhones || [])].filter(Boolean).join(' — '))}</div>`
                : ''}
            ${branding.email ? `<div class="contacts">${esc(branding.email)}</div>` : ''}
        </div>
        <div>
            <div class="title-box">${esc(title)}</div>
            <div class="meta-box">من ${esc(startDate)} إلى ${esc(endDate)}</div>
        </div>
    </header>

    <div class="customer-card">
        <h3>العميل</h3>
        <div class="name">${esc(customer.name || '—')}</div>
        <div class="info">
            ${customer.phone ? `هاتف: ${esc(customer.phone)} • ` : ''}
            ${customer.taxNumber ? `الرقم الضريبي: ${esc(customer.taxNumber)} • ` : ''}
            ${customer.address ? `${esc(customer.address)}` : ''}
        </div>
    </div>

    <div class="summary">
        <div class="summary-card opening">
            <div class="label">الرصيد الافتتاحي</div>
            <div class="value">${fmtMoney(openingBalance)} ج.م</div>
        </div>
        <div class="summary-card">
            <div class="label">إجمالي المدين</div>
            <div class="value">${fmtMoney(totals.debits)} ج.م</div>
        </div>
        <div class="summary-card">
            <div class="label">إجمالي الدائن</div>
            <div class="value">${fmtMoney(totals.credits)} ج.م</div>
        </div>
    </div>

    <div class="summary">
        <div class="summary-card closing ${closingBalance > 0 ? 'positive' : (closingBalance < 0 ? 'negative' : '')}" style="grid-column: span 2;">
            <div class="label">الرصيد الختامي</div>
            <div class="value">${fmtMoney(closingBalance)} ج.م</div>
        </div>
        <div class="summary-card">
            <div class="label">الرصيد المسجل بالنظام</div>
            <div class="value">${fmtMoney(currentSnapshotBalance)} ج.م</div>
        </div>
    </div>

    <div class="delta-banner ${hasDelta ? 'warn' : 'ok'}">${esc(deltaLabel)}</div>

    ${pagesHtml}

    <div class="footer">
        <div class="msg">${esc(branding.footerText || 'شكراً لتعاملكم معنا')}</div>
        <div>أُنشئ في ${esc(generatedAtStr)}${generatedBy ? ` بواسطة ${esc(generatedBy)}` : ''}</div>
    </div>
</div>
</body>
</html>`;
};

// ---------------------------------------------------------------------------
// SUPPLIER_ACCOUNT_STATEMENT
// ---------------------------------------------------------------------------

RENDERERS[DOCUMENT_TYPES.SUPPLIER_ACCOUNT_STATEMENT] = function renderSupplierStatement(data) {
    const {
        branding = {},
        title = 'كشف حساب مورد',
        supplier = {},
        period = {},
        openingBalance = 0,
        closingBalance = 0,
        currentSnapshotBalance = 0,
        balanceDelta = '0.00',
        totals = { debits: 0, credits: 0, net: 0 },
        lines = [],
        generatedAt,
        generatedBy
    } = data || {};

    const startDate = period.startDate ? new Date(period.startDate).toLocaleDateString('ar-EG') : '—';
    const endDate = period.endDate ? new Date(period.endDate).toLocaleDateString('ar-EG') : '—';
    const generatedAtStr = generatedAt ? new Date(generatedAt).toLocaleString('ar-EG') : '—';

    const rowLimit = 28;
    const pages = Math.max(1, Math.ceil(lines.length / rowLimit));
    const pageChunks = [];
    for (let p = 0; p < pages; p++) {
        pageChunks.push(lines.slice(p * rowLimit, (p + 1) * rowLimit));
    }

    const hasDelta = Math.abs(Number(balanceDelta)) >= 0.01;
    const deltaLabel = hasDelta
        ? `تنبيه: فرق تسوية ${fmtMoney(balanceDelta)} ج.م`
        : 'الرصيد متطابق مع السجل';

    const pagesHtml = pageChunks.map((chunk, p) => `
        <div class="page" data-page="${p + 1}">
            <table class="stmt-table">
                <thead>
                    <tr>
                        <th style="width: 60px;">م</th>
                        <th style="width: 110px;">التاريخ</th>
                        <th>البيان</th>
                        <th style="width: 100px;">المرجع</th>
                        <th style="width: 110px;" class="num">مدين (+)</th>
                        <th style="width: 110px;" class="num">دائن (-)</th>
                        <th style="width: 120px;" class="num">الرصيد</th>
                    </tr>
                </thead>
                <tbody>
                    ${chunk.length === 0
                        ? `<tr><td colspan="7" class="empty">لا توجد حركات في هذه الصفحة</td></tr>`
                        : chunk.map((line, i) => `
                            <tr>
                                <td>${p * rowLimit + i + 1}</td>
                                <td>${esc(line.dateFormatted ? new Date(line.dateFormatted).toLocaleDateString('ar-EG') : '—')}</td>
                                <td>${esc(line.label || line.description || '—')}</td>
                                <td class="mono">${esc(line.reference || '—')}</td>
                                <td class="num mono">${Number(line.debit) > 0 ? fmtMoney(line.debit) : '—'}</td>
                                <td class="num mono">${Number(line.credit) > 0 ? fmtMoney(line.credit) : '—'}</td>
                                <td class="num mono strong">${fmtMoney(line.balance)}</td>
                            </tr>
                        `).join('')}
                </tbody>
            </table>
            <div class="page-footer">صفحة ${p + 1} من ${pages}</div>
        </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(title)} — ${esc(supplier.name || '')}</title>
<style>
    :root { --primary: ${branding.primaryColor || '#1B3C73'}; --header-bg: ${branding.headerBgColor || '#1B3C73'}; }
    * { box-sizing: border-box; }
    body { font-family: 'Cairo', 'Tahoma', sans-serif; padding: 24px; color: #1f2937; background: #f9fafb; margin: 0; }
    .doc { background: #fff; max-width: 210mm; margin: 0 auto; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid var(--primary); margin-bottom: 24px; }
    .header .brand h1 { margin: 0; font-size: 22px; color: var(--primary); }
    .header .meta { color: #6b7280; font-size: 12px; margin-top: 4px; }
    .header .contacts { color: #6b7280; font-size: 12px; margin-top: 2px; }
    .header .title-box { background: var(--primary); color: #fff; padding: 8px 18px; border-radius: 6px; font-weight: 700; font-size: 16px; display: inline-block; }
    .header .meta-box { text-align: start; margin-top: 8px; font-size: 13px; }
    .supplier-card { background: #fef2f2; padding: 14px 18px; border-radius: 8px; margin-bottom: 20px; border-inline-start: 4px solid #b91c1c; }
    .supplier-card h3 { margin: 0 0 8px; font-size: 12px; color: #6b7280; font-weight: 700; letter-spacing: 0.04em; }
    .supplier-card .name { font-size: 18px; font-weight: 700; }
    .supplier-card .info { color: #4b5563; font-size: 12px; margin-top: 4px; }
    .period { display: flex; justify-content: space-between; align-items: center; background: #eff6ff; padding: 10px 16px; border-radius: 6px; margin-bottom: 20px; font-size: 13px; }
    .period strong { color: var(--primary); }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    .summary-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; }
    .summary-card .label { font-size: 11px; color: #6b7280; font-weight: 700; }
    .summary-card .value { font-size: 18px; font-weight: 700; color: var(--primary); margin-top: 4px; font-family: 'Cairo', monospace; }
    .summary-card.opening .value { color: #6b7280; }
    .summary-card.closing .value { color: var(--primary); }
    .summary-card.closing.negative .value { color: #047857; }
    .summary-card.closing.positive .value { color: #b91c1c; }
    .delta-banner { padding: 10px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; font-weight: 600; }
    .delta-banner.ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .delta-banner.warn { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
    .stmt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .stmt-table th { background: var(--header-bg); color: #fff; padding: 8px; text-align: start; font-weight: 700; }
    .stmt-table th.num, .stmt-table td.num { text-align: end; }
    .stmt-table td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; }
    .stmt-table tr:nth-child(even) td { background: #f9fafb; }
    .stmt-table td.empty { text-align: center; color: #9ca3af; padding: 24px; }
    .stmt-table td.mono { font-family: 'Cairo', monospace; }
    .stmt-table td.strong { font-weight: 700; color: var(--primary); }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .page-footer { text-align: center; color: #9ca3af; font-size: 11px; margin-top: 12px; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; }
    .footer .msg { font-weight: 700; color: var(--primary); margin-bottom: 4px; }
    @media print {
        @page { size: A4; margin: 14mm; }
        body { padding: 0; background: #fff; }
        .doc { box-shadow: none; padding: 0; }
    }
</style>
</head>
<body>
<div class="doc" data-document-type="supplier-statement">
    <header class="header">
        <div class="brand">
            <h1>${esc(branding.companyName || 'شركتكم')}</h1>
            ${branding.address ? `<div class="meta">${esc(branding.address)}</div>` : ''}
            ${(branding.phone || (branding.additionalPhones && branding.additionalPhones.length))
                ? `<div class="contacts">${esc([branding.phone, ...(branding.additionalPhones || [])].filter(Boolean).join(' — '))}</div>`
                : ''}
            ${branding.email ? `<div class="contacts">${esc(branding.email)}</div>` : ''}
        </div>
        <div>
            <div class="title-box">${esc(title)}</div>
            <div class="meta-box">من ${esc(startDate)} إلى ${esc(endDate)}</div>
        </div>
    </header>

    <div class="supplier-card">
        <h3>المورد</h3>
        <div class="name">${esc(supplier.name || '—')}</div>
        <div class="info">
            ${supplier.phone ? `هاتف: ${esc(supplier.phone)} • ` : ''}
            ${supplier.taxNumber ? `الرقم الضريبي: ${esc(supplier.taxNumber)} • ` : ''}
            ${supplier.address ? `${esc(supplier.address)}` : ''}
        </div>
    </div>

    <div class="summary">
        <div class="summary-card opening">
            <div class="label">الرصيد الافتتاحي</div>
            <div class="value">${fmtMoney(openingBalance)} ج.م</div>
        </div>
        <div class="summary-card">
            <div class="label">إجمالي المدين</div>
            <div class="value">${fmtMoney(totals.debits)} ج.م</div>
        </div>
        <div class="summary-card">
            <div class="label">إجمالي الدائن</div>
            <div class="value">${fmtMoney(totals.credits)} ج.م</div>
        </div>
    </div>

    <div class="summary">
        <div class="summary-card closing ${closingBalance > 0 ? 'positive' : (closingBalance < 0 ? 'negative' : '')}" style="grid-column: span 2;">
            <div class="label">الرصيد الختامي (مدين لنا)</div>
            <div class="value">${fmtMoney(closingBalance)} ج.م</div>
        </div>
        <div class="summary-card">
            <div class="label">الرصيد المسجل بالنظام</div>
            <div class="value">${fmtMoney(currentSnapshotBalance)} ج.م</div>
        </div>
    </div>

    <div class="delta-banner ${hasDelta ? 'warn' : 'ok'}">${esc(deltaLabel)}</div>

    ${pagesHtml}

    <div class="footer">
        <div class="msg">${esc(branding.footerText || 'شكراً لتعاملكم معنا')}</div>
        <div>أُنشئ في ${esc(generatedAtStr)}${generatedBy ? ` بواسطة ${esc(generatedBy)}` : ''}</div>
    </div>
</div>
</body>
</html>`;
};

// ---------------------------------------------------------------------------
// Renderer entry point
// ---------------------------------------------------------------------------

/**
 * Render DocumentData to HTML.
 * @param {string} type    one of DOCUMENT_TYPES
 * @param {object} data    the DocumentData
 * @returns {string}       the HTML body
 */
export function renderHtml(type, data) {
    const entry = getDocumentEntry(type);
    const renderer = RENDERERS[type];
    if (renderer) return renderer(data);
    return renderPlaceholder(entry, data);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function fmtMoney(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function badgeClass(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('مدفوع') && !s.includes('غير')) return 'badge-paid';
    if (s.includes('جزئي')) return 'badge-partial';
    return 'badge-pending';
}
