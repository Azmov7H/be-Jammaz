# 01 — Current State (verified facts)

## Runtime & stack

| Item | Value | Evidence |
| ---- | ----- | -------- |
| Node.js | v24.14.1, ESM | runtime `node --version`; `"type": "module"` |
| Express | ^4.21.0 | package.json |
| Mongoose | ^8.7.0 | package.json |
| MongoDB | Atlas via `MONGODB_URI` | lib/db.js:3 |
| Auth | jose HS256 JWT, 1d default expiry, httpOnly cookie + Bearer fallback | lib/auth.js, middlewares/authMiddleware.js:6 |
| Hashing | bcryptjs (cost 10) | services/userService.js:29 |
| Validation | zod ^4 present; wired only in authController, productController, invoiceController | grep sweep |
| Package managers | npm **and** pnpm lockfiles both committed | package-lock.json + pnpm-lock.yaml |
| Tests | No runner configured; 2 stray `*.test.js` files; `lib/validators.test.js` imports a module that does not exist | lib/validators.test.js:1 |
| Deploy | None defined in repo (`npm start` → node index.js). Frontend hosted on Vercel (CORS origin) | index.js:50 |

## Entry point flow (index.js)

```
dotenv → dbConnect() → app.listen
middleware order:
  trust proxy=1 → cors(whitelist+credentials) → helmet(CRP cross-origin)
  → mongoSanitize() → hpp() → rateLimit(100/15min per IP, /api/)
  → express.json() → cookieParser() → morgan('dev')
  → 19 route mounts → GET / health → errorHandler
```

Notable init facts:

- CORS callback returns `null, true` when `origin` is absent (curl/mobile allowed) and
  allows any origin when `NODE_ENV !== 'production'` (index.js:55-65).
- Rate limiter is the **only** one; global, per-IP, in-memory store.
- `express.json()` uses default 100kb limit (undocumented but acceptable).
- **No 404 handler**, **no graceful shutdown** (no SIGTERM/SIGINT handling), no request IDs.
- Route mounting happens after `startServer()` is invoked (works because listen is async;
  fragile ordering, cosmetic issue).

## Module map

```
routes/ (19 files, 118 endpoints)
  └─ routeHandler wrapper (lib/route-handler.js) — sanitize params/query, success envelope, error mapping
      └─ controllers/ (4) ─┐
      └─ services/ (22 + financial/6) ─── models/ (24 schemas) ─── repositories/ (5, partially used)
middlewares/: authMiddleware (JWT→req.user), roleMiddleware(roles), errorHandler
lib/: auth (JWT), db (connection), permissions (role→permission map), route-handler,
      api-response (unused), cache*.js (frontend configs, unused server-side)
validations/: dead zod library (13 schemas, unwired)
scripts/: verify-bank-integration.js (writes real data to live DB)
```

## Environment variables (complete)

| Var | Required | Default | Used for |
| --- | -------- | ------- | -------- |
| `MONGODB_URI` | yes (throws) | – | DB connection |
| `JWT_SECRET` | yes (throws) | – | token signing |
| `JWT_EXPIRES_IN` | no | `'1d'` | token lifetime |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for OAuth | – | Google sign-in |
| `NEXT_PUBLIC_BASE_URL` | no | – | OAuth redirect + CORS origin |
| `NODE_ENV` | no | – | prod gating (cookie secure flag, stack suppression) |
| `PORT` | no | 5000 | listen |

No `.env` committed; `.gitignore` covers `.env*`. No `.env.example` exists.

## Domain model (24 collections)

Users/RBAC, Customers (credit + custom pricing), Suppliers, Products (+PriceHistory),
Invoices (+InvoiceSettings), SalesReturns, PurchaseOrders, Debts (+PaymentSchedule,
CollectionPeriod), TreasuryTransactions, CashboxDaily, AccountingEntry (double-entry),
StockMovement, DailySales, DailyInventory, PhysicalInventory, ShortageReport,
Notification, Log, Counter, SystemMeta.
