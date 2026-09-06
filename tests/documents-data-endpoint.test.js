import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// DOC-DATA-001 — JSON read model for document preview tables.
//
// Regression: the frontend's getDocumentData() fetched
// GET /api/documents/:type/:id expecting JSON, but that route serves
// preview HTML — the JSON parser failed and every document tab showed
// "Invalid JSON response from server". The shaped DocumentData now
// lives under GET /:type/:id/data (and /:type/data for aggregates).

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Doc Data Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;

async function createCustomer(overrides = {}) {
    const res = await request.post('/api/customers').set('Cookie', ownerCookie).send({
        name: `عميل doc-${uniq('X')}`,
        phone: uniq('079'),
        priceType: 'retail',
        ...overrides,
    });
    expect(res.status).toBeLessThan(300);
    return res.body.data;
}

function range() {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    return { from, to };
}

describe('Document JSON data endpoints', () => {
    it('GET /:type/:id/data returns JSON (not HTML) for CUSTOMER_TRANSACTION_STATEMENT', async () => {
        const customer = await createCustomer();
        const { from, to } = range();
        const res = await request
            .get(`/api/documents/CUSTOMER_TRANSACTION_STATEMENT/${customer._id}/data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.lines)).toBe(true);
        expect(res.body.data.totals).toBeDefined();
    });

    it('GET /:type/:id/data returns JSON for CUSTOMER_ACCOUNT_STATEMENT', async () => {
        const customer = await createCustomer();
        const { from, to } = range();
        const res = await request
            .get(`/api/documents/CUSTOMER_ACCOUNT_STATEMENT/${customer._id}/data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body.success).toBe(true);
    });

    it('rejects a non-ObjectId with 404 JSON (never HTML)', async () => {
        const res = await request
            .get('/api/documents/CUSTOMER_TRANSACTION_STATEMENT/not-an-id/data')
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
    });
});
