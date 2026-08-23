import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createTestApp, seedUser, stopTestDb } from './helpers.js';

// Sprint 05 acceptance: fault-injection (kill mid-flow → zero partial writes)
// and PO receive double-submit idempotency.
// FAULT_INJECT env var drives hooks planted at defined points inside each
// transaction; the thrown error aborts the session and every write rolls back.

let app;
let cookie;
beforeAll(async () => {
    process.env.ALLOW_NON_ATOMIC_DEV = ''; // transactions REQUIRED here
    app = await createTestApp();
    ({ cookie } = await seedUser(app));
}, 180000);

afterEach(() => {
    delete process.env.FAULT_INJECT;
});

afterAll(async () => {
    await stopTestDb();
});

const Customer = async () => (await import('../models/Customer.js')).default;
const Invoice = async () => (await import('../models/Invoice.js')).default;
const TreasuryTransaction = async () => (await import('../models/TreasuryTransaction.js')).default;
const CashboxDaily = async () => (await import('../models/CashboxDaily.js')).default;
const PurchaseOrder = async () => (await import('../models/PurchaseOrder.js')).default;
const StockMovement = async () => (await import('../models/StockMovement.js')).default;

async function makeCustomer({ balance = 0 } = {}) {
    const C = await Customer();
    return await C.create({
        name: `Fault Test ${Math.random().toString(36).slice(2)}`,
        phone: `${Math.floor(Math.random() * 1e12)}`.padStart(12, '5'),
        balance,
    });
}

async function snapshotCounts() {
    return {
        txs: await (await TreasuryTransaction()).countDocuments(),
        invoices: await (await Invoice()).countDocuments(),
    };
}

describe('T-BIZ-01: payment flow fault injection', () => {
    it('abort after invoice update leaves zero net change', async () => {
        const customer = await makeCustomer();
        const I = await Invoice();
        const invoice = await I.create({
            number: `INV-${Date.now()}`,
            items: [{ productName: 'x', qty: 1, unitPrice: 100, total: 100 }],
            subtotal: 100, total: 100,
            customer: customer._id,
            customerName: customer.name,
            paymentType: 'credit',
            paymentStatus: 'pending',
            createdBy: 'f'.repeat(24),
        });

        const before = await snapshotCounts();

        process.env.FAULT_INJECT = 'recordCustomerPayment:afterInvoice';
        const { PaymentService } = await import('../services/financial/paymentService.js');
        await expect(
            PaymentService.recordCustomerPayment(invoice, 40, 'cash', '', 'f'.repeat(24))
        ).rejects.toThrow(/FAULT_INJECT/);

        const after = await snapshotCounts();
        expect(after.txs).toBe(before.txs); // no treasury row

        const fresh = await I.findById(invoice._id).lean();
        expect(fresh.paidAmount ?? 0).toBe(0); // invoice untouched
        expect(fresh.paymentStatus).toBe('pending');

        const freshCustomer = await (await Customer()).findById(customer._id).lean();
        expect(freshCustomer.balance).toBe(customer.balance); // balance unchanged
    });

    it('unified collection abort mid-loop leaves debts and cashbox intact', async () => {
        const customer = await makeCustomer({ balance: 200 });
        // Give the loop something to iterate so the mid-loop hook is reached
        const { DebtService } = await import('../services/financial/debtService.js');
        const debt = await DebtService.createDebt({
            debtorType: 'Customer',
            debtorId: customer._id,
            amount: 80,
            dueDate: new Date(),
            referenceType: 'Manual',
            referenceId: customer._id,
            description: 'unified fault test',
        });
        // Balance includes the debt's receivable created above
        const balanceAfterDebt = (await (await Customer()).findById(customer._id).lean()).balance;
        const before = await snapshotCounts();

        process.env.FAULT_INJECT = 'recordTotalCustomerPayment:midLoop';
        const { PaymentService } = await import('../services/financial/paymentService.js');
        await expect(
            PaymentService.recordTotalCustomerPayment(customer._id, 50, 'cash', '', 'f'.repeat(24))
        ).rejects.toThrow(/FAULT_INJECT/);

        const after = await snapshotCounts();
        expect(after.txs).toBe(before.txs);

        const fresh = await (await Customer()).findById(customer._id).lean();
        expect(fresh.balance).toBe(balanceAfterDebt); // credit not applied

        const D = (await import('../models/Debt.js')).default;
        const freshDebt = await D.findById(debt._id).lean();
        expect(freshDebt.remainingAmount).toBe(80); // debt untouched
    });

    it('two simultaneous partial payments on one debt sum exactly', async () => {
        // Manual debt via service, then two concurrent payments of 30 each on a 60 debt
        const customer = await makeCustomer();
        const { DebtService } = await import('../services/financial/debtService.js');
        const debt = await DebtService.createDebt({
            debtorType: 'Customer',
            debtorId: customer._id,
            amount: 60,
            dueDate: new Date(),
            referenceType: 'Manual',
            referenceId: customer._id,
            description: 'concurrency test debt',
        });

        const { PaymentService } = await import('../services/financial/paymentService.js');
        const attempt = () =>
            PaymentService.recordManualDebtPayment(debt, 30, 'cash', '', 'f'.repeat(24));
        // Write conflicts between the two transactions are transient — retry
        // until both land (production paths use withRetry for the same reason).
        let fulfilled = 0;
        for (let round = 0; round < 3 && fulfilled < 2; round++) {
            const results = await Promise.allSettled([attempt(), attempt()]);
            fulfilled += results.filter((r) => r.status === 'fulfilled').length;
            if (fulfilled < 2) await new Promise((r) => setTimeout(r, 100));
        }
        expect(fulfilled).toBe(2);

        const D = (await import('../models/Debt.js')).default;
        const fresh = await D.findById(debt._id).lean();
        expect(fresh.remainingAmount).toBe(0);
        expect(fresh.status).toBe('settled');
    });
});

describe('T-BIZ-04: PO receive idempotency', () => {
    it('double submit receive → second call 409; stock received exactly once', async () => {
        const P = await (async () => (await import('../models/Product.js')).default)();
        const product = await P.create({
            name: `PO Recv ${Math.random().toString(36).slice(2)}`,
            code: `POR-${Date.now()}`, retailPrice: 10, buyPrice: 5,
        });
        const S = await (async () => (await import('../models/Supplier.js')).default)();
        const supplier = await S.create({ name: `PO Supplier ${Date.now()}` });
        const PO = await PurchaseOrder();

        const po = await PO.create({
            supplier: supplier._id,
            items: [{ productId: product._id, quantity: 7, costPrice: 5 }],
            totalCost: 35,
            poNumber: `PO-${Date.now()}-t1`,
            status: 'PENDING',
            paymentType: 'cash',
        });

        const { FinanceService } = await import('../services/financeService.js');
        // Simulate two concurrent receives through updateStatus path
        const attempts = await Promise.allSettled([
            FinanceService.recordPurchaseReceive(po, 'f'.repeat(24), 'cash'),
            FinanceService.recordPurchaseReceive(po, 'f'.repeat(24), 'cash'),
        ]);

        const fulfilled = results_count(attempts);
        function results_count(r) { return r.filter((x) => x.status === 'fulfilled').length; }
        expect(fulfilled).toBe(1);

        const freshPo = await PO.findById(po._id).lean();
        expect(freshPo.status).toBe('RECEIVED');

        const freshProduct = await P.findById(product._id).lean();
        expect(freshProduct.warehouseQty).toBe(7); // received EXACTLY once

        const ledger = await (await StockMovement()).countDocuments({
            refId: po._id, type: 'IN',
        });
        expect(ledger).toBe(1);
    });

    it('fault after stock bulkWrite aborts — stock unchanged', async () => {
        const P = await (async () => (await import('../models/Product.js')).default)();
        const product = await P.create({
            name: `PO Fault ${Math.random().toString(36).slice(2)}`,
            code: `POF-${Date.now()}`, retailPrice: 10, buyPrice: 5,
        });
        const PO = await PurchaseOrder();
        const S = await (async () => (await import('../models/Supplier.js')).default)();
        const supplier2 = await S.create({ name: `PO Fault Supplier ${Date.now()}` });
        const po = await PO.create({
            supplier: supplier2._id,
            items: [{ productId: product._id, quantity: 4, costPrice: 5 }],
            totalCost: 20,
            poNumber: `PO-${Date.now()}-t2`,
            status: 'PENDING',
            paymentType: 'cash',
        });

        const { PurchaseService } = await import('../services/financial/purchaseService.js');
        process.env.FAULT_INJECT = 'recordPurchaseReceive:afterStock';
        await expect(
            PurchaseService.recordPurchaseReceive(po, 'f'.repeat(24), 'cash')
        ).rejects.toThrow(/FAULT_INJECT/);

        const freshProduct = await P.findById(product._id).lean();
        expect(freshProduct.warehouseQty ?? 0).toBe(0); // rolled back

        const freshPo = await PO.findById(po._id).lean();
        expect(freshPo.status).not.toBe('RECEIVED');
    });
});
