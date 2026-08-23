import PurchaseOrder from '../models/PurchaseOrder.js';
import { withTransaction } from '../utils/dbUtils.js';
import { nextDocumentNumber } from '../lib/counters.js';
import Supplier from '../models/Supplier.js';
import InvoiceSettings from '../models/InvoiceSettings.js';
import { FinanceService } from '../services/financeService.js';
import dbConnect from '../lib/db.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';

export const PurchaseOrderService = {
    async create(data, userId) {
        await dbConnect();

        const { supplierId, items, notes, paymentType = 'cash' } = data;
        let { expectedDate } = data;

        if (!expectedDate) {
            let terms = 15; // default
            if (supplierId) {
                const sup = await Supplier.findById(supplierId);
                if (sup && sup.supplyTerms > 0) terms = sup.supplyTerms;
            }
            // Could fetch settings fallback too
            const date = new Date();
            date.setDate(date.getDate() + terms);
            expectedDate = date;
        }

        let totalCost = 0;
        items.forEach(item => {
            totalCost += item.quantity * item.costPrice;
        });

        const po = await PurchaseOrder.create({
            poNumber: await nextDocumentNumber('PO'),
            supplier: supplierId,
            items,
            totalCost,
            expectedDate,
            notes,
            paymentType,
            createdBy: userId
        });

        return po;
    },

    async receive(id, paymentType, userId) {
        await dbConnect();
        const po = await PurchaseOrder.findById(id).populate('items.productId');
        if (!po) throw new NotFoundError('PO not found');
        if (po.status === 'RECEIVED') throw new ConflictError('Already received');

        // Finance & Stock Update (handled deep inside FinanceService based on previous route logic?)
        // The previous route called `FinanceService.recordPurchaseReceive(po, userId, paymentType)`.
        // This likely updates stock inside FinanceService OR StockService call. 
        // Based on `StockService.increaseStockForPurchase` seen earlier, FinanceService probably calls that.

        await FinanceService.recordPurchaseReceive(po, userId, paymentType);

        return await PurchaseOrder.findById(id); // Return updated PO
    },

    async getAll({ limit = 20, query = {} }) {
        await dbConnect();
        return await PurchaseOrder.find(query)
            .populate('supplier', 'name')
            .populate('items.productId', 'name code')
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    },

    async getById(id) {
        await dbConnect();
        const po = await PurchaseOrder.findById(id)
            .populate('supplier', 'name phone address')
            .populate('items.productId', 'name code')
            .lean();
        if (!po) throw new NotFoundError('أمر الشراء غير موجود');
        return po;
    },

    async updateStatus(id, { status, paymentType }, userId) {
        await dbConnect();

        if (status === 'RECEIVED') {
            // T-BIZ-04: all-or-nothing receive. The guarded transition happens
            // INSIDE the transaction — concurrent/double submit loses the race
            // deterministically with 409 and zero partial writes.
            await withTransaction(async (session) => {
                const po = await PurchaseOrder.findById(id).populate('items.productId').session(session);
                if (!po) throw new NotFoundError('أمر الشراء غير موجود');

                const result = await FinanceService.recordPurchaseReceive(
                    po, userId, paymentType || po.paymentType || 'cash', session
                );
                return result;
            });

            return await this.getById(id);
        }

        // Other status updates (e.g., CANCELLED, PENDING)
        const purchaseOrder = await PurchaseOrder.findById(id);
        if (!purchaseOrder) throw new NotFoundError('أمر الشراء غير موجود');
        purchaseOrder.status = status;
        await purchaseOrder.save();

        return await this.getById(id);
    },

    async delete(id) {
        await dbConnect();
        const po = await PurchaseOrder.findById(id);
        if (!po) throw new NotFoundError('أمر الشراء غير موجود');
        if (po.status === 'RECEIVED') throw new ConflictError('لا يمكن حذف أمر شراء مستلم');

        await PurchaseOrder.findByIdAndDelete(id);
        return { success: true };
    }
};



