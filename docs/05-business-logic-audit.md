# Business Logic Audit — Jammaz System

## Executive Summary

The Jammaz ERP system has **multiple interconnected business logic paths** that produce **inconsistent results** for the same underlying data. The core problem is that financial calculations (invoice profit, customer balance, stock values) are computed in **at least 4-5 different code paths** without a single source of truth.

## Critical Business Logic Issues

### Issue BL-001: Invoice Profit Calculation Inconsistency

**Where it appears**:
1. `InvoiceSchema` virtual: `profit = total - totalCost` (model virtual)
2. `InvoiceService._processInvoiceItems()`: calculates `lineProfit = itemTotal - lineCost` per item, then sums
3. `DailySalesService.updateDailySales()`: `dailySales.totalCost += (invoice.totalCost || 0)`; `dailySales.grossProfit = totalRevenue - totalCost`
4. `ReturnService.processSaleReverse()`: recalculates profit after returns
5. `AccountingService.createSaleEntries()`: creates COGS entry with `invoice.totalCost`

**Problem**: Each path may produce slightly different `totalCost` values because:
- `invoice.totalCost` is set during invoice creation but may not be persisted reliably
- Item-level `costPrice` may differ from `product.buyPrice` at the time of sale
- The `profit` virtual on Invoice model reads `this.total - this.totalCost` but `totalCost` may be 0 or stale if not explicitly set

**Evidence**: In `invoiceService.js` line 53-54:
```javascript
const total = Number((subtotal + Number(tax)).toFixed(2));
const profit = total - totalCost;
```
And `totalCost` comes from `_processInvoiceItems` which uses `product.buyPrice` at time of invoice creation. But later, `Product.buyPrice` may have changed.

**Impact**: Financial reports show incorrect profit margins; customer profitability analysis is unreliable.

**Recommended Fix**: 
- Store `totalCost` explicitly on the Invoice document at creation time
- Use the stored value for all subsequent calculations (via the virtual or service methods)
- Remove inline cost calculation from item processing; compute from stored invoice data


### Issue BL-002: Customer Balance Drift

**Where it appears**:
1. `DebtService.createDebt()`: `Customer.findByIdAndUpdate({ $inc: { balance: amount } })`
2. `DebtService.updateBalance()`: `Customer.findByIdAndUpdate({ $inc: { balance: -amountPaid } })`
3. `PaymentService.recordCustomerPayment()`: `Customer.findByIdAndUpdate({ $inc: { balance: -amount } })` 
4. `PaymentService.recordTotalCustomerPayment()`: applies payments across multiple debts, then `Customer.findByIdAndUpdate({ $inc: { balance: -remainingAmount } })`
5. `SaleService.recordSale()`: `Customer.findByIdAndUpdate({ $inc: { totalPurchases: invoice.total } })` — this is `totalPurchases`, not `balance`
6. `TreasuryService.recordDebtTransaction()`: updates `CashboxDaily` fields

**Problem**: `Customer.balance` is the "net amount owed by customer" but it's modified by at least 4 independent code paths:
- When a debt is created → balance increased
- When a payment is applied → balance decreased
- When total customer payment is recorded → balance may be decreased for remaining amount
- The `balance` field has no formula — it's whatever the accumulation of these operations results in

**Evidence**: In `paymentService.js` line 59:
```javascript
await Customer.findByIdAndUpdate(invoice.customer, { $inc: { balance: -amount } });
```
But in `debtService.js` line 55-57:
```javascript
await Model.findByIdAndUpdate(debtorId, { $inc: { balance: amount } });
```
(The Model is Customer when debtorType === 'Customer')

**Impact**: Customer balance can become negative or incorrect over time; reports of "customer outstanding" are unreliable; collections prioritization based on balance may be wrong.

**Recommended Fix**:
- Choose **one source of truth** for customer balance
- Either: (a) derive balance from unpaid invoices/debts at query time, or (b) keep balance as a denormalized field but update it in exactly one place
- If keeping denormalized balance: remove all other `$inc` paths and use a single service function


### Issue BL-003: Stock Reduction Always from Shop (Potential Bug)

**Where it appears**:
1. `StockService.reduceStockForSale()`: always reduces from the specified `source` (shop or warehouse)
2. `SaleService.recordSale()`: calls `StockService.reduceStockForSale(invoice.items, invoice._id, userId, session)` — no source parameter passed, defaults to 'shop'
3. Comment in `stockService.js` line 15-16: `/**
    * Reduce stock when creating a sale (invoice)
    * Stock is ALWAYS reduced from SHOP
    */`

**Problem**: The function accepts a `source` parameter ('shop' or 'warehouse') but the comment says "Stock is ALWAYS reduced from SHOP". When `SaleService` calls it without a source, it defaults to... let me check.

Looking at `reduceStockForSale` signature: `async reduceStockForSale(items, invoiceId, userId, session = null)` — no `source` parameter in the call signature from `SaleService`.

But inside the function:
```javascript
const source = item.source || 'shop';
```
So it uses the item's `source` field, defaulting to 'shop' if not set.

**The real issue**: In `invoiceItemSchema` (invoiceController.js):
```javascript
source: z.enum(['shop', 'warehouse']).default('shop'),
```
So by default, items are sourced from 'shop'. This seems correct for the typical case.

**But wait** — looking more carefully at `reduceStockForSale` lines 38-44:
```javascript
if (source === 'warehouse') {
    if (product.warehouseQty < qty) throw new Error(`الكمية غير كافية في المخزن: ${product.name}`);
    product.warehouseQty -= qty;
} else {
    if (product.shopQty < qty) throw new Error(`الكمية غير كافية في المحل: ${product.name}`);
    product.shopQty -= qty;
}
```
This looks correct — it reduces from the specified source.

**However**, the comment says "Stock is ALWAYS reduced from SHOP" — and in practice, most sales are from the shop. This may be intentional for this business (all sales go through the shop, warehouse is backend storage).

**But there's a potential bug**: In `ProductSchema.pre('save')`:
```javascript
this.stockQty = (this.warehouseQty || 0) + (this.shopQty || 0);
```
This automatically recalculates `stockQty`. But if `reduceStockForSale` only reduces `shopQty` and doesn't update `stockQty` immediately (it does via bulkWrite), the sync should be fine because the bulk op sets both.

**Impact**: If the business wants to sell from warehouse, the item must explicitly set `source: 'warehouse'` and have sufficient `warehouseQty`. If not, the default 'shop' source is used. This is likely intentional.

**Recommended Fix**: 
- Clarify the intent in comments
- Ensure `item.source` is always set appropriately (default 'shop' seems correct for this business)
- Verify that `Product.stockQty` stays in sync (it does via pre-save middleware and bulk ops)


### Issue BL-004: Daily Sales — Credit vs Cash Classification

**Where it appears**: `DailySalesService.updateDailySales()` lines 62-66:
```javascript
if (invoice.paymentType === 'credit') {
    dailySales.creditSales = (dailySales.creditSales || 0) + invoice.total;
} else {
    dailySales.cashReceived += invoice.total;
}
```

**Problem**: The classification seems correct at first glance, but there's a subtlety:
- `paymentType` can be: 'cash', 'credit', 'bank', 'wallet', 'check'
- Only 'credit' is classified as credit sales; 'bank', 'wallet', 'check' all go to `cashReceived`
- This may misclassify non-cash payments as cash

**Evidence**: In `treasuryService.js`, payments are tracked by `method` (cash/bank/wallet/check), but in `dailySalesService.js`, only `paymentType === 'credit'` gets special treatment. All other payment types are lumped together as `cashReceived`.

**Impact**: Financial analysis incorrectly totals bank/wallet/check payments as "cash received" for daily sales tracking.


### Issue BL-005: Invoice Number Generation

**Where it appears**: `invoiceService.js` line 61:
```javascript
number: `INV-${Date.now()}`,
```

**Problem**: Uses `Date.now()` which is milliseconds since epoch. In high-concurrency scenarios, two invoices created in the same millisecond would have the same number. The `unique: true` constraint on the `number` field in the Invoice schema would cause a duplicate key error.

**Evidence**: `InvoiceSchema` line 4: `number: { type: String, required: true, unique: true }`

**Impact**: Invoice creation would fail with duplicate key errors under load. The `InvoiceSettings.lastReceiptNumber` exists for receipt numbers but is not used for invoice numbers.

**Recommended Fix**: Use a counter or UUID-based approach, or at minimum add a random suffix:
```javascript
number: `INV-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
```
Or use the receipt number sequence from `InvoiceSettings`.


### Issue BL-006: Purchase Order Received Date

**Where it appears**: 
- `purchaseService.js` line 23: `po.receivedDate = new Date();`
- `purchaseOrderService.js` line 94: `purchaseOrder.status = 'RECEIVED'; purchaseOrder.paymentType = finalPaymentType; await purchaseOrder.save();`

**Problem**: `receivedDate` is set to the current date when PO is received. But in `treasuryService.js.recordPurchaseExpense()`:
```javascript
date: purchaseOrder.receivedDate || new Date(),
```
If `receivedDate` is somehow null/undefined, it falls back to `new Date()`.

**Impact**: Minor — the received date accurately reflects when the PO was marked received. No critical business impact.


### Issue BL-007: Return Processing — Stock and Financial Reversal

**Where it appears**: `SaleService.reverseSale()` and `ReturnService.processSaleReturn()`

**Problem**: When an invoice is reversed:
1. `SaleService.reverseSale()` calls `StockService.increaseStockForReturn()` to add stock back
2. Calls `TreasuryService.deleteTransactionByRef('Invoice', invoice._id, session)` to remove treasury transactions
3. Calls `DailySalesService.reverseDailySales()` to reverse daily sales stats
4. Deletes the invoice document
5. Creates a `SalesReturn` document

But `ReturnService.processSaleReturn()` is a **separate code path** for processing returns **without deleting the invoice**. It:
1. Modifies the invoice items/qty/total/profit
2. Creates a `SalesReturn` document
3. Calls `StockService.increaseStockForReturn()` to add stock back
4. Handles financial settlement (cash refund or customer balance adjustment)

**The conflict**: Both paths call `StockService.increaseStockForReturn()` but with different data and intentions. If both are used interchangeably, stock could be double-counted or incorrectly adjusted.

**Impact**: Inventory inaccuracies if returns are processed through both paths; financial discrepancies between invoice profit and actual returned goods.

**Recommended Fix**: 
- Determine which path is the "official" return path
- If `SaleService.reverseSale()` is for invoice cancellation/deletion and `ReturnService.processSaleReturn()` is for partial returns, ensure they don't operate on the same data simultaneously
- Consider consolidating the stock adjustment logic


### Issue BL-008: Profit Margin Settings Not Enforced

**Where it appears**: 
- `product.schema.js` has `minProfitMargin: { type: Number, default: 0, min: 0, max: 100 }`
- `productService.js` `getMetadata()` returns brands/categories but not min profit margin
- `productController.js` schema includes `minLevel` but not `minProfitMargin` enforcement in business logic

**Problem**: The `minProfitMargin` field exists on the Product schema but is never enforced in business logic. There's no check that `retailPrice - buyPrice >= minProfitMargin` when creating/updating products.

**Impact**: Products can be created with negative or arbitrarily low profit margins; pricing strategies cannot be enforced at the database/application level.


### Issue BL-009: Customer Pricing — Custom Pricing vs Product Price

**Where it appears**:
- `CustomerSchema` has `customPricing: [{ productId, customPrice, setBy, setAt }]` — embedded document for per-customer custom prices
- `CustomerSchema.methods.getPriceForProduct()` returns `customPrice` if exists, otherwise `null`
- `customerRoutes.js` has `/:id/pricing` endpoint that fetches `PricingService.getCustomerPricing()`
- `pricingService.js` — not read in detail but referenced

**Problem**: There are **two pricing sources**:
1. Product `retailPrice` — the default price
2. Customer `customPricing` — override price for specific customer+product combos

The interaction between these two is unclear:
- When a customer has a custom price, which one is used at sale time?
- The invoice item has `unitPrice` set by the frontend — is it the retail price or the custom price?
- `invoiceItemSchema` doesn't reference custom pricing

**Impact**: Customers may be charged incorrect prices; revenue recognition may be wrong; sales reports don't reflect actual realized prices.


### Issue BL-010: Debt Status Inconsistency

**Where it appears**: `DebtSchema` status field can be: 'active', 'overdue', 'settled', 'written-off'

**Problem**: Debt status is updated in multiple places with different logic:
- `DebtService.updateBalance()`: auto-sets to 'settled' if `remainingAmount <= 0.01`, or re-evaluates based on `dueDate`
- `NotificationService.syncDebtReminders()`: creates notifications for status 'active' and 'overdue' debts
- `PaymentService.settleDebt()`: distributes payments across schedules

**Impact**: Debts may have incorrect status; notification system may send wrong alerts; aging reports may be inaccurate.


## Business Logic Priority Matrix

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| P0 | BL-001: Invoice profit calculation inconsistency | Financial reporting incorrect | HIGH |
| P0 | BL-002: Customer balance drift | Customer outstanding incorrect | HIGH |
| P1 | BL-003: Stock reduction logic clarification | Inventory accuracy | MEDIUM |
| P1 | BL-004: Daily sales payment classification | Daily sales analysis incorrect | MEDIUM |
| P2 | BL-005: Invoice number generation collision risk | Duplicate key errors under load | LOW |
| P2 | BL-007: Return processing code path conflict | Stock/financial double-counting | MEDIUM |
| P3 | BL-006: Purchase order received date | Minor | LOW |
| P3 | BL-008: minProfitMargin not enforced | Pricing not controlled | LOW |
| P3 | BL-009: Customer pricing vs product price confusion | Revenue recognition incorrect | MEDIUM |
| P3 | BL-010: Debt status inconsistency | Notification/aging reports incorrect | MEDIUM |