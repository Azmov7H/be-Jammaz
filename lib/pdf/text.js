import bidiFactory from 'bidi-js';
import ArabicReshaper from 'arabic-reshaper';
import { hasGlyph } from './fonts.js';

const bidi = bidiFactory();

const BASE_DIRECTION = 'rtl';

const SUBSTITUTES = new Map([
    [0x2190, '–'],
    [0x2192, '–'],
    [0x2194, '–'],
]);

const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g;
const DIGIT_ROLES = new Set(['money', 'id', 'date']);
const ISOLATES_RE = /[\u2066\u2069]/g;
const NUM_RUN_RE = /[0-9\u0660-\u0669][0-9\u0660-\u0669.,:/\-–%]*/g;
const LRI = '\u2066';
const PDI = '\u2069';

function toAsciiDigits(value) {
    return String(value).replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
}

function guardGlyphs(visual) {
    let out = '';
    for (const ch of visual) {
        const cp = ch.codePointAt(0);
        if (hasGlyph(cp)) {
            out += ch;
            continue;
        }
        const sub = SUBSTITUTES.get(cp);
        if (sub !== undefined) out += sub;
    }
    return out;
}

export function visualOrder(logical) {
    const input = String(logical ?? '');
    if (!input) return '';
    const info = bidi.getEmbeddingLevels(input, BASE_DIRECTION);
    const flips = bidi.getReorderSegments(input, info);
    const arr = [...input].map((ch, i) => ({ ch, rtl: (info.levels[i] & 1) === 1 }));
    for (const [start, end] of flips) {
        const slice = arr.slice(start, end + 1).reverse();
        for (let i = 0; i < slice.length; i++) arr[start + i] = slice[i];
    }
    const runs = [];
    for (const item of arr) {
        const last = runs[runs.length - 1];
        if (last && last.rtl === item.rtl) last.text += mirror(item);
        else runs.push({ rtl: item.rtl, text: mirror(item) });
    }
    return runs.map((r) => (r.rtl ? ArabicReshaper.convertArabic(r.text) : r.text)).join('');
}

function mirror({ ch, rtl }) {
    if (!rtl) return ch;
    return bidi.getMirroredCharacter(ch, ch) ?? ch;
}

export function visual(logical, role = 'text') {
    let input = DIGIT_ROLES.has(role) ? toAsciiDigits(logical) : String(logical ?? '');
    if (!input) return '';
    input = input.replace(NUM_RUN_RE, (m) => LRI + m + PDI);
    if (DIGIT_ROLES.has(role)) input = LRI + input + PDI;
    return input
        .split(/\r?\n/)
        .map((line) => guardGlyphs(visualOrder(line).replace(ISOLATES_RE, '')))
        .join('\n');
}
