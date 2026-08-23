# 03 — Express Audit

## Application initialization

| Area | State | Notes / Finding |
| ---- | ----- | --------------- |
| Middleware order | CORS → helmet → mongoSanitize → hpp → rateLimit → json → cookieParser → morgan | Sound ordering overall. Rate limiter before body parsing is fine. |
| CORS | Whitelist + credentials; origin-less requests allowed; all origins allowed when NODE_ENV≠production | SEC-003 (document decision); dev-open behavior is a footgun if NODE_ENV is unset in staging |
| Helmet | Enabled; only CRP overridden to cross-origin | Acceptable; no CSP needed for API-only |
| Body parsing | default limits | OK; document |
| Compression | absent | PERF-004 (LOW) |
| Logging | morgan('dev') to stdout | LOG-001 |
| Error middleware | registered last, after routes | OK — but see dual-system finding ERR-001 |
| 404 handler | **missing** — unknown `/api/*` paths fall through to `GET /`? No: they hit errorHandler? They produce Express default 404 HTML | DEVOPS-001 |
| Request IDs | missing | LOG-001 |
| Graceful shutdown | **missing** — in-flight requests killed on SIGTERM | DEVOPS-001 |
| Health endpoint | `GET /` returns JSON banner; no readiness/liveness semantics | DEVOPS-001 |

## Routes

- Naming is broadly RESTful and consistent kebab-case; mount table at index.js:112-131.
- `reportRoutes` mounted at bare `/api` (owns `/dashboard*`, `/reports/*`) — works but
  obscures the route table; cosmetic.
- Duplicate mount `/api/purchases` ≡ `/api/purchase-orders` (documented alias) — keep
  one canonical, deprecate other with contract note (API-001).
- REST semantics issues: `PATCH /api/purchases/:id` duplicates `PUT /:id/status`;
  `POST /api/settings/invoice-design` duplicates `PUT`.
- Pagination: implemented per-service with divergent defaults (10/20/50/100) and no
  shared helper; several endpoints unbounded (see 15-performance-audit.md).

## Middleware audit

### authMiddleware.js
- Reads cookie `token` or `Authorization: Bearer`; verifies JWT; loads user from DB each
  request (`select('-password')`) → revocation-on-delete works, but cost = 1 query/request (acceptable at this scale).
- Returns **404** for valid-token-but-deleted user (should be 401) — ERR-002.
- Catch-all returns 500 on any unexpected failure — fine.

### roleMiddleware(roles)
- Pure list membership check on `req.user.role`. Correct mechanics, but:
  - Gates written for a role that cannot exist (`'admin'` not in User enum) → ACL-001.
  - No permission-string abstraction used at route level despite `lib/permissions.js`
    existing; `requirePermission()` throws strings (maps to HTTP 400) so it's unusable
    for HTTP semantics — ERR-001 related.

### Validation middleware
- Does not exist as middleware. Zod parsing happens inside 2 controllers only.
- `routeHandler.sanitizeInput` strips `$`-prefixed keys from **params/query only**;
  `req.body` never sanitized → VAL-001.

### Upload middleware — N/A (no uploads).

## Execution-order risks

- `mongoSanitize` runs before route handlers and strips operators from body too
  (it mutates req.body by default) — this partially mitigates VAL-001 for bodies,
  BUT `express-mongo-sanitize` v2 removes keys starting with `$` recursively; dotted-key
  pollution remains possible, and relying on a third-party mutation order (sanitize
  before controller zod parse) is implicit coupling. Defense-in-depth fix still required.
- Global rate limit of 100 req/15min per IP will throttle legitimate ERP bulk usage
  while not protecting login specifically (RATE-001).

## Verdict

Initialization is conventional and mostly correct. The systemic problems are the
dead `admin` gates, missing validation layer, missing 404/graceful shutdown, and
the fragile string-error mapping inside the otherwise-good `routeHandler` pattern.
