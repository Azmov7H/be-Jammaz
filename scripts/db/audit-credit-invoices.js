// T-VAL-04 data check: credit invoices without a customer (report only).
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is required'); process.exit(1); }

await mongoose.connect(uri);
const n = await mongoose.connection.collection('invoices').countDocuments({
    paymentType: 'credit',
    $or: [{ customer: null }, { customer: { $exists: false } }],
});
console.log(`Credit invoices without customer: ${n}`);
if (n > 0) {
    const rows = await mongoose.connection.collection('invoices')
        .find({ paymentType: 'credit', $or: [{ customer: null }, { customer: { $exists: false } }] })
        .project({ number: 1, total: 1, date: 1, customerName: 1 })
        .limit(50).toArray();
    console.table(rows);
}
await mongoose.disconnect();
