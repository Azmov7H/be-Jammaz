import { logger } from '../lib/logger.js';
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
 - Production NEVER runs non-atomically: unsupported topology throws.
 * - Dev/test standalone requires ALLOW_NON_ATOMIC_DEV=true for the fallback
 *   (loud warning every call).
 *
 * T-TST-02 hardening: transient transaction failures (WriteConflict under
 * concurrent writes to the same document) are retried with backoff per the
 * MongoDB recommended pattern — the driver labels them
 * TransientTransactionError; retrying the WHOLE fn is always safe because
 * the aborted transaction rolled back all its writes.
 *
 * @param {Function} fn - Receives (session) as argument; session may be null
 *   ONLY in flagged dev environments.
 * @returns {Promise<any>} - The result of fn.
 */
const TRANSIENT_RETRY_LIMIT = 10;
const TRANSIENT_BASE_DELAY_MS = 30;

function isTransientTxnError(error) {
    // Walk the cause chain — MongoBulkWriteError and driver wrappers can
    // strip errorLabels while still representing a retryable conflict.
    let cur = error;
    for (let i = 0; cur && i < 5; i++, cur = cur.cause ?? cur.parent) {
        const labels = cur?.errorLabels ?? cur?.errorLabelSet;
        const list = labels ? (Array.isArray(labels) ? labels : [...labels]) : [];
        if (list.includes('TransientTransactionError')) return true;
        if (
            cur?.code === 112 || // WriteConflict
            cur?.code === 246 || // TransactionExceededLifetimeLimitSeconds
            /Write conflict|write conflict|WriteConflict/i.test(cur?.message ?? '')
        ) {
            return true;
        }
    }
    return false;
}

function isTopologyUnsupportedError(error) {
    let cur = error;
    for (let i = 0; cur && i < 5; i++, cur = cur.cause ?? cur.parent) {
        if (cur?.code === 20) return true; // IllegalOperation: Transaction numbers not supported
    }
    return false;
}

export async function withTransaction(fn) {
    await dbConnect();

    // Check topology once: if transactions are unsupported, run non-atomically
    // on every call (avoids re-detecting on every request).
    if (!IS_PRODUCTION && ALLOW_NON_ATOMIC_DEV) {
        try {
            const session = await mongoose.startSession();
            session.endSession();
        } catch (error) {
            if (isTopologyUnsupportedError(error)) {
                logger.warn('[DB] NON-ATOMIC FALLBACK ACTIVE (ALLOW_NON_ATOMIC_DEV=true). Data integrity degraded.');
                return fn(null);
            }
        }
    }

    // Retry loop: each attempt gets a fresh session so an aborted txn's
    // writes can never leak into the next attempt.
    let lastError;
    for (let attempt = 0; attempt <= TRANSIENT_RETRY_LIMIT; attempt++) {
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
        }

        try {
            const result = await fn(session);

            if (session) {
                await session.commitTransaction();
            }
            return result;
        } catch (error) {
            lastError = error;
            if (session) {
                await session.abortTransaction().catch(() => {});
            }

            // If the error is an unsupported-topology error and we're in dev
            // with non-atomic allowed, fall back to running without session.
            if (!IS_PRODUCTION && ALLOW_NON_ATOMIC_DEV && isTopologyUnsupportedError(error)) {
                logger.warn('[DB] NON-ATOMIC FALLBACK ACTIVE (topology error mid-txn). Data integrity degraded.');
                return fn(null);
            }

            const retryable =
                isTransientTxnError(error) &&
                attempt < TRANSIENT_RETRY_LIMIT;
            if (retryable) {
                // exponential backoff, capped at ~1s, with jitter
                const delay = Math.min(TRANSIENT_BASE_DELAY_MS * 2 ** attempt, 1000) +
                    Math.floor(Math.random() * TRANSIENT_BASE_DELAY_MS);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        } finally {
            if (session) {
                session.endSession();
            }
        }
    }
    throw lastError;
}
