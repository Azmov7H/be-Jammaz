# Findings — MEDIUM (12)

## API-001 — Response envelope drift & duplicate surface
Audit doc 04 · three envelope shapes; settingsController raw res.json; duplicate mounts
(/api/purchases ≡ /api/purchase-orders), duplicate status-update + installments +
invoice-design endpoints; docs advertise nonexistent register endpoint. → Tasks: T-ARC-02, T-API-01

## VAL-002 — No array/numeric bounds anywhere
Audit doc 07 · only bound in codebase is unwired pagination limit.max(100); no maxima on
prices/amounts; no array length caps. → Task: T-VAL-03

## MONGO-004 — Document shape hygiene
Audit doc 08 · no maxlength anywhere; unbounded embedded arrays (Invoice.payments,
DailySales.invoices, CashboxDaily.manual*, Product.images, Supplier.products); Mixed fields
unvalidated. → Task: T-DB-08

## MONGO-005 — Model registration inconsistencies
Audit doc 08 · 4 patterns incl. Product's delete+dead guard and TreasuryTransaction import-time
UnifiedCollection registration. → Task: T-DB-08

## ERR-002 — Status-code hygiene
Audit doc 13 · authMiddleware 404 for deleted user; Arabic business Errors→500;
200+null for missing docs in several getByIds. → Task: T-API-02

## LOG-001 — Logging quality & PII
Audit doc 14 · emails in logs; debug logs in prod; morgan('dev'); no request IDs/structure.
→ Tasks: T-OPS-01, T-SEC-05

## PERF-003 — Treasury read-path design
Audit doc 15 · getCurrentBalance aggregates entire history per call; getSummary fans out to
4+ heavy reads and returns whole transaction list. → Task: T-PERF-03

## CLEAN-001 — Dead-code cluster
Audit doc 18 · validations/ triplication, exportService (unused), lib/api-response.js,
jsonwebtoken+jose duplication, jspdf deps. → Task: T-CLN-01

## CLEAN-002 — Role/enum inconsistencies
Audit docs 10/18 · accountant/sales roles have zero permissions; status enum casing mixed;
Product.unit free text vs schema enums disagreeing. → Task: T-CLN-02

## DATA-005 — verify-bank-integration script unsafe against live data
Audit doc 11 · writes fabricated transactions + mutates today's CashboxDaily; cleanup deletes
only /Verification/ transactions, never reverts cashbox. → Task: T-BIZ-05

## SEC-003 — CORS/NODE_ENV policy ambiguity
Audit doc 11 · origin-less requests allowed; all origins allowed whenever NODE_ENV≠production
(staging footgun); decisions undocumented. → Task: T-SEC-04

## BIZ-001 — PO receive double-execution race
Audit docs 09/10 · status if-check then proceed (purchaseOrderService.js:45-59, 80-106);
double-click double-receives stock. Also duplicate redundant save at :94-96. → Task: T-BIZ-04
