# Database Tasks (Sprint 04) — isolation rules mandatory per task

Every task below must document in its PR: schema impact · index impact · existing-data
audit query + counts · migration/backfill need · rollback strategy · production risk.

## T-DB-01 — Index rollout + Log TTL
High · HIGH (MONGO-001)
- Add: SalesReturn {originalInvoice}, {customer}; Log {userId},{entityId},{date} + TTL (90d default, env-configurable); CollectionPeriod {debtId},{assignedTo,status}; Supplier {name},{isActive}; ShortageReport {product},{status}; Invoice {dueDate}; StockMovement {refId}; User {role},{isActive}.
- Pre-flight: explain() on representative queries before/after; script scripts/db/ensure-indexes.js diffing model indexes vs actual.
- Rollback: dropping added indexes is safe.

## T-DB-02 — Money/quantity min:0 constraints
Critical support · HIGH (MONGO-002)
- Add min:0 to: Invoice qty/unitPrice/subtotal/tax/total/paidAmount/payments.amount/costPrice/profit(≥0? no—allow 0, profit can be negative only if below-cost sales allowed → decision recorded; default min 0 with explicit exception note); PurchaseOrder items; SalesReturn refund fields; StockMovement.qty(min 1); PhysicalInventory systemQty/actualQty; PriceHistory prices; Customer.creditLimit/paymentTerms/customPrice.
- Pre-flight audit queries counting negative values per field; owner sign-off on any found (data fix or constraint exception).
- Rollback: schema revert; constraints are validation-time only (no backfill unless violators found).

## T-DB-03 — Uniqueness repairs
High · HIGH (MONGO-003)
- receiptNumber: pre-flight duplicate check on TreasuryTransaction.receiptNumber → dedupe script if needed (append suffix strategy) → set unique index.
- Supplier.phone: decision — match Customer uniqueness? Default YES after dupe-check.
- InvoiceSettings singleton: partial unique index `{isActive:1}` where `isActive:true`; ensure exactly one active doc in migration script.
- Debt duplicate-guard compound unique `{referenceType,referenceId,debtorType,debtorId}` partial where status≠CANCELLED — dupe-check first.

## T-DB-04 — Counter-based document numbering
High · HIGH (DATA-004)
- Extend Counter usage: INV-, RET-, PO- via getNextSequence (atomic as-is); format `INV-000001` continuing after max existing sequence (migration seeds counters from current maxima); keep Date.now fallback? NO — single authority.
- Acceptance: parallel create test yields gapless unique numbers.

## T-DB-05 — Atomic stock mutations
Critical · CRITICAL (DATA-001)
- Replace RMW: conditional `findOneAndUpdate({_id, shopQty:{$gte:qty}},{$inc:{shopQty:-qty}},session)` pattern across reduce/increase/transfer/move/bulkMove; bulkMove loops guarded updates or bulkWrite with post-check verification + compensating $inc on shortfall inside transaction; movement ledger insert only after successful mutation.
- AVCO buyPrice recompute moved into transactional block (uses session reads).
- Testing: Promise.all 50 concurrent sales of stock=10 → exactly 10 succeed, final qty 0; ledger rows == successes. This test migrates to Sprint 08 suite.

## T-DB-06 — Atomic balance mutations
Critical · CRITICAL (DATA-002)
- updateDailyCashbox → `findOneAndUpdate({date},{[$inc]:{[field]:amount}},upsert:true,session)`.
- DebtService.updateBalance → `findOneAndUpdate({_id,remainingAmount:{$gte:paid}},{$inc:{remainingAmount:-paid}})` + status flip conditionally; customer $inc unchanged (already atomic).
- Invoice.recordPayment → `updateOne({_id,paidAmount:...guard}, {$push:{payments},$inc:{paidAmount}})` or transactional recompute; negative amounts rejected at entry.
- Testing mirrors T-DB-05 concurrency style.

## T-DB-07 — Transaction infrastructure hardened
Critical · CRITICAL (DATA-003 infra)
- utils/dbUtils.withTransaction: remove silent fallback → in production throw on unsupported topology (dev standalone: loud env flag ALLOW_NON_ATOMIC_DEV=true required); retry-on-TransientTransactionError helper; sessions threaded through all called services (signature changes documented).
- Acceptance: boot against standalone without flag = startup warning + tests skipped-with-marker; Atlas path fully atomic.

## T-DB-08 — Schema hygiene + registration unification
Medium · MEDIUM (MONGO-004/005)
- maxlengths (name≤200, notes≤2000, phone≤20 etc.), array caps mirroring T-VAL-03, Log.diff writer allowlist doc comment; unify registration to standard guard; remove Product dead-guard delete; delete UnifiedCollection import side-effect (move to dedicated model file if referenced).
- Rollback: pure refactor + soft constraints; VERIFY class — full suite green required.
