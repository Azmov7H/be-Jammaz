/**
 * T-UNIT-DOC-002 — Document registry sanity check.
 *
 * Mirrors the existing lib/validators.test.js style (vitest + plain objects,
 * no DB).
 */

import { describe, it, expect } from 'vitest';
import {
    DOCUMENT_TYPES,
    DOCUMENT_TYPE_VALUES,
    OUTPUT_FORMATS,
    OUTPUT_FORMAT_VALUES,
    DocumentRegistry,
    getDocumentEntry,
    validateFilters,
    listDocumentTypes,
} from './documentRegistry.js';

describe('DocumentRegistry — constants', () => {
    it('exposes the 15 expected document types', () => {
        const expected = [
            'SALE_INVOICE',
            'CUSTOMER_COLLECTION_RECEIPT',
            'CUSTOMER_ACCOUNT_STATEMENT',
            'CUSTOMER_TRANSACTION_STATEMENT',
            'CUSTOMER_FINANCIAL_SUMMARY',
            'PURCHASE_INVOICE',
            'SUPPLIER_PAYMENT_RECEIPT',
            'SUPPLIER_ACCOUNT_STATEMENT',
            'SUPPLIER_TRANSACTION_STATEMENT',
            'SUPPLIER_FINANCIAL_SUMMARY',
            'COMPANY_FINANCIAL_STATEMENT',
            'TREASURY_STATEMENT',
            'FINANCIAL_MOVEMENT_REPORT',
            'DATE_RANGE_REPORT',
            'PAYMENT_METHOD_REPORT',
        ];
        for (const id of expected) {
            expect(DOCUMENT_TYPES[id]).toBe(id);
        }
        expect(Object.keys(DOCUMENT_TYPES).length).toBe(expected.length);
        expect(DOCUMENT_TYPE_VALUES.length).toBe(expected.length);
    });

    it('exposes the 5 expected output formats', () => {
        expect(OUTPUT_FORMATS.PDF).toBe('pdf');
        expect(OUTPUT_FORMATS.XLSX).toBe('xlsx');
        expect(OUTPUT_FORMATS.CSV).toBe('csv');
        expect(OUTPUT_FORMATS.HTML).toBe('html');
        expect(OUTPUT_FORMATS.PRINT).toBe('print');
        // OUTPUT_FORMAT_VALUES is frozen, so we copy before sorting.
        const sorted = [...OUTPUT_FORMAT_VALUES].sort();
        expect(sorted).toEqual(['csv', 'html', 'pdf', 'print', 'xlsx']);
    });
});

describe('DocumentRegistry — entries', () => {
    it('every entry has the required metadata fields', () => {
        for (const entry of Object.values(DocumentRegistry)) {
            expect(entry.id).toBeTruthy();
            expect(entry.labelAr).toBeTruthy();
            expect(Array.isArray(entry.filterSchema)).toBe(true);
            expect(Array.isArray(entry.formats)).toBe(true);
            expect(entry.fetcherPath).toMatch(/^(\.\.\/)+document\/fetchers\//);
            expect(typeof entry.requiresId).toBe('boolean');
        }
    });

    it('every entry only lists supported formats', () => {
        for (const entry of Object.values(DocumentRegistry)) {
            for (const fmt of entry.formats) {
                expect(OUTPUT_FORMAT_VALUES).toContain(fmt);
            }
        }
    });

    it('every entry that requires an id is id-driven', () => {
        for (const entry of Object.values(DocumentRegistry)) {
            if (entry.requiresId) {
                // id-driven docs MUST allow PDF or PRINT.
                const hasOutput = entry.formats.some(
                    (f) => f === OUTPUT_FORMATS.PDF || f === OUTPUT_FORMATS.PRINT
                );
                expect(hasOutput).toBe(true);
            }
        }
    });

    it('single-record documents always require an id', () => {
        const idDriven = [
            DOCUMENT_TYPES.SALE_INVOICE,
            DOCUMENT_TYPES.CUSTOMER_COLLECTION_RECEIPT,
            DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT,
            DOCUMENT_TYPES.CUSTOMER_TRANSACTION_STATEMENT,
            DOCUMENT_TYPES.CUSTOMER_FINANCIAL_SUMMARY,
            DOCUMENT_TYPES.PURCHASE_INVOICE,
            DOCUMENT_TYPES.SUPPLIER_PAYMENT_RECEIPT,
            DOCUMENT_TYPES.SUPPLIER_ACCOUNT_STATEMENT,
            DOCUMENT_TYPES.SUPPLIER_TRANSACTION_STATEMENT,
            DOCUMENT_TYPES.SUPPLIER_FINANCIAL_SUMMARY,
        ];
        for (const id of idDriven) {
            expect(DocumentRegistry[id].requiresId).toBe(true);
        }
    });

    it('multi-record documents do not require an id', () => {
        const aggregate = [
            DOCUMENT_TYPES.COMPANY_FINANCIAL_STATEMENT,
            DOCUMENT_TYPES.TREASURY_STATEMENT,
            DOCUMENT_TYPES.FINANCIAL_MOVEMENT_REPORT,
            DOCUMENT_TYPES.DATE_RANGE_REPORT,
            DOCUMENT_TYPES.PAYMENT_METHOD_REPORT,
        ];
        for (const id of aggregate) {
            expect(DocumentRegistry[id].requiresId).toBe(false);
        }
    });

    it('every filterable document caps at 365 days', () => {
        for (const entry of Object.values(DocumentRegistry)) {
            if (entry.filterSchema.length > 0) {
                expect(entry.maxDays).toBe(365);
            }
        }
    });
});

describe('getDocumentEntry', () => {
    it('returns the entry for a known type', () => {
        const e = getDocumentEntry(DOCUMENT_TYPES.SALE_INVOICE);
        expect(e.id).toBe(DOCUMENT_TYPES.SALE_INVOICE);
    });

    it('throws NotFoundError for an unknown type', () => {
        expect(() => getDocumentEntry('NOT_A_REAL_DOC')).toThrow(/غير مدعوم/);
    });
});

describe('validateFilters (SEC-DOC-FILTER)', () => {
    it('passes when all filter keys are allowed', () => {
        const entry = DocumentRegistry[DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT];
        expect(() =>
            validateFilters(entry, { from: '2026-01-01', to: '2026-12-31' })
        ).not.toThrow();
    });

    it('rejects unknown filter keys', () => {
        const entry = DocumentRegistry[DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT];
        expect(() =>
            validateFilters(entry, { $where: 'evil' })
        ).toThrow(/مرشح غير مدعوم/);
    });

    it('rejects injection-style nested keys', () => {
        const entry = DocumentRegistry[DOCUMENT_TYPES.COMPANY_FINANCIAL_STATEMENT];
        expect(() =>
            validateFilters(entry, { customerId: 'abc', $or: [{ evil: 1 }] })
        ).toThrow(/مرشح غير مدعوم/);
    });

    it('no-op when filters is missing or empty', () => {
        const entry = DocumentRegistry[DOCUMENT_TYPES.SALE_INVOICE];
        expect(() => validateFilters(entry, null)).not.toThrow();
        expect(() => validateFilters(entry, undefined)).not.toThrow();
        expect(() => validateFilters(entry, {})).not.toThrow();
    });
});

describe('listDocumentTypes', () => {
    it('returns one entry per registered type, with no internals', () => {
        const list = listDocumentTypes();
        expect(list.length).toBe(Object.keys(DocumentRegistry).length);
        for (const item of list) {
            expect(item).toHaveProperty('id');
            expect(item).toHaveProperty('labelAr');
            expect(item).toHaveProperty('formats');
            expect(item).toHaveProperty('requiresId');
            expect(item).toHaveProperty('maxDays');
            // The internal fetcherPath / rendererPath MUST NOT leak.
            expect(item).not.toHaveProperty('fetcherPath');
            expect(item).not.toHaveProperty('rendererPath');
            expect(item).not.toHaveProperty('filterSchema');
        }
    });
});
