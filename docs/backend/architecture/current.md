# Current Architecture (as audited)

## Request flow

```
Client
  ↓
index.js
  trust proxy=1 → cors → helmet → mongoSanitize → hpp
  → rateLimit(global 100/15min, /api/*)
  → express.json(100kb) → cookieParser → morgan('dev')
  ↓
routes/*.js  ── routeHandler(fn) wrapper ──┐
  │   authMiddleware (JWT→DB user)          │ sanitize params/query
  │   roleMiddleware([roles]) where present │ success envelope / handleError()
  ↓                                         │
controllers (4) or inline route logic       │
  ↓                                         │
services (22 + financial/6) ←─ repositories (5, partially used)
  ↓
models (24 schemas) → MongoDB Atlas
  ↓ errors
routeHandler.handleError  ←── (95% of errors)
middlewares/errorHandler   ←── (escapees only)
```

## Module boundaries (actual)

- **Routes**: HTTP wiring; violations in financeRoutes (payments dispatcher, receipt builder),
  stockRoutes (queries), customerRoutes (pricing view), physicalInventoryRoutes (stub).
- **Controllers**: only auth/product/invoice/settings exist; product+invoice own zod copies.
- **Services**: real business core; treasuryService (27KB), stockService (21KB),
  accountingService (17KB) are the heavyweights.
- **Repositories**: user/product/invoice/customer/debt — bypassed by most services.
- **lib**: auth(JWT), db(connection), permissions(dead matrix), route-handler,
  api-response(dead), cache*(frontend configs).
- **validations/**: dead zod library.
- **utils**: dbUtils.withTransaction (silent-fallback), idUtils.

## Known structural debts

Dual error pipelines · unwired validation · repository bypass · four model-registration
styles · business logic inline in routes/controllers · no background jobs, websockets,
uploads, or server cache.
