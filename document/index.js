/**
 * DOC-ENG-001 / DOC-ENG-002 — Document engine entry point.
 *
 * The DocumentService is the public surface for every document in the
 * system. It does three things:
 *
 *   1. Resolves the document type via the registry.
 *   2. Loads the per-type fetcher and returns shaped DocumentData.
 *   3. Renders DocumentData to a specific output format.
 *
 * S1 ships the engine skeleton: getData + audit + a single `renderNotImpl`
 * that returns a 501 for any not-yet-shipped format. S10 fills in the
 * real renderers (PDF, Excel, CSV, HTML, print).
 *
 * The DocumentController is the thin express layer: parameter parsing +
 * response shaping. It delegates everything to the service.
 */

import {
    getDocumentEntry,
    validateFilters,
    OUTPUT_FORMATS,
    OUTPUT_FORMAT_VALUES,
} from '../lib/documentRegistry.js';
import { BadRequestError, NotFoundError, AppError } from '../lib/errors.js';
import { LogService } from '../services/logService.js';
import { logger } from '../lib/logger.js';
import { renderHtml } from './renderers/html.js';
import { renderPrintHtml } from './renderers/print.js';

const NOT_IMPLEMENTED_STATUS = 501;

class NotImplementedError extends AppError {
    constructor(message) {
        super(message, NOT_IMPLEMENTED_STATUS, 'NOT_IMPLEMENTED');
    }
}

/**
 * Validate that the requested format is supported by the document type.
 * `html` is always allowed (preview is universal); the user-facing format
 * is `print` (the document renders the same HTML with a print trigger).
 */
function assertFormatSupported(entry, format) {
    if (!OUTPUT_FORMAT_VALUES.includes(format)) {
        throw new BadRequestError(`صيغة غير مدعومة: ${format}`);
    }
    if (format === OUTPUT_FORMATS.HTML) return; // preview is always available
    if (!entry.formats.includes(format)) {
        throw new BadRequestError(
            `الصيغة ${format} غير مدعومة للمستند ${entry.labelAr}`
        );
    }
}

/**
 * Load the per-type fetcher. Lazy-imported so a not-yet-implemented
 * fetcher never crashes the import graph at boot time.
 *
 * Each fetcher exports `{ fetch(params, { user }) -> DocumentData }`.
 */
async function loadFetcher(entry) {
    try {
        const mod = await import(entry.fetcherPath);
        if (typeof mod.fetch !== 'function') {
            throw new NotImplementedError(
                `fetcher for ${entry.id} exists but does not export fetch()`
            );
        }
        return mod;
    } catch (err) {
        if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') {
            throw new NotImplementedError(
                `fetcher for ${entry.id} is not yet implemented (${entry.fetcherPath})`
            );
        }
        throw err;
    }
}

/**
 * DOC-ENG-002 — DocumentService
 */
export const DocumentService = {
    /**
     * Resolve a document to its shaped DocumentData (no output yet).
     * Validates the filter allow-list, lazy-loads the fetcher, and returns
     * the result.
     *
     * @param {string} type
     * @param {object} params  arbitrary {id?, ...filters}
     * @param {{ user: object }} ctx
     * @returns {Promise<object>}
     */
    async getData(type, params = {}, { user } = {}) {
        if (!user) throw new BadRequestError('معلومات المستخدم مطلوبة');
        const entry = getDocumentEntry(type);

        const { id, ...rest } = params;
        if (entry.requiresId && !id) {
            throw new BadRequestError(`المستند ${entry.labelAr} يتطلب معرفاً`);
        }
        // `rest` is the filter set; `id` is the route param and is never
        // a filter. validateFilters is run only against `rest`.
        validateFilters(entry, rest);

        const fetcher = await loadFetcher(entry);
        const data = await fetcher.fetch({ id, ...rest }, { user });
        return data;
    },

    /**
     * Render DocumentData to one of the supported output formats.
     *
     * S1 ships a single fallback that returns a "not yet implemented"
     * 501 for all formats except `html` / `print` (which returns a
     * minimal placeholder HTML page so the preview endpoint is
     * exercisable from day one). S10 wires the real renderers.
     *
     * @param {string} type
     * @param {object} params
     * @param {string} format
     * @param {{ user: object }} ctx
     * @returns {Promise<{ body: string|Buffer, contentType: string, filename: string }>}
     */
    async render(type, params = {}, format, { user } = {}) {
        const entry = getDocumentEntry(type);
        assertFormatSupported(entry, format);

        const data = await this.getData(type, params, { user });

        if (format === OUTPUT_FORMATS.HTML || format === OUTPUT_FORMATS.PRINT) {
            const html = format === OUTPUT_FORMATS.PRINT
                ? renderPrintHtml(type, data, { autoPrint: false })
                : renderHtml(type, data);
            await this._audit(type, params, user, format, data);
            return {
                body: html,
                contentType: 'text/html; charset=utf-8',
                filename: `${entry.id}.html`,
            };
        }

        // S10 territory: pdf / xlsx / csv renderers.
        throw new NotImplementedError(
            `renderer for ${entry.id} (${format}) is not yet implemented`
        );
    },

    /**
     * Build a downloadable filename per type/format.
     */
    buildFilename(type, id, format) {
        const entry = getDocumentEntry(type);
        const idPart = id ? `_${id}` : '';
        const today = new Date().toISOString().slice(0, 10);
        return `${entry.id}${idPart}_${today}.${format}`;
    },

    /**
     * Audit every render. Mirrors the legacy /api/export audit shape.
     */
    async _audit(type, params, user, format, data) {
        try {
            const count =
                Array.isArray(data?.rows) ? data.rows.length
                : Array.isArray(data?.transactions) ? data.transactions.length
                : data?.count ?? null;
            await LogService.logAction({
                userId: user._id,
                action: 'EXPORT',
                entity: type,
                entityId: params?.id ?? null,
                diff: { format, count, filters: { ...params, id: undefined } },
                note: `تصدير ${type} بصيغة ${format}${count != null ? ` (${count} سطر)` : ''}`,
            });
        } catch (err) {
            // Non-blocking — never let an audit failure break the render.
            logger.warn('[DocumentService] audit log failed:', err?.message);
        }
    },
};

/**
 * DOC-ENG-003 — DocumentController (express glue).
 */
export const DocumentController = {
    /**
     * GET /api/documents/:type/:id?
     * Returns preview HTML (rendered with print CSS in S11).
     */
    async preview(req, res) {
        const { type, id } = req.params;
        const params = { id, ...req.query };
        const { body, contentType } = await DocumentService.render(
            type, params, OUTPUT_FORMATS.HTML, { user: req.user }
        );
        res.setHeader('Content-Type', contentType);
        res.send(body);
    },

    /**
     * GET  /api/documents/:type/:id/export?format=...
     * POST /api/documents/:type/:id/export   { format, ...filters }
     *
     * Renders the requested format and streams the file back.
     */
    async export(req, res) {
        const { type, id } = req.params;
        const merged = { ...req.query, ...(req.body || {}) };
        const format = merged.format || OUTPUT_FORMATS.PDF;
        // `format` is a route-level concern, NOT a document filter.
        // Strip it out before handing the rest to the service.
        const { format: _f, ...params } = merged;

        const { body, contentType, filename } = await DocumentService.render(
            type, { id, ...params }, format, { user: req.user }
        );
        const finalFilename = DocumentService.buildFilename(type, id, format);
        res.setHeader('Content-Type', contentType);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${finalFilename || filename}"`
        );
        res.send(body);
    },
};
