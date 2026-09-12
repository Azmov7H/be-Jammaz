import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// T-03 (FIN-CASHBOX-01) — a manual cashbox event must be counted exactly
// once: method bucket for channeled methods, manual[] for cash/adjustment.
// The old code did both for non-cash methods, doubling totalIncome/Expenses.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Cashbox Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const auth = (req) => req.set('Cookie', ownerCookie);
// Distinct dates per test — CashboxDaily is unique per day.
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString();

async function dailyCashbox(dateIso) {
    const res = await auth(request.get(`/api/treasury/daily?date=${encodeURIComponent(dateIso)}`));
    ok(res, 'getDailyCashbox');
    return res.body.data;
}

describe('T-03: single-count cashbox writes', () => {
    it('non-cash manual income lands in the method bucket only, counted once', async () => {
        const dateIso = day(11);
        const res = await auth(request.post('/api/treasury/manual-income')).send({
            amount: 250, reason: 'إيداع بنكي اختبار', method: 'bank', date: dateIso,
        });
        ok(res, 'manualIncome bank');
        const cb = await dailyCashbox(dateIso);
        expect(cb.bankIncome).toBeCloseTo(250, 2);
        expect(cb.manualIncome || []).toHaveLength(0);
        expect(cb.totalIncome).toBeCloseTo(250, 2);
    });

    it('non-cash manual expense lands in the method bucket only, counted once', async () => {
        const dateIso = day(12);
        const res = await auth(request.post('/api/treasury/manual-expense')).send({
            amount: 120, reason: 'مصروف محفظة اختبار', category: 'other',
            method: 'wallet', sourceNumber: 'W-TEST-001', date: dateIso,
        });
        ok(res, 'manualExpense wallet');
        const cb = await dailyCashbox(dateIso);
        expect(cb.walletExpenses).toBeCloseTo(120, 2);
        expect(cb.manualExpenses || []).toHaveLength(0);
        expect(cb.totalExpenses).toBeCloseTo(120, 2);
        expect(cb.netChange).toBeCloseTo(-120, 2);
    });

    it('cash manual income still uses manual[] (regression: no bucket exists)', async () => {
        const dateIso = day(13);
        const res = await auth(request.post('/api/treasury/manual-income')).send({
            amount: 400, reason: 'إيداع نقدي اختبار', method: 'cash', date: dateIso,
        });
        ok(res, 'manualIncome cash');
        const cb = await dailyCashbox(dateIso);
        expect(cb.manualIncome || []).toHaveLength(1);
        expect(cb.bankIncome || 0).toBeCloseTo(0, 2);
        expect(cb.totalIncome).toBeCloseTo(400, 2);
    });

    it('rollups stay fresh after $inc-only writes (no stale totals)', async () => {
        const dateIso = day(14);
        await auth(request.post('/api/treasury/manual-income')).send({
            amount: 100, reason: 'إيراد اختبار', method: 'cash', date: dateIso,
        }).then((r) => ok(r, 'income'));
        await auth(request.post('/api/treasury/manual-expense')).send({
            amount: 30, reason: 'مصروف اختبار', category: 'other', method: 'cash', date: dateIso,
        }).then((r) => ok(r, 'expense'));
        const cb = await dailyCashbox(dateIso);
        expect(cb.totalIncome).toBeCloseTo(100, 2);
        expect(cb.totalExpenses).toBeCloseTo(30, 2);
        expect(cb.netChange).toBeCloseTo(70, 2);
    });
});
