import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';
import { randomUUID } from 'crypto';

// FIN-RPT-01 — per-number movement reports for wallet / instapay.
// Read-only: INCOME = received, EXPENSE = withdrawn, net = difference.
// Tahweesh legs count as movement, never as profit.

let request;
let ownerCookie;
let cashierCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Report Owner', role: 'owner' }));
    ({ cookie: cashierCookie } = await seedUser(request, { name: 'Report Cashier', role: 'cashier' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const authOwner = (req) => req.set('Cookie', ownerCookie);

const NUM_A = `010${uniq('1')}`.slice(0, 11);
const NUM_B = `011${uniq('2')}`.slice(0, 11);
const NUM_C = `IP-${uniq('C')}`;

async function income({ amount, method, sourceNumber, date }) {
    const res = await authOwner(request.post('/api/treasury/manual-income')).send({
        amount, reason: `تقرير-${uniq('R')}`, method, sourceNumber, ...(date ? { date } : {}),
    });
    ok(res, 'manualIncome');
}
async function expense({ amount, method, sourceNumber, date }) {
    const res = await authOwner(request.post('/api/treasury/manual-expense')).send({
        amount, reason: `تقرير-${uniq('R')}`, category: 'تقرير', method, sourceNumber, ...(date ? { date } : {}),
    });
    ok(res, 'manualExpense');
}
async function report(params, cookie = ownerCookie) {
    const res = await request.get('/api/treasury/number-report').set('Cookie', cookie).query(params);
    return res;
}
const rowOf = (body, number) => body.data.numbers.find((r) => r.number === number);

describe('FIN-RPT-01: number report', () => {
    it('aggregates received/withdrawn/net per number with grand totals', async () => {
        await income({ amount: 50000, method: 'wallet', sourceNumber: NUM_A });
        await income({ amount: 20000, method: 'wallet', sourceNumber: NUM_B });
        await expense({ amount: 30000, method: 'wallet', sourceNumber: NUM_A });
        await income({ amount: 10000, method: 'instapay', sourceNumber: NUM_C });
        await expense({ amount: 4000, method: 'instapay', sourceNumber: NUM_C });

        const res = await report({ method: 'wallet' });
        ok(res, 'walletReport');
        const a = rowOf(res.body, NUM_A);
        expect(a).toMatchObject({ received: 50000, withdrawn: 30000, count: 2, net: 20000 });
        const b = rowOf(res.body, NUM_B);
        expect(b).toMatchObject({ received: 20000, withdrawn: 0, count: 1, net: 20000 });
        expect(res.body.data.totals).toMatchObject({ received: 70000, withdrawn: 30000, count: 3, net: 40000 });
        // Methods stay isolated: no instapay leakage into the wallet report.
        expect(res.body.data.numbers.some((r) => r.number === NUM_C)).toBe(false);

        const inst = await report({ method: 'instapay' });
        ok(inst, 'instapayReport');
        expect(rowOf(inst.body, NUM_C)).toMatchObject({ received: 10000, withdrawn: 4000, count: 2, net: 6000 });
    });

    it('filters by one / many numbers and by direction', async () => {
        const one = await report({ method: 'wallet', numbers: NUM_A });
        ok(one, 'oneNumber');
        expect(one.body.data.numbers.map((r) => r.number)).toEqual([NUM_A]);
        expect(one.body.data.totals).toMatchObject({ received: 50000, withdrawn: 30000, count: 2, net: 20000 });

        const many = await report({ method: 'wallet', numbers: [NUM_A, NUM_B].join(',') });
        ok(many, 'manyNumbers');
        expect(many.body.data.numbers.map((r) => r.number).sort()).toEqual([NUM_A, NUM_B].sort());
        expect(many.body.data.totals.count).toBe(3);

        const recv = await report({ method: 'wallet', direction: 'INCOME' });
        ok(recv, 'directionIncome');
        expect(recv.body.data.totals).toMatchObject({ received: 70000, withdrawn: 0, count: 2, net: 70000 });
    });

    it('respects date boundaries', async () => {
        const marker = `012${uniq('3')}`.slice(0, 11);
        await income({ amount: 7000, method: 'wallet', sourceNumber: marker, date: '2026-01-05' });
        const inside = await report({ method: 'wallet', numbers: marker, startDate: '2026-01-01', endDate: '2026-01-31' });
        ok(inside, 'insideRange');
        expect(inside.body.data.totals.count).toBe(1);
        const outside = await report({ method: 'wallet', numbers: marker, startDate: '2026-02-01', endDate: '2026-02-28' });
        ok(outside, 'outsideRange');
        expect(outside.body.data.totals.count).toBe(0);
        expect(outside.body.data.numbers).toEqual([]);
    });

    it('rejects unsupported methods', async () => {
        const res = await report({ method: 'bank' });
        expect(res.status).toBe(400);
        const cash = await report({ method: 'cash' });
        expect(cash.status).toBe(400);
    });

    it('counts a Tahweesh deposit source-leg as movement without touching profit', async () => {
        const { ReportingService } = await import('../services/reportingService.js');
        const profitBefore = await ReportingService.getFinancialReport();
        await income({ amount: 90000, method: 'instapay', sourceNumber: NUM_C });
        const dep = await authOwner(request.post('/api/tahweesh/deposit')).send({
            source: 'instapay', sourceNumber: NUM_C, amount: 15000, note: 'تحويش تقرير', transferId: randomUUID(),
        });
        ok(dep, 'tahweeshDeposit');
        const res = await report({ method: 'instapay', numbers: NUM_C });
        ok(res, 'afterDeposit');
        const c = rowOf(res.body, NUM_C);
        // 10k − 4k seeded, +90k funded, −15k moved to Tahweesh.
        expect(c.withdrawn).toBe(4000 + 15000);
        expect(c.received).toBe(10000 + 90000);
        const profitAfter = await ReportingService.getFinancialReport();
        expect(profitAfter.netProfit).toBe(profitBefore.netProfit);
    });

    it('is read-only: balances identical before and after reporting', async () => {
        const { TreasuryService } = await import('../services/treasuryService.js');
        const before = await TreasuryService.getCurrentBalance();
        await report({ method: 'wallet' });
        await report({ method: 'instapay', direction: 'EXPENSE' });
        await authOwner(request.get('/api/treasury/transactions')).query({ method: 'wallet', sourceNumber: NUM_A, limit: 5 });
        const after = await TreasuryService.getCurrentBalance();
        expect(after).toBe(before);
    });

    it('serves detail rows through /transactions with the same filters', async () => {
        const res = await authOwner(request.get('/api/treasury/transactions')).query({
            method: 'wallet', sourceNumber: NUM_A, limit: 50,
        });
        ok(res, 'detailRows');
        expect(res.body.data.total).toBe(2);
        for (const t of res.body.data.transactions) {
            expect(t.method).toBe('wallet');
            expect(t.sourceNumber).toBe(NUM_A);
        }
    });

    it('masks numbers for non-privileged roles without breaking grouping', async () => {
        const res = await report({ method: 'wallet' }, cashierCookie);
        ok(res, 'cashierReport');
        expect(res.body.data.numbers.length).toBeGreaterThan(0);
        for (const r of res.body.data.numbers) {
            if (r.number !== '__unassigned') expect(r.number.startsWith('••••')).toBe(true);
        }
        // Totals survive masking (aggregation precedes the mask).
        expect(res.body.data.totals.count).toBeGreaterThan(0);
    });

    it('buckets number-less rows under the unassigned sentinel', async () => {
        const { default: Txn } = await import('../models/TreasuryTransaction.js');
        await Txn.create({ type: 'INCOME', amount: 1234, description: 'gap row', method: 'wallet', referenceType: 'Manual' });
        const res = await report({ method: 'wallet', numbers: '__unassigned' });
        ok(res, 'unassignedBucket');
        expect(res.body.data.numbers.map((r) => r.number)).toEqual(['__unassigned']);
        expect(res.body.data.totals.received).toBeGreaterThanOrEqual(1234);
    });
});
