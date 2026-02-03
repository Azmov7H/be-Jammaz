import dbConnect from '../../lib/db.js';
import { TreasuryService } from '../treasuryService.js';
import { LogService } from '../logService.js';

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
            const { amount, reason, category, date = new Date() } = data;

            if (!amount || amount <= 0 || !reason || !category) {
                throw 'بيانات المصروفات غير مكتملة';
            }

            // 1. Record in Treasury
            const treasuryRecord = await TreasuryService.addManualExpense(
                date,
                parseFloat(amount),
                reason,
                category,
                userId
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



