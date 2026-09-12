import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';
import { randomUUID } from 'crypto';

// T-12 (FIN-TAHWEESH profit isolation) — the plan §7/§8 contract, proven on
// BOTH profit lenses plus the global conservation identity:
//   deposit → spend-as-payable → spend-as-expense → withdraw-rest.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Proof Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const auth = (req) => req.set('Cookie', ownerCookie);
const dayMs = 24 * 60 * 60 * 1000;
const wideStart = new Date(Date.now() - 7 * dayMs).toISOString().slice(0, 10);
const wideEnd = new Date(Date.now() + 7 * dayMs).toISOString().slice(0, 10);

async function pnl() {
    const res = await auth(request.get(`/api/reports/financial?startDate=${wideStart}&endDate=${wideEnd}`));
    ok(res, 'getFinancialReport');
    return res.body.data.financials.netProfit;
}
async function dashProfit() {
    const { __dashboardCaches } = await import('../services/dashboardService.js');
    __dashboardCaches.kpiCache.clear();
    const res = await auth(request.get('/api/dashboard/kpis'));
    ok(res, 'getKPIs');
    return res.body.data.kpis.todayProfit;
}
async function globalBalance() {
    const { TreasuryService } = await import('../services/treasuryService.js');
    return TreasuryService.getCurrentBalance();
}
async function tahweeshBalance() {
    const res = await auth(request.get('/api/tahweesh/balance'));
    ok(res, 'getBalance');
    return res.body.data.balance;
}

describe('T-12: transfer-only subsequences never move profit', () => {
    it('§7/§8 full cycle: deposit → pay debt → book expense → withdraw', async () => {
        // Fund: 1000 × 20 cash sale → revenue 20000, profit 10000.
        const p = await auth(request.post('/api/products')).send({
            name: `منتج إثبات-${uniq('P')}`, code: uniq('C'),
            buyPrice: 10, retailPrice: 20, shopQty: 2000,
        });
        ok(p, 'createProduct');
        const c = await auth(request.post('/api/customers')).send({ name: `عميل إثبات-${uniq('C')}`, phone: uniq('9') });
        ok(c, 'createCustomer');
        ok(await auth(request.post('/api/invoices')).send({
            customerId: id(c.body.data),
            items: [{ productId: id(p.body.data), qty: 1000, unitPrice: 20 }],
            paymentType: 'cash',
        }), 'fundSale');

        const pnl0 = await pnl();
        const dash0 = await dashProfit();
        const g0 = await globalBalance();

        // 1. Deposit 20000 → both lenses AND global unchanged.
        ok(await auth(request.post('/api/tahweesh/deposit')).send({
            source: 'cash', amount: 20000, transferId: randomUUID(),
        }), 'deposit');
        expect(await tahweeshBalance()).toBeCloseTo(20000, 2);
        expect(await pnl() - pnl0).toBeCloseTo(0, 2);
        expect(await dashProfit() - dash0).toBeCloseTo(0, 2);
        expect(await globalBalance() - g0).toBeCloseTo(0, 2);

        // 2. Spend 5000 on a supplier debt → payable, not expense: lenses still flat.
        const s = await auth(request.post('/api/suppliers')).send({ name: `مورد إثبات-${uniq('S')}` });
        ok(s, 'createSupplier');
        const d = await auth(request.post('/api/financial/debts')).send({
            debtorType: 'Supplier', debtorId: id(s.body.data), amount: 5000, description: 'إثبات',
        });
        ok(d, 'createDebt');
        ok(await auth(request.post('/api/financial/payments')).send({
            debtId: id(d.body.data), amount: 5000, method: 'tahweesh',
        }), 'tahweeshDebtPay');
        expect(await tahweeshBalance()).toBeCloseTo(15000, 2);
        expect(await pnl() - pnl0).toBeCloseTo(0, 2);
        expect(await dashProfit() - dash0).toBeCloseTo(0, 2);
        expect(await globalBalance() - g0).toBeCloseTo(-5000, 2); // real outflow

        // 3. Spend 5000 as a REAL operating expense → exactly −5000 once, both lenses.
        const reason = `مصروف إثبات-${uniq('E')}`;
        ok(await auth(request.post('/api/financial/expenses')).send({
            amount: 5000, reason, category: 'other', method: 'tahweesh', date: new Date().toISOString(),
        }), 'tahweeshExpense');
        expect(await tahweeshBalance()).toBeCloseTo(10000, 2);
        expect((await pnl()) - pnl0).toBeCloseTo(-5000, 2);
        expect((await dashProfit()) - dash0).toBeCloseTo(-5000, 2);
        expect(await globalBalance() - g0).toBeCloseTo(-10000, 2);

        // 4. Withdraw the rest → lenses flat again, set-aside empty.
        ok(await auth(request.post('/api/tahweesh/withdraw')).send({
            amount: 10000, transferId: randomUUID(),
        }), 'withdraw');
        expect(await tahweeshBalance()).toBeCloseTo(0, 2);
        expect((await pnl()) - pnl0).toBeCloseTo(-5000, 2);
        expect((await dashProfit()) - dash0).toBeCloseTo(-5000, 2);
        expect(await globalBalance() - g0).toBeCloseTo(-10000, 2);

        // 5. Conservation identity: sale income minus the two real outflows.
        // Stored set-aside agrees with the ledger rebuild.
        const { TreasuryService } = await import('../services/treasuryService.js');
        expect(await TreasuryService.rebuildTahweeshBalance()).toBeCloseTo(0, 2);
    });
});
