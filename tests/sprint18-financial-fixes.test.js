import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// Jammaz-System — Sprint 18 — Financial Bugs & Data Integrity Fix.
//
// Covers the task's mandatory test scenarios:
//   T1 — Customer-specific price 1450 actually applied on the invoice
//   T2 — Sale 10,000 / Return 2,000 / creditBalance = 2,000
//   T3 — Refund 2,000 → remaining creditBalance = 0
//   T4 — Refund > available credit rejected (4xx)
//   T5 — SALE_INVOICE → PDF generated via document engine
//   T6 — Customer account statement → PDF generated
//
// Plus a few sanity checks around the document-engine endpoints
// (sale + statement list).

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'S18 Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(300);

async function createProduct(overrides = {}) {
    const res = await request.post('/api/products').set('Cookie', ownerCookie).send({
        name: `منتج s18-${uniq('P')}`, code: uniq('C'),
        buyPrice: 10, retailPrice: 1500, wholesalePrice: 1400,
        specialPrice: 1450, warehouseQty: 0, shopQty: 100, ...overrides,
    });
    ok(res, 'createProduct');
    return res.body.data;
}

async function createCustomer(overrides = {}) {
    const res = await request.post('/api/customers').set('Cookie', ownerCookie).send({
        name: `عميل s18-${uniq('X')}`,
        phone: uniq('079'),
        priceType: 'retail',
        ...overrides,
    });
    ok(res, 'createCustomer');
    return res.body.data;
}

/**
 * Convenience: create a product whose retail price matches the unitPrice
 * we'll send on the invoice. The retail price is the server-resolved
 * price for retail-tier customers with no custom override.
 */
async function createProductAtPrice(unitPrice, overrides = {}) {
    return createProduct({ retailPrice: unitPrice, ...overrides });
}

// ---------------------------------------------------------------------------
// T1 — Customer price 1450 actually applied
// ---------------------------------------------------------------------------
describe('Sprint 18 — Customer-specific pricing', () => {
    it('T1: customer price 1450 → invoice unitPrice 1450 (not 1500 retail)', async () => {
        const product = await createProduct();
        const customer = await createCustomer();

        // Set the customer-specific price (the document engine resolves to this).
        const setRes = await request.post(`/api/customers/${id(customer)}/pricing`)
        .set('Cookie', ownerCookie)
            .send({ productId: id(product), price: 1450 });
        ok(setRes, 'set custom price');

        // Send the invoice with the customer-specific price (frontend would).
        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 2, unitPrice: 1450 }],
            paymentType: 'cash',
        });
        ok(invRes, 'create invoice with custom price');
        const invoice = invRes.body.data;
        expect(Number(invoice.items[0].unitPrice)).toBe(1450);
        expect(Number(invoice.total)).toBe(2900);
    });

    it('T1b: invoice rejects when client price does not match server-resolved price', async () => {
        const product = await createProduct();
        const customer = await createCustomer();

        // Set custom price to 1450; client tries to charge 1500.
        await request.post(`/api/customers/${id(customer)}/pricing`)
        .set('Cookie', ownerCookie)
            .send({ productId: id(product), price: 1450 });

        const bad = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 1, unitPrice: 1500 }],
            paymentType: 'cash',
        });
        expect(bad.status).toBe(400);
        expect(String(bad.body.message)).toMatch(/السعر/);
    });

    it('T1c: tier wholesale price overrides retail', async () => {
        const product = await createProduct(); // retail=1500, wholesale=1400
        const customer = await createCustomer({ priceType: 'wholesale' });

        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 1, unitPrice: 1400 }],
            paymentType: 'cash',
        });
        ok(invRes, 'create wholesale invoice');
        expect(Number(invRes.body.data.items[0].unitPrice)).toBe(1400);
    });

    it('T1d: invoice line total frozen at historical price (FIN-PRC-003)', async () => {
        const product = await createProduct();
        const customer = await createCustomer();

        await request.post(`/api/customers/${id(customer)}/pricing`)
        .set('Cookie', ownerCookie)
            .send({ productId: id(product), price: 1450 });

        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 1, unitPrice: 1450 }],
            paymentType: 'cash',
        });
        const invoiceId = id(invRes.body.data);
        const frozenUnitPrice = invRes.body.data.items[0].unitPrice;

        // Now the customer's price changes — the historical invoice must NOT.
        await request.post(`/api/customers/${id(customer)}/pricing`)
        .set('Cookie', ownerCookie)
            .send({ productId: id(product), price: 1300 });

        const refetch = await request.get(`/api/invoices/${invoiceId}`).set('Cookie', ownerCookie);
        ok(refetch, 'refetch invoice');
        expect(Number(refetch.body.data.items[0].unitPrice)).toBe(frozenUnitPrice);
        expect(Number(refetch.body.data.items[0].unitPrice)).toBe(1450);
    });
});

// ---------------------------------------------------------------------------
// T2..T4 — Sale return + credit + refund flow
// ---------------------------------------------------------------------------
describe('Sprint 18 — Sale return / customer credit refund', () => {
    it('T2: sale 10,000 → return 2,000 → customer creditBalance = 2,000', async () => {
        const product = await createProductAtPrice(1000);
        const customer = await createCustomer();

        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 10, unitPrice: 1000 }], // 10,000
            paymentType: 'cash',
        });
        ok(invRes, 'create 10k invoice');
        const invoiceId = id(invRes.body.data);

        // Return 2 items (2,000 refund) credited to the customer's balance.
        const retRes = await request.post(`/api/invoices/${invoiceId}/return`)
            .set('Cookie', ownerCookie)
            .send({
                items: [{ invoiceItemId: invRes.body.data.items[0]._id, qty: 2 }],
                refundMethod: 'customerBalance',
            });
        ok(retRes, 'create return');

        const custRes = await request.get(`/api/customers/${id(customer)}`).set('Cookie', ownerCookie);
        ok(custRes, 'get customer');
        expect(Number(custRes.body.data.creditBalance || 0)).toBe(2000);
    });

    it('T3: refund 2,000 of available credit → remaining credit = 0', async () => {
        const product = await createProductAtPrice(1000);
        const customer = await createCustomer();

        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 10, unitPrice: 1000 }],
            paymentType: 'cash',
        });
        const invoiceId = id(invRes.body.data);
        await request.post(`/api/invoices/${invoiceId}/return`)
            .set('Cookie', ownerCookie)
            .send({
                items: [{ invoiceItemId: invRes.body.data.items[0]._id, qty: 2 }],
                refundMethod: 'customerBalance',
            });

        const before = await request.get(`/api/customers/${id(customer)}`).set('Cookie', ownerCookie);
        expect(Number(before.body.data.creditBalance || 0)).toBe(2000);

        const refundRes = await request.post(`/api/financial/refunds/customer-credit/${id(customer)}`)
            .set('Cookie', ownerCookie)
            .send({ amount: 2000, method: 'cash', note: 'استرداد اختبار' });
        ok(refundRes, 'refund credit');

        const after = await request.get(`/api/customers/${id(customer)}`).set('Cookie', ownerCookie);
        expect(Number(after.body.data.creditBalance || 0)).toBe(0);
        expect(Number(after.body.data.totalRefunded || 0)).toBe(2000);

        // Verify treasury txn exists and is EXPENSE
        const { default: Txn } = await import('../models/TreasuryTransaction.js');
        // Debug: list all EXPENSE tx for this customer
        const allExp = await Txn.find({ partnerId: id(customer), type: 'EXPENSE' }).lean();
        // eslint-disable-next-line no-console
        console.log('Expense tx for customer:', allExp.map(t => ({
            amount: t.amount,
            method: t.method,
            meta: t.meta,
            description: t.description,
        })));
        const tx = allExp.find((t) => t.meta && t.meta.isCreditRefund === true);
        expect(tx, 'no credit-refund treasury transaction found').toBeTruthy();
        expect(Number(tx.amount)).toBe(2000);
    });

    it('T4: refund > available credit is rejected', async () => {
        const product = await createProductAtPrice(1000);
        const customer = await createCustomer();

        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 10, unitPrice: 1000 }],
            paymentType: 'cash',
        });
        const invoiceId = id(invRes.body.data);
        await request.post(`/api/invoices/${invoiceId}/return`)
            .set('Cookie', ownerCookie)
            .send({
                items: [{ invoiceItemId: invRes.body.data.items[0]._id, qty: 2 }],
                refundMethod: 'customerBalance',
            });

        // Available credit = 2,000; try to refund 2,500.
        const tooMuch = await request.post(`/api/financial/refunds/customer-credit/${id(customer)}`)
            .set('Cookie', ownerCookie)
            .send({ amount: 2500, method: 'cash' });
        expect(tooMuch.status).toBe(400);
        expect(String(tooMuch.body.message)).toMatch(/يتجاوز|رصيد/i);

        // Customer balance must NOT have changed
        const after = await request.get(`/api/customers/${id(customer)}`).set('Cookie', ownerCookie);
        expect(Number(after.body.data.creditBalance || 0)).toBe(2000);
    });

    it('T4b: refund amount must be positive', async () => {
        const customer = await createCustomer();
        const neg = await request.post(`/api/financial/refunds/customer-credit/${id(customer)}`)
            .set('Cookie', ownerCookie)
            .send({ amount: -10, method: 'cash' });
        expect(neg.status).toBe(400);
    });

    it('T4c: refund on a customer with no credit balance is rejected', async () => {
        const customer = await createCustomer();
        const res = await request.post(`/api/financial/refunds/customer-credit/${id(customer)}`)
            .set('Cookie', ownerCookie)
            .send({ amount: 100, method: 'cash' });
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// T5 — SALE_INVOICE → PDF
// T6 — CUSTOMER_ACCOUNT_STATEMENT → PDF
// ---------------------------------------------------------------------------
describe('Sprint 18 — Document engine PDFs', () => {
    it('T5: SALE_INVOICE → application/pdf generated', async () => {
        const product = await createProductAtPrice(1500);
        const customer = await createCustomer();

        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 3, unitPrice: 1500 }],
            paymentType: 'cash',
        });
        const invoiceId = id(invRes.body.data);

        const pdfRes = await request.get(`/api/documents/SALE_INVOICE/${invoiceId}/export?format=pdf`)
            .set('Cookie', ownerCookie);
        ok(pdfRes, 'get pdf');
        expect(pdfRes.headers['content-type']).toMatch(/application\/pdf/);
        // pdfkit emits %PDF-1.x as the file's magic.
        expect(pdfRes.body.slice(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('T6: CUSTOMER_ACCOUNT_STATEMENT → application/pdf generated', async () => {
        const customer = await createCustomer();
        const cid = id(customer);
        expect(cid).toBeTruthy();
        // confirm the customer is queryable
        const sanity = await request.get(`/api/customers/${cid}`).set('Cookie', ownerCookie);
        expect(sanity.status).toBe(200);

        const pdfRes = await request.get(`/api/documents/CUSTOMER_ACCOUNT_STATEMENT/${cid}/export?format=pdf`)
            .set('Cookie', ownerCookie);
        ok(pdfRes, 'get statement pdf');
        expect(pdfRes.headers['content-type']).toMatch(/application\/pdf/);
        expect(pdfRes.body.slice(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('CUSTOMER_COLLECTION_RECEIPT → application/pdf generated', async () => {
        const product = await createProductAtPrice(100);
        const customer = await createCustomer();

        // First make a credit invoice to create a debt, then pay it to
        // generate a collection receipt transaction. We pay the customer's
        // total balance through the unified endpoint (the dispatcher picks
        // the receivable-payment path because there's an active debt).
        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 5, unitPrice: 100 }],
            paymentType: 'credit',
        });
        const invoiceId = id(invRes.body.data);
        expect(invoiceId).toBeTruthy();

        // Use the /api/customers/:id/pay endpoint which records a unified
        // collection and returns a transaction id.
        const payRes = await request.post(`/api/customers/${id(customer)}/pay`)
            .set('Cookie', ownerCookie)
            .send({ amount: 200, method: 'cash', note: 'استلام اختبار' });
        ok(payRes, 'pay customer total');
        const txId = payRes.body.data?.transaction?._id;
        expect(txId).toBeTruthy();

        const pdfRes = await request.get(`/api/documents/CUSTOMER_COLLECTION_RECEIPT/${txId}/export?format=pdf`)
            .set('Cookie', ownerCookie);
        ok(pdfRes, 'get receipt pdf');
        expect(pdfRes.headers['content-type']).toMatch(/application\/pdf/);
        expect(pdfRes.body.slice(0, 5).toString('ascii')).toBe('%PDF-');
    });
});

// ---------------------------------------------------------------------------
// Smoke tests for the formerly-empty financial pages
// ---------------------------------------------------------------------------
describe('Sprint 18 — formerly-empty financial pages', () => {
    it('GET /api/payments (receivables alias) returns the open invoice', async () => {
        const product = await createProductAtPrice(100);
        const customer = await createCustomer();
        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 2, unitPrice: 100 }],
            paymentType: 'credit',
        });
        ok(invRes, 'credit invoice');

        const res = await request.get('/api/payments').set('Cookie', ownerCookie);
        ok(res, 'receivables list');
        expect(Array.isArray(res.body.data.invoices)).toBe(true);
        expect(res.body.data.invoices.some((i) => String(i._id) === id(invRes.body.data))).toBe(true);
        expect(res.body.data.totalReceivables).toBeGreaterThanOrEqual(200);
    });

    it('GET /api/sales-returns (alias) lists returns', async () => {
        const product = await createProductAtPrice(100);
        const customer = await createCustomer();
        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 5, unitPrice: 100 }],
            paymentType: 'cash',
        });
        const invoiceId = id(invRes.body.data);
        const retRes = await request.post(`/api/invoices/${invoiceId}/return`)
            .set('Cookie', ownerCookie)
            .send({
                items: [{ invoiceItemId: invRes.body.data.items[0]._id, qty: 1 }],
                refundMethod: 'cash',
            });
        ok(retRes, 'create return');

        const res = await request.get('/api/sales-returns').set('Cookie', ownerCookie);
        ok(res, 'sales-returns list');
        expect(Array.isArray(res.body.data.returns)).toBe(true);
        expect(res.body.data.count).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/invoices writes an AccountingEntry (SALE ledger populated)', async () => {
        const product = await createProductAtPrice(100);
        const customer = await createCustomer();
        await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 1, unitPrice: 100 }],
            paymentType: 'cash',
        });
        const { default: AccountingEntry } = await import('../models/AccountingEntry.js');
        const entries = await AccountingEntry.find({ type: { $in: ['SALE', 'COGS'] } }).lean();
        expect(entries.length).toBeGreaterThan(0);
    });

    it('POST /api/invoices/:id/return writes a RETURN AccountingEntry', async () => {
        const product = await createProductAtPrice(200);
        const customer = await createCustomer();
        const invRes = await request.post('/api/invoices').set('Cookie', ownerCookie).send({
            customerId: id(customer),
            items: [{ productId: id(product), qty: 4, unitPrice: 200 }],
            paymentType: 'cash',
        });
        await request.post(`/api/invoices/${id(invRes.body.data)}/return`)
            .set('Cookie', ownerCookie)
            .send({
                items: [{ invoiceItemId: invRes.body.data.items[0]._id, qty: 1 }],
                refundMethod: 'cash',
            });
        const { default: AccountingEntry } = await import('../models/AccountingEntry.js');
        const entries = await AccountingEntry.find({ type: { $in: ['RETURN', 'RETURN_COGS'] } }).lean();
        expect(entries.length).toBeGreaterThan(0);
    });
});