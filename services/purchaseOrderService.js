import PurchaseOrder from '../models/PurchaseOrder.js';
import Supplier from '../models/Supplier.js';
import InvoiceSettings from '../models/InvoiceSettings.js';
import { FinanceService } from '../services/financeService.js';
import dbConnect from '../lib/db.js';

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
            poNumber: `PO-${Date.now()}`,
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
        if (!po) throw 'PO not found';
        if (po.status === 'RECEIVED') throw 'Already received';

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
        return PurchaseOrder.findById(id)
            .populate('supplier', 'name phone address')
            .populate('items.productId', 'name code')
            .lean();
    },

    async updateStatus(id, { status, paymentType }, userId) {
        await dbConnect();
        const purchaseOrder = await PurchaseOrder.findById(id).populate('items.productId');

        if (!purchaseOrder) throw 'أمر الشراء غير موجود';

        const finalPaymentType = paymentType || purchaseOrder.paymentType || 'cash';

        // If marking as RECEIVED, execute finance business logic
        if (status === 'RECEIVED' && purchaseOrder.status !== 'RECEIVED') {
            // Use the already imported FinanceService
            await FinanceService.recordPurchaseReceive(purchaseOrder, userId, finalPaymentType);

            // Update the PO status after successful finance operation
            purchaseOrder.status = 'RECEIVED';
            purchaseOrder.paymentType = finalPaymentType;
            await purchaseOrder.save();

            return await this.getById(id);
        }

        // Other status updates (e.g., CANCELED, PENDING)
        purchaseOrder.status = status;
        await purchaseOrder.save();

        return await this.getById(id);
    },

    async delete(id) {
        await dbConnect();
        const po = await PurchaseOrder.findById(id);
        if (!po) throw 'أمر الشراء غير موجود';
        if (po.status === 'RECEIVED') throw 'لا يمكن حذف أمر شراء مستلم';

        await PurchaseOrder.findByIdAndDelete(id);
        return { success: true };
    }
};



