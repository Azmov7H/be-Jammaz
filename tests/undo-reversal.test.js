import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// T-05 (FIN-UNDO-01) — undo/delete-by-ref must reverse EXACTLY the buckets
// the write touched: no cash-accumulator assumption, no unguarded decrements,
// no method-bucket touch for adjustment (book-only) rows.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Undo Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const auth = (req) => req.set('Cookie', ownerCookie);
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

async function Txn() {
    return (await import('../models/TreasuryTransaction.js')).default;
}
async function Cashbox() {
    return (await import('../models/CashboxDaily.js')).default;
}
async function dayBuckets(date) {
    const CB = await Cashbox();
    return CB.findOne({ date: dayStart(date) }).lean();
}

async function makeProduct() {
    const res = await auth(request.post('/api/products')).send({
        name: `منتج undo-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 20, shopQty: 100,
    });
    ok(res, 'createProduct');
    return res.body.data;
}
async function makeCustomer() {
    const res = await auth(request.post('/api/customers')).send({ name: `عميل undo-${uniq('C')}`, phone: uniq('9') });
    ok(res, 'createCustomer');
    return res.body.data;
}

describe('T-05: exact-inverse undo', () => {
    it('bank sale undo reverses bankIncome only, never salesIncome', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        const inv = await auth(request.post('/api/invoices')).send({
            customerId: id(c), items: [{ productId: id(p), qty: 5, unitPrice: 20 }],
            paymentType: 'bank',
        });
        ok(inv, 'bankInvoice');
        const T = await Txn();
        const tx = await T.findOne({ referenceType: 'Invoice', referenceId: id(inv.body.data), type: 'INCOME' }).lean();
        expect(tx).toBeTruthy();
        expect(tx.method).toBe('bank');
        let cb = await dayBuckets(tx.date);
        expect(cb.bankIncome).toBeCloseTo(100, 2);

        const undo = await auth(request.delete(`/api/treasury/transactions/${tx._id}`));
        ok(undo, 'undoBankSale');
        cb = await dayBuckets(tx.date);
        expect(cb.bankIncome).toBeCloseTo(0, 2);
        // Old code subtracted salesIncome here (never incremented) → negative.
        expect(cb.salesIncome || 0).toBeGreaterThanOrEqual(-0.01);
    });

    it('cash sale undo restores salesIncome (regression)', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        const inv = await auth(request.post('/api/invoices')).send({
            customerId: id(c), items: [{ productId: id(p), qty: 2, unitPrice: 20 }],
            paymentType: 'cash',
        });
        ok(inv, 'cashInvoice');
        const T = await Txn();
        const tx = await T.findOne({ referenceType: 'Invoice', referenceId: id(inv.body.data), type: 'INCOME' }).lean();
        const before = await dayBuckets(tx.date);
        const undo = await auth(request.delete(`/api/treasury/transactions/${tx._id}`));
        ok(undo, 'undoCashSale');
        const after = await dayBuckets(tx.date);
        expect((before.salesIncome || 0) - (after.salesIncome || 0)).toBeCloseTo(40, 2);
    });

    it('debt-adjustment undo touches no cashbox bucket', async () => {
        const c = await makeCustomer();
        const d = await auth(request.post('/api/financial/debts')).send({
            debtorType: 'Customer', debtorId: id(c), amount: 80, description: 'تعديل',
        });
        ok(d, 'createDebt');
        const patch = await auth(request.patch(`/api/financial/debts/${id(d.body.data)}`)).send({ remainingAmount: 50 });
        ok(patch, 'adjustDebt');
        const T = await Txn();
        const adj = await T.findOne({ referenceType: 'Debt', referenceId: id(d.body.data) }).lean();
        expect(adj).toBeTruthy();
        expect(adj.method).toBe('adjustment');
        const CB = await Cashbox();
        const before = await CB.findOne({ date: dayStart(adj.date) }).lean();
        const undo = await auth(request.delete(`/api/treasury/transactions/${adj._id}`));
        ok(undo, 'undoAdjustment');
        const after = await CB.findOne({ date: dayStart(adj.date) }).lean();
        // Old code decremented the cash bucket via the 'adjustment' fallback.
        expect(after.salesIncome || 0).toBeCloseTo(before?.salesIncome || 0, 2);
        expect(after.purchaseExpenses || 0).toBeCloseTo(before?.purchaseExpenses || 0, 2);
    });

    it('supplier payment undo restores the exact method bucket', async () => {
        const s = await auth(request.post('/api/suppliers')).send({ name: `مورد undo-${uniq('S')}` });
        ok(s, 'createSupplier');
        const p = await makeProduct();
        const po = await auth(request.post('/api/purchase-orders')).send({
            supplierId: id(s.body.data),
            items: [{ productId: id(p), quantity: 12, costPrice: 5 }],
            paymentType: 'credit',
        });
        ok(po, 'createPO');
        const recv = await auth(request.post(`/api/purchase-orders/${id(po.body.data)}/receive`)).send({});
        ok(recv, 'receivePO');
        const pay = await auth(request.post('/api/financial/payments/supplier')).send({
            po: id(po.body.data), amount: 60, method: 'cash',
        });
        ok(pay, 'supplierPay');
        const T = await Txn();
        const tx = await T.findOne({ referenceType: 'PurchaseOrder', referenceId: id(po.body.data), type: 'EXPENSE' }).lean();
        const before = await dayBuckets(tx.date);
        const undo = await auth(request.delete(`/api/treasury/transactions/${tx._id}`));
        ok(undo, 'undoSupplierPay');
        const after = await dayBuckets(tx.date);
        expect((before.purchaseExpenses || 0) - (after.purchaseExpenses || 0)).toBeCloseTo(60, 2);
    });
});
