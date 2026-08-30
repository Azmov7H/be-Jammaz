import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';
import TreasuryBalance from '../models/TreasuryBalance.js';

// Sprint 5 — Customer Collections (FIN-SVC-003 / T-INT-004).
// Test-matrix rows 6–10 over the unified customer-collection endpoint:
//   Row 6:  cash collection, empty source      -> success + balance up
//   Row 7:  InstaPay collection, source present -> success, source stored
//   Row 8:  InstaPay collection, empty source   -> 400
//   Row 9:  Cash-wallet collection, source present -> success, source stored
//   Row 10: Cash-wallet collection, empty source   -> 400
// The `method` enum + `sourceRequiredRefine` live in validators.js; source is
// forwarded by FinanceService -> PaymentService -> TreasuryService.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'S5 Owner', role: 'owner' }));
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

/** Creates a customer with a credit-invoice debt; returns { customerId } */
async function makeCustomerWithDebt(qty = 5) {
    const customerRes = await request.post('/api/customers').set('Cookie', ownerCookie)
        .send({ name: `عميل s5-${uniq('X')}`, phone: uniq('079') });
    ok(customerRes, 'createCustomer');
    const customer = customerRes.body.data;

    const productRes = await request.post('/api/products').set('Cookie', ownerCookie).send({
        name: `منتج s5-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 20, warehouseQty: 0, shopQty: 100,
    });
    ok(productRes, 'createProduct');

    const inv = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
        customerId: id(customer),
        items: [{ productId: id(productRes.body.data), qty, unitPrice: 20 }],
        paymentType: 'credit',
    });
    ok(inv, 'credit invoice');
    return { customerId: String(id(customer)) };
}

describe('Sprint 5 — Customer Collections (matrix rows 6–10)', () => {
    it('row 6: cash collection (empty source) succeeds and raises the balance', async () => {
        const { customerId } = await makeCustomerWithDebt();
        const before = await getBalance();
        const res = await request.post(`/api/customers/${customerId}/pay`)
            .set('Cookie', ownerCookie).send({ amount: 60, method: 'cash' });
        ok(res, 'cash collection');
        expect((await getBalance()) - before).toBeCloseTo(60, 2);
        const tx = await findTxn({ referenceType: 'UnifiedCollection', type: 'INCOME', method: 'cash' });
        expect(tx.sourceNumber ?? '').toBe('');
    });

    it('rows 7/8: InstaPay collection — empty source 400; present source 200 + stored', async () => {
        const { customerId } = await makeCustomerWithDebt(8);

        const bad = await request.post(`/api/customers/${customerId}/pay`)
            .set('Cookie', ownerCookie).send({ amount: 40, method: 'instapay' });
        expect(bad.status).toBe(400);
        expect(bad.body.details.fieldErrors).toHaveProperty('sourceNumber');

        const good = await request.post(`/api/customers/${customerId}/pay`)
            .set('Cookie', ownerCookie).send({ amount: 40, method: 'instapay', sourceNumber: 'INSTA-S5-111' });
        ok(good, 'instapay collection with source');
        const tx = await findTxn({ referenceType: 'UnifiedCollection', type: 'INCOME', method: 'instapay' });
        expect(tx.sourceNumber).toBe('INSTA-S5-111');
    });

    it('rows 9/10: wallet collection — empty source 400; present source 200 + stored', async () => {
        const { customerId } = await makeCustomerWithDebt(8);

        const bad = await request.post(`/api/customers/${customerId}/pay`)
            .set('Cookie', ownerCookie).send({ amount: 40, method: 'wallet' });
        expect(bad.status).toBe(400);
        expect(bad.body.details.fieldErrors).toHaveProperty('sourceNumber');

        const good = await request.post(`/api/customers/${customerId}/pay`)
            .set('Cookie', ownerCookie).send({ amount: 40, method: 'wallet', sourceNumber: 'WAL-S5-222' });
        ok(good, 'wallet collection with source');
        const tx = await findTxn({ referenceType: 'UnifiedCollection', type: 'INCOME', method: 'wallet' });
        expect(tx.sourceNumber).toBe('WAL-S5-222');
    });
});
