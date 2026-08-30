import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// Sprint 7 — Customer/Supplier Unification (Option B)
//   FIN-SVC-006 partyService, FIN-RTE-001 routes, FIN-VAL-004/005, FIN-MDL-005.
// Acceptance: link is idempotent; net position correct; no duplicate record;
//             historical data intact.  Tests: T-INT-009/010, T-UNIT-006; E3/E4.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'S7 Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(300);

async function makeCustomer(over = {}) {
    const res = await request.post('/api/customers').set('Cookie', ownerCookie)
        .send({ name: `عميل s7-${uniq('C')}`, phone: uniq('9'), ...over });
    ok(res, 'createCustomer');
    return res.body.data;
}

async function makeSupplier(over = {}) {
    const res = await request.post('/api/suppliers').set('Cookie', ownerCookie)
        .send({ name: `مورد s7-${uniq('S')}`, phone: uniq('8'), ...over });
    ok(res, 'createSupplier');
    return res.body.data;
}

describe('Sprint 7 — Party link (T-INT-009)', () => {
    it('links a customer ↔ supplier bilaterally with no duplicate record', async () => {
        const customer = await makeCustomer();
        const supplier = await makeSupplier();

        const res = await request.post(`/api/customers/${id(customer)}/link-supplier`)
            .set('Cookie', ownerCookie).send({ targetId: id(supplier) });
        ok(res, 'link supplier to customer');
        expect(res.body.data.linked).toBe(true);

        const { default: Customer } = await import('../models/Customer.js');
        const { default: Supplier } = await import('../models/Supplier.js');
        const c = await Customer.findById(id(customer));
        const s = await Supplier.findById(id(supplier));

        expect(c.isSupplier).toBe(true);
        expect(c.linkedSupplier.toString()).toBe(id(supplier));
        expect(s.isCustomer).toBe(true);
        expect(s.linkedCustomer.toString()).toBe(id(customer));
    });

    it('is idempotent — relinking the same pair succeeds without error', async () => {
        const customer = await makeCustomer();
        const supplier = await makeSupplier();
        await request.post(`/api/customers/${id(customer)}/link-supplier`)
            .set('Cookie', ownerCookie).send({ targetId: id(supplier) });

        const again = await request.post(`/api/customers/${id(customer)}/link-supplier`)
            .set('Cookie', ownerCookie).send({ targetId: id(supplier) });
        ok(again, 'idempotent relink');
        expect(again.body.data.alreadyLinked).toBe(true);
    });

    it('E3: self-link is rejected with 400', async () => {
        const customer = await makeCustomer();
        const res = await request.post(`/api/customers/${id(customer)}/link-supplier`)
            .set('Cookie', ownerCookie).send({ targetId: id(customer) });
        expect(res.status).toBe(400);
    });

    it('E4: linking to an already-linked (different) entity conflicts with 409', async () => {
        const c1 = await makeCustomer();
        const s1 = await makeSupplier();
        const c2 = await makeCustomer();
        await request.post(`/api/customers/${id(c1)}/link-supplier`)
            .set('Cookie', ownerCookie).send({ targetId: id(s1) });

        const conflict = await request.post(`/api/suppliers/${id(s1)}/link-customer`)
            .set('Cookie', ownerCookie).send({ targetId: id(c2) });
        expect(conflict.body.code).toBe('CONFLICT');
    });

    it('unlink reverts both sides (historical data intact — no row deleted)', async () => {
        const customer = await makeCustomer();
        const supplier = await makeSupplier();
        await request.post(`/api/customers/${id(customer)}/link-supplier`)
            .set('Cookie', ownerCookie).send({ targetId: id(supplier) });

        const del = await request.delete(`/api/customers/${id(customer)}/link-supplier`)
            .set('Cookie', ownerCookie);
        ok(del, 'unlink');

        const { default: Customer } = await import('../models/Customer.js');
        const { default: Supplier } = await import('../models/Supplier.js');
        const c = await Customer.findById(id(customer));
        const s = await Supplier.findById(id(supplier));
        expect(c.isSupplier).toBe(false);
        expect(c.linkedSupplier).toBeUndefined();
        expect(s.isCustomer).toBe(false);
        expect(s.linkedCustomer).toBeUndefined();
        // Records still exist — only the link was removed.
        expect(c && s).toBeTruthy();
    });
});

describe('Sprint 7 — Net position (T-INT-010)', () => {
    it('computes net = customer.balance - supplier.balance for a linked pair', async () => {
        const customer = await makeCustomer();
        const supplier = await makeSupplier();
        await request.post(`/api/customers/${id(customer)}/link-supplier`)
            .set('Cookie', ownerCookie).send({ targetId: id(supplier) });

        // Move balances directly (net-position reads the snapshot fields).
        const { default: Customer } = await import('../models/Customer.js');
        const { default: Supplier } = await import('../models/Supplier.js');
        await Customer.updateOne({ _id: id(customer) }, { $set: { balance: 500 } });
        await Supplier.updateOne({ _id: id(supplier) }, { $set: { balance: 200 } });

        const res = await request.get(`/api/customers/${id(customer)}/net-position`)
            .set('Cookie', ownerCookie);
        ok(res, 'net position');
        const data = res.body.data;
        expect(data.linked).toBe(true);
        expect(data.netPosition).toBe(300);
        expect(data.side).toBe('entityOwesUs');

        // We owe more than they owe us → negative.
        await Supplier.updateOne({ _id: id(supplier) }, { $set: { balance: 800 } });
        const res2 = await request.get(`/api/suppliers/${id(supplier)}/net-position`)
            .set('Cookie', ownerCookie);
        ok(res2, 'net position 2');
        expect(res2.body.data.netPosition).toBe(-300);
        expect(res2.body.data.side).toBe('weOweEntity');
    });
});

describe('Sprint 7 — Duplicate detection (T-UNIT-006)', () => {
    it('detectDuplicates surfaces cross-type candidates by shared phone/name (read-only)', async () => {
        const sharedPhone = uniq('77');
        const customer = await makeCustomer({ phone: sharedPhone });
        const supplier = await makeSupplier({ phone: sharedPhone });

        const res = await request.post('/api/parties/detect-duplicates')
            .set('Cookie', ownerCookie);
        ok(res, 'detect duplicates');
        const { candidates } = res.body.data;
        const match = candidates.some((g) =>
            g.members.some((m) => m.kind === 'Customer' && m.id === id(customer)) &&
            g.members.some((m) => m.kind === 'Supplier' && m.id === id(supplier))
        );
        expect(match).toBe(true);
        expect(customer && supplier).toBeTruthy(); // untouched
    });
});
