import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import dbConnect from '../lib/db.js';
import { toIdString } from '../utils/idUtils.js';

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
        const trackableItems = items.filter(item => !item.isService && item.productId);
        if (trackableItems.length === 0) return [];

        const productIds = trackableItems.map(item => item.productId);
        const products = await Product.find({ _id: { $in: productIds } }).session(session);
        const productMap = new Map(products.map(p => [toIdString(p), p]));

        const bulkOps = [];
        const movements = [];
        const results = [];

        for (const item of trackableItems) {
            const pid = toIdString(item.productId);
            const product = productMap.get(pid);
            if (!product) throw new Error(`المنتج غير موجود: ${JSON.stringify(item.productId)}`);

            const source = item.source || 'shop';
            const qty = Number(item.qty);

            // 1. Validate & Update Quantities
            if (source === 'warehouse') {
                if (product.warehouseQty < qty) throw new Error(`الكمية غير كافية في المخزن: ${product.name}`);
                product.warehouseQty -= qty;
            } else {
                if (product.shopQty < qty) throw new Error(`الكمية غير كافية في المتجر: ${product.name}`);
                product.shopQty -= qty;
            }
            product.stockQty = (product.warehouseQty || 0) + (product.shopQty || 0);

            // 2. Build Bulk Op
            bulkOps.push({
                updateOne: {
                    filter: { _id: product._id },
                    update: {
                        $set: {
                            warehouseQty: product.warehouseQty,
                            shopQty: product.shopQty,
                            stockQty: product.stockQty
                        }
                    }
                }
            });

            // 3. Build Movement Log
            movements.push({
                productId: product._id,
                type: 'SALE',
                qty: qty,
                note: `بيع من ${source === 'warehouse' ? 'المخزن' : 'المحل'} - فاتورة #${invoiceId}`,
                refId: invoiceId,
                createdBy: userId,
                snapshot: { warehouseQty: product.warehouseQty, shopQty: product.shopQty }
            });

            results.push({ product });
        }

        if (bulkOps.length > 0) {
            await Product.bulkWrite(bulkOps, { session });
            await StockMovement.insertMany(movements, { session });
        }

        return results;
    },

    /**
     * Increase stock when receiving purchase order
     * Stock is ALWAYS added to WAREHOUSE
     * IMPLEMENTS: Weighted Average Cost (AVCO)
     */
    /**
     * Increase stock when receiving purchase order
     * Stock is ALWAYS added to WAREHOUSE
     * IMPLEMENTS: Weighted Average Cost (AVCO)
     */
    async increaseStockForPurchase(items, poId, userId, session = null) {
        const results = [];
        const productIds = items.map(item => item.productId);

        // 1. Fetch all products in one query
        const products = await Product.find({ _id: { $in: productIds } }).session(session);
        const productMap = new Map(products.map(p => [toIdString(p), p]));

        const bulkOps = [];
        const movements = [];

        for (const item of items) {
            const pid = toIdString(item.productId);
            const product = productMap.get(pid);
            if (!product) throw new Error(`المنتج غير موجود: ${JSON.stringify(item.productId)}`);

            const currentStock = product.stockQty || 0;
            const currentCost = product.buyPrice || 0;
            const newQty = Number(item.quantity);
            const newCost = Number(item.costPrice || currentCost);

            let newAvgCost = currentCost;
            if (currentStock + newQty > 0) {
                const totalValue = (currentStock * currentCost) + (newQty * newCost);
                newAvgCost = totalValue / (currentStock + newQty);
            }

            // Update local state
            product.warehouseQty = (product.warehouseQty || 0) + newQty;
            product.stockQty = (product.warehouseQty || 0) + (product.shopQty || 0);
            product.buyPrice = parseFloat(newAvgCost.toFixed(2));

            // Add to bulk update operations
            bulkOps.push({
                updateOne: {
                    filter: { _id: product._id },
                    update: {
                        $set: {
                            warehouseQty: product.warehouseQty,
                            stockQty: product.stockQty,
                            buyPrice: product.buyPrice
                        }
                    }
                }
            });

            // Prepare movement log
            movements.push({
                productId: product._id,
                type: 'IN',
                qty: newQty,
                note: `شراء - أمر #${poId} (Cost: ${newCost}, NewAvg: ${product.buyPrice})`,
                refId: poId,
                createdBy: userId,
                snapshot: {
                    warehouseQty: product.warehouseQty,
                    shopQty: product.shopQty
                }
            });

            results.push({ product, newAvgCost: product.buyPrice });
        }

        // 4. Execute bulk updates
        if (bulkOps.length > 0) {
            await Product.bulkWrite(bulkOps, { session });
            await StockMovement.insertMany(movements, { session });
        }

        return results;
    },

    /**
     * Transfer stock from warehouse to shop
     */
    async transferToShop(productId, quantity, userId, note = '', session = null) {
        const product = await Product.findById(productId).session(session);

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
        await product.save({ session });

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
        }], { session });
        const movement = movementDocs[0];

        return { product, movement };
    },

    /**
     * Transfer stock from shop to warehouse
     */
    async transferToWarehouse(productId, quantity, userId, note = '', session = null) {
        const product = await Product.findById(productId).session(session);

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
        await product.save({ session });

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
        }], { session });
        const movement = movementDocs[0];

        return { product, movement };
    },

    /**
     * Register initial balance during system handover
     */
    async registerInitialBalance(productId, warehouseQty, shopQty, buyPrice, userId, session = null) {
        const product = await Product.findById(productId).session(session);
        if (!product) throw new Error('not found');

        product.warehouseQty = warehouseQty;
        product.shopQty = shopQty;
        product.stockQty = warehouseQty + shopQty;
        product.buyPrice = buyPrice;

        await product.save({ session });

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
            }], { session });
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
     * Validate stock availability for multiple items (Optimized)
     */
    async validateStockAvailability(items) {
        const productIds = items.map(item => item.productId);
        const products = await Product.find({ _id: { $in: productIds } }).lean();
        const productMap = new Map(products.map(p => [toIdString(p), p]));

        const results = [];
        for (const item of items) {
            const pid = toIdString(item.productId);
            const product = productMap.get(pid);

            if (!product) {
                results.push({
                    productId: item.productId,
                    available: false,
                    reason: 'المنتج غير موجود'
                });
                continue;
            }

            const inStock = product.shopQty || 0;
            if (inStock < item.qty) {
                results.push({
                    productId: item.productId,
                    name: product.name,
                    available: false,
                    requested: item.qty,
                    inStock: inStock,
                    reason: 'كمية غير كافية'
                });
            } else {
                results.push({
                    productId: item.productId,
                    name: product.name,
                    available: true,
                    requested: item.qty,
                    inStock: inStock
                });
            }
        }

        return results;
    },

    /**
     * Increase stock when returning items (Sales Return)
     * Stock is added back to SHOP (assuming returns go to front desk/shop)
     */
    async increaseStockForReturn(items, returnId, userId, session = null, customNote = null) {
        const results = [];
        const productIds = items.map(item => item.productId?._id || item.productId).filter(Boolean);

        const products = await Product.find({ _id: { $in: productIds } }).session(session);
        const productMap = new Map(products.map(p => [toIdString(p), p]));

        const bulkOps = [];
        const movements = [];

        for (const item of items) {
            const pid = toIdString(item.productId?._id || item.productId);
            const product = productMap.get(pid);
            if (!product) continue;

            const qty = Number(item.qty || item.quantity || 0);
            if (qty === 0) continue;

            // Increase shop quantity locally for movement snapshot
            const newShopQty = (product.shopQty || 0) + qty;

            bulkOps.push({
                updateOne: {
                    filter: { _id: product._id },
                    update: { $inc: { shopQty: qty, stockQty: qty } }
                }
            });

            movements.push({
                productId: product._id,
                type: 'IN',
                qty: qty,
                note: customNote || `مرتجع مبيعات - إشعار ${returnId}`,
                refId: returnId,
                createdBy: userId,
                snapshot: {
                    warehouseQty: product.warehouseQty,
                    shopQty: newShopQty
                }
            });

            results.push({ product });
        }

        if (bulkOps.length > 0) {
            await Product.bulkWrite(bulkOps, { session });
            await StockMovement.insertMany(movements, { session });
        }

        return results;
    },

    /**
     * Generic Move Stock (Consolidates all simple movements)
     */
    async moveStock({ productId, qty, type, userId, note, refId, isSystem = false }, session = null) {
        const quantity = Math.abs(Number(qty));
        if (quantity === 0) throw new Error('Quantity must be greater than 0');

        const product = await Product.findById(productId).session(session);
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

    /**
     * Optimized Bulk Move Stock
     */
    async bulkMoveStock({ items, type, userId }, session = null) {
        await dbConnect();

        const productIds = items.map(item => item.productId);
        const products = await Product.find({ _id: { $in: productIds } }).session(session);
        const productMap = new Map(products.map(p => [toIdString(p), p]));

        const bulkOps = [];
        const movements = [];
        const results = [];

        for (const item of items) {
            const pid = toIdString(item.productId);
            const product = productMap.get(pid);
            if (!product) continue;

            const quantity = Math.abs(Number(item.qty));
            const activeType = item.type || type;
            let update = {};

            // Simplified logic for bulk moves
            if (activeType === 'IN') update = { $inc: { warehouseQty: quantity, stockQty: quantity } };
            else if (activeType === 'OUT') update = { $inc: { warehouseQty: -quantity, stockQty: -quantity } };
            else if (activeType === 'SALE') update = { $inc: { shopQty: -quantity, stockQty: -quantity } };
            else if (activeType === 'TRANSFER_TO_SHOP') update = { $inc: { warehouseQty: -quantity, shopQty: quantity } };
            else if (activeType === 'TRANSFER_TO_WAREHOUSE') update = { $inc: { shopQty: -quantity, warehouseQty: quantity } };
            else if (activeType === 'ADJUST') {
                if (item.note && item.note.toLowerCase().includes('shop')) update = { $inc: { shopQty: quantity, stockQty: quantity } };
                else update = { $inc: { warehouseQty: quantity, stockQty: quantity } };
            }

            bulkOps.push({
                updateOne: {
                    filter: { _id: product._id },
                    update: update
                }
            });

            movements.push({
                productId: product._id,
                type: activeType,
                qty: quantity,
                note: item.note || `Bulk Move: ${activeType}`,
                createdBy: userId,
                snapshot: { // Approximation for bulk moves
                    warehouseQty: product.warehouseQty,
                    shopQty: product.shopQty
                }
            });

            results.push(product);
        }

        if (bulkOps.length > 0) {
            await Product.bulkWrite(bulkOps, { session });
            await StockMovement.insertMany(movements, { session });
        }

        return results;
    }
};



