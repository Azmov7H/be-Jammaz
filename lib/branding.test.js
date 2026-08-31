/**
 * T-UNIT-DOC-001 / T-UNIT-DS-001..003 — branding helper + DocumentService.
 *
 * Unit-tests the parts of Sprint 1 that don't need a real database.
 * The branding helper is exercised with a stubbed InvoiceSettings model.
 * The DocumentService is exercised with stubbed fetcher modules.
 */

// Set MONGODB_URI before any module that depends on lib/db.js is imported.
// (vi.mock calls are hoisted to the top, so env-var assignment MUST come first.)
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

// Mock lib/db.js so importing branding.js (via LogService etc.) doesn't throw.
vi.mock('./db.js', () => ({
    default: async () => ({ connection: { readyState: 1 } }),
}));

// vi.hoisted gives us a stable, mutable mock instance that the
// vi.mock factory can reference. vi.fn() called inside vi.hoisted
// runs at hoist time alongside vi.mock.
const mocks = vi.hoisted(() => ({
    getSettingsMock: vi.fn(),
}));

// Mock the InvoiceSettings model BEFORE importing the branding helper.
// Path MUST match what branding.js imports: '../models/InvoiceSettings.js'.
vi.mock('../models/InvoiceSettings.js', () => ({
    default: {
        getSettings: (...args) => mocks.getSettingsMock(...args),
    },
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
const { getSettingsMock } = mocks;
const branding = await import('./branding.js');

describe('getBranding', () => {
    beforeEach(() => {
        branding.invalidateBrandingCache();
        getSettingsMock.mockReset();
    });

    it('returns the defaults when the settings doc is missing', async () => {
        getSettingsMock.mockResolvedValue(null);
        const b = await branding.getBranding();
        expect(b.companyName).toBe('شركتكم');
        expect(b.primaryColor).toBe('#1B3C73');
        expect(b.footerText).toContain('شكراً');
        expect(b.showLogo).toBe(true);
    });

    it('overlays stored values on top of the defaults', async () => {
        getSettingsMock.mockResolvedValue({
            companyName: 'مؤسستي',
            primaryColor: '#ff00ff',
            showLogo: false,
            additionalPhones: ['010', '011'],
            footerText: 'شكراً',
        });
        const b = await branding.getBranding();
        expect(b.companyName).toBe('مؤسستي');
        expect(b.primaryColor).toBe('#ff00ff');
        expect(b.showLogo).toBe(false);
        expect(b.additionalPhones).toEqual(['010', '011']);
        // unspecified fields fall through to defaults
        expect(b.headerBgColor).toBe('#1B3C73');
    });

    it('caches the result across calls (DB hit only once per TTL window)', async () => {
        getSettingsMock.mockResolvedValue({ companyName: 'A' });
        await branding.getBranding();
        await branding.getBranding();
        await branding.getBranding();
        expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    it('invalidateBrandingCache forces a re-read', async () => {
        getSettingsMock.mockResolvedValue({ companyName: 'A' });
        await branding.getBranding();
        branding.invalidateBrandingCache();
        getSettingsMock.mockResolvedValue({ companyName: 'B' });
        const b = await branding.getBranding();
        expect(b.companyName).toBe('B');
        expect(getSettingsMock).toHaveBeenCalledTimes(2);
    });

    it('returns defaults when the DB call throws', async () => {
        getSettingsMock.mockRejectedValue(new Error('mongo down'));
        const b = await branding.getBranding();
        expect(b.companyName).toBe('شركتكم');
    });

    it('exposes the constants bag for tests (read-only)', () => {
        expect(branding.__brandingDefaults.companyName).toBe('شركتكم');
    });
});

// --- DocumentService (buildFilename only) -----------------------------------
//
// The other DocumentService methods (getData / render) are covered by
// lib/documentRoutes.test.js and the Sprint 14 integration tests.
// Here we only need to verify that buildFilename is a pure function and
// survives a real module load (this catches accidental coupling to
// InvoiceSettings / LogService at module-load time).

const { DocumentService } = await import('../document/index.js');
const { DOCUMENT_TYPES } = await import('./documentRegistry.js');

describe('DocumentService.buildFilename', () => {
    it('includes the type, id, and date', () => {
        const fn = DocumentService.buildFilename(
            DOCUMENT_TYPES.SALE_INVOICE,
            'a'.repeat(24),
            'pdf'
        );
        expect(fn).toMatch(/^SALE_INVOICE_[a-f0-9]{24}_\d{4}-\d{2}-\d{2}\.pdf$/);
    });

    it('omits the id segment for aggregate documents', () => {
        const fn = DocumentService.buildFilename(
            DOCUMENT_TYPES.COMPANY_FINANCIAL_STATEMENT,
            null,
            'xlsx'
        );
        expect(fn).toMatch(/^COMPANY_FINANCIAL_STATEMENT_\d{4}-\d{2}-\d{2}\.xlsx$/);
    });

    it('uses today\'s date in YYYY-MM-DD form', () => {
        const fn = DocumentService.buildFilename(
            DOCUMENT_TYPES.SALE_INVOICE,
            'a'.repeat(24),
            'pdf'
        );
        const today = new Date().toISOString().slice(0, 10);
        expect(fn).toContain(today);
    });
});
