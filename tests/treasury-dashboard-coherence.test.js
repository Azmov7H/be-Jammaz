import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// TREAS-COH-001 — treasury dashboard coherence.
//
// The /financial page mixes lifetime figures (balance, method breakdown)
// with period figures (income/expense/net). These tests lock the
// coherence invariants the UI now relies on:
//  1. getSummary returns DB-aggregated expense splits (supplierPayments /
//     shopExpenses) over the SAME window as totalIncome/totalExpense.
//  2. getCashFlow buckets cover the full window (never page-capped) and
//     agree with the summary totals.
//  3. The CSV export accepts a `category` filter matching the on-screen
//     table taxonomy (supplier_payments / shop_expenses).

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Treasury Coh', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

function window_() {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    return { from, to };
}

async function seedLedger() {
    const income = await request.post('/api/treasury/manual-income').set('Cookie', ownerCookie).send({
        amount: 5000, reason: 'coh-income-seed', method: 'cash',
    });
    expect(income.status).toBeLessThan(300);
    const expense = await request.post('/api/treasury/manual-expense').set('Cookie', ownerCookie).send({
        amount: 1500, reason: 'coh-expense-seed', category: 'other', method: 'cash',
    });
    expect(expense.status).toBeLessThan(300);
}

describe('Treasury dashboard coherence', () => {
    it('summary splits are period-accurate and agree with totals', async () => {
        await seedLedger();
        const { from, to } = window_();
        const res = await request
            .get(`/api/treasury/summary?startDate=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
            .set('Cookie', ownerCookie);
        // NOTE: summary reads `endDate`, not `to` — an unknown key must not
        // break the endpoint (defaults apply).
        expect(res.status).toBe(200);
        expect(res.body.data.shopExpenses).toBeGreaterThanOrEqual(1500);
        expect(res.body.data.supplierPayments).toBe(0);
        expect(res.body.data.shopExpenses).toBeLessThanOrEqual(res.body.data.totalExpense);
        expect(res.body.data.supplierPayments).toBeLessThanOrEqual(res.body.data.totalExpense);
        expect(res.body.data.transactionCount).toBeGreaterThanOrEqual(2);
    });

    it('summary with an explicit window keeps splits inside totals', async () => {
        const { from, to } = window_();
        const res = await request
            .get(`/api/treasury/summary?startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}`)
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        const d = res.body.data;
        expect(d.periodBalance).toBe(d.totalIncome - d.totalExpense);
        expect(d.shopExpenses + d.supplierPayments).toBeLessThanOrEqual(d.totalExpense);
    });

    it('cashflow buckets agree with summary totals', async () => {
        const { from, to } = window_();
        const [cf, summary] = await Promise.all([
            request.get(`/api/treasury/cashflow?startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}`).set('Cookie', ownerCookie),
            request.get(`/api/treasury/summary?startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}`).set('Cookie', ownerCookie),
        ]);
        expect(cf.status).toBe(200);
        expect(cf.body.data.granularity).toBe('day');
        const income = cf.body.data.buckets.reduce((s, b) => s + b.income, 0);
        const expense = cf.body.data.buckets.reduce((s, b) => s + b.expense, 0);
        expect(income).toBe(summary.body.data.totalIncome);
        expect(expense).toBe(summary.body.data.totalExpense);
    });

    it('export honors the category filter', async () => {
        const { from, to } = window_();
        const body = (filters) => ({ type: 'treasuryTransactions', format: 'csv', filters });
        const shop = await request.post('/api/export')
            .set('Cookie', ownerCookie)
            .send(body({ category: 'shop_expenses', startDate: from, endDate: to }));
        expect(shop.status).toBe(200);
        expect(shop.text).toContain('coh-expense-seed');
        expect(shop.text).not.toContain('coh-income-seed');

        const supplier = await request.post('/api/export')
            .set('Cookie', ownerCookie)
            .send(body({ category: 'supplier_payments', startDate: from, endDate: to }));
        expect(supplier.status).toBe(200);
        expect(supplier.text).not.toContain('coh-expense-seed');
    });
});
