import dbConnect from '../../lib/db.js';
import { TreasuryService } from '../treasuryService.js';
import { LogService } from '../logService.js';
import { BadRequestError } from '../../lib/errors.js';
import { withTransaction } from '../../utils/dbUtils.js';

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
        // FIN-ATOMIC-01 (T-04): treasury + GL + log all-or-nothing. The old
        // code passed null sessions, so a crash between writes desynced the
        // ledger from profit.
        return withTransaction(async (session) => {
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
                session,
                sourceNumber // FIN-SVC-003 (Sprint 3)
            );

            // 2. General ledger — expense entry in the same transaction.
            const { AccountingService } = await import('../accountingService.js');
            await AccountingService.createExpenseEntry(
                parseFloat(amount), category, reason, userId, new Date(date), session
            );

            // 3. Logging
            await LogService.logAction({
                userId,
                action: 'CREATE_EXPENSE',
                entity: 'Treasury',
                entityId: treasuryRecord._id,
                diff: { amount, category, reason },
                note: `General expense recorded: ${reason}`
            }, session);

            return { treasuryRecord };
        });
    }
};



