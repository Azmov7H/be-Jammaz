import mongoose from 'mongoose';
import dbConnect from '../lib/db.js';

/**
 * Executes a function within a MongoDB transaction if sessions are supported.
 * Handles the "Standalone vs Replica Set" check automatically.
 * 
 * @param {Function} fn - The async function to execute. Receives (session) as argument.
 * @returns {Promise<any>} - The result of the function.
 */
export async function withTransaction(fn) {
    await dbConnect();

    let session = null;
    try {
        session = await mongoose.startSession();
        session.startTransaction();
    } catch (error) {
        // Fallback for standalone MongoDB
        console.warn('[DB] Transactions not supported. Running non-atomically.');
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
