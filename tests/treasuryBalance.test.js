import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { createTestApp, seedUser, stopTestDb } from './helpers.js';
import TreasuryBalance from '../models/TreasuryBalance.js';

// T-PERF-03 acceptance:
// - running-balance doc stays consistent with the ledger after writes
//   (manual income/expense + undo)
// - lazy rebuild recomputes correctly when the doc is deleted (rollback path)
// - getSummary returns aggregates + recentTransactions (max 20)

let app;
let ownerCookie;

beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DASHBOARD_CACHE_TTL = '0'; // keep treasury reads live
    app = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(app, { name: 'treasury-perf', role: 'owner' }));
}, 180000);

afterAll(async () => {
    delete process.env.DASHBOARD_CACHE_TTL;
    await stopTestDb();
});

const balanceDoc = async () =>
    (await TreasuryBalance.findById(TreasuryBalance.DOC_ID).lean())?.balance;

const ledgerSum = async () => {
    const [agg] = await mongoose.model('TreasuryTransaction').aggregate([
        { $group: {
            _id: null,
            income: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] } },
            expense: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] } }
        } }
    ]);
    return (agg?.income ?? 0) - (agg?.expense ?? 0);
};

describe('T-PERF-03: running treasury balance', () => {
    it('writers keep the running doc in sync with the ledger', async () => {
        const before = await ledgerSum();

        await app.post('/api/treasury/manual-income')
            .set('Cookie', ownerCookie)
            .send({ amount: 250, reason: 'perf3-in' })
            .expect(200);
        await app.post('/api/treasury/manual-expense')
            .set('Cookie', ownerCookie)
            .send({ amount: 90, reason: 'perf3-out', category: 'other' })
            .expect(200);

        expect(await ledgerSum()).toBe(before + 160);
        expect(await balanceDoc()).toBe(await ledgerSum());
    });

    it('undo reverses the running balance atomically with the delete', async () => {
        const list = await app.get('/api/treasury/transactions?limit=5')
            .set('Cookie', ownerCookie).expect(200);
        const tx = list.body.data.find(t => t.referenceType === 'Manual' && t.type === 'INCOME');
        expect(tx).toBeTruthy();

        const before = await ledgerSum();
        await app.delete(`/api/treasury/transactions/${tx._id}`)
            .set('Cookie', ownerCookie).expect(200);

        expect(await ledgerSum()).toBe(before - tx.amount);
        expect(await balanceDoc()).toBe(await ledgerSum());
    });

    it('lazy rebuild restores the doc after rollback (delete)', async () => {
        await TreasuryBalance.deleteOne({ _id: TreasuryBalance.DOC_ID });

        // next read must recompute from the ledger and persist
        const res = await app.get('/api/treasury/balance')
            .set('Cookie', ownerCookie).expect(200);
        expect(res.body.data.balance ?? res.body.data).toBe(await ledgerSum());
        expect(await balanceDoc()).toBe(await ledgerSum());
    });

    it('getSummary returns recentTransactions capped at 20 (no full list)', async () => {
        for (let i = 0; i < 23; i++) {
            await app.post('/api/treasury/manual-income')
                .set('Cookie', ownerCookie)
                .send({ amount: 10, reason: `bulk-${i}` })
                .expect(200);
        }
        const res = await app.get('/api/treasury/summary')
            .set('Cookie', ownerCookie).expect(200);
        const body = res.body.data;
        expect(Array.isArray(body.recentTransactions)).toBe(true);
        expect(body.recentTransactions.length).toBeLessThanOrEqual(20);
        expect(body.transactions).toBeUndefined();
        expect(typeof body.totalIncome).toBe('number');
        expect(typeof body.totalExpense).toBe('number');
    });
});
