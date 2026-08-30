import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// Sprint 3 — transfer-source integration (T-INT-001..006, row 20 of the test
// matrix): instapay/wallet REQUIRE a sourceNumber on every new payment path;
// cash/bank accept it empty; historical rows without it stay valid.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'S3 Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(300);

async function createProduct(overrides = {}) {
    const res = await request.post('/api/products').set('Cookie', ownerCookie).send({
        name: `منتج s3-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 20, warehouseQty: 0, shopQty: 0, ...overrides,
    });
    ok(res, 'createProduct');
    return res.body.data;
}
async function createCustomer() {
    const res = await request.post('/api/customers').set('Cookie', ownerCookie)
        .send({ name: `عميل s3-${uniq('X')}`, phone: uniq('079') });
    ok(res, 'createCustomer');
    return res.body.data;
}
async function createSupplier() {
    const res = await request.post('/api/suppliers').set('Cookie', ownerCookie)
        .send({ name: `مورد s3-${uniq('S')}` });
    ok(res, 'createSupplier');
    return res.body.data;
}

async function findTx(query) {
    const { default: Txn } = await import('../models/TreasuryTransaction.js');
    return Txn.findOne(query);
}

describe('T-INT-001/002 — Sale via InstaPay (FIN-VAL-003 / FIN-SVC-004)', () => {
    it('instapay sale WITHOUT source is rejected 400', async () => {
        const product = await createProduct({ shopQty: 10 });
        const res = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            items: [{ productId: id(product), qty: 1, unitPrice: 20 }],
            paymentType: 'instapay',
        });
        expect(res.status).toBe(400);
        // invoice controller uses raw `invoiceSchema.parse` (mapError emits field
        // errors at the top of `details`), unlike the `validate` middleware paths
        // which nest them under `details.fieldErrors`.
        const fe = res.body.details?.fieldErrors ?? res.body.details ?? {};
        expect(fe).toHaveProperty('sourceNumber');
    });

    it('instapay sale WITH source succeeds and records sourceNumber', async () => {
        const product = await createProduct({ shopQty: 10 });
        const res = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            items: [{ productId: id(product), qty: 1, unitPrice: 20 }],
            paymentType: 'instapay',
            sourceNumber: 'INSTA-777',
        });
        ok(res, 'instapay sale');
        const tx = await findTx({ referenceType: 'Invoice', type: 'INCOME' });
        expect(tx.sourceNumber).toBe('INSTA-777');
    });
});

describe('T-INT-003/004 — Collection via InstaPay/Wallet (FIN-VAL-002 / FIN-SVC-003)', () => {
    it('wallet debt payment without source rejected; with source records it', async () => {
        const product = await createProduct({ shopQty: 100 });
        const customer = await createCustomer();
        const inv = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 60, unitPrice: 20 }],
            paymentType: 'credit',
        });
        ok(inv, 'credit invoice');
        const invoiceId = id(inv.body.data);

        const Debt = (await import('../models/Debt.js')).default;
        const debt = await Debt.findOne({ referenceId: invoiceId });

        // wallet without source -> rejected
        const bad = await request.post('/api/financial/payments/debt').set('Cookie', ownerCookie)
            .send({ debt: String(debt._id), amount: 400, method: 'wallet' });
        expect(bad.status).toBe(400);
        expect(bad.body.details.fieldErrors).toHaveProperty('sourceNumber');

        // wallet with source -> accepted, source persisted on the txn
        const pay = await request.post('/api/financial/payments/debt').set('Cookie', ownerCookie)
            .send({ debt: String(debt._id), amount: 400, method: 'wallet', sourceNumber: 'WAL-123' });
        ok(pay, 'wallet debt payment');
        const tx = await findTx({ referenceType: 'Debt', type: 'INCOME' });
        expect(tx.sourceNumber).toBe('WAL-123');
    });
});

describe('T-INT-005 — Supplier payment via Wallet (FIN-VAL-002 / FIN-SVC-003)', () => {
    it('instapay supplier payment without source rejected; wallet with source records it', async () => {
        const product = await createProduct({ warehouseQty: 0 });
        const supplier = await createSupplier();
        const po = await request.post('/api/purchase-orders').set('Cookie', ownerCookie).send({
            supplierId: id(supplier),
            items: [{ productId: id(product), quantity: 12, costPrice: 5 }],
            paymentType: 'credit',
        });
        ok(po, 'create PO');
        const poId = id(po.body.data);
        const recv = await request.post(`/api/purchase-orders/${poId}/receive`).set('Cookie', ownerCookie).send({});
        ok(recv, 'receive PO');

        // instapay without source -> rejected
        const bad = await request.post('/api/financial/payments/supplier').set('Cookie', ownerCookie)
            .send({ po: poId, amount: 30, method: 'instapay' });
        expect(bad.status).toBe(400);
        expect(bad.body.details.fieldErrors).toHaveProperty('sourceNumber');

        // wallet with source -> accepted, source persisted
        const pay = await request.post('/api/financial/payments/supplier').set('Cookie', ownerCookie)
            .send({ po: poId, amount: 30, method: 'wallet', sourceNumber: 'SUP-456' });
        ok(pay, 'wallet supplier payment');
        const tx = await findTx({ referenceType: 'PurchaseOrder', type: 'EXPENSE' });
        expect(tx.sourceNumber).toBe('SUP-456');
    });
});

describe('T-INT-002(expense) — Manual expense via instapay (FIN-VAL-002)', () => {
    it('instapay expense without source rejected; cash accepted', async () => {
        const bad = await request.post('/api/financial/transaction').set('Cookie', ownerCookie).send({
            amount: 50, description: 'مصروف', type: 'EXPENSE', category: 'other', method: 'instapay',
        });
        expect(bad.status).toBe(400);
        expect(bad.body.details.fieldErrors).toHaveProperty('sourceNumber');

        const cashOk = await request.post('/api/financial/transaction').set('Cookie', ownerCookie).send({
            amount: 25, description: 'مصروف نقدي', type: 'EXPENSE', category: 'other', method: 'cash',
        });
        ok(cashOk, 'cash expense');
    });
});

describe('Row 20 — historical wallet txn without source stays valid (T-INT-012)', () => {
    it('a pre-change wallet txn with no sourceNumber is readable and not rejected', async () => {
        const { default: Txn } = await import('../models/TreasuryTransaction.js');
        const legacy = await Txn.create({
            type: 'INCOME', amount: 999, description: 'legacy wallet',
            referenceType: 'Manual', method: 'wallet',
        });
        const found = await Txn.findById(legacy._id).lean();
        expect(found).toBeTruthy();
        expect(found.method).toBe('wallet');
        expect(found.sourceNumber ?? '').toBe('');
    });
});
