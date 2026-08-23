# Architecture Audit — Jammaz System

## Overall Architecture

**Type**: Backend-only monolithic Express.js application with MongoDB.
**Pattern**: Layered architecture (presentation → routes → controllers → services → repositories → models).
**Deployment**: Single Node.js process, environment-configurable via `.env`.

## Layered Architecture Analysis

### 1. API Layer (`routes/`)
- **19 route files** handling specific domains (auth, customers, products, invoices, etc.)
- Each route uses `routeHandler` wrapper for consistent error handling
- Middleware chain: `authMiddleware` → `roleMiddleware` → `routeHandler`
- **Issue**: CORS middleware is placed first, then security headers, then sanitization, then rate limiting, then body parsers — order matters for request processing

### 2. Controller Layer (`controllers/`)
- 4 controllers: `authController.js`, `invoiceController.js`, `productController.js`, `settingsController.js`
- Controllers are thin — they mainly parse request data, validate with Zod, and delegate to services
- **Issue**: `authController` returns `result.user` directly without consistent response formatting

### 3. Service Layer (`services/`)
- **21 service files** covering all business domains:
  - `authService.js` — Authentication (login, Google OAuth, token signing)
  - `invoiceService.js` — Invoice creation with item processing, side effects
  - `productService.js` — Product CRUD, metadata, stock registration
  - `userService.js` — User CRUD operations
  - `dailySalesService.js` — Daily sales tracking aggregation
  - `treasuryService.js` — Cashbox, treasury transactions, daily summaries
  - `stockService.js` — Stock level management, movements, transfers
  - `reportingService.js` — Financial reports, customer profitability, price history
  - `purchaseOrderService.js` — Purchase order lifecycle
  - `notificationService.js` — Notification creation, stock/supplier/debt alerts
  - `financeService.js` — Facade delegating to domain services
  - `accountingService.js` — Double-entry bookkeeping, ledger, trial balance
  - `saleService.js` — Sale recording and reversal (with stock/treasury/daily sales)
  - `purchaseService.js` — Purchase receiving and supplier debt
  - `paymentService.js` — Payment recording, schedule management, settlement
  - `expenseService.js` — General expense recording
  - `returnService.js` — Sales return processing
  - `debtService.js` — Debt creation, aging, installment plans, write-offs
  - `physicalInventoryService.js` — Physical stock counting and reconciliation
  - `dashboardService.js` — KPIs, stats, strategy suggestions

- **Issue**: Excessive service layer size — `treasuryService.js` at 721 lines, `notificationService.js` at 412 lines, `debtService.js` at 557 lines. God services.

### 4. Repository Layer (`repositories/`)
- 5 repository files: `customerRepository.js`, `debtRepository.js`, `invoiceRepository.js`, `productRepository.js`, `userRepository.js`
- Thin data access layer with Mongoose find/create/update/delete operations
- **Issue**: Some repositories have inconsistent method naming and signatures

### 5. Model Layer (`models/`)
- 24 Mongoose schema definitions with business logic methods
- Schemas: User, Product, Customer, Invoice, InvoiceSettings, PhysicalInventory, ShortageReport, StockMovement, DailySales, PaymentSchedule, Debt, SalesReturn, CashboxDaily, SystemMeta, TreasuryTransaction
- **Issue**: Mixed concerns — some models have extensive methods, others are pure data structures

### 6. Lib/Utilities (`lib/`)
- `db.js` — MongoDB connection with global caching (problematic)
- `auth.js` — JWT signing/verification
- `route-handler.js` — Async wrapper with sanitization and standard response format
- `api-response.js` — Response formatters
- `cache.js` / `cache-config.js` — Cache tags and times (appears to be for frontend React Query)
- `permissions.js` — Role-based permission definitions and checks
- `utils/dbUtils.js` — Missing (file not found)
- `utils/idUtils.js` — Missing (file not found)

### 7. Middleware Layer (`middlewares/`)
- `authMiddleware.js` — Token verification from cookie or auth header, user lookup
- `errorHandler.js` — Centralized error handling with AppError class

## Dependency Direction

```
Routes → Controllers → Services → Repositories → Models
         ↑                ↑
     Middleware   Utilities (lib/)
```

## God Services Identified

| Service | Size | Concern |
|---------|------|---------|
| `treasuryService.js` | 721 lines | Cashbox, transactions, balances, summaries — too many responsibilities |
| `notificationService.js` | 412 lines | Stock alerts, supplier alerts, debt reminders, installment sync — multiple scanners |
| `debtService.js` | 557 lines | Debt creation, aging, installments, write-offs, aggregations — god class |
| `dashboardService.js` | 265 lines | KPIs, stats, strategy, bundle suggestions — multiple concerns |

## Mixed Responsibilities

1. **Finance service layering** is blurred — `FinanceService` facade delegates to `SaleService`, `PurchaseService`, `PaymentService`, `ReturnService`, `ExpenseService`, but these also call each other and directly interact with models/treasury.

2. **Stock reduction always from shop** — `StockService.reduceStockForSale()` has a `source` parameter ('shop' or 'warehouse') but the logic always reduces the specified source; however, `SaleService.recordSale()` calls it without considering the source, and the comment says "Stock is ALWAYS reduced from SHOP" — potential bug.

3. **Duplicate database connection management** — Many services call `await dbConnect()` independently rather than accepting a session. This can lead to multiple connections and race conditions.

4. **Error handling inconsistency** — Some services throw strings (`throw 'User not found'`), some throw `AppError`, some throw `Error`. The `routeHandler` catches `ZodError` and `ValidationError` but not generic strings consistently.

## Cryptic / Confusing Patterns

1. **Global mongoose caching** (`lib/db.js`): Uses `global.mongoose` to persist connection across calls. Works in development but fragile in production (memory leaks, connection limits).

2. **Buffer commands disabled globally**: `mongoose.set('bufferCommands', false)` means operations will fail immediately if not connected, but there's no reconnection logic.

3. **`$unset` sanitization in route-handler**: `sanitizeInput` deletes any key starting with `$` from req.params/req.query — a good NoSQL injection prevention but could remove legitimate fields.

4. **Cookie settings mixed**: `secure: process.env.NODE_ENV === 'production'` — correct, but `sameSite: 'lax'` may need to be `'strict'` for stricter security.

5. **Inconsistent date handling**: Some places use `new Date()`, others use `Date.now()`, and date-fns functions are mixed with native Date.

## Cohesion & Coupling

- **High cohesion** within domains (invoice service handles invoice-related logic, stock service handles stock-related logic)
- **Tight coupling** between finance domains — `SaleService` → `StockService` → `TreasuryService` → `DailySalesService` → `DebtService` → `PaymentService` → `FinanceService`
- **Circular dependency risk**: Services import from each other across domains (e.g., `invoiceService` imports from `financial/`, `stockService`, `customerRepository`)
- **No clear API contracts** between services — function signatures vary, some use callbacks/sessions, others don't

## Suggested Architecture Improvements

1. **Extract interfaces** for repository patterns to enable mocking and testing
2. **Introduce transaction boundaries** at the use-case level (e.g., "create invoice with stock reduction")
3. **Centralize error handling** to use `AppError` consistently
4. **Separate concerns** — move caching config to frontend repo, remove from backend
5. **Introduce DTOs** for request/response consistency
6. **Add session management** — use mongoose sessions for multi-operation transactions