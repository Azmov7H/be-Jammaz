import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';
import TreasuryBalance from '../models/TreasuryBalance.js';

// Sprint 4 — sales integration (FIN-MDL-003 / FIN-SVC-004 / FIN-VAL-003).
// Test-matrix rows 1–5: cash/instapay/wallet sales and the sourceNumber rule.
//   Row 1: cash sale, empty source      -> success
//   Row 2: instapay sale, source present -> success, source stored
//   Row 3: instapay sale, empty source   -> 400            (covered here too)
//   Row 4: wallet sale, source present   -> success, source stored
//   Row 5: wallet sale, empty source     -> 400
// Also asserts the income is reflected in the treasury balance and cashbox.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'S4 Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(300);

async function createProduct(overrides = {}) {
    const res = await request.post('/api/products').set('Cookie', ownerCookie).send({
        name: `منتج s4-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 20, warehouseQty: 0, shopQty: 0, ...overrides,
    });
    ok(res, 'createProduct');
    return res.body.data;
}

async function getBalance() {
    const doc = await TreasuryBalance.findById(TreasuryBalance.DOC_ID).lean();
    return doc?.balance ?? 0;
}

async function findTx(query) {
    const { default: Txn } = await import('../models/TreasuryTransaction.js');
    return Txn.findOne(query);
}

describe('Sprint 4 — Sales via cash / instapay / wallet', () => {
    it('row 1: cash sale with empty source succeeds and hits the balance', async () => {
        const product = await createProduct({ shopQty: 10 });
        const before = await getBalance();
        const res = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            items: [{ productId: id(product), qty: 2, unitPrice: 20 }],
            paymentType: 'cash',
        });
        ok(res, 'cash sale');
        const after = await getBalance();
        expect(after - before).toBeCloseTo(40, 2);
        const tx = await findTx({ referenceType: 'Invoice', type: 'INCOME' });
        expect(tx.sourceNumber ?? '').toBe('');
    });

    it('rows 2/3: instapay sale — empty source 400; present source 200 + stored', async () => {
        const product = await createProduct({ shopQty: 10 });

        const bad = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            items: [{ productId: id(product), qty: 1, unitPrice: 20 }],
            paymentType: 'instapay',
        });
        expect(bad.status).toBe(400);
        const fe = bad.body.details?.fieldErrors ?? bad.body.details ?? {};
        expect(fe).toHaveProperty('sourceNumber');

        const good = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            items: [{ productId: id(product), qty: 1, unitPrice: 20 }],
            paymentType: 'instapay',
            sourceNumber: 'INSTA-S4-999',
        });
        ok(good, 'instapay sale with source');
        const tx = await findTx({ referenceType: 'Invoice', type: 'INCOME', method: 'instapay' });
        expect(tx.sourceNumber).toBe('INSTA-S4-999');
    });

    it('rows 4/5: wallet sale — empty source 400; present source 200 + stored', async () => {
        const product = await createProduct({ shopQty: 10 });

        const bad = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            items: [{ productId: id(product), qty: 1, unitPrice: 20 }],
            paymentType: 'wallet',
        });
        expect(bad.status).toBe(400);
        const fe = bad.body.details?.fieldErrors ?? bad.body.details ?? {};
        expect(fe).toHaveProperty('sourceNumber');

        const good = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            items: [{ productId: id(product), qty: 1, unitPrice: 20 }],
            paymentType: 'wallet',
            sourceNumber: 'WAL-S4-123',
        });
        ok(good, 'wallet sale with source');
        const tx = await findTx({ referenceType: 'Invoice', type: 'INCOME', method: 'wallet' });
        expect(tx.sourceNumber).toBe('WAL-S4-123');
    });
});
