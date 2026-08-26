import logger from '../lib/logger.js';
import mongoose from 'mongoose';
import dbConnect from '../lib/db.js';
import { ALLOW_NON_ATOMIC_DEV, IS_PRODUCTION } from '../lib/config.js';

/**
 * Retry helper for transient transaction errors (write conflicts, primary
 * stepdowns). Usage:
 *   await withRetry(() => withTransaction(fn))
 */
const TRANSIENT_CODES = new Set([112, 246, 251, 263]); // Unforgiving: 112 WriteConflict, 246, 251, 263
export async function withRetry(fn, { retries = 2 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const isTransient =
                err?.hasErrorLabel?.('TransientTransactionError') ||
                TRANSIENT_CODES.has(err?.code);
            if (!isTransient || attempt === retries) throw err;
            // Linear backoff — write conflicts resolve fast
            await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        }
    }
    throw lastErr;
}

/**
 * Executes a function within a MongoDB transaction.
 *
 * T-DB-07 hardening:
 * - Production NEVER runs non-atomically: unsupported topology throws.
 * - Dev/test standalone requires ALLOW_NON_ATOMIC_DEV=true for the fallback
 *   (loud warning every call).
 *
 * @param {Function} fn - Receives (session) as argument; session may be null
 *   ONLY in flagged dev environments.
 * @returns {Promise<any>} - The result of fn.
 */
export async function withTransaction(fn) {
    await dbConnect();

    let session;
    try {
        session = await mongoose.startSession();
        session.startTransaction();
    } catch (error) {
        if (IS_PRODUCTION) {
            throw new Error(
                '[DB] Transactions unsupported but required in production. ' +
                'MongoDB must run as a replica set.',
                { cause: error }
            );
        }
        if (!ALLOW_NON_ATOMIC_DEV) {
            throw new Error(
                '[DB] Transactions not supported by this topology. ' +
                'Use a replica set (mongod --replSet rs0) or set ALLOW_NON_ATOMIC_DEV=true ' +
                'to explicitly accept non-atomic development runs.',
                { cause: error }
            );
        }
        logger.warn('[DB] NON-ATOMIC FALLBACK ACTIVE (ALLOW_NON_ATOMIC_DEV=true). Data integrity degraded.');
        session = null;
    }

    try {
        const result = await fn(session);

        if (session) {
            await session.commitTransaction();
        }
        return result;
    } catch (error) {
        if (session) {
            await session.abortTransaction();
        }
        throw error;
    } finally {
        if (session) {
            session.endSession();
        }
    }
}
