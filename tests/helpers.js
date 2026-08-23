import { MongoMemoryReplSet } from 'mongodb-memory-server';

let mongod = null;

/**
 * Boots an in-memory MongoDB once per test process, sets the required env
 * vars BEFORE any app module is imported, connects mongoose, and returns
 * a supertest-ready app instance.
 *
 * Characterization tests assert CURRENT behavior — do not "fix" failures
 * here; changing behavior is Sprint 01+ work with its own test updates.
 */
export async function createTestApp() {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET ||= 'test-jwt-secret-for-sprint-00-baseline';
    process.env.JWT_EXPIRES_IN ||= '1d';
    process.env.PORT ||= '0';

    if (!mongod) {
        // Single-node replica set so transactions behave like production (Atlas).
        mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
        process.env.MONGODB_URI = mongod.getUri('transfer-erp-test');
        const { default: dbConnect } = await import('../lib/db.js');
        await dbConnect();
    }

    const { default: app } = await import('../index.js');
    const request = (await import('supertest')).default;
    return request(app);
}

export async function stopTestDb() {
    if (mongod) {
        await mongod.stop();
        mongod = null;
    }
}

/** Seeds an active user and returns { user, cookie } for authenticated requests. */
export async function seedUser(app, { name = 'Owner', role = 'owner' } = {}) {
    const bcrypt = (await import('bcryptjs')).default;
    const User = (await import('../models/User.js')).default;

    const password = 'Test123456';
    const user = await User.create({
        name,
        email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
        password: await bcrypt.hash(password, 10),
        role,
        isActive: true,
    });

    const res = await app.post('/api/auth/login')
        .send({ email: user.email, password })
        .expect((r) => {
            if (![200, 401].includes(r.status)) {
                throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
            }
        });
    if (res.status !== 200) throw new Error(`seedUser login failed: ${JSON.stringify(res.body)}`);

    const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
    // AuthController.login returns result.user directly, so data IS the user object
    return { user: res.body.data, cookie };
}
