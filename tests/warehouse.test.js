import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

let request;
let ownerCookie;
let ownerUser;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie, user: ownerUser } = await seedUser(request, { name: 'WH Owner', role: 'owner' }));
});

afterAll(async () => {
    await stopTestDb();
});

async function createWarehouse(overrides = {}) {
    const res = await request.post('/api/warehouses')
        .set('Cookie', ownerCookie)
        .send({
            name: `مخزن-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            code: `WH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ...overrides,
        });
    expect(res.status).toBeLessThan(300);
    return res.body.data;
}

async function createProduct(warehouseStocks = [], overrides = {}) {
    const { default: Product } = await import('../models/Product.js');
    return Product.create({
        name: `منتج مخازن-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        code: `PRD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        buyPrice: 10,
        retailPrice: 20,
        warehouseQty: 0,
        shopQty: 0,
        warehouseStocks,
        ...overrides,
    });
}

describe('WH-01: primary warehouse bootstrap', () => {
    it('ensures exactly one primary warehouse (idempotent)', async () => {
        const { WarehouseService } = await import('../services/warehouseService.js');
        const { default: Warehouse } = await import('../models/Warehouse.js');

        const first = await WarehouseService.ensurePrimaryWarehouse();
        const second = await WarehouseService.ensurePrimaryWarehouse();

        expect(String(first._id)).toBe(String(second._id));
        const primaries = await Warehouse.countDocuments({ isPrimary: true });
        expect(primaries).toBe(1);
    });

    it('rejects creating a second primary through the API (forced non-primary)', async () => {
        const wh = await createWarehouse({ isPrimary: true, code: `NOTP-${Date.now()}` });
        expect(wh.isPrimary).toBe(false);
    });
});

describe('WH-03: warehouse CRUD', () => {
    it('creates, lists and updates a warehouse', async () => {
        const created = await createWarehouse({ name: 'مخزن فرع', code: `BR-${Date.now()}` });
        expect(created._id).toBeTruthy();

        const list = await request.get('/api/warehouses?limit=100').set('Cookie', ownerCookie);
        expect(list.status).toBe(200);
        expect(list.body.data.warehouses.some((w) => w._id === created._id)).toBe(true);

        const updated = await request.put(`/api/warehouses/${created._id}`)
            .set('Cookie', ownerCookie)
            .send({ name: 'مخزن فرع محدَّث', address: 'شارع رئيسي' });
        expect(updated.status).toBe(200);
        expect(updated.body.data.name).toBe('مخزن فرع محدَّث');
    });

    it('cannot deactivate the primary warehouse', async () => {
        const { WarehouseService } = await import('../services/warehouseService.js');
        const primary = await WarehouseService.ensurePrimaryWarehouse();
        const res = await request.put(`/api/warehouses/${primary._id}`)
            .set('Cookie', ownerCookie)
            .send({ isActive: false });
        expect(res.status).toBe(403);
    });
});

describe('WH-04: deletion guards', () => {
    it('refuses to delete the primary warehouse', async () => {
        const { WarehouseService } = await import('../services/warehouseService.js');
        const primary = await WarehouseService.ensurePrimaryWarehouse();
        const res = await request.delete(`/api/warehouses/${primary._id}`)
            .set('Cookie', ownerCookie)
            .send({});
        expect(res.status).toBe(403);
    });

    it('deletes an empty warehouse without a destination', async () => {
        const wh = await createWarehouse({ code: `EMPTY-${Date.now()}` });
        const res = await request.delete(`/api/warehouses/${wh._id}`)
            .set('Cookie', ownerCookie)
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.data.deleted).toBe(true);
    });

    it('requires a destination when the warehouse holds stock', async () => {
        const wh = await createWarehouse({ code: `STK-${Date.now()}` });
        await createProduct([{ warehouseId: wh._id, qty: 7 }]);

        const res = await request.delete(`/api/warehouses/${wh._id}`)
            .set('Cookie', ownerCookie)
            .send({});
        expect(res.status).toBe(409);
        expect(res.body.details?.requiresDestination).toBe(true);
        expect(res.body.details?.totalUnits).toBe(7);
    });

    it('requires explicit confirmation even with a destination', async () => {
        const { WarehouseService } = await import('../services/warehouseService.js');
        const primary = await WarehouseService.ensurePrimaryWarehouse();
        const wh = await createWarehouse({ code: `CNF-${Date.now()}` });
        await createProduct([{ warehouseId: wh._id, qty: 5 }]);

        const res = await request.delete(`/api/warehouses/${wh._id}`)
            .set('Cookie', ownerCookie)
            .send({ destinationWarehouseId: String(primary._id) });
        expect(res.status).toBe(409);
        expect(res.body.details?.requiresConfirmation).toBe(true);
    });

    it('relocates stock to the primary and conserves stockQty', async () => {
        const { WarehouseService } = await import('../services/warehouseService.js');
        const primary = await WarehouseService.ensurePrimaryWarehouse();
        const wh = await createWarehouse({ code: `REL-${Date.now()}` });

        const product = await createProduct(
            [{ warehouseId: wh._id, qty: 7 }],
            { warehouseQty: 3, shopQty: 2 }
        );
        expect(product.stockQty).toBe(12);

        const before = await request.get(`/api/warehouses/${wh._id}/deletion-preflight`).set('Cookie', ownerCookie);
        expect(before.status).toBe(200);
        expect(before.body.data.totalUnits).toBe(7);
        expect(before.body.data.availableDestinations.some((d) => String(d._id) === String(primary._id))).toBe(true);

        const res = await request.delete(`/api/warehouses/${wh._id}`)
            .set('Cookie', ownerCookie)
            .send({ destinationWarehouseId: String(primary._id), confirmed: true });
        expect(res.status).toBe(200);
        expect(res.body.data.relocatedUnits).toBe(7);

        const { default: Product } = await import('../models/Product.js');
        const { default: Warehouse } = await import('../models/Warehouse.js');
        const { default: StockMovement } = await import('../models/StockMovement.js');

        const fresh = await Product.findById(product._id);
        expect(fresh.warehouseQty).toBe(10); // 3 + 7 relocated
        expect(fresh.stockQty).toBe(12); // conserved
        expect(fresh.warehouseStocks.some((s) => String(s.warehouseId) === String(wh._id))).toBe(false);

        expect(await Warehouse.findById(wh._id)).toBeNull();
        const movement = await StockMovement.findOne({ productId: product._id, type: 'TRANSFER' });
        expect(movement).toBeTruthy();
        expect(movement.qty).toBe(7);
    });

    it('relocates stock to another non-primary warehouse', async () => {
        const wh = await createWarehouse({ code: `SRC-${Date.now()}` });
        const dest = await createWarehouse({ code: `DST-${Date.now()}` });
        const product = await createProduct([{ warehouseId: wh._id, qty: 4 }]);

        const res = await request.delete(`/api/warehouses/${wh._id}`)
            .set('Cookie', ownerCookie)
            .send({ destinationWarehouseId: String(dest._id), confirmed: true });
        expect(res.status).toBe(200);

        const { default: Product } = await import('../models/Product.js');
        const fresh = await Product.findById(product._id);
        const destSlot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(dest._id));
        expect(destSlot.qty).toBe(4);
        expect(fresh.warehouseStocks.some((s) => String(s.warehouseId) === String(wh._id))).toBe(false);
        expect(fresh.stockQty).toBe(4);
    });
});

describe('WH-05: warehouse-aware stock operations', () => {
    it('reduces stock from a non-primary warehouse slot on sale (guarded)', async () => {
        const { WarehouseService } = await import('../services/warehouseService.js');
        const { StockService } = await import('../services/stockService.js');
        const { default: Product } = await import('../models/Product.js');
        await WarehouseService.ensurePrimaryWarehouse();

        const wh = await createWarehouse({ code: `SALE-${Date.now()}` });
        const product = await createProduct(
            [{ warehouseId: wh._id, qty: 10 }],
            { warehouseQty: 3, shopQty: 2 }
        );
        expect(product.stockQty).toBe(15);

        await StockService.reduceStockForSale(
            [{ productId: product._id, qty: 4, source: 'warehouse', warehouseId: wh._id }],
            'inv-1',
            ownerUser._id
        );

        let fresh = await Product.findById(product._id);
        let slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(6);
        expect(fresh.warehouseQty).toBe(3); // primary untouched
        expect(fresh.stockQty).toBe(11);

        // Insufficient slot qty must fail without touching stock.
        await expect(StockService.reduceStockForSale(
            [{ productId: product._id, qty: 99, source: 'warehouse', warehouseId: wh._id }],
            'inv-2',
            ownerUser._id
        )).rejects.toThrow();

        fresh = await Product.findById(product._id);
        slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(6);
        expect(fresh.stockQty).toBe(11);
    });

    it('keeps the legacy primary path when no warehouseId is supplied', async () => {
        const { StockService } = await import('../services/stockService.js');
        const { default: Product } = await import('../models/Product.js');

        const product = await createProduct([], { warehouseQty: 9, shopQty: 1 });
        await StockService.reduceStockForSale(
            [{ productId: product._id, qty: 4, source: 'warehouse' }],
            'inv-legacy',
            ownerUser._id
        );

        const fresh = await Product.findById(product._id);
        expect(fresh.warehouseQty).toBe(5);
        expect(fresh.shopQty).toBe(1);
        expect(fresh.stockQty).toBe(6);
    });

    it('receives a purchase into a non-primary slot, creating it when absent', async () => {
        const { StockService } = await import('../services/stockService.js');
        const { default: Product } = await import('../models/Product.js');

        const wh = await createWarehouse({ code: `RCV-${Date.now()}` });
        const product = await createProduct([], { warehouseQty: 0, shopQty: 0, buyPrice: 10 });

        await StockService.increaseStockForPurchase(
            [{ productId: product._id, quantity: 5, costPrice: 12, warehouseId: wh._id }],
            'po-1',
            ownerUser._id
        );

        const fresh = await Product.findById(product._id);
        const slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(5);
        expect(fresh.warehouseQty).toBe(0);
        expect(fresh.stockQty).toBe(5);
        expect(fresh.buyPrice).toBe(12); // (0*10 + 5*12) / 5
    });

    it('transfers from a slot to the shop and back, conserving stockQty', async () => {
        const { StockService } = await import('../services/stockService.js');
        const { default: Product } = await import('../models/Product.js');

        const wh = await createWarehouse({ code: `TFS-${Date.now()}` });
        const product = await createProduct([{ warehouseId: wh._id, qty: 10 }], { shopQty: 0 });
        expect(product.stockQty).toBe(10);

        await StockService.transferToShop(product._id, 4, ownerUser._id, '', null, wh._id);
        let fresh = await Product.findById(product._id);
        let slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(6);
        expect(fresh.shopQty).toBe(4);
        expect(fresh.stockQty).toBe(10);

        await StockService.transferToWarehouse(product._id, 3, ownerUser._id, '', null, wh._id);
        fresh = await Product.findById(product._id);
        slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(9);
        expect(fresh.shopQty).toBe(1);
        expect(fresh.stockQty).toBe(10);
    });

    it('transfers stock between two non-primary warehouses', async () => {
        const { StockService } = await import('../services/stockService.js');
        const { default: Product } = await import('../models/Product.js');
        const { default: StockMovement } = await import('../models/StockMovement.js');

        const from = await createWarehouse({ code: `BW-F-${Date.now()}` });
        const to = await createWarehouse({ code: `BW-T-${Date.now()}` });
        const product = await createProduct([{ warehouseId: from._id, qty: 10 }]);

        await StockService.transferBetweenWarehouses(product._id, 3, ownerUser._id, from._id, to._id);

        const fresh = await Product.findById(product._id);
        const fromSlot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(from._id));
        const toSlot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(to._id));
        expect(fromSlot.qty).toBe(7);
        expect(toSlot.qty).toBe(3);
        expect(fresh.stockQty).toBe(10);

        const movement = await StockMovement.findOne({ productId: product._id, type: 'TRANSFER' });
        expect(String(movement.fromWarehouseId)).toBe(String(from._id));
        expect(String(movement.toWarehouseId)).toBe(String(to._id));
    });

    it('adjusts a slot to an absolute quantity, updating stockQty by the delta', async () => {
        const { StockService } = await import('../services/stockService.js');
        const { default: Product } = await import('../models/Product.js');

        const wh = await createWarehouse({ code: `ADJ-${Date.now()}` });
        const product = await createProduct([{ warehouseId: wh._id, qty: 5 }], { shopQty: 1 });

        await StockService.adjustStockLocation(product._id, 'warehouse', 8, 'جرد', ownerUser._id, null, wh._id);

        const fresh = await Product.findById(product._id);
        const slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(8);
        expect(fresh.shopQty).toBe(1);
        expect(fresh.stockQty).toBe(9);
    });

    it('sells from a non-primary warehouse slot end-to-end via the invoice API', async () => {
        const { default: Product } = await import('../models/Product.js');

        const wh = await createWarehouse({ code: `E2E-${Date.now()}` });
        const product = await createProduct([{ warehouseId: wh._id, qty: 10 }], { retailPrice: 20 });

        const res = await request.post('/api/invoices')
            .set('Cookie', ownerCookie)
            .send({
                items: [{
                    productId: String(product._id),
                    qty: 2,
                    unitPrice: 20,
                    source: 'warehouse',
                    warehouseId: String(wh._id)
                }],
                paymentType: 'cash'
            });
        expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

        const fresh = await Product.findById(product._id);
        const slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(8);
        expect(fresh.stockQty).toBe(8);
    });

    it('rejects an invoice that overdraws a warehouse slot', async () => {
        const wh = await createWarehouse({ code: `OVR-${Date.now()}` });
        const product = await createProduct([{ warehouseId: wh._id, qty: 1 }], { retailPrice: 20 });

        const res = await request.post('/api/invoices')
            .set('Cookie', ownerCookie)
            .send({
                items: [{
                    productId: String(product._id),
                    qty: 5,
                    unitPrice: 20,
                    source: 'warehouse',
                    warehouseId: String(wh._id)
                }],
                paymentType: 'cash'
            });
        expect(res.status).toBe(400);
    });

    it('adjusts a warehouse slot through the stock adjust API', async () => {
        const { default: Product } = await import('../models/Product.js');

        const wh = await createWarehouse({ code: `ADJAPI-${Date.now()}` });
        const product = await createProduct([{ warehouseId: wh._id, qty: 5 }]);

        const res = await request.post('/api/stock/adjust')
            .set('Cookie', ownerCookie)
            .send({
                productId: String(product._id),
                location: 'warehouse',
                newQty: 9,
                reason: 'جرد دوري',
                warehouseId: String(wh._id)
            });
        expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

        const fresh = await Product.findById(product._id);
        const slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(9);
        expect(fresh.stockQty).toBe(9);
    });

    it('receives a purchase order into a warehouse slot end-to-end', async () => {
        const { default: Product } = await import('../models/Product.js');

        const wh = await createWarehouse({ code: `POE2E-${Date.now()}` });

        const supplierRes = await request.post('/api/suppliers').set('Cookie', ownerCookie)
            .send({ name: `مورد-${Date.now()}` });
        expect(supplierRes.status, JSON.stringify(supplierRes.body)).toBeLessThan(300);

        const productRes = await request.post('/api/products').set('Cookie', ownerCookie).send({
            name: `منتج-${Date.now()}`,
            code: `POE2E-${Date.now()}`,
            buyPrice: 10,
            retailPrice: 20,
            warehouseQty: 0,
            shopQty: 0,
        });
        expect(productRes.status, JSON.stringify(productRes.body)).toBeLessThan(300);
        const productId = productRes.body.data._id;

        const poRes = await request.post('/api/purchase-orders').set('Cookie', ownerCookie).send({
            supplierId: supplierRes.body.data._id,
            items: [{ productId, quantity: 6, costPrice: 7, warehouseId: String(wh._id) }],
            paymentType: 'cash',
        });
        expect(poRes.status, JSON.stringify(poRes.body)).toBeLessThan(300);

        const recv = await request.post(`/api/purchase-orders/${poRes.body.data._id}/receive`)
            .set('Cookie', ownerCookie).send({});
        expect(recv.status, JSON.stringify(recv.body)).toBeLessThan(300);

        const fresh = await Product.findById(productId);
        const slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(6);
        expect(fresh.warehouseQty).toBe(0);
        expect(fresh.stockQty).toBe(6);
    });
});

describe('WH-08: physical inventory warehouse scoping', () => {
    it('scopes a count to a non-primary warehouse slot and reconciles it on completion', async () => {
        const { default: Product } = await import('../models/Product.js');
        const { default: StockMovement } = await import('../models/StockMovement.js');

        const wh = await createWarehouse({ code: `PI-${Date.now()}` });
        // buyPrice 0 keeps valueImpact at 0 → no GL entries needed in this test.
        const product = await createProduct(
            [{ warehouseId: wh._id, qty: 8 }],
            { warehouseQty: 5, shopQty: 2, buyPrice: 0 }
        );

        const createRes = await request.post('/api/physical-inventory').set('Cookie', ownerCookie)
            .send({ location: 'warehouse', warehouseId: String(wh._id) });
        expect(createRes.status, JSON.stringify(createRes.body)).toBeLessThan(300);
        const count = createRes.body.data;

        const item = count.items.find((i) => String(i.productId) === String(product._id));
        expect(item).toBeTruthy();
        expect(item.systemQty).toBe(8);
        expect(String(item.warehouseId)).toBe(String(wh._id));

        // Count 6 → shortage of 2 in the slot only.
        const upd = await request.patch(`/api/physical-inventory/${count._id}`).set('Cookie', ownerCookie)
            .send({ items: [{ productId: String(product._id), actualQty: 6, reason: 'نقص' }] });
        expect(upd.status, JSON.stringify(upd.body)).toBeLessThan(300);

        const comp = await request.post(`/api/physical-inventory/${count._id}/complete`)
            .set('Cookie', ownerCookie).send({});
        expect(comp.status, JSON.stringify(comp.body)).toBeLessThan(300);

        const fresh = await Product.findById(product._id);
        const slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(6);
        expect(fresh.warehouseQty).toBe(5); // primary untouched
        expect(fresh.shopQty).toBe(2);      // shop untouched
        expect(fresh.stockQty).toBe(5 + 2 + 6);

        const mv = await StockMovement.findOne({
            productId: product._id,
            warehouseId: wh._id,
            type: 'ADJUST'
        });
        expect(mv).toBeTruthy();
    });

    it('keeps the legacy primary-warehouse count working when no warehouseId is given', async () => {
        const { default: Product } = await import('../models/Product.js');
        const product = await createProduct([], { warehouseQty: 10, shopQty: 1, buyPrice: 0 });

        const createRes = await request.post('/api/physical-inventory').set('Cookie', ownerCookie)
            .send({ location: 'warehouse' });
        expect(createRes.status, JSON.stringify(createRes.body)).toBeLessThan(300);
        const count = createRes.body.data;

        const item = count.items.find((i) => String(i.productId) === String(product._id));
        expect(item.systemQty).toBe(10);
        expect(item.warehouseId).toBeFalsy();

        await request.patch(`/api/physical-inventory/${count._id}`).set('Cookie', ownerCookie)
            .send({ items: [{ productId: String(product._id), actualQty: 7, reason: 'نقص' }] });

        const comp = await request.post(`/api/physical-inventory/${count._id}/complete`)
            .set('Cookie', ownerCookie).send({});
        expect(comp.status, JSON.stringify(comp.body)).toBeLessThan(300);

        const fresh = await Product.findById(product._id);
        expect(fresh.warehouseQty).toBe(7);
        expect(fresh.shopQty).toBe(1);
        expect(fresh.stockQty).toBe(8);
    });
});

describe('WH-09: inter-warehouse transfers (primary on either side)', () => {
    it('transfers from the primary warehouse to a non-primary slot via the API', async () => {
        const { default: Product } = await import('../models/Product.js');
        const { default: StockMovement } = await import('../models/StockMovement.js');

        const wh = await createWarehouse({ code: `IW-P2N-${Date.now()}` });
        const product = await createProduct([], { warehouseQty: 10, shopQty: 0 });

        const res = await request.post('/api/stock/transfer').set('Cookie', ownerCookie).send({
            productId: String(product._id),
            from: 'warehouse',
            to: 'warehouse',
            qty: 4,
            fromWarehouseId: null,
            toWarehouseId: String(wh._id),
        });
        expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

        const fresh = await Product.findById(product._id);
        const slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(fresh.warehouseQty).toBe(6);
        expect(slot.qty).toBe(4);
        expect(fresh.stockQty).toBe(10);

        const movement = await StockMovement.findOne({ productId: product._id, type: 'TRANSFER' });
        expect(movement.fromWarehouseId).toBeFalsy();
        expect(String(movement.toWarehouseId)).toBe(String(wh._id));
    });

    it('transfers from a non-primary slot back to the primary via the API', async () => {
        const { default: Product } = await import('../models/Product.js');

        const wh = await createWarehouse({ code: `IW-N2P-${Date.now()}` });
        const product = await createProduct([{ warehouseId: wh._id, qty: 8 }], { warehouseQty: 2, shopQty: 0 });

        const res = await request.post('/api/stock/transfer').set('Cookie', ownerCookie).send({
            productId: String(product._id),
            from: 'warehouse',
            to: 'warehouse',
            qty: 5,
            fromWarehouseId: String(wh._id),
            toWarehouseId: null,
        });
        expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

        const fresh = await Product.findById(product._id);
        const slot = fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id));
        expect(slot.qty).toBe(3);
        expect(fresh.warehouseQty).toBe(7);
        expect(fresh.stockQty).toBe(10);
    });

    it("resolves the primary warehouse's real _id to the primary slot (no bogus slot)", async () => {
        const { StockService } = await import('../services/stockService.js');
        const { default: Product } = await import('../models/Product.js');
        const { default: Warehouse } = await import('../models/Warehouse.js');

        const primary = await Warehouse.findOne({ isPrimary: true });
        const wh = await createWarehouse({ code: `IW-RES-${Date.now()}` });
        const product = await createProduct([], { warehouseQty: 5, shopQty: 0 });

        await StockService.transferBetweenWarehouses(
            product._id, 2, ownerUser._id, primary._id, wh._id
        );

        const fresh = await Product.findById(product._id);
        expect(fresh.warehouseQty).toBe(3);
        expect(fresh.warehouseStocks.find((s) => String(s.warehouseId) === String(wh._id)).qty).toBe(2);
        // The primary's id must never be materialised as a non-primary slot.
        expect(fresh.warehouseStocks.some((s) => String(s.warehouseId) === String(primary._id))).toBe(false);
    });

    it('rejects a primary→primary (same warehouse) transfer', async () => {
        const { default: Product } = await import('../models/Product.js');
        const product = await createProduct([], { warehouseQty: 5, shopQty: 0 });

        const res = await request.post('/api/stock/transfer').set('Cookie', ownerCookie).send({
            productId: String(product._id),
            from: 'warehouse',
            to: 'warehouse',
            qty: 1,
            fromWarehouseId: null,
            toWarehouseId: null,
        });
        expect(res.status).toBe(400);

        const fresh = await Product.findById(product._id);
        expect(fresh.warehouseQty).toBe(5);
    });

    it('rejects a same non-primary warehouse transfer', async () => {
        const wh = await createWarehouse({ code: `IW-SAME-${Date.now()}` });
        const product = await createProduct([{ warehouseId: wh._id, qty: 5 }]);

        const res = await request.post('/api/stock/transfer').set('Cookie', ownerCookie).send({
            productId: String(product._id),
            from: 'warehouse',
            to: 'warehouse',
            qty: 1,
            fromWarehouseId: String(wh._id),
            toWarehouseId: String(wh._id),
        });
        expect(res.status).toBe(400);
    });
});
