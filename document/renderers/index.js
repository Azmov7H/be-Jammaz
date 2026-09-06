/**
 * DOC-ENG-004 — Renderer registry.
 *
 * Single entry point the DocumentService uses to dispatch a DocumentData
 * to the right renderer for the requested format.
 *
 *   render('html',   type, data) -> string
 *   render('print',  type, data) -> string      (HTML + print CSS + auto-print hook)
 *   render('pdf',    type, data) -> Promise<Buffer>
 *
 * Each format delegates to a dedicated module under ./ — keeping the
 * dispatch surface thin makes it trivial to add a new format (e.g.
 * xlsx) without touching the DocumentService.
 */

import { renderHtml } from './html.js';
import { renderPrintHtml } from './print.js';
import { renderPdf } from './pdf.js';

export const OUTPUT_FORMAT_RENDERERS = Object.freeze({
    html: renderHtml,
    print: renderPrintHtml,
    pdf: renderPdf,
});

/**
 * Render DocumentData to one of the supported output formats.
 *
 * @param {string} format one of OUTPUT_FORMATS
 * @param {string} type   one of DOCUMENT_TYPES
 * @param {object} data   the shaped DocumentData
 * @returns {Promise<string|Buffer>}
 */
export async function render(format, type, data) {
    const fn = OUTPUT_FORMAT_RENDERERS[format];
    if (!fn) {
        const err = new Error(`renderer for ${type} (${format}) is not yet implemented`);
        err.code = 'NOT_IMPLEMENTED';
        err.statusCode = 501;
        throw err;
    }
    return await fn(type, data);
}