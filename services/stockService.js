import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import dbConnect from '../lib/db.js';

/**
 * Stock Management Service
 * Handles all stock operations with proper validation and logging
 */
export const StockService = {
    /**
     * Reduce stock when creating a sale (invoice)
     * Stock is ALWAYS reduced from SHOP
     */
    async reduceStockForSale(items, invoiceId, userId, session = null) {
        const results = [];

        for (const item of items) {
            // Skip service items (no stock tracking)
            if (item.isService || !item.productId) {
                results.push({
                    isService: true,
                    productName: item.productName || item.name
                });
                continue;
            }

            const product = await Product.findById(item.productId).session(session);

            if (!product) {
                throw new Error(`المنتج غير موجود: ${item.productId}`);
            }

            // Determine source (default to 'shop' for backward compatibility)
            const source = item.source || 'shop';

            // Validate and reduce based on source
            if (source === 'warehouse') {
                // Selling from warehouse
                if (product.warehouseQty < item.qty) {
                    throw new Error(
                        `كمية غير كافية في المخزن: ${product.name}. ` +
                        `المتوفر: ${product.warehouseQty}, المطلوب: ${item.qty}`
                    );
                }
                product.warehouseQty -= item.qty;
            } else {
                // Selling from shop (default)
                if (product.shopQty < item.qty) {
                    throw new Error(
                        `كمية غير كافية في المحل: ${product.name}. ` +
                        `المتوفر: ${product.shopQty}, المطلوب: ${item.qty}`
                    );
                }
                product.shopQty -= item.qty;
            }

            // Update total stock
            product.stockQty = product.warehouseQty + product.shopQty;
            await product.save({ session });

            // Log movement
            const movementDocs = await StockMovement.create([{
                productId: item.productId,
                type: 'SALE',
                qty: item.qty,
                note: `بيع من ${source === 'warehouse' ? 'المخزن' : 'المحل'} - فاتورة #${invoiceId}`,
                refId: invoiceId,
                createdBy: userId,
                snapshot: {
                    warehouseQty: product.warehouseQty,
                    shopQty: product.shopQty
                }
            }], { session });
            const movement = movementDocs[0];

            results.push({ product, movement });
        }

        return results;
    },

    /**
     * Increase stock when receiving purchase order
     * Stock is ALWAYS added to WAREHOUSE
     * IMPLEMENTS: Weighted Average Cost (AVCO)
     */
    async increaseStockForPurchase(items, poId, userId) {
        const results = [];

        for (const item of items) {
            const product = await Product.findById(item.productId);

            if (!product) {
                throw new Error(`المنتج غير موجود: ${item.productId}`);
            }

            const currentStock = product.stockQty || 0;
            const currentCost = product.buyPrice || 0;
            const newQty = item.quantity;
            const newCost = item.costPrice || currentCost;

            let newAvgCost = currentCost;

            if (currentStock + newQty > 0) {
                const totalValue = (currentStock * currentCost) + (newQty * newCost);
                newAvgCost = totalValue / (currentStock + newQty);
            }

            // Update Stock
            product.warehouseQty = (product.warehouseQty || 0) + newQty;
            product.stockQty = (product.warehouseQty || 0) + (product.shopQty || 0);

            // Update Cost
            product.buyPrice = parseFloat(newAvgCost.toFixed(2));

            await product.save();

            // Log movement
            const movementDocs = await StockMovement.create([{
                productId: item.productId,
                type: 'IN',
                qty: newQty,
                note: `شراء - أمر #${poId} (Cost: ${newCost}, NewAvg: ${product.buyPrice})`,
                refId: poId,
                createdBy: userId,
                snapshot: {
                    warehouseQty: product.warehouseQty,
                    shopQty: product.shopQty
                }
            }]);
            const movement = movementDocs[0];

            results.push({ product, movement, newAvgCost: product.buyPrice });
        }

        return results;
    },

    /**
     * Transfer stock from warehouse to shop
     */
    async transferToShop(productId, quantity, userId, note = '') {
        const product = await Product.findById(productId);

        if (!product) {
            throw new Error('المنتج غير موجود');
        }

        if (product.warehouseQty < quantity) {
            throw new Error(
                `كمية غير كافية في المخزن. المتوفر: ${product.warehouseQty}, المطلوب: ${quantity}`
            );
        }

        // Transfer
        product.warehouseQty -= quantity;
        product.shopQty += quantity;
        await product.save();

        // Log movement
        const movementDocs = await StockMovement.create([{
            productId,
            type: 'TRANSFER_TO_SHOP',
            qty: quantity,
            note: note || 'تحويل من المخزن إلى المحل',
            createdBy: userId,
            snapshot: {
                warehouseQty: product.warehouseQty,
                shopQty: product.shopQty
            }
        }]);
        const movement = movementDocs[0];

        return { product, movement };
    },

    /**
     * Transfer stock from shop to warehouse
     */
    async transferToWarehouse(productId, quantity, userId, note = '') {
        const product = await Product.findById(productId);

        if (!product) {
            throw new Error('المنتج غير موجود');
        }

        if (product.shopQty < quantity) {
            throw new Error(
                `كمية غير كافية في المحل. المتوفر: ${product.shopQty}, المطلوب: ${quantity}`
            );
        }

        // Transfer
        product.shopQty -= quantity;
        product.warehouseQty += quantity;
        await product.save();

        // Log movement
        const movementDocs = await StockMovement.create([{
            productId,
            type: 'TRANSFER_TO_WAREHOUSE',
            qty: quantity,
            note: note || 'تحويل من المحل إلى المخزن',
            createdBy: userId,
            snapshot: {
                warehouseQty: product.warehouseQty,
                shopQty: product.shopQty
            }
        }]);
        const movement = movementDocs[0];

        return { product, movement };
    },

    /**
     * Register initial balance during system handover
     */
    async registerInitialBalance(productId, warehouseQty, shopQty, buyPrice, userId) {
        const product = await Product.findById(productId);
        if (!product) throw new Error('not found');

        product.warehouseQty = warehouseQty;
        product.shopQty = shopQty;
        product.stockQty = warehouseQty + shopQty;
        product.buyPrice = buyPrice;

        await product.save();

        let movement = null;
        if (warehouseQty + shopQty > 0) {
            const movementDocs = await StockMovement.create([{
                productId,
                type: 'ADJUST',
                qty: warehouseQty + shopQty,
                note: 'رصيد افتتاحي',
                createdBy: userId,
                snapshot: {
                    warehouseQty,
                    shopQty
                }
            }]);
            movement = movementDocs[0];
        }

        return { product, movement };
    },

    /**
     * Adjust stock quantities (for inventory audits)
     */
    async adjustStock(productId, newWarehouseQty, newShopQty, reason, userId, session = null) {
        const product = await Product.findById(productId).session(session);

        if (!product) {
            throw new Error('المنتج غير موجود');
        }

        const oldWarehouseQty = product.warehouseQty;
        const oldShopQty = product.shopQty;

        // Set new quantities
        product.warehouseQty = newWarehouseQty;
        product.shopQty = newShopQty;
        product.stockQty = newWarehouseQty + newShopQty;
        await product.save({ session });

        const warehouseDiff = newWarehouseQty - oldWarehouseQty;
        const shopDiff = newShopQty - oldShopQty;

        // Log adjustment
        const movementDocs = await StockMovement.create([{
            productId,
            type: 'ADJUST',
            qty: Math.abs(warehouseDiff) + Math.abs(shopDiff),
            note: `تصحيح جرد: ${reason}. مخزن: ${oldWarehouseQty}→${newWarehouseQty}, محل: ${oldShopQty}→${newShopQty}`,
            createdBy: userId,
            snapshot: {
                warehouseQty: product.warehouseQty,
                shopQty: product.shopQty
            }
        }], { session });
        const movement = movementDocs[0];

        return { product, movement, warehouseDiff, shopDiff };
    },

    /**
     * Get stock movement history for a product
     */
    async getProductHistory(productId, limit = 50) {
        const query = productId ? { productId } : {};
        return await StockMovement.find(query)
            .sort({ date: -1 })
            .populate('productId', 'name code')
            .populate('createdBy', 'name')
            .lean();
    },

    /**
     * Get all stock movements for a date range
     */
    async getMovements(startDate, endDate, type = null) {
        const query = {
            date: {
                $gte: startDate,
                $lte: endDate
            }
        };

        if (type) {
            query.type = type;
        }

        return await StockMovement.find(query)
            .sort({ date: -1 })
            .populate('productId', 'name code')
            .populate('createdBy', 'name')
            .lean();
    },

    /**
     * Validate stock availability for multiple items
     */
    async validateStockAvailability(items) {
        const results = [];

        for (const item of items) {
            const product = await Product.findById(item.productId);

            if (!product) {
                results.push({
                    productId: item.productId,
                    available: false,
                    reason: 'المنتج غير موجود'
                });
                continue;
            }

            if (product.shopQty < item.qty) {
                results.push({
                    productId: item.productId,
                    name: product.name,
                    available: false,
                    requested: item.qty,
                    inStock: product.shopQty,
                    reason: 'كمية غير كافية'
                });
            } else {
                results.push({
                    productId: item.productId,
                    name: product.name,
                    available: true,
                    requested: item.qty,
                    inStock: product.shopQty
                });
            }
        }

        return results;
    },

    /**
     * Increase stock when returning items (Sales Return)
     * Stock is added back to SHOP (assuming returns go to front desk/shop)
     */
    async increaseStockForReturn(items, returnId, userId, session = null) {
        const results = [];

        for (const item of items) {
            const product = await Product.findById(item.productId);

            if (!product) {
                console.warn(`المنتج غير موجود عند الارتجاع: ${item.productId}`);
                continue;
            }

            // Increase shop quantity
            product.shopQty += item.qty;
            product.stockQty = product.warehouseQty + product.shopQty;
            await product.save({ session });

            // Log movement
            const movementDocs = await StockMovement.create([{
                productId: item.productId,
                type: 'IN', // Treated as IN but noted as Return
                qty: item.qty,
                note: `مرتجع مبيعات - إشعار ${returnId}`,
                refId: returnId,
                createdBy: userId,
                snapshot: {
                    warehouseQty: product.warehouseQty,
                    shopQty: product.shopQty
                }
            }], { session });
            const movement = movementDocs[0];

            results.push({ product, movement });
        }

        return results;
    },

    /**
     * Generic Move Stock (Consolidates all simple movements)
     */
    async moveStock({ productId, qty, type, userId, note, refId, isSystem = false }, session = null) {
        const quantity = Math.abs(Number(qty));
        if (quantity === 0) throw new Error('Quantity must be greater than 0');

        const product = await Product.findById(productId);
        if (!product) throw new Error('Product not found');

        let updateQuery = {};

        switch (type) {
            case 'IN':
                updateQuery = { $inc: { warehouseQty: quantity, stockQty: quantity } };
                break;

            case 'OUT':
                if (product.warehouseQty < quantity && !isSystem) {
                    throw new Error(`Insufficient warehouse stock. Available: ${product.warehouseQty}`);
                }
                updateQuery = { $inc: { warehouseQty: -quantity, stockQty: -quantity } };
                break;

            case 'SALE':
                if (product.shopQty < quantity && !isSystem) {
                    throw new Error(`Insufficient shop stock for sale. Available: ${product.shopQty}`);
                }
                updateQuery = { $inc: { shopQty: -quantity, stockQty: -quantity } };
                break;

            case 'TRANSFER_TO_SHOP':
                if (product.warehouseQty < quantity && !isSystem) {
                    throw new Error(`Insufficient warehouse stock for transfer. Available: ${product.warehouseQty}`);
                }
                updateQuery = { $inc: { warehouseQty: -quantity, shopQty: quantity } };
                break;

            case 'TRANSFER_TO_WAREHOUSE':
                if (product.shopQty < quantity && !isSystem) {
                    throw new Error(`Insufficient shop stock for transfer. Available: ${product.shopQty}`);
                }
                updateQuery = { $inc: { shopQty: -quantity, warehouseQty: quantity } };
                break;

            case 'ADJUST':
                if (note && note.toLowerCase().includes('shop')) {
                    updateQuery = { $inc: { shopQty: quantity, stockQty: quantity } };
                } else {
                    updateQuery = { $inc: { warehouseQty: quantity, stockQty: quantity } };
                }
                break;

            default:
                throw new Error('Invalid movement type');
        }

        const updatedProduct = await Product.findByIdAndUpdate(productId, updateQuery, { new: true, session });

        await StockMovement.create([{
            productId,
            type,
            qty: quantity,
            note: note || `Manual Move: ${type}`,
            refId,
            createdBy: userId,
            date: new Date(),
            snapshot: {
                warehouseQty: updatedProduct.warehouseQty,
                shopQty: updatedProduct.shopQty
            }
        }], { session });

        return updatedProduct;
    },

    async bulkMoveStock({ items, type, userId }, session = null) {
        await dbConnect();
        const results = [];

        for (const item of items) {
            const result = await this.moveStock({
                productId: item.productId,
                qty: item.qty,
                type: item.type || type,
                userId,
                note: item.note,
                isSystem: false
            }, session);
            results.push(result);
        }

        return results;
    }
};



