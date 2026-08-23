import dbConnect from '../../lib/db.js';
import PO from '../../models/PurchaseOrder.js';
import { withTransaction } from '../../utils/dbUtils.js';

// Sprint 05 fault-injection hook (tests only)
const faultInject = (point) => {
    if (process.env.FAULT_INJECT === point) {
        throw new Error(`[FAULT_INJECT] aborted at ${point}`);
    }
};
import { NotFoundError, ConflictError } from '../../lib/errors.js';
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
    async recordPurchaseReceive(po, userId, paymentType = 'cash', session = null) {
        await dbConnect();
        // T-BIZ-04: caller may own the transaction (updateStatus); otherwise
        // we wrap our own.
        if (session) return this._doReceive(po, userId, paymentType, session);
        return withTransaction((txnSession) => this._doReceive(po, userId, paymentType, txnSession));
    },

    async _doReceive(po, userId, paymentType, sess) {
        // T-BIZ-04: single-save flow; guarded idempotent transition at the end.
        // 1. Stock increase
            await StockService.increaseStockForPurchase(po.items, po._id, userId, sess);

            faultInject('recordPurchaseReceive:afterStock');

            // 2. Treasury & Supplier Balance
            if (paymentType !== 'credit') {
                po.paidAmount = po.totalCost;
                po.paymentStatus = 'paid';
                await TreasuryService.recordPurchaseExpense(po, userId, sess);
            } else {
                po.paidAmount = 0;
                po.paymentStatus = 'pending';
                if (po.supplier) {
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
                    }, sess);
                }
            }

            // 3. Guarded idempotent transition — second receive attempt in any
            // concurrent path lands here with 409 and aborts its whole txn.
            const claimed = await PO.findOneAndUpdate(
                { _id: po._id, status: { $ne: 'RECEIVED' } },
                {
                    $set: {
                        status: 'RECEIVED',
                        receivedDate: new Date(),
                        paymentType,
                        paidAmount: po.paidAmount,
                        paymentStatus: po.paymentStatus
                    }
                },
                { new: true, session: sess }
            );
            if (!claimed) throw new ConflictError('أمر الشراء مستلم بالفعل');

            Object.assign(po, claimed.toObject());
            return po;
    },
};



