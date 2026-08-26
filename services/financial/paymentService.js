import dbConnect from '../../lib/db.js';
import { withTransaction, withRetry } from '../../utils/dbUtils.js';

// Sprint 05 fault-injection hook (tests only; unset in production)
const faultInject = (point) => {
    if (process.env.FAULT_INJECT === point) {
        throw new Error(`[FAULT_INJECT] aborted at ${point}`);
    }
};
import Invoice from '../../models/Invoice.js';
import Customer from '../../models/Customer.js';
import { TreasuryService } from '../treasuryService.js';
import { DebtService } from './debtService.js';
import { NotFoundError, BadRequestError } from '../../lib/errors.js';

/**
 * Payment Service
 * Handles collections, debt payments, and schedules.
 */
export const PaymentService = {
    /**
     * Helper: Update schedules after a payment
     */
    async updateSchedulesAfterPayment(entityId, entityType, amount, session = null) {
        const PaymentSchedule = (await import('../../models/PaymentSchedule.js')).default;

        const schedules = await PaymentSchedule.find({
            entityId,
            entityType,
            status: { $in: ['PENDING', 'OVERDUE'] }
        }).sort({ dueDate: 1 }).session(session);

        let remaining = amount;

        for (const schedule of schedules) {
            if (remaining <= 0) break;

            if (remaining >= schedule.amount) {
                remaining -= schedule.amount;
                schedule.amount = 0;
                schedule.status = 'PAID';
                schedule.paidAt = new Date();
                await schedule.save({ session });
            } else {
                schedule.amount -= remaining;
                remaining = 0;
                await schedule.save({ session });
            }
        }
    },

    /**
     * Record a Payment Collection
     */
    async recordCustomerPayment(invoice, amount, method, note, userId) {
        await dbConnect();
        // T-BIZ-01: all-or-nothing across invoice/debt/customer/treasury/cashbox
        return withRetry(() => withTransaction(async (session) => {
            await invoice.recordPayment(amount, method, note, userId, session);

            faultInject('recordCustomerPayment:afterInvoice');

            if (invoice.customer) {
                await this.updateSchedulesAfterPayment(invoice.customer, 'Customer', amount, session);

                const Debt = (await import('../../models/Debt.js')).default;
                const debt = await Debt.findOne({ referenceType: 'Invoice', referenceId: invoice._id }).session(session);
                if (debt) {
                    await DebtService.updateBalance(debt._id, amount, session);
                } else {
                    await Customer.findByIdAndUpdate(invoice.customer, { $inc: { balance: -amount } }, { session });
                }
            }

            let meta = {};
            if (invoice.customer) {
                const updatedCustomer = await Customer.findById(invoice.customer).session(session);
                if (updatedCustomer) {
                    meta.customerBalanceAfter = updatedCustomer.balance;
                }
            }

            const tx = await TreasuryService.recordPaymentCollection(invoice, amount, userId, method, note, meta, session);
            return { invoice, transaction: tx };
        }));
    },

    /**
     * Record a Total Customer Payment (Unified Collection)
     */
    async recordTotalCustomerPayment(customerId, amount, method, note, userId) {
        await dbConnect();
        // T-BIZ-01: unified collection — debt loop + credit + treasury in one txn
        return withRetry(() => withTransaction(async (session) => {
            const customer = await Customer.findById(customerId).session(session);
            if (!customer) throw new NotFoundError('العميل غير موجود');

            const Debt = (await import('../../models/Debt.js')).default;

            const activeDebts = await Debt.find({
                debtorId: customerId,
                debtorType: 'Customer',
                status: { $in: ['active', 'overdue'] }
            }).sort({ dueDate: 1 }).session(session);

            if (activeDebts.length === 0 && customer.balance <= 0) {
                throw new NotFoundError('لا توجد ديون مستحقة لهذا العميل');
            }

            let remainingAmount = amount;
            const appliedPayments = [];

            for (const debt of activeDebts) {
                if (remainingAmount <= 0) break;

                const paymentToApply = Math.min(debt.remainingAmount, remainingAmount);
                if (paymentToApply > 0) {
                    faultInject('recordTotalCustomerPayment:midLoop');
                    await DebtService.updateBalance(debt._id, paymentToApply, session);

                    if (debt.referenceType === 'Invoice') {
                        // Atomic capped increment + status recompute (T-DB-06 primitive)
                        await Invoice.findOneAndUpdate(
                            { _id: debt.referenceId },
                            [
                                { $set: {
                                    paidAmount: { $min: [{ $add: [{ $ifNull: ['$paidAmount', 0] }, paymentToApply] }, '$total'] }
                                } },
                                { $set: {
                                    paymentStatus: {
                                        $cond: [{ $gte: ['$paidAmount', '$total'] }, 'paid',
                                            { $cond: [{ $gt: ['$paidAmount', 0] }, 'partial', 'pending'] }]
                                    }
                                } }
                            ],
                            { session }
                        );
                    }

                    remainingAmount -= paymentToApply;
                    appliedPayments.push({
                        debtId: debt._id,
                        reference: debt.referenceType === 'Invoice' ? `Invoice #${debt.referenceId}` : 'Manual Debt',
                        amountApplied: paymentToApply
                    });
                }
            }

            if (remainingAmount > 0) {
                // Remaining amount becomes a general credit (reducing the balance)
                await Customer.findByIdAndUpdate(customerId, { $inc: { balance: -remainingAmount } }, { session });
            }

            await this.updateSchedulesAfterPayment(customerId, 'Customer', amount, session);

            // Refetch customer to get the accurate final balance
            const finalCustomer = await Customer.findById(customerId).session(session);

            const tx = await TreasuryService.recordUnifiedCollection(
                customer,
                amount,
                userId,
                method,
                note || `تحصيل مجمع من الرصيد الإجمالي - ${appliedPayments.length} مديونية`,
                {
                    customerBalanceAfter: finalCustomer ? finalCustomer.balance : customer.balance,
                    appliedPaymentsCount: appliedPayments.length
                },
                session
            );

            return { success: true, transaction: tx, appliedPayments };
        }));
    },

    /**
     * Record a Supplier Payment (Paying debts)
     */
    async recordSupplierPayment(po, amount, method, note, userId) {
        await dbConnect();

        // FIX (Sprint 08): callers pass a bare PO id (frontend) or stub —
        // resolve the real document first, otherwise _id reads undefined.
        const PurchaseOrder = (await import('../../models/PurchaseOrder.js')).default;
        const poDoc = await PurchaseOrder.findById(po?._id ?? po);
        if (!poDoc) throw new NotFoundError('أمر الشراء غير موجود');

        // T-BIZ-01: PO + debt/supplier + treasury in one txn
        return withRetry(() => withTransaction(async (session) => {
            const po = poDoc;
            // Atomic capped increment on the PO (T-DB-06 primitive)
            const updatedPo = await po.constructor.findOneAndUpdate(
                { _id: po._id },
                [
                    { $set: {
                        paidAmount: { $min: [{ $add: [{ $ifNull: ['$paidAmount', 0] }, amount] }, '$totalCost'] }
                    } },
                    { $set: {
                        paymentStatus: {
                            $cond: [{ $gte: ['$paidAmount', '$totalCost'] }, 'paid',
                                { $cond: [{ $gt: ['$paidAmount', 0] }, 'partial', '$paymentStatus'] }]
                        }
                    } }
                ],
                { new: true, session }
            );
            faultInject('recordSupplierPayment:afterPO');

            if (updatedPo.supplier) {
                await this.updateSchedulesAfterPayment(updatedPo.supplier, 'Supplier', amount, session);

                const Debt = (await import('../../models/Debt.js')).default;
                const debt = await Debt.findOne({ referenceType: 'PurchaseOrder', referenceId: updatedPo._id }).session(session);
                if (debt) {
                    await DebtService.updateBalance(debt._id, amount, session);
                } else {
                    const Supplier = (await import('../../models/Supplier.js')).default;
                    await Supplier.findByIdAndUpdate(updatedPo.supplier, { $inc: { balance: -amount } }, { session });
                }
            }

            let meta = {};
            if (updatedPo.supplier) {
                const Supplier = (await import('../../models/Supplier.js')).default;
                const updatedSupplier = await Supplier.findById(updatedPo.supplier).session(session);
                if (updatedSupplier) {
                    meta.customerBalanceAfter = updatedSupplier.balance;
                }
            }

            await TreasuryService.recordSupplierPayment(
                updatedPo.supplier,
                amount,
                updatedPo.poNumber,
                updatedPo._id,
                userId,
                method,
                note,
                meta,
                session
            );

            return updatedPo;
        }));
    },

    /**
     * Record payment for Manual Debt
     */
    async recordManualDebtPayment(debt, amount, method, note, userId) {
        await dbConnect();

        // FIX (Sprint 08): callers send either a bare id string or a {_id}
        // stub (frontend) — the old code read debtorType/_id off the stub, so
        // schedule sync + partner-balance meta silently never ran, and bare
        // ids 404'd. Resolve the real doc first.
        const Debt = (await import('../../models/Debt.js')).default;
        const debtDoc = await Debt.findById(debt?._id ?? debt);
        if (!debtDoc) throw new NotFoundError('الدين غير موجود');

        // T-BIZ-01: manual debt payment all-or-nothing
        return withRetry(() => withTransaction(async (session) => {
            const debt = debtDoc;
            if (debt.debtorType === 'Customer') {
                await this.updateSchedulesAfterPayment(debt.debtorId, 'Customer', amount, session);
            } else if (debt.debtorType === 'Supplier') {
                await this.updateSchedulesAfterPayment(debt.debtorId, 'Supplier', amount, session);
            }

            faultInject('recordManualDebtPayment:afterSchedules');
            await DebtService.updateBalance(debt._id, amount, session);

            let meta = {};
            if (debt.debtorType === 'Customer') {
                const updatedCustomer = await Customer.findById(debt.debtorId).session(session);
                if (updatedCustomer) meta.customerBalanceAfter = updatedCustomer.balance;
            } else if (debt.debtorType === 'Supplier') {
                const Supplier = (await import('../../models/Supplier.js')).default;
                const updatedSupplier = await Supplier.findById(debt.debtorId).session(session);
                if (updatedSupplier) meta.customerBalanceAfter = updatedSupplier.balance;
            }

            const tx = await TreasuryService.recordDebtTransaction(
                debt._id,
                debt.debtorId,
                amount,
                debt.debtorType === 'Customer' ? 'INCOME' : 'EXPENSE',
                userId,
                debt.debtorType === 'Customer'
                    ? `تحصيل مديونية سابقة: ${debt.description || ''} ${note ? `- ${note}` : ''}`
                    : `سداد مديونية سابقة للمورد: ${note ? `- ${note}` : ''}`,
                method,
                meta,
                session
            );

            return { debt, transaction: tx };
        }));
    },

    /**
     * Settle debts (receivables or payables)
     */
    async settleDebt(data, userId) {
        await dbConnect();
        const { type, id, amount, method = 'cash', note = '' } = data;

        if (!type || !id || !amount || amount <= 0) {
            throw new BadRequestError('بيانات غير صحيحة لسداد الدين');
        }

        if (type === 'receivable') {
            const invoice = await Invoice.findById(id).populate('customer');
            if (invoice) {
                return await this.recordCustomerPayment(invoice, amount, method, note, userId);
            } else {
                const { default: Debt } = await import('../../models/Debt.js');
                let debt = await Debt.findById(id);
                if (!debt) debt = await Debt.findOne({ referenceId: id, debtorType: 'Customer' });
                if (debt) {
                    return await this.recordManualDebtPayment(debt, amount, method, note, userId);
                } else {
                    throw new NotFoundError('الفاتورة أو المديونية غير موجودة');
                }
            }
        } else if (type === 'payable') {
            const PurchaseOrder = (await import('../../models/PurchaseOrder.js')).default;
            const po = await PurchaseOrder.findById(id).populate('supplier');
            if (po) {
                return await this.recordSupplierPayment(po, amount, method, note, userId);
            } else {
                const Debt = (await import('../../models/Debt.js')).default;
                let debt = await Debt.findById(id);
                if (!debt) debt = await Debt.findOne({ referenceId: id, debtorType: 'Supplier' });
                if (debt) {
                    return await this.recordManualDebtPayment(debt, amount, method, note, userId);
                } else {
                    throw new NotFoundError('أمر الشراء أو المديونية غير موجودة');
                }
            }
        }
        throw new BadRequestError('نوع عملية غير معروف');
    }
};



