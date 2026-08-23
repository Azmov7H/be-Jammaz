import express from 'express';
import { PurchaseOrderService } from '../services/purchaseOrderService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateParams } from '../lib/validate.js';
import { purchaseOrderSchema, poStatusSchema, poReceiveSchema, idSchema } from '../validations/index.js';
import { z } from 'zod';
const idParams = z.object({ id: idSchema });

const router = express.Router();

router.use(authMiddleware);

router.get('/', routeHandler(async (req) => {
    return await PurchaseOrderService.getAll({
        limit: parseInt(req.query.limit) || 20,
        query: req.query.supplierId ? { supplier: req.query.supplierId } : {}
    });
}));

router.get('/:id', routeHandler(async (req) => {
    return await PurchaseOrderService.getById(req.params.id);
}));

router.post('/', validate(purchaseOrderSchema), routeHandler(async (req) => {
    return await PurchaseOrderService.create(req.body, req.user._id);
}));

router.put('/:id/status', validateParams(idParams), roleMiddleware(['owner', 'manager']), validate(poStatusSchema), routeHandler(async (req) => {
    const { status, paymentType } = req.body;
    return await PurchaseOrderService.updateStatus(req.params.id, { status, paymentType }, req.user._id);
}));

// Alias for frontend PATCH calls
router.patch('/:id', validateParams(idParams), roleMiddleware(['owner', 'manager']), validate(poStatusSchema), routeHandler(async (req) => {
    const { status, paymentType } = req.body;
    return await PurchaseOrderService.updateStatus(req.params.id, { status, paymentType }, req.user._id);
}));

router.post('/:id/receive', validateParams(idParams), roleMiddleware(['owner', 'manager']), validate(poReceiveSchema), routeHandler(async (req) => {
    return await PurchaseOrderService.receive(req.params.id, req.body, req.user._id);
}));

router.delete('/:id', validateParams(idParams), roleMiddleware(['owner']), routeHandler(async (req) => {
    return await PurchaseOrderService.delete(req.params.id);
}));

export default router;
