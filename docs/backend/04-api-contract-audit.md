# 04 — API Contract Audit

Full inventory: 118 endpoints across 19 route files. Legend: Auth ✅/❌, Role gate,
Validation (zod), Pagination. Findings referenced by ID.

## Summary of systemic contract issues

1. **Response envelope drift** (API-001):
   - Standard: `routeHandler` → `{success:true, data, message:null, timestamp}`.
   - `settingsController` returns raw `{status:'success', data}` via direct `res.json`.
   - `ApiResponse` helper defines a third shape (`error:` vs `message:`) — unused but exported.
   - Error shape differs between systems: `routeHandler` → `{success:false,message,data}`;
     `errorHandler` → `{success:false,error,stack?}`.
2. **Status-code defects** (ERR-002):
   - Arabic plain-`Error` throws surface as **500**: `financeRoutes.js:107` (`السند غير موجود`),
     `saleService.js:96`, `physicalInventoryService.js:289/310/352`, `purchaseOrderService.js:84`.
   - String heuristic maps only messages literally ending in `not found` to 404
     (route-handler.js:79) — English-centric, breaks for the app's primary language.
   - Permission failures thrown as strings → **400**, not 403.
   - authMiddleware 404 for deleted user with valid token.
   - Several getById handlers return 200 + `data:null` for missing docs
     (e.g., physical-inventory `getCountById`, purchases `getById`).
3. **Dead endpoints / dead gates**: all `['admin']`-gated routes unreachable (ACL-001);
   documented-but-nonexistent `POST /auth/register` (docsRoutes).
4. **Duplicate endpoints**: installments ×2, purchase status update ×2, invoice-design PUT/POST,
   price-history ×2, purchases dual mount.

## Endpoint inventory (condensed; flags = auth/role/validation/pagination)

### /api/auth (public by design)
| Method Path | Auth | Role | Validation | Notes |
|---|---|---|---|---|
| POST /login | – | – | ✅ zod | logs email to console (LOG-001); enumeration gap AUTH-003 |
| POST /logout | – | – | ❌ | clears cookie only; JWT stays valid (AUTH-001) |
| GET /session | – | – | ❌ | verifies inside service; ⚠ SEC-002 hash-leak risk |
| POST /google/callback | – | – | ❌ on `code` | auto-provisions any Google account as cashier (AUTH-002) |

### /api/customers — auth ✅ all
| Endpoint | Role | Valid | Paginated | Finding |
|---|---|---|---|---|
| GET / | – | – | ✅ (20) | |
| GET /:id | – | – | – | |
| POST / | – | ❌ | – | opening balance trusted from body (VAL/BIZ) |
| PUT /:id | – | ❌ | – | mass assignment (VAL-001) |
| DELETE /:id | ['admin'] dead | ❌ | – | ACL-001 |
| GET /:id/pricing | – | – | – | inline logic in route (ARCH-001) |
| POST /:id/pricing | – | ❌ price bounds | – | any user sets custom prices (ACL-003) |
| DELETE /:id/pricing | – | ❌ | – | takes productId via query |
| GET /:id/statement | – | ❌ date clamp | – | unbounded range (PERF-001) |
| POST /:id/pay | – | ❌ amount/method unchecked | – | triggers non-atomic payment flow (DATA-003) |

### /api/products — auth ✅ all
GET / (paginated 10) · GET /metadata · GET /:id · POST / (✅zod) · PUT /:id (✅zod partial)
· DELETE /:id (**dead admin gate**, ACL-001).

### /api/invoices — auth ✅ all
GET / (paginated 50) · GET /:id · POST / (✅ zod but refine dropped → credit sale without customer possible, VAL-001)
· GET /:id/returns · POST /:id/return (**raw req.body**, VAL-001) · DELETE /:id (dead gate).

### /api/users — auth ✅, role owner|manager
| Endpoint | Finding |
|---|---|
| GET / | unbounded list (PERF-001) |
| GET /:id | string throw |
| POST / | no schema; raw body spread incl. role (ACL-002, VAL-001); missing password → bcrypt crash 500 |
| PUT /:id | manager can set any role incl. owner on self (ACL-002) |
| DELETE /:id | no last-owner guard (ACL-002) |

### /api/logs — auth ✅, role ['admin'] **dead → nobody can read logs**
GET / (paginated 100) · GET /recent (50) · GET /:entity/:id (unbounded). ACL-001, PERF-001.

### /api/docs — **NO AUTH** — public API map (SEC-001).

### /api/financial — auth ✅ all
| Endpoint | Role | Valid | Finding |
|---|---|---|---|
| POST /payments/customer | – | ❌ | DATA-002/003 |
| POST /payments/unified | – | ❌ | loop payment, non-atomic |
| POST /payments/supplier | – | ❌ | DATA-003 |
| POST /payments/debt | – | ❌ | |
| POST /returns | – | ❌ | return flow non-transactional |
| POST /expenses | – | ❌ whole body | ACL-003 |
| GET /debts* (4) | – | ⚠ partial | paginated variants OK; legacy duplicate endpoint |
| POST /installments | – | ❌ | delete-then-insert hazard DATA-003 |
| GET /installments/:debtId | – | – | duplicate of debts variant |
| GET /payments (inline dispatcher) | – | ❌ | ARCH-001 |
| GET /receipts/:id | – | manual len check | 500 instead of 404 ERR-002; inline logic ARCH-001 |
| GET /treasury | – | ❌ | heavy fan-out PERF-003 |
| POST /transaction | – | ❌ amount unchecked | ACL-003 |
| DELETE /transaction/:id | owner | ❌ | |
| GET /daily | – | ❌ | |
| GET /partner/:id/transactions | – | ❌ no defaults | unbounded PERF-001 |

### /api/purchases (+ alias) — auth ✅
GET / (limit-only paging flaw) · GET /:id · POST / (raw body) · PUT /:id/status [admin†,manager]
· PATCH /:id [owner,admin†,manager] · POST /:id/receive [admin†,manager] (check-then-act double-receive race BIZ-04)
· DELETE /:id [admin† dead]. † = role cannot exist.

### /api/settings — auth ✅
GET /invoice-design (raw res.json envelope drift) · PUT /invoice-design [owner,manager]
(**mass assignment** — comment admits "Basic validation or filtering can be added here")
· POST same handler (duplicate).

### /api/stock — auth ✅
GET / (inline query, cap 100) · GET /movements (uncapped rows) · GET /status (cap 100, ignores filters)
· POST /transfer (any user, qty unchecked, race DATA-001) · POST /move (any user, blind bulk $inc)
· POST /adjust ([admin† dead] — direct stock correction currently impossible).

### /api/treasury — auth ✅
GET /balance (full-collection aggregation) · GET /summary · GET /daily
· POST /reconcile [admin†,manager] (amounts unchecked) · GET /transactions (no row cap)
· POST /manual-income & /manual-expense (any user! ACL-003) · DELETE /transactions/:id [admin† dead].

### /api/notifications — auth ✅, self-scoped reads OK
GET / (paginated 20) · PATCH /mark-read (**IDOR** ACL-004) · DELETE /:id (scoped) · DELETE / (owner wipes entire collection).

### /api/physical-inventory — auth ✅
GET / (uncapped) · GET /:id (200/null on missing) · GET /:id/recent-movements (stub)
· POST / [admin†,manager] · PATCH /:id (**any user**, raw items — inconsistent gating, ACL-003)
· POST /:id/complete [admin†,manager] (non-atomic DATA-003) · POST /:id/unlock [admin† dead; inner owner-password check unreachable]
· DELETE /:id [admin† dead].

### /api/daily-sales — auth ✅ — GET / · /summary (unbounded range, raw Date cast) · /best-sellers.

### /api/accounting — auth ✅, roleMiddleware imported and never used
GET /ledger (uncapped) · /trial-balance · /entries (limit 100, no skip)
· POST /entries/expense & /income (**any user books GL entries**, amounts unchecked — ACL-003).

### /api/pricing — auth ✅, roleMiddleware imported and never used
GET /history/:productId · POST /custom (any user, price unchecked) · DELETE /custom · GET /customer/:customerId.

### /api/reports + /dashboard (mounted at /api) — auth ✅
/dashboard (+stats/kpis/strategy) — ~12 collection scans per unified call (PERF-001)
· /reports/sales · /shortage (cap 50) · /inventory · /financial (**no date defaults; undefined into $match**)
· /customer-profit (empty range scans every invoice ever) · /price-history(+/:productId).

## Frontend Contract Impact

Any envelope/status normalization in Sprints 01–03 will change shapes the Next.js
frontend relies on (especially settingsController responses and error bodies). Each
task in tasks/api.md carries an explicit "frontend impact" note; frontend work itself
is out of scope.
