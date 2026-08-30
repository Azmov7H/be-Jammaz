import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// Sprint 8 — Export Repair (FIN-EXP-001..004 / SEC-EXP-001..003).
// Tests: T-INT-011 (authorized export works; unauthorized 403; IDOR filtered; PII masked).

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'S8 Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;

async function seedTreasuryTx(sourceNumber) {
    const { default: Txn } = await import('../models/TreasuryTransaction.js');
    return Txn.create([{
        type: 'INCOME',
        amount: 100,
        description: `تصدير اختبار ${uniq('EXP')}`,
        date: new Date(),
        method: 'instapay',
        referenceType: 'Manual',
        sourceNumber,
        partnerId: null
    }]);
}

describe('Sprint 8 — Export endpoint (T-INT-011)', () => {
    it('E5: export without auth is rejected (401)', async () => {
        const res = await request.post('/api/export').send({ type: 'customers', format: 'csv' });
        expect([401, 403]).toContain(res.status);
    });

    it('E5: a non-export role (cashier) is forbidden (403)', async () => {
        const { cookie: cashierCookie } = await seedUser(request, { name: 'S8 Cashier', role: 'cashier' });
        const res = await request.post('/api/export')
            .set('Cookie', cashierCookie)
            .send({ type: 'customers', format: 'csv' });
        expect(res.status).toBe(403);
    });

    it('authorized owner exports customers as CSV (BOM + header + rows)', async () => {
        await request.post('/api/customers').set('Cookie', ownerCookie)
            .send({ name: `عميل تصدير ${uniq('C')}`, phone: uniq('9') });

        const res = await request.post('/api/export')
            .set('Cookie', ownerCookie)
            .send({ type: 'customers', format: 'csv' });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.text.startsWith('\uFEFF')).toBe(true); // UTF-8 BOM for Arabic
        expect(res.text).toContain('الاسم');
        expect(res.text).toContain('الهاتف');
    });

    it('E6: NoSQL operator / unknown filter is rejected (400)', async () => {
        const res = await request.post('/api/export')
            .set('Cookie', ownerCookie)
            .send({ type: 'customers', filters: { $where: 'true' } });
        expect(res.status).toBe(400);

        const idor = await request.post('/api/export')
            .set('Cookie', ownerCookie)
            .send({ type: 'customers', filters: { partnerId: '000000000000000000000000' } });
        expect(idor.status).toBe(400); // partnerId not an allowed filter for customers
    });

    it('FIN-EXP-004/SEC-EXP-001: sourceNumber masked for viewer, present for owner', async () => {
        const customSource = `SRC-S8-${Date.now()}`;
        await seedTreasuryTx(customSource);

        const { cookie: viewerCookie } = await seedUser(request, { name: 'S8 Viewer', role: 'viewer' });

        // Viewer: not owner/manager → sourceNumber column excluded.
        const viewerRes = await request.post('/api/export')
            .set('Cookie', viewerCookie)
            .send({ type: 'treasuryTransactions', format: 'csv' });
        expect(viewerRes.status).toBe(200);
        expect(viewerRes.text).not.toContain('رقم التحويل');
        expect(viewerRes.text).not.toContain(customSource);

        // Owner: privileged → sourceNumber column + value present.
        const ownerRes = await request.post('/api/export')
            .set('Cookie', ownerCookie)
            .send({ type: 'treasuryTransactions', format: 'csv' });
        expect(ownerRes.status).toBe(200);
        expect(ownerRes.text).toContain('رقم التحويل');
        expect(ownerRes.text).toContain(customSource);
    });

    it('E7: export completes with many rows', async () => {
        for (let i = 0; i < 30; i++) await seedTreasuryTx(null);
        const res = await request.post('/api/export')
            .set('Cookie', ownerCookie)
            .send({ type: 'treasuryTransactions', format: 'csv' });
        expect(res.status).toBe(200);
        const dataLines = res.text.split('\r\n').filter((l) => l.trim() !== '');
        expect(dataLines.length - 1).toBeGreaterThanOrEqual(30); // header + >=30 rows
    });
});
