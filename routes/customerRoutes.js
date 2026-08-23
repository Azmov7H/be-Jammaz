import express from 'express';
import { CustomerService } from '../services/customerService.js';
import { PricingService } from '../services/pricingService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateParams } from '../lib/validate.js';
import { customerSchema, customPriceSchema, idSchema } from '../validations/index.js';
import { z } from 'zod';

const router = express.Router();

const idParams = z.object({ id: idSchema });
const payBody = z.object({
    amount: z.coerce.number().positive().max(1e9),
    method: z.enum(['cash', 'bank', 'wallet', 'check']).optional(),
    note: z.string().max(500).optional(),
});

// All customer routes require authentication
router.use(authMiddleware);

router.get('/', routeHandler(async (req) => {
    const { page, limit, search } = req.query;
    return await CustomerService.getAll({ page, limit, search });
}));

router.get('/:id', validateParams(idParams), routeHandler(async (req) => {
    return await CustomerService.getById(req.params.id);
}));

router.post('/', validate(customerSchema), routeHandler(async (req) => {
    return await CustomerService.create(req.body);
}));

router.put('/:id', validateParams(idParams), validate(customerSchema.partial()), routeHandler(async (req) => {
    return await CustomerService.update(req.params.id, req.body);
}));

router.delete('/:id', validateParams(idParams), roleMiddleware(['owner']), routeHandler(async (req) => {
    return await CustomerService.delete(req.params.id);
}));

// New Endpoints for Integration
// Get Customer Pricing
router.get('/:id/pricing', validateParams(idParams), routeHandler(async (req) => {
    return await PricingService.getCustomerPricingView(req.params.id);
}));

// Set Customer Custom Price
router.post('/:id/pricing', validateParams(idParams), validate(z.object({ productId: idSchema, price: customPriceSchema.shape.price })), routeHandler(async (req) => {
    const { productId, price } = req.body;
    return await PricingService.setCustomPrice(req.params.id, productId, price, req.user._id);
}));

// Remove Customer Custom Price
router.delete('/:id/pricing', validateParams(idParams), routeHandler(async (req) => {
    const { productId } = req.query;
    return await PricingService.removeCustomPrice(req.params.id, productId);
}));

// Get Customer Statement
router.get('/:id/statement', validateParams(idParams), routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    return await CustomerService.getStatement(req.params.id, { startDate, endDate });
}));

// Record customer payment (unified collection)
router.post('/:id/pay', validateParams(idParams), validate(payBody), routeHandler(async (req) => {
    const { FinanceService } = await import('../services/financeService.js');
    const { amount, method, note } = req.body;
    return await FinanceService.recordTotalCustomerPayment(req.params.id, amount, method, note, req.user._id);
}));

export default router;
