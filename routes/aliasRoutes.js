/**
 * Frontend-friendly aliases (no /financial prefix).
 *
 * The /receivables and /sales-returns pages call:
 *     GET /api/payments       -> open receivables (pending/partial invoices)
 *     GET /api/sales-returns  -> sales returns list
 *
 * Thin re-exports over the canonical services — no duplicated logic.
 */

import express from 'express';
import dbConnect from '../lib/db.js';
import Invoice from '../models/Invoice.js';
import { ReturnService } from '../services/financial/returnService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();
router.use(authMiddleware);

router.get('/payments', routeHandler(async (req) => {
    await dbConnect();
    const { customerId, page = 1, limit = 50 } = req.query;
    const query = { paymentStatus: { $in: ['pending', 'partial'] } };
    if (customerId) query.customer = customerId;
    const perPage = Math.max(1, Math.min(200, Number(limit)));
    const skip = (Math.max(1, Number(page)) - 1) * perPage;
    const [invoices, count] = await Promise.all([
        Invoice.find(query).sort({ date: -1 }).skip(skip).limit(perPage).lean(),
        Invoice.countDocuments(query)
    ]);
    const totalReceivables = invoices.reduce(
        (sum, inv) => sum + (Number(inv.total) - Number(inv.paidAmount || 0)), 0
    );
    return { invoices, count, totalReceivables, page: Number(page), limit: perPage };
}));

router.get('/sales-returns', routeHandler(async (req) => {
    const { page = 1, limit = 50 } = req.query;
    return await ReturnService.getAllReturns({ page, limit });
}));

export default router;
