# Data Flow & Ownership Map

## Write-path ownership (who mutates what)

| Aggregate | Writers today | Post-fix writers |
| --------- | ------------- | ---------------- |
| Product stock qty | stockService (RMW), physicalInventory, purchases | guarded $inc only (stockService + inventory txn) |
| Invoice | invoiceService.create(txn), paymentService (recordPayment save), returnService rewrite | create txn; payments/returns via atomic updates inside txns |
| Debt / Customer balance | debtService RMW, customer/supplier services, payments | conditional $inc inside txns |
| CashboxDaily | treasuryService RMW ×2 paths, reconcile, verify script | single upsert-$inc helper + reconcile (txn) |
| TreasuryTransaction | invoice/sale/payment/purchase/return/expense/manual/script creators | same set but all within txns; undo via owner gate |
| AccountingEntry | service call sites (partial coverage) | unchanged coverage question tracked as business decision |
| DailySales / DailyInventory | dailySalesService RMW; physicalInventory; dashboard? (read) | txn-wrapped mutations |
| User | userService (raw spread) → owner-gated validated path | |

## Numbering authorities (target: Counter only)

| Document | Today | Target |
| -------- | ----- | ------ |
| Invoice | `INV-${Date.now()}` | Counter INV-###### |
| SalesReturn | `RET-${Date.now()}` | Counter RET-###### |
| PurchaseOrder | `PO-${Date.now()}` | Counter PO-###### |
| AccountingEntry | Counter JE-###### ✔ | unchanged |
| Receipt no. | InvoiceSettings.$inc | migrate to Counter RCP-###### (T-DB-04 follow-up note) |

## Sensitive data classes

- Password hash: User.password → never serialized post T-SEC-01.
- Financial balances: notifications broadcast to roles (intended; documented).
- Logs: Log.diff allowlist convention; request logs body-free.

## Key invariants to protect (tested in Sprint 08)

1. cashboxDaily.totals == Σ treasuryTransactions per day per method.
2. debt.remainingAmount == originalAmount − Σ payments(≠refunded).
3. product.shopQty+warehouseQty == opening + Σ movements.
4. invoice.paidAmount == Σ invoice.payments.amount − refunds applied.
5. Every completed financial flow leaves ≥0 accounting-entry mirror or documented exception.

## Addendum: Query Performance Evidence (Sprint 07 / T-PERF-05)

Reproduce with `node scripts/perf/explain-evidence.js` against any environment
(read-only). Snapshot below taken on an empty dev database — index *selection*
is meaningful, doc counts are not. Re-run against a production-sized snapshot
before/after any index change.

| query | winning stage | index used |
| ----- | ------------- | ---------- |
| dashboard: recent invoices (`status != CANCELLED`, sort date -1) | FETCH | `date_-1` |
| list: product search (literal `$regex` on name/code) | SUBPLAN | per-$or-branch plan; prefix-anchored candidates benefit from `name_1`/`code_1` |
| list: customer search (literal regex name/phone) | SUBPLAN | same pattern |
| list: invoice by number (literal regex) | FETCH | `number_1` |
| treasury transactions window (30d) + sort | FETCH | `date_-1` |
| stock movements window + sort | SORT (in-mem after fetch) | — add `{date:-1}` compound if p95 regresses |
| daily-sales summary window | FETCH | `date_1` |
| accounting entries window + sort | SORT over IXSCAN | `date_1` |

Notes:
- All user-supplied search strings are escaped via `lib/safeRegex.js`
  (`literalContains`) — no metacharacter injection or catastrophic scans.
- Every list endpoint is bounded by `lib/paginate.js` (T-PERF-01): limit ≤ 100,
  windows ≤ 90d default unless documented (ledger/statement 365d,
  daily-sales 180d).
- `express.json({ limit: '1mb' })` decision: raised from the 100kb default to
  fit multi-line invoices with populated item arrays; do not raise further
  without measuring real payload sizes.
