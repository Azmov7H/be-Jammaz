import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// FIN-REV-01 (T-REV) — compensating reversal keeps the original ledger row,
// writes a visible flipped-type 'Reversal' counter-entry, restores the day
// cashbox + linked party/debt/PO balances, refuses replay, and is owner-only.

let request;
let ownerCookie;
let managerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'REV Owner', role: 'owner' }));
    ({ cookie: managerCookie } = await seedUser(request, { name: 'REV Manager', role: 'manager' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const auth = (req) => req.set('Cookie', ownerCookie);
const authManager = (req) => req.set('Cookie', managerCookie);
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

async function Txn() {
    return (await import('../models/TreasuryTransaction.js')).default;
}
async function Cashbox() {
    return (await import('../models/CashboxDaily.js')).default;
}
async function TreasuryBalance() {
    return (await import('../models/TreasuryBalance.js')).default;
}
async function Customer() {
    return (await import('../models/Customer.js')).default;
}
async function Supplier() {
    return (await import('../models/Supplier.js')).default;
}
async function Debt() {
    return (await import('../models/Debt.js')).default;
}
async function dayBuckets(date) {
    const CB = await Cashbox();
    return CB.findOne({ date: dayStart(date) }).lean();
}
async function currentBalance() {
    const TB = await TreasuryBalance();
    const doc = await TB.findById(TB.DOC_ID).lean();
    return doc?.balance ?? null;
}
async function reversalRowFor(originalId) {
    const T = await Txn();
    return T.findOne({ referenceType: 'Reversal', reversalOf: originalId }).lean();
}

async function makeProduct() {
    const res = await auth(request.post('/api/products')).send({
        name: `منتج rev-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 20, shopQty: 100,
    });
    ok(res, 'createProduct');
    return res.body.data;
}
async function makeCustomer() {
    const res = await auth(request.post('/api/customers')).send({ name: `عميل rev-${uniq('C')}`, phone: uniq('9') });
    ok(res, 'createCustomer');
    return res.body.data;
}
async function makeSupplier() {
    const res = await auth(request.post('/api/suppliers')).send({ name: `مورد rev-${uniq('S')}` });
    ok(res, 'createSupplier');
    return res.body.data;
}

describe('T-REV: compensating reversal', () => {
    it('manual income reversal keeps history, flips type, nets balance, restores cashbox manual entry', async () => {
        const before = (await currentBalance()) ?? 0;
        const reason = `إيراد يدوي rev-${uniq()}`;
        const add = await auth(request.post('/api/treasury/manual-income')).send({
            amount: 120, reason,
        });
        ok(add, 'manualIncome');

        const T = await Txn();
        const target = await T.findOne({ referenceType: 'Manual', type: 'INCOME', description: reason }).lean();
        expect(target).toBeTruthy();

        const cbBefore = await dayBuckets(target.date);

        const res = await auth(request.post(`/api/treasury/transactions/${target._id}/reverse`))
            .send({ reason: 'إدخال مكرر' });
        ok(res, 'reverseManualIncome');
        expect(res.body.data.success).toBe(true);

        // Original row is KEPT and marked reversed.
        const kept = await T.findById(target._id).lean();
        expect(kept).toBeTruthy();
        expect(kept.isReversed).toBe(true);
        expect(kept.reason).toBe('إدخال مكرر');

        // A flipped-type Reversal counter-entry exists with a 'تراجع عن' prefix.
        const rev = await reversalRowFor(target._id);
        expect(rev).toBeTruthy();
        expect(rev.type).toBe('EXPENSE');
        expect(rev.amount).toBe(120);
        expect(rev.referenceType).toBe('Reversal');
        // FIN-REV-01: the Reversal row must NOT carry referenceId (refPath
        // would resolve a model literally named 'Reversal'); the link back to
        // the original lives exclusively in `reversalOf`.
        expect(rev.referenceId).toBeUndefined();
        expect(String(rev.reversalOf)).toBe(String(target._id));

        // Running balance nets back to pre-move state.
        expect((await currentBalance()) ?? 0).toBe(before);

        // Cashbox manual entry removed (the reversal books no extra bucket).
        const cbAfter = await dayBuckets(target.date);
        expect(cbAfter.manualIncome || []).toHaveLength((cbBefore?.manualIncome || []).length - 1);
    });

    it('ledger GET lists the reversal row with a hydrated reversalOf (no refPath MissingSchemaError)', async () => {
        const reason = `إيراد يدوي rev-${uniq()}`;
        await auth(request.post('/api/treasury/manual-income')).send({ amount: 90, reason });

        const T = await Txn();
        const target = await T.findOne({ referenceType: 'Manual', type: 'INCOME', description: reason }).lean();
        expect(target).toBeTruthy();
        const revRes = await auth(request.post(`/api/treasury/transactions/${target._id}/reverse`)).send({});
        ok(revRes, 'reverse');

        const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
        const to = new Date().toISOString().slice(0, 10);
        const ledger = await auth(request.get('/api/treasury/transactions')).query({ startDate: from, endDate: to, page: 1, limit: 100 });
        ok(ledger, 'ledger');
        const rows = ledger.body.data?.transactions ?? [];
        const revRow = rows.find((r) => r.referenceType === 'Reversal' && r._id === String(revRes.body.data.reversalId));
        expect(revRow).toBeTruthy();
        expect(revRow.referenceId).toBeUndefined();
        // Original essentials hydrated under `reversalOf` for the details UI.
        expect(revRow.reversalOf?._id).toBe(String(target._id));
        expect(revRow.reversalOf?.description).toBe(reason);
    });

    it('manual expense reversal produces an income counter-entry with an audit log', async () => {
        const reason = `مصروف يدوي rev-${uniq()}`;
        const add = await auth(request.post('/api/treasury/manual-expense')).send({
            amount: 75, reason, category: 'other',
        });
        ok(add, 'manualExpense');

        const T = await Txn();
        const target = await T.findOne({ referenceType: 'Manual', type: 'EXPENSE', description: reason }).lean();
        expect(target).toBeTruthy();

        const res = await auth(request.post(`/api/treasury/transactions/${target._id}/reverse`)).send({});
        ok(res, 'reverseManualExpense');

        const rev = await reversalRowFor(target._id);
        expect(rev.type).toBe('INCOME');

        const Log = (await import('../models/Log.js')).default;
        const logs = await Log.find({ entity: 'TreasuryTransaction', entityId: target._id, action: 'REVERSE_TRANSACTION' }).lean();
        expect(logs.length).toBe(1);
    });

    it('reversal is owner-only; manager gets 403', async () => {
        const reason = `إيراد acl-${uniq()}`;
        await auth(request.post('/api/treasury/manual-income')).send({ amount: 10, reason });
        const T = await Txn();
        const row = await T.findOne({ referenceType: 'Manual', type: 'INCOME', description: reason }).lean();

        const res = await authManager(request.post(`/api/treasury/transactions/${row._id}/reverse`)).send({});
        expect(res.status).toBe(403);
    });

    it('debt payment reversal restores debt remainder and customer balance', async () => {
        const c = await makeCustomer();
        const d = await auth(request.post('/api/financial/debts')).send({
            debtorType: 'Customer', debtorId: id(c), amount: 200, description: `دين rev-${uniq()}`,
        });
        ok(d, 'createDebt');
        const debtId = id(d.body.data);

        const beforePay = await (await Customer()).findById(id(c)).lean();
        const pay = await auth(request.post('/api/financial/payments/debt')).send({
            debt: debtId, amount: 80, method: 'cash',
        });
        ok(pay, 'payDebt');

        const T = await Txn();
        const tx = await T.findOne({ referenceType: 'Debt', referenceId: debtId, type: 'INCOME' }).sort({ createdAt: -1 }).lean();
        expect(tx).toBeTruthy();

        const debtAfterPay = await (await Debt()).findById(debtId).lean();
        expect(debtAfterPay.remainingAmount).toBeCloseTo(120, 2);

        const rev = await auth(request.post(`/api/treasury/transactions/${tx._id}/reverse`)).send({});
        ok(rev, 'reverseDebtPayment');

        const debtRestored = await (await Debt()).findById(debtId).lean();
        expect(debtRestored.remainingAmount).toBeCloseTo(200, 2);
        expect(debtRestored.status).not.toBe('settled');

        // Customer cached balance restored to its pre-payment state.
        const afterPay = await (await Customer()).findById(id(c)).lean();
        expect(afterPay.balance).toBeCloseTo(beforePay.balance, 2);
    });

    it('supplier PO payment reversal restores PO paidAmount, supplier balance, and the exact cashbox bucket', async () => {
        const s = await makeSupplier();
        const p = await makeProduct();
        const po = await auth(request.post('/api/purchase-orders')).send({
            supplierId: id(s),
            items: [{ productId: id(p), quantity: 12, costPrice: 5 }],
            paymentType: 'credit',
        });
        ok(po, 'createPO');
        const recv = await auth(request.post(`/api/purchase-orders/${id(po.body.data)}/receive`)).send({});
        ok(recv, 'receivePO');

        const beforePay = await (await Supplier()).findById(id(s)).lean();
        const cbPrePay = await dayBuckets(new Date());
        const pay = await auth(request.post('/api/financial/payments/supplier')).send({
            po: id(po.body.data), amount: 60, method: 'cash',
        });
        ok(pay, 'supplierPay');

        const T = await Txn();
        const tx = await T.findOne({ referenceType: 'PurchaseOrder', referenceId: id(po.body.data), type: 'EXPENSE' }).sort({ createdAt: -1 }).lean();
        expect(tx).toBeTruthy();
        const cbBefore = await dayBuckets(tx.date);

        const rev = await auth(request.post(`/api/treasury/transactions/${tx._id}/reverse`)).send({});
        ok(rev, 'reverseSupplierPay');

        // PO back to unpaid.
        const PurchaseOrder = (await import('../models/PurchaseOrder.js')).default;
        const poAfter = await PurchaseOrder.findById(id(po.body.data)).lean();
        expect(poAfter.paidAmount).toBeCloseTo(0, 2);
        expect(poAfter.paymentStatus).toBe('pending');

        // Supplier cached balance restored.
        const tradeAfter = await (await Supplier()).findById(id(s)).lean();
        expect(tradeAfter.balance).toBeCloseTo(beforePay.balance, 2);

        // Cashbox bucket restored to before the payment.
        const cbAfter = await dayBuckets(tx.date);
        expect(cbAfter.purchaseExpenses || 0).toBeCloseTo(cbPrePay.purchaseExpenses || 0, 2);
    });

    it('unified collection reversal restores the paid debt and customer balance', async () => {
        const c = await makeCustomer();
        const d = await auth(request.post('/api/financial/debts')).send({
            debtorType: 'Customer', debtorId: id(c), amount: 150, description: `تحصيل مجمع rev-${uniq()}`,
        });
        ok(d, 'createDebt');
        const debtId = id(d.body.data);

        const col = await auth(request.post(`/api/customers/${id(c)}/pay`)).send({
            amount: 150, method: 'cash',
        });
        ok(col, 'unifiedCollect');

        const T = await Txn();
        const tx = await T.findOne({ referenceType: 'UnifiedCollection', partnerId: id(c) }).sort({ createdAt: -1 }).lean();
        expect(tx).toBeTruthy();
        // The reversal-safe breakdown is persisted (FIN-REV storage contract).
        expect(tx.meta.appliedPayments).toHaveLength(1);
        expect(String(tx.meta.appliedPayments[0].debtId)).toBe(debtId);

        const rev = await auth(request.post(`/api/treasury/transactions/${tx._id}/reverse`)).send({});
        ok(rev, 'reverseUC');

        const debtRestored = await (await Debt()).findById(debtId).lean();
        expect(debtRestored.remainingAmount).toBeCloseTo(150, 2);

        const cust = await (await Customer()).findById(id(c)).lean();
        expect(cust.balance).toBeCloseTo(150, 2);
    });

    it('refuses replaying a reversal and refuses reversing a reversal row', async () => {
        const reason = `مصروف rev-${uniq()}`;
        await auth(request.post('/api/treasury/manual-expense')).send({ amount: 40, reason, category: 'other' });
        const T = await Txn();
        const row = await T.findOne({ referenceType: 'Manual', type: 'EXPENSE', description: reason }).lean();

        const first = await auth(request.post(`/api/treasury/transactions/${row._id}/reverse`)).send({});
        ok(first, 'firstReverse');
        const replay = await auth(request.post(`/api/treasury/transactions/${row._id}/reverse`)).send({});
        expect(replay.status).toBe(409);

        const revRow = await reversalRowFor(row._id);
        const reversing = await auth(request.post(`/api/treasury/transactions/${revRow._id}/reverse`)).send({});
        expect(reversing.status).toBe(409);
    });

    it('refuses TahweeshTransfer legs and points to the withdraw flow', async () => {
        const T = await Txn();
        const transfer = await T.create({
            type: 'EXPENSE',
            amount: 500,
            description: 'تحويش rev-guard',
            referenceType: 'TahweeshTransfer',
            date: new Date(),
            method: 'cash',
            meta: { transferId: `rev-${uniq()}` },
            createdBy: null,
        });
        const res = await auth(request.post(`/api/treasury/transactions/${transfer._id}/reverse`)).send({});
        expect(res.status).toBe(409);
        expect(JSON.stringify(res.body)).toMatch(/تحويش|سحب/);
    });
});