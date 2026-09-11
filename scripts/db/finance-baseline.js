// T-01 — Financial baseline verification pack (READ-ONLY).
//
// Prints a reproducible before-state snapshot: negative-balance scan,
// TreasuryBalance-vs-ledger rebuild delta, CashboxDaily-vs-ledger
// cross-check (sizes the C2 double-count), and bank-volume counts.
// Exits non-zero if any unauthorized negative exists.
//
//   MONGODB_URI=mongodb://127.0.0.1:27017/transfer-erp node scripts/db/finance-baseline.js
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is required'); process.exit(1); }

await mongoose.connect(uri);
const db = mongoose.connection.db;
let failures = 0;
const check = (label, actual, expected = 0) => {
    const bad = actual !== expected;
    if (bad) failures += 1;
    console.log(`${bad ? 'FAIL' : 'ok'}  ${label}: ${actual}${bad ? ` (expected ${expected})` : ''}`);
};

console.log('=== 1. Negative-balance scan (must all be 0) ===');
check('customers.balance<0', await db.collection('customers').countDocuments({ balance: { $lt: 0 } }));
check('customers.creditBalance<0', await db.collection('customers').countDocuments({ creditBalance: { $lt: 0 } }));
check('suppliers.balance<0', await db.collection('suppliers').countDocuments({ balance: { $lt: 0 } }));
check('debts.remainingAmount<0', await db.collection('debts').countDocuments({ remainingAmount: { $lt: 0 } }));
const overOriginal = await db.collection('debts').countDocuments({
    $expr: { $gt: ['$remainingAmount', '$originalAmount'] }
});
check('debts.remaining>original', overOriginal);
const overpaidInv = await db.collection('invoices').countDocuments({
    $expr: { $gt: ['$paidAmount', '$total'] }
});
check('invoices.paidAmount>total', overpaidInv);

console.log('=== 2. TreasuryBalance vs ledger rebuild ===');
const agg = await db.collection('treasurytransactions').aggregate([
    { $group: {
        _id: null,
        income: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] } },
        expense: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] } }
    } }
]).toArray();
const rebuilt = (agg[0]?.income || 0) - (agg[0]?.expense || 0);
const stored = (await db.collection('treasurybalances').findOne({ _id: 'treasury' }))?.balance;
console.log(`ledger income=${agg[0]?.income || 0} expense=${agg[0]?.expense || 0}`);
console.log(`rebuilt=${rebuilt} stored=${stored} delta=${rebuilt - (stored || 0)}`);
if (Math.abs(rebuilt - (stored || 0)) > 0.01) { failures += 1; console.log('FAIL  treasury rebuild delta != 0'); }
else console.log('ok  treasury rebuild delta = 0');

console.log('=== 3. CashboxDaily vs ledger cross-check (C2 sizing) ===');
// Non-cash manual rows hit BOTH manual*[] and the method bucket when the
// double-count is present. Count them from the ledger side.
const manualNonCash = await db.collection('treasurytransactions').countDocuments({
    referenceType: 'Manual', method: { $in: ['bank', 'wallet', 'check', 'instapay'] }
});
console.log(`non-cash Manual ledger rows (double-count suspects): ${manualNonCash}`);
const cashboxAgg = await db.collection('cashboxdailies').aggregate([
    { $group: {
        _id: null,
        bucketNet: { $sum: {
            $add: ['$salesIncome', '$bankIncome', '$walletIncome', '$checkIncome', '$instapayIncome',
                { $subtract: ['$purchaseExpenses', 0] }, { $subtract: [0, '$bankExpenses'] },
                { $subtract: [0, '$walletExpenses'] }, { $subtract: [0, '$checkExpenses'] },
                { $subtract: [0, '$instapayExpenses'] }]
        } }
    } }
]).toArray();
console.log(`cashbox bucket-net sum (informational): ${cashboxAgg[0]?.bucketNet || 0}`);

console.log('=== 4. Bank-volume counts (T-08 scoping) ===');
for (const [col, q] of [
    ['treasurytransactions.method=bank', [{ method: 'bank' }]],
    ['invoices.paymentType=bank', [{ paymentType: 'bank' }]],
    ['invoices.payments.method=bank', [{ 'payments.method': 'bank' }]],
    ['purchaseorders.paymentType=bank', [{ paymentType: 'bank' }]],
    ['salesreturns.refundMethod=bank', [{ refundMethod: 'bank' }]],
]) {
    console.log(`${col}: ${await db.collection(col.split('.')[0]).countDocuments(q[0])}`);
}
const glBank = await db.collection('accountingentries').countDocuments({
    $or: [{ debitAccount: 'البنك / الحساب البنكي' }, { creditAccount: 'البنك / الحساب البنكي' }]
});
console.log(`accountingentries touching BANK account: ${glBank}`);
const bankDays = await db.collection('cashboxdailies').countDocuments({
    $or: [{ bankIncome: { $gt: 0 } }, { bankExpenses: { $gt: 0 } }]
});
console.log(`cashbox days with bank activity: ${bankDays}`);

console.log('=== 5. Collection sizes ===');
for (const c of ['customers', 'suppliers', 'debts', 'invoices', 'treasurytransactions', 'accountingentries', 'cashboxdailies']) {
    console.log(`${c}: ${await db.collection(c).countDocuments()}`);
}

await mongoose.disconnect();
console.log(failures === 0 ? 'BASELINE CLEAN' : `BASELINE FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
