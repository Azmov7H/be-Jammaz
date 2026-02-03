import express from 'express';
import { StockService } from '../services/stockService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import Product from '../models/Product.js';

const router = express.Router();

router.use(authMiddleware);

// Get stock status (returns products with stock info)
router.get('/', routeHandler(async (req) => {
    const { search, lowStock, outOfStock } = req.query;

    const filter = { isActive: true };

    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { code: { $regex: search, $options: 'i' } }
        ];
    }

    if (lowStock === 'true') {
        filter.$expr = { $lte: ['$stockQty', '$minLevel'] };
    }

    if (outOfStock === 'true') {
        filter.stockQty = 0;
    }

    const products = await Product.find(filter)
        .select('name code stockQty warehouseQty shopQty minLevel buyPrice retailPrice')
        .sort({ name: 1 })
        .limit(100)
        .lean();

    return { products, count: products.length };
}));

router.get('/movements', routeHandler(async (req) => {
    const { startDate, endDate, type } = req.query;
    return await StockService.getMovements(
        startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate ? new Date(endDate) : new Date(),
        type
    );
}));

router.get('/status', routeHandler(async (req) => {
    // Same as root endpoint
    const products = await Product.find({ isActive: true })
        .select('name code stockQty warehouseQty shopQty minLevel buyPrice retailPrice')
        .sort({ name: 1 })
        .limit(100)
        .lean();

    return { products, count: products.length };
}));

router.post('/transfer', routeHandler(async (req) => {
    const { productId, from, to, qty, quantity, note } = req.body;
    return await StockService.transferStock(productId, from, to, qty || quantity, note, req.user._id);
}));

// Alias for stock movements for frontend compatibility
router.post('/move', routeHandler(async (req) => {
    const { items, productId, qty, type, note, refId } = req.body;

    if (items && Array.isArray(items) && items.length > 0) {
        // Bulk movement
        return await StockService.bulkMoveStock({
            items,
            type: type || items[0].type,
            userId: req.user._id
        });
    }

    // Single product movement
    return await StockService.moveStock({
        productId,
        qty: qty || (items && items[0]?.qty),
        type: type || (items && items[0]?.type),
        userId: req.user._id,
        note: note || (items && items[0]?.note),
        refId
    });
}));

router.post('/adjust', roleMiddleware(['admin']), routeHandler(async (req) => {
    const { productId, location, newQty, reason } = req.body;
    return await StockService.adjustStock(productId, location, newQty, reason, req.user._id);
}));

export default router;
