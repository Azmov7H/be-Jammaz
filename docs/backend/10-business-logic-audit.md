# 10 — Business Logic Audit

Domain: retail/wholesale ERP — sales invoices (cash/credit), purchases,
customer/supplier debts with installment plans, dual-location stock (warehouse/shop),
daily cashbox reconciliation, double-entry accounting mirror, physical counts.

## Critical rules and their state

| Rule | Implemented in | Duplicated? | Bypassable? | Atomic? | Tested? |
| ---- | -------------- | ----------- | ----------- | ------- | ------- |
| Credit sale requires a customer | zod `.refine` in validators.js — **dropped in the wired controller copy** | ×2 | yes today | n/a | ❌ |
| Stock sufficiency before sale | stockService RMW check | ×4 variants | race → oversell | ❌ DATA-001 | ❌ |
| AVCO cost averaging on purchase | increaseStockForPurchase JS math | once | concurrent receipts lose cost updates | ❌ | ❌ |
| Debt remaining decreases by payment | DebtService.updateBalance RMW | ×3 payment paths | concurrent payments drop one | ❌ DATA-002 | ❌ |
| Invoice paidAmount consistency | Invoice.recordPayment + direct mutations elsewhere | yes | races | ❌ | ❌ |
| Cashbox daily totals = transactions | updateDailyCashbox RMW + reconcile endpoint | ×2 writers | lost updates | ❌ | ❌ |
| Double-entry mirror of financial events | AccountingEntry.createEntry from services | call sites vary; coverage incomplete across flows | partially | ❌ | ❌ |
| PO received exactly once | status if-check | ×2 (receive / updateStatus) | double-click race | ❌ | ❌ |
| Count completion sets absolute quantities | completeCount loop | once | overwrites concurrent sales | ❌ (txn removed) | ❌ |
| Installment plan replaces pending schedules | deleteMany → insertMany | once | crash destroys both | ❌ | ❌ |
| Only owner unlocks counts (password gate) | service check behind unreachable route gate | once | nobody reaches it (ACL-001) | – | ❌ |
| Opening balance creates party+debt+GL entry | create services ×2 (customer/supplier) | yes | orphan risk | ❌ | ❌ |
| Low-stock threshold | per-product minLevel vs hardcoded 5 in DailyInventory.js:97 | contradictory | wrong alerts | n/a | ❌ |

## Contradictions between layers

1. Validation duplicates disagree (product name min length 1 vs 2 vs 3; unit enum vs free
   text; gender enum missing `none`) — the wired copy is the weakest.
2. DailyInventory uses fixed threshold 5 while Product.minLevel exists — reports contradict stock alerts.
3. Roles: User enum (`accountant`, `sales`) vs permission matrix (no entries for them → zero
   permissions) vs route gates (`admin`, exists nowhere).
4. Numbering authorities: `Date.now()` (INV/RET/PO) vs Counter (JE) vs InvoiceSettings `$inc` (receipts).
5. Status enum casing: lowercase (Debt/Invoice) vs UPPERCASE (PaymentSchedule) vs mixed
   (`PENDING/viewed/RESOLVED`, ShortageReport).

## State machines

- Invoice: implicit paymentStatus derivation; returns rewrite items post-hoc without a
  locked/final state → mutable paid history.
- PurchaseOrder: PENDING→PARTIAL→RECEIVED transitions enforced by if-checks only.
- PhysicalInventory: draft→completed→locked; unlock path unreachable via API.

## Edge cases unhandled

- Negative payment/refund amounts accepted at multiple entry points.
- Concurrent invoice creation during physical count completion.
- Clock dependence: daily documents keyed to server-local midnight (`startOfDay`);
  timezone strategy undocumented.

All rules above map to Sprint 04/05 tasks and Sprint 08 regression tests.
