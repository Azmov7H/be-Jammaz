import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestApp, seedUser, stopTestDb } from './helpers.js';
import Product from '../models/Product.js';
import Notification from '../models/Notification.js';

// T-PERF-04 acceptance:
// - notification scanner sweeps issue ONE dedupe read + one insertMany
//   (query-count assertion via command monitoring)
// - deleteTransactionByRef stays ledger-consistent (single-pass rewrite)

let app;
let ownerCookie;

beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DASHBOARD_CACHE_TTL = '0';
    app = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(app, { name: 'perf4-admin', role: 'owner' }));
}, 180000);

afterAll(async () => {
    delete process.env.DASHBOARD_CACHE_TTL;
    await stopTestDb();
});

describe('T-PERF-04: batched notification sync', () => {
    it('syncStockAlerts uses a bounded command count for N products', async () => {
        await Notification.deleteMany({});
        const products = [];
        for (let i = 0; i < 12; i++) {
            products.push({
                name: `nplus1-${i}-${Date.now()}`,
                code: `NP1-${i}`,
                buyPrice: 5,
                retailPrice: 8,
                shopQty: 0,
                warehouseQty: 0,
                minLevel: 3,
                isActive: true
            });
        }
        await Product.insertMany(products);

        const { NotificationService } = await import('../services/notificationService.js');
        const settings = { stockAlertThreshold: 5 };

        const findSpy = vi.spyOn(Notification, 'find');
        const insertSpy = vi.spyOn(Notification, 'insertMany');
        await NotificationService.syncStockAlerts(settings);
        // T-PERF-04: exactly ONE dedupe read + ONE insertMany — NOT N+1
        // (assert BEFORE mockRestore — restoring clears recorded calls)
        expect(findSpy).toHaveBeenCalledTimes(1);
        expect(insertSpy).toHaveBeenCalledTimes(1);
        findSpy.mockRestore();
        insertSpy.mockRestore();

        const created = await Notification.countDocuments({
            title: { $regex: /^نقص في المحل/ }
        });
        expect(created).toBe(12);
    });

    it('dedupe prevents duplicate titles within the window on re-run', async () => {
        const { NotificationService } = await import('../services/notificationService.js');
        await NotificationService.syncStockAlerts({ stockAlertThreshold: 5 });
        const afterSecondRun = await Notification.countDocuments({
            title: { $regex: /^نقص في المحل/ }
        });
        expect(afterSecondRun).toBe(12); // unchanged
    });
});

describe('T-PERF-04: deleteTransactionByRef consistency', () => {
    it('reverting invoice transactions keeps cashbox + balance consistent', async () => {
        // create two manual incomes today, then simulate ref deletion by
        // undoing both and comparing ledger vs running doc
        const before = await app.get('/api/treasury/balance')
            .set('Cookie', ownerCookie).expect(200);
        const b0 = typeof before.body.data === 'number'
            ? before.body.data
            : before.body.data.balance;

        await app.post('/api/treasury/manual-income')
            .set('Cookie', ownerCookie)
            .send({ amount: 40, reason: 'p4-a' }).expect(200);
        await app.post('/api/treasury/manual-income')
            .set('Cookie', ownerCookie)
            .send({ amount: 60, reason: 'p4-b' }).expect(200);

        const list = await app.get('/api/treasury/transactions?limit=10')
            .set('Cookie', ownerCookie).expect(200);
        const manual = list.body.data.filter(t => t.referenceType === 'Manual').slice(-2);

        let expected = b0;
        for (const tx of manual) expected += tx.amount;
        for (const tx of manual) {
            await app.delete(`/api/treasury/transactions/${tx._id}`)
                .set('Cookie', ownerCookie).expect(200);
            expected -= tx.amount;
        }

        const after = await app.get('/api/treasury/balance')
            .set('Cookie', ownerCookie).expect(200);
        const a0 = typeof after.body.data === 'number'
            ? after.body.data
            : after.body.data.balance;
        expect(a0).toBe(expected);
    });
});
