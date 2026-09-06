import { describe, it, expect } from 'vitest';

import { visual, visualOrder } from './text.js';

const CASES = [
    ["\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0634\u062a\u0631\u064a\u0627\u062a", "text", '\ufe97\ufe8e\ufef3\ufeae\ufe97\ufeb8\ufee2\u0020\ufe93\ufead\ufeed\ufe97\ufe8e\ufed1'],
    ["\u0628\u0645\u0628\u0644\u063a 500 \u062c\u0646\u064a\u0647", "text", '\ufeeb\ufef4\ufee8\ufe9e\u0020\u0035\u0030\u0030\u0020\ufecf\ufee0\ufe92\ufee4\ufe90'],
    ["\u0631\u0635\u064a\u062f 1,250.50 \u062c.\u0645", "text", '\ufee1\u002e\ufe9d\u0020\u0031\u002c\u0032\u0035\u0030\u002e\u0035\u0030\u0020\ufea9\ufef3\ufebc\ufeae'],
    ["\u0641\u0627\u062a\u0648\u0631\u0629 PO-100", "text", '\u0031\u0030\u0030\u002d\u0050\u004f\u0020\ufe93\ufead\ufeed\ufe97\ufe8e\ufed1'],
    ["\u0627\u0646\u0633\u062a\u0627 \u0628\u0627\u064a instapay", "text", '\u0069\u006e\u0073\u0074\u0061\u0070\u0061\u0079\u0020\ufef3\ufe8e\ufe8f\u0020\ufe8d\ufe97\ufeb4\ufee8\ufe8e'],
    ["\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0627\u0633\u062a\u062e\u0631\u0627\u062c: 2026-09-06", "text", '\u0032\u0030\u0032\u0036\u002d\u0030\u0039\u002d\u0030\u0036\u0020\u003a\ufe9f\ufe8e\ufead\ufea7\ufe98\ufeb4\ufe8e\ufefb\u0020\ufea7\ufef4\ufeae\ufe8d\ufe95'],
    ["\u0645\u0644\u0627\u062d\u0638\u0627\u062a (\u0639\u0627\u062c\u0644)", "text", '\u0028\ufedf\ufea0\ufe8e\ufec9\u0029\u0020\ufe97\ufe8e\ufec7\ufea4\ufe8e\ufedf\ufee2'],
    ["\u062e\u0635\u0645 10%", "text", '\u0031\u0030\u0025\u0020\ufee3\ufebc\ufea6'],
    ["\u0627\u0644\u0641\u062a\u0631\u0629: 2026-09-01 \u2013 2026-09-06", "text", '\u0032\u0030\u0032\u0036\u002d\u0030\u0039\u002d\u0030\u0036\u0020\u2013\u0020\u0032\u0030\u0032\u0036\u002d\u0030\u0039\u002d\u0030\u0031\u0020\u003a\ufe93\ufead\ufe97\ufed4\ufefc'],
    ["\u062a\u062d\u0635\u064a\u0644 \u0645\u0646 \u0627\u0644\u0639\u0645\u064a\u0644 \u0623\u062d\u0645\u062f PO-100", "text", '\u0031\u0030\u0030\u002d\u0050\u004f\u0020\ufea9\ufee3\ufea4\ufe84\u0020\ufedf\ufef4\ufee4\ufecc\ufefc\u0020\ufee7\ufee2\u0020\ufedf\ufef4\ufebc\ufea4\ufe96'],
    ["\u0633\u062f\u0627\u062f \u0644\u0645\u0648\u0631\u062f \u0627\u0644\u0623\u0645\u0644 (\u0639\u0627\u062c\u0644) \u062e\u0635\u0645 10%", "text", '\u0031\u0030\u0025\u0020\ufee3\ufebc\ufea6\u0020\u0028\ufedf\ufea0\ufe8e\ufec9\u0029\u0020\ufedf\ufee4\ufe84\ufefb\u0020\ufea9\ufead\ufeed\ufee3\ufede\u0020\ufea9\ufe8d\ufea9\ufeb1'],
    ["\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0648\u0627\u0631\u062f: 1,250.5", "text", '\u0031\u002c\u0032\u0035\u0030\u002e\u0035\u0020\u003a\ufea9\ufead\ufe8d\ufeed\ufefb\u0020\ufef3\ufefc\ufee3\ufea0\ufe88'],
    ["2026-09-06", "date", '\u0032\u0030\u0032\u0036\u002d\u0030\u0039\u002d\u0030\u0036'],
    ["PO-100", "id", '\u0050\u004f\u002d\u0031\u0030\u0030'],
    ["RC-7", "id", '\u0052\u0043\u002d\u0037'],
    ["-1,250", "money", '\u002d\u0031\u002c\u0032\u0035\u0030'],
];
describe('visual', () => {
    it.each(CASES)('visual(%s, %s)', (input, role, expected) => {
        expect(visual(input, role)).toBe(expected);
    });

    it('leaves pure Latin byte-identical', () => {
        expect(visual('PO-100', 'id')).toBe('PO-100');
        expect(visual('RC-7', 'id')).toBe('RC-7');
        expect(visual('2026-09-06', 'date')).toBe('2026-09-06');
        expect(visual('1,250.50', 'money')).toBe('1,250.50');
    });

    it('normalizes Arabic-Indic digits for digit roles', () => {
        expect(visual('\u0661\u0662\u0663', 'money')).toBe('123');
    });

    it('substitutes uncovered glyphs', () => {
        expect(visual('a \u2190 b')).toBe('a \u2013 b');
        expect(visual('\u2192')).toBe('\u2013');
    });

    it('returns empty for empty input', () => {
        expect(visual('')).toBe('');
        expect(visual(null)).toBe('');
        expect(visual(undefined)).toBe('');
    });

    it('never leaks isolates', () => {
        for (const [input, role] of CASES.map(([i, r]) => [i, r])) {
            expect(visual(input, role)).not.toMatch(/[\u2066\u2069]/);
        }
    });

    it('keeps newlines as line breaks', () => {
        const v = visual('سطر أول\nسطر ثاني');
        expect(v.includes('\n')).toBe(true);
        expect(v.split('\n')).toHaveLength(2);
    });
});

describe('visualOrder', () => {
    it('keeps logical order for pure Latin', () => {
        expect(visualOrder('PO-100')).toBe('PO-100');
    });
});
