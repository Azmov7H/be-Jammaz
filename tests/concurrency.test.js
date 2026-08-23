import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, seedUser, stopTestDb } from './helpers.js';

// Sprint 04 acceptance (T-DB-05/06): atomic mutations under concurrency.
// 50 concurrent sales of stock=10 → exactly 10 succeed, final qty 0,
// ledger rows == successes.

let app;
let cookie;
const TEST_USER_ID = 'f'.repeat(24);
beforeAll(async () => {
    app = await createTestApp();
    ({ cookie } = await seedUser(app));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const Product = async () => (await import('../models/Product.js')).default;
const StockMovement = async () => (await import('../models/StockMovement.js')).default;

async function makeProduct({ shop = 10, warehouse = 0 } = {}) {
    const P = await Product();
    const suffix = Math.random().toString(36).slice(2);
    return await P.create({
        name: `Concurrent ${suffix}`, code: `C-${suffix}`,
        retailPrice: 5, buyPrice: 1,
        shopQty: shop, warehouseQty: warehouse, minLevel: 0,
    });
}

describe('T-DB-05: stock mutation atomicity', () => {
    it('50 concurrent reduceStockForSale of stock=10 → exactly 10 succeed', async () => {
        const product = await makeProduct();
        const { StockService } = await import('../services/stockService.js');

        const attempts = Array.from({ length: 50 }, (_, i) =>
            StockService.reduceStockForSale(
                [{ productId: product._id, qty: 1, source: 'shop' }],
                `test-inv-${i}`, TEST_USER_ID
            ).then(() => 'ok').catch((e) => { if (process.env.DEBUG_FAILS) console.error('ATTEMPT FAIL:', e.message); return e.message; })
        );
        const outcomes = await Promise.all(attempts);

        expect(outcomes.filter((o) => o === 'ok')).toHaveLength(10);

        const fresh = await (await Product()).findById(product._id).lean();
        expect(fresh.shopQty).toBe(0);
        expect(fresh.stockQty).toBe(0);

        const ledger = await (await StockMovement()).countDocuments({
            productId: product._id, type: 'SALE',
        });
        expect(ledger).toBe(10);
    });

    it('guarded transfer never overdraws', async () => {
        const product = await makeProduct({ shop: 3 });
        const { StockService } = await import('../services/stockService.js');

        const attempts = Array.from({ length: 20 }, () =>
            StockService.transferToWarehouse(product._id, 1, TEST_USER_ID)
                .then(() => 'ok').catch(() => 'fail')
        );
        const outcomes = await Promise.all(attempts);
        expect(outcomes.filter((o) => o === 'ok')).toHaveLength(3);

        const fresh = await (await Product()).findById(product._id).lean();
        expect(fresh.shopQty).toBe(0);
        expect(fresh.warehouseQty).toBe(3);
    });

    it('moveStock SALE path is guarded', async () => {
        const product = await makeProduct({ shop: 2 });
        const { StockService } = await import('../services/stockService.js');

        const outcomes = await Promise.all(Array.from({ length: 15 }, () =>
            StockService.moveStock({ productId: product._id, qty: 1, type: 'SALE', userId: TEST_USER_ID })
                .then(() => 'ok').catch(() => 'fail')
        ));
        expect(outcomes.filter((o) => o === 'ok')).toHaveLength(2);
    });
});
