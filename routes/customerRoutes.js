import express from 'express';
import { CustomerService } from '../services/customerService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

// All customer routes require authentication
router.use(authMiddleware);

router.get('/', routeHandler(async (req) => {
    const { page, limit, search } = req.query;
    return await CustomerService.getAll({ page, limit, search });
}));

router.get('/:id', routeHandler(async (req) => {
    return await CustomerService.getById(req.params.id);
}));

router.post('/', routeHandler(async (req) => {
    return await CustomerService.create(req.body);
}));

router.put('/:id', routeHandler(async (req) => {
    return await CustomerService.update(req.params.id, req.body);
}));

router.delete('/:id', roleMiddleware(['admin']), routeHandler(async (req) => {
    return await CustomerService.delete(req.params.id);
}));

// New Endpoints for Integration
// Get Customer Pricing
router.get('/:id/pricing', routeHandler(async (req) => {
    const { PricingService } = await import('../services/pricingService.js');
    const prices = await PricingService.getCustomerPricing(req.params.id);
    return {
        prices: prices.map(p => ({
            productId: p.productId?._id || p.productId,
            productName: p.productId?.name || 'منتج محذوف',
            retailPrice: p.productId?.retailPrice || 0,
            wholesalePrice: p.productId?.wholesalePrice || 0,
            customPrice: p.customPrice
        }))
    };
}));

// Set Customer Custom Price
router.post('/:id/pricing', routeHandler(async (req) => {
    const { PricingService } = await import('../services/pricingService.js');
    const { productId, price } = req.body;
    return await PricingService.setCustomPrice(req.params.id, productId, price, req.user._id);
}));

// Remove Customer Custom Price
router.delete('/:id/pricing', routeHandler(async (req) => {
    const { PricingService } = await import('../services/pricingService.js');
    const { productId } = req.query;
    return await PricingService.removeCustomPrice(req.params.id, productId);
}));

// Get Customer Statement
router.get('/:id/statement', routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    return await CustomerService.getStatement(req.params.id, { startDate, endDate });
}));

// Record customer payment (unified collection)
router.post('/:id/pay', routeHandler(async (req) => {
    const { FinanceService } = await import('../services/financeService.js');
    const { amount, method, note } = req.body;
    return await FinanceService.recordTotalCustomerPayment(req.params.id, amount, method, note, req.user._id);
}));

export default router;
