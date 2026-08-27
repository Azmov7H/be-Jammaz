import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, seedUser, stopTestDb } from './helpers.js';

// Sprint 03 acceptance: schema enforcement, bounds, refine restore,
// ObjectId params, injection defense.

let app;
let ownerCookie;
beforeAll(async () => {
    app = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(app));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const post = (url, body, cookie = ownerCookie) =>
    app.post(url).set('Cookie', cookie).send(body);

describe('T-VAL-01: fieldErrors contract', () => {
    it('rejects invalid customer with 400 + details.fieldErrors map', async () => {
        const res = await post('/api/customers', { name: 'x', phone: '' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.details.fieldErrors).toHaveProperty('phone');
        expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('strips unknown fields (zod default)', async () => {
        // tokenVersion must never be settable via API
        const res = await post('/api/users', {
            name: 'Hacker Try', email: `hz-${Date.now()}@test.local`,
            password: 'Secret12345', role: 'viewer', tokenVersion: 99999,
        });
        expect(res.status).toBe(200);
        const User = (await import('../models/User.js')).default;
        const u = await User.findOne({ email: `hz-${Date.now()}@test.local` }) ||
            await User.findOne({}).sort({ createdAt: -1 });
        if (u.email?.endsWith('@test.local')) {
            expect(u.tokenVersion ?? 0).toBe(0);
        }
    });
});

describe('T-VAL-02: injection defense', () => {
    it('$gt operator login bypass is rejected by sanitization/zod', async () => {
        const res = await app.post('/api/auth/login').send({
            email: { $gt: '' },
            password: { $gt: '' },
        });
        expect([400, 401]).toContain(res.status);
    });

    it('dotted keys are stripped before handlers see them', async () => {
        const res = await post('/api/customers', {
            'name': 'Dot Test',
            'phone': '0599111222',
            'creditLimit.$gt': 0,
        });
        // dotted key stripped -> schema ignores unknown; or 400; never stored
        expect([200, 400]).toContain(res.status);
        if (res.status === 200) {
            const Customer = (await import('../models/Customer.js')).default;
            const c = await Customer.findById(res.body.data._id ?? res.body.data.id).lean();
            expect(Object.keys(c)).not.toContain('creditLimit.$gt');
        }
    });
});

describe('T-VAL-03: numeric & array bounds', () => {
    it('negative payment amount → 400', async () => {
        const res = await post('/api/financial/payments/customer', {
            invoice: '0'.repeat(24), amount: -50,
        });
        expect(res.status).toBe(400);
        expect(res.body.details.fieldErrors.amount).toBeTruthy();
    });

    it('oversize money (>1e9) → 400', async () => {
        const res = await post('/api/financial/expenses', {
            amount: 5e9, reason: 'test', category: 'test',
        });
        expect(res.status).toBe(400);
    });

    it('pagination limit >100 clamps to 400 via query validation? (schema bound)', async () => {
        // bound enforced at schema level; direct service helper tested in unit scope
        const { paginationSchema } = await import('../validations/index.js');
        const parsed = paginationSchema.safeParse({ limit: '500' });
        expect(parsed.success).toBe(false);
    });

    it('installments count >60 rejected', async () => {
        const res = await post(`/api/financial/debts/${'0'.repeat(24)}/installments`, {
            installmentsCount: 500,
        });
        expect(res.status).toBe(400);
        expect(res.body.details.fieldErrors.installmentsCount).toBeTruthy();
    });
});

describe('T-VAL-04: credit sale requires customer', () => {
    const items = [{ productId: '0'.repeat(24), qty: 1, unitPrice: 10 }];

    it('credit without any customer identity → 400', async () => {
        const res = await post('/api/invoices', {
            items, paymentType: 'credit',
        });
        expect(res.status).toBe(400);
    });

    it('credit with nonexistent customerId passes schema, fails service with 404', async () => {
        const res = await post('/api/invoices', {
            items, paymentType: 'credit', customerId: 'a'.repeat(24),
        });
        expect([404, 400]).toContain(res.status);
        if (res.status === 404) {
            expect(res.body.message).toBe('العميل غير موجود');
        }
    });

    it('cash sale without customer still allowed', async () => {
        // product doesn't exist -> may 400/404/500 on product lookup,
        // but MUST NOT be the credit-refine message path
        const res = await post('/api/invoices', {
            items, paymentType: 'cash',
        });
        expect([200, 400, 404]).toContain(res.status);
        if (res.body.details?.fieldErrors) {
            expect(JSON.stringify(res.body.details)).not.toContain('آجلة');
        }
    });
});

describe('T-VAL-05: garbage ObjectIds → 404 across routers', () => {
    const bad = 'not-an-id';
    const cases = [
        ['GET', `/api/customers/${bad}`],
        ['GET', `/api/suppliers/${bad}`],
        ['DELETE', `/api/users/${bad}`],
        ['PUT', `/api/purchases/${bad}/status`],
        ['GET', `/api/physical-inventory/${bad}`],
        ['DELETE', `/api/notifications/${bad}`],
        ['DELETE', `/api/financial/transaction/${bad}`],
    ];
    for (const [method, url] of cases) {
        it(`${method} ${url} → 404`, async () => {
            const res = await app[method.toLowerCase()](url)
                .set('Cookie', ownerCookie)
                .send({});
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('NOT_FOUND');
        });
    }

    it('valid-but-missing id → 404 (not 200+null)', async () => {
        const res = await app.get(`/api/physical-inventory/${'f'.repeat(24)}`)
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(404);
    });
});
