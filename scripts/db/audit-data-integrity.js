// Sprint 04 pre-flight audits (T-DB-02/03): run against a production snapshot
// or staging BEFORE merging constraint-tightening changes.
//
//   node scripts/db/audit-data-integrity.js          # report only
//   FIX_RECEIPT_DUPLICATES=1 ...                     # dedupe treasury receipt numbers
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is required'); process.exit(1); }
await mongoose.connect(uri);
const db = mongoose.connection.db;

const countNegatives = async (col, field) => {
    const q = { [field]: { $lt: 0 } };
    return { col, field, n: await db.collection(col).countDocuments(q) };
};

console.log('=== T-DB-02: negative value scan ===');
const targets = [
    ['invoices', 'items.qty'], ['invoices', 'items.unitPrice'],
    ['invoices', 'subtotal'], ['invoices', 'tax'], ['invoices', 'total'],
    ['invoices', 'paidAmount'],
    ['salesreturns', 'refundAmount'],
    ['stockmovements', 'qty'],
    ['customers', 'creditLimit'], ['customers', 'paymentTerms'],
    ['purchaseorders', 'items.costPrice'],
];
for (const [col, field] of targets) {
    // dotted paths need aggregation
    const [parent, leaf] = field.split('.');
    let n;
    if (leaf) {
        n = await db.collection(col).countDocuments({
            $expr: { $lt: { $min: `$${parent}.${leaf}` }, $const: 0 },
        }).catch(() => -1);
    } else {
        n = await db.collection(col).countDocuments({ [field]: { $lt: 0 } });
    }
    console.log(`${col}.${field}: ${n < 0 ? 'ERR' : n} negatives`);
}

console.log('\n=== T-DB-03a: TreasuryTransaction.receiptNumber duplicates ===');
const dupes = await db.collection('treasurytransactions').aggregate([
    { $group: { _id: '$receiptNumber', n: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { n: { $gt: 1 }, _id: { $ne: null } } },
]).toArray();
console.log(`duplicate receiptNumbers: ${dupes.length}`);
if (dupes.length && process.env.FIX_RECEIPT_DUPLICATES) {
    for (const d of dupes) {
        for (let i = 1; i < d.ids.length; i++) {
            await db.collection('treasurytransactions').updateOne(
                { _id: d.ids[i] },
                { $set: { receiptNumber: `${d._id}-D${i}` } }
            );
            console.log(`suffixed ${d._id} -> ${d._id}-D${i}`);
        }
    }
}

console.log('\n=== T-DB-03b: InvoiceSettings active singletons ===');
const activeSettings = await db.collection('invoicesettings')
    .countDocuments({ isActive: true });
console.log(`active settings docs: ${activeSettings} (must be <=1)`);

console.log('\n=== T-DB-03c: Debt duplicate guard candidates ===');
const debtDupes = await db.collection('debts').aggregate([
    { $match: { status: { $ne: 'CANCELLED' }, referenceType: { $exists: true } } },
    { $group: { _id: { rt: '$referenceType', ri: '$referenceId', dt: '$debtorType', di: '$debtorId' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
]).toArray();
console.log(`conflicting debt groups: ${debtDupes.length}`);

console.log('\n=== T-DB-03d: Supplier.phone duplicates (non-empty) ===');
const phoneDupes = await db.collection('suppliers').aggregate([
    { $match: { phone: { $nin: [null, ''] } } },
    { $group: { _id: '$phone', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
]).toArray();
console.log(`duplicate phones: ${phoneDupes.length}`);

await mongoose.disconnect();
