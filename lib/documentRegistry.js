/**
 * Document type registry — the single source of truth for the
 * DocumentService.
 *
 * Each document type in the system (sales invoice, collection receipt,
 * customer account statement, etc.) is registered here with:
 *   - the list of allowed filter keys (anti-injection)
 *   - the list of supported output formats
 *   - the fetcher module (lazy-loaded; throws NotImplemented until S2+)
 *   - the renderer module (lazy-loaded; throws NotImplemented until S10+)
 *
 * Adding a new document type = one new entry here + one new fetcher +
 * one new renderer. No other code change is required.
 *
 * Mirror the legacy `FILTER_SCHEMAS` pattern in services/exportService.js
 * (SEC-EXP-002): filter keys are allow-listed, never passed straight
 * into Mongo.
 */

import { NotFoundError, BadRequestError } from './errors.js';

export const DOCUMENT_TYPES = Object.freeze({
    SALE_INVOICE: 'SALE_INVOICE',
    CUSTOMER_COLLECTION_RECEIPT: 'CUSTOMER_COLLECTION_RECEIPT',
    CUSTOMER_ACCOUNT_STATEMENT: 'CUSTOMER_ACCOUNT_STATEMENT',
    CUSTOMER_TRANSACTION_STATEMENT: 'CUSTOMER_TRANSACTION_STATEMENT',
    CUSTOMER_FINANCIAL_SUMMARY: 'CUSTOMER_FINANCIAL_SUMMARY',
    PURCHASE_INVOICE: 'PURCHASE_INVOICE',
    SUPPLIER_PAYMENT_RECEIPT: 'SUPPLIER_PAYMENT_RECEIPT',
    SUPPLIER_ACCOUNT_STATEMENT: 'SUPPLIER_ACCOUNT_STATEMENT',
    SUPPLIER_TRANSACTION_STATEMENT: 'SUPPLIER_TRANSACTION_STATEMENT',
    SUPPLIER_FINANCIAL_SUMMARY: 'SUPPLIER_FINANCIAL_SUMMARY',
    COMPANY_FINANCIAL_STATEMENT: 'COMPANY_FINANCIAL_STATEMENT',
    TREASURY_STATEMENT: 'TREASURY_STATEMENT',
    FINANCIAL_MOVEMENT_REPORT: 'FINANCIAL_MOVEMENT_REPORT',
    DATE_RANGE_REPORT: 'DATE_RANGE_REPORT',
    PAYMENT_METHOD_REPORT: 'PAYMENT_METHOD_REPORT',
});

export const DOCUMENT_TYPE_VALUES = Object.freeze(Object.values(DOCUMENT_TYPES));

export const OUTPUT_FORMATS = Object.freeze({
    PDF: 'pdf',
    XLSX: 'xlsx',
    CSV: 'csv',
    HTML: 'html',
    PRINT: 'print',
});

export const OUTPUT_FORMAT_VALUES = Object.freeze(Object.values(OUTPUT_FORMATS));

/**
 * The registry. Each entry declares:
 *   - id               : one of DOCUMENT_TYPES
 *   - labelAr          : human-readable Arabic label (for error messages)
 *   - filterSchema     : array of allowed filter keys
 *   - formats          : array of allowed OUTPUT_FORMATS
 *   - fetcherPath      : relative path (no extension) to the fetcher module
 *                        under ../document/fetchers/
 *   - rendererPath     : relative path (no extension) to the renderer module
 *                        under ../document/renderers/
 *   - maxDays          : hard cap for date-range filters (defaults to 365)
 *   - requiresId       : true when the document is for a single record
 *                        (the :id path param is mandatory)
 *
 * Fetchers / renderers are intentionally NOT registered yet — they're added
 * by S2 (shared design system) and S3..S9 (per-document sprints). S1
 * registers only the types and their metadata; calls to a not-yet-implemented
 * fetcher throw a clear `NotImplemented` error.
 */
export const DocumentRegistry = Object.freeze({
    [DOCUMENT_TYPES.SALE_INVOICE]: {
        id: DOCUMENT_TYPES.SALE_INVOICE,
        labelAr: 'فاتورة مبيعات',
        filterSchema: [],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF],
        fetcherPath: '../document/fetchers/saleInvoice.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: null,
        requiresId: true,
    },
    [DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT]: {
        id: DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT,
        labelAr: 'سند تحصيل من عميل',
        filterSchema: [],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF],
        fetcherPath: '../document/fetchers/customerCollectionReceipt.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: null,
        requiresId: true,
    },
    [DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT]: {
        id: DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT,
        labelAr: 'كشف حساب عميل',
        filterSchema: ['from', 'to', 'startDate', 'endDate'],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF, OUTPUT_FORMATS.XLSX],
        fetcherPath: '../document/fetchers/customerAccountStatement.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: true,
    },
    [DOCUMENT_TYPES.CUSTOMER_TRANSACTION_STATEMENT]: {
        id: DOCUMENT_TYPES.CUSTOMER_TRANSACTION_STATEMENT,
        labelAr: 'حركات عميل',
        filterSchema: ['from', 'to', 'startDate', 'endDate', 'type'],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.XLSX, OUTPUT_FORMATS.CSV],
        fetcherPath: '../document/fetchers/customerTransactionStatement.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: true,
    },
    [DOCUMENT_TYPES.CUSTOMER_FINANCIAL_SUMMARY]: {
        id: DOCUMENT_TYPES.CUSTOMER_FINANCIAL_SUMMARY,
        labelAr: 'ملخص مالي للعميل',
        filterSchema: ['from', 'to', 'startDate', 'endDate'],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF],
        fetcherPath: '../document/fetchers/customerFinancialSummary.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: true,
    },
    [DOCUMENT_TYPES.PURCHASE_INVOICE]: {
        id: DOCUMENT_TYPES.PURCHASE_INVOICE,
        labelAr: 'فاتورة مشتريات',
        filterSchema: [],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF],
        fetcherPath: '../document/fetchers/purchaseInvoice.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: null,
        requiresId: true,
    },
    [DOCUMENT_TYPES.SUPPLIER_PAYMENT_RECEIPT]: {
        id: DOCUMENT_TYPES.SUPPLIER_PAYMENT_RECEIPT,
        labelAr: 'سند سداد لمورد',
        filterSchema: [],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF],
        fetcherPath: '../document/fetchers/supplierPaymentReceipt.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: null,
        requiresId: true,
    },
    [DOCUMENT_TYPES.SUPPLIER_ACCOUNT_STATEMENT]: {
        id: DOCUMENT_TYPES.SUPPLIER_ACCOUNT_STATEMENT,
        labelAr: 'كشف حساب مورد',
        filterSchema: ['from', 'to', 'startDate', 'endDate'],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF, OUTPUT_FORMATS.XLSX],
        fetcherPath: '../document/fetchers/supplierAccountStatement.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: true,
    },
    [DOCUMENT_TYPES.SUPPLIER_TRANSACTION_STATEMENT]: {
        id: DOCUMENT_TYPES.SUPPLIER_TRANSACTION_STATEMENT,
        labelAr: 'حركات مورد',
        filterSchema: ['from', 'to', 'startDate', 'endDate', 'type'],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.XLSX, OUTPUT_FORMATS.CSV],
        fetcherPath: '../document/fetchers/supplierTransactionStatement.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: true,
    },
    [DOCUMENT_TYPES.SUPPLIER_FINANCIAL_SUMMARY]: {
        id: DOCUMENT_TYPES.SUPPLIER_FINANCIAL_SUMMARY,
        labelAr: 'ملخص مالي للمورد',
        filterSchema: ['from', 'to', 'startDate', 'endDate'],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF],
        fetcherPath: '../document/fetchers/supplierFinancialSummary.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: true,
    },
    [DOCUMENT_TYPES.COMPANY_FINANCIAL_STATEMENT]: {
        id: DOCUMENT_TYPES.COMPANY_FINANCIAL_STATEMENT,
        labelAr: 'كشف حركة الشركة',
        filterSchema: [
            'from', 'to', 'startDate', 'endDate',
            'type', 'method', 'treasuryChannel',
            'customerId', 'supplierId',
            'referenceType', 'referenceNumber',
            'amountMin', 'amountMax',
            'createdBy', 'search',
        ],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF, OUTPUT_FORMATS.XLSX, OUTPUT_FORMATS.CSV],
        fetcherPath: '../document/fetchers/companyFinancialStatement.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: false,
    },
    [DOCUMENT_TYPES.TREASURY_STATEMENT]: {
        id: DOCUMENT_TYPES.TREASURY_STATEMENT,
        labelAr: 'كشف حركة الخزينة',
        filterSchema: ['from', 'to', 'startDate', 'endDate'],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF, OUTPUT_FORMATS.XLSX],
        fetcherPath: '../document/fetchers/treasuryStatement.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: false,
    },
    [DOCUMENT_TYPES.FINANCIAL_MOVEMENT_REPORT]: {
        id: DOCUMENT_TYPES.FINANCIAL_MOVEMENT_REPORT,
        labelAr: 'قائمة الدخل',
        filterSchema: ['from', 'to', 'startDate', 'endDate'],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF, OUTPUT_FORMATS.XLSX],
        fetcherPath: '../document/fetchers/financialMovementReport.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: false,
    },
    [DOCUMENT_TYPES.DATE_RANGE_REPORT]: {
        id: DOCUMENT_TYPES.DATE_RANGE_REPORT,
        labelAr: 'تقرير فترة مخصصة',
        filterSchema: ['from', 'to', 'startDate', 'endDate'],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF, OUTPUT_FORMATS.XLSX],
        fetcherPath: '../document/fetchers/dateRangeReport.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: false,
    },
    [DOCUMENT_TYPES.PAYMENT_METHOD_REPORT]: {
        id: DOCUMENT_TYPES.PAYMENT_METHOD_REPORT,
        labelAr: 'تقرير طرق الدفع',
        filterSchema: ['from', 'to', 'startDate', 'endDate'],
        formats: [OUTPUT_FORMATS.PRINT, OUTPUT_FORMATS.PDF, OUTPUT_FORMATS.XLSX],
        fetcherPath: '../document/fetchers/paymentMethodReport.js',
        rendererPath: '../document/renderers/index.js',
        maxDays: 365,
        requiresId: false,
    },
});

/**
 * Look up a registered document type. Throws NotFoundError when the type
 * is unknown — keeps the API surface safe against typos / injection.
 *
 * @param {string} type
 * @returns {object} the registry entry
 */
export function getDocumentEntry(type) {
    const entry = DocumentRegistry[type];
    if (!entry) {
        throw new NotFoundError(`نوع المستند غير مدعوم: ${type}`);
    }
    return entry;
}

/**
 * Validate that every key in `filters` is in the entry's filterSchema.
 * Throws BadRequestError otherwise (SEC-DOC-FILTER).
 *
 * @param {object} entry   the registry entry
 * @param {object} filters the request's filter object
 */
export function validateFilters(entry, filters) {
    if (!filters || typeof filters !== 'object') return;
    const allowed = new Set(entry.filterSchema);
    for (const key of Object.keys(filters)) {
        if (!allowed.has(key)) {
            throw new BadRequestError(`مرشح غير مدعوم: ${key}`);
        }
    }
}

/**
 * List all registered types with their metadata — useful for admin
 * dashboards and the frontend's "available formats" lookup.
 */
export function listDocumentTypes() {
    return Object.values(DocumentRegistry).map((e) => ({
        id: e.id,
        labelAr: e.labelAr,
        formats: e.formats.slice(),
        requiresId: e.requiresId,
        maxDays: e.maxDays,
    }));
}
