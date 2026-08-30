import dbConnect from '../../lib/db.js';
import { TreasuryService } from '../treasuryService.js';
import { LogService } from '../logService.js';
import { BadRequestError } from '../../lib/errors.js';

/**
 * Expense Service
 * Handles recording of general expenses
 */
export const ExpenseService = {
    /**
     * Record a General Expense
     */
    async recordExpense(data, userId) {
        await dbConnect();
        try {
            const { amount, reason, category, date = new Date(), method = 'cash', sourceNumber } = data;

            if (!amount || amount <= 0 || !reason || !category) {
                throw new BadRequestError('بيانات المصروفات غير مكتملة');
            }

            // 1. Record in Treasury
            const treasuryRecord = await TreasuryService.addManualExpense(
                date,
                parseFloat(amount),
                reason,
                category,
                userId,
                method,
                null, // session
                sourceNumber // FIN-SVC-003 (Sprint 3)
            );

            // 2. Logging
            await LogService.logAction({
                userId,
                action: 'CREATE_EXPENSE',
                entity: 'Treasury',
                entityId: treasuryRecord._id,
                diff: { amount, category, reason },
                note: `General expense recorded: ${reason}`
            });

            return { treasuryRecord };
        } catch (error) {
            throw error;
        }
    }
};



