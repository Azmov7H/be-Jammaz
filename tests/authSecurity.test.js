import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, seedUser, stopTestDb } from './helpers.js';

// T-SEC-01: password hash must never serialize to a client.

let app;
beforeAll(async () => {
    app = await createTestApp();
}, 180000);

afterAll(async () => {
    await stopTestDb();
});

describe('SEC-001/T-SEC-01: hash exposure', () => {
    it('login payload contains no password or tokenVersion', async () => {
        const { user } = await seedUser(app);
        for (const secret of ['password', 'tokenVersion', 'hash', '__v']) {
            expect(user, `login leaked "${secret}"`).not.toHaveProperty(secret);
        }
    });

    it('session payload contains no password or tokenVersion', async () => {
        const { cookie } = await seedUser(app);
        const res = await app.get('/api/auth/session').set('Cookie', cookie).expect(200);
        const session = res.body.data;
        expect(session).toBeTruthy();
        for (const secret of ['password', 'tokenVersion']) {
            expect(session, `session leaked "${secret}"`).not.toHaveProperty(secret);
        }
    });

    it('default queries exclude the hash; explicit select is required to read it', async () => {
        const { user } = await seedUser(app);
        const User = (await import('../models/User.js')).default;
        const { UserRepository } = await import('../repositories/userRepository.js');

        const plain = await User.findOne({ email: user.email });
        expect(plain.password).toBeUndefined();

        const withHash = await UserRepository.findByEmailWithPassword(user.email);
        expect(withHash.password).toMatch(/^\$2[aby]\$/);
    });
});
