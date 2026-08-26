import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Conc Owner', role: 'owner' }));
});

afterAll(async () => {
    await stopTestDb();
});

async function createProduct(overrides = {}) {
    const res = await request.post('/api/products')
        .set('Cookie', ownerCookie)
        .send({
            name: `منتج تزامن-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            code: `CNC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            buyPrice: 10,
            retailPrice: 20,
            warehouseQty: 0,
            shopQty: 0,
            ...overrides,
        });
    expect(res.status).toBeLessThan(300);
    return res.body.data;
}

async function createSupplier() {
    const res = await request.post('/api/suppliers')
        .set('Cookie', ownerCookie)
        .send({ name: `مورد تزامن-${Date.now()}` });
    expect(res.status).toBeLessThan(300);
    return res.body.data;
}

async function createCustomer() {
    const res = await request.post('/api/customers')
        .set('Cookie', ownerCookie)
        .send({ name: 'عميل تزامن', phone: `079${Date.now()}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 13) });
    expect(res.status).toBeLessThan(300);
    return res.body.data;
}

describe('T-TST-02: parallel sales vs limited stock', () => {
    it('exactly floor(available/qty) sales succeed; final qty is exact', async () => {
        const product = await createProduct({ shopQty: 5 });

        // 10 workers race to buy 1 unit each from only 5 available
        const attempts = Array.from({ length: 10 }, () =>
            request.post('/api/invoices')
                .set('Cookie', ownerCookie)
                .send({
                    items: [{ productId: product._id ?? product.id, qty: 1, unitPrice: 20 }],
                    paymentType: 'cash',
                })
        );
        const results = await Promise.all(attempts);
        const ok = results.filter((r) => r.status < 300);
        const rejected = results.filter((r) => r.status >= 400);

        expect(ok.length).toBe(5);
        expect(rejected.length).toBe(5);
        for (const r of rejected) {
            expect(r.body?.message ?? '').toContain('الكمية غير كافية');
        }

        const Product = (await import('../models/Product.js')).default;
        const after = await Product.findById(product._id ?? product.id).lean();
        expect(after.shopQty).toBe(0);

        const StockMovement = (await import('../models/StockMovement.js')).default;
        const movements = await StockMovement.countDocuments({
            productId: product._id ?? product.id, type: 'SALE',
        });
        expect(movements).toBe(5); // ledger matches successful writes only
    });
});

describe('T-TST-02: parallel debt payments cannot overpay', () => {
    it('K concurrent payments of amount K exhaust debt exactly once', async () => {
        const product = await createProduct({ shopQty: 100 });
        const customer = await createCustomer();
        const pid = product._id ?? product.id;

        const inv = await request.post('/api/invoices')
            .set('Cookie', ownerCookie)
            .send({
                customerId: customer._id ?? customer.id,
                items: [{ productId: pid, qty: 50, unitPrice: 20 }], // total 1000
                paymentType: 'credit',
            });
        expect(inv.status).toBeLessThan(300);
        const invoiceId = inv.body.data._id ?? inv.body.data.id;

        const Debt = (await import('../models/Debt.js')).default;
        const debt = await Debt.findOne({ referenceId: invoiceId }).lean();
        expect(debt).toBeTruthy();
        expect(debt.remainingAmount).toBe(1000);

        // 10 concurrent payments × 100 — the $gte guard makes overpay impossible
        const payments = Array.from({ length: 10 }, () =>
            request.post('/api/financial/payments/debt')
                .set('Cookie', ownerCookie)
                .send({ debt: String(debt._id), amount: 100, method: 'cash' })
        );
        const results = await Promise.all(payments);
        for (const r of results) {
            expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
        }

        const after = await Debt.findById(debt._id).lean();
        expect(after.remainingAmount).toBe(0);

        // an extra payment must be refused by the same guard
        const extra = await request.post('/api/financial/payments/debt')
            .set('Cookie', ownerCookie)
            .send({ debt: String(debt._id), amount: 1, method: 'cash' });
        expect(extra.status).toBeGreaterThanOrEqual(400);
        expect((await Debt.findById(debt._id).lean()).remainingAmount).toBe(0);
    });
});

describe('T-TST-02: parallel cashbox increments reconcile', () => {
    it('N concurrent manual incomes yield balance == sum and N ledger rows', async () => {
        const N = 15;
        const incomes = Array.from({ length: N }, (_, i) =>
            request.post('/api/treasury/manual-income')
                .set('Cookie', ownerCookie)
                .send({ amount: 10 + i, reason: `إيراد تزامن ${i}` })
        );
        const results = await Promise.all(incomes);
        for (const r of results) {
            expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
        }
        const myTotal = (10 + (10 + N - 1)) * N / 2; // arithmetic series

        const TreasuryBalance = (await import('../models/TreasuryBalance.js')).default;
        const balDoc = await TreasuryBalance.findOne({ _id: 'treasury' }).lean();
        const TreasuryTransaction = (await import('../models/TreasuryTransaction.js')).default;

        // shared DB: assert RELATIVE invariants — my rows exist, and the
        // running-balance doc equals the FULL ledger aggregate exactly
        const agg = await TreasuryTransaction.aggregate([
            { $group: { _id: null, sum: { $sum: '$amount' } } },
        ]);
        const ledgerSum = agg[0]?.sum ?? 0;
        expect(balDoc?.balance).toBeCloseTo(ledgerSum, 2);
        expect(ledgerSum).toBeGreaterThanOrEqual(myTotal);

        const mine = await TreasuryTransaction.find({
            description: { $regex: 'إيراد تزامن' },
        }).lean();
        expect(mine.length).toBe(N);
        expect(mine.reduce((a, t) => a + t.amount, 0)).toBeCloseTo(myTotal, 2);
    });
});

describe('T-TST-02: purchase order double-receive', () => {
    it('concurrent receives: one wins, loser gets 409, stock/treasury move once', async () => {
        const product = await createProduct({ warehouseQty: 7 });
        const pid = product._id ?? product.id;

        const supplier = await createSupplier();
        const po = await request.post('/api/purchase-orders')
            .set('Cookie', ownerCookie)
            .send({
                supplierId: supplier._id ?? supplier.id,
                items: [{ productId: pid, quantity: 13, costPrice: 5 }],
                paymentType: 'cash',
            });
        expect(po.status).toBeLessThan(300);
        const poId = po.body.data._id ?? po.body.data.id;

        const [a, b] = await Promise.all([
            request.post(`/api/purchase-orders/${poId}/receive`).set('Cookie', ownerCookie).send({}),
            request.post(`/api/purchase-orders/${poId}/receive`).set('Cookie', ownerCookie).send({}),
        ]);
        const statuses = [a.status, b.status].sort();
        expect(statuses[0]).toBeLessThan(300);
        expect(statuses[1]).toBe(409); // deterministic loser, zero partial writes

        const Product = (await import('../models/Product.js')).default;
        const after = await Product.findById(pid).lean();
        expect(after.warehouseQty).toBe(7 + 13); // incremented EXACTLY once

        const TreasuryTransaction = (await import('../models/TreasuryTransaction.js')).default;
        const poExpenses = await TreasuryTransaction.countDocuments({
            referenceId: poId,
            type: 'EXPENSE',
        });
        expect(poExpenses).toBe(1); // paid exactly once despite the race
    });
});

describe('T-TST-02: installment re-plan during payment', () => {
    it('re-schedule racing a payment leaves a consistent plan + debt', async () => {
        const product = await createProduct({ shopQty: 100 });
        const customer = await createCustomer();
        const pid = product._id ?? product.id;

        const inv = await request.post('/api/invoices')
            .set('Cookie', ownerCookie)
            .send({
                customerId: customer._id ?? customer.id,
                items: [{ productId: pid, qty: 60, unitPrice: 20 }], // total 1200
                paymentType: 'credit',
            });
        expect(inv.status).toBeLessThan(300);
        const invoiceId = inv.body.data._id ?? inv.body.data.id;

        const Debt = (await import('../models/Debt.js')).default;
        const debt = await Debt.findOne({ referenceId: invoiceId }).lean();

        // fire re-plan (3 installments) and a 600 payment concurrently
        const [planRes, payRes] = await Promise.all([
            request.post(`/api/financial/debts/${debt._id}/installments`)
                .set('Cookie', ownerCookie)
                .send({ installmentsCount: 3 }),
            request.post('/api/financial/payments/debt')
                .set('Cookie', ownerCookie)
                .send({ debt: String(debt._id), amount: 600, method: 'cash' }),
        ]);
        expect(planRes.status, JSON.stringify(planRes.body).slice(0, 160)).toBeLessThan(300);
        expect(payRes.status, JSON.stringify(payRes.body).slice(0, 160)).toBeLessThan(300);

        const PaymentSchedule = (await import('../models/PaymentSchedule.js')).default;
        const schedules = await PaymentSchedule.find({ debtId: debt._id }).lean();

        // invariant 1: no half-replaced plan — plan is either absent or complete
        expect([0, 3]).toContain(schedules.length);

        // invariant 2: pending principal across schedules == remaining debt
        const pendingSum = schedules
            .filter((s) => s.status === 'PENDING')
            .reduce((acc, s) => acc + s.amount, 0);
        const afterDebt = await Debt.findById(debt._id).lean();
        expect(pendingSum).toBeCloseTo(afterDebt.remainingAmount, 0);

        // invariant 3: debt math closes: original − paid == remaining
        expect(afterDebt.originalAmount - 600).toBeCloseTo(afterDebt.remainingAmount, 2);
        expect(afterDebt.remainingAmount).toBeGreaterThan(0);
    });
});
