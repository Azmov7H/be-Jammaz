import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// T-04 (FIN-ATOMIC-01) — multi-write money flows must be all-or-nothing:
// manual income/expense (treasury + cashbox), finance expenses (treasury +
// GL + log), manual debts (debt + balance), undo (ledger + cashbox + balance).

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Atomic Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const auth = (req) => req.set('Cookie', ownerCookie);

async function treasuryCount(query) {
    const { default: Txn } = await import('../models/TreasuryTransaction.js');
    return Txn.countDocuments(query);
}

async function glCount(query) {
    const { default: AE } = await import('../models/AccountingEntry.js');
    return AE.countDocuments(query);
}

describe('T-04: atomic money writes', () => {
    it('finance expense writes treasury + GL together', async () => {
        const reason = `مصروف ذري-${uniq('E')}`;
        const res = await auth(request.post('/api/financial/expenses')).send({
            amount: 75, reason, category: 'other', date: new Date().toISOString(),
        });
        ok(res, 'recordExpense');
        expect(await treasuryCount({ description: reason, type: 'EXPENSE' })).toBe(1);
        expect(await glCount({ description: reason, type: 'EXPENSE' })).toBe(1);
    });

    it('rejected expense writes nothing anywhere', async () => {
        const reason = `مصروف مرفوض-${uniq('E')}`;
        const tBefore = await treasuryCount({ description: reason });
        const res = await auth(request.post('/api/financial/expenses')).send({
            amount: 0, reason, category: 'other', date: new Date().toISOString(),
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(await treasuryCount({ description: reason })).toBe(tBefore);
        expect(await glCount({ description: reason })).toBe(0);
    });

    it('manual income is visible in ledger and cashbox together', async () => {
        const reason = `إيراد ذري-${uniq('I')}`;
        const dateIso = new Date(Date.now() + 21 * 86400000).toISOString();
        const res = await auth(request.post('/api/treasury/manual-income')).send({
            amount: 500, reason, method: 'cash', date: dateIso,
        });
        ok(res, 'manualIncome');
        expect(await treasuryCount({ description: reason, type: 'INCOME' })).toBe(1);
        const cb = await auth(request.get(`/api/treasury/daily?date=${encodeURIComponent(dateIso)}`));
        ok(cb, 'dailyCashbox');
        expect(cb.body.data.totalIncome).toBeCloseTo(500, 2);
    });

    it('undo removes the ledger row and reverses the cashbox', async () => {
        const reason = `تراجع ذري-${uniq('U')}`;
        const dateIso = new Date(Date.now() + 22 * 86400000).toISOString();
        const created = await auth(request.post('/api/treasury/manual-income')).send({
            amount: 320, reason, method: 'cash', date: dateIso,
        });
        ok(created, 'manualIncome');
        const txId = created.body.data?.transaction?._id
            || (await (await import('../models/TreasuryTransaction.js')).default.findOne({ description: reason }).lean())._id;
        const undo = await auth(request.delete(`/api/treasury/transactions/${txId}`));
        ok(undo, 'undoTransaction');
        expect(await treasuryCount({ description: reason })).toBe(0);
        const cb = await auth(request.get(`/api/treasury/daily?date=${encodeURIComponent(dateIso)}`));
        ok(cb, 'dailyCashbox');
        expect(cb.body.data.totalIncome).toBeCloseTo(0, 2);
    });

    it('manual debt create/delete moves the balance symmetrically', async () => {
        const c = await auth(request.post('/api/customers')).send({ name: `عميل ذري-${uniq('C')}`, phone: uniq('9') });
        ok(c, 'createCustomer');
        const cid = id(c.body.data);
        const d = await auth(request.post('/api/financial/debts')).send({
            debtorType: 'Customer', debtorId: cid, amount: 90, description: 'ذري',
        });
        ok(d, 'createDebt');
        const { default: Customer } = await import('../models/Customer.js');
        expect((await Customer.findById(cid).lean()).balance).toBeCloseTo(90, 2);
        const del = await auth(request.delete(`/api/financial/debts/${id(d.body.data)}`));
        ok(del, 'deleteDebt');
        expect((await Customer.findById(cid).lean()).balance).toBeCloseTo(0, 2);
    });
});
