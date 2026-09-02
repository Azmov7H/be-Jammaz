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
        CUSTOMER_COLLECTION_RECEIPT: '4',
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
