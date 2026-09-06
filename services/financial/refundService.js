import dbConnect from '../../lib/db.js';
import Customer from '../../models/Customer.js';
import { TreasuryService, fieldFor } from '../treasuryService.js';
import { withTransaction } from '../../utils/dbUtils.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

/**
 * Refund Service — pays out a customer's creditBalance in cash (or other
 * method). Money path: customer + treasury + cashbox all-or-nothing.
 */
export const RefundService = {
    /**
     * Refund part or all of a customer's credit balance.
     * @returns {{ customer, transaction }}
     */
    async refundCustomerCredit(customerId, amount, method = 'cash', note = '', userId = null) {
        await dbConnect();

        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) {
            throw new BadRequestError('مبلغ الاسترداد يجب أن يكون أكبر من صفر');
        }

        return withTransaction(async (session) => {
            // Guarded atomic decrement — concurrent refunds cannot drive
            // creditBalance negative.
            const customer = await Customer.findOneAndUpdate(
                { _id: customerId, creditBalance: { $gte: value } },
                { $inc: { creditBalance: -value, totalRefunded: value } },
                { new: true, session }
            );
            if (!customer) {
                const exists = await Customer.findById(customerId).session(session);
                if (!exists) throw new NotFoundError('العميل غير موجود');
                throw new BadRequestError(
                    `المبلغ المطلوب (${value.toLocaleString()}) يتجاوز رصيد العميل الدائن المتاح (${Number(exists.creditBalance || 0).toLocaleString()})`
                );
            }

            const rounded = Number(value.toFixed(2));
            const tx = await TreasuryService._createTransactions([{
                type: 'EXPENSE',
                amount: rounded,
                method,
                description: `استرداد رصيد دائن للعميل: ${customer.name}${note ? ` - ${note}` : ''}`,
                referenceType: 'Manual',
                referenceId: customer._id,
                partnerId: customer._id,
                date: new Date(),
                createdBy: userId,
                meta: { isCreditRefund: true, customerId: customer._id }
            }], session);

            // Real money leaves the drawer — move the cashbox bucket.
            await TreasuryService.updateDailyCashbox(new Date(), {
                [fieldFor(method, 'EXPENSE')]: rounded
            }, session);

            return { customer, transaction: tx[0] };
        });
    }
};
