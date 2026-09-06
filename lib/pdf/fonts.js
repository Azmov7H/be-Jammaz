import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSync } from 'fontkit';
import { AppError } from '../errors.js';

const FONTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');

export const FONT_PATHS = {
    regular: path.join(FONTS_DIR, 'Amiri-Regular.ttf'),
    bold: path.join(FONTS_DIR, 'Amiri-Bold.ttf'),
};

export const RTL_PATTERN = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

let loaded = null;

export function loadPdfFonts() {
    if (loaded) return loaded;
    let regular;
    let bold;
    try {
        regular = openSync(FONT_PATHS.regular);
        bold = openSync(FONT_PATHS.bold);
    } catch {
        throw new AppError('خط الطباعة غير متوفر', 500, 'PDF_FONT_MISSING');
    }
    loaded = { regular, bold };
    return loaded;
}

export function isRtl(value) {
    return RTL_PATTERN.test(String(value ?? ''));
}

export function fontFor(value, bold = false) {
    if (isRtl(value)) return bold ? 'ar-bold' : 'ar';
    return bold ? 'latin-bold' : 'latin';
}

export function hasGlyph(codePoint) {
    const { regular } = loadPdfFonts();
    try {
        return regular.glyphForCodePoint(codePoint).id !== 0;
    } catch {
        return false;
    }
}
