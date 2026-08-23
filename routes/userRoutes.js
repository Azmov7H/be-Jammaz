import express from 'express';
import { UserService } from '../services/userService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

// Reads: owner | manager
router.get('/', roleMiddleware(['owner', 'manager']), routeHandler(async () => {
    return await UserService.getAll();
}));

router.get('/:id', roleMiddleware(['owner', 'manager']), routeHandler(async (req) => {
    return await UserService.getById(req.params.id);
}));

// Writes: owner only (T-ACL-01 — closes manager privesc via /api/users)
router.post('/', roleMiddleware(['owner']), routeHandler(async (req) => {
    return await UserService.create(req.body);
}));

router.put('/:id', roleMiddleware(['owner']), routeHandler(async (req) => {
    return await UserService.update(req.params.id, req.body, req.user);
}));

router.delete('/:id', roleMiddleware(['owner']), routeHandler(async (req) => {
    return await UserService.delete(req.params.id, req.user);
}));

export default router;
