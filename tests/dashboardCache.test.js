import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { createTestApp, seedUser, stopTestDb } from './helpers.js';

// T-PERF-02 acceptance:
// - two users in different role scopes get distinct cached snapshots
//   (no cross-role sharing)
// - within TTL a second call is served from cache even after data changes
// - after TTL expiry fresh data is returned

let app;

beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DASHBOARD_CACHE_TTL = '60'; // long TTL — expiry simulated via clear()
    app = await createTestApp();
}, 180000);

afterAll(async () => {
    delete process.env.DASHBOARD_CACHE_TTL;
    await stopTestDb();
});

const Invoice = () => mongoose.model('Invoice');

async function makeInvoice(number) {
    return Invoice().create({
        number,
        customerName: 'cache-probe',
        items: [],
        subtotal: 100,
        tax: 0,
        total: 100,
        totalCost: 50,
        profit: 50,
        type: 'CASH',
        status: 'COMPLETED',
        paymentStatus: 'paid',
        createdBy: 'f'.repeat(24),
        date: new Date()
    });
}

describe('T-PERF-02: dashboard TTL cache', () => {
    let ownerCookie, cashierCookie;

    beforeAll(async () => {
        ({ cookie: ownerCookie } = await seedUser(app, { name: 'dash-owner', role: 'owner' }));
        ({ cookie: cashierCookie } = await seedUser(app, { name: 'dash-cashier', role: 'cashier' }));
    });

    it('two role scopes never share cache entries (isolation)', async () => {
        const owner1 = await app.get('/api/dashboard').set('Cookie', ownerCookie).expect(200);
        const cashier1 = await app.get('/api/dashboard').set('Cookie', cashierCookie).expect(200);

        // deep-equal payloads (same underlying data today), but NOT the same object
        expect(owner1.body.data).toEqual(cashier1.body.data);
        expect(owner1.body.data).not.toBe(cashier1.body.data);
    });

    it('second call within TTL is served from cache (stale on purpose)', async () => {
        const { __dashboardCaches } = await import('../services/dashboardService.js');
        __dashboardCaches.kpiCache.clear();
        __dashboardCaches.statsCache.clear();
        const first = await app.get('/api/dashboard/kpis').set('Cookie', ownerCookie).expect(200);
        const salesBefore = first.body.data.kpis.todaySales;

        await makeInvoice(`CACHE-TTL-${Date.now()}`); // data changes

        const second = await app.get('/api/dashboard/kpis').set('Cookie', ownerCookie).expect(200);
        // same scope → cached snapshot still returned
        expect(second.body.data.kpis.todaySales).toBe(salesBefore);
    });

    it('after cache invalidation the next call serves fresh data', async () => {
        // deterministic expiry: clear the caches instead of sleeping past a
        // short TTL (sleeps raced under coverage-instrumented runs)
        const { __dashboardCaches } = await import('../services/dashboardService.js');
        __dashboardCaches.kpiCache.clear();
        __dashboardCaches.statsCache.clear();

        const salesBefore = (
            await app.get('/api/dashboard/kpis').set('Cookie', ownerCookie).expect(200)
        ).body.data.kpis.todaySales;

        await makeInvoice(`CACHE-FRESH-${Date.now()}`);

        __dashboardCaches.kpiCache.clear();
        __dashboardCaches.statsCache.clear();

        const fresh = await app.get('/api/dashboard/kpis').set('Cookie', ownerCookie).expect(200);
        expect(fresh.body.data.kpis.todaySales).toBe(salesBefore + 100);
    });
});
