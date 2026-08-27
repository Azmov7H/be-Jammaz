import express from 'express';
import { LogService } from '../services/logService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);
router.use(roleMiddleware(['owner', 'manager']));

router.get('/', routeHandler(async (req) => {
    return await LogService.getAll(req.query);
}));

router.get('/recent', routeHandler(async (req) => {
    return await LogService.getRecentLogs(req.query);
}));

router.get('/:entity/:id', routeHandler(async (req) => {
    return await LogService.getEntityLogs(req.params.entity, req.params.id, req.query);
}));

export default router;
