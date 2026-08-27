# Backend Audit — Jammaz System

## API Layer

### Routes Analysis

| Route File | Endpoints | Auth Required | Role Restrictions |
|-----------|-----------|---------------|-------------------|
| `authRoutes.js` | login, logout, session, google/callback | ✓ (login/logout) | None (public login) |
| `userRoutes.js` | getAll, getById, create, update, delete | ✓ | owner, manager only |
| `customerRoutes.js` | getAll, getById, create, update, delete, pricing, statement, pay | ✓ | owner, manager for CRUD; others limited |
| `productRoutes.js` | getAll, getById, create, update, delete, metadata | ✓ | owner, manager for CRUD |
| `invoiceRoutes.js` | getAll, getById, create, getReturns, createReturn, delete | ✓ | admin for delete |
| `purchaseRoutes.js` | getAll, getById, create, updateStatus, receive, delete | ✓ | admin/manager for status/receive |
| `reportRoutes.js` | dashboard, stats, KPIs, strategy, sales, shortage, inventory, financial, customer-profit, price-history | ✓ | owner, manager for dashboard; others limited |
| `supplierRoutes.js` | (not fully read) | ✓ | likely manager/owner |
| `stockRoutes.js` | (not fully read) | ✓ | likely manager/owner |
| `treasuryRoutes.js` | balance, summary, daily, reconcile, transactions, manual-income, manual-expense, undo-transaction | ✓ | admin for undo |
| `physicalInventoryRoutes.js` | getCounts, getById, updateQuantities, complete, unlock, delete, report | ✓ | admin/manager for complete/unlock |
| `settingsRoutes.js` | (not fully read) | ✓ | likely owner/manager |
| `accountingRoutes.js` | ledger, trial-balance, entries, manual-expense, manual-income | ✓ | owner, manager |
| `docsRoutes.js` | root docs endpoint | ✓ | public (no auth) |

### Key API Issues

1. **Duplicate route handler**: `purchaseRoutes.js` registers both `/api/purchases` and `/api/purchase-orders` pointing to the same router — alias for frontend compatibility.

2. **Inconsistent auth patterns**: 
   - Some routes use `router.use(authMiddleware)` then `roleMiddleware`
   - Some use only `authMiddleware`
   - Some routes dynamically import services inside route handlers (e.g., `customerRoutes.js` pricing/statement/pay endpoints)

3. **Report routes have dual role protection**: `reportRoutes.js` uses `authMiddleware` globally, then some endpoints add `roleMiddleware` on top. The dashboard endpoints are accessible to owner/manager.

4. **`/api` prefix on reportRoutes**: `app.use('/api', reportRoutes);` means all report routes are under `/api/report/...` — but the routes define `/dashboard`, `/reports/sales`, etc. This creates `/api/dashboard`, `/api/reports/sales` — the `/api` prefix from app.js plus the route path.

### Service Layer Issues

1. **`dbConnect()` called excessively**: Many services call `await dbConnect()` independently. This creates separate connections rather than using a shared session. Critical operations like `InvoiceService.create()` → `SaleService.recordSale()` → multiple `dbConnect()` calls.

2. **Transaction management is inconsistent**:
   - Some paths use `withTransaction` from `dbUtils.js` (which was not found — file missing)
   - Some use mongoose sessions manually
   - Many critical paths (invoice creation, purchase receiving) do NOT use sessions at all
   - `SaleService.recordSale()` does not use a session despite modifying stock, treasury, daily sales, and customer balance

3. **Duplicate logic across services**:
   - Customer balance updated in `DebtService.updateBalance`, `PaymentService.recordCustomerPayment`, `PaymentService.recordTotalCustomerPayment`, and directly in `SaleService.recordSale`
   - Treasury transaction creation duplicated patterns across `financial/` services

4. **Missing validation in some paths**: 
   - `invoiceItemSchema` in `invoiceController.js` has `productId: z.string().optional().nullable()` — allows items without product IDs (service items)
   - But `ProductService.getAll()` filters `isActive: true` by default — service items may not be properly tracked

### Repository Layer Issues

1. **Inconsistent repository methods**:
   - `UserRepository`: `findByEmail`, `findById`, `create`, `update`
   - `InvoiceRepository`: `findById`, `create`, `findAll`, `count`, `delete`
   - `ProductRepository`: `findById`, `findByCode`, `findAll`, `count`, `findByIds`
   - `CustomerRepository`: Not read in detail but referenced

2. **`findAll` signature variance**: Some take `{query, skip, limit}`, others take `{query = {}, skip = 0, limit = 50}` — inconsistent but functional.

3. **No population control** in some repo methods — e.g., `ProductRepository.findAll()` does not populate by default, while `InvoiceRepository.findById()` does populate.

### Controller Layer Issues

1. **Response format inconsistency**:
   - `routeHandler` produces `{ success, data, message, timestamp }`
   - `ApiResponse.success/list/single` produce different structures
   - Some controllers return raw Mongoose documents, some return service results

2. **Error handling mix**:
   - `routeHandler` catches errors and calls `handleError`
   - `errorHandler` middleware handles errors globally
   - Some controllers throw `AppError`, some throw strings
   - Some errors bypass `routeHandler` and go directly to global handler

3. **`authController` returns user directly**: `login` returns `result.user` instead of using the standard response format. This means the frontend receives different structures for auth vs. other endpoints.

## Database Audit

### Schema Overview

| Model | Key Fields | Indexes | Concerns |
|-------|-----------|---------|----------|
| **User** | name, email, password, role, isActive | email (unique), role | Password stored as bcrypt hash; role enum has 6 values + 'accountant', 'sales' |
| **Product** | name, code, buyPrice, retailPrice, warehouseQty, shopQty, stockQty, minLevel, isActive | name, code, stockQty, warehouseQty+shopQty | `pre('save')` syncs stockQty; code is unique |
| **Customer** | name, phone, balance, creditBalance, creditLimit, isActive, customPricing | phone (unique), balance, name, totalPurchases | Custom pricing in embedded array; balance tracking is critical |
| **Invoice** | items, subtotal, tax, total, paymentStatus, paidAmount, dueDate, customer, createdBy | date, customer, paymentStatus+date | Virtual `remainingBalance`; payment tracking |
| **InvoiceSettings** | company info, design, notification thresholds, receipt sequence | isActive | Singleton pattern; controls invoicing behavior |
| **PhysicalInventory** | items (embedded), location, status, totalShortage, totalSurplus, netDifference, valueImpact | date, location, status | Pre-save middleware calculates discrepancies |
| **StockMovement** | productId, type, qty, note, refId, createdBy, snapshot | productId+date | Full audit trail for all stock changes |
| **DailySales** | date (unique), totalRevenue, totalCost, invoiceCount, itemsSold, cashReceived, creditSales, topProducts, invoices | date | One document per day; snapshotted product data |
| **PaymentSchedule** | entityType, entityId, debtId, amount, dueDate, status | entityType+entityId+status, dueDate+status | Installment planning |
| **Debt** | debtorType, debtorId, originalAmount, remainingAmount, dueDate, status, referenceType, referenceId | debtorType+debtorId+status, dueDate+status | Core receivables/payables tracking |
| **CashboxDaily** | date (unique), opening/closing balances, income/expense breakdown by method, manual entries | date, isReconciled | Daily cash summary; reconciliation possible |
| **TreasuryTransaction** | type, amount, description, referenceType, referenceId, partnerId, method, createdBy | type+date, type+referenceType+date | All financial transactions audit trail |
| **SalesReturn** | originalInvoice, items, totalRefund, refundMethod, customerBalanceAdded, treasuryDeducted | None | Sales return tracking |

### Database Concerns

1. **No financial transaction isolation**: Invoice-Product-Stock-Treasury-Customer balance all updated in separate operations without multi-document transactions. If one fails, others may be left in inconsistent state.

2. **Customer balance drift risk** (identified in current state):
   - `Customer.balance` incremented when debt created
   - `Customer.balance` decremented when payment recorded
   - Multiple code paths modify the same field
   - No single source of truth for "what is the customer's actual balance?"

3. **Invoice number generation** uses `Date.now()` — collision possible in high-throughput scenarios. `InvoiceSettings.lastReceiptNumber` exists but is used for receipt numbers, not invoice numbers.

4. **`PhysicalInventory` pre-save middleware** calculates `difference`, `value`, `totalShortage`, `totalSurplus`, `netDifference`, `valueImpact` — good, but the `completeCount` method has commented-out transaction code.

5. **No compound indexes for common report queries** — e.g., customer unpaid invoices require `$match: { paymentStatus: 'pending', paymentType: 'credit', dueDate: { $lt: now } }` which could be slow without proper indexes.

6. **`TreasureTransaction` reference system** uses `referenceType` enum + `referenceId` — flexible but makes querying for specific entity transactions more complex.

7. **`DailySales` unique date index** — prevents multiple daily records but means if a day's data needs to be re-processed, the old record must be deleted first.

## Error Handling Audit

### Route Handler (`lib/route-handler.js`)

```javascript
export const routeHandler = (fn) => async (req, res, next) => {
    try {
        // Sanitize inputs
        if (req.params) sanitizeInput(req.params);
        if (req.query) sanitizeInput(req.query);
        const result = await fn(req, res, next);
        if (res.headersSent) return;
        res.status(200).json({ success: true, data: result || null, message: null, timestamp: new Date().toISOString() });
    } catch (error) {
        handleError(error, res);
    }
};
```

**Strengths**:
- Consistent try/catch pattern
- Input sanitization as secondary defense
- Double-send prevention (`res.headersSent`)
- Standard success response format

**Weaknesses**:
- `handleError` is the single point of error classification — if it misses a type, the error bubbles to global handler
- Zod errors are well-handled; string errors have partial handling
- Mongoose `ValidationError` handled but not all error types
- No specific logging of error context (req ID, user, etc.)

### Global Error Handler (`middlewares/errorHandler.js`)

```javascript
export const errorHandler = (err, req, res, next) => {
    console.error('❌ Error:', err);
    const statusCode = err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === 'production';
    const message = isProduction && statusCode === 500 ? 'حدث خطأ في النظام' : err.message || 'Internal Server Error';
    res.status(statusCode).json({ success: false, error: message, stack: isProduction ? undefined : err.stack });
};
```

**Strengths**:
- Production mode hides raw error messages
- Stack traces only in development
- Uses `AppError.statusCode` if available

**Weaknesses**:
- String errors (throw 'User not found') will have `err.message = 'User not found'` — status code defaults to 500 unless string ends with 'not found' → 404
- `AppError` class sets `statusCode` but many services throw strings instead
- `res.headersSent` not checked — could double-send if route handler already sent response
- No structured error ID or tracking

### Service Layer Error Handling

- **Inconsistent**: Some throw `AppError` with status codes, some throw strings, some throw `Error`
- `invoiceService.js` uses `throw new AppError('Product not found', 404)` and `throw new AppError('كود المنتج موجود مسبقاً', 409)`
- `userService.js` throws strings: `throw 'User not found'`, `throw 'البريد الإلكتروني مستخدم بالفعل'`
- `stockService.js` throws `Error` objects: `throw new Error('المنتج غير موجود')`
- `routeHandler` catches `ZodError` specifically and extracts `fieldErrors`
- Global handler catches everything else but may not format it ideally

## Configuration Audit

### Environment Variables

| Variable | Required | Purpose | Risk if Missing |
|----------|---------|---------|----------------|
| `MONGODB_URI` | ✅ | MongoDB connection | App crashes on startup |
| `JWT_SECRET` | ✅ | JWT signing | App crashes on startup |
| `JWT_EXPIRES_IN` | ⚠️ | Token expiry | Defaults to '1d' |
| `GOOGLE_CLIENT_ID` | ✅ (for OAuth) | Google OAuth | OAuth fails |
| `GOOGLE_CLIENT_SECRET` | ✅ (for OAuth) | Google OAuth | OAuth fails |
| `NEXT_PUBLIC_BASE_URL` | ✅ (for OAuth callbacks) | OAuth redirect URLs | OAuth callback URLs break |
| `NODE_ENV` | ⚠️ | Environment detection | Affects cookie security, CORS, error messages |
| `PORT` | ⚠️ | Server port | Defaults to 5000 |

### Security Middleware

- **helmet**: Enabled with `crossOriginResourcePolicy: { policy: "cross-origin" }`
- **express-mongo-sanitize**: Enabled — prevents NoSQL injection via `$` operators
- **hpp**: Enabled — prevents HTTP parameter pollution
- **express-rate-limit**: Enabled with 100 requests/15min per IP, applied to `/api/`

### CORS Configuration

```javascript
origin: function (origin, callback) {
    if (!origin) return callback(null, true);  // allows requests without origin (curl, etc.)
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
        return callback(null, true);  // allows all origins in non-production
    }
    return callback(new Error('Not allowed by CORS'));
},
credentials: true,
optionsSuccessStatus: 200
```

**Concerns**:
- In production, only `localhost:3000`, `127.0.0.1:3000`, and `jammaz.vercel.app` are allowed
- In non-production, ALL origins are allowed — this is acceptable for development but should be restricted before deployment
- `allowedOrigins` includes `process.env.NEXT_PUBLIC_BASE_URL` which may be undefined

## Build & Deployment

### Package.json Scripts

```json
{
    "scripts": {
        "start": "node index.js",
        "dev": "nodemon index.js"
    }
}
```

**Concerns**:
- No `build` script — the app is interpreted directly (ES modules)
- No `test` script
- No `lint` script
- No `typecheck` script

### Entry Point (`index.js`)

- Starts Express server
- Configures CORS, security headers, rate limiting, body parsing
- Mounts all route modules
- Starts database connection then server
- Has global error handler

### No Docker Configuration

- No `Dockerfile` found
- No `docker-compose.yml` found
- Deployment is manual via `node index.js`

### No CI/CD Configuration

- No `.github/workflows/` found (or not read)
- No automated testing or deployment pipelines detected

## Summary of Backend Issues

| Category | Issues | Severity |
|----------|--------|----------|
| API Consistency | Mixed auth patterns, duplicate routes, inconsistent responses | HIGH |
| Transaction Management | No multi-document transactions; operations across services not atomic | CRITICAL |
| Error Handling | Mixed error types (strings vs AppError vs Error); inconsistent formatting | HIGH |
| Database Connection | Global mongoose caching; independent dbConnect() calls per service | MEDIUM |
| Validation | Zod + Mongoose mix; some paths lack validation | MEDIUM |
| Repository Pattern | Inconsistent signatures; some methods missing | LOW |
| Response Format | ApiResponse vs routeHandler vs raw returns | LOW |