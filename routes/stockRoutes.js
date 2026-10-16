import express from 'express';
import { StockService } from '../services/stockService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../lib/validate.js';
import { stockTransferSchema, stockTransferBulkSchema, stockMoveSchema, stockAdjustSchema } from '../validations/index.js';

const router = express.Router();

router.use(authMiddleware);

// Get stock status (returns products with stock info)
router.get('/', routeHandler(async (req) => {
    const { search, lowStock, outOfStock } = req.query;
    return await StockService.listStock({ search, lowStock, outOfStock });
}));

router.get('/movements', routeHandler(async (req) => {
    const { startDate, endDate, type } = req.query;
    return await StockService.getMovements(
        startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate ? new Date(endDate) : new Date(),
        type
    );
}));

router.get('/status', routeHandler(async () => {
    return await StockService.listStatus();
}));

router.post('/transfer', validate(stockTransferSchema),  roleMiddleware(['warehouse', 'owner', 'manager']), routeHandler(async (req) => {
    const { productId, from, to, qty, quantity, note, warehouseId, fromWarehouseId, toWarehouseId } = req.body;
    const amount = qty ?? quantity;
    // Inter-warehouse transfer: either an explicit warehouse→warehouse move, or
    // both endpoints supplied. A null/absent id means the PRIMARY warehouse, so
    // the primary may be on either side.
    if ((from === 'warehouse' && to === 'warehouse') || (fromWarehouseId && toWarehouseId)) {
        return await StockService.transferBetweenWarehouses(
            productId, amount, req.user._id, fromWarehouseId ?? null, toWarehouseId ?? null, note
        );
    }
    if (from === 'warehouse' && to === 'shop') {
        return await StockService.transferToShop(productId, amount, req.user._id, note, null, warehouseId);
    }
    return await StockService.transferToWarehouse(productId, amount, req.user._id, note, null, warehouseId);
}));

// Bulk inter-warehouse transfer: move many products between two warehouses in a
// single atomic operation. Same warehouse-side rules as /transfer (a null id
// means the PRIMARY warehouse).
router.post('/transfer-bulk', validate(stockTransferBulkSchema), roleMiddleware(['warehouse', 'owner', 'manager']), routeHandler(async (req) => {
    const { items, note, fromWarehouseId, toWarehouseId } = req.body;
    return await StockService.bulkTransferBetweenWarehouses(
        items, req.user._id, fromWarehouseId ?? null, toWarehouseId ?? null, note
    );
}));

// Alias for stock movements for frontend compatibility
router.post('/move', validate(stockMoveSchema),  roleMiddleware(['warehouse', 'owner', 'manager']), routeHandler(async (req) => {
    const { items, productId, qty, type, note, refId, warehouseId } = req.body;

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
        refId,
        warehouseId: warehouseId || (items && items[0]?.warehouseId)
    });
}));

router.post('/adjust', roleMiddleware(['owner', 'manager']), validate(stockAdjustSchema), routeHandler(async (req) => {
    const { productId, location, newQty, reason, warehouseId } = req.body;
    return await StockService.adjustStockLocation(productId, location, newQty, reason, req.user._id, null, warehouseId);
}));

export default router;
