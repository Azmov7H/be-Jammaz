// T-PERF-05: explain("executionStats") evidence for the top-10 hot queries.
// Usage: node scripts/perf/explain-evidence.js
// Requires a reachable MONGODB_URI (read-only — safe against production).
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../../models/Invoice.js';
import Product from '../../models/Product.js';
import Customer from '../../models/Customer.js';
import TreasuryTransaction from '../../models/TreasuryTransaction.js';
import StockMovement from '../../models/StockMovement.js';
import DailySales from '../../models/DailySales.js';
import AccountingEntry from '../../models/AccountingEntry.js';

const probe = { $regex: 'probe', $options: 'i' };
const d30 = () => new Date(Date.now() - 30 * 86400000);

function findIndexStage(plan) {
    let cur = plan;
    while (cur && cur.stage !== 'IXSCAN') cur = cur.inputStage;
    return cur?.indexName ?? null;
}

async function record(out, name, model, query, sort = null) {
    let explain;
    if (sort) explain = await model.find(query).sort(sort).explain('executionStats');
    else explain = await model.find(query).explain('executionStats');
    const s = explain.executionStats ?? {};
    const win = explain.queryPlanner?.winningPlan ?? {};
    out.push({
        name,
        stage: win.stage,
        index: findIndexStage(win),
        docsExamined: s.totalDocsExamined,
        nReturned: s.nReturned,
        ms: s.executionTimeMillis
    });
}

const out = [];
const now = new Date();
const start = d30();

await mongoose.connect(process.env.MONGODB_URI);

await record(out, 'dashboard: recent invoices', Invoice, { status: { $ne: 'CANCELLED' } }, { date: -1 });
await record(out, 'dashboard: low stock products', Product, { isActive: true });
await record(out, 'list: product search (literal regex)', Product, { $or: [{ name: probe }, { code: probe }] });
await record(out, 'list: customer search (literal regex)', Customer, { $or: [{ name: probe }, { phone: probe }] });
await record(out, 'list: invoice search by number', Invoice, { number: probe });
await record(out, 'treasury: transactions window', TreasuryTransaction, { date: { $gte: start, $lte: now } }, { date: -1 });
await record(out, 'stock: movements window', StockMovement, { date: { $gte: start, $lte: now } }, { date: -1 });
await record(out, 'daily-sales: summary window', DailySales, { date: { $gte: start, $lte: now } }, { date: -1 });
await record(out, 'accounting: entries window', AccountingEntry, { date: { $gte: start, $lte: now } }, { date: -1, createdAt: -1 });

console.log(JSON.stringify(out, null, 2));
await mongoose.disconnect();
