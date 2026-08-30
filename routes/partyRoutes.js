import express from 'express';
import { PartyService } from '../services/partyService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateParams } from '../lib/validate.js';
import { linkSchema, idSchema } from '../validations/index.js';
import { z } from 'zod';

const router = express.Router();

router.use(authMiddleware);
// Read-only duplicate detection report (FIN-UI-015). Owner/manager only —
// review-and-confirm is a guarded action.
router.post('/detect-duplicates', roleMiddleware(['owner', 'manager']), routeHandler(async () => {
    return await PartyService.detectDuplicates();
}));

// Link a customer ↔ supplier (from a neutral parties endpoint).
// body: { sourceType: 'Customer'|'Supplier', sourceId, targetId }
router.post('/link', roleMiddleware(['owner', 'manager']), validate(
    linkSchema.extend({
        sourceType: z.enum(['Customer', 'Supplier']),
        sourceId: idSchema
    })
), routeHandler(async (req) => {
    const { sourceType, sourceId, targetId } = req.body;
    return await PartyService.link(sourceType, sourceId, targetId);
}));

// Unlink a customer ↔ supplier.
router.post('/unlink', roleMiddleware(['owner', 'manager']), validate(
    z.object({ sourceType: z.enum(['Customer', 'Supplier']), sourceId: idSchema })
), routeHandler(async (req) => {
    const { sourceType, sourceId } = req.body;
    return await PartyService.unlink(sourceType, sourceId);
}));

// Combined net position for an entity.
router.get('/:type/:id/net-position', validateParams(
    z.object({ type: z.enum(['Customer', 'Supplier']), id: idSchema })
), routeHandler(async (req) => {
    const { type, id } = req.params;
    return await PartyService.getNetPosition(type, id);
}));

export default router;
