import Counter, { getNextSequence } from '../models/Counter.js';
import dbConnect from './db.js';

/**
 * T-DB-04: single numbering authority (DATA-004).
 * Format: PREFIX-000001. Counters are seeded from the current max existing
 * number so adoption never collides with legacy Date.now()-based values.
 */
export async function nextDocumentNumber(prefix) {
    await dbConnect();
    const seq = await getNextSequence(`docnum:${prefix}`);
    return `${prefix}-${String(seq).padStart(6, '0')}`;
}

/** Seed a counter to max(existing numbers); safe to run repeatedly. */
export async function seedCounter(prefix, maxSeq) {
    await dbConnect();
    const id = `docnum:${prefix}`;
    const existing = await Counter.findById(id);
    if (!existing || existing.seq < maxSeq) {
        await Counter.findByIdAndUpdate(
            id,
            { $max: { seq: maxSeq } },
            { upsert: true }
        );
    }
}
