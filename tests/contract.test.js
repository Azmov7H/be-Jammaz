import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

let request;
let ownerCookie;
let ownerEmail;

beforeAll(async () => {
    request = await createTestApp();
    const seeded = await seedUser(request, { name: 'Contract Owner', role: 'owner' });
    ownerCookie = seeded.cookie;
    ownerEmail = seeded.user.email;
});

afterAll(async () => {
    await stopTestDb();
});

const F = 'f'.repeat(24);

describe('T-TST-04: success envelope shape', () => {
    const ENVELOPE_KEYS = ['success', 'data', 'message', 'timestamp'];

    const expectEnvelope = (body) => {
        expect(Object.keys(body).sort()).toEqual([...ENVELOPE_KEYS].sort());
        expect(body.success).toBe(true);
        expect(body.message).toBeNull();
        expect(typeof body.timestamp).toBe('string');
        expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
    };

    it('list endpoint (users)', async () => {
        const res = await request.get('/api/users').set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        expectEnvelope(res.body);
        expect(Array.isArray(res.body.data.users)).toBe(true);
        // pagination contract from T-PERF-01
        for (const k of ['total', 'page', 'limit']) {
            expect(res.body.data, `missing ${k}`).toHaveProperty(k);
        }
    });

    it('single-read endpoint (settings)', async () => {
        const res = await request.get('/api/settings/invoice-design').set('Cookie', ownerCookie);
        expect(res.status).toBeLessThan(300);
        expectEnvelope(res.body);
    });

    it('write endpoint (customer create) returns created entity in data', async () => {
        const res = await request.post('/api/customers')
            .set('Cookie', ownerCookie)
            .send({ name: 'عقد عميل', phone: `079${Date.now()}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 13) });
        expect(res.status).toBeLessThan(300);
        expectEnvelope(res.body);
        expect(res.body.data._id ?? res.body.data.id).toBeTruthy();
    });
});

describe('T-TST-04: error class → status map', () => {
    it('Zod validation → 400 with fieldErrors map', async () => {
        const res = await request.post('/api/customers')
            .set('Cookie', ownerCookie)
            .send({ name: '', phone: '1' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('BAD_REQUEST');
        expect(res.body.details?.fieldErrors ?? res.body.data?.fieldErrors).toBeTruthy();
        // Arabic user-facing messages preserved end-to-end
        expect(JSON.stringify(res.body)).toContain('الاسم مطلوب');
    });

    it('NotFoundError → 404 (nonexistent id)', async () => {
        const res = await request.get(`/api/users/${F}`).set('Cookie', ownerCookie);
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it('ForbiddenError → 403 (insufficient role)', async () => {
        const { cookie } = await seedUser(request, { name: 'Contract Viewer', role: 'viewer' });
        const res = await request.get('/api/logs').set('Cookie', cookie);
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it('ConflictError → 409 (duplicate email on user create)', async () => {
        const User = (await import('../models/User.js')).default;
        const existing = await User.findOne({ role: 'owner' }).lean();

        const res = await request.post('/api/users')
            .set('Cookie', ownerCookie)
            .send({
                name: 'Duplicate Probe',
                email: existing.email,
                password: 'longenough',
                role: 'cashier',
            });
        expect(res.status).toBe(409);
        expect(res.body.message).toContain('مستخدم بالفعل');
    });

    it('CastError-style malformed id → 404, never 500', async () => {
        const res = await request.get('/api/customers/not-an-objectid')
            .set('Cookie', ownerCookie);
        expect([404]).toContain(res.status);
    });

    it('E11000 duplicate key → 409 with Arabic message', async () => {
        // product code has a unique index; create twice via API
        const code = `CTR-${Date.now()}`;
        const first = await request.post('/api/products')
            .set('Cookie', ownerCookie)
            .send({ name: 'عقد منتج', code, buyPrice: 1, retailPrice: 2 });
        expect(first.status).toBeLessThan(300);

        const second = await request.post('/api/products')
            .set('Cookie', ownerCookie)
            .send({ name: 'عقد منتج ٢', code, buyPrice: 1, retailPrice: 2 });
        expect(second.status).toBe(409);
        // product-code path has its own Arabic duplicate message
        expect(second.body.message + (second.body.details ? JSON.stringify(second.body.details) : ''))
            .toMatch(/مستخدم بالفعل|موجود مسبقاً/);
    });

    it('unauthenticated → 401', async () => {
        const res = await request.get('/api/users');
        expect(res.status).toBe(401);
    });
});

describe('T-TST-04: auth lifecycle', () => {
    let password = 'Test123456';
    let email;

    beforeAll(async () => {
        const seeded = await seedUser(request, { name: 'Lifecycle Cashier', role: 'cashier' });
        email = seeded.user.email;
    });

    const parseCookies = (res) => {
        const jar = {};
        for (const c of res.headers['set-cookie'] ?? []) {
            const [pair] = c.split(';');
            const [k, ...v] = pair.split('=');
            jar[k.trim()] = v.join('=');
        }
        return jar;
    };

    it('login issues access + refresh cookies', async () => {
        const res = await request.post('/api/auth/login').send({ email, password });
        expect(res.status).toBe(200);
        const jar = parseCookies(res);
        expect(jar.token).toBeTruthy();
        expect(jar.refresh).toBeTruthy();
        // refresh cookie is path-scoped to /api/auth
        const raw = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('refresh='));
        expect(raw).toContain('Path=/api/auth');
    });

    it('refresh rotates: old token revoked, new one issued', async () => {
        const login = await request.post('/api/auth/login').send({ email, password });
        const jar1 = parseCookies(login);
        const oldRefresh = jar1.refresh;

        const r1 = await request.post('/api/auth/refresh').set('Cookie', `refresh=${oldRefresh}`);
        expect(r1.status).toBe(200);
        const jar2 = parseCookies(r1);
        expect(jar2.refresh).toBeTruthy();
        expect(jar2.refresh).not.toBe(oldRefresh);

        // the OLD token is now revoked — replaying it must fail…
        const r2 = await request.post('/api/auth/refresh').set('Cookie', `refresh=${oldRefresh}`);
        expect(r2.status).toBe(401);

        // …and reuse detection kills the whole family: the NEW token is dead too
        const r3 = await request.post('/api/auth/refresh').set('Cookie', `refresh=${jar2.refresh}`);
        expect(r3.status).toBe(401);
        expect(r3.body.message).toContain('أسباب أمنية');
    });

    it('logout revokes the session server-side', async () => {
        const login = await request.post('/api/auth/login').send({ email, password });
        const { token, refresh } = parseCookies(login);

        const out = await request.post('/api/auth/logout')
            .set('Cookie', `token=${token}; refresh=${refresh}`);
        expect(out.status).toBeLessThan(300);

        const after = await request.post('/api/auth/refresh').set('Cookie', `refresh=${refresh}`);
        expect(after.status).toBe(401);
    });

    it('tokenVersion bump invalidates outstanding access tokens', async () => {
        const login = await request.post('/api/auth/login').send({ email, password });
        const { token } = parseCookies(login);

        // owner deactivates then reactivates the cashier → tokenVersion bumped
        const User = (await import('../models/User.js')).default;
        const me = await User.findOne({ email }).lean();
        const owners = await User.find({ role: 'owner', isActive: true }).lean();
        const actor = owners[0];
        void actor;

        const bump = await request.put(`/api/users/${me._id}`)
            .set('Cookie', ownerCookie)
            .send({ isActive: true }); // no-op write does NOT bump

        // force a real privilege-relevant change: change password
        const pw = await request.put(`/api/users/${me._id}`)
            .set('Cookie', ownerCookie)
            .send({ password: 'AnotherPass123' });
        expect(pw.status).toBeLessThan(300);
        void bump;

        const stillValid = await request.get(`/api/notifications`).set('Cookie', `token=${token}`);
        // tokenVersion was incremented by the password change → old token dies
        expect(stillValid.status).toBe(401);
    });

    it('wrong password login is indistinguishable from unknown account', async () => {
        const bad = await request.post('/api/auth/login').send({ email, password: 'nope-nope' });
        const ghost = await request.post('/api/auth/login')
            .send({ email: `ghost-${Date.now()}@x.local`, password: 'nope-nope' });
        expect(bad.status).toBe(401);
        expect(ghost.status).toBe(401);
        expect(bad.body.message).toBe(ghost.body.message);
        void ownerEmail;
    });
});
