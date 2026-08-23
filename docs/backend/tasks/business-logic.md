# Business Logic Tasks (Sprint 05) — each flow: transaction wrap + fault-injection test

## T-BIZ-01 — Payment flows all-or-nothing
Critical · CRITICAL (DATA-003)
- Wrap recordCustomerPayment / recordTotalCustomerPayment / recordSupplierPayment in withTransaction using Sprint-04 atomic primitives (T-DB-06); unified-payment loop iterates debts inside single session; failure → full rollback.
- Fault test: abort session after invoice update (inject via env-flagged test hook) → assert zero net change across invoice/debt/customer/treasury/cashbox.
- Acceptance: 3 flows covered; concurrency test: two simultaneous partial payments on one debt sum exactly.

## T-BIZ-02 — Returns flow integrity
High · HIGH (DATA-003)
- processSaleReturn wrapped in withTransaction (invoice items rewrite + SalesReturn create + stock $inc + treasury refund OR customer balance mutation). Fault test mid-sequence asserts zero net change.
- Acceptance: fault-injection green; concurrent return + payment on same invoice serialize correctly.

## T-BIZ-03 — Inventory counts, installments, opening balances
High · HIGH (DATA-003)
- completeCount: restore transaction (remove "Standalone Compatibility" removal); per-item adjustments conditional on current qty delta semantics documented (absolute set inside txn is safe against concurrent sales because txn conflicts abort).
- createInstallmentPlan: deleteMany+insertMany+debt.save inside one session.
- Customer/Supplier opening-balance trio inside one session.
- Fault tests ×3.

## T-BIZ-04 — PO receive idempotency guard
High · MEDIUM/HIGH (BIZ-001, DATA-003 slice)
- recordPurchaseReceive wrapped in withTransaction; PO transition via guarded `findOneAndUpdate({_id,status:{$ne:'RECEIVED'}},{$set:{status:'RECEIVED',...}})` — concurrent/double submit → 409 ConflictError; remove duplicate redundant save at purchaseOrderService.js:94-96.
- Fault test: abort after stock bulkWrite → stock unchanged; double-submit test: exactly one receive.

## T-BIZ-05 — verify-bank-integration script safety
Medium · MEDIUM (DATA-005)
- Add DRY_RUN=true default: compute-and-print intended writes; WRITE mode requires explicit env + `--write` flag; cleanup extended to reverse CashboxDaily increments (or recompute from transactions post-delete); refuse to run when MONGODB_URI looks like production (configurable PROD_URI_PATTERN).
- Testing: dry-run against memory server prints plan; write-mode + cleanup leaves zero residue.
