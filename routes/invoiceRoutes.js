import express from 'express';
import { InvoiceController } from '../controllers/invoiceController.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { routeHandler } from '../lib/route-handler.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', routeHandler(InvoiceController.getAll));
router.get('/:id', routeHandler(InvoiceController.getById));
router.post('/', routeHandler(InvoiceController.create));
router.get('/:id/returns', routeHandler(InvoiceController.getReturns));
router.post('/:id/return', routeHandler(InvoiceController.createReturn));
router.delete('/:id', roleMiddleware(['admin']), routeHandler(InvoiceController.delete));

export default router;
