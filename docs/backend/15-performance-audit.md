# 15 — Performance Audit

## API hot paths

| Path | Cost today | Evidence |
| ---- | ---------- | -------- |
| GET /api/dashboard (unified) | ~12 collection scans: full Invoice $group with no $match, StockMovement grouped ×3 over all history, Product/Customer/Supplier aggregates; no caching | dashboardService.js:68-157, 194-254 — PERF-001 |
| GET /api/reports/customer-profit | empty date range → groups **every invoice ever** + per-customer $lookup | reportingService.js:96-101 |
| GET /api/reports/financial | undefined dates passed raw into $match | reportRoutes.js:49-51, reportingService.js:33,49 |
| GET /api/treasury/balance | full-collection aggregation over all TreasuryTransactions, no bound | treasuryService.js:416-441 — PERF-003 |
| GET /api/treasury/summary | getTransactions (deep populate chain) + 3 aggregations + getCurrentBalance + full tx list in payload | treasuryService.js:508-588 |
| GET /api/stock/movements | range-bounded but row-uncapped on fastest-growing table | stockService.js:328-345 |
| getProductHistory | **dead limit param** — signature has `limit=50`, never applied | stockService.js:316-323 |

## Unbounded list endpoints (PERF-001)

users · logs/:entity/:id · treasury transactions (+financial variants) · physical-inventory
list · accounting ledger · daily-sales summary/best-sellers. Fix = shared pagination helper
+ hard caps.

## Node.js process

- No blocking sync work found in request paths (no fs/sync loops) ✔.
- bcrypt only on login/user-create ✔.
- Memory: no in-process caches to leak; morgan negligible.
- Compression absent (PERF-004, LOW) — JSON payloads from summary/report endpoints can be large.

## MongoDB

- Indexes: see 08-mongodb-audit.md MONGO-001. Biggest wins: StockMovement {productId,date}
  exists ✔ but refId unindexed; SalesReturn.originalInvoice unindexed (per-invoice return lookups);
  Log fully unindexed.
- N+1 patterns (PERF-002): `deleteTransactionByRef` loops findOne→mutate→save→delete per
  transaction (treasuryService.js:659-699); notificationService.sync*Alerts issues per-item
  creates in read loops.
- Connection pool defaults OK for single instance; revisit under load test (Sprint 11).

## Scalability verdict

- Single instance/containerized: workable after Sprint 04/07.
- Multiple instances: blocked by in-memory rate limiter and any future in-memory caches;
  document as deployment constraint until redis store added.
- Serverless: not recommended (persistent mongoose pool, in-memory limiter); Vercel hosts the
  frontend only — keep backend on a long-running host.

## explain() protocol

Each PERF task must attach before/after `db.collection.find(...).explain("executionStats")`
(or aggregate explain) capturing totalKeysExamined/totalDocsExamined/millis into its task file.
