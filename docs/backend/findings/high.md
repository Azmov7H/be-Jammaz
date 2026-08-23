# Findings — HIGH (14)

## AUTH-002 — Google OAuth auto-provisions any account as cashier
Audit doc 05 · authService.js:56-66 creates users on first Google login, no invite/approval;
shared client mutation via setCredentials. → Tasks: T-AUTH-03

## AUTH-003 — Login enumeration + PII logging
Audit doc 05 · distinct "account disabled" error (authService.js:31) confirms emails;
email logged at authController.js:21; debug token logs in prod paths. → Task: T-AUTH-04

## DEP-001 — 17 dependency vulnerabilities
Audit doc 17 · incl. express-rate-limit IPv6 bypass (weakens RATE-001), body-parser DoS,
lodash/minimatch/tmp/brace-expansion family, uuid via exceljs. 1 critical advisory to be
identified during fix task. → Task: T-B00-02

## ERR-001 — Dual error pipelines mis-map statuses
Audit doc 13 · route-handler string heuristic sends Arabic not-found→500 and permission
failures→400; errorHandler produces different shape; AppError underused. → Task: T-ARC-01

## MONGO-001 — Missing indexes / unindexed hot fields / Log without TTL
Audit doc 08 · SalesReturn.originalInvoice+customer, Log.*, CollectionPeriod.*,
Supplier.*, ShortageReport.*, Invoice.dueDate/customerPhone, StockMovement.refId,
User.role/isActive. → Task: T-DB-01

## MONGO-002 — Money/qty fields lack min:0
Audit doc 08 · Invoice items/payments/paidAmount, PurchaseOrder lines, SalesReturn refunds,
StockMovement.qty ("always positive" comment unenforced), PhysicalInventory counts,
PriceHistory, Customer.creditLimit. Negative financial values accepted end-to-end today.
→ Task: T-DB-02

## MONGO-003 — Uniqueness policy holes
Audit doc 08 · TreasuryTransaction.receiptNumber explicitly unique:false; Supplier.phone not
unique while Customer.phone is; no singleton enforcement for InvoiceSettings. → Task: T-DB-03

## DATA-004 — Document numbers generated from Date.now()
Audit doc 09 · invoiceService.js:61 `INV-${Date.now()}`; returnService.js:100; purchaseOrderService.js:32.
Collisions throw E11000 → opaque 500. Atomic Counter exists and works. → Task: T-DB-04

## RATE-001 — Single weak global limiter; vulnerable version
Audit doc 12 · one in-memory IP bucket 100/15min for everything incl. dashboard bursts;
no auth-specific limits; IPv6 bypass until upgrade; multi-instance unsafe. → Task: T-SEC-02

## PERF-001 — Unbounded endpoints & full-collection scans on hot paths
Audit doc 15 · dashboard ~12 scans/unified call with no-$match totals; customer-profit full
history scan when dates omitted; users/logs/treasury/ledger/movements uncapped;
dead limit param getProductHistory. → Tasks: T-PERF-01, T-PERF-02

## PERF-002 — N+1 loops & deep populate fan-out
Audit doc 15 · treasuryService.deleteTransactionByRef per-tx findOne/save/delete loop;
getTransactions deep populate chain strictPopulate:false; notification sync loops. → Tasks: T-PERF-03, T-PERF-04

## ARCH-001 — Layering violations
Audit doc 02 · payment dispatcher + receipt assembly inline in financeRoutes; Product.find
inline in stockRoutes; pricing mapping in customerRoutes; persistence in settingsController;
repositories bypassed by services that also have repos. → Tasks: T-ARC-03, T-ARC-04

## DEVOPS-001 — Production-readiness gaps
Audit doc 19 · no graceful shutdown (SIGTERM kills in-flight writes), no 404 handler,
no request IDs, banner-only health, no CI, no Dockerfile, morgan('dev') in prod paths.
→ Tasks: T-OPS-01..05

## TEST-001 — No runnable test suite
Audit doc 16 · no runner configured; lib/validators.test.js imports nonexistent module;
only notificationService.test.js exists and runs nowhere. → Tasks: T-B00-03, T-TST-01..05
