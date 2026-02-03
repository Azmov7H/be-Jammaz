import express from 'express';
import { SupplierService } from '../services/supplierService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', routeHandler(async (req) => {
    return await SupplierService.getAll(req.query);
}));

router.get('/:id', routeHandler(async (req) => {
    return await SupplierService.getById(req.params.id);
}));

router.post('/', routeHandler(async (req) => {
    return await SupplierService.create(req.body);
}));

router.put('/:id', routeHandler(async (req) => {
    return await SupplierService.update(req.params.id, req.body);
}));

router.delete('/:id', roleMiddleware(['admin']), routeHandler(async (req) => {
    return await SupplierService.delete(req.params.id);
}));

export default router;
