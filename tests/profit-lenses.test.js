import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';
// NOTE: services import lib/db.js which throws at load time when
// MONGODB_URI is unset; helpers sets it inside createTestApp, so the
// service import below must stay dynamic (after beforeAll).

// T-02 — Lock the two profit lenses.
//
// Lens A (dashboard KPIs): todayProfit = ΣInvoice.profit − ΣTreasury{EXPENSE, Manual}.
// Lens B (financial report): netProfit from AccountingEntry aggregation.
// These intentionally differ (e.g. credit refunds hit A but not B).
// This suite pins both formulas so later phases cannot silently shift them.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Lens Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const auth = (req) => req.set('Cookie', ownerCookie);
// Wide window: the report interprets dates in server-local TZ while the
// test only knows UTC — deltas cancel any pre-existing entries either way.
const dayMs = 24 * 60 * 60 * 1000;
const wideStart = new Date(Date.now() - 7 * dayMs).toISOString().slice(0, 10);
const wideEnd = new Date(Date.now() + 7 * dayMs).toISOString().slice(0, 10);

async function seedSale({ qty = 5, unitPrice = 20, buyPrice = 10 } = {}) {
    const p = await auth(request.post('/api/products')).send({
        name: `منتج lens-${uniq('P')}`, code: uniq('C'),
        buyPrice, retailPrice: unitPrice, shopQty: 100,
    });
    ok(p, 'createProduct');
    const c = await auth(request.post('/api/customers')).send({ name: `عميل lens-${uniq('C')}`, phone: uniq('9') });
    ok(c, 'createCustomer');
    const inv = await auth(request.post('/api/invoices')).send({
        customerId: id(c.body.data),
        items: [{ productId: id(p.body.data), qty, unitPrice }],
        paymentType: 'cash',
    });
    ok(inv, 'createCashInvoice');
    return { product: p.body.data, customer: c.body.data, invoice: inv.body.data };
}

async function kpis() {
    // T-PERF-02: getKPIs is TTL-cached — clear so each read sees fresh writes.
    const { __dashboardCaches } = await import('../services/dashboardService.js');
    __dashboardCaches.kpiCache.clear();
    const res = await auth(request.get('/api/dashboard/kpis'));
    ok(res, 'getKPIs');
    return res.body.data.kpis;
}

async function pnl() {
    const res = await auth(request.get(`/api/reports/financial?startDate=${wideStart}&endDate=${wideEnd}`));
    ok(res, 'getFinancialReport');
    return res.body.data.financials;
}

describe('T-02: profit lenses', () => {
    it('cash sale books revenue+COGS in the GL lens and profit in the dashboard lens', async () => {
        // 5 × 20 = 100 revenue, cost 5 × 10 = 50 → profit 50
        const before = await kpis();
        const pnlBefore = await pnl();
        await seedSale();
        const after = await kpis();
        const pnlAfter = await pnl();
        expect(after.todayProfit - before.todayProfit).toBeCloseTo(50, 2);
        expect(pnlAfter.netProfit - pnlBefore.netProfit).toBeCloseTo(50, 2);
        expect(pnlAfter.revenue.total - pnlBefore.revenue.total).toBeCloseTo(100, 2);
        expect(pnlAfter.cogs - pnlBefore.cogs).toBeCloseTo(50, 2);
    });

    it('manual expense reduces BOTH lenses by the same amount', async () => {
        const before = await kpis();
        const pnlBefore = await pnl();
        const res = await auth(request.post('/api/financial/expenses')).send({
            amount: 30, reason: 'اختبار عدسة', category: 'other', date: new Date().toISOString(),
        });
        ok(res, 'manualExpense');
        const after = await kpis();
        const pnlAfter = await pnl();
        expect(before.todayProfit - after.todayProfit).toBeCloseTo(30, 2);
        expect(pnlBefore.netProfit - pnlAfter.netProfit).toBeCloseTo(30, 2);
    });

    it('DOCUMENTED DIVERGENCE: credit refund reduces dashboard profit but not GL profit', async () => {
        const c = await auth(request.post('/api/customers')).send({
            name: `عميل refund-${uniq('C')}`, phone: uniq('9'),
            openingBalance: 200, openingBalanceType: 'credit',
        });
        ok(c, 'createCreditCustomer');
        const cid = id(c.body.data);
        const before = await kpis();
        const pnlBefore = await pnl();
        const res = await auth(request.post(`/api/financial/refunds/customer-credit/${cid}`)).send({
            amount: 60, method: 'cash',
        });
        ok(res, 'creditRefund');
        const after = await kpis();
        const pnlAfter = await pnl();
        // Dashboard counts the Manual EXPENSE leg...
        expect(before.todayProfit - after.todayProfit).toBeCloseTo(60, 2);
        // ...the GL lens does not (no AccountingEntry is written).
        expect(pnlAfter.netProfit - pnlBefore.netProfit).toBeCloseTo(0, 2);
    });
});
