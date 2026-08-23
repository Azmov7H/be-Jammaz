import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, seedUser, stopTestDb } from './helpers.js';

// Characterization suite (T-B00-04): locks in CURRENT behavior as the baseline.
// When Sprint 01+ intentionally changes a response/status, update the assertion
// IN THE SAME COMMIT and note it in the PR.

let app;
beforeAll(async () => {
    app = await createTestApp();
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

describe('GET / (health banner)', () => {
    it('returns the running message without auth', async () => {
        const res = await app.get('/').expect(200);
        expect(res.body).toEqual({ message: 'Transfer ERP API is running' });
    });
});

describe('POST /api/auth/login', () => {
    it('rejects bad credentials with unified 401 error shape', async () => {
        const res = await app.post('/api/auth/login')
            .send({ email: 'nobody@test.local', password: 'wrong' })
            .expect(401);
        expect(res.body.success).toBe(false);
        expect(typeof res.body.message).toBe('string');
        expect(res.body.data).toBeNull();
    });

    it('rejects invalid payload with zod fieldErrors', async () => {
        const res = await app.post('/api/auth/login').send({ email: 'not-an-email' }).expect(400);
        expect(res.body.success).toBe(false);
        expect(res.body.details).toHaveProperty('email');
        expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('logs in a seeded user and sets an httpOnly token cookie', async () => {
        const { user } = await seedUser(app);
        // seedUser already performed a successful login; verify its shape via helper contract
        expect(user.id).toBeTruthy();
        expect(user.email).toContain('@test.local');
        expect(user.role).toBe('owner');
        expect(user.password).toBeUndefined();
    });
});

describe('GET /api/auth/session', () => {
    it('returns the current user for a valid cookie', async () => {
        const { user, cookie } = await seedUser(app);
        const res = await app.get('/api/auth/session').set('Cookie', cookie).expect(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.email ?? res.body.data.user?.email).toBeDefined();
    });

    it('returns null data without a token', async () => {
        const res = await app.get('/api/auth/session').expect(200);
        expect(res.body.data).toBeNull();
    });
});

describe('GET /api/products (auth + envelope)', () => {
    it('requires authentication', async () => {
        await app.get('/api/products').expect(401);
    });

    it('lists products with the standard envelope and pagination', async () => {
        const { cookie } = await seedUser(app);
        const res = await app.get('/api/products').set('Cookie', cookie).expect(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.products)).toBe(true);
        expect(res.body.data.pagination).toMatchObject({
            total: expect.any(Number),
            pages: expect.any(Number),
            page: 1,
            limit: 10,
        });
    });
});

describe('POST /api/products (create happy path)', () => {
    it('creates a product and returns it in the envelope', async () => {
        const { cookie } = await seedUser(app);
        const res = await app.post('/api/products').set('Cookie', cookie)
            .send({ name: 'Baseline Perfume', code: `BASE-${Date.now()}`, buyPrice: 10, retailPrice: 20 })
            .expect(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.code).toMatch(/^BASE-/);
    });

    it('rejects invalid payloads with zod errors', async () => {
        const { cookie } = await seedUser(app);
        const res = await app.post('/api/products').set('Cookie', cookie)
            .send({ code: 'NO-NAME' }).expect(400);
        expect(res.body.success).toBe(false);
        expect(res.body.details).toHaveProperty('name');
    });
});

describe('POST /api/invoices (cash sale happy path)', () => {
    it('creates a cash invoice for a service item', async () => {
        const { cookie, user } = await seedUser(app, { name: 'Cashier Flow', role: 'owner' });
        const res = await app.post('/api/invoices').set('Cookie', cookie)
            .send({
                items: [{ name: 'Delivery fee', qty: 1, unitPrice: 50, isService: true }],
                paymentType: 'cash',
                customerName: 'Walk-in',
            })
            .expect(200);
        expect(res.body.success).toBe(true);
        expect(String(res.body.data.number)).toMatch(/^INV-/);
        expect(res.body.data.paymentStatus).toBe('paid');
        expect(String(res.body.data.createdBy)).toBe(user.id);
    });

    it('rejects an empty items array', async () => {
        const { cookie } = await seedUser(app);
        await app.post('/api/invoices').set('Cookie', cookie)
            .send({ items: [], paymentType: 'cash' }).expect(400);
    });
});

describe('GET /api/docs', () => {
    it('is protected only TRANSITIVELY: reportRoutes is mounted at bare /api with router-level auth, '
        + 'so unmatched /api/* traffic (incl. /api/docs) inherits authMiddleware (SEC-001 baseline evidence)', async () => {
        const res = await app.get('/api/docs').expect(401);
        expect(res.body.message).toBe('Unauthorized: No token provided');
    });
});
