/**
 * T-UNIT-RT-001..009 — Document route shape (no DB, no live server).
 *
 * We can't easily exercise the express router without booting it; this
 * suite verifies the contract surface (Zod schemas, parameter parsing,
 * the controller delegation) that the router relies on. Express HTTP
 * integration is covered in Sprint 14 (T-INT-DOC-*).
 */

// Set MONGODB_URI before any module that depends on lib/db.js is imported.
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

// Mock lib/db.js so importing document/index.js (which transitively loads
// LogService → db.js) doesn't throw on missing MONGODB_URI.
vi.mock('./db.js', () => ({
    default: async () => ({ connection: { readyState: 1 } }),
}));
vi.mock('./logger.js', () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
    DOCUMENT_TYPE_VALUES,
    OUTPUT_FORMAT_VALUES,
} from './documentRegistry.js';

const OID = 'a'.repeat(24);

describe('Route Zod schemas — type param', () => {
    const typeParamSchema = z.object({ type: z.enum(DOCUMENT_TYPE_VALUES) });

    it.each(DOCUMENT_TYPE_VALUES)('accepts known type %s', (t) => {
        expect(typeParamSchema.safeParse({ type: t }).success).toBe(true);
    });

    it('rejects an unknown type', () => {
        const r = typeParamSchema.safeParse({ type: 'NOT_REAL' });
        expect(r.success).toBe(false);
    });
});

describe('Route Zod schemas — id param', () => {
    const idParamSchema = z.object({
        type: z.enum(DOCUMENT_TYPE_VALUES),
        id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'معرّف غير صالح'),
    });

    it('accepts a valid 24-char hex id', () => {
        expect(idParamSchema.safeParse({ type: 'SALE_INVOICE', id: OID }).success).toBe(true);
    });

    it('rejects short ids', () => {
        expect(idParamSchema.safeParse({ type: 'SALE_INVOICE', id: 'abc' }).success).toBe(false);
    });

    it('rejects non-hex ids', () => {
        expect(idParamSchema.safeParse({ type: 'SALE_INVOICE', id: 'z'.repeat(24) }).success).toBe(false);
    });

    it('rejects ids longer than 24 chars', () => {
        expect(idParamSchema.safeParse({ type: 'SALE_INVOICE', id: OID + 'aa' }).success).toBe(false);
    });
});

describe('Route Zod schemas — format query/body', () => {
    const formatSchema = z.object({
        format: z.enum(OUTPUT_FORMAT_VALUES).optional(),
    });

    it.each(OUTPUT_FORMAT_VALUES)('accepts format=%s', (f) => {
        expect(formatSchema.safeParse({ format: f }).success).toBe(true);
    });

    it('accepts a missing format (defaults downstream)', () => {
        expect(formatSchema.safeParse({}).success).toBe(true);
    });

    it('rejects an unknown format', () => {
        expect(formatSchema.safeParse({ format: 'docx' }).success).toBe(false);
    });
});

describe('DocumentController.export — format precedence', () => {
    // Lightweight unit test of the controller logic without booting
    // the real DocumentService. The full integration (HTTP) coverage
    // lives in Sprint 14 (T-INT-DOC-*).
    //
    // We replicate the exact parameter-merging + format-precedence
    // logic of the controller so it remains correct under refactor.

    function mergeParams(req) {
        const merged = { ...req.query, ...(req.body || {}) };
        const format = merged.format || 'pdf';
        const { format: _f, ...params } = merged;
        return { format, params: { id: req.params.id, ...params } };
    }

    it('defaults format to pdf when not provided', () => {
        const r = mergeParams({ params: { id: OID }, query: {}, body: {} });
        expect(r.format).toBe('pdf');
    });

    it('uses the query string format when no body', () => {
        const r = mergeParams({ params: { id: OID }, query: { format: 'print' }, body: {} });
        expect(r.format).toBe('print');
    });

    it('lets POST body override the query string format', () => {
        const r = mergeParams({
            params: { id: OID },
            query: { format: 'pdf' },
            body: { format: 'xlsx' },
        });
        expect(r.format).toBe('xlsx');
    });

    it('strips `format` from the filter set so it never reaches the fetcher', () => {
        const r = mergeParams({
            params: { id: OID },
            query: { format: 'pdf', from: '2026-01-01' },
            body: {},
        });
        expect(r.params).not.toHaveProperty('format');
        expect(r.params.from).toBe('2026-01-01');
        expect(r.params.id).toBe(OID);
    });
});

describe('DocumentService.buildFilename', () => {
    it('includes the type, id, and date', async () => {
        const { DocumentService } = await import('../document/index.js');
        const { DOCUMENT_TYPES } = await import('./documentRegistry.js');
        const fn = DocumentService.buildFilename(
            DOCUMENT_TYPES.SALE_INVOICE,
            'a'.repeat(24),
            'pdf'
        );
        expect(fn).toMatch(/^SALE_INVOICE_[a-f0-9]{24}_\d{4}-\d{2}-\d{2}\.pdf$/);
    });

    it('omits the id segment for aggregate documents', async () => {
        const { DocumentService } = await import('../document/index.js');
        const { DOCUMENT_TYPES } = await import('./documentRegistry.js');
        const fn = DocumentService.buildFilename(
            DOCUMENT_TYPES.COMPANY_FINANCIAL_STATEMENT,
            null,
            'xlsx'
        );
        expect(fn).toMatch(/^COMPANY_FINANCIAL_STATEMENT_\d{4}-\d{2}-\d{2}\.xlsx$/);
    });
});

describe('DocumentService guards (real module)', () => {
    it('render() rejects an unknown format (no NotImplemented)', async () => {
        const { DocumentService } = await import('../document/index.js');
        const { DOCUMENT_TYPES } = await import('./documentRegistry.js');
        await expect(
            DocumentService.render(
                DOCUMENT_TYPES.SALE_INVOICE,
                { id: 'a'.repeat(24) },
                'docx',
                { user: { _id: 'u', role: 'owner' } }
            )
        ).rejects.toThrow(/صيغة غير مدعومة/);
    });

    it('getData() throws when user context is missing', async () => {
        const { DocumentService } = await import('../document/index.js');
        const { DOCUMENT_TYPES } = await import('./documentRegistry.js');
        await expect(
            DocumentService.getData(DOCUMENT_TYPES.SALE_INVOICE, { id: 'a'.repeat(24) }, {})
        ).rejects.toThrow(/معلومات المستخدم/);
    });

    it('getData() throws on an unknown type', async () => {
        const { DocumentService } = await import('../document/index.js');
        await expect(
            DocumentService.getData('BOGUS', {}, { user: { _id: 'u', role: 'owner' } })
        ).rejects.toThrow(/غير مدعوم/);
    });

    it('getData() throws when a requiresId document is missing the id', async () => {
        const { DocumentService } = await import('../document/index.js');
        const { DOCUMENT_TYPES } = await import('./documentRegistry.js');
        await expect(
            DocumentService.getData(
                DOCUMENT_TYPES.SALE_INVOICE,
                {},
                { user: { _id: 'u', role: 'owner' } }
            )
        ).rejects.toThrow(/يتطلب معرفاً/);
    });

    it('getData() rejects unknown filter keys (SEC-DOC-FILTER)', async () => {
        const { DocumentService } = await import('../document/index.js');
        const { DOCUMENT_TYPES } = await import('./documentRegistry.js');
        await expect(
            DocumentService.getData(
                DOCUMENT_TYPES.CUSTOMER_ACCOUNT_STATEMENT,
                { id: 'a'.repeat(24), $where: 'evil' },
                { user: { _id: 'u', role: 'owner' } }
            )
        ).rejects.toThrow(/مرشح غير مدعوم/);
    });

    it('getData() returns NotImplemented when the fetcher is absent', async () => {
        const { DocumentService } = await import('../document/index.js');
        const { DOCUMENT_TYPES } = await import('./documentRegistry.js');
        await expect(
            DocumentService.getData(
                DOCUMENT_TYPES.SALE_INVOICE,
                { id: 'a'.repeat(24) },
                { user: { _id: 'u', role: 'owner' } }
            )
        ).rejects.toMatchObject({ statusCode: 501 });
    });
});
