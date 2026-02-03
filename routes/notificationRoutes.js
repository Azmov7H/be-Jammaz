import express from 'express';
import { NotificationService } from '../services/notificationService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

// Get notifications for current user
router.get('/', routeHandler(async (req) => {
    const { limit = 20, page = 1, unreadOnly, type } = req.query;
    return await NotificationService.getUserNotifications(req.user._id, {
        limit: parseInt(limit),
        page: parseInt(page),
        unreadOnly: unreadOnly === 'true',
        type
    });
}));

// Mark notifications as read
router.patch('/mark-read', routeHandler(async (req) => {
    const { ids } = req.body;
    const markAll = ids === 'all';
    return await NotificationService.markRead(req.user._id, markAll ? [] : (Array.isArray(ids) ? ids : [ids]), markAll);
}));

// Delete a notification
router.delete('/:id', routeHandler(async (req) => {
    return await NotificationService.delete(req.user._id, req.params.id);
}));

// Delete all notifications
router.delete('/', routeHandler(async (req) => {
    return await NotificationService.deleteAll(req.user._id);
}));

export default router;
