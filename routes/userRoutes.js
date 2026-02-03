import express from 'express';
import { UserService } from '../services/userService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);
router.use(roleMiddleware(['owner', 'manager']));

router.get('/', routeHandler(async () => {
    return await UserService.getAll();
}));

router.get('/:id', routeHandler(async (req) => {
    return await UserService.getById(req.params.id);
}));

router.post('/', routeHandler(async (req) => {
    return await UserService.create(req.body);
}));

router.put('/:id', routeHandler(async (req) => {
    return await UserService.update(req.params.id, req.body);
}));

router.delete('/:id', routeHandler(async (req) => {
    return await UserService.delete(req.params.id);
}));

export default router;
