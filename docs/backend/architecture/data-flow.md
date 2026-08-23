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
