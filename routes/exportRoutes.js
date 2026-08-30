import express from 'express';
import { ExportService } from '../services/exportService.js';
import { LogService } from '../services/logService.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../lib/validate.js';
import { z } from 'zod';

const router = express.Router();

// Export requires at least viewer (SEC-EXP-001); sensitive columns (sourceNumber)
// are additionally gated to owner/manager inside ExportService (FIN-EXP-004).
const EXPORT_TYPES = [
    'customers', 'suppliers', 'products', 'invoices',
    'purchaseOrders', 'treasuryTransactions'
];

const exportSchema = z.object({
    type: z.enum(EXPORT_TYPES),
    format: z.enum(['csv', 'xlsx']).default('csv'),
    filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().default({})
}).strict();

router.use(authMiddleware);

// NOTE: heavyLimiter is applied when this router is mounted in index.js.
router.post('/', roleMiddleware(['owner', 'manager', 'viewer']), validate(exportSchema), (req, res, next) => {
    (async () => {
        const { type, format, filters } = req.body;
        const { filename, csv, count } = await ExportService.export(type, filters, format, req.user);

        await LogService.logAction({
            userId: req.user._id,
            action: 'EXPORT',
            entity: type,
            entityId: null,
            diff: { format, count },
            note: `تصدير ${type} بصيغة ${format} (${count} سطر)`
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    })().catch(next);
});

export default router;
