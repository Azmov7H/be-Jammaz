import express from 'express';
import { PhysicalInventoryService } from '../services/physicalInventoryService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

// Get all physical inventory counts
router.get('/', routeHandler(async (req) => {
    const { location, status, startDate, endDate } = req.query;
    return await PhysicalInventoryService.getCounts({
        location,
        status,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined
    });
}));

// Get single count by ID
router.get('/:id', routeHandler(async (req) => {
    return await PhysicalInventoryService.getCountById(req.params.id);
}));

// Create new physical inventory count
router.post('/', roleMiddleware(['owner', 'manager']), routeHandler(async (req) => {
    const { location, options } = req.body;
    return await PhysicalInventoryService.createCount(location, req.user._id, options || {});
}));

// Update actual quantities
router.patch('/:id', roleMiddleware(['owner', 'manager']), routeHandler(async (req) => {
    const { itemUpdates } = req.body;
    return await PhysicalInventoryService.updateActualQuantities(req.params.id, itemUpdates, req.user._id);
}));

// Complete a count
router.post('/:id/complete', roleMiddleware(['owner', 'manager']), routeHandler(async (req) => {
    return await PhysicalInventoryService.completeCount(req.params.id, req.user._id);
}));

// Unlock a completed count
router.post('/:id/unlock', roleMiddleware(['owner']), routeHandler(async (req) => {
    const { password } = req.body;
    return await PhysicalInventoryService.unlockCount(req.params.id, password, req.user._id);
}));

// Delete a draft count
router.delete('/:id', roleMiddleware(['owner']), routeHandler(async (req) => {
    return await PhysicalInventoryService.deleteCount(req.params.id, req.user._id);
}));

export default router;
