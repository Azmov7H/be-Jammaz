import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';
import { randomUUID } from 'crypto';

// T-11 (FIN-TAHWEESH-03) — return-to-cash pairs and single-transaction
// spends from the set-aside, all guarded, all counted once.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Spend Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const auth = (req) => req.set('Cookie', ownerCookie);

async function fundCash(total = 200) {
    const p = await auth(request.post('/api/products')).send({
        name: `منتج سحب-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 20, shopQty: 100,
    });
    ok(p, 'createProduct');
    const c = await auth(request.post('/api/customers')).send({ name: `عميل سحب-${uniq('C')}`, phone: uniq('9') });
    ok(c, 'createCustomer');
    const inv = await auth(request.post('/api/invoices')).send({
        customerId: id(c.body.data),
        items: [{ productId: id(p.body.data), qty: total / 20, unitPrice: 20 }],
        paymentType: 'cash',
    });
    ok(inv, 'fundSale');
}

async function depositCash(amount) {
    const res = await auth(request.post('/api/tahweesh/deposit')).send({
        source: 'cash', amount, transferId: randomUUID(),
    });
    ok(res, 'deposit');
    return res.body.data.tahweeshBalance;
}

async function tahweeshBalance() {
    const res = await auth(request.get('/api/tahweesh/balance'));
    ok(res, 'getBalance');
    return res.body.data.balance;
}

async function todayCashbox() {
    const res = await auth(request.get(`/api/treasury/daily?date=${encodeURIComponent(new Date().toISOString())}`));
    ok(res, 'dailyCashbox');
    return res.body.data;
}

describe('T-11: withdraw', () => {
    it('valid withdraw pairs legs, credits cash manual, conserves the global', async () => {
        await fundCash(200);
        await depositCash(100);
        const { TreasuryService } = await import('../services/treasuryService.js');
        const gBefore = await TreasuryService.getCurrentBalance();
        const cbBefore = await todayCashbox();
        const res = await auth(request.post('/api/tahweesh/withdraw')).send({
            amount: 40, note: 'سحب اختبار', transferId: randomUUID(),
        });
        ok(res, 'withdraw');
        expect(res.body.data.tahweeshBalance).toBeCloseTo(60, 2);
        const { default: Txn } = await import('../models/TreasuryTransaction.js');
        const legs = await Txn.find({ referenceType: 'TahweeshTransfer', 'meta.transferId': res.body.data.legs[0].meta.transferId }).lean();
        expect(legs).toHaveLength(2);
        expect(legs.find((l) => l.type === 'EXPENSE').method).toBe('tahweesh');
        expect(legs.find((l) => l.type === 'INCOME').method).toBe('cash');
        expect(await TreasuryService.getCurrentBalance() - gBefore).toBeCloseTo(0, 2);
        // Cash return is manual cash-in, not a sale...
        const cbAfter = await todayCashbox();
        expect((cbAfter.manualIncome || []).length - (cbBefore.manualIncome || []).length).toBe(1);
        expect(cbAfter.salesIncome || 0).toBeCloseTo(cbBefore.salesIncome || 0, 2);
    });

    it('over-available withdraw is rejected with nothing written', async () => {
        const bal = await tahweeshBalance();
        const t = randomUUID();
        const res = await auth(request.post('/api/tahweesh/withdraw')).send({ amount: bal + 50, transferId: t });
        expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(400);
        expect(JSON.stringify(res.body)).toContain('التحويش');
        const { default: Txn } = await import('../models/TreasuryTransaction.js');
        expect(await Txn.countDocuments({ 'meta.transferId': t })).toBe(0);
        expect(await tahweeshBalance()).toBeCloseTo(bal, 2);
    });

    it('withdraw replay is idempotent', async () => {
        const payload = { amount: 10, transferId: randomUUID() };
        const first = await auth(request.post('/api/tahweesh/withdraw')).send(payload);
        ok(first, 'withdraw');
        const second = await auth(request.post('/api/tahweesh/withdraw')).send(payload);
        ok(second, 'replay');
        expect(second.body.data.duplicate).toBe(true);
    });
});

describe('T-11: spends', () => {
    it('supplier debt payment from Tahweesh settles the debt, moves only the set-aside', async () => {
        const s = await auth(request.post('/api/suppliers')).send({ name: `مورد دين-${uniq('S')}` });
        ok(s, 'createSupplier');
        const d = await auth(request.post('/api/financial/debts')).send({
            debtorType: 'Supplier', debtorId: id(s.body.data), amount: 80, description: 'دين تحويش',
        });
        ok(d, 'createDebt');
        await fundCash(200);
        const balBefore = await depositCash(100);
        const cbBefore = await todayCashbox();
        const pay = await auth(request.post('/api/financial/payments')).send({
            debtId: id(d.body.data), amount: 80, method: 'tahweesh',
        });
        ok(pay, 'tahweeshDebtPay');
        const { default: Debt } = await import('../models/Debt.js');
        expect((await Debt.findById(id(d.body.data)).lean()).status).toBe('settled');
        expect(balBefore - (await tahweeshBalance())).toBeCloseTo(80, 2);
        // No drawer bucket moved for the spend...
        const cbAfter = await todayCashbox();
        expect(cbAfter.purchaseExpenses || 0).toBeCloseTo(cbBefore.purchaseExpenses || 0, 2);
        expect((cbAfter.manualExpenses || []).length).toBe((cbBefore.manualExpenses || []).length);
        // ...but the treasury leg exists exactly once, on the set-aside.
        const { default: Txn } = await import('../models/TreasuryTransaction.js');
        expect(await Txn.countDocuments({ referenceType: 'Debt', referenceId: id(d.body.data), method: 'tahweesh' })).toBe(1);
    });

    it('operating expense from Tahweesh books GL once and decrements once', async () => {
        await fundCash(200);
        await depositCash(120);
        const reason = `مصروف تحويش-${uniq('E')}`;
        const balBefore = await tahweeshBalance();
        const res = await auth(request.post('/api/financial/expenses')).send({
            amount: 70, reason, category: 'other', method: 'tahweesh', date: new Date().toISOString(),
        });
        ok(res, 'tahweeshExpense');
        const { default: AE } = await import('../models/AccountingEntry.js');
        expect(await AE.countDocuments({ description: reason, type: 'EXPENSE' })).toBe(1);
        expect(balBefore - (await tahweeshBalance())).toBeCloseTo(70, 2);
    });

    it('concurrent overspends: exactly one wins, never negative, stored==derived', async () => {
        // Contend for the WHOLE current balance: each payment alone is
        // valid, together they exceed it — exactly one must win.
        const current = await tahweeshBalance();
        expect(current).toBeGreaterThan(0);
        const each = Number(current.toFixed(2));
        const mkDebt = async () => {
            const s = await auth(request.post('/api/suppliers')).send({ name: `مورد سباق-${uniq('S')}` });
            ok(s, 'createSupplier');
            const d = await auth(request.post('/api/financial/debts')).send({
                debtorType: 'Supplier', debtorId: id(s.body.data), amount: each, description: 'سباق',
            });
            ok(d, 'createDebt');
            return id(d.body.data);
        };
        const [a, b] = [await mkDebt(), await mkDebt()];
        const [r1, r2] = await Promise.all([
            auth(request.post('/api/financial/payments')).send({ debtId: a, amount: each, method: 'tahweesh' }),
            auth(request.post('/api/financial/payments')).send({ debtId: b, amount: each, method: 'tahweesh' }),
        ]);
        const statuses = [r1.status, r2.status].sort((x, y) => x - y);
        expect(statuses[0]).toBeLessThan(300);
        expect(statuses[1]).toBeGreaterThanOrEqual(400);
        const bal = await tahweeshBalance();
        expect(bal).toBeGreaterThanOrEqual(-0.01);
        const { TreasuryService } = await import('../services/treasuryService.js');
        expect(await TreasuryService.rebuildTahweeshBalance()).toBeCloseTo(bal, 2);
    });

    it('single-leg undo of a transfer pair is refused', async () => {
        await fundCash(200);
        const transferId = randomUUID();
        ok(await auth(request.post('/api/tahweesh/deposit')).send({ source: 'cash', amount: 30, transferId }), 'deposit');
        const { default: Txn } = await import('../models/TreasuryTransaction.js');
        const leg = await Txn.findOne({ 'meta.transferId': transferId }).lean();
        const undo = await auth(request.delete(`/api/treasury/transactions/${leg._id}`));
        expect(undo.status, JSON.stringify(undo.body).slice(0, 200)).toBe(409);
    });

    it('cash deposit never touches purchaseExpenses (transfer is not a purchase)', async () => {
        await fundCash(200);
        const cbBefore = await todayCashbox();
        await depositCash(50);
        const cbAfter = await todayCashbox();
        expect(cbAfter.purchaseExpenses || 0).toBeCloseTo(cbBefore.purchaseExpenses || 0, 2);
        expect((cbAfter.manualExpenses || []).length - (cbBefore.manualExpenses || []).length).toBe(1);
    });
});
