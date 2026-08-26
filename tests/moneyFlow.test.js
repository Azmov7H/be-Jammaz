import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Flow Owner', role: 'owner' }));
});

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;

async function createProduct(overrides = {}) {
    const res = await request.post('/api/products')
        .set('Cookie', ownerCookie)
        .send({
            name: `منتج تدفق-${uniq('P')}`,
            code: uniq('C'),
            buyPrice: 10,
            retailPrice: 20,
            warehouseQty: 0,
            shopQty: 0,
            ...overrides,
        });
    expect(res.status).toBeLessThan(300);
    return res.body.data;
}

async function createCustomer() {
    const res = await request.post('/api/customers')
        .set('Cookie', ownerCookie)
        .send({ name: 'عميل تدفق', phone: uniq('079') });
    expect(res.status).toBeLessThan(300);
    return res.body.data;
}

async function createSupplier() {
    const res = await request.post('/api/suppliers')
        .set('Cookie', ownerCookie)
        .send({ name: `مورد تدفق-${uniq('S')}` });
    expect(res.status).toBeLessThan(300);
    return res.body.data;
}

const id = (doc) => doc?._id ?? doc?.id;

describe('T-TST-03: cash invoice → paid → statement → treasury reconcile', () => {
    it('cash sale records income and shows on the customer statement', async () => {
        const product = await createProduct({ shopQty: 30 });
        const customer = await createCustomer();
        const pid = id(product);

        const inv = await request.post('/api/invoices')
            .set('Cookie', ownerCookie)
            .send({
                customerId: id(customer),
                items: [{ productId: pid, qty: 4, unitPrice: 20 }], // total 80
                paymentType: 'cash',
            });
        expect(inv.status, JSON.stringify(inv.body).slice(0, 160)).toBeLessThan(300);
        const invoiceId = id(inv.body.data);

        // invoice persisted as fully paid
        expect(inv.body.data.paymentStatus).toBe('paid');
        expect(inv.body.data.paidAmount).toBe(80);

        // treasury holds the matching INCOME row
        const TreasuryTransaction = (await import('../models/TreasuryTransaction.js')).default;
        const income = await TreasuryTransaction.findOne({
            referenceType: 'Invoice', referenceId: invoiceId, type: 'INCOME',
        }).lean();
        expect(income).toBeTruthy();
        expect(income.amount).toBe(80);

        // customer statement lists the debit
        const stmt = await request.get(`/api/customers/${id(customer)}/statement`)
            .set('Cookie', ownerCookie);
        expect(stmt.status).toBeLessThan(300);
        const body = JSON.stringify(stmt.body);
        expect(body).toContain(String(inv.body.data.number));

        // cashbox invariant: running balance == sum of all ledger rows
        const TreasuryBalance = (await import('../models/TreasuryBalance.js')).default;
        const balDoc = await TreasuryBalance.findOne({ _id: 'treasury' }).lean();
        const agg = await TreasuryTransaction.aggregate([
            { $group: { _id: null, sum: { $sum: '$amount' } } },
        ]);
        expect(balDoc?.balance).toBeCloseTo(agg[0]?.sum ?? 0, 2);
    });
});

describe('T-TST-03: credit invoice + installments → partial payments → close', () => {
    it('payments settle the debt, flip status, and sync schedules', async () => {
        const product = await createProduct({ shopQty: 100 });
        const customer = await createCustomer();

        const inv = await request.post('/api/invoices')
            .set('Cookie', ownerCookie)
            .send({
                customerId: id(customer),
                items: [{ productId: id(product), qty: 60, unitPrice: 20 }], // 1200
                paymentType: 'credit',
            });
        expect(inv.status).toBeLessThan(300);

        const Debt = (await import('../models/Debt.js')).default;
        let debt = await Debt.findOne({ referenceId: id(inv.body.data) }).lean();
        expect(debt.remainingAmount).toBe(1200);

        // schedule 3 installments
        const plan = await request.post(`/api/financial/debts/${debt._id}/installments`)
            .set('Cookie', ownerCookie)
            .send({ installmentsCount: 3 });
        expect(plan.status, JSON.stringify(plan.body).slice(0, 160)).toBeLessThan(300);
        expect(plan.body.data.length).toBe(3);
        expect(plan.body.data.reduce((a, s) => a + s.amount, 0)).toBeCloseTo(1200, 2);

        // two partial payments of 400
        for (let i = 0; i < 2; i++) {
            const pay = await request.post('/api/financial/payments/debt')
                .set('Cookie', ownerCookie)
                .send({ debt: String(debt._id), amount: 400, method: 'cash' });
            expect(pay.status, JSON.stringify(pay.body).slice(0, 160)).toBeLessThan(300);
        }

        debt = (await Debt.findById(debt._id)).toObject();
        expect(debt.remainingAmount).toBe(400);
        expect(debt.status).not.toBe('settled');

        // schedules reflect the collected money
        const PaymentSchedule = (await import('../models/PaymentSchedule.js')).default;
        const schedules = await PaymentSchedule.find({ debtId: debt._id }).lean();
        const pendingSum = schedules.filter((s) => s.status === 'pending')
            .reduce((a, s) => a + s.amount, 0);
        expect(pendingSum).toBeCloseTo(400, 2);

        // final payment closes the debt
        const finalPay = await request.post('/api/financial/payments/debt')
            .set('Cookie', ownerCookie)
            .send({ debt: String(debt._id), amount: 400, method: 'cash' });
        expect(finalPay.status).toBeLessThan(300);

        debt = (await Debt.findById(debt._id)).toObject();
        expect(debt.remainingAmount).toBe(0);
        expect(debt.status).toBe('settled');

        // one INCOME row per payment
        const TreasuryTransaction = (await import('../models/TreasuryTransaction.js')).default;
        const rows = await TreasuryTransaction.countDocuments({
            referenceType: 'Debt', referenceId: debt._id, type: 'INCOME',
        });
        expect(rows).toBe(3);
    });
});

describe('T-TST-03: partial returns — refund to treasury AND to customer credit', () => {
    it('cash refund hits treasury expense; balance refund credits the customer', async () => {
        // --- variant A: refundMethod = cash ---
        const productA = await createProduct({ shopQty: 10 });
        const customerA = await createCustomer();
        const invA = await request.post('/api/invoices')
            .set('Cookie', ownerCookie)
            .send({
                customerId: id(customerA),
                items: [{ productId: id(productA), qty: 5, unitPrice: 20 }], // 100
                paymentType: 'cash',
            });
        expect(invA.status).toBeLessThan(300);
        const itemAId = invA.body.data.items[0]._id ?? invA.body.data.items[0].id;
        const numberA = invA.body.data.number;

        const retA = await request.post(`/api/invoices/${id(invA.body.data)}/return`)
            .set('Cookie', ownerCookie)
            .send({ items: [{ invoiceItemId: itemAId, qty: 2 }], refundMethod: 'cash' }); // refund 40
        expect(retA.status, JSON.stringify(retA.body).slice(0, 200)).toBeLessThan(300);

        const SalesReturn = (await import('../models/SalesReturn.js')).default;
        const docA = await SalesReturn.findOne({ originalInvoice: id(invA.body.data) }).lean();
        expect(docA.totalRefund).toBe(40);
        expect(docA.treasuryDeducted).toBe(40);

        // stock re-entered
        const Product = (await import('../models/Product.js')).default;
        const prodA = await Product.findById(id(productA)).lean();
        expect(prodA.shopQty).toBe(10 - 5 + 2);

        // treasury EXPENSE row exists
        const TreasuryTransaction = (await import('../models/TreasuryTransaction.js')).default;
        const refundTx = await TreasuryTransaction.findOne({
            referenceType: 'SalesReturn', referenceId: String(docA._id), type: 'EXPENSE',
        }).lean();
        expect(refundTx).toBeTruthy();
        expect(refundTx.amount).toBe(40);

        // invoice rewritten to 3 units / 60
        const Invoice = (await import('../models/Invoice.js')).default;
        const invADoc = await Invoice.findById(id(invA.body.data)).lean();
        expect(invADoc.items[0].qty).toBe(3);
        expect(invADoc.total).toBe(60);
        expect(invADoc.hasReturns).toBe(true);
        void numberA;

        // --- variant B: refundMethod = customerBalance ---
        const productB = await createProduct({ shopQty: 10 });
        const customerB = await createCustomer();
        const invB = await request.post('/api/invoices')
            .set('Cookie', ownerCookie)
            .send({
                customerId: id(customerB),
                items: [{ productId: id(productB), qty: 5, unitPrice: 20 }],
                paymentType: 'cash',
            });
        expect(invB.status).toBeLessThan(300);
        const itemBId = invB.body.data.items[0]._id ?? invB.body.data.items[0].id;

        const Customer = (await import('../models/Customer.js')).default;
        const beforeBal = (await Customer.findById(id(customerB)).lean()).balance ?? 0;

        const retB = await request.post(`/api/invoices/${id(invB.body.data)}/return`)
            .set('Cookie', ownerCookie)
            .send({ items: [{ invoiceItemId: itemBId, qty: 1 }], refundMethod: 'customerBalance' }); // 20
        expect(retB.status, JSON.stringify(retB.body).slice(0, 200)).toBeLessThan(300);

        const docB = await SalesReturn.findOne({ originalInvoice: id(invB.body.data) }).lean();
        expect(docB.customerBalanceAdded).toBe(20);
        expect(docB.treasuryDeducted).toBe(0); // no treasury movement on this branch

        const noTx = await TreasuryTransaction.findOne({
            referenceType: 'SalesReturn', referenceId: String(docB._id),
        });
        expect(noTx).toBeNull();

        const custAfter = await Customer.findById(id(customerB)).lean();
        const credited = custAfter.creditBalance ?? 0;
        expect(credited + custAfter.balance - beforeBal).toBe(20);
    });
});

describe('T-TST-03: purchase receive → supplier debt → supplier payment', () => {
    it('credit PO creates supplier debt; payment settles it and pays the PO', async () => {
        const product = await createProduct({ warehouseQty: 0 });
        const supplier = await createSupplier();

        const po = await request.post('/api/purchase-orders')
            .set('Cookie', ownerCookie)
            .send({
                supplierId: id(supplier),
                items: [{ productId: id(product), quantity: 12, costPrice: 5 }], // 60
                paymentType: 'credit',
            });
        expect(po.status, JSON.stringify(po.body).slice(0, 160)).toBeLessThan(300);
        const poId = id(po.body.data);

        const recv = await request.post(`/api/purchase-orders/${poId}/receive`)
            .set('Cookie', ownerCookie)
            .send({});
        expect(recv.status, JSON.stringify(recv.body).slice(0, 200)).toBeLessThan(300);

        // stock arrived
        const Product = (await import('../models/Product.js')).default;
        expect((await Product.findById(id(product)).lean()).warehouseQty).toBe(12);

        // supplier debt opened for the full cost
        const Debt = (await import('../models/Debt.js')).default;
        const debt = await Debt.findOne({ referenceType: 'PurchaseOrder', referenceId: poId }).lean();
        expect(debt).toBeTruthy();
        expect(debt.remainingAmount).toBe(60);

        // pay half, then the rest
        for (const part of [30, 30]) {
            const pay = await request.post('/api/financial/payments/supplier')
                .set('Cookie', ownerCookie)
                .send({ po: poId, amount: part, method: 'cash' });
            expect(pay.status, JSON.stringify(pay.body).slice(0, 200)).toBeLessThan(300);
        }

        expect((await Debt.findById(debt._id).lean()).remainingAmount).toBe(0);

        const poDoc = (await (await import('../models/PurchaseOrder.js')).default.findById(poId).lean());
        expect(poDoc.paidAmount).toBe(60);
        expect(poDoc.paymentStatus).toBe('paid');
    });
});
