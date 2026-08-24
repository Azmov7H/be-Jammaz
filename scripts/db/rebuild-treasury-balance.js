// T-PERF-03: recompute the running treasury balance from the full ledger.
// Usage:
//   node scripts/db/rebuild-treasury-balance.js            (dry run — prints only)
//   WRITE=1 node scripts/db/rebuild-treasury-balance.js    (writes the doc)
import 'dotenv/config';
import mongoose from 'mongoose';
import TreasuryTransaction from '../../models/TreasuryTransaction.js';

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
}

await mongoose.connect(uri);

const [agg] = await TreasuryTransaction.aggregate([
    {
        $group: {
            _id: null,
            income: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] } },
            expense: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] } },
            count: { $sum: 1 }
        }
    }
]);

const balance = agg ? agg.income - agg.expense : 0;
console.log(`transactions=${agg?.count ?? 0} income=${agg?.income ?? 0} expense=${agg?.expense ?? 0}`);
console.log(`computed balance = ${balance}`);

if (process.env.WRITE === '1') {
    const { default: TreasuryBalance } = await import('../../models/TreasuryBalance.js');
    await TreasuryBalance.findOneAndUpdate(
        { _id: TreasuryBalance.DOC_ID },
        [{ $set: { balance, updatedAt: '$$NOW' } }],
        { upsert: true }
    );
    console.log('TreasuryBalance doc written.');
} else {
    console.log('DRY RUN — set WRITE=1 to persist.');
}

await mongoose.disconnect();
