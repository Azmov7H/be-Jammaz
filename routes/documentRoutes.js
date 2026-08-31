/**
 * DOC-ENG-003 / DOC-SEC-004 — Document routes.
 *
 * Mounted at /api/documents. The heavy rate limiter is applied at the
 * mount point in index.js (not here) so the test harness can opt out
 * cleanly with NODE_ENV=test.
 *
 * Endpoints:
 *   GET    /                              health/list of types
 *   GET    /:type                         preview HTML (no id)         (filterable)
 *   GET    /:type/:id                     preview HTML (single record) (filterable)
 *   GET    /:type/export?format=...       export (no id)               (filterable)
 *   GET    /:type/:id/export?format=...   export (single record)       (filterable)
 *   POST   /:type/:id?/export             same, body-driven             (filterable)
 *
 * `validateFilters` runs in DocumentService.getData; route-level Zod
 * validation only ensures the param shape (type + format) is correct.
 */

import express from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateParams } from '../lib/validate.js';
import { routeHandler } from '../lib/route-handler.js';
import {
    DOCUMENT_TYPE_VALUES,
    OUTPUT_FORMAT_VALUES,
} from '../lib/documentRegistry.js';
import { DocumentController } from '../document/index.js';
import { NotFoundError } from '../lib/errors.js';
import { listDocumentTypes } from '../lib/documentRegistry.js';

const router = express.Router();

router.use(authMiddleware);

const typeParamSchema = z.object({ type: z.enum(DOCUMENT_TYPE_VALUES) });
const idParamSchema = z.object({
    type: z.enum(DOCUMENT_TYPE_VALUES),
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'معرّف غير صالح'),
});
const typeOnlyParamSchema = z.object({ type: z.enum(DOCUMENT_TYPE_VALUES) });

const formatQuerySchema = z.object({
    format: z.enum(OUTPUT_FORMAT_VALUES).optional(),
});

/**
 * GET /api/documents — list registered document types (admin-style health check).
 */
router.get('/', routeHandler(async () => {
    return { types: listDocumentTypes() };
}));

/**
 * GET /api/documents/:type — preview HTML (no id; only for types that don't require one).
 */
router.get('/:type',
    validateParams(typeOnlyParamSchema),
    validate(formatQuerySchema, 'query'),
    DocumentController.preview,
);

/**
 * GET /api/documents/:type/:id — preview HTML (single record).
 */
router.get('/:type/:id',
    validateParams(idParamSchema),
    validate(formatQuerySchema, 'query'),
    DocumentController.preview,
);

/**
 * GET /api/documents/:type/export — export (no id).
 *   e.g. /api/documents/COMPANY_FINANCIAL_STATEMENT/export?format=xlsx&from=...
 */
router.get('/:type/export',
    validateParams(typeOnlyParamSchema),
    validate(formatQuerySchema, 'query'),
    DocumentController.export,
);

/**
 * GET /api/documents/:type/:id/export — export (single record).
 */
router.get('/:type/:id/export',
    validateParams(idParamSchema),
    validate(formatQuerySchema, 'query'),
    DocumentController.export,
);

/**
 * POST /api/documents/:type/:id?/export — same, body-driven (filters in JSON).
 */
const postBodySchema = z.object({
    format: z.enum(OUTPUT_FORMAT_VALUES).optional(),
});

router.post('/:type/export',
    validateParams(typeOnlyParamSchema),
    validate(postBodySchema),
    DocumentController.export,
);

router.post('/:type/:id/export',
    validateParams(idParamSchema),
    validate(postBodySchema),
    DocumentController.export,
);

/**
 * 404 for any unmatched /api/documents/... path.
 */
router.use((req, _res, next) => {
    next(new NotFoundError('Document endpoint not found'));
});

export default router;
