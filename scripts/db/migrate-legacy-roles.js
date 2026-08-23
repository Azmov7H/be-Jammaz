// T-AUTH-01 role migration: map legacy roles onto the canonical set.
//   accountant -> manager   (financial duties fold into manager)
//   sales      -> cashier
//
// Usage:
//   DRY_RUN=1 node scripts/db/migrate-legacy-roles.js   # report only
//   node scripts/db/migrate-legacy-roles.js             # apply
import mongoose from 'mongoose';

const MAPPING = { accountant: 'manager', sales: 'cashier' };

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
}

await mongoose.connect(uri);
const col = mongoose.connection.collection('users');

const groups = await col.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]).toArray();
const legacy = groups.filter((g) => MAPPING[g._id]);

console.log('Role distribution:', groups.map((g) => `${g._id}: ${g.n}`).join(', ') || '(empty)');

for (const { _id: from, n } of legacy) {
    const to = MAPPING[from];
    if (process.env.DRY_RUN) {
        console.log(`[DRY_RUN] would update ${n} users: ${from} -> ${to}`);
    } else {
        const r = await col.updateMany({ role: from }, { $set: { role: to } });
        console.log(`updated ${r.modifiedCount} users: ${from} -> ${to}`);
    }
}
if (!legacy.length) console.log('No legacy roles found.');

await mongoose.disconnect();
