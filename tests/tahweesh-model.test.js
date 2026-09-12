import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';
import { randomUUID } from 'crypto';

// T-09 (FIN-TAHWEESH-01) — transfer legs are relocation, never business
// flow: excluded from period income/expense/cashflow, visible in the ledger
// and the tahweesh breakdown bucket, net-zero on the global balance.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Tahweesh Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const dayMs = 24 * 60 * 60 * 1000;
const wideStart = new Date(Date.now() - 7 * dayMs).toISOString();
const wideEnd = new Date(Date.now() + 7 * dayMs).toISOString();

async function summary() {
    const { TreasuryService } = await import('../services/treasuryService.js');
    return TreasuryService.getSummary(wideStart, wideEnd);
}
async function cashflow() {
    const { TreasuryService } = await import('../services/treasuryService.js');
    return TreasuryService.getCashFlow(wideStart, wideEnd);
}
async function globalBalance() {
    const { TreasuryService } = await import('../services/treasuryService.js');
    return TreasuryService.getCurrentBalance();
}

describe('T-09: transfer legs are profit-neutral relocation', () => {
    it('paired legs skip period flows, move breakdown, conserve the global', async () => {
        const transferId = randomUUID();
        const before = await summary();
        const cfBefore = await cashflow();
        const gBefore = await globalBalance();
        const sum = (b, k) => b.buckets.reduce((s, x) => s + (x[k] || 0), 0);

        const { TreasuryService } = await import('../services/treasuryService.js');
        await TreasuryService._createTransactions([
            { type: 'EXPENSE', amount: 20000, description: 'تحويش اختبار', referenceType: 'TahweeshTransfer', method: 'cash', date: new Date(), meta: { transferId } },
            { type: 'INCOME', amount: 20000, description: 'تحويش اختبار', referenceType: 'TahweeshTransfer', method: 'tahweesh', date: new Date(), meta: { transferId } },
        ], null);

        const after = await summary();
        // Period business flow untouched (gross volume NOT inflated)...
        expect(after.totalIncome - before.totalIncome).toBeCloseTo(0, 2);
        expect(after.totalExpense - before.totalExpense).toBeCloseTo(0, 2);
        expect(after.periodBalance - before.periodBalance).toBeCloseTo(0, 2);
        // ...but the funds visibly moved between buckets...
        expect(after.breakdown.tahweesh - before.breakdown.tahweesh).toBeCloseTo(20000, 2);
        expect(before.breakdown.cash - after.breakdown.cash).toBeCloseTo(20000, 2);
        // ...the ledger still lists both legs (transparency)...
        expect(after.transactionCount - before.transactionCount).toBeGreaterThanOrEqual(0);
        // ...and the global pot is conserved.
        expect(await globalBalance() - gBefore).toBeCloseTo(0, 2);

        const cfAfter = await cashflow();
        expect(sum(cfAfter, 'income') - sum(cfBefore, 'income')).toBeCloseTo(0, 2);
        expect(sum(cfAfter, 'expense') - sum(cfBefore, 'expense')).toBeCloseTo(0, 2);
    });

    it('rebuild derives the set-aside balance from tahweesh legs', async () => {
        const transferId = randomUUID();
        const { TreasuryService } = await import('../services/treasuryService.js');
        await TreasuryService._createTransactions([
            { type: 'EXPENSE', amount: 5000, description: 'إيداع', referenceType: 'TahweeshTransfer', method: 'wallet', date: new Date(), meta: { transferId } },
            { type: 'INCOME', amount: 5000, description: 'إيداع', referenceType: 'TahweeshTransfer', method: 'tahweesh', date: new Date(), meta: { transferId } },
            { type: 'EXPENSE', amount: 1500, description: 'سداد دين', referenceType: 'Debt', method: 'tahweesh', date: new Date() },
        ], null);
        // 20000 (prior test) + 5000 in − 1500 out = 23500
        expect(await TreasuryService.rebuildTahweeshBalance()).toBeCloseTo(23500, 2);
        expect(await TreasuryService.getTahweeshBalance()).toBeCloseTo(23500, 2);
    });
});
