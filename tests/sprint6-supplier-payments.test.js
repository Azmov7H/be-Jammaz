import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';
import TreasuryBalance from '../models/TreasuryBalance.js';

// Sprint 6 — Supplier Payments (FIN-SVC-004 / T-INT-005).
// Test-matrix rows 11–15 over the supplier-payment endpoint
// (POST /api/financial/payments/supplier, schema supplierPaymentSchema):
//   Row 11: cash payment, empty source        -> success + balance down
//   Row 12: InstaPay payment, source present   -> success, source stored
//   Row 13: InstaPay payment, empty source     -> 400
//   Row 14: Cash-wallet payment, source present -> success, source stored
//   Row 15: Cash-wallet payment, empty source   -> 400
// Source is forwarded by FinanceService -> PaymentService -> TreasuryService and
// validated by the `sourceRequiredRefine` on supplierPaymentSchema.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'S6 Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(300);

async function getBalance() {
    const doc = await TreasuryBalance.findById(TreasuryBalance.DOC_ID).lean();
    return doc?.balance ?? 0;
}

async function findTxn(query) {
    const { default: Txn } = await import('../models/TreasuryTransaction.js');
    return Txn.findOne(query).sort({ createdAt: -1 });
}

/** Creates a supplier + credited, received PO; returns { poId } */
async function makeReceivedPo(qty = 12) {
    const supplierRes = await request.post('/api/suppliers').set('Cookie', ownerCookie)
        .send({ name: `مورد s6-${uniq('S')}` });
    ok(supplierRes, 'createSupplier');
    const supplier = supplierRes.body.data;

    const productRes = await request.post('/api/products').set('Cookie', ownerCookie).send({
        name: `منتج s6-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 20, warehouseQty: 0, shopQty: 0,
    });
    ok(productRes, 'createProduct');
    const productId = id(productRes.body.data);

    const poRes = await request.post('/api/purchase-orders').set('Cookie', ownerCookie).send({
        supplierId: id(supplier),
        items: [{ productId, quantity: qty, costPrice: 5 }],
        paymentType: 'credit',
    });
    ok(poRes, 'create PO');
    const poId = id(poRes.body.data);

    const recv = await request.post(`/api/purchase-orders/${poId}/receive`).set('Cookie', ownerCookie).send({});
    ok(recv, 'receive PO');
    return { poId };
}

describe('Sprint 6 — Supplier Payments (matrix rows 11–15)', () => {
    it('row 11: cash supplier payment (empty source) succeeds and lowers the balance', async () => {
        const { poId } = await makeReceivedPo();
        const before = await getBalance();
        const res = await request.post('/api/financial/payments/supplier')
            .set('Cookie', ownerCookie).send({ po: poId, amount: 30, method: 'cash' });
        ok(res, 'cash supplier payment');
        expect(before - (await getBalance())).toBeCloseTo(30, 2);
        const tx = await findTxn({ referenceType: 'PurchaseOrder', type: 'EXPENSE', method: 'cash' });
        expect(tx.sourceNumber ?? '').toBe('');
    });

    it('rows 12/13: InstaPay supplier payment — empty source 400; present source 200 + stored', async () => {
        const { poId } = await makeReceivedPo();

        const bad = await request.post('/api/financial/payments/supplier')
            .set('Cookie', ownerCookie).send({ po: poId, amount: 30, method: 'instapay' });
        expect(bad.status).toBe(400);
        expect(bad.body.details.fieldErrors).toHaveProperty('sourceNumber');

        const good = await request.post('/api/financial/payments/supplier')
            .set('Cookie', ownerCookie).send({ po: poId, amount: 30, method: 'instapay', sourceNumber: 'INSTA-S6-111' });
        ok(good, 'instapay supplier payment with source');
        const tx = await findTxn({ referenceType: 'PurchaseOrder', type: 'EXPENSE', method: 'instapay' });
        expect(tx.sourceNumber).toBe('INSTA-S6-111');
    });

    it('rows 14/15: wallet supplier payment — empty source 400; present source 200 + stored', async () => {
        const { poId } = await makeReceivedPo();

        const bad = await request.post('/api/financial/payments/supplier')
            .set('Cookie', ownerCookie).send({ po: poId, amount: 30, method: 'wallet' });
        expect(bad.status).toBe(400);
        expect(bad.body.details.fieldErrors).toHaveProperty('sourceNumber');

        const good = await request.post('/api/financial/payments/supplier')
            .set('Cookie', ownerCookie).send({ po: poId, amount: 30, method: 'wallet', sourceNumber: 'WAL-S6-222' });
        ok(good, 'wallet supplier payment with source');
        const tx = await findTxn({ referenceType: 'PurchaseOrder', type: 'EXPENSE', method: 'wallet' });
        expect(tx.sourceNumber).toBe('WAL-S6-222');
    });
});
