import express from 'express';
import { AuthController } from '../controllers/authController.js';
import { routeHandler } from '../lib/route-handler.js';

const router = express.Router();

router.post('/login', routeHandler(AuthController.login));
router.post('/logout', routeHandler(AuthController.logout));
router.get('/session', routeHandler(AuthController.getSession));
router.post('/google/callback', routeHandler(AuthController.googleCallback));

export default router;
