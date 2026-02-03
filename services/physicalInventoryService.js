import PhysicalInventory from '../models/PhysicalInventory.js';
import Product from '../models/Product.js';
import { StockService } from './stockService.js';
// import { AccountingService } from './accountingService.js';
import { LogService } from './logService.js';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import dbConnect from '../lib/db.js';
import mongoose from 'mongoose';

/**
 * Physical Inventory Service
 * Handles physical stock counts and reconciliation
 */
export const PhysicalInventoryService = {
    /**
     * Create a new physical inventory count
     */
    async createCount(location, userId, options = {}) {
        await dbConnect();
        const { category, isBlind } = options;

        // Build product query
        const productQuery = { isActive: true };
        if (category && category !== 'all') {
            productQuery.category = category;
        }

        // Load products
        const products = await Product.find(productQuery)
            .select('_id name code warehouseQty shopQty buyPrice category')
            .lean();

        // Prepare items based on location
        const items = products.map(product => {
            let systemQty = 0;

            if (location === 'warehouse') {
                systemQty = product.warehouseQty || 0;
            } else if (location === 'shop') {
                systemQty = product.shopQty || 0;
            } else if (location === 'both') {
                systemQty = (product.warehouseQty || 0) + (product.shopQty || 0);
            }

            return {
                productId: product._id,
                productName: product.name,
                productCode: product.code,
                systemQty,
                actualQty: !!isBlind ? 0 : systemQty, // [FIX] Zero if blind, else system qty
                buyPrice: product.buyPrice
            };
        });

        const count = await PhysicalInventory.create({
            date: new Date(),
            location,
            category: category === 'all' ? null : category,
            isBlind: !!isBlind,
            items,
            status: 'draft',
            createdBy: userId
        });

        return count;
    },

    /**
     * Update actual quantities in a count
     */
    async updateActualQuantities(countId, itemUpdates, userId) {
        await dbConnect();

        const count = await PhysicalInventory.findById(countId);

        if (!count) {
            throw new Error('سجل الجرد غير موجود');
        }

        if (count.status !== 'draft') {
            throw new Error('لا يمكن تعديل جرد مكتمل');
        }

        // Update actual quantities
        for (const update of itemUpdates) {
            // Extract ID if it's an object (populated) or just use the ID string
            const updateProductId = update.productId?._id ? update.productId._id.toString() : update.productId?.toString();

            const item = count.items.find(
                i => i.productId.toString() === updateProductId
            );

            if (item) {
                item.actualQty = update.actualQty;
                if (update.reason) {
                    item.reason = update.reason;
                }
                if (update.justification) {
                    item.justification = update.justification;
                }
                if (update.justificationReason) {
                    item.justificationReason = update.justificationReason;
                }
            }
        }

        await count.save();

        return count;
    },

    /**
     * Calculate discrepancies for a count
     */
    async calculateDiscrepancies(countId) {
        await dbConnect();

        const count = await PhysicalInventory.findById(countId);

        if (!count) {
            throw new Error('سجل الجرد غير موجود');
        }

        const discrepancies = count.items
            .filter(item => item.difference !== 0)
            .map(item => ({
                productId: item.productId,
                productName: item.productName,
                productCode: item.productCode,
                systemQty: item.systemQty,
                actualQty: item.actualQty,
                difference: item.difference,
                value: item.value,
                reason: item.reason
            }));

        return {
            totalShortage: count.totalShortage,
            totalSurplus: count.totalSurplus,
            netDifference: count.netDifference,
            valueImpact: count.valueImpact,
            discrepancies
        };
    },

    /**
     * Complete count and generate adjustments
     */
    async completeCount(countId, userId) {
        await dbConnect();
        // [MOD] Transaction Removed for Standalone Compatibility
        // const session = await mongoose.startSession();
        // session.startTransaction();

        try {
            const count = await PhysicalInventory.findById(countId).populate('items.productId'); // .session(session);

            if (!count) {
                throw new Error('سجل الجرد غير موجود');
            }

            if (count.status !== 'draft') {
                throw new Error('الجرد مكتمل بالفعل');
            }

            // Complete the count
            await count.complete(userId); // session);

            // [NEW] Log Action
            await LogService.logAction({
                userId,
                action: 'COMPLETE_INVENTORY',
                entity: 'PhysicalInventory',
                entityId: count._id,
                diff: { valueImpact: count.valueImpact, netDifference: count.netDifference },
                note: `Inventory count completed for ${count.location}`
            }); // session);

            // Generate stock adjustments for discrepancies
            const adjustments = [];

            for (const item of count.items) {
                if (item.difference !== 0) {
                    const product = await Product.findById(item.productId); // .session(session);

                    if (!product) continue;

                    let newWarehouseQty = product.warehouseQty;
                    let newShopQty = product.shopQty;

                    // Adjust based on location
                    if (count.location === 'warehouse') {
                        newWarehouseQty = item.actualQty;
                    } else if (count.location === 'shop') {
                        newShopQty = item.actualQty;
                    } else if (count.location === 'both') {
                        // Proportional adjustment
                        const totalStock = (product.warehouseQty || 0) + (product.shopQty || 0);

                        if (totalStock > 0) {
                            const ratio = (product.warehouseQty || 0) / totalStock;
                            newWarehouseQty = Math.round(item.actualQty * ratio);
                            newShopQty = item.actualQty - newWarehouseQty;
                        } else {
                            // If total stock was zero, put everything in warehouse by default
                            newWarehouseQty = item.actualQty;
                            newShopQty = 0;
                        }
                    }

                    // Use stock service to adjust
                    const adjustment = await StockService.adjustStock(
                        item.productId,
                        newWarehouseQty,
                        newShopQty,
                        `جرد فعلي - ${item.reason || 'تصحيح الكمية'}`,
                        userId
                    ); // session);

                    adjustments.push(adjustment);
                }
            }

            // Create accounting entries - REMOVED (Accounting System Deprecated)
            // await AccountingService.createInventoryAdjustmentEntries(count, userId); // session);

            // await session.commitTransaction();

            return {
                count,
                adjustments,
                totalAdjustments: adjustments.length
            };
        } catch (error) {
            // await session.abortTransaction();
            throw error;
        } finally {
            // session.endSession();
        }
    },

    /**
     * Get all physical counts with filters
     */
    async getCounts({ location, status, startDate, endDate } = {}) {
        await dbConnect();

        const query = {};

        if (location) query.location = location;
        if (status) query.status = status;

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        return await PhysicalInventory.find(query)
            .sort({ date: -1 })
            .populate('createdBy', 'name')
            .populate('approvedBy', 'name')
            .lean();
    },

    /**
     * Get count by ID with full details
     */
    async getCountById(countId) {
        await dbConnect();

        return await PhysicalInventory.findById(countId)
            .populate('items.productId', 'name code')
            .populate('createdBy', 'name')
            .populate('approvedBy', 'name')
            .lean();
    },

    /**
     * Delete a draft count
     */
    async deleteCount(countId, userId) {
        await dbConnect();

        const count = await PhysicalInventory.findById(countId);

        if (!count) {
            throw new Error('سجل الجرد غير موجود');
        }

        if (count.status !== 'draft') {
            throw new Error('لا يمكن حذف جرد مكتمل');
        }

        await PhysicalInventory.findByIdAndDelete(countId);

        return { success: true };
    },

    /**
     * Generate physical inventory report
     */
    async generateReport(countId) {
        await dbConnect();

        const count = await this.getCountById(countId);

        if (!count) {
            throw new Error('سجل الجرد غير موجود');
        }

        const discrepancies = count.items.filter(item => item.difference !== 0);
        const shortages = discrepancies.filter(item => item.difference < 0);
        const surpluses = discrepancies.filter(item => item.difference > 0);

        return {
            count,
            summary: {
                totalItems: count.items.length,
                totalDiscrepancies: discrepancies.length,
                shortages: shortages.length,
                surpluses: surpluses.length,
                totalShortage: count.totalShortage,
                totalSurplus: count.totalSurplus,
                netDifference: count.netDifference,
                valueImpact: count.valueImpact
            },
            discrepancies: discrepancies.map(item => ({
                productName: item.productName,
                productCode: item.productCode,
                systemQty: item.systemQty,
                actualQty: item.actualQty,
                difference: item.difference,
                value: item.value,
                reason: item.reason
            }))
        };
    },

    /**
     * Unlock a completed count for modification (Owner only)
     */
    async unlockCount(countId, password, userId) {
        await dbConnect();
        // [MOD] Transaction Removed for Standalone Compatibility
        // const session = await mongoose.startSession();
        // session.startTransaction();

        try {
            const count = await PhysicalInventory.findById(countId); // .session(session);
            if (!count) throw new Error('سجل الجرد غير موجود');
            if (count.status !== 'completed') throw new Error('الجرد غير مكتمل بالفعل');

            // Find the owner user to verify password
            const owner = await User.findOne({ role: 'owner' }); // .session(session);
            if (!owner) throw new Error('لا يوجد مالك مسجل في النظام');

            // Verify password
            const isValid = await bcrypt.compare(password, owner.password);
            if (!isValid) throw new Error('كلمة المرور غير صحيحة');

            // Revert status to draft
            count.status = 'draft';
            count.approvedBy = null;
            count.approvedAt = null;
            await count.save(); // { session });

            // Log action
            await LogService.logAction({
                userId,
                action: 'UNLOCK_INVENTORY',
                entity: 'PhysicalInventory',
                entityId: count._id,
                note: `Inventory count unlocked by owner for modification`
            }); // session);

            // await session.commitTransaction();
            return count;
        } catch (error) {
            // await session.abortTransaction();
            throw error;
        } finally {
            // session.endSession();
        }
    },
};



