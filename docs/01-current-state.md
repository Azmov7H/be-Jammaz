# Current State — Jammaz System

## Overall Status
**NEEDS STABILIZATION** — The application is functional but has several critical areas that need remediation before production use.

## What Works

### Core Functionality
- **Authentication**: Login with email/password works. Google OAuth callback functions.
- **Invoice CRUD**: Create, read, list, and delete invoices works.
- **Product CRUD**: Create, read, list, update, and delete products works.
- **Customer CRUD**: Create, read, list, update, and delete customers works.
- **Purchase Orders**: Create, receive, and list purchase orders works.
- **Treasury/Cashbox**: Balance tracking and manual entries work.
- **Stock Management**: Stock increase/decrease for sales and purchases works.
- **Notification System**: Stock alerts, debt reminders, and supplier alerts generate notifications.

### Key APIs
- `/api/auth/*` — Authentication endpoints
- `/api/invoices/*` — Invoice management
- `/api/products/*` — Product catalog management
- `/api/customers/*` — Customer management
- `/api/purchase-orders/*` — Purchase order management
- `/api/treasury/*` — Cash and balance tracking
- `/api/report/*` — Reporting and dashboards

## What Is Broken / Risky

### Authentication & Session Management
- **No token invalidation**: Logging out clears the cookie but the JWT remains valid until its natural expiry (1 day). There is no token blacklist or revocation mechanism.
- **Session fixation risk**: Token is set via cookie without `secure` flag in non-production, and `sameSite: 'lax'` may not protect against CSRF in all contexts.
- **No refresh token flow**: Access tokens are the only mechanism; when they expire, users must re-authenticate.

### Financial Calculations & Data Integrity
- **Profit calculation inconsistency**: Invoice `profit` field is calculated as `total - totalCost`, but `totalCost` is aggregated from item-level `costPrice` which may not reflect actual weighted average cost. The `SaleService.recordSale` also subtracts `usedCreditBalance` from `netCashReceived` but the logic is convoluted.
- **Customer balance drift**: `Customer.balance` is updated in multiple places (`DebtService`, `PaymentService`, direct `$inc` operations) with no single source of truth. Multiple code paths modify the same field independently.
- **Daily sales reversal**: `DailySalesService.reverseDailySales` subtracts `invoice.total` from `totalRevenue` but does not properly reverse the `itemsSold` calculation when items have varying quantities.
- **Stock qty sync**: `ProductSchema.pre('save')` automatically sets `stockQty = warehouseQty + shopQty`, but many services manually set `warehouseQty` and `shopQty` without relying on this middleware consistently, leading to potential stale values.

### Authorization & Permissions
- **Role-based checks are inconsistent**: Some routes use `roleMiddleware(['admin'])` while others manually check permissions via `hasPermission`. The `requirePermission` function in `permissions.js` is not used uniformly across all routes.
- **Admin endpoint exposure**: Several admin-sensitive endpoints (`/api/users`, `/api/logs`, customer pricing) are protected only by `authMiddleware + roleMiddleware(['owner', 'manager'])` but the exact permission semantics are ambiguous.
- **No resource-level authorization**: The `roleMiddleware` checks global roles but does not verify ownership or resource-specific rights (e.g., "can this user edit THIS customer?").

### Duplicate Implementations & Conflicting Sources of Truth

#### Product Validation Schemas
- `validations/product.schema.js` — Zod schema for product creation
- `controllers/productController.js` — Different Zod schema (`productSchema`) with slightly different fields
- Both schemas exist independently; updates to one don't propagate to the other.

#### Financial Calculation Paths
- **Invoice profit**: Calculated in `InvoiceSchema` virtual, `InvoiceService._processInvoiceItems`, `DailySalesService.updateDailySales`, and `ReturnService.processSaleReturn` — each may produce slightly different results.
- **Customer balance**: Updated in `DebtService.updateBalance`, `PaymentService.recordCustomerPayment`, `PaymentService.recordTotalCustomerPayment`, and `TreasuryService.recordDebtTransaction`.

### Unfinished / Partially Implemented Features

- **Physical inventory counting**: The `completeCount` method in `PhysicalInventoryService` has transaction code commented out and relies on standalone `count.complete()` without a session.
- **Invoice design settings**: `SettingsController.updateInvoiceDesign` uses `Object.assign` without validation — any field can be overwritten.
- **Dashboard `getStrategy`**: Intended to provide bundle suggestions and ABC analysis but is a placeholder with limited data ("For speed, we will skip the complex 'Anti-join' for slow movers in this iteration").
- **Customer pricing integration**: Customer custom prices (`Customer.customPricing`) exist but the frontend integration path is unclear; pricing is fetched via separate routes that import services dynamically.

### Technical Debt

1. **Global mongoose caching** in `lib/db.js` uses `global.mongoose` — works for dev but problematic in production (shared state, memory leaks).
2. **Commented-out transaction code** in `PhysicalInventoryService.completeCount` and `PhysicalInventoryService.unlockCount` — transactions were removed "for standalone compatibility" but the `session` parameter is still referenced.
3. **Multiple `dbConnect()` calls** within the same request flow — some services call `await dbConnect()` independently rather than using a shared session.
4. **String-based error throwing** throughout services (e.g., `throw 'User not found'`)` instead of `AppError` — inconsistent with the error handler.
5. **No index on critical search fields** — customer phone and name have text index but many query patterns don't leverage it.

### Dependencies Between Issues

```
Authentication session management
    ↓
Authorization / permission checks
    ↓
Financial calculation consistency
    ↓
Data integrity (customer balance, stock levels)
    ↓
Testing coverage gaps
    ↓
Production readiness
```

## Production Readiness Status

| Category | Status | Notes |
|----------|--------|-------|
| Build | ✅ Passes | `npm start` starts server |
| Type Checking | ⚠️ Not configured | No `tsconfig` or typecheck script |
| Lint | ⚠️ Not configured | No lint script in package.json |
| Tests | ⚠️ Minimal | No test script; some `.test.js` files exist |
| Auth | ⚠️ Partial | Login works, but no token revocation |
| Financial Calculations | ❌ Risky | Multiple inconsistent calculation paths |
| Authorization | ❌ Inconsistent | Mixed role-checking patterns |
| Data Integrity | ⚠️ Partial | Drift possible between balance, debt, and invoice states |
| Observability | ⚠️ Limited | Logs exist but no structured monitoring |
| Deployment | ✅ Configurable | .env, docker not configured |