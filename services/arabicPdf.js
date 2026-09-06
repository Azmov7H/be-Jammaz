import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import ArabicReshaper from 'arabic-reshaper';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ARABIC_FONTS = {
    regular: path.join(__dirname, '..', 'assets', 'fonts', 'Amiri-Regular.ttf'),
    bold: path.join(__dirname, '..', 'assets', 'fonts', 'Amiri-Bold.ttf'),
};

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

function splitRuns(logical) {
    const runs = [];
    let cur = '';
    let curRtl = null;
    for (const ch of logical) {
        const rtl = RTL_CHAR.test(ch);
        if (curRtl === null) curRtl = rtl;
        if (rtl !== curRtl) {
            runs.push({ text: cur, rtl: curRtl });
            cur = ch;
            curRtl = rtl;
        } else {
            cur += ch;
        }
    }
    if (cur) runs.push({ text: cur, rtl: curRtl });
    return runs;
}

export function shapeArabic(value) {
    const logical = String(value ?? '');
    if (!logical) return '';
    const reshaped = ArabicReshaper.convertArabic(logical);
    return splitRuns(reshaped)
        .reverse()
        .map((r) => (r.rtl ? [...r.text].reverse().join('') : r.text))
        .join('');
}

export function createArabicDoc() {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    doc.registerFont('ar', ARABIC_FONTS.regular);
    doc.registerFont('ar-bold', ARABIC_FONTS.bold);
    doc.font('ar');
    return doc;
}

export function docToBuffer(doc) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}
