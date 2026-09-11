// T-DB-03b cleanup: explicit null party links + legacy non-sparse indexes.
//
// Root cause: unlinked customers/suppliers were persisted with
// linkedSupplier/linkedCustomer set to an explicit null. A sparse-unique
// index treats null as an indexed value, so the SECOND such document died
// with E11000 ("linkedCustomer/linkedSupplier is already used").
// The services no longer write nulls; this script repairs existing data:
//
//   1. $unset linkedSupplier/linkedCustomer wherever they are explicitly null
//      (the link information is preserved — null means "no link").
//   2. Rebuild the two link indexes as sparse-unique in case they were
//      created before `sparse: true` was declared (a legacy non-sparse
//      unique index rejects even field-missing duplicates).
//
//   MONGODB_URI=mongodb://127.0.0.1:27017/transfer-erp node scripts/db/unset-null-party-links.js
//   DRY_RUN=1 ...   # report only
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is required'); process.exit(1); }
const DRY_RUN = process.env.DRY_RUN === '1';

await mongoose.connect(uri);
const db = mongoose.connection.db;

const targets = [
    { collection: 'customers', field: 'linkedSupplier' },
    { collection: 'suppliers', field: 'linkedCustomer' },
];

for (const { collection, field } of targets) {
    // Count explicit nulls precisely (a naive {field:null} also matches missing).
    const explicitNulls = await db.collection(collection).countDocuments({
        [field]: { $eq: null, $exists: true }
    });
    console.log(`${collection}.${field}: ${explicitNulls} explicit-null doc(s)`);

    if (explicitNulls > 0 && !DRY_RUN) {
        const r = await db.collection(collection).updateMany(
            { [field]: { $eq: null, $exists: true } },
            { $unset: { [field]: '' } }
        );
        console.log(`  unset ${r.modifiedCount} doc(s)`);
    }

    // Ensure the index is sparse-unique (drop + recreate legacy non-sparse).
    const indexes = await db.collection(collection).indexes();
    const linkIdx = indexes.find((i) => i.key && Object.keys(i.key).length === 1 && i.key[field] === 1);
    if (linkIdx && !(linkIdx.sparse && linkIdx.unique)) {
        console.log(`  legacy index ${linkIdx.name} (sparse=${!!linkIdx.sparse} unique=${!!linkIdx.unique})`);
        if (!DRY_RUN) {
            await db.collection(collection).dropIndex(linkIdx.name);
            await db.collection(collection).createIndex({ [field]: 1 }, { unique: true, sparse: true });
            console.log('  rebuilt as sparse-unique');
        }
    } else if (linkIdx) {
        console.log(`  index ${linkIdx.name} already sparse-unique`);
    } else {
        console.log('  no link index found (will be created by ensure-indexes on boot)');
    }
}

await mongoose.disconnect();
console.log(DRY_RUN ? 'DRY RUN — no changes made' : 'done');
