import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, seedUser, stopTestDb } from './helpers.js';

// Sprint 02 acceptance: authorization matrix (roles × representative endpoints).
// Rows assert GATE outcomes only — deeper business flows are Sprint 05/08 scope.

let app;
beforeAll(async () => {
    app = await createTestApp();
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

async function login(app, role) {
    const { cookie } = await seedUser(app, { role });
    return cookie;
}

describe('matrix: authentication boundary', () => {
    it('no token → 401 on protected surface', async () => {
        await app.get('/api/users').expect(401);
    });

    it('garbage token → 401', async () => {
        await app.get('/api/users').set('Cookie', 'token=garbage').expect(401);
    });
});

describe('matrix: /api/users (T-ACL-01)', () => {
    it('cashier read → 403', async () => {
        const cookie = await login(app, 'cashier');
        await app.get('/api/users').set('Cookie', cookie).expect(403);
    });

    it('manager read → 200', async () => {
        const cookie = await login(app, 'manager');
        await app.get('/api/users').set('Cookie', cookie).expect(200);
    });

    it('manager cannot create users (privesc closed)', async () => {
        const cookie = await login(app, 'manager');
        await app.post('/api/users')
            .set('Cookie', cookie)
            .send({ name: 'X', email: 'x@test.local', password: 'Secret123', role: 'owner' })
            .expect(403);
    });

    it('manager cannot delete users', async () => {
        const cookie = await login(app, 'manager');
        await app.delete('/api/users/000000000000000000000000')
            .set('Cookie', cookie).expect(403);
    });

    it('owner cannot delete own account (self-delete blocked)', async () => {
        const { user, cookie } = await seedUser(app);
        const res = await app.delete(`/api/users/${user.id}`)
            .set('Cookie', cookie).expect(409);
        expect(res.body.code).toBe('CONFLICT');
    });

    it('sole owner cannot deactivate themselves (last-owner guard)', async () => {
        // Isolate: wipe users so exactly one owner exists.
        const User = (await import('../models/User.js')).default;
        await User.deleteMany({});
        const { user, cookie } = await seedUser(app);

        const res = await app.put(`/api/users/${user.id}`)
            .set('Cookie', cookie)
            .send({ isActive: false })
            .expect(409);
        expect(res.body.code).toBe('CONFLICT');
    });

    it('deleted user session → 401 (not 404 pass-through)', async () => {
        const { user, cookie } = await seedUser(app);
        const User = (await import('../models/User.js')).default;
        await User.findByIdAndDelete(user.id);
        await app.get('/api/users').set('Cookie', cookie).expect(401);
    });

    it('disabled account login is indistinguishable from bad credentials', async () => {
        const bcrypt = (await import('bcryptjs')).default;
        const User = (await import('../models/User.js')).default;
        await User.create({
            name: 'Disabled', email: `dis-${Date.now()}@test.local`,
            password: await bcrypt.hash('Secret123', 10), role: 'cashier', isActive: false,
        });
        const disabled = await app.post('/api/auth/login')
            .send({ email: (await User.findOne({ name: 'Disabled' })).email, password: 'Secret123' })
            .expect(401);
        const unknown = await app.post('/api/auth/login')
            .send({ email: 'nobody@nowhere.io', password: 'Whatever1' })
            .expect(401);
        expect(disabled.body.message).toBe(unknown.body.message);
        expect(disabled.body.status).toBeUndefined();
    });
});

describe('matrix: money-touching writes (T-ACL-02)', () => {
    const cases = [
        ['cashier', 'POST', '/api/financial/payments/unified'],
        ['cashier', 'POST', '/api/financial/payments/supplier'],
        ['cashier', 'POST', '/api/financial/payments'],
        ['cashier', 'POST', '/api/financial/expenses'],
        ['cashier', 'POST', '/api/treasury/manual-income'],
        ['cashier', 'POST', '/api/treasury/manual-expense'],
        ['cashier', 'POST', '/api/pricing/custom'],
        ['cashier', 'DELETE', '/api/pricing/custom'],
        ['cashier', 'POST', '/api/accounting/entries/expense'],
        ['cashier', 'POST', '/api/accounting/entries/income'],
        ['cashier', 'POST', '/api/invoices/000000000000000000000000/return'],
        ['warehouse', 'POST', '/api/stock/adjust'],
    ];
    for (const [role, method, url] of cases) {
        it(`${role} ${method} ${url} → 403`, async () => {
            const cookie = await login(app, role);
            const res = await app[method.toLowerCase()](url)
                .set('Cookie', cookie)
                .send({})
                .expect(403);
            expect(res.body.success).toBe(false);
        });
    }

    it('warehouse may stock transfer (gate passes; bad body → 400 not 403)', async () => {
        const cookie = await login(app, 'warehouse');
        await app.post('/api/stock/transfer').set('Cookie', cookie).send({}).expect((r) => {
            if (r.status === 403) throw new Error('warehouse wrongly denied');
            if (![400, 404, 500].includes(r.status)) {
                throw new Error(`unexpected status ${r.status}`);
            }
        });
    });
});

describe('matrix: token lifecycle (T-AUTH-02)', () => {
    function getRefreshCookie(res) {
        const raw = res.headers['set-cookie'].find((c) => c.startsWith('refresh='));
        return raw.split(';')[0];
    }

    it('full rotation & reuse-detection flow', async () => {
        const bcrypt = (await import('bcryptjs')).default;
        const User = (await import('../models/User.js')).default;
        const email = `rot-${Date.now()}@test.local`;
        await User.create({
            name: 'Rot', email,
            password: await bcrypt.hash('Secret123', 10), role: 'viewer',
        });

        const loginRes = await app.post('/api/auth/login')
            .send({ email, password: 'Secret123' }).expect(200);
        const r1 = getRefreshCookie(loginRes);

        // Rotate #1 → success, issues new refresh
        const rot1 = await app.post('/api/auth/refresh')
            .set('Cookie', r1).expect(200);
        const r2 = getRefreshCookie(rot1);

        // Replay old token → reuse detection → 401 AND family revoked
        await app.post('/api/auth/refresh').set('Cookie', r1).expect(401);

        // Even the newest rotated token is now dead
        await app.post('/api/auth/refresh').set('Cookie', r2).expect(401);
    });

    it('logout revokes refresh family', async () => {
        const bcrypt = (await import('bcryptjs')).default;
        const User = (await import('../models/User.js')).default;
        const email = `lo-${Date.now()}@test.local`;
        await User.create({
            name: 'Lo', email,
            password: await bcrypt.hash('Secret123', 10), role: 'viewer',
        });

        const loginRes = await app.post('/api/auth/login')
            .send({ email, password: 'Secret123' }).expect(200);
        const access = loginRes.headers['set-cookie'].find((c) => c.startsWith('token=')).split(';')[0];
        const r = getRefreshCookie(loginRes);

        await app.post('/api/auth/logout').set('Cookie', access).expect(200);

        await app.post('/api/auth/refresh').set('Cookie', r).expect(401);
    });
});
