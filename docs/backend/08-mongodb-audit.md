# 08 — MongoDB & Mongoose Audit

## Model-by-model (24 collections)

Condensed; ✔ = present, ✗ = missing.

| Model | Unique constraints | Indexes | Money/qty min:0 | Notable |
| ----- | ------------------ | ------- | --------------- | ------- |
| AccountingEntry | entryNumber ✔ | good (date, accounts, ref) | amount ✔ | delete-then-register pattern |
| CashboxDaily | date unique ✔ | date, isReconciled | income/expense ✔; opening/closing no min | unbounded manual arrays |
| CollectionPeriod | ✗ | **none** | – | debtId/assignedTo/status unindexed |
| Counter | _id | – | – | atomic `$inc` upsert — correct; not session-aware |
| Customer | phone unique ✔ | rich incl. text idx | balance/creditLimit/customPrice **no bounds** | negative creditLimit allowed |
| DailyInventory | date unique ✔ | date | qtys ✔; buyPrice/value no min | hardcoded low-stock threshold 5 |
| DailySales | date unique ✔ | date | ✔ (profits may be neg., OK) | invoices[]/topProducts[] unbounded |
| Debt | ✗ (compound non-unique only) | debtor+status, dueDate+status ✔ | amounts ✔ | currency free string; duplicate-creation race |
| Invoice | number unique ✔ | date, customer, paymentStatus ✔ | **none** on qty/unitPrice/total/paidAmount/tax/payments[] | recordPayment accepts negatives |
| InvoiceSettings | ✗ singleton enforcement | none | thresholds unbounded | lastReceiptNumber seq lives here |
| Log | ✗ | **none**, no TTL | – | grows forever; diff Mixed unvalidated |
| Notification | – | good + TTL expiresAt ✔ | – | best-modeled collection |
| PaymentSchedule | – | entity+status, dueDate ✔ | amount ✔ | status casing differs from Debt/Invoice |
| PhysicalInventory | – | date/location/status ✔ | systemQty/actualQty **no min** | negative counts possible |
| PriceHistory | – | productId, type, date ✔ | old/new price no min | |
| Product | code unique ✔ | many ✔ | prices ✔; minLevel/opening* no min | **no barcode field**; images[] unbounded; dead registration guard |
| PurchaseOrder | poNumber unique ✔ | supplier/status/date ✔ | items qty/cost/received/paid **no min** | |
| SalesReturn | returnNumber unique ✔ | **originalInvoice/customer unindexed** | refund fields no min | delete-then-register |
| ShortageReport | ✗ | **none** | requested/available no min | enum mixes `PENDING/viewed/RESOLVED` casing |
| StockMovement | – | {productId,date} ✔; refId(String) unindexed | qty "always positive" comment, unenforced | type enum lacks 'RETURN' |
| Supplier | **phone NOT unique** (vs Customer) | **none** | balance no bounds | products[] unbounded |
| SystemMeta | key unique ✔ | – | – | |
| TreasuryTransaction | receiptNumber **explicitly unique:false** | type/date combos ✔ | amount ✔ | import-time UnifiedCollection side effect |
| User | email unique ✔ | role/isActive ✗ | – | password no select:false/minlength |

## MONGO-001 (HIGH): missing indexes
Priority order: SalesReturn.originalInvoice/customer · Log.userId/entityId/date (+TTL) ·
CollectionPeriod.* · Supplier.name/isActive/balance · ShortageReport.product/status ·
Invoice.dueDate/customerPhone · StockMovement.refId · User.role/isActive.

## MONGO-002 (HIGH): money/quantity constraint gaps
Listed per model above; fix at schema layer because controllers don't guarantee it.
Negative invoice line items / payments / PO lines are accepted today.

## MONGO-003 (HIGH): uniqueness policy holes
receiptNumber explicitly non-unique · Supplier.phone inconsistent with Customer.phone ·
no partial unique index enforcing a single active InvoiceSettings doc
(recommended: partial unique on `{isActive:1}` where isActive=true).

## MONGO-004 (MEDIUM): document shape hygiene
No maxlength on any string field in any model. Unbounded embedded arrays
(Invoice.payments, DailySales.invoices, CashboxDaily.manual*, Product.images,
Supplier.products). Mixed-typed fields without validation (Log.diff, Debt.meta).

## MONGO-005 (MEDIUM): model registration inconsistencies
Four coexisting patterns: standard guard (majority); delete-then-register
(AccountingEntry, SalesReturn); **delete + dead guard** (Product.js:76-80 — guard can
never hit); import-time global side effect (TreasuryTransaction registering
`UnifiedCollection` on the customers collection). Unify on the standard guard.

## Mongoose usage audit

- populate: moderate use; worst case treasuryService.getTransactions deep chain
  (`referenceId → customer/supplier/debtorId`, strictPopulate:false) — see PERF-003.
- lean(): used inconsistently (stock history yes; ledger no).
- Query/document middleware: minimal (AccountingEntry pre-save counter) — fine.
- Aggregations: dashboardService runs ~12 per unified dashboard call with several
  full-collection `$group`s and no `$match` on totals (dashboardService.js:147).
- bufferCommands disabled globally (lib/db.js) — good fail-fast posture.
- Connection pooling defaults; socketTimeoutMS 45s; acceptable single-instance.

## explain() validation plan

Every Sprint-07 optimization task must attach before/after `explain("executionStats")`
output (IXSCAN vs COLLSCAN, totalDocsExamined) into its task file before merge.
