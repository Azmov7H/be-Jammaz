import { describe, it, expect } from 'vitest';
import { escapeRegExp, literalContains } from '../lib/safeRegex.js';

describe('T-PERF-05: safeRegex', () => {
    it('escapes all regex metacharacters', () => {
        expect(escapeRegExp('a.b*c?d[e]f(g)h{i}j$k^l|m\\n')).toBe(
            'a\\.b\\*c\\?d\\[e\\]f\\(g\\)h\\{i\\}j\\$k\\^l\\|m\\\\n'
        );
    });

    it('neutralizes injection payloads as literals', () => {
        const q = literalContains('.*.*.*)(?:$)');
        // must not throw when compiled
        expect(() => new RegExp(q.$regex)).not.toThrow();
        const re = new RegExp(q.$regex, 'i');
        expect(re.test('price .*.*.*)(?:$) here')).toBe(true);
        expect(re.test('nothing matches')).toBe(false);
    });

    it('handles null/undefined input without throwing', () => {
        expect(literalContains(null).$regex).toBe('');
        expect(literalContains(undefined).$options).toBe('i');
    });
});
