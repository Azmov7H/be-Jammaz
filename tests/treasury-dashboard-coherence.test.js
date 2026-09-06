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
let ownerUser;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie, user: ownerUser } = await seedUser(request, { name: 'Treasury Coh', role: 'owner' }));
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

    it('ledger is paginated with a window-wide total', async () => {
        const { from, to } = window_();
        const q = (extra) => `/api/treasury/transactions?startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}${extra}`;
        const p1 = await request.get(q('&page=1&limit=1')).set('Cookie', ownerCookie);
        const p2 = await request.get(q('&page=2&limit=1')).set('Cookie', ownerCookie);
        expect(p1.status).toBe(200);
        expect(p1.body.data.transactions).toHaveLength(1);
        expect(p1.body.data.total).toBeGreaterThanOrEqual(2);
        expect(p2.body.data.transactions).toHaveLength(1);
        expect(p2.body.data.total).toBe(p1.body.data.total);
        expect(p2.body.data.transactions[0]._id).not.toBe(p1.body.data.transactions[0]._id);
    });

    it('ledger category narrows server-side like the export', async () => {
        const { from, to } = window_();
        const res = await request
            .get(`/api/treasury/transactions?startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&category=shop_expenses`)
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        expect(res.body.data.transactions.length).toBeGreaterThan(0);
        for (const tx of res.body.data.transactions) {
            expect(tx.type).toBe('EXPENSE');
            expect(['Manual', 'SalesReturn']).toContain(tx.referenceType);
        }
    });

    it('unified collections carry the customer name (no --- party)', async () => {
        const created = await request.post('/api/customers').set('Cookie', ownerCookie).send({
            name: `عميل uc-${Date.now()}`,
            phone: `079${String(Date.now()).slice(-7)}`,
            priceType: 'retail',
        });
        expect(created.status).toBeLessThan(300);
        const { TreasuryService } = await import('../services/treasuryService.js');
        await TreasuryService.recordUnifiedCollection(created.body.data, 250, ownerUser._id);
        const { from, to } = window_();
        const res = await request
            .get(`/api/treasury/transactions?startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&limit=100`)
            .set('Cookie', ownerCookie);
        const uc = res.body.data.transactions.find((t) => t.referenceType === 'UnifiedCollection');
        expect(uc).toBeDefined();
        expect(uc.referenceId?.name).toBe(created.body.data.name);
    });

    it('exports a real Arabic PDF for treasuryTransactions', async () => {
        const { from, to } = window_();
        const res = await request.post('/api/export')
            .set('Cookie', ownerCookie)
            .send({ type: 'treasuryTransactions', format: 'pdf', filters: { startDate: from, endDate: to } });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(Buffer.from(res.body).slice(0, 5).toString()).toBe('%PDF-');
    });

    it('rejects PDF for non-treasury modules', async () => {
        const res = await request.post('/api/export')
            .set('Cookie', ownerCookie)
            .send({ type: 'customers', format: 'pdf', filters: {} });
        expect(res.status).toBe(400);
    });
});
