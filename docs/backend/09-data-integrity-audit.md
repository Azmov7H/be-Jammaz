# 09 — Data Integrity & Concurrency Audit

## Transaction infrastructure

`utils/dbUtils.js#withTransaction` wraps `mongoose.startSession()`; **on unsupported
topologies it logs a warning and runs non-atomically anyway**. Only two flows use it:

- `InvoiceService.create` (invoiceService.js:47) — stock ↓, treasury, debt, daily-sales ✔
- `SaleService.reverseSale` (saleService.js:94) ✔

## Non-transactional multi-document financial writes (DATA-003)

| Flow | Writes | Failure window |
| ---- | ------ | -------------- |
| recordCustomerPayment (paymentService.js:46-76) | invoice.save → N× schedule.save → Debt.save + Customer $inc → TreasuryTransaction.create → CashboxDaily.save | invoice marked paid, debt not reduced / cashbox updated, schedule unpaid |
| recordTotalCustomerPayment (:81-160) | loop of the above across debts | partial application mid-loop |
| recordSupplierPayment (:165-214) | PO save → schedules → Debt/Customer → treasury | ditto |
| recordPurchaseReceive (purchaseService.js:15-58) | stock bulkWrite + insertMany + 3× po.save + treasury OR supplier debt | stock received, PO RECEIVED, no payment/debt record |
| processSaleReturn (returnService.js:60-139) | invoice items rewrite + SalesReturn + stock $inc + treasury refund OR customer balance | phantom returns/refunds |
| completeCount (physicalInventoryService.js:150-241) | count.complete + per-item product adjustments (**transaction deliberately removed**) | completed count, partially adjusted stock — unreconcilable |
| createInstallmentPlan (debtService.js:302-368) | deleteMany PENDING schedules → insertMany → debt.save | old schedules destroyed, new ones missing |
| Customer/Supplier create w/ opening balance | create + DebtService.createDebt + AccountingEntry.createEntry | orphaned party/debt |
| addManualIncome/Expense via expenseService | cashbox save ×2 + tx create (no session passed) | inconsistent daily position |

## Read-modify-write races (must become atomic)

### DATA-001 (CRITICAL): stock
```
reduceStockForSale (stockService.js:17-81):
  read product → if shopQty < qty throw → shopQty -= qty (JS) → bulkWrite($set)
```
Two concurrent sales both pass the check and both `$set` the same computed value → lost
update / hidden oversell. Same pattern in `increaseStockForPurchase` (which also computes
AVCO buyPrice in JS → concurrent receipts lose cost updates), `transferToShop/Warehouse`,
`moveStock`, `bulkMoveStock` (no sufficiency check at all; comment admits "Approximation").

Fix pattern: `findOneAndUpdate({_id, shopQty:{$gte:qty}}, {$inc:{shopQty:-qty}})` +
insert StockMovement only on success; AVCO needs transactional recompute or a queue.

### DATA-002 (CRITICAL): money balances
- `TreasuryService.updateDailyCashbox` (treasuryService.js:226-274): findOne → JS add → save.
  Callers outside transactions lose increments. Fix: `findOneAndUpdate($inc, upsert)`.
- `DebtService.updateBalance` (debtService.js:118-146): findById → subtract → save; called
  from every payment path usually **without** a session → concurrent payments drop one.
- `Invoice.recordPayment` (models/Invoice.js:65-88): push payment + reassign paidAmount → save;
  concurrent collections race; accepts negative amounts.

## Idempotency / state transitions

- PO receive: `if (po.status==='RECEIVED') throw` then proceed (purchaseOrderService.js:45-59,
  80-106) — classic check-then-act; double-click receives twice → double stock.
  Fix: guarded transition `findOneAndUpdate({_id,status:{$ne:'RECEIVED'}},...)`.
- Duplicate debts: createDebt does findOne-then-create with no unique index backing.
- Document numbers: INV-/RET-/PO- prefixed `Date.now()` (invoiceService.js:61, returnService.js:100,
  purchaseOrderService.js:32) — collision → E11000 → opaque 500. Counter.getNextSequence is
  already atomic and correct — adopt it everywhere (DATA-004).
- Receipt numbering: atomic `$inc` on InvoiceSettings.lastReceiptNumber ✔ but arbitrary-doc
  risk if >1 active settings doc; unify numbering authority.

## Where transactions are genuinely required

MongoDB replica set (Atlas default) supports them — remove the silent fallback and make
withTransaction hard-fail in production. Required coverage: payments (all three),
returns, purchase receive, physical-inventory completion, installment replacement,
opening-balance creation.

## Concurrency-sensitive operations register

| Operation | Guard today | Needed |
| --------- | ----------- | ------ |
| Sell stock | JS check + $set | conditional $inc |
| Receive purchase | none | conditional $inc + txn |
| Pay debt | RMW save | $inc + guarded remaining>=paid |
| Collect invoice payment | array push + save | $push + $inc atomic update |
| Cashbox mutation | RMW save | upsert $inc |
| PO receive | status if-check | findOneAndUpdate transition |
| Complete inventory count | none (txn removed) | txn or per-item conditional ops |
| Custom pricing edit | whole-customer save | positional array update |
