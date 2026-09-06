import { describe, it, expect } from 'vitest';

import { loadPdfFonts, fontFor, isRtl, hasGlyph, FONT_PATHS } from './fonts.js';

describe('loadPdfFonts', () => {
    it('loads both Amiri faces and caches them', () => {
        const first = loadPdfFonts();
        expect(first.regular).toBeTruthy();
        expect(first.bold).toBeTruthy();
        expect(loadPdfFonts()).toBe(first);
    });

    it('points at vendored assets', () => {
        expect(FONT_PATHS.regular).toMatch(/Amiri-Regular\.ttf$/);
        expect(FONT_PATHS.bold).toMatch(/Amiri-Bold\.ttf$/);
    });
});

describe('fontFor', () => {
    it('routes RTL strings to Amiri', () => {
        expect(fontFor('فاتورة')).toBe('ar');
        expect(fontFor('فاتورة', true)).toBe('ar-bold');
    });

    it('keeps Latin on base fonts', () => {
        expect(fontFor('PO-100')).toBe('latin');
        expect(fontFor('PO-100', true)).toBe('latin-bold');
        expect(fontFor('1,250.50')).toBe('latin');
    });

    it('treats mixed strings as RTL', () => {
        expect(fontFor('فاتورة PO-100')).toBe('ar');
    });
});

describe('isRtl', () => {
    it('detects Arabic script and presentation forms', () => {
        expect(isRtl('فاتورة')).toBe(true);
        expect(isRtl('ﺓﺭﻮﺗﺎﻓ')).toBe(true);
        expect(isRtl('PO-100')).toBe(false);
        expect(isRtl('')).toBe(false);
        expect(isRtl(null)).toBe(false);
    });
});

describe('hasGlyph', () => {
    it('covers Arabic, Latin and common punctuation', () => {
        expect(hasGlyph(0x062D)).toBe(true);
        expect(hasGlyph(0x0665)).toBe(true);
        expect(hasGlyph(0x0041)).toBe(true);
        expect(hasGlyph(0x0028)).toBe(true);
        expect(hasGlyph(0x2013)).toBe(true);
    });

    it('rejects the arrow used by legacy treasury headers', () => {
        expect(hasGlyph(0x2190)).toBe(false);
    });
});
