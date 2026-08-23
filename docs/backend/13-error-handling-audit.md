# 13 — Error Handling Audit

## Two competing pipelines (ERR-001, HIGH)

### Pipeline A — routeHandler.handleError (lib/route-handler.js:56-99)
Used by virtually every endpoint. Maps:

| Error type | Result |
| ---------- | ------ |
| ZodError | 400 + flattened fieldErrors ✔ (good) |
| Mongoose ValidationError | 400 + field map ✔ |
| **string throw** | 404 if message ends with literal `'not found'`, else 400 |
| err.status / err.statusCode | honored ✔ (AppError path) |
| message containing 'Insufficient' or 'غير كافية' | 400 (string sniffing!) |
| everything else | 500; message passthrough unless NODE_ENV=production |

Defects:
- Arabic "not found" messages (`غير موجود`) don't match the English suffix heuristic → 500
  instead of 404 across finance / physical-inventory / PO / sale flows.
- `requirePermission` throws strings → permission failures return 400, not 403.
- String-sniffing 'Insufficient'/'غير كافية' is fragile business-logic coupling.

### Pipeline B — middlewares/errorHandler.js
Registered globally but reachable only for errors escaping non-routeHandler middleware
(today: almost nothing). Produces a *different* error shape (`error:` vs Pipeline A's
`message:`) and leaks stack in dev. `AppError` — the good primitive — lives here while
most code doesn't use it.

## Consequences

- Clients cannot reliably distinguish not-found vs bad-request vs server-error on a
  large share of failure paths.
- 500-rate inflated by plain `Error` throws carrying business messages
  (e.g., financeRoutes.js:107).
- Monitoring by status code is misleading (business errors counted as server faults).

## Target model (Sprint 01)

1. Single hierarchy: `AppError(statusCode, code, message, details)` + thin subclasses
   (`NotFoundError`, `ValidationError`, `ForbiddenError`, `ConflictError`).
2. Services throw typed errors only; string throws banned (lint rule).
3. One error mapper (routeHandler delegates); errorHandler = last resort; uniform shape
   `{success:false, message, code?, details?, timestamp}`.
4. Add mappings: CastError→400/404, E11000→409, Zod→400, Mongo ValidationError→400.
5. Production redaction unchanged (no stacks/internal paths).

## Related status-code hygiene (ERR-002, MEDIUM)

- authMiddleware returns 404 for deleted user with valid token → must be 401.
- getById handlers returning 200+null → normalize to 404.
- settingsController raw res.json bypasses envelope → Sprint 01 cleanup.

## Async safety

routeHandler wraps async handlers ✔; middleware outside the wrapper has its own
try/catch (authMiddleware ✔). No unhandled-rejection hotspots found.
