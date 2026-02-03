import dbConnect from '../../lib/db.js';
import Invoice from '../../models/Invoice.js';
import Customer from '../../models/Customer.js';
import { TreasuryService } from '../treasuryService.js';
import { DebtService } from './debtService.js';

/**
 * Payment Service
 * Handles collections, debt payments, and schedules.
 */
export const PaymentService = {
    /**
     * Helper: Update schedules after a payment
     */
    async updateSchedulesAfterPayment(entityId, entityType, amount) {
        const PaymentSchedule = (await import('../../models/PaymentSchedule.js')).default;

        const schedules = await PaymentSchedule.find({
            entityId,
            entityType,
            status: { $in: ['PENDING', 'OVERDUE'] }
        }).sort({ dueDate: 1 });

        let remaining = amount;

        for (const schedule of schedules) {
            if (remaining <= 0) break;

            if (remaining >= schedule.amount) {
                remaining -= schedule.amount;
                schedule.amount = 0;
                schedule.status = 'PAID';
                schedule.paidAt = new Date();
                await schedule.save();
            } else {
                schedule.amount -= remaining;
                remaining = 0;
                await schedule.save();
            }
        }
    },

    /**
     * Record a Payment Collection
     */
    async recordCustomerPayment(invoice, amount, method, note, userId) {
        await dbConnect();
        try {
            await invoice.recordPayment(amount, method, note, userId);

            if (invoice.customer) {
                await this.updateSchedulesAfterPayment(invoice.customer, 'Customer', amount);

                const Debt = (await import('../../models/Debt.js')).default;
                const debt = await Debt.findOne({ referenceType: 'Invoice', referenceId: invoice._id });
                if (debt) {
                    await DebtService.updateBalance(debt._id, amount);
                } else {
                    await Customer.findByIdAndUpdate(invoice.customer, { $inc: { balance: -amount } });
                }
            }

            let meta = {};
            if (invoice.customer) {
                const updatedCustomer = await Customer.findById(invoice.customer);
                if (updatedCustomer) {
                    meta.customerBalanceAfter = updatedCustomer.balance;
                }
            }

            const tx = await TreasuryService.recordPaymentCollection(invoice, amount, userId, method, note, meta);
            return { invoice, transaction: tx };
        } catch (error) {
            throw error;
        }
    },

    /**
     * Record a Total Customer Payment (Unified Collection)
     */
    async recordTotalCustomerPayment(customerId, amount, method, note, userId) {
        await dbConnect();
        try {
            const customer = await Customer.findById(customerId);
            if (!customer) throw new Error('العميل غير موجود');

            const Debt = (await import('../../models/Debt.js')).default;

            const activeDebts = await Debt.find({
                debtorId: customerId,
                debtorType: 'Customer',
                status: { $in: ['active', 'overdue'] }
            }).sort({ dueDate: 1 });

            if (activeDebts.length === 0 && customer.balance <= 0) {
                throw new Error('لا توجد ديون مستحقة لهذا العميل');
            }

            let remainingAmount = amount;
            const appliedPayments = [];

            for (const debt of activeDebts) {
                if (remainingAmount <= 0) break;

                const paymentToApply = Math.min(debt.remainingAmount, remainingAmount);
                if (paymentToApply > 0) {
                    await DebtService.updateBalance(debt._id, paymentToApply);

                    if (debt.referenceType === 'Invoice') {
                        const inv = await Invoice.findById(debt.referenceId);
                        if (inv) {
                            inv.paidAmount = (inv.paidAmount || 0) + paymentToApply;
                            if (inv.paidAmount >= inv.total) {
                                inv.paymentStatus = 'paid';
                                inv.paidAmount = inv.total;
                            } else {
                                inv.paymentStatus = 'partial';
                            }
                            await inv.save();
                        }
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
                // Determine model based purely on the expectation that this method handles Customers
                // If we want to be strict, we can import Customer, but we already have it.
                // Apply the remaining amount as a general credit (reducing the balance)
                await Customer.findByIdAndUpdate(customerId, { $inc: { balance: -remainingAmount } });
            }

            await this.updateSchedulesAfterPayment(customerId, 'Customer', amount);

            // Refetch customer to get the accurate final balance
            const finalCustomer = await Customer.findById(customerId);

            const tx = await TreasuryService.recordUnifiedCollection(
                customer,
                amount,
                userId,
                method,
                note || `تحصيل مجمع من الرصيد الإجمالي - ${appliedPayments.length} مديونية`,
                {
                    customerBalanceAfter: finalCustomer ? finalCustomer.balance : customer.balance,
                    appliedPaymentsCount: appliedPayments.length
                }
            );

            return { success: true, transaction: tx, appliedPayments };
        } catch (error) {
            throw error;
        }
    },

    /**
     * Record a Supplier Payment (Paying debts)
     */
    async recordSupplierPayment(po, amount, method, note, userId) {
        await dbConnect();
        try {
            po.paidAmount = (po.paidAmount || 0) + amount;
            if (po.paidAmount >= po.totalCost) {
                po.paymentStatus = 'paid';
                po.paidAmount = po.totalCost;
            } else {
                po.paymentStatus = 'partial';
            }
            await po.save();

            if (po.supplier) {
                await this.updateSchedulesAfterPayment(po.supplier, 'Supplier', amount);

                const Debt = (await import('../../models/Debt.js')).default;
                const debt = await Debt.findOne({ referenceType: 'PurchaseOrder', referenceId: po._id });
                if (debt) {
                    await DebtService.updateBalance(debt._id, amount);
                } else {
                    const Supplier = (await import('../../models/Supplier.js')).default;
                    await Supplier.findByIdAndUpdate(po.supplier, { $inc: { balance: -amount } });
                }
            }

            let meta = {};
            if (po.supplier) {
                const Supplier = (await import('../../models/Supplier.js')).default;
                const updatedSupplier = await Supplier.findById(po.supplier);
                if (updatedSupplier) {
                    meta.customerBalanceAfter = updatedSupplier.balance;
                }
            }

            await TreasuryService.recordSupplierPayment(
                po.supplier,
                amount,
                po.poNumber,
                po._id,
                userId,
                method,
                note,
                meta
            );

            return po;
        } catch (error) {
            throw error;
        }
    },

    /**
     * Record payment for Manual Debt
     */
    async recordManualDebtPayment(debt, amount, method, note, userId) {
        await dbConnect();

        if (debt.debtorType === 'Customer') {
            await this.updateSchedulesAfterPayment(debt.debtorId, 'Customer', amount);
        } else if (debt.debtorType === 'Supplier') {
            await this.updateSchedulesAfterPayment(debt.debtorId, 'Supplier', amount);
        }

        await DebtService.updateBalance(debt._id, amount);

        let meta = {};
        if (debt.debtorType === 'Customer') {
            const updatedCustomer = await Customer.findById(debt.debtorId);
            if (updatedCustomer) meta.customerBalanceAfter = updatedCustomer.balance;
        } else if (debt.debtorType === 'Supplier') {
            const Supplier = (await import('../../models/Supplier.js')).default;
            const updatedSupplier = await Supplier.findById(debt.debtorId);
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
            meta
        );

        return { debt, transaction: tx };
    },

    /**
     * Settle debts (receivables or payables)
     */
    async settleDebt(data, userId) {
        await dbConnect();
        const { type, id, amount, method = 'cash', note = '' } = data;

        if (!type || !id || !amount || amount <= 0) {
            throw 'بيانات غير صحيحة لسداد الدين';
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
                    throw 'الفاتورة أو المديونية غير موجودة';
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
                    throw 'أمر الشراء أو المديونية غير موجودة';
                }
            }
        }
        throw 'نوع عملية غير معروف';
    }
};



