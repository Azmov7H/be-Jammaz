import Product from '../models/Product.js';
import Warehouse from '../models/Warehouse.js';
import { literalContains } from '../lib/safeRegex.js';
import { boundedRange, MAX_LIMIT } from '../lib/paginate.js';
import StockMovement from '../models/StockMovement.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import dbConnect from '../lib/db.js';
import { toIdString } from '../utils/idUtils.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';

/**
 * Multi-warehouse helpers (WH-05).
 *
 * A missing/blank warehouseId means the PRIMARY warehouse (legacy semantics):
 * its stock lives in Product.warehouseQty. Any concrete warehouseId targets the
 * additive Product.warehouseStocks slot array. Slot mutations use guarded
 * atomic operators so availability is enforced by the database (T-DB-05).
 */
export const isPrimaryWarehouse = (warehouseId) =>
    warehouseId === null || warehouseId === undefined || warehouseId === '' || String(warehouseId) === 'null';

/**
 * Map a warehouse selector to a canonical side: `null` for the primary
 * warehouse, otherwise the given id. Passing the primary warehouse's own _id
 * is resolved to null so callers cannot accidentally create a slot for it.
 */
async function normalizeWarehouseSide(warehouseId, session) {
    if (isPrimaryWarehouse(warehouseId)) return null;
    const primary = await Warehouse.findOne({ isPrimary: true }).select('_id').session(session).lean();
    if (primary && String(primary._id) === String(warehouseId)) return null;
    return warehouseId;
}

/**
 * Build a Mongo update doc from `{inc, set}` option objects (T-DB-05).
 */
function buildUpdate(inc, set) {
    const update = {};
    if (inc && Object.keys(inc).length) update.$inc = inc;
    if (set && Object.keys(set).length) update.$set = set;
    return update;
}

/**
 * Atomically credit `qty` into a warehouse. Creates the slot when absent.
 * @returns {Promise<object>} mongoose update result
 */
async function creditWarehouse(productId, warehouseId, qty, session, { inc = {}, set = {} } = {}) {
    if (isPrimaryWarehouse(warehouseId)) {
        return Product.updateOne(
            { _id: productId },
            buildUpdate({ warehouseQty: qty, stockQty: qty, ...inc }, set),
            { session }
        );
    }

    const slotUpdate = buildUpdate({ 'warehouseStocks.$.qty': qty, stockQty: qty, ...inc }, set);
    const res = await Product.updateOne(
        { _id: productId, 'warehouseStocks.warehouseId': warehouseId },
        slotUpdate,
        { session }
    );
    if (res.matchedCount > 0) return res;

    // Slot does not exist yet — create it, then credit.
    await Product.updateOne(
        { _id: productId, 'warehouseStocks.warehouseId': { $ne: warehouseId } },
        { $push: { warehouseStocks: { warehouseId, qty: 0 } } },
        { session }
    );
    return Product.updateOne(
        { _id: productId, 'warehouseStocks.warehouseId': warehouseId },
        slotUpdate,
        { session }
    );
}

/**
 * Debit `qty` from a warehouse with a database-enforced availability guard.
 * @returns {Promise<object|null>} updated product, or null when insufficient
 */
async function debitWarehouse(productId, warehouseId, qty, session, { inc = {}, set = {}, syncStockQty = true } = {}) {
    if (isPrimaryWarehouse(warehouseId)) {
        return Product.findOneAndUpdate(
            { _id: productId, warehouseQty: { $gte: qty } },
            buildUpdate({ warehouseQty: -qty, ...(syncStockQty ? { stockQty: -qty } : {}), ...inc }, set),
            { new: true, session }
        );
    }
    return Product.findOneAndUpdate(
        { _id: productId, warehouseStocks: { $elemMatch: { warehouseId, qty: { $gte: qty } } } },
        buildUpdate({ 'warehouseStocks.$.qty': -qty, ...(syncStockQty ? { stockQty: -qty } : {}), ...inc }, set),
        { new: true, session }
    );
}

/**
 * Absolutely set a warehouse's stock to `newQty` (stock adjustments / counts).
 * The caller is responsible for any `stockQty` delta via `inc`.
 */
async function setWarehouseQty(productId, warehouseId, newQty, session, { inc = {}, set = {} } = {}) {
    if (isPrimaryWarehouse(warehouseId)) {
        return Product.updateOne(
            { _id: productId },
            buildUpdate(inc, { warehouseQty: newQty, ...set }),
            { session }
        );
    }
    const res = await Product.updateOne(
        { _id: productId, 'warehouseStocks.warehouseId': warehouseId },
        buildUpdate(inc, { 'warehouseStocks.$.qty': newQty, ...set }),
        { session }
    );
    if (res.matchedCount > 0) return res;
    await Product.updateOne(
        { _id: productId },
        {
            $push: { warehouseStocks: { warehouseId, qty: newQty } },
            ...(Object.keys(inc).length ? { $inc: inc } : {}),
            ...(Object.keys(set).length ? { $set: set } : {})
        },
        { session }
    );
    return res;
}

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
            const warehouseId = item.warehouseId;

            let filter;
            let update;
            let compensateFilter;
            let compensateUpdate;
            let label;

            if (source === 'warehouse' && !isPrimaryWarehouse(warehouseId)) {
                // Non-primary warehouse slot.
                filter = { _id: product._id, warehouseStocks: { $elemMatch: { warehouseId, qty: { $gte: qty } } } };
                update = { $inc: { 'warehouseStocks.$.qty': -qty, stockQty: -qty } };
                compensateFilter = { _id: product._id, 'warehouseStocks.warehouseId': warehouseId };
                compensateUpdate = { $inc: { 'warehouseStocks.$.qty': qty, stockQty: qty } };
                label = 'المخزن';
            } else if (source === 'warehouse') {
                filter = { _id: product._id, warehouseQty: { $gte: qty } };
                update = { $inc: { warehouseQty: -qty, stockQty: -qty } };
                compensateFilter = { _id: product._id };
                compensateUpdate = { $inc: { warehouseQty: qty, stockQty: qty } };
                label = 'المخزن';
            } else {
                filter = { _id: product._id, shopQty: { $gte: qty } };
                update = { $inc: { shopQty: -qty, stockQty: -qty } };
                compensateFilter = { _id: product._id };
                compensateUpdate = { $inc: { shopQty: qty, stockQty: qty } };
                label = 'المتجر';
            }

            bulkOps.push({ updateOne: { filter, update } });

            movements.push({
                productId: product._id,
                type: 'SALE',
                qty: qty,
                note: `بيع من ${source === 'warehouse' ? 'المخزن' : 'المحل'} - فاتورة #${invoiceId}`,
                refId: invoiceId,
                warehouseId: source === 'warehouse' ? (warehouseId || undefined) : undefined,
                createdBy: userId
            });

            decrements.push({ productId: product._id, compensateFilter, compensateUpdate, name: product.name, label });
        }

        if (bulkOps.length > 0) {
            const res = await Product.bulkWrite(bulkOps, { session, ordered: true });
            if (res.modifiedCount !== bulkOps.length) {
                // Compensate successful decrements, then fail loudly.
                if (!session && res.modifiedCount > 0) {
                    await Product.bulkWrite(decrements.slice(0, res.modifiedCount).map(d => ({
                        updateOne: { filter: d.compensateFilter, update: d.compensateUpdate }
                    })));
                }
                const failed = decrements[res.modifiedCount];
                throw new BadRequestError(
                    failed
                        ? `الكمية غير كافية في ${failed.label}: ${failed.name}`
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
        const slotCredits = [];
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
            const warehouseId = item.warehouseId;

            if (isPrimaryWarehouse(warehouseId)) {
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
            } else {
                // Non-primary warehouse slot: atomic credit against the slot.
                slotCredits.push({ productId: product._id, warehouseId, qty: newQty, buyPrice: finalAvg });
                const slot = (product.warehouseStocks || []).find(s => String(s.warehouseId) === String(warehouseId));
                if (slot) slot.qty = (slot.qty || 0) + newQty;
                else product.warehouseStocks.push({ warehouseId, qty: newQty });
                product.stockQty = (product.stockQty || 0) + newQty;
            }
            product.buyPrice = finalAvg;

            // Prepare movement log
            movements.push({
                productId: product._id,
                type: 'IN',
                qty: newQty,
                note: `شراء - أمر #${poId} (Cost: ${newCost}, NewAvg: ${product.buyPrice})`,
                refId: poId,
                warehouseId: warehouseId || undefined,
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
        }
        for (const credit of slotCredits) {
            await creditWarehouse(credit.productId, credit.warehouseId, credit.qty, session, {
                set: { buyPrice: credit.buyPrice }
            });
        }
        if (movements.length > 0) {
            await StockMovement.insertMany(movements, { session });
        }

        return results;
    },

    /**
     * Transfer stock from warehouse to shop
     * @param {string} [warehouseId] optional non-primary warehouse source
     */
    async transferToShop(productId, quantity, userId, note = '', session = null, warehouseId = null) {
        const product = await Product.findById(productId).session(session);

        if (!product) {
            throw new NotFoundError('المنتج غير موجود');
        }

        // T-DB-05: conditional atomic transfer (DB enforces availability).
        // Moving within a product does not change total stockQty.
        const updated = await debitWarehouse(productId, warehouseId, quantity, session, {
            inc: { shopQty: quantity },
            syncStockQty: false
        });
        if (!updated) {
            const available = isPrimaryWarehouse(warehouseId)
                ? product.warehouseQty
                : ((product.warehouseStocks || []).find(s => String(s.warehouseId) === String(warehouseId))?.qty || 0);
            throw new BadRequestError(
                `كمية غير كافية في المخزن. المتوفر: ${available}, المطلوب: ${quantity}`
            );
        }

        // Log movement (after confirmed mutation)
        const movementDocs = await StockMovement.create([{
            productId,
            type: 'TRANSFER_TO_SHOP',
            qty: quantity,
            note: note || 'تحويل من المخزن إلى المحل',
            warehouseId: warehouseId || undefined,
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
     * @param {string} [warehouseId] optional non-primary warehouse destination
     */
    async transferToWarehouse(productId, quantity, userId, note = '', session = null, warehouseId = null) {
        let updated;
        if (isPrimaryWarehouse(warehouseId)) {
            // Single atomic sub-bucket move (stockQty unchanged).
            updated = await Product.findOneAndUpdate(
                { _id: productId, shopQty: { $gte: quantity } },
                { $inc: { shopQty: -quantity, warehouseQty: quantity } },
                { new: true, session }
            );
        } else {
            // Guard shop availability atomically, then credit the slot.
            const debited = await Product.findOneAndUpdate(
                { _id: productId, shopQty: { $gte: quantity } },
                { $inc: { shopQty: -quantity, stockQty: -quantity } },
                { new: true, session }
            );
            if (debited) {
                await creditWarehouse(productId, warehouseId, quantity, session);
                updated = await Product.findById(productId).session(session);
            }
        }
        if (!updated) {
            const product = await Product.findById(productId).session(session);
            if (!product) throw new NotFoundError('المنتج غير موجود');
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
            warehouseId: warehouseId || undefined,
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
     * Transfer stock between two warehouses (either side may be primary).
     * A null/absent id means the PRIMARY warehouse; passing the primary
     * warehouse's own _id is resolved to the primary slot as well.
     * @param {string|null} fromWarehouseId source warehouse id (null = primary)
     * @param {string|null} toWarehouseId destination warehouse id (null = primary)
     */
    async transferBetweenWarehouses(productId, quantity, userId, fromWarehouseId, toWarehouseId, note = '', session = null) {
        const product = await Product.findById(productId).session(session);
        if (!product) throw new NotFoundError('المنتج غير موجود');

        const from = await normalizeWarehouseSide(fromWarehouseId, session);
        const to = await normalizeWarehouseSide(toWarehouseId, session);

        const bothPrimary = from === null && to === null;
        const sameNonPrimary = from !== null && to !== null && String(from) === String(to);
        if (bothPrimary || sameNonPrimary) {
            throw new BadRequestError('لا يمكن التحويل إلى نفس المخزن');
        }

        const debited = await debitWarehouse(productId, from, quantity, session);
        if (!debited) {
            const available = isPrimaryWarehouse(from)
                ? product.warehouseQty
                : ((product.warehouseStocks || []).find(s => String(s.warehouseId) === String(from))?.qty || 0);
            throw new BadRequestError(
                `كمية غير كافية في المخزن المصدر. المتوفر: ${available}, المطلوب: ${quantity}`
            );
        }
        await creditWarehouse(productId, to, quantity, session);

        const updated = await Product.findById(productId).session(session);

        const movementDocs = await StockMovement.create([{
            productId,
            type: 'TRANSFER',
            qty: quantity,
            note: note || 'تحويل بين المخازن',
            fromWarehouseId: from || undefined,
            toWarehouseId: to || undefined,
            createdBy: userId,
            snapshot: {
                warehouseQty: updated ? updated.warehouseQty : debited.warehouseQty,
                shopQty: updated ? updated.shopQty : debited.shopQty
            }
        }], { session });
        return { product: updated, movement: movementDocs[0] };
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

        // Set new quantities. stockQty must also include the additive per-warehouse
        // slots so multi-warehouse totals are preserved (no-op when none exist).
        const slotTotals = (product.warehouseStocks || []).reduce((sum, s) => sum + (s.qty || 0), 0);
        product.warehouseQty = newWarehouseQty;
        product.shopQty = newShopQty;
        product.stockQty = newWarehouseQty + newShopQty + slotTotals;
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
     * Adjust a single location to an absolute quantity (route-level contract:
     * { productId, location: 'shop'|'warehouse', newQty, reason }).
     * Keeps the other location untouched and delegates to adjustStock.
     */
    async adjustStockLocation(productId, location, newQty, reason, userId, session = null, warehouseId = null) {
        const product = await Product.findById(productId).session(session);

        if (!product) {
            throw new NotFoundError('المنتج غير موجود');
        }

        if (location !== 'shop' && location !== 'warehouse') {
            throw new BadRequestError('الموقع يجب أن يكون shop أو warehouse');
        }

        // Non-primary warehouse slot adjustment.
        if (location === 'warehouse' && !isPrimaryWarehouse(warehouseId)) {
            const slot = (product.warehouseStocks || []).find(s => String(s.warehouseId) === String(warehouseId));
            const oldQty = slot ? (slot.qty || 0) : 0;
            const qty = Number(newQty);
            if (qty === oldQty) {
                throw new BadRequestError('لا يوجد تغيير في الكمية');
            }
            const diff = qty - oldQty;
            await setWarehouseQty(productId, warehouseId, qty, session, { inc: { stockQty: diff } });
            const updated = await Product.findById(productId).session(session);

            const movementDocs = await StockMovement.create([{
                productId,
                type: 'ADJUST',
                qty: Math.abs(diff),
                note: `تصحيح جرد: ${reason}. مخزن: ${oldQty}→${qty}`,
                warehouseId: warehouseId || undefined,
                createdBy: userId,
                snapshot: {
                    warehouseQty: updated ? updated.warehouseQty : product.warehouseQty,
                    shopQty: updated ? updated.shopQty : product.shopQty
                }
            }], { session });

            return { product: updated, movement: movementDocs[0], warehouseDiff: diff, shopDiff: 0 };
        }

        const newWarehouseQty = location === 'warehouse' ? newQty : product.warehouseQty;
        const newShopQty = location === 'shop' ? newQty : product.shopQty;

        if (newWarehouseQty === product.warehouseQty && newShopQty === product.shopQty) {
            throw new BadRequestError('لا يوجد تغيير في الكمية');
        }

        return this.adjustStock(productId, newWarehouseQty, newShopQty, reason, userId, session);
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
    async moveStock({ productId, qty, type, userId, note, refId, isSystem = false, warehouseId = null }, session = null) {
        const quantity = Math.abs(Number(qty));
        if (quantity === 0) throw new BadRequestError('Quantity must be greater than 0');

        const product = await Product.findById(productId).session(session);
        if (!product) throw new NotFoundError('Product not found');

        // Multi-warehouse (non-primary) paths route through the slot helpers.
        if (!isPrimaryWarehouse(warehouseId)) {
            if (type === 'IN' || type === 'ADJUST') {
                await creditWarehouse(productId, warehouseId, quantity, session);
            } else if (type === 'OUT') {
                const debited = await debitWarehouse(productId, warehouseId, quantity, session);
                if (!debited) throw new BadRequestError(`Insufficient stock for ${type}. Requested: ${quantity}`);
            } else if (type === 'TRANSFER_TO_SHOP') {
                const debited = await debitWarehouse(productId, warehouseId, quantity, session, { inc: { shopQty: quantity }, syncStockQty: false });
                if (!debited) throw new BadRequestError(`Insufficient stock for ${type}. Requested: ${quantity}`);
            } else if (type === 'TRANSFER_TO_WAREHOUSE') {
                const debited = await Product.findOneAndUpdate(
                    { _id: productId, shopQty: { $gte: quantity } },
                    { $inc: { shopQty: -quantity, stockQty: -quantity } },
                    { new: true, session }
                );
                if (!debited) throw new BadRequestError(`Insufficient stock for ${type}. Requested: ${quantity}`);
                await creditWarehouse(productId, warehouseId, quantity, session);
            } else {
                throw new BadRequestError('Invalid movement type');
            }

            const slotProduct = await Product.findById(productId).session(session);
            await StockMovement.create([{
                productId,
                type,
                qty: quantity,
                note: note || `Manual Move: ${type}`,
                refId,
                warehouseId: warehouseId || undefined,
                createdBy: userId,
                date: new Date(),
                snapshot: {
                    warehouseQty: slotProduct.warehouseQty,
                    shopQty: slotProduct.shopQty
                }
            }], { session });
            return slotProduct;
        }

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

            // Non-primary warehouse items are handled individually (slot creation,
            // guards) via moveStock; primary items stay in the bulk fast path.
            if (item.warehouseId && !isPrimaryWarehouse(item.warehouseId)) {
                const moved = await this.moveStock({
                    productId: item.productId,
                    qty: quantity,
                    type: activeType,
                    userId,
                    note: item.note,
                    warehouseId: item.warehouseId
                }, session);
                results.push(moved);
                continue;
            }

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



