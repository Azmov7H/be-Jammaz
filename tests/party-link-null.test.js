import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// T-DB-03b — explicit-null party links must not trip the sparse-unique index.
// Regression: the SECOND unlinked customer/supplier insert died with E11000
// ("linkedCustomer/linkedSupplier is already used") because clients sent
// `linkedX: null` and services persisted it verbatim.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'NullLink Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);

describe('T-DB-03b: null party links', () => {
    it('creates consecutive customers with linkedSupplier:null', async () => {
        for (const tag of ['N1', 'N2']) {
            const res = await request.post('/api/customers').set('Cookie', ownerCookie)
                .send({ name: `عميل null-${uniq(tag)}`, phone: uniq('9'), linkedSupplier: null });
            ok(res, `createCustomer ${tag}`);
            expect(res.body.data.linkedSupplier ?? null).toBeNull();
        }
    });

    it('creates consecutive suppliers with linkedCustomer:null', async () => {
        for (const tag of ['N1', 'N2']) {
            const res = await request.post('/api/suppliers').set('Cookie', ownerCookie)
                .send({ name: `مورد null-${uniq(tag)}`, phone: uniq('8'), linkedCustomer: null });
            ok(res, `createSupplier ${tag}`);
            expect(res.body.data.linkedCustomer ?? null).toBeNull();
        }
    });

    it('updates a supplier with linkedCustomer:null without conflict', async () => {
        const created = await request.post('/api/suppliers').set('Cookie', ownerCookie)
            .send({ name: `مورد upd-${uniq('U')}`, phone: uniq('8') });
        ok(created, 'createSupplier for update');
        const res = await request.put(`/api/suppliers/${created.body.data._id}`).set('Cookie', ownerCookie)
            .send({ name: created.body.data.name, linkedCustomer: null });
        ok(res, 'updateSupplier null link');
    });

    it('real links still work after null-link records exist', async () => {
        const c = await request.post('/api/customers').set('Cookie', ownerCookie)
            .send({ name: `عميل link-${uniq('L')}`, phone: uniq('9') });
        ok(c, 'createCustomer for link');
        const s = await request.post('/api/suppliers').set('Cookie', ownerCookie)
            .send({ name: `مورد link-${uniq('L')}`, phone: uniq('8') });
        ok(s, 'createSupplier for link');
        const link = await request.post(`/api/parties/link`)
            .set('Cookie', ownerCookie)
            .send({ sourceType: 'Customer', sourceId: c.body.data._id, targetId: s.body.data._id });
        ok(link, 'link customer↔supplier');
    });
});
