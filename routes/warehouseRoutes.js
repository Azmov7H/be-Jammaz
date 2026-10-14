import express from 'express';
import { z } from 'zod';
import { WarehouseService } from '../services/warehouseService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateParams } from '../lib/validate.js';
import {
    warehouseSchema,
    updateWarehouseSchema,
    warehouseDeleteSchema,
    idSchema
} from '../validations/index.js';

const idParams = z.object({ id: idSchema });

const router = express.Router();

router.use(authMiddleware);

// Reads: every authenticated role (all roles need warehouse names for stock views)
router.get('/', routeHandler(async (req) => {
    const { search, isActive, page, limit } = req.query;
    return await WarehouseService.list({ search, isActive, page, limit });
}));

router.get('/primary', routeHandler(async () => {
    return await WarehouseService.getPrimaryWarehouse();
}));

router.get('/:id/deletion-preflight', validateParams(idParams), routeHandler(async (req) => {
    return await WarehouseService.deletionPreflight(req.params.id);
}));

router.get('/:id', validateParams(idParams), routeHandler(async (req) => {
    return await WarehouseService.getById(req.params.id);
}));

// Writes: owner | manager
router.post('/', roleMiddleware(['owner', 'manager']), validate(warehouseSchema), routeHandler(async (req) => {
    return await WarehouseService.create(req.body, req.user._id);
}));

router.put('/:id', validateParams(idParams), roleMiddleware(['owner', 'manager']), validate(updateWarehouseSchema), routeHandler(async (req) => {
    return await WarehouseService.update(req.params.id, req.body, req.user._id);
}));

router.delete('/:id', validateParams(idParams), roleMiddleware(['owner', 'manager']), validate(warehouseDeleteSchema), routeHandler(async (req) => {
    return await WarehouseService.deleteWarehouse(req.params.id, req.body, req.user._id);
}));

export default router;
