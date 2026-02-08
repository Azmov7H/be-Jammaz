import dbConnect from '../../lib/db.js';
import { StockService } from '../stockService.js';
import { TreasuryService } from '../treasuryService.js';
import { DebtService } from './debtService.js';
import InvoiceSettings from '../../models/InvoiceSettings.js';

/**
 * Purchase Service
 * Handles recording purchases and updating supplier/stock status
 */
export const PurchaseService = {
    /**
     * Record a Purchase (Receiving PO)
     */
    async recordPurchaseReceive(po, userId, paymentType = 'cash') {
        await dbConnect();
        try {
            // 1. Stock increase
            await StockService.increaseStockForPurchase(po.items, po._id, userId);

            // 2. Update PO status
            po.status = 'RECEIVED';
            po.receivedDate = new Date();
            po.paymentType = paymentType;
            await po.save();

            // 3. Treasury & Supplier Balance
            if (paymentType !== 'credit') {
                po.paidAmount = po.totalCost;
                po.paymentStatus = 'paid';
                await po.save();
                await TreasuryService.recordPurchaseExpense(po, userId);
            } else if (po.supplier) {
                // Credit
                po.paidAmount = 0;
                po.paymentStatus = 'pending';
                await po.save();

                const settings = await InvoiceSettings.getSettings();
                const defaultDays = settings.defaultSupplierTerms || 30;

                await DebtService.createDebt({
                    debtorType: 'Supplier',
                    debtorId: po.supplier,
                    amount: po.totalCost,
                    dueDate: po.expectedDate || new Date(Date.now() + defaultDays * 24 * 60 * 60 * 1000),
                    referenceType: 'PurchaseOrder',
                    referenceId: po._id,
                    description: `أمر شراء #${po.poNumber}`,
                    createdBy: userId
                });
            }

            return po;
        } catch (error) {
            throw error;
        }
    }
};



