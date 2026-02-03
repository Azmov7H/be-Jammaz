import express from 'express';
import { LogService } from '../services/logService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);
router.use(roleMiddleware(['admin']));

router.get('/', routeHandler(async (req) => {
    const { limit, page } = req.query;
    return await LogService.getAll({
        limit: parseInt(limit) || 100,
        page: parseInt(page) || 1
    });
}));

router.get('/recent', routeHandler(async (req) => {
    const { limit } = req.query;
    return await LogService.getRecentLogs(parseInt(limit) || 50);
}));

router.get('/:entity/:id', routeHandler(async (req) => {
    const { entity, id } = req.params;
    return await LogService.getEntityLogs(entity, id);
}));

export default router;
