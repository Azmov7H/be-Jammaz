import express from 'express';
import { SupplierService } from '../services/supplierService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateParams } from '../lib/validate.js';
import { supplierSchema, idSchema, linkSchema } from '../validations/index.js';
import { z } from 'zod';
const idParams = z.object({ id: idSchema });

const router = express.Router();

router.use(authMiddleware);

router.get('/', routeHandler(async (req) => {
    return await SupplierService.getAll(req.query);
}));

router.get('/:id', routeHandler(async (req) => {
    return await SupplierService.getById(req.params.id);
}));

router.post('/', validate(supplierSchema), routeHandler(async (req) => {
    return await SupplierService.create(req.body);
}));

router.put('/:id', validateParams(idParams), validate(supplierSchema.partial()), routeHandler(async (req) => {
    return await SupplierService.update(req.params.id, req.body);
}));

router.delete('/:id', validateParams(idParams),  roleMiddleware(['owner']), routeHandler(async (req) => {
    return await SupplierService.delete(req.params.id);
}));

// Customer ↔ Supplier unification (Sprint 7, FIN-RTE-001)
router.post('/:id/link-customer', validateParams(idParams), roleMiddleware(['owner', 'manager']),
    validate(linkSchema), routeHandler(async (req) => {
        const { PartyService } = await import('../services/partyService.js');
        return await PartyService.link('Supplier', req.params.id, req.body.targetId, req.user._id);
    }));

router.delete('/:id/link-customer', validateParams(idParams), roleMiddleware(['owner', 'manager']),
    routeHandler(async (req) => {
        const { PartyService } = await import('../services/partyService.js');
        return await PartyService.unlink('Supplier', req.params.id, req.user._id);
    }));

router.get('/:id/net-position', validateParams(idParams), routeHandler(async (req) => {
    const { PartyService } = await import('../services/partyService.js');
    return await PartyService.getNetPosition('Supplier', req.params.id);
}));

export default router;
