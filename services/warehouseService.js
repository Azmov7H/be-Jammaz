import mongoose from 'mongoose';
import Warehouse from '../models/Warehouse.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import { LogService } from './logService.js';
import { NotFoundError, BadRequestError, ForbiddenError, ConflictError } from '../lib/errors.js';
import { withTransaction } from '../utils/dbUtils.js';
import dbConnect from '../lib/db.js';
import { parsePagination, MAX_LIMIT } from '../lib/paginate.js';
import { literalContains } from '../lib/safeRegex.js';

const OPEN_PO_STATUSES = ['PENDING'];

/**
 * Warehouse Service (WH-01..WH-04)
 *
 * Multi-warehouse model compatible with the legacy schema:
 *  - The PRIMARY warehouse is stored implicitly in Product.warehouseQty
 *    (unchanged legacy field).
 *  - Every ADDITIONAL warehouse holds its stock in the additive
 *    Product.warehouseStocks slot array.
 *  - stockQty (product save hook) always equals warehouseQty + shopQty +
 *    Σ warehouseStocks.qty, so all existing reports keep working.
 */
export const WarehouseService = {
    /**
     * Idempotent bootstrap: guarantee exactly one primary warehouse exists.
     * Safe to call on every boot and from scripts.
     */
    async ensurePrimaryWarehouse() {
        await dbConnect();
        const existing = await Warehouse.findOne({ isPrimary: true });
        if (existing) return existing;

        // Promote an existing warehouse if one is present, otherwise seed.
        const anyWarehouse = await Warehouse.findOne().sort({ createdAt: 1 });
        if (anyWarehouse) {
            anyWarehouse.isPrimary = true;
            await anyWarehouse.save();
            return anyWarehouse;
        }

        return Warehouse.create({
            name: 'المخزن الرئيسي',
            code: 'MAIN',
            isPrimary: true,
            isActive: true
        });
    },

    async getPrimaryWarehouse() {
        await dbConnect();
        return Warehouse.findOne({ isPrimary: true }).lean();
    },

    /**
     * List warehouses with pagination + optional search / active filter.
     */
    async list({ search, isActive, page, limit } = {}) {
        await dbConnect();
        const { page: p, limit: cappedLimit, skip } = parsePagination({ page, limit });

        const filter = {};
        if (isActive !== undefined && isActive !== '' && isActive !== null) {
            filter.isActive = isActive === true || isActive === 'true';
        }
        if (search) {
            filter.$or = [
                { name: literalContains(search) },
                { code: literalContains(search) }
            ];
        }

        const [warehouses, total] = await Promise.all([
            Warehouse.find(filter).sort({ isPrimary: -1, createdAt: 1 }).skip(skip).limit(cappedLimit).lean(),
            Warehouse.countDocuments(filter)
        ]);

        return { warehouses, total, page: p, limit: cappedLimit };
    },

    async getById(id) {
        await dbConnect();
        const warehouse = await Warehouse.findById(id).lean();
        if (!warehouse) throw new NotFoundError('المخزن غير موجود');
        return warehouse;
    },

    /**
     * Create an additional warehouse. The primary warehouse is seeded, never
     * created through the API, so isPrimary is always forced to false here.
     */
    async create(data, userId) {
        await dbConnect();
        const warehouse = await Warehouse.create({
            name: data.name.trim(),
            code: data.code.trim(),
            address: data.address,
            isPrimary: false,
            isActive: true,
            createdBy: userId
        });

        await LogService.logAction({
            userId,
            action: 'CREATE_WAREHOUSE',
            entity: 'Warehouse',
            entityId: warehouse._id,
            diff: { name: warehouse.name, code: warehouse.code }
        });

        return warehouse;
    },

    /**
     * Update mutable warehouse fields. isPrimary can never be changed via this
     * path (the primary is a fixed system entity), and the primary cannot be
     * deactivated.
     */
    async update(id, data, userId) {
        await dbConnect();
        const warehouse = await Warehouse.findById(id);
        if (!warehouse) throw new NotFoundError('المخزن غير موجود');

        if (warehouse.isPrimary && data.isActive === false) {
            throw new ForbiddenError('لا يمكن تعطيل المخزن الرئيسي');
        }

        const before = { name: warehouse.name, code: warehouse.code, address: warehouse.address, isActive: warehouse.isActive };

        if (data.name !== undefined) warehouse.name = data.name;
        if (data.code !== undefined) warehouse.code = data.code;
        if (data.address !== undefined) warehouse.address = data.address;
        if (data.isActive !== undefined) warehouse.isActive = data.isActive;

        await warehouse.save();

        await LogService.logAction({
            userId,
            action: 'UPDATE_WAREHOUSE',
            entity: 'Warehouse',
            entityId: warehouse._id,
            diff: { before, after: { name: warehouse.name, code: warehouse.code, address: warehouse.address, isActive: warehouse.isActive } }
        });

        return warehouse;
    },

    /**
     * Aggregate the stock currently held in a warehouse.
     * @returns {{totalUnits:number, affectedProducts:number}}
     */
    async _stockSummary(warehouseId) {
        const [agg] = await Product.aggregate([
            { $unwind: '$warehouseStocks' },
            {
                $match: {
                    'warehouseStocks.warehouseId': new mongoose.Types.ObjectId(warehouseId),
                    'warehouseStocks.qty': { $gt: 0 }
                }
            },
            {
                $group: {
                    _id: null,
                    totalUnits: { $sum: '$warehouseStocks.qty' },
                    affectedProducts: { $sum: 1 }
                }
            }
        ]);

        return {
            totalUnits: agg?.totalUnits || 0,
            affectedProducts: agg?.affectedProducts || 0
        };
    },

    async _openPurchaseOrders(warehouseId) {
        return PurchaseOrder.countDocuments({
            status: { $in: OPEN_PO_STATUSES },
            $or: [
                { warehouseId: new mongoose.Types.ObjectId(warehouseId) },
                { 'items.warehouseId': new mongoose.Types.ObjectId(warehouseId) }
            ]
        });
    },

    /**
     * Pre-flight used by the UI to decide whether a delete needs a destination
     * warehouse + explicit confirmation. Never mutates anything.
     */
    async deletionPreflight(id) {
        await dbConnect();
        const warehouse = await Warehouse.findById(id).lean();
        if (!warehouse) throw new NotFoundError('المخزن غير موجود');

        if (warehouse.isPrimary) {
            return {
                canDelete: false,
                reason: 'PRIMARY',
                message: 'المخزن الرئيسي لا يمكن حذفه',
                warehouse
            };
        }

        const { totalUnits, affectedProducts } = await this._stockSummary(id);
        const openPurchaseOrders = await this._openPurchaseOrders(id);

        const destinations = await Warehouse.find({ _id: { $ne: id }, isActive: true })
            .select('_id name code isPrimary')
            .sort({ isPrimary: -1, name: 1 })
            .lean();

        return {
            canDelete: true,
            reason: null,
            isPrimary: false,
            requiresDestination: totalUnits > 0,
            requiresConfirmation: totalUnits > 0,
            totalUnits,
            affectedProducts,
            blockedByPurchaseOrders: openPurchaseOrders > 0,
            openPurchaseOrders,
            availableDestinations: destinations
        };
    },

    /**
     * Delete a warehouse under logical constraints:
     *  - primary warehouse is immutable (403)
     *  - if it holds stock, a destination warehouse AND confirmed=true are
     *    required; stock is relocated atomically and audited
     *  - warehouses referenced by open purchase orders cannot be deleted
     */
    async deleteWarehouse(id, { destinationWarehouseId, confirmed } = {}, userId) {
        await dbConnect();

        const warehouse = await Warehouse.findById(id);
        if (!warehouse) throw new NotFoundError('المخزن غير موجود');
        if (warehouse.isPrimary) throw new ForbiddenError('المخزن الرئيسي لا يمكن حذفه');

        const { totalUnits, affectedProducts } = await this._stockSummary(id);

        // Resolve destination up-front so the guard fails fast (before any txn).
        let destination = null;
        if (destinationWarehouseId) {
            if (String(destinationWarehouseId) === String(id)) {
                throw new BadRequestError('لا يمكن اختيار نفس المخزن كمقصد');
            }
            destination = await Warehouse.findById(destinationWarehouseId);
            if (!destination) throw new NotFoundError('المخزن المقصد غير موجود');
            if (!destination.isActive) throw new BadRequestError('المخزن المقصد غير نشط');
        }

        if (totalUnits > 0) {
            if (!destination) {
                throw new ConflictError(
                    'يجب تحديد مخزن مقصد لنقل المخزون قبل الحذف',
                    { requiresDestination: true, totalUnits, affectedProducts }
                );
            }
            if (confirmed !== true) {
                throw new ConflictError(
                    'يجب تأكيد عملية حذف المخزن',
                    { requiresConfirmation: true, totalUnits, affectedProducts }
                );
            }
        }

        const openPurchaseOrders = await this._openPurchaseOrders(id);
        if (openPurchaseOrders > 0) {
            throw new ConflictError(
                `لا يمكن حذف المخزن لوجود ${openPurchaseOrders} أمر شراء مفتوح مرتبط به`,
                { blockedByPurchaseOrders: true, openPurchaseOrders }
            );
        }

        return withTransaction(async (session) => {
            const products = await Product.find({ 'warehouseStocks.warehouseId': id }).session(session);
            const movements = [];

            for (const product of products) {
                const source = (product.warehouseStocks || [])
                    .find((s) => String(s.warehouseId) === String(id));
                const qty = source ? (source.qty || 0) : 0;

                // Drop the source slot from every product (including empty slots).
                product.warehouseStocks = (product.warehouseStocks || [])
                    .filter((s) => String(s.warehouseId) !== String(id));

                if (qty > 0 && destination) {
                    if (destination.isPrimary) {
                        product.warehouseQty = (product.warehouseQty || 0) + qty;
                    } else {
                        const dst = product.warehouseStocks
                            .find((s) => String(s.warehouseId) === String(destination._id));
                        if (dst) dst.qty = (dst.qty || 0) + qty;
                        else product.warehouseStocks.push({ warehouseId: destination._id, qty });
                    }

                    // Total stock is conserved by relocation → stockQty unchanged.
                    await product.save({ session });

                    movements.push({
                        productId: product._id,
                        type: 'TRANSFER',
                        qty,
                        note: `تصفية مخزن "${warehouse.name}" إلى "${destination.name}"`,
                        refId: String(warehouse._id),
                        createdBy: userId,
                        snapshot: {
                            warehouseQty: product.warehouseQty,
                            shopQty: product.shopQty
                        }
                    });
                } else {
                    // Only empty slots removed — stockQty is unaffected.
                    await product.save({ session });
                }
            }

            if (movements.length > 0) {
                await StockMovement.insertMany(movements, { session });
            }

            await LogService.logAction({
                userId,
                action: 'DELETE_WAREHOUSE',
                entity: 'Warehouse',
                entityId: warehouse._id,
                diff: {
                    name: warehouse.name,
                    code: warehouse.code,
                    relocatedUnits: totalUnits,
                    affectedProducts,
                    destinationWarehouseId: destination ? String(destination._id) : null
                }
            }, session);

            await Warehouse.deleteOne({ _id: warehouse._id }).session(session);

            return {
                deleted: true,
                warehouseId: String(warehouse._id),
                relocatedUnits: totalUnits,
                affectedProducts,
                destinationWarehouseId: destination ? String(destination._id) : null
            };
        });
    },

    /** Re-exported for tests. */
    MAX_LIMIT
};
