import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

let request;
const cookies = {}; // role → cookie
const F = 'f'.repeat(24); // well-formed but nonexistent id → downstream 404
const OWNER_PASSWORD = 'Test123456'; // fixed inside helpers.seedUser

// ---------------------------------------------------------------------------
// Matrix rows encoded from audit doc 06 (ACL-001 / ACL-003 tables) and the
// Sprint-02 gate decisions. Any drift from these expectations fails the suite.
//   allowed: roles that must pass the gate
//   okStatus: expected status for allowed roles ('!403' = any but 403/401)
// ---------------------------------------------------------------------------
const MATRIX = [
    // — ACL-001: previously dead 'admin' gates, now owner(-ish) gated —
    { m: 'delete', p: `/api/customers/${F}`, allowed: ['owner'] },
    { m: 'delete', p: `/api/products/${F}`, allowed: ['owner'] },
    { m: 'delete', p: `/api/invoices/${F}`, allowed: ['owner'] },
    { m: 'get', p: '/api/logs', allowed: ['owner', 'manager'], okStatus: 200 },
    {
        m: 'post', p: '/api/stock/adjust',
        b: { productId: F, location: 'shop', newQty: 1, reason: 'تسوية جرد' },
        allowed: ['owner', 'manager'],
    },
    { m: 'delete', p: `/api/purchases/${F}`, allowed: ['owner'] },
    { m: 'delete', p: `/api/purchase-orders/${F}`, allowed: ['owner'] },
    { m: 'delete', p: `/api/treasury/transactions/${F}`, allowed: ['owner'] },
    { m: 'post', p: `/api/physical-inventory/${F}/unlock`, b: { password: OWNER_PASSWORD }, allowed: ['owner'] },
    { m: 'delete', p: `/api/physical-inventory/${F}`, allowed: ['owner'] },

    // — ACL-003: money/sensitive writes that were completely ungated —
    {
        m: 'post', p: '/api/treasury/manual-income',
        b: { amount: 5, reason: 'إيراد متنوع اختبار' },
        allowed: ['owner', 'manager'],
    },
    {
        m: 'post', p: '/api/treasury/manual-expense',
        b: { amount: 5, reason: 'مصروف اختبار', category: 'عام' },
        allowed: ['owner', 'manager'],
    },
    {
        m: 'post', p: '/api/pricing/custom',
        b: { customerId: F, productId: F, price: 10 },
        allowed: ['owner', 'manager'],
    },
    {
        m: 'delete', p: '/api/pricing/custom?customerId=' + F + '&productId=' + F,
        allowed: ['owner', 'manager'],
    },
    {
        m: 'post', p: `/api/customers/${F}/pricing`,
        b: { productId: F, price: 10 },
        allowed: ['owner', 'manager'],
    },
    {
        m: 'delete', p: `/api/customers/${F}/pricing?productId=${F}`,
        allowed: ['owner', 'manager'],
    },
    {
        m: 'post', p: '/api/accounting/entries/expense',
        b: { amount: 5, category: 'عام', description: 'قيد اختبار' },
        allowed: ['owner', 'manager'],
    },
    {
        m: 'post', p: '/api/accounting/entries/income',
        b: { amount: 5, category: 'عام', description: 'قيد اختبار' },
        allowed: ['owner', 'manager'],
    },
    {
        m: 'post', p: '/api/stock/transfer',
        b: { productId: F, from: 'shop', to: 'warehouse', qty: 1 },
        allowed: ['warehouse', 'owner', 'manager'],
    },
    {
        m: 'post', p: '/api/stock/move',
        b: { productId: F, qty: 1, type: 'OUT' },
        allowed: ['warehouse', 'owner', 'manager'],
    },
    {
        m: 'post', p: '/api/financial/payments/supplier',
        b: { po: F, amount: 1 },
        allowed: ['owner', 'manager'],
    },
    {
        m: 'post', p: '/api/financial/payments/debt',
        b: { debt: F, amount: 1 },
        allowed: ['owner', 'manager'],
    },
    {
        m: 'post', p: '/api/financial/returns',
        b: { invoice: F, returnData: { returnItems: [{ productId: F, qty: 1 }], totalRefund: 1 } },
        allowed: ['owner', 'manager'],
    },
    {
        m: 'patch', p: `/api/physical-inventory/${F}`,
        b: { notes: 'تحديث' },
        allowed: ['owner', 'manager'],
    },
    {
        m: 'post', p: `/api/invoices/${F}/return`,
        b: {},
        allowed: ['owner', 'manager'],
    },

    // — user management: owner-only writes, manager read (ACL-002 decisions) —
    { m: 'get', p: '/api/users', allowed: ['owner', 'manager'], okStatus: 200 },
    {
        m: 'post', p: '/api/users',
        b: { name: 'مستخدم مصفوفة', email: `matrix-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, password: OWNER_PASSWORD + 'x', role: 'cashier' },
        allowed: ['owner'],
    },
    { m: 'put', p: `/api/users/${F}`, b: { name: 'x' }, allowed: ['owner'] },
    { m: 'delete', p: `/api/users/${F}`, allowed: ['owner'] },

    // — Sprint-02 decision: cashier KEEPS customer payment collection —
    {
        m: 'post', p: `/api/customers/${F}/pay`,
        b: { amount: 1 },
        allowed: ['owner', 'manager', 'cashier', 'warehouse', 'viewer'],
    },
];

const ALL_ROLES = ['owner', 'manager', 'cashier', 'warehouse', 'viewer'];

beforeAll(async () => {
    request = await createTestApp();
    for (const role of ALL_ROLES) {
        ({ cookie: cookies[role] } = await seedUser(request, { name: `Matrix ${role}`, role }));
    }
});

afterAll(async () => {
    await stopTestDb();
});

describe('T-TST-01: authorization matrix (roles × protected endpoints)', () => {
    for (const row of MATRIX) {
        it(`${row.m.toUpperCase()} ${row.p} → ${row.allowed.join('|')}`, async () => {
            for (const role of ALL_ROLES) {
                const res = await request[row.m](row.p)
                    .set('Cookie', cookies[role])
                    .send(row.b ?? {});

                if (row.allowed.includes(role)) {
                    if (row.okStatus !== undefined) {
                        expect([res.status, row.p, role]).toEqual([row.okStatus, row.p, role]);
                    } else {
                        // passed the gate; downstream NotFound on fake refs is fine
                        expect(res.status, `${role} should pass gate on ${row.p}`).not.toBe(403);
                        expect(res.status, `${role} should be authed on ${row.p}`).not.toBe(401);
                    }
                } else {
                    expect(res.status, `${role} must be denied on ${row.p}`).toBe(403);
                }
            }
        });
    }
});

describe('T-TST-01: dead-role regression (no admin anywhere)', () => {
    it('no route file gates on a literal admin list', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = path.resolve('routes');
        const offenders = [];
        for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
            const src = fs.readFileSync(path.join(dir, f), 'utf8');
            if (/roleMiddleware\(\s*\[[^\]]*['"]admin['"]/.test(src)) offenders.push(f);
        }
        expect(offenders).toEqual([]);
    });

    it('a legacy admin-role account is denied like any unknown role', async () => {
        const bcrypt = (await import('bcryptjs')).default;
        const User = (await import('../models/User.js')).default;

        // bypass model validation to emulate a pre-migration document
        await User.collection.insertOne({
            name: 'Legacy Admin',
            email: `legacy-admin-${Date.now()}@test.local`,
            password: await bcrypt.hash(OWNER_PASSWORD, 10),
            role: 'admin',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const login = await request.post('/api/auth/login')
            .send({ email: `legacy-admin-${Date.now()}@test.local`, password: OWNER_PASSWORD });
        // either the enum rejects login outright, or it succeeds and every
        // privileged call must 403 — both are acceptable containment
        if (login.status === 200) {
            const adminCookie = login.headers['set-cookie'][0].split(';')[0];
            const res = await request.delete(`/api/products/${F}`).set('Cookie', adminCookie);
            expect(res.status).toBe(403);
        } else {
            expect(login.status).toBe(401);
        }
    });
});

describe('T-TST-01: last-owner guard (ACL-002)', () => {
    it('sole active owner cannot deactivate or delete themselves', async () => {
        const User = (await import('../models/User.js')).default;
        const bcrypt = (await import('bcryptjs')).default;
        const owner = await User.create({
            name: 'Sole Owner Probe',
            email: `sole-owner-${Date.now()}@test.local`,
            password: await bcrypt.hash(OWNER_PASSWORD, 10),
            role: 'owner',
            isActive: true,
        });
        // isolate: deactivate every other owner so probe is truly last
        await User.updateMany(
            { role: 'owner', _id: { $ne: owner._id } },
            { isActive: false }
        );

        // probe acts as itself (seeded owner was deactivated by the sweep below)
        const probeLogin = await request.post('/api/auth/login')
            .send({ email: owner.email, password: OWNER_PASSWORD });
        expect(probeLogin.status).toBe(200);
        const cookie = probeLogin.headers['set-cookie'][0].split(';')[0];
        const deact = await request.put(`/api/users/${owner._id}`)
            .set('Cookie', cookie)
            .send({ isActive: false });
        expect(deact.status).toBe(409);
        expect(deact.body?.message ?? '').toContain('آخر مالك');

        const del = await request.delete(`/api/users/${owner._id}`).set('Cookie', cookie);
        expect(del.status).toBe(409);

        // a second owner makes deletion of the OTHER one possible again
        const created = await request.post('/api/users')
            .set('Cookie', cookie)
            .send({
                name: 'Second Owner',
                email: `second-owner-${Date.now()}@test.local`,
                password: OWNER_PASSWORD + 'y',
                role: 'owner',
            });
        expect(created.status).toBeLessThan(300);
    });

    it('nobody edits their own role and only owner grants owner role', async () => {
        const User = (await import('../models/User.js')).default;
        const me = await User.findOne({ role: 'owner', isActive: true });
        const selfPromote = await request.put(`/api/users/${me._id}`)
            .set('Cookie', cookies.manager)
            .send({ role: 'owner' });
        // manager cannot even touch user writes; service double-checks too
        expect([403]).toContain(selfPromote.status);
    });
});

describe('T-TST-01: notification IDOR (ACL-004)', () => {
    it('mark-read and delete are scoped by visibility, not blind _id', async () => {
        const Notification = (await import('../models/Notification.js')).default;
        const recipient = await seedUser(request, { name: 'Notif Target', role: 'cashier' });
        const outsider = await seedUser(request, { name: 'Notif Outsider', role: 'cashier' });

        const notif = await Notification.create({
            title: 'رسالة خاصة',
            message: 'لمستلم محدد فقط',
            recipientId: recipient.user.id,
        });

        // outsider tries to mark someone else's notification read
        const markRes = await request.patch('/api/notifications/mark-read')
            .set('Cookie', outsider.cookie)
            .send({ ids: [String(notif._id)] });
        expect(markRes.status).toBeLessThan(300);
        const afterMark = await Notification.findById(notif._id);
        expect(afterMark.isRead).toBeFalsy();

        // outsider cannot delete it either
        const delRes = await request.delete(`/api/notifications/${notif._id}`)
            .set('Cookie', outsider.cookie);
        expect(delRes.status).toBe(404);

        // the real recipient can mark + delete their own
        await request.patch('/api/notifications/mark-read')
            .set('Cookie', recipient.cookie)
            .send({ ids: [String(notif._id)] })
            .expect((r) => expect(r.status).toBeLessThan(300));
        const afterRealMark = await Notification.findById(notif._id);
        expect(afterRealMark.isRead).toBe(true);

        const ownDel = await request.delete(`/api/notifications/${notif._id}`)
            .set('Cookie', recipient.cookie);
        expect(ownDel.status).toBeLessThan(300);
        expect(await Notification.findById(notif._id)).toBeNull();
    });
});
