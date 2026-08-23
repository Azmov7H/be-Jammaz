// T-DB-04 migration: seed docnum counters from current maxima so new
// INV-/RET-/PO- numbers continue after legacy Date.now() values without
// collision. Safe to re-run ($max semantics).
//
//   node scripts/db/seed-counters.js
import mongoose from 'mongoose';
import { seedCounter } from '../../lib/counters.js';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is required'); process.exit(1); }
await mongoose.connect(uri);
const db = mongoose.connection.db;

async function maxLegacy(prefix, col, field) {
    // Legacy format: PREFIX-<epoch ms>. Extract numeric suffix; take max
    // of both legacy epoch values and any already-adopted 6-digit sequence.
    const docs = await db.collection(col)
        .find({ [field]: { $regex: `^${prefix}-` } })
        .project({ _id: 0, v: `$${field}` })
        .toArray()
        .catch(() => []);
    let max = 0;
    for (const { v } of docs) {
        const n = parseInt(String(v).split('-')[1], 10);
        if (!Number.isNaN(n) && n > max) max = n;
    }
    return max;
}

for (const [prefix, col, field] of [
    ['INV', 'invoices', 'number'],
    ['RET', 'salesreturns', 'returnNumber'],
    ['PO', 'purchaseorders', 'poNumber'],
]) {
    let max = await maxLegacy(prefix, col, field);
    // If a previous 6-digit sequence was adopted, keep it ahead.
    const seqDocs = await db.collection(col)
        .find({ [field]: { $regex: `^${prefix}-\\d{6}$` } })
        .project({ _id: 0, v: `$${field}` }).toArray().catch(() => []);
    for (const { v } of seqDocs) {
        const n = parseInt(String(v).split('-')[1], 10);
        if (n > max) max = n;
    }
    await seedCounter(prefix, max);
    console.log(`${prefix}: counter seeded to ${max}`);
}

await mongoose.disconnect();
