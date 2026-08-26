import express from 'express';
import { NotificationService } from '../services/notificationService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateParams } from '../lib/validate.js';
import { markReadSchema, idSchema } from '../validations/index.js';
import { z } from 'zod';

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
// FIX (Sprint 08): schema previously applied to the raw body while the
// frontend (and service contract) send { ids } — every real call 400'd.
router.patch('/mark-read', validate(z.object({ ids: markReadSchema })), routeHandler(async (req) => {
    const { ids } = req.body;
    const markAll = ids === 'all';
    return await NotificationService.markRead(req.user._id, markAll ? [] : (Array.isArray(ids) ? ids : [ids]), markAll);
}));

// Delete a notification
router.delete('/:id', validateParams(z.object({ id: idSchema })), routeHandler(async (req) => {
    return await NotificationService.delete(req.user._id, req.params.id);
}));

// Delete all notifications
router.delete('/', routeHandler(async (req) => {
    return await NotificationService.deleteAll(req.user._id);
}));

export default router;
