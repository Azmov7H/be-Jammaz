import express from 'express';
import { PurchaseOrderService } from '../services/purchaseOrderService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

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

router.post('/', routeHandler(async (req) => {
    return await PurchaseOrderService.create(req.body, req.user._id);
}));

router.put('/:id/status', roleMiddleware(['admin', 'manager']), routeHandler(async (req) => {
    const { status, paymentType } = req.body;
    return await PurchaseOrderService.updateStatus(req.params.id, { status, paymentType }, req.user._id);
}));

// Alias for frontend PATCH calls
router.patch('/:id', roleMiddleware(['owner', 'admin', 'manager']), routeHandler(async (req) => {
    const { status, paymentType } = req.body;
    return await PurchaseOrderService.updateStatus(req.params.id, { status, paymentType }, req.user._id);
}));

router.post('/:id/receive', roleMiddleware(['admin', 'manager']), routeHandler(async (req) => {
    return await PurchaseOrderService.receive(req.params.id, req.body, req.user._id);
}));

router.delete('/:id', roleMiddleware(['admin']), routeHandler(async (req) => {
    return await PurchaseOrderService.delete(req.params.id);
}));

export default router;
