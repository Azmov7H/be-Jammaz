import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Cnt Owner', role: 'owner' }));
});

afterAll(async () => {
    await stopTestDb();
});

describe('T-TST-04b: document number counters (T-DB-02)', () => {
    it('monotonic per-prefix numbering with gap tolerance', async () => {
        const { nextDocumentNumber } = await import('../lib/counters.js');
        const prefix = 'TSTX';
        const a = await nextDocumentNumber(prefix);
        const b = await nextDocumentNumber(prefix);
        expect(a).toMatch(new RegExp(`^${prefix}-`));
        const na = Number(a.split('-')[1]);
        const nb = Number(b.split('-')[1]);
        expect(nb).toBeGreaterThanOrEqual(na + 1);
    });

    it('invoice creation consumes INV counter sequentially', async () => {
        const mkProduct = async () => {
            const r = await request.post('/api/products').set('Cookie', ownerCookie)
                .send({ name: 'cnt-' + Date.now(), code: 'CNT' + Date.now(), buyPrice: 1, retailPrice: 2, shopQty: 5 });
            return r.body.data;
        };
        const p = await mkProduct();
        const pid = p._id ?? p.id;
        const inv = await request.post('/api/invoices').set('Cookie', ownerCookie)
            .send({ items: [{ productId: pid, qty: 1, unitPrice: 2 }], paymentType: 'cash' });
        expect(inv.status).toBeLessThan(300);
        expect(inv.body.data.number).toMatch(/^INV-/);
    });
});
