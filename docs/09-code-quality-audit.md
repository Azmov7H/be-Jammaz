# Code Quality Audit — Jammaz System

## Dead Code

### Unused Imports

| File | Unused Import | Impact |
|------|--------------|--------|
| `lib/validators.test.js` | `ZodError` import — file exists but may only have tests | Low (test file) |
| `services/invoiceService.js` | `mongoose` imported but may not be directly used beyond `models/` references | Low |
| `services/treasuryService.js` | `InvoiceSettings` imported and used | Actually used |
| `controllers/productController.js` | `z` imported and used for schemas | Actually used |

### Unused Files

| File | Evidence |
|------|----------|
| `lib/utils/dbUtils.js` | File not found — may have been removed or never created |
| `lib/utils/idUtils.js` | File not found — same as above |

### Unused Dependencies (from `package.json`)

| Dependency | Usage | Verdict |
|-----------|-------|---------|
| `jspdf` | Imported in `exportService.js` but `generatePDF` throws Error saying "PDF generation should be handled on client-side" | Unused/Placeholder |
| `jspdf-autotable` | Imported with `jspdf` in `exportService.js` | Unused |
| `google-auth-library` | Initialized as `OAuth2Client` in `authService.js` | Used for Google OAuth |
| `exceljs` | Used in `exportService.generateExcel()` | Used |
| `date-fns` | Used in `dashboardService.js`, `treasuryService.js`, `debtService.js` | Used |
| `express-mongo-sanitize` | Used in `index.js` | Used |
| `express-rate-limit` | Used in `index.js` | Used |
| `hpp` | Used in `index.js` | Used |
| `helmet` | Used in `index.js` | Used |
| `bcryptjs` | Used in `userService.js` and `physicalInventoryService.js` | Used |
| `zod` | Used in multiple controllers and validations | Used |

## Duplicate Code

### 1. Product Validation Schemas (Duplicate)

| File | Schema Fields | Difference |
|------|--------------|------------|
| `validations/product.schema.js` | name, code, brand, category, subsection, size, color, gender, season, unit, buyPrice, retailPrice, minProfitMargin, warehouseQty, shopQty, minLevel, images | No `gender` enum, no `isActive`, no `minLevel` default 5 |
| `controllers/productController.js` | name, code, buyPrice, retailPrice, wholesalePrice, specialPrice, category, brand, subsection, size, color, gender, season, minLevel, warehouseQty, shopQty, unit, isActive, images, gender enum: ['men','women','unisex','kids','none'] | Different gender enum values, has `isActive`, has `specialPrice` |

**Impact**: Any field change must be applied to both schemas. Testing one doesn't test the other. Frontend may use one while API uses the other.

### 2. Financial Calculation Paths (Duplicate/Inconsistent)

Invoice profit calculated in multiple places:
1. `InvoiceSchema.virtual('profit')` — `total - totalCost`
2. `InvoiceService._processInvoiceItems()` — per-item profit summation
3. `DailySalesService.updateDailySales()` — uses `invoice.totalCost`
4. `ReturnService.processSaleReturn()` — recalculates after return

Each path may produce slightly different results due to when `totalCost` is set and how it's computed.

### 3. Customer Balance Update Paths (Duplicate)

At least 4 code paths update `Customer.balance`:
1. `DebtService.createDebt()` — `+amount` when debt created
2. `DebtService.updateBalance()` — `-amountPaid` when payment applied
3. `PaymentService.recordCustomerPayment()` — `-amount` per payment
4. `PaymentService.recordTotalCustomerPayment()` — complex multi-debt allocation + remaining amount

Additionally, `SaleService.recordSale()` increments `totalPurchases` (different field), not `balance`.

### 4. Treasury Transaction Creation Patterns

Multiple services create `TreasuryTransaction` with similar structure but different fields:
- `invoiceService.js` / `saleService.js` → `TreasuryService.recordSaleIncome()`
- `invoiceService.js` / `paymentService.js` → `TreasuryService.recordPaymentCollection()`
- `treasuryService.js` directly → `TreasuryTransaction.create()` in multiple places
- `paymentService.js` → `TreasuryService.recordSupplierPayment()`, `recordCustomerPayment()`, `recordManualDebtPayment()`
- `expenseService.js` → `TreasuryService.addManualExpense()`
- `treasuryService.js` → `recordPurchaseExpense()`, `recordSupplierPayment()`, `recordDebtTransaction()`, `recordReturnRefund()`

Each method sets different `meta`, `method`, `referenceType`, etc. — inconsistent patterns.

### 5. Stock Adjustment Logic Duplication

- `StockService.adjustStock()` — general adjust function
- `StockService.bulkMoveStock()` — optimized bulk version
- `SaleService.recordSale()` → `StockService.reduceStockForSale()` — sale-specific
- `PurchaseService.recordPurchaseReceive()` → `StockService.increaseStockForPurchase()` — purchase-specific
- `ReturnService.processSaleReturn()` → `StockService.increaseStockForReturn()` — return-specific
- `PhysicalInventoryService.completeCount()` → `StockService.adjustStock()` — inventory adjustment

All 6 functions modify `warehouseQty`, `shopQty`, `stockQty` with slightly different logic and movement log creation.

## Weak Typing & `any` Usage

| File | Issue | Severity |
|------|-------|----------|
| Various services | `req.body` typed as `any` implicitly (no TypeScript) | HIGH — runtime errors from misspelled fields |
| `route-handler.js` | `sanitizeInput(data)` operates on generic `object` type | MEDIUM |
| Multiple places | String-based errors: `throw 'User not found'` instead of typed errors | HIGH — no compile-time checking |

## Inconsistent Naming Conventions

| Convention | Example | Issue |
|-----------|---------|-------|
| Arabic comments mixed with English code | Throughout | Normal for this project; not an issue |
| Arabic error messages | `throw 'البريد الإلكتروني مستخدم بالفعل'` | Consistent within project |
| Function camelCase | `reduceStockForSale`, `increaseStockForPurchase`, `getCurrentBalance` | Consistent |
| Route file names | `authRoutes.js`, `invoiceRoutes.js`, `physicalInventoryRoutes.js` | Mixed: some underscore, some hyphen patterns |
| Schema field names | `buyPrice`, `retailPrice`, `wholesalePrice`, `specialPrice` | Consistent (camelCase) |
| Model method names | `getPriceForProduct`, `getAll`, `findById` | Consistent |
| Route prefix | `/api/auth`, `/api/customers`, `/api/invoices` | Consistent |
| Variable names | `pid`, `pid`, `productMap`, `productIds` | Mostly consistent |
| Database field names | `warehouseQty`, `shopQty`, `stockQty`, `totalCost`, `profit` | Consistent camelCase |

## Commented-Out Code

1. **`PhysicalInventoryService.completeCount()`** — Lines 153-154, 228-239, 347-383:
   - `// const session = await mongoose.startSession();`
   - `// session.startTransaction();`
   - `// await session.commitTransaction();`
   - `// await session.abortTransaction();`
   - `// session.endSession();`
   - Comment: "Transaction Removed for Standalone Compatibility"
   - The `session` parameter is still referenced in the function signature but commented out in implementation

2. **`PhysicalInventoryService.unlockCount()`** — Similar commented-out transaction code

3. **`PhysicalInventorySchema.pre('save')`** in some models may have had previous versions

## Legacy Implementations

1. **Global mongoose caching** (`lib/db.js` line 16-20):
   ```javascript
   let cached = global.mongoose;
   if (!cached) {
       cached = global.mongoose = { conn: null, promise: null };
   }
   ```
   - Works for single-process development
   - Not suitable for production (memory leaks if process restarts, shared state issues)
   - This is a legacy pattern from earlier Node.js/Mongoose versions

2. **Buffer commands disabled globally**:
   ```javascript
   mongoose.set('bufferCommands', false);
   ```
   - Prevents the "buffering collection" warning
   - Means errors are immediate rather than wait-for-reconnect
   - May need reconnection logic added

3. **`InvoiceSettings` singleton pattern**:
   - `getSettings()` / `getSettingsBase()` ensures only one document exists
   - Creates empty doc if none exists
   - Legacy pattern; could be replaced with proper config collection

## Safe to Remove / Verify / Potentially Dangerous

| Category | Items | Status |
|-----------|-------|--------|
| **Safe to remove** | `lib/utils/dbUtils.js`, `lib/utils/idUtils.js` (both missing/not found) | Already absent |
| **Requires verification** | Duplicate product schemas, duplicate financial calculation paths, duplicate customer balance update paths | Need to consolidate |
| **Potentially dangerous to remove** | Global mongoose caching in `lib/db.js` — removing without replacement could break connection management | Keep but refactor |

## TODO/FIXME Comments

Searched for TODO/FIXME — no explicit TODO or FIXME strings found in the codebase through file reads. The commented-out transaction code has inline comments explaining removal.

## Summary of Code Quality Issues

| Category | Count | Severity |
|----------|-------|----------|
| Duplicate schemas/validations | 2 (product schemas) | HIGH |
| Duplicate business logic paths | 4+ (invoice profit, customer balance, stock adjustments) | CRITICAL |
| Dead code / Missing files | 2 (dbUtils, idUtils) | LOW |
| Inconsistent error handling | Strings vs AppError vs Error | HIGH |
| Commented-out transaction code | 3 blocks in physicalInventoryService | MEDIUM |
| Unexplained magic values | Various throughout | MEDIUM |
| No TypeScript | Entire backend is JS | MEDIUM (runtime errors) |