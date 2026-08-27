import { SaleService } from './financial/saleService.js';
import { PurchaseService } from './financial/purchaseService.js';
import { PaymentService } from './financial/paymentService.js';
import { ReturnService } from './financial/returnService.js';
import { ExpenseService } from './financial/expenseService.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';

/**
 * Finance Service
 * Facade for all financial and stock operations.
 * Delegates actual logic to domain-specific services.
 */
export const FinanceService = {
    /**
     * Record a Sale (Invoice)
     */
    async recordSale(invoice, userId) {
        return SaleService.recordSale(invoice, userId);
    },

    /**
     * Reverse a Sale (Delete Invoice Logic)
     */
    async reverseSale(invoiceId, userId) {
        return SaleService.reverseSale(invoiceId, userId);
    },

    /**
     * Record a Purchase (Receiving PO)
     */
    async recordPurchaseReceive(po, userId, paymentType = 'cash') {
        return PurchaseService.recordPurchaseReceive(po, userId, paymentType);
    },

    /**
     * Helper: Update schedules after a payment
     */
    async updateSchedulesAfterPayment(entityId, entityType, amount) {
        return PaymentService.updateSchedulesAfterPayment(entityId, entityType, amount);
    },

    /**
     * Record a Payment Collection
     */
    async recordCustomerPayment(invoice, amount, method, note, userId) {
        return PaymentService.recordCustomerPayment(invoice, amount, method, note, userId);
    },

    /**
     * Record a Total Customer Payment (Unified Collection)
     */
    async recordTotalCustomerPayment(customerId, amount, method, note, userId) {
        return PaymentService.recordTotalCustomerPayment(customerId, amount, method, note, userId);
    },

    /**
     * Record a Supplier Payment (Paying debts)
     */
    async recordSupplierPayment(po, amount, method, note, userId) {
        return PaymentService.recordSupplierPayment(po, amount, method, note, userId);
    },

    /**
     * Process a Sales Return
     */
    async processSaleReturn(invoice, returnData, refundMethod, userId) {
        return ReturnService.processSaleReturn(invoice, returnData, refundMethod, userId);
    },

    /**
     * Record a General Expense
     */
    async recordExpense(data, userId) {
        return ExpenseService.recordExpense(data, userId);
    },

    /**
     * Record payment for Manual Debt
     */
    async recordManualDebtPayment(debt, amount, method, note, userId) {
        return PaymentService.recordManualDebtPayment(debt, amount, method, note, userId);
    },

    /**
     * Consistently settle debts
     */
    async settleDebt(data, userId) {
        return PaymentService.settleDebt(data, userId);
    },

    /**
     * Generic payments dispatcher: routes a payment to the right handler
     * based on which entity id is present (debt > supplier > customer).
     */
    async resolvePayment({ debtId, supplierId, customerId, amount, method, note }, userId) {
        if (debtId) {
            const Debt = (await import('../models/Debt.js')).default;
            const debt = await Debt.findById(debtId);
            if (!debt) throw new NotFoundError('الدين غير موجود');
            return this.recordManualDebtPayment(debt, amount, method, note, userId);
        }
        if (supplierId) {
            const PurchaseOrder = (await import('../models/PurchaseOrder.js')).default;
            const po = await PurchaseOrder.findOne({ supplier: supplierId, status: 'RECEIVED', paymentStatus: { $ne: 'paid' } });
            if (!po) throw new NotFoundError('لا توجد طلبات شراء مستلمة غير مدفوعة');
            return this.recordSupplierPayment(po, amount, method, note, userId);
        }
        if (customerId) {
            return this.recordTotalCustomerPayment(customerId, amount, method, note, userId);
        }
        throw new BadRequestError('يجب تحديد العميل أو المورد أو الدين');
    }
};




