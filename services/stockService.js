import Product from '../models/Product.js';
import { literalContains } from '../lib/safeRegex.js';
import { boundedRange, MAX_LIMIT } from '../lib/paginate.js';
import StockMovement from '../models/StockMovement.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import dbConnect from '../lib/db.js';
import { toIdString } from '../utils/idUtils.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';

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

        // T-DB-05: conditional atomic decrement — the DB enforces availability.
        const decrements = []; // {productId, field, qty} for compensating $inc on failure

        for (const item of trackableItems) {
            const pid = toIdString(item.productId);
            const product = productMap.get(pid);
            if (!product) throw new NotFoundError(`المنتج غير موجود: ${JSON.stringify(item.productId)}`);

            const source = item.source || 'shop';
            const qty = Number(item.qty);

            const guardField = source === 'warehouse' ? 'warehouseQty' : 'shopQty';
            bulkOps.push({
                updateOne: {
                    filter: { _id: product._id, [guardField]: { $gte: qty } },
                    update: {
                        $inc: source === 'warehouse'
                            ? { warehouseQty: -qty, stockQty: -qty }
                            : { shopQty: -qty, stockQty: -qty }
                    }
                }
            });

            movements.push({
                productId: product._id,
                type: 'SALE',
                qty: qty,
                note: `بيع من ${source === 'warehouse' ? 'المخزن' : 'المحل'} - فاتورة #${invoiceId}`,
                refId: invoiceId,
                createdBy: userId
            });

            decrements.push({ productId: product._id, guardField, qty, name: product.name });
        }

        if (bulkOps.length > 0) {
            const res = await Product.bulkWrite(bulkOps, { session, ordered: true });
            if (res.modifiedCount !== bulkOps.length) {
                // Compensate successful decrements, then fail loudly.
                if (!session && res.modifiedCount > 0) {
                    await Product.bulkWrite(decrements.slice(0, res.modifiedCount).map(d => ({
                        updateOne: {
                            filter: { _id: d.productId },
                            update: { $inc: d.guardField === 'warehouseQty'
                                ? { warehouseQty: d.qty, stockQty: d.qty }
                                : { shopQty: d.qty, stockQty: d.qty } }
                        }
                    })));
                }
                const failed = decrements[res.modifiedCount];
                throw new BadRequestError(
                    failed
                        ? `الكمية غير كافية في ${failed.guardField === 'warehouseQty' ? 'المخزن' : 'المتجر'}: ${failed.name}`
                        : 'فشل تحديث المخزون'
                );
            }

            // Movement ledger only after confirmed mutation; snapshots read back post-mutation.
            const updated = await Product.find({ _id: { $in: trackableItems.map(i => i.productId) } })
                .select('warehouseQty shopQty').session(session).lean();
            const snapMap = new Map(updated.map(p => [String(p._id), p]));
            for (const m of movements) {
                const snap = snapMap.get(String(m.productId));
                m.snapshot = snap ? { warehouseQty: snap.warehouseQty, shopQty: snap.shopQty } : {};
            }
            await StockMovement.insertMany(movements, { session });
        }

        return trackableItems.map(i => ({ product: productMap.get(toIdString(i.productId)) }));
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
            if (!product) throw new NotFoundError(`المنتج غير موجود: ${JSON.stringify(item.productId)}`);

            const currentStock = product.stockQty || 0;
            const currentCost = product.buyPrice || 0;
            const newQty = Number(item.quantity);
            const newCost = Number(item.costPrice || currentCost);

            let newAvgCost = currentCost;
            if (currentStock + newQty > 0) {
                const totalValue = (currentStock * currentCost) + (newQty * newCost);
                newAvgCost = totalValue / (currentStock + newQty);
            }

            // T-DB-05: atomic quantity increment; AVCO cost is recomputed from
            // the session read — inside a transaction concurrent receipts are
            // serialized, outside it the window is a single statement.
            const finalAvg = parseFloat(newAvgCost.toFixed(2));
            bulkOps.push({
                updateOne: {
                    filter: { _id: product._id },
                    update: {
                        $inc: { warehouseQty: newQty, stockQty: newQty },
                        $set: { buyPrice: finalAvg }
                    }
                }
            });
            product.warehouseQty = (product.warehouseQty || 0) + newQty;
            product.stockQty = (product.warehouseQty || 0) + (product.shopQty || 0);
            product.buyPrice = finalAvg;

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
            throw new NotFoundError('المنتج غير موجود');
        }

        // T-DB-05: conditional atomic transfer
        const updated = await Product.findOneAndUpdate(
            { _id: productId, warehouseQty: { $gte: quantity } },
            { $inc: { warehouseQty: -quantity, shopQty: quantity } },
            { new: true, session }
        );
        if (!updated) {
            throw new BadRequestError(
                `كمية غير كافية في المخزن. المتوفر: ${product.warehouseQty}, المطلوب: ${quantity}`
            );
        }

        // Log movement (after confirmed mutation)
        const movementDocs = await StockMovement.create([{
            productId,
            type: 'TRANSFER_TO_SHOP',
            qty: quantity,
            note: note || 'تحويل من المخزن إلى المحل',
            createdBy: userId,
            snapshot: {
                warehouseQty: updated.warehouseQty,
                shopQty: updated.shopQty
            }
        }], { session });
        const movement = movementDocs[0];

        return { product: updated, movement };
    },

    /**
     * Transfer stock from shop to warehouse
     */
    async transferToWarehouse(productId, quantity, userId, note = '', session = null) {
        const product = await Product.findById(productId).session(session);

        if (!product) {
            throw new NotFoundError('المنتج غير موجود');
        }

        // T-DB-05: conditional atomic transfer
        const updated = await Product.findOneAndUpdate(
            { _id: productId, shopQty: { $gte: quantity } },
            { $inc: { shopQty: -quantity, warehouseQty: quantity } },
            { new: true, session }
        );
        if (!updated) {
            throw new BadRequestError(
                `كمية غير كافية في المحل. المتوفر: ${product.shopQty}, المطلوب: ${quantity}`
            );
        }

        // Log movement (after confirmed mutation)
        const movementDocs = await StockMovement.create([{
            productId,
            type: 'TRANSFER_TO_WAREHOUSE',
            qty: quantity,
            note: note || 'تحويل من المحل إلى المخزن',
            createdBy: userId,
            snapshot: {
                warehouseQty: updated.warehouseQty,
                shopQty: updated.shopQty
            }
        }], { session });
        const movement = movementDocs[0];

        return { product: updated, movement };
    },

    /**
     * Register initial balance during system handover
     */
    async registerInitialBalance(productId, warehouseQty, shopQty, buyPrice, userId, session = null) {
        const product = await Product.findById(productId).session(session);
        if (!product) throw new NotFoundError('not found');

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
            throw new NotFoundError('المنتج غير موجود');
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

    /**
     * List active products with stock projections.
     * @param {{search?:string, lowStock?:boolean, outOfStock?:boolean}} filters
     */
    async listStock({ search, lowStock, outOfStock } = {}) {
        const filter = { isActive: true };

        if (search) {
            filter.$or = [
                { name: literalContains(search) },
                { code: literalContains(search) }
            ];
        }

        if (lowStock === true || lowStock === 'true') {
            filter.$expr = { $lte: ['$stockQty', '$minLevel'] };
        }

        if (outOfStock === true || outOfStock === 'true') {
            filter.stockQty = 0;
        }

        const products = await Product.find(filter)
            .select('name code stockQty warehouseQty shopQty minLevel buyPrice retailPrice')
            .sort({ name: 1 })
            .limit(100)
            .lean();

        return { products, count: products.length };
    },

    /** Same as listStock with no filters */
    async listStatus() {
        return this.listStock();
    },

    async getMovements(startDate, endDate, type = null) {
        // T-PERF-01: bounded window (default 30d as before, max 90d)
        const range = boundedRange({ startDate, endDate }, { defaultDays: 30, maxDays: 90 });
        const query = {
            date: {
                $gte: range.startDate,
                $lte: range.endDate
            }
        };

        if (type) {
            query.type = type;
        }

        return await StockMovement.find(query)
            .sort({ date: -1 })
            .limit(MAX_LIMIT * 5) // hard safety net
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
        if (quantity === 0) throw new BadRequestError('Quantity must be greater than 0');

        const product = await Product.findById(productId).session(session);
        if (!product) throw new NotFoundError('Product not found');

        let updateQuery;
        let guard = null; // T-DB-05: conditional decrement guard

        switch (type) {
            case 'IN':
                updateQuery = { $inc: { warehouseQty: quantity, stockQty: quantity } };
                break;

            case 'OUT':
                guard = { warehouseQty: { $gte: quantity } };
                updateQuery = { $inc: { warehouseQty: -quantity, stockQty: -quantity } };
                break;

            case 'SALE':
                guard = { shopQty: { $gte: quantity } };
                updateQuery = { $inc: { shopQty: -quantity, stockQty: -quantity } };
                break;

            case 'TRANSFER_TO_SHOP':
                guard = { warehouseQty: { $gte: quantity } };
                updateQuery = { $inc: { warehouseQty: -quantity, shopQty: quantity } };
                break;

            case 'TRANSFER_TO_WAREHOUSE':
                guard = { shopQty: { $gte: quantity } };
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
                throw new BadRequestError('Invalid movement type');
        }

        // System moves skip guards (isSystem) — internal flows own their integrity.
        const updatedProduct = await Product.findOneAndUpdate(
            guard && !isSystem ? { _id: productId, ...guard } : { _id: productId },
            updateQuery,
            { new: true, session }
        );
        if (!updatedProduct) {
            throw new BadRequestError(`Insufficient stock for ${type}. Requested: ${quantity}`);
        }

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
            let guardField = null; // T-DB-05: guarded decrements

            // Simplified logic for bulk moves
            if (activeType === 'IN') update = { $inc: { warehouseQty: quantity, stockQty: quantity } };
            else if (activeType === 'OUT') { update = { $inc: { warehouseQty: -quantity, stockQty: -quantity } }; guardField = 'warehouseQty'; }
            else if (activeType === 'SALE') { update = { $inc: { shopQty: -quantity, stockQty: -quantity } }; guardField = 'shopQty'; }
            else if (activeType === 'TRANSFER_TO_SHOP') { update = { $inc: { warehouseQty: -quantity, shopQty: quantity } }; guardField = 'warehouseQty'; }
            else if (activeType === 'TRANSFER_TO_WAREHOUSE') { update = { $inc: { shopQty: -quantity, warehouseQty: quantity } }; guardField = 'shopQty'; }
            else if (activeType === 'ADJUST') {
                if (item.note && item.note.toLowerCase().includes('shop')) update = { $inc: { shopQty: quantity, stockQty: quantity } };
                else update = { $inc: { warehouseQty: quantity, stockQty: quantity } };
            }

            bulkOps.push({
                updateOne: {
                    filter: guardField
                        ? { _id: product._id, [guardField]: { $gte: quantity } }
                        : { _id: product._id },
                    update
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
            // T-DB-05: bulkWrite + post-check verification with compensating $inc
            const res = await Product.bulkWrite(bulkOps, { session, ordered: true });
            if (res.modifiedCount !== bulkOps.length && res.modifiedCount > 0) {
                await Product.bulkWrite(bulkOps.slice(0, res.modifiedCount).map(op => ({
                    updateOne: {
                        filter: { _id: op.updateOne.filter._id },
                        update: {
                            $inc: Object.fromEntries(
                                Object.entries(op.updateOne.update.$inc).map(([k, v]) => [k, -v])
                            )
                        }
                    }
                })), { session });
            }
            if (res.modifiedCount !== bulkOps.length) {
                throw new BadRequestError(
                    `فشل نقل دفعة من الأصناف: تم تحديث ${res.modifiedCount} من ${bulkOps.length}`
                );
            }
            await StockMovement.insertMany(movements.slice(0, res.modifiedCount), { session });
        }

        return results;
    }
};



