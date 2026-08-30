import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

let request, ownerCookie, cashierCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'S11 Debt-Owner', role: 'owner' }));
    ({ cookie: cashierCookie } = await seedUser(request, { name: 'S11 Debt-Cashier', role: 'cashier' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(300);

async function makeSupplier(over = {}) {
    const res = await request.post('/api/suppliers').set('Cookie', ownerCookie)
        .send({ name: `مورد s11-${uniq('S')}`, phone: uniq('8'), ...over });
    ok(res, 'createSupplier');
    return res.body.data;
}

async function seedDebt({ debtorType = 'Customer', referenceType = 'Manual', amount = 100 } = {}) {
    const { default: Debt } = await import('../models/Debt.js');
    const mongoose = (await import('mongoose')).default;
    const refId = new mongoose.Types.ObjectId();
    const debt = await Debt.create({
        debtorType,
        debtorId: refId,
        originalAmount: amount,
        remainingAmount: amount,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        referenceType,
        referenceId: refId,
        description: 'اختبار s11',
    });
    return { debt, refId };
}

describe('GET /api/financial/payments?debtId (debt payment history)', () => {
    it('returns treasury transactions for a debt', async () => {
        const { debt } = await seedDebt();
        const { default: Txn } = await import('../models/TreasuryTransaction.js');
        await Txn.create({
            type: 'EXPENSE',
            amount: 100,
            method: 'cash',
            category: 'debt_payment',
            description: 'سداد دين s11',
            referenceType: 'Debt',
            referenceId: debt._id,
            date: new Date(),
            createdBy: null,
            journal: null,
        });

        const res = await request.get(`/api/financial/payments?debtId=${debt._id}`).set('Cookie', ownerCookie);
        ok(res, 'getDebtPayments');
        expect(res.body.data).toBeInstanceOf(Array);
        expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('rejects a malformed debtId with 400', async () => {
        const res = await request.get('/api/financial/payments?debtId=not-a-valid-id').set('Cookie', ownerCookie);
        expect(res.status).toBe(400);
    });
});

describe('POST /api/financial/debts/sync (opening-balance reconciliation)', () => {
    it('creates a manual debt from supplier balance', async () => {
        const supplier = await makeSupplier();
        const { default: Supplier } = await import('../models/Supplier.js');
        await Supplier.findByIdAndUpdate(supplier._id, { $set: { balance: 250 } });

        const res = await request.post('/api/financial/debts/sync')
            .set('Cookie', ownerCookie)
            .send({ debtorId: supplier._id, debtorType: 'Supplier' });
        ok(res, 'syncDebts');
        expect(res.body.data.count).toBe(1);
    });

    it('rejects cashier (owner/manager only)', async () => {
        const supplier = await makeSupplier();
        const res = await request.post('/api/financial/debts/sync')
            .set('Cookie', cashierCookie)
            .send({ debtorId: supplier._id, debtorType: 'Supplier' });
        expect(res.status).toBe(403);
    });
});

describe('PATCH /api/financial/debts/:id (manual debt edit)', () => {
    it('updates allowed debt fields', async () => {
        const { debt } = await seedDebt({ amount: 200 });
        const res = await request.patch(`/api/financial/debts/${debt._id}`)
            .set('Cookie', ownerCookie)
            .send({ description: 'تعديل وصف s11', dueDate: '2026-09-15' });
        ok(res, 'updateDebt');
        expect(res.body.data.description).toBe('تعديل وصف s11');
    });

    it('rejects cashier (owner/manager only)', async () => {
        const { debt } = await seedDebt();
        const res = await request.patch(`/api/financial/debts/${debt._id}`)
            .set('Cookie', cashierCookie)
            .send({ description: 'تعديل غير مصرح' });
        expect(res.status).toBe(403);
    });

    it('rejects a malformed id with 404', async () => {
        const res = await request.patch('/api/financial/debts/not-a-valid-id')
            .set('Cookie', ownerCookie)
            .send({ description: 'x' });
        expect(res.status).toBe(404);
    });
});
