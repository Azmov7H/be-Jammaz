import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// T-06 (FIN-GLREV-01) — cancelling a business object must not strand GL
// profit entries; single-leg undo of a profit-linked leg is refused with a
// clear message, Manual twins are mirrored, pure-treasury undos proceed.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'GLRev Owner', role: 'owner' }));
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
    return res.body.data.financials;
}
async function AE() {
    return (await import('../models/AccountingEntry.js')).default;
}
async function Txn() {
    return (await import('../models/TreasuryTransaction.js')).default;
}

async function makeProduct() {
    const res = await auth(request.post('/api/products')).send({
        name: `منتج glrev-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 20, shopQty: 100,
    });
    ok(res, 'createProduct');
    return res.body.data;
}
async function makeCustomer() {
    const res = await auth(request.post('/api/customers')).send({ name: `عميل glrev-${uniq('C')}`, phone: uniq('9') });
    ok(res, 'createCustomer');
    return res.body.data;
}

describe('T-06: GL reversal policy', () => {
    it('invoice cancel leaves Net Profit exactly where it was', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        const before = await pnl();
        const inv = await auth(request.post('/api/invoices')).send({
            customerId: id(c), items: [{ productId: id(p), qty: 5, unitPrice: 20 }],
            paymentType: 'cash',
        });
        ok(inv, 'cashInvoice');
        const mid = await pnl();
        expect(mid.netProfit - before.netProfit).toBeCloseTo(50, 2);
        const del = await auth(request.delete(`/api/invoices/${id(inv.body.data)}`));
        ok(del, 'cancelInvoice');
        const after = await pnl();
        expect(after.netProfit - before.netProfit).toBeCloseTo(0, 2);
        const M = await AE();
        const mirrors = await M.countDocuments({ refType: 'Invoice', refId: id(inv.body.data), type: 'REVERSAL' });
        expect(mirrors).toBeGreaterThanOrEqual(2); // SALE + COGS mirrors
    });

    it('single-leg undo of a profit-linked sale leg is refused (409)', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        const inv = await auth(request.post('/api/invoices')).send({
            customerId: id(c), items: [{ productId: id(p), qty: 2, unitPrice: 20 }],
            paymentType: 'cash',
        });
        ok(inv, 'cashInvoice');
        const T = await Txn();
        const tx = await T.findOne({ referenceType: 'Invoice', referenceId: id(inv.body.data), type: 'INCOME' }).lean();
        const undo = await auth(request.delete(`/api/treasury/transactions/${tx._id}`));
        expect(undo.status, JSON.stringify(undo.body).slice(0, 200)).toBe(409);
        expect(await T.countDocuments({ _id: tx._id })).toBe(1); // untouched
    });

    it('undo of a manual expense with a GL twin mirrors it (GL nets to zero)', async () => {
        const reason = `مصروف عكس-${uniq('E')}`;
        const created = await auth(request.post('/api/financial/expenses')).send({
            amount: 45, reason, category: 'other', date: new Date().toISOString(),
        });
        ok(created, 'manualExpense');
        const T = await Txn();
        const tx = await T.findOne({ description: reason, type: 'EXPENSE' }).lean();
        const undo = await auth(request.delete(`/api/treasury/transactions/${tx._id}`));
        ok(undo, 'undoManualExpense');
        expect(await T.countDocuments({ description: reason })).toBe(0);
        const M = await AE();
        const exp = await M.countDocuments({ description: reason, type: 'EXPENSE' });
        const rev = await M.countDocuments({ description: `تراجع: ${reason}`, type: 'REVERSAL' });
        expect(exp).toBe(1);
        expect(rev).toBe(1);
    });

    it('undo of a treasury-only manual proceeds without mirrors', async () => {
        const reason = `يدوي حر-${uniq('I')}`;
        const created = await auth(request.post('/api/treasury/manual-income')).send({
            amount: 200, reason, method: 'cash', date: new Date().toISOString(),
        });
        ok(created, 'manualIncome');
        const T = await Txn();
        const tx = await T.findOne({ description: reason }).lean();
        const undo = await auth(request.delete(`/api/treasury/transactions/${tx._id}`));
        ok(undo, 'undoTreasuryOnly');
        const M = await AE();
        expect(await M.countDocuments({ description: `تراجع: ${reason}` })).toBe(0);
    });

    it('undo of a balance-sheet-only supplier payment proceeds', async () => {
        const s = await auth(request.post('/api/suppliers')).send({ name: `مورد glrev-${uniq('S')}` });
        ok(s, 'createSupplier');
        const p = await makeProduct();
        const po = await auth(request.post('/api/purchase-orders')).send({
            supplierId: id(s.body.data),
            items: [{ productId: id(p), quantity: 12, costPrice: 5 }],
            paymentType: 'credit',
        });
        ok(po, 'createPO');
        ok(await auth(request.post(`/api/purchase-orders/${id(po.body.data)}/receive`)).send({}), 'receivePO');
        const pay = await auth(request.post('/api/financial/payments/supplier')).send({
            po: id(po.body.data), amount: 60, method: 'cash',
        });
        ok(pay, 'supplierPay');
        const T = await Txn();
        const tx = await T.findOne({ referenceType: 'PurchaseOrder', referenceId: id(po.body.data), type: 'EXPENSE' }).lean();
        const undo = await auth(request.delete(`/api/treasury/transactions/${tx._id}`));
        ok(undo, 'undoSupplierPay');
    });
});
