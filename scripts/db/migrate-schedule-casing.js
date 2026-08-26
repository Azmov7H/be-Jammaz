/**
 * T-CLN-02: PaymentSchedule.status casing normalization (UPPERCASE → lowercase).
 *
 * Single-case decision: Debt.status is the established lowercase public
 * contract ('active'|'overdue'|'settled'|'written-off' — consumed by the
 * frontend). PaymentSchedule aligns DOWN to lowercase:
 *   PENDING→pending  PAID→paid  OVERDUE→overdue  CANCELLED→cancelled
 *
 * Usage:
 *   node scripts/db/migrate-schedule-casing.js            # DRY RUN (counts only)
 *   WRITE=1 node scripts/db/migrate-schedule-casing.js    # apply
 *   CASE=down WRITE=1 node scripts/db/migrate-schedule-casing.js  # inverse
 *
 * Isolation: deploy order = code that WRITES lowercase ships together with
 * this migration; old readers never see mixed values because both updates
 * run before traffic. Rollback = CASE=down + revert of the code commit.
 */
import mongoose from 'mongoose';
import 'dotenv/config';

const DRY = process.env.WRITE !== '1';
const DOWN = process.env.CASE === 'down';

const MAP_UP = { PENDING: 'pending', PAID: 'paid', OVERDUE: 'overdue', CANCELLED: 'cancelled' };
const MAP_DOWN = Object.fromEntries(Object.entries(MAP_UP).map(([k, v]) => [v, k]));

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);
    const col = mongoose.connection.collection('paymentschedules');

    const map = DOWN ? MAP_DOWN : MAP_UP;
    console.log(`[schedule-casing] mode=${DRY ? 'DRY RUN' : 'WRITE'} dir=${DOWN ? 'down' : 'up'}`);

    let totalCandidates = 0;
    for (const [from, to] of Object.entries(map)) {
        const count = await col.countDocuments({ status: from });
        console.log(`[schedule-casing] status='${from}' → '${to}': ${count} docs`);
        totalCandidates += count;
        if (!DRY && count > 0) {
            const res = await col.updateMany({ status: from }, { $set: { status: to } });
            console.log(`[schedule-casing] updated=${res.modifiedCount}`);
        }
    }

    // verify no mixed values remain after a write run
    if (!DRY) {
        const all = await col.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
        console.log('[schedule-casing] final distribution:', JSON.stringify(all));
    }
    console.log(`[schedule-casing] candidates total=${totalCandidates}`);

    await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
