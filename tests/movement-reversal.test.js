import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

let request;
let ownerCookie;
let ownerUser;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie, user: ownerUser } = await seedUser(request, { name: 'Undo Owner', role: 'owner' }));
});

afterAll(async () => {
    await stopTestDb();
});

async function createWarehouse(overrides = {}) {
    const res = await request.post('/api/warehouses')
        .set('Cookie', ownerCookie)
        .send({
            name: `مخزن تراجع-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            code: `UNDO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ...overrides,
        });
    expect(res.status).toBeLessThan(300);
    return res.body.data;
}

async function createProduct(warehouseStocks = [], overrides = {}) {
    const { default: Product } = await import('../models/Product.js');
    return Product.create({
        name: `منتج تراجع-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        code: `UNDO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        buyPrice: 10,
        retailPrice: 20,
        warehouseQty: 0,
        shopQty: 0,
        warehouseStocks,
        ...overrides,
    });
}

async function freshProduct(id) {
    const { default: Product } = await import('../models/Product.js');
    return Product.findById(id).lean();
}

function slotOf(product, warehouseId) {
    return product.warehouseStocks?.find((s) => String(s.warehouseId) === String(warehouseId));
}

async function reverse(movementId) {
    return request.post(`/api/stock/movements/${movementId}/reverse`)
        .set('Cookie', ownerCookie)
        .send({});
}

describe('movement reversal service (undo transfer)', () => {
    it('undoes an inter-warehouse TRANSFER for both primary and non-primary sides', async () => {
        const { StockService } = await import('../services/stockService.js');
        const whA = await createWarehouse(); // source, non-primary slot
        const product = await createProduct(
            [{ warehouseId: whA._id, qty: 5 }],
            { warehouseQty: 8, shopQty: 2 } // primary warehouse 8; total 15
        );

        // whA(5) → primary: primary 8→13, slot 5→0, stockQty unchanged 15
        const moved = await StockService.bulkTransferBetweenWarehouses(
            [{ productId: product._id, qty: 4, note: 'دفعات' }],
            ownerUser._id, String(whA._id), null, 'نقل للرئيسي'
        );
        const original = moved.movements[0];
        expect(original.type).toBe('TRANSFER');

        const beforeProduct = await freshProduct(product._id);
        expect(beforeProduct.warehouseQty).toBe(12);
        expect(slotOf(beforeProduct, whA._id).qty).toBe(1);
        expect(beforeProduct.stockQty).toBe(15);

        // Undo
        const res = await reverse(original._id);
        expect(res.status).toBe(200);
        const { reversal } = res.body.data;
        expect(reversal.type).toBe('REVERSAL');
        expect(String(reversal.reverses)).toBe(String(original._id));

        const after = await freshProduct(product._id);
        expect(after.warehouseQty).toBe(8);          // back to primary 8
        expect(slotOf(after, whA._id).qty).toBe(5);  // and slot 5
        expect(after.shopQty).toBe(2);
        expect(after.stockQty).toBe(15);             // total conserved
    });

    it('undoes a primary→non-primary TRANSFER (null source means primary)', async () => {
        const { StockService } = await import('../services/stockService.js');
        const wh = await createWarehouse({ code: `DST-${Date.now()}` });
        const product = await createProduct([], { warehouseQty: 10, shopQty: 0 });

        const moved = await StockService.bulkTransferBetweenWarehouses(
            [{ productId: product._id, qty: 6 }],
            ownerUser._id, null, String(wh._id), ''
        );
        const original = moved.movements[0];
        const intermediate = await freshProduct(product._id);
        expect(intermediate.warehouseQty).toBe(4);
        expect(slotOf(intermediate, wh._id).qty).toBe(6);
        expect(intermediate.stockQty).toBe(10);

        const res = await reverse(original._id);
        expect(res.status).toBe(200);
        const after = await freshProduct(product._id);
        expect(after.warehouseQty).toBe(10);
        expect(slotOf(after, wh._id).qty).toBe(0);
        expect(after.stockQty).toBe(10);
    });

    it('undoes a TRANSFER_TO_SHOP (warehouse → shop returns shop → warehouse)', async () => {
        const wh = await createWarehouse({ code: `TS-${Date.now()}` });
        const product = await createProduct([], { warehouseQty: 7, shopQty: 3 });

        const res1 = await request.post('/api/stock/transfer')
            .set('Cookie', ownerCookie)
            .send({ productId: String(product._id), qty: 5, from: 'warehouse', to: 'shop' });
        expect(res1.status).toBe(200);
        const movement = res1.body.data.movement;
        let p = await freshProduct(product._id);
        expect(p.warehouseQty).toBe(2);
        expect(p.shopQty).toBe(8);

        const res2 = await reverse(movement._id);
        expect(res2.status).toBe(200);
        p = await freshProduct(product._id);
        expect(p.warehouseQty).toBe(7);
        expect(p.shopQty).toBe(3);
        expect(p.stockQty).toBe(10);
        const { default: StockMovement } = await import('../models/StockMovement.js');
        const rev = await StockMovement.findById(res2.body.data.reversal._id).lean();
        expect(rev.type).toBe('REVERSAL');
        expect(String(rev.reverses)).toBe(String(movement._id));
        // Source warehouse side is preserved on the context (null → primary).
        expect(rev.warehouseId ?? null).toBe(null);
    });

    it('undoes a TRANSFER_TO_SHOP from a non-primary warehouse slot', async () => {
        const wh = await createWarehouse({ code: `TNS-${Date.now()}` });
        const product = await createProduct([], { shopQty: 10 });

        const credit = await request.post('/api/stock/move')
            .set('Cookie', ownerCookie)
            .send({ productId: String(product._id), qty: 6, type: 'IN', warehouseId: String(wh._id) });
        expect(credit.status).toBe(200);
        let p = await freshProduct(product._id);
        expect(slotOf(p, wh._id).qty).toBe(6);
        expect(p.shopQty).toBe(10);
        expect(p.stockQty).toBe(16);

        const res1 = await request.post('/api/stock/transfer')
            .set('Cookie', ownerCookie)
            .send({
                productId: String(product._id), qty: 4,
                from: 'warehouse', to: 'shop',
                warehouseId: String(wh._id),
            });
        expect(res1.status).toBe(200);
        p = await freshProduct(product._id);
        expect(slotOf(p, wh._id).qty).toBe(2);
        expect(p.shopQty).toBe(14);
        expect(p.stockQty).toBe(16); // unchanged by the move

        const res2 = await reverse(res1.body.data.movement._id);
        expect(res2.status).toBe(200);
        p = await freshProduct(product._id);
        expect(slotOf(p, wh._id).qty).toBe(6);
        expect(p.shopQty).toBe(10);
        expect(p.stockQty).toBe(16);
    });

    it('undoes a TRANSFER_TO_WAREHOUSE (shop → warehouse returns warehouse → shop)', async () => {
        const wh = await createWarehouse({ code: `TW-${Date.now()}` });
        const product = await createProduct([], { warehouseQty: 5, shopQty: 5 });

        const res1 = await request.post('/api/stock/transfer')
            .set('Cookie', ownerCookie)
            .send({ productId: String(product._id), qty: 2, from: 'shop', to: 'warehouse' });
        expect(res1.status).toBe(200);
        let p = await freshProduct(product._id);
        expect(p.warehouseQty).toBe(7);
        expect(p.shopQty).toBe(3);

        const res2 = await reverse(res1.body.data.movement._id);
        expect(res2.status).toBe(200);
        p = await freshProduct(product._id);
        expect(p.warehouseQty).toBe(5);
        expect(p.shopQty).toBe(5);
        expect(p.stockQty).toBe(10);
    });

    it('undoes a TRANSFER_TO_WAREHOUSE into a non-primary slot', async () => {
        const wh = await createWarehouse({ code: `TWN-${Date.now()}` });
        const product = await createProduct([], { warehouseQty: 1, shopQty: 6 });

        const res1 = await request.post('/api/stock/transfer')
            .set('Cookie', ownerCookie)
            .send({
                productId: String(product._id), qty: 3,
                from: 'shop', to: 'warehouse',
                warehouseId: String(wh._id),
            });
        expect(res1.status).toBe(200);
        let p = await freshProduct(product._id);
        expect(slotOf(p, wh._id).qty).toBe(3);
        expect(p.shopQty).toBe(3);
        expect(p.stockQty).toBe(7); // 1 primary + 6 shop → total conserved

        const res2 = await reverse(res1.body.data.movement._id);
        expect(res2.status).toBe(200);
        p = await freshProduct(product._id);
        expect(slotOf(p, wh._id).qty).toBe(0);
        expect(p.shopQty).toBe(6);
        expect(p.stockQty).toBe(7);
    });

    it('refuses the undo when the destination has been moved onward (insufficient qty)', async () => {
        const { StockService } = await import('../services/stockService.js');
        const wh = await createWarehouse({ code: `FWD-${Date.now()}` });
        const product = await createProduct([], { warehouseQty: 10, shopQty: 0 });

        const moved = await StockService.bulkTransferBetweenWarehouses(
            [{ productId: product._id, qty: 6 }],
            ownerUser._id, null, String(wh._id), ''
        );

        // Later the whole amount is spent from the destination warehouse.
        await StockService.reduceStockForSale(
            [{ productId: product._id, qty: 6, source: 'warehouse', warehouseId: wh._id }],
            'inv-spend',
            ownerUser._id
        );

        const res = await reverse(moved.movements[0]._id);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        const after = await freshProduct(product._id);
        expect(after.warehouseQty).toBe(4); // original transfer stays — undo refused
        expect(slotOf(after, wh._id).qty).toBe(0);
    });

    it('refuses a second undo of the same movement (409) and non-transfer types (400)', async () => {
        const product = await createProduct([], { warehouseQty: 8, shopQty: 2 });
        const res1 = await request.post('/api/stock/transfer')
            .set('Cookie', ownerCookie)
            .send({ productId: String(product._id), qty: 2, from: 'shop', to: 'warehouse' });
        const movement = res1.body.data.movement;

        expect((await reverse(movement._id)).status).toBe(200);
        expect((await reverse(movement._id)).status).toBe(409);

        // Non-transfer types cannot be undone.
        const { default: StockMovement } = await import('../models/StockMovement.js');
        const inMovement = (await StockMovement.create([{
            productId: product._id,
            type: 'IN',
            qty: 3,
            createdBy: ownerUser._id,
        }]))[0];
        const res = await reverse(inMovement._id);
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('لا يمكن التراجع');
    });

    it('returns 404 for an unknown movement id and 400 without auth token', async () => {
        const res = await reverse('6a8b63173de3be26e93c0000');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');

        const noAuth = await request.post('/api/stock/movements/6a8b63173de3be26e93c0000/reverse').send({});
        expect([401, 403]).toContain(noAuth.status);
    });

    it('lists movements annotated with reversed state (reversal visible in the feed)', async () => {
        const product = await createProduct([], { warehouseQty: 4, shopQty: 3 });
        const res1 = await request.post('/api/stock/transfer')
            .set('Cookie', ownerCookie)
            .send({ productId: String(product._id), qty: 1, from: 'shop', to: 'warehouse' });
        expect(res1.status).toBe(200);
        const movement = res1.body.data.movement;
        expect((await reverse(movement._id)).status).toBe(200);

        const list = await request.get('/api/stock/movements?startDate=2020-01-01&endDate=2030-01-01')
            .set('Cookie', ownerCookie);
        expect(list.status).toBe(200);
        const rows = Array.isArray(list.body.data) ? list.body.data : list.body.data.movements;
        const originalRow = rows.find((m) => String(m._id) === String(movement._id));
        const reversalRow = rows.find((m) => m.type === 'REVERSAL' && m.type);
        expect(originalRow?.reversed).toBe(true);
        expect(originalRow?.reversalId).toBeTruthy();
        // reverses is populated on the reversal row ({_id, type, qty})
        expect(String(reversalRow.reverses._id)).toBe(String(movement._id));
    });
});

describe('reverse route authorization', () => {
    it('blocks a role without stock permissions (403)', async () => {
        const { cookie: cashierCookie } = await seedUser(request, { name: 'Cashier', role: 'cashier' });
        const res = await request.post('/api/stock/movements/6a8b63173de3be26e93c0000/reverse')
            .set('Cookie', cashierCookie)
            .send({});
        expect(res.status).toBe(403);
    });
});
