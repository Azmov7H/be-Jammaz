/**
 * T-CLN-02: ShortageReport.status casing normalization.
 *
 * Mixed-case enum ['PENDING','viewed','RESOLVED'] → ['PENDING','VIEWED','RESOLVED'].
 * Stored docs with status:'viewed' are migrated to 'VIEWED'.
 *
 * Usage:
 *   node scripts/db/migrate-shortage-casing.js            # DRY RUN (counts only)
 *   WRITE=1 node scripts/db/migrate-shortage-casing.js    # apply
 *   CASE=down WRITE=1 node scripts/db/migrate-shortage-casing.js  # inverse
 *
 * Isolation: schema enum widened first (this deploy), then this script;
 * rollback = CASE=down run (old code reads lowercase fine since the legacy
 * enum contained it).
 */
import mongoose from 'mongoose';
import 'dotenv/config';

const DRY = process.env.WRITE !== '1';
const DOWN = process.env.CASE === 'down';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);
    const col = mongoose.connection.collection('shortagereports');

    const [from, to] = DOWN ? ['VIEWED', 'viewed'] : ['viewed', 'VIEWED'];

    const matchCount = await col.countDocuments({ status: from });
    const total = await col.countDocuments({});
    console.log(`[shortage-casing] mode=${DRY ? 'DRY RUN' : 'WRITE'} dir=${DOWN ? 'down' : 'up'}`);
    console.log(`[shortage-casing] collection size=${total} candidates(status='${from}')=${matchCount}`);

    if (!DRY && matchCount > 0) {
        const res = await col.updateMany({ status: from }, { $set: { status: to } });
        console.log(`[shortage-casing] updated=${res.modifiedCount}`);
        const after = await col.countDocuments({ status: from });
        console.log(`[shortage-casing] verify: remaining '${from}'=${after} (expect 0)`);
    }

    await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
