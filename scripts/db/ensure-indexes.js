// T-DB-01 pre-flight/rollout helper: diffs declared model indexes against the
// actual database and creates missing ones (additive; safe to re-run).
//
//   node scripts/db/ensure-indexes.js            # create missing indexes
//   DRY_RUN=1 node scripts/db/ensure-indexes.js  # report only
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is required'); process.exit(1); }

await mongoose.connect(uri);

// Import models so their index declarations register on the connection.
const modules = [
    '../models/User.js', '../models/Customer.js', '../models/Product.js',
    '../models/Invoice.js', '../models/SalesReturn.js', '../models/PurchaseOrder.js',
    '../models/TreasuryTransaction.js', '../models/CollectionPeriod.js',
    '../models/Supplier.js', '../models/ShortageReport.js', '../models/Invoice.js',
    '../models/StockMovement.js', '../models/Log.js', '../models/Debt.js',
    '../models/CashboxDaily.js', '../models/RefreshToken.js', '../models/Notification.js',
];
for (const m of modules) await import(m);

let created = 0;
for (const name of mongoose.modelNames()) {
    const model = mongoose.models[name];
    const collection = model.collection;
    const existing = await collection.indexes();
    const existingKeys = new Set(existing.map((i) => JSON.stringify(i.key)));

    for (const index of model.schema.indexes()) {
        const [spec, opts = {}] = Array.isArray(index) ? index : [index, {}];
        if (!existingKeys.has(JSON.stringify(spec))) {
            if (process.env.DRY_RUN) {
                console.log(`[DRY_RUN] ${collection.name}: would create`, spec, opts);
            } else {
                try {
                    await collection.createIndex(spec, opts);
                    console.log(`created ${collection.name}:`, spec, opts);
                } catch (e) {
                    console.error(`FAILED ${collection.name}:`, spec, e.message);
                }
            }
            created++;
        }
    }
}

console.log(created ? `${created} index operations processed.` : 'All indexes up to date.');
await mongoose.disconnect();
