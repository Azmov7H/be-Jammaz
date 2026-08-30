import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// Sprint 10 — Security Hardening.
// Coverage: SEC-VAL-001 (sourceNumber trim/bound/char-scan), SEC-VAL-002 (method enum),
//           SEC-PII-001 (list endpoints mask sourceNumber for non-privileged),
//           SEC-AUTH (party link + finance/transaction ACL), SEC-AUD-001 (party link audit).
//           Tests: E1/E6 subset of the 08-testing security matrix.

let request;
let ownerCookie;
let cashierCookie;
let viewerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'S10 Owner', role: 'owner' }));
    ({ cookie: cashierCookie } = await seedUser(request, { name: 'S10 Cashier', role: 'cashier' }));
    ({ cookie: viewerCookie } = await seedUser(request, { name: 'S10 Viewer', role: 'viewer' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const uniq = (p) => `${p}${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const id = (doc) => doc?._id ?? doc?.id;
const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(300);
const DID = '64b000000000000000000000';

async function makeCustomer(over = {}) {
    const res = await request.post('/api/customers').set('Cookie', ownerCookie)
        .send({ name: `عميل s10-${uniq('C')}`, phone: uniq('9'), ...over });
    ok(res, 'createCustomer');
    return res.body.data;
}

async function makeSupplier(over = {}) {
    const res = await request.post('/api/suppliers').set('Cookie', ownerCookie)
        .send({ name: `مورد s10-${uniq('S')}`, phone: uniq('8'), ...over });
    ok(res, 'createSupplier');
    return res.body.data;
}

async function seedTreasuryTx(sourceNumber) {
    const { default: Txn } = await import('../models/TreasuryTransaction.js');
    return Txn.create([{
        type: 'INCOME',
        amount: 100,
        description: `أمن s10 ${uniq('SEC')}`,
        date: new Date(),
        method: 'instapay',
        referenceType: 'Manual',
        sourceNumber,
        partnerId: null
    }]);
}

describe('SEC-VAL-001 — sourceNumber hardening (trim/bound/char-scan)', () => {
    it('rejects a sourceNumber containing a path separator (400)', async () => {
        const res = await request.post('/api/financial/payments/customer')
            .set('Cookie', ownerCookie)
            .send({ invoice: DID, amount: 10, method: 'instapay', sourceNumber: 'IP-12/34' });
        expect(res.status).toBe(400);
    });

    it('rejects a sourceNumber containing a control character (400)', async () => {
        const res = await request.post('/api/financial/payments/customer')
            .set('Cookie', ownerCookie)
            .send({ invoice: DID, amount: 10, method: 'instapay', sourceNumber: 'IP-12\u000734' });
        expect(res.status).toBe(400);
    });

    it('rejects a sourceNumber longer than 200 chars (400)', async () => {
        const res = await request.post('/api/financial/payments/customer')
            .set('Cookie', ownerCookie)
            .send({ invoice: DID, amount: 10, method: 'instapay', sourceNumber: 'X'.repeat(201) });
        expect(res.status).toBe(400);
    });
});

describe('SEC-VAL-002 — method enum enforced server-side', () => {
    it('rejects an unknown payment method (400)', async () => {
        const res = await request.post('/api/financial/payments/customer')
            .set('Cookie', ownerCookie)
            .send({ invoice: DID, amount: 10, method: 'telepathy', sourceNumber: 'IP-1' });
        expect(res.status).toBe(400);
    });
});

describe('SEC-PII-001 — sourceNumber masked for non-privileged list responses', () => {
    const customSource = `IPSEC-${Date.now()}`;

    beforeAll(async () => {
        await seedTreasuryTx(customSource);
    });

    it('viewer gets masked (••••  last4), never the full sourceNumber', async () => {
        const res = await request.get('/api/treasury/transactions').set('Cookie', viewerCookie);
        ok(res, 'viewer transactions');
        const list = res.body.data || [];
        // Our seeded tx is the most recent (the only m++) in this fresh DB window.
        const smallest = list
            .filter((t) => t.sourceNumber)
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
        expect(smallest).toBeTruthy();
        expect(smallest.sourceNumber).not.toContain(customSource);
        expect(smallest.sourceNumber).toContain('••••');
    });

    it('owner sees the full sourceNumber', async () => {
        const res = await request.get('/api/treasury/transactions').set('Cookie', ownerCookie);
        ok(res, 'owner transactions');
        const list = res.body.data || [];
        const match = list.find((t) => t.sourceNumber === customSource);
        expect(match).toBeTruthy();
        expect(match.sourceNumber).toBe(customSource);
    });
});

describe('SEC-AUTH — role gates on party + finance write endpoints', () => {
    it('cashier is forbidden (403) on party detect-duplicates/link/unlink', async () => {
        for (const path of ['/api/parties/detect-duplicates', '/api/parties/link', '/api/parties/unlink']) {
            const res = await request.post(path).set('Cookie', cashierCookie).send({});
            expect(res.status, path).toBe(403);
        }
    });

    it('cashier is forbidden (403) on customer/supplier link endpoints', async () => {
        const linkC = await request.post(`/api/customers/${DID}/link-supplier`)
            .set('Cookie', cashierCookie).send({ targetId: DID });
        expect(linkC.status).toBe(403);

        const linkS = await request.post(`/api/suppliers/${DID}/link-customer`)
            .set('Cookie', cashierCookie).send({ targetId: DID });
        expect(linkS.status).toBe(403);
    });

    it('cashier is forbidden (403) on POST /api/financial/transaction (manual booking)', async () => {
        const res = await request.post('/api/financial/transaction')
            .set('Cookie', cashierCookie)
            .send({ amount: 10, description: 'x', type: 'INCOME', method: 'cash' });
        expect(res.status).toBe(403);
    });
});

describe('SEC-AUD-001 — party link is audited via LogService', () => {
    it('creates a PARTY_LINK log entry with source/target ids', async () => {
        const customer = await makeCustomer();
        const supplier = await makeSupplier();
        await request.post(`/api/customers/${id(customer)}/link-supplier`)
            .set('Cookie', ownerCookie).send({ targetId: id(supplier) });

        const { default: Log } = await import('../models/Log.js');
        const entry = await Log.findOne({ action: 'PARTY_LINK' })
            .sort({ date: -1 })
            .lean();
        expect(entry).toBeTruthy();
        expect(String(entry.diff?.sourceId)).toBe(String(id(customer)));
        expect(String(entry.diff?.targetId)).toBe(String(id(supplier)));
        expect(entry.userId).toBeTruthy();
    });
});

describe('T-UNIT — PII masking utility', () => {
    it('maskSource keeps only the last 4 digits with bullets', async () => {
        const { maskSource, canSeeFullSourceNumber } = await import('../lib/pii.js');
        expect(maskSource('1234567890')).toBe('•••• 7890');
        expect(maskSource('1234')).toBe('••••');
        expect(maskSource(null)).toBe('');
        expect(canSeeFullSourceNumber('owner')).toBe(true);
        expect(canSeeFullSourceNumber('manager')).toBe(true);
        expect(canSeeFullSourceNumber('viewer')).toBe(false);
        expect(canSeeFullSourceNumber('cashier')).toBe(false);
    });
});
