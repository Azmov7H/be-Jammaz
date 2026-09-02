/**
 * DOC-ENG-001 / DOC-UX-005 — Print renderer.
 *
 * Wraps the shared HTML renderer in a chrome that hides the app
 * navigation, sets A4 page size, and adds the standard print-only
 * <style> block. S3 ships a single shared print stylesheet; future
 * documents inherit it.
 *
 * The print HTML differs from the preview HTML in ONE way: it
 * triggers `window.print()` on load (via the `autoprint=1` query
 * parameter the frontend sends).
 */

import { renderHtml } from './html.js';

const PRINT_CSS = `
@page { size: A4; margin: 20mm; }
@media print {
    html, body { background: white !important; margin: 0; padding: 0; }
    /* Hide the app chrome */
    header, aside, nav, .print\\:hidden, .no-print, [data-no-print] { display: none !important; }
    main, .container { margin: 0 !important; padding: 0 !important; max-width: 100% !important; }
    /* Long tables: keep thead on every page */
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; }
    /* Color fidelity */
    *, *::before, *::after {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }
}
@media screen {
    body { background: #f3f4f6; padding: 24px; }
    .print-frame { background: #fff; max-width: 800px; margin: 0 auto; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-radius: 8px; }
    .print-only { display: none; }
}
`;

/**
 * Render the same body as preview but with print CSS + auto-print hook.
 * @param {string} type
 * @param {object} data
 * @param {boolean} autoPrint
 * @returns {string}
 */
export function renderPrintHtml(type, data, { autoPrint = false } = {}) {
    const body = renderHtml(type, data);
    // Inject the print CSS into <head> and (optionally) an auto-print script.
    const withCss = body.replace(
        /<style>([\s\S]*?)<\/style>/,
        (match, existing) => `<style>${existing}\n${PRINT_CSS}</style>`
    );
    if (autoPrint) {
        const script = `<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 250); });</script>`;
        return withCss.replace('</body>', `${script}</body>`);
    }
    return withCss;
}
