import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, stopTestDb, seedUser } from './helpers.js';

// T-07 (FIN-CASHBOX-02) — a new day doc must carry ALL per-method openings
// from the previous day (instapay was dropped everywhere; bank/wallet/check
// were dropped on manual-first days), so the per-method chain never resets.

let request;
let ownerCookie;

beforeAll(async () => {
    request = await createTestApp();
    ({ cookie: ownerCookie } = await seedUser(request, { name: 'Chain Owner', role: 'owner' }));
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

const ok = (res, where) => expect(res.status, `${where}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
const auth = (req) => req.set('Cookie', ownerCookie);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString();

async function dailyCashbox(dateIso) {
    const res = await auth(request.get(`/api/treasury/daily?date=${encodeURIComponent(dateIso)}`));
    ok(res, 'getDailyCashbox');
    return res.body.data;
}

describe('T-07: day-chain opening carry', () => {
    it('bank and instapay closings carry into the next day openings', async () => {
        const dayA = day(31);
        const dayB = day(32);
        ok(await auth(request.post('/api/treasury/manual-income')).send({
            amount: 250, reason: 'سلسلة بنك', method: 'bank', date: dayA,
        }), 'bankIncome dayA');
        ok(await auth(request.post('/api/treasury/manual-income')).send({
            amount: 400, reason: 'سلسلة انستا', method: 'instapay',
            sourceNumber: 'IP-CHAIN-01', date: dayA,
        }), 'instapayIncome dayA');

        const cbA = await dailyCashbox(dayA);
        expect(cbA.closingBankBalance).toBeCloseTo(250, 2);
        expect(cbA.closingInstapayBalance).toBeCloseTo(400, 2);

        // Any write on day B creates its doc — openings must chain.
        ok(await auth(request.post('/api/treasury/manual-income')).send({
            amount: 10, reason: 'يوم تالٍ', method: 'cash', date: dayB,
        }), 'cashIncome dayB');
        const cbB = await dailyCashbox(dayB);
        expect(cbB.openingBankBalance).toBeCloseTo(250, 2);
        expect(cbB.openingInstapayBalance).toBeCloseTo(400, 2);
    });
});
