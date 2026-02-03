import express from 'express';
import { ProductController } from '../controllers/productController.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { routeHandler } from '../lib/route-handler.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', routeHandler(ProductController.getAll));
router.get('/metadata', routeHandler(ProductController.getMetadata));
router.get('/:id', routeHandler(ProductController.getById));
router.post('/', routeHandler(ProductController.create));
router.put('/:id', routeHandler(ProductController.update));
router.delete('/:id', roleMiddleware(['admin']), routeHandler(ProductController.delete));

export default router;
