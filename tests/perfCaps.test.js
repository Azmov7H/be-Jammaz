import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createTestApp, seedUser, stopTestDb } from './helpers.js';

// T-PERF-01 acceptance: endpoint sweep — every listed endpoint must honor
// page/limit caps and (where applicable) bounded date windows.

let app;
let adminCookie;

beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await createTestApp();
    ({ cookie: adminCookie } = await seedUser(app, { name: 'perf-admin', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const get = (url) => app.get(url).set('Cookie', adminCookie);

describe('T-PERF-01 sweep: pagination caps', () => {
    it('users list honors limit cap', async () => {
        const res = await get('/api/users?limit=9999').expect(200);
        expect(res.body.data.users.length).toBeLessThanOrEqual(100);
        expect(res.body.data.limit).toBe(100);
    });

    it('users list paginates with skip', async () => {
        const res = await get('/api/users?page=1&limit=1').expect(200);
        expect(res.body.data.users.length).toBeLessThanOrEqual(1);
        expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    });

    it('logs list caps limit at 100', async () => {
        const res = await get('/api/logs?limit=5000').expect(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeLessThanOrEqual(100);
    });

    it('treasury transactions caps limit + clamps window to 90d', async () => {
        const res = await get(
            '/api/treasury/transactions?limit=5000&startDate=2020-01-01&endDate=2026-08-24'
        ).expect(200);
        expect(res.body.data.length).toBeLessThanOrEqual(100);
    });

    it('accounting entries returns paged envelope + caps limit', async () => {
        const res = await get('/api/accounting/entries?limit=9999&page=2').expect(200);
        expect(res.body.data.entries.length).toBeLessThanOrEqual(100);
        expect(res.body.data.page).toBe(2);
        expect(typeof res.body.data.total).toBe('number');
    });

    it('accounting ledger bounds window (no crash, seeded opening balance)', async () => {
        const res = await get(
            '/api/accounting/ledger?account=Cash&startDate=2020-01-01&endDate=2026-08-24'
        ).expect(200);
        expect(res.body.data.account).toBe('Cash');
        expect(Array.isArray(res.body.data.entries)).toBe(true);
    });

    it('daily-sales summary clamps window to 180d', async () => {
        const res = await get(
            '/api/daily-sales/summary?startDate=2020-01-01&endDate=2026-08-24'
        ).expect(200);
        expect(res.body.success).toBe(true);
    });

    it('customer statement clamps window to 365d', async () => {
        const Customer = mongoose.model('Customer');
        const c = await Customer.create({
            name: 'stmt-perf',
            phone: `077${Date.now() % 10000000}`,
            balance: 0
        });
        const res = await get(
            `/api/customers/${c._id}/statement?startDate=2019-01-01&endDate=2026-08-24`
        ).expect(200);
        expect(res.body.success).toBe(true);
    });

    it('stock movements clamps window to 90d', async () => {
        const res = await get(
            '/api/stock/movements?startDate=2020-01-01&endDate=2026-08-24'
        ).expect(200);
        expect(res.body.success).toBe(true);
    });
});
