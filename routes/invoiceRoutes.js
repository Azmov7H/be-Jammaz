import express from 'express';
import { InvoiceController } from '../controllers/invoiceController.js';
import { maskSourceInResult, maskDocSource } from '../lib/pii.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { routeHandler } from '../lib/route-handler.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', routeHandler(async (req) => {
    const result = await InvoiceController.getAll(req);
    return maskSourceInResult(result, req.user.role);
}));
router.get('/:id', routeHandler(async (req) => {
    const result = await InvoiceController.getById(req);
    return maskDocSource(result, req.user.role);
}));
router.post('/', routeHandler(InvoiceController.create));
router.get('/:id/returns', routeHandler(InvoiceController.getReturns));
router.post('/:id/return', roleMiddleware(['owner', 'manager']), routeHandler(InvoiceController.createReturn));
router.delete('/:id', roleMiddleware(['owner']), routeHandler(InvoiceController.delete));

export default router;
