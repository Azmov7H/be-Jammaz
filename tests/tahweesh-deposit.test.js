import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';
import { randomUUID } from 'crypto';

// T-10 (FIN-TAHWEESH-02) — deposits move money into the set-aside as a
// paired, profit-neutral transfer with source-sufficiency and idempotency.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Deposit Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const auth = (req) => req.set('Cookie', ownerCookie);

async function fundCash(total = 100) {
    const p = await auth(request.post('/api/products')).send({
        name: `منتج إيداع-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 20, shopQty: 100,
    });
    ok(p, 'createProduct');
    const c = await auth(request.post('/api/customers')).send({ name: `عميل إيداع-${uniq('C')}`, phone: uniq('9') });
    ok(c, 'createCustomer');
    const inv = await auth(request.post('/api/invoices')).send({
        customerId: id(c.body.data),
        items: [{ productId: id(p.body.data), qty: total / 20, unitPrice: 20 }],
        paymentType: 'cash',
    });
    ok(inv, 'fundSale');
}

async function legsByTransfer(transferId) {
    const { default: Txn } = await import('../models/TreasuryTransaction.js');
    return Txn.find({ referenceType: 'TahweeshTransfer', 'meta.transferId': transferId }).lean();
}
async function tahweeshBalance() {
    const res = await auth(request.get('/api/tahweesh/balance'));
    ok(res, 'getBalance');
    return res.body.data.balance;
}

describe('T-10: deposits', () => {
    it('valid deposit pairs legs, moves buckets, conserves the global', async () => {
        await fundCash(100);
        const { TreasuryService } = await import('../services/treasuryService.js');
        const gBefore = await TreasuryService.getCurrentBalance();
        const transferId = randomUUID();
        const res = await auth(request.post('/api/tahweesh/deposit')).send({
            source: 'cash', amount: 60, note: 'تحويش اختبار', transferId,
        });
        ok(res, 'deposit');
        expect(res.body.data.duplicate).toBe(false);
        expect(res.body.data.tahweeshBalance).toBeCloseTo(60, 2);
        const legs = await legsByTransfer(transferId);
        expect(legs).toHaveLength(2);
        const out = legs.find((l) => l.type === 'EXPENSE');
        const inn = legs.find((l) => l.type === 'INCOME');
        expect(out.method).toBe('cash');
        expect(inn.method).toBe('tahweesh');
        expect(await TreasuryService.getCurrentBalance() - gBefore).toBeCloseTo(0, 2);
        expect(await tahweeshBalance()).toBeCloseTo(60, 2);
    });

    it('exact-available deposit succeeds; over-available is rejected with nothing written', async () => {
        await fundCash(100); // cash net is isolated per test DB? No — shared. Use relative assertions.
        const { TreasuryService } = await import('../services/treasuryService.js');
        const cashNet = await TreasuryService.getMethodNet('cash');
        const balBefore = await tahweeshBalance();
        const tExact = randomUUID();
        const exact = await auth(request.post('/api/tahweesh/deposit')).send({
            source: 'cash', amount: Number(cashNet.toFixed(2)), transferId: tExact,
        });
        ok(exact, 'exactDeposit');
        expect(await tahweeshBalance() - balBefore).toBeCloseTo(cashNet, 2);

        const tOver = randomUUID();
        const over = await auth(request.post('/api/tahweesh/deposit')).send({
            source: 'cash', amount: 1, transferId: tOver,
        });
        expect(over.status, JSON.stringify(over.body).slice(0, 200)).toBe(400);
        expect(JSON.stringify(over.body)).toContain('يتجاوز');
        expect(await legsByTransfer(tOver)).toHaveLength(0);
    });

    it('replay with the same transferId is idempotent', async () => {
        await fundCash(100);
        const transferId = randomUUID();
        const payload = { source: 'cash', amount: 25, transferId };
        const first = await auth(request.post('/api/tahweesh/deposit')).send(payload);
        ok(first, 'firstDeposit');
        const second = await auth(request.post('/api/tahweesh/deposit')).send(payload);
        ok(second, 'replayDeposit');
        expect(second.body.data.duplicate).toBe(true);
        expect(await legsByTransfer(transferId)).toHaveLength(2);
    });

    it('zero/negative/missing/invalid payloads are rejected', async () => {
        for (const body of [
            { source: 'cash', amount: 0, transferId: randomUUID() },
            { source: 'cash', amount: -10, transferId: randomUUID() },
            { source: 'cash', transferId: randomUUID() },
            { source: 'bank', amount: 10, transferId: randomUUID() },
            { source: 'cash', amount: 10, transferId: 'not-a-uuid' },
        ]) {
            const res = await auth(request.post('/api/tahweesh/deposit')).send(body);
            expect(res.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
        }
    });

    it('instapay source requires a source number', async () => {
        const noSource = await auth(request.post('/api/tahweesh/deposit')).send({
            source: 'instapay', amount: 10, transferId: randomUUID(),
        });
        expect(noSource.status).toBe(400);
    });
});
