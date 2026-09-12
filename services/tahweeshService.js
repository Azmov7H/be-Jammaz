import dbConnect from '../lib/db.js';
import TreasuryTransaction from '../models/TreasuryTransaction.js';
import { TreasuryService, fieldFor } from './treasuryService.js';
import { withTransaction } from '../utils/dbUtils.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

/**
 * FIN-TAHWEESH-02/03 — Tahweesh (set-aside) movements.
 *
 * Accounting contract (see plan §7/§8):
 * - A deposit/return is a PAIRED transfer (source EXPENSE + tahweesh
 *   INCOME, or the reverse) sharing meta.transferId. The pair nets to zero
 *   on TreasuryBalance and never touches AccountingEntry, so Net Profit
 *   cannot move.
 * - A spend is exactly ONE business transaction whose treasury leg carries
 *   method:'tahweesh' (no separate "withdrawal" event + "payment" event).
 * - Tahweesh has no overdraft: every outflow validates requested <=
 *   available inside the transaction and decrements with a $gte guard, so
 *   concurrent spends cannot drive it negative.
 */
export const TahweeshService = {
    /**
     * Move money from an operating channel into the set-aside.
     * Idempotent on transferId: replaying returns the original legs.
     */
    async deposit({ source, amount, note = '', transferId, sourceNumber = '' }, userId) {
        await dbConnect();
        const value = Number(amount);
        if (!['cash', 'instapay', 'wallet'].includes(source)) {
            throw new BadRequestError('مصدر التحويل يجب أن يكون نقدي أو انستا باي أو محفظة');
        }
        if (!Number.isFinite(value) || value <= 0) {
            throw new BadRequestError('مبلغ التحويل يجب أن يكون أكبر من صفر');
        }
        if (!transferId) throw new BadRequestError('معرف التحويل مطلوب');

        return withTransaction(async (session) => {
            const existing = await TreasuryTransaction.find({
                referenceType: 'TahweeshTransfer',
                'meta.transferId': transferId,
            }).session(session).lean();
            if (existing.length > 0) {
                const { default: TahweeshBalance } = await import('../models/TahweeshBalance.js');
                const bal = await TahweeshBalance.findById(TahweeshBalance.DOC_ID).session(session).lean();
                return { legs: existing, tahweeshBalance: bal?.balance ?? 0, duplicate: true };
            }

            const available = await TreasuryService.getMethodNet(source);
            if (value - available > 0.01) {
                throw new BadRequestError(
                    `المبلغ المطلوب (${value.toLocaleString()}) يتجاوز المتاح في ${sourceLabel(source)} (${available.toLocaleString()})`
                );
            }

            const stamp = new Date();
            const legs = await TreasuryService._createTransactions([
                {
                    type: 'EXPENSE',
                    amount: value,
                    description: note || `تحويل إلى التحويش من ${sourceLabel(source)}`,
                    referenceType: 'TahweeshTransfer',
                    method: source,
                    date: stamp,
                    sourceNumber: sourceNumber || undefined,
                    createdBy: userId,
                    meta: { transferId, direction: 'deposit', source }
                },
                {
                    type: 'INCOME',
                    amount: value,
                    description: note || `إيداع تحويش من ${sourceLabel(source)}`,
                    referenceType: 'TahweeshTransfer',
                    method: 'tahweesh',
                    date: stamp,
                    createdBy: userId,
                    meta: { transferId, direction: 'deposit', source }
                }
            ], session);

            // Source channel bucket moves; the tahweesh leg lives in its own
            // balance doc (no daily bucket for the set-aside account).
            await TreasuryService.updateDailyCashbox(stamp, {
                [fieldFor(source, 'EXPENSE')]: value
            }, session);

            const { default: TahweeshBalance } = await import('../models/TahweeshBalance.js');
            const bal = await TahweeshBalance.findOneAndUpdate(
                { _id: TahweeshBalance.DOC_ID },
                { $inc: { balance: value }, $set: { updatedAt: new Date() } },
                { upsert: true, new: true, session }
            );
            return { legs, tahweeshBalance: bal.balance, duplicate: false };
        });
    },

    /**
     * Current set-aside balance (stored doc, rebuilt from the ledger when missing).
     */
    async getBalance() {
        await dbConnect();
        return TreasuryService.getTahweeshBalance();
    }
};

function sourceLabel(source) {
    if (source === 'instapay') return 'انستا باي';
    if (source === 'wallet') return 'محفظة الكاش';
    return 'الخزينة النقدية';
}
