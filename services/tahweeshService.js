import dbConnect from '../lib/db.js';
import TreasuryTransaction from '../models/TreasuryTransaction.js';
import TahweeshBalance from '../models/TahweeshBalance.js';
import { TreasuryService, fieldFor, ensureCashboxDay } from './treasuryService.js';
import { withTransaction } from '../utils/dbUtils.js';
import { BadRequestError } from '../lib/errors.js';

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
            // _createTransactions moves TahweeshBalance for the tahweesh leg
            // (T-11 hook) — no explicit $inc here, or it would double-move.
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

            // Source channel leaves the drawer. Cash is booked as a manual
            // cash-out (NOT purchaseExpenses — a transfer is not a purchase);
            // channeled sources move their own bucket.
            if (source === 'cash') {
                const { cashbox } = await ensureCashboxDay(stamp, session);
                await cashbox.addExpense(value, note || 'تحويل إلى التحويش', 'other', userId, session);
            } else {
                await TreasuryService.updateDailyCashbox(stamp, {
                    [fieldFor(source, 'EXPENSE')]: value
                }, session);
            }

            const bal = await TahweeshBalance.findById(TahweeshBalance.DOC_ID).session(session).lean();
            return { legs, tahweeshBalance: bal?.balance ?? 0, duplicate: false };
        });
    },

    /**
     * Return set-aside money to cash (un-set-aside). The reverse pair of a
     * deposit: EXPENSE tahweesh + INCOME cash, same conservation rules.
     * Funding a business payment is NOT a withdraw — spend through the
     * payment paths with method:'tahweesh' instead (single-transaction rule).
     */
    async withdraw({ amount, note = '', transferId }, userId) {
        await dbConnect();
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) {
            throw new BadRequestError('مبلغ السحب يجب أن يكون أكبر من صفر');
        }
        if (!transferId) throw new BadRequestError('معرف التحويل مطلوب');

        return withTransaction(async (session) => {
            const existing = await TreasuryTransaction.find({
                referenceType: 'TahweeshTransfer',
                'meta.transferId': transferId,
            }).session(session).lean();
            if (existing.length > 0) {
                const bal = await TahweeshBalance.findById(TahweeshBalance.DOC_ID).session(session).lean();
                return { legs: existing, tahweeshBalance: bal?.balance ?? 0, duplicate: true };
            }

            const available = await TreasuryService.getTahweeshBalance();
            if (value - available > 0.01) {
                throw new BadRequestError(
                    `المبلغ المطلوب (${value.toLocaleString()}) يتجاوز رصيد التحويش المتاح (${available.toLocaleString()})`
                );
            }

            const stamp = new Date();
            const legs = await TreasuryService._createTransactions([
                {
                    type: 'EXPENSE',
                    amount: value,
                    description: note || 'سحب من التحويش إلى الخزينة',
                    referenceType: 'TahweeshTransfer',
                    method: 'tahweesh',
                    date: stamp,
                    createdBy: userId,
                    meta: { transferId, direction: 'withdraw' }
                },
                {
                    type: 'INCOME',
                    amount: value,
                    description: note || 'استرداد من التحويش إلى الخزينة',
                    referenceType: 'TahweeshTransfer',
                    method: 'cash',
                    date: stamp,
                    createdBy: userId,
                    meta: { transferId, direction: 'withdraw' }
                }
            ], session);

            // Cash returns to the drawer as manual cash-in (NOT salesIncome —
            // a return is not a sale). The hook already decremented the
            // set-aside for the tahweesh leg.
            const { cashbox } = await ensureCashboxDay(stamp, session);
            await cashbox.addIncome(value, note || 'استرداد من التحويش', userId, session);

            const bal = await TahweeshBalance.findById(TahweeshBalance.DOC_ID).session(session).lean();
            return { legs, tahweeshBalance: bal?.balance ?? 0, duplicate: false };
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
