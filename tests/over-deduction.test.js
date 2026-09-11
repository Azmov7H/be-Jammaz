import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';
import TreasuryBalance from '../models/TreasuryBalance.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';

// FIN-OVERDEDUCT — collecting/paying more than owed must be rejected (400)
// instead of driving stored balances negative. HTTP-level: every entry point
// (per-invoice, unified, supplier, manual-debt, credit-use) is covered.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Overdeduct Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const bad = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(400);
const auth = (req) => req.set('Cookie', ownerCookie);

async function makeProduct(over = {}) {
    const res = await auth(request.post('/api/products')).send({
        name: `منتج od-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 20, warehouseQty: 0, shopQty: 100, ...over,
    });
    ok(res, 'createProduct');
    return res.body.data;
}

async function makeCustomer(over = {}) {
    const res = await auth(request.post('/api/customers')).send({
        name: `عميل od-${uniq('C')}`, phone: uniq('9'), ...over,
    });
    ok(res, 'createCustomer');
    return res.body.data;
}

/** Credit invoice of `total` (unitPrice 20 × qty) → debt + balance. */
async function makeCreditInvoice(customerId, productId, total = 100) {
    const qty = total / 20;
    const res = await auth(request.post('/api/invoices')).send({
        customerId, items: [{ productId, qty, unitPrice: 20 }], paymentType: 'credit',
    });
    ok(res, 'createCreditInvoice');
    return res.body.data;
}

async function makeReceivedPo(totalCost = 60, costPrice = 5) {
    const s = await auth(request.post('/api/suppliers')).send({ name: `مورد od-${uniq('S')}` });
    ok(s, 'createSupplier');
    const p = await makeProduct();
    const po = await auth(request.post('/api/purchase-orders')).send({
        supplierId: id(s.body.data),
        items: [{ productId: id(p), quantity: totalCost / costPrice, costPrice }],
        paymentType: 'credit',
    });
    ok(po, 'createPO');
    const recv = await auth(request.post(`/api/purchase-orders/${id(po.body.data)}/receive`)).send({});
    ok(recv, 'receivePO');
    return { supplier: s.body.data, po: po.body.data };
}

async function treasuryBalance() {
    const doc = await TreasuryBalance.findById(TreasuryBalance.DOC_ID).lean();
    return doc?.balance ?? 0;
}

describe('FIN-OVERDEDUCT valid cases', () => {
    it('partial unified collection reduces the balance', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        await makeCreditInvoice(id(c), id(p), 100);
        const res = await auth(request.post(`/api/customers/${id(c)}/pay`)).send({ amount: 40, method: 'cash' });
        ok(res, 'partial collect');
        const after = await Customer.findById(id(c)).lean();
        expect(after.balance).toBeCloseTo(60, 2);
    });

    it('exact unified collection settles to zero', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        await makeCreditInvoice(id(c), id(p), 100);
        const res = await auth(request.post(`/api/customers/${id(c)}/pay`)).send({ amount: 100, method: 'cash' });
        ok(res, 'exact collect');
        const after = await Customer.findById(id(c)).lean();
        expect(after.balance).toBeCloseTo(0, 2);
    });

    it('normal per-invoice payment and supplier PO payment succeed', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        const inv = await makeCreditInvoice(id(c), id(p), 100);
        const pay = await auth(request.post('/api/financial/payments/customer'))
            .send({ invoice: id(inv), amount: 100, method: 'cash' });
        ok(pay, 'invoice pay');

        const { po, supplier } = await makeReceivedPo(60);
        const spay = await auth(request.post('/api/financial/payments/supplier'))
            .send({ po: id(po), amount: 60, method: 'cash' });
        ok(spay, 'supplier pay');
        const after = await Supplier.findById(id(supplier)).lean();
        expect(after.balance).toBeCloseTo(0, 2);
    });

    it('exact credit-balance use on an invoice succeeds and deducts once', async () => {
        const p = await makeProduct();
        const c = await makeCustomer({ openingBalance: 50, openingBalanceType: 'credit' });
        const before = await Customer.findById(id(c)).lean();
        expect(before.creditBalance).toBeCloseTo(50, 2);
        const inv = await auth(request.post('/api/invoices')).send({
            customerId: id(c),
            items: [{ productId: id(p), qty: 5, unitPrice: 20 }], // total 100
            paymentType: 'cash',
            usedCreditBalance: 50,
        });
        ok(inv, 'invoice with exact credit');
        expect(inv.body.data.paidAmount).toBeCloseTo(50, 2);
        const after = await Customer.findById(id(c)).lean();
        expect(after.creditBalance).toBeCloseTo(0, 2);
    });
});

describe('FIN-OVERDEDUCT invalid cases', () => {
    it('unified over-collection is rejected and changes nothing', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        await makeCreditInvoice(id(c), id(p), 100);
        const tBefore = await treasuryBalance();
        const res = await auth(request.post(`/api/customers/${id(c)}/pay`)).send({ amount: 500, method: 'cash' });
        bad(res, 'unified overpay');
        expect(JSON.stringify(res.body)).toContain('يتجاوز');
        const after = await Customer.findById(id(c)).lean();
        expect(after.balance).toBeCloseTo(100, 2);
        expect(await treasuryBalance()).toBeCloseTo(tBefore, 2);
    });

    it('per-invoice overpay is rejected with the remaining figure', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        const inv = await makeCreditInvoice(id(c), id(p), 100);
        const res = await auth(request.post('/api/financial/payments/customer'))
            .send({ invoice: id(inv), amount: 150, method: 'cash' });
        bad(res, 'invoice overpay');
        expect(JSON.stringify(res.body)).toContain('المتبقي');
        const after = await Customer.findById(id(c)).lean();
        expect(after.balance).toBeCloseTo(100, 2);
    });

    it('supplier overpay is rejected and balance is untouched', async () => {
        const { po, supplier } = await makeReceivedPo(60);
        const tBefore = await treasuryBalance();
        const res = await auth(request.post('/api/financial/payments/supplier'))
            .send({ po: id(po), amount: 200, method: 'cash' });
        bad(res, 'supplier overpay');
        const after = await Supplier.findById(id(supplier)).lean();
        expect(after.balance).toBeCloseTo(60, 2);
        expect(await treasuryBalance()).toBeCloseTo(tBefore, 2);
    });

    it('manual debt overpay is rejected with a clear message', async () => {
        const c = await makeCustomer();
        const d = await auth(request.post('/api/financial/debts')).send({
            debtorType: 'Customer', debtorId: id(c), amount: 80, description: 'يدوي',
        });
        ok(d, 'createManualDebt');
        const res = await auth(request.post('/api/financial/payments'))
            .send({ debtId: id(d.body.data), amount: 120, method: 'cash' });
        bad(res, 'debt overpay');
        expect(JSON.stringify(res.body)).toContain('المتبقي');
    });

    it('credit use above the available credit is rejected and no invoice is created', async () => {
        const p = await makeProduct();
        const c = await makeCustomer({ openingBalance: 30, openingBalanceType: 'credit' });
        const countBefore = await (await import('../models/Invoice.js')).default.countDocuments({ customer: id(c) });
        const res = await auth(request.post('/api/invoices')).send({
            customerId: id(c),
            items: [{ productId: id(p), qty: 5, unitPrice: 20 }],
            paymentType: 'cash',
            usedCreditBalance: 50,
        });
        bad(res, 'credit overuse');
        const countAfter = await (await import('../models/Invoice.js')).default.countDocuments({ customer: id(c) });
        expect(countAfter).toBe(countBefore);
        const after = await Customer.findById(id(c)).lean();
        expect(after.creditBalance).toBeCloseTo(30, 2);
    });

    it('zero / negative / missing amounts are rejected', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        const inv = await makeCreditInvoice(id(c), id(p), 100);
        for (const amount of [0, -50]) {
            const res = await auth(request.post('/api/financial/payments/customer'))
                .send({ invoice: id(inv), amount, method: 'cash' });
            expect(res.status, `amount=${amount}`).toBeGreaterThanOrEqual(400);
        }
        const missing = await auth(request.post('/api/financial/payments/customer'))
            .send({ invoice: id(inv), method: 'cash' });
        expect(missing.status).toBeGreaterThanOrEqual(400);
        const after = await Customer.findById(id(c)).lean();
        expect(after.balance).toBeCloseTo(100, 2);
    });

    it('decimal edge: 0.01 over the remainder is rejected, exact cents pass', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        const inv = await makeCreditInvoice(id(c), id(p), 100);
        const over = await auth(request.post('/api/financial/payments/customer'))
            .send({ invoice: id(inv), amount: 100.02, method: 'cash' });
        bad(over, 'cent overpay');
        const exact = await auth(request.post('/api/financial/payments/customer'))
            .send({ invoice: id(inv), amount: 100, method: 'cash' });
        ok(exact, 'exact cents');
    });

    it('debt edit cannot set remaining above original', async () => {
        const c = await makeCustomer();
        const d = await auth(request.post('/api/financial/debts')).send({
            debtorType: 'Customer', debtorId: id(c), amount: 80, description: 'يدوي',
        });
        ok(d, 'createManualDebt');
        const res = await auth(request.patch(`/api/financial/debts/${id(d.body.data)}`))
            .send({ remainingAmount: 120 });
        bad(res, 'remaining>original');
    });
});

describe('FIN-OVERDEDUCT concurrency', () => {
    it('double simultaneous collection never drives the balance negative', async () => {
        const p = await makeProduct();
        const c = await makeCustomer();
        const inv = await makeCreditInvoice(id(c), id(p), 100);
        const payload = { invoice: id(inv), amount: 100, method: 'cash' };
        const [r1, r2] = await Promise.all([
            auth(request.post('/api/financial/payments/customer')).send(payload),
            auth(request.post('/api/financial/payments/customer')).send(payload),
        ]);
        const statuses = [r1.status, r2.status].sort();
        expect(statuses[0]).toBeLessThan(300);
        expect(statuses[1]).toBeGreaterThanOrEqual(400);
        const after = await Customer.findById(id(c)).lean();
        expect(after.balance).toBeGreaterThanOrEqual(-0.01);
        expect(after.balance).toBeCloseTo(0, 2);
    });
});
