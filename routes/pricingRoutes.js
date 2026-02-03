import express from 'express';
import { PricingService } from '../services/pricingService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

// Get Price History
router.get('/history/:productId', routeHandler(async (req) => {
    const { startDate, endDate } = req.query;
    return await PricingService.getPriceHistory(req.params.productId, startDate, endDate);
}));

// Set Custom Price
router.post('/custom', routeHandler(async (req) => {
    const { customerId, productId, price } = req.body;
    return await PricingService.setCustomPrice(customerId, productId, price, req.user._id);
}));

// Remove Custom Price
router.delete('/custom', routeHandler(async (req) => {
    const { customerId, productId } = req.body;
    return await PricingService.removeCustomPrice(customerId, productId);
}));

// Get Customer Pricing (All custom prices for a customer)
router.get('/customer/:customerId', routeHandler(async (req) => {
    return await PricingService.getCustomerPricing(req.params.customerId);
}));

export default router;
