# Target Architecture (post-roadmap)

Same monolith — no rewrite. Changes are discipline, not topology.

## Request flow (target)

```
Client
  ↓
index.js
  trust proxy → cors(strict prod policy) → helmet → mongoSanitize
  → rateLimit(global + authLimiter + heavyLimiter)
  → express.json → cookieParser → requestId middleware
  → structured request logger
  ↓
routes/*.js
  validate(zodSchema, source)          ← every input
  authMiddleware (+tokenVersion check)
  roleMiddleware(canonical roles)
  routeHandler(service.fn)             ← thin wiring only
  ↓
controllers (thin, only where payload shaping helps)
  ↓
services (single error style: lib/errors.js AppError hierarchy;
          repositories for the 5 modeled aggregates; direct models elsewhere)
  ↓
models (constraints enforced at schema; counters for all numbering)
  ↓
MongoDB Atlas (replica set; transactions mandatory in prod)
```

## Rules that become enforceable

1. One error mapper; string throws banned by lint.
2. No route touches `req.body` before `validate()`.
3. Money mutations are atomic (`$inc` guarded) or transactional; flows in
   services/financial always run inside `withTransaction`.
4. Every list endpoint paginates via shared helper with hard caps.
5. RBAC: canonical role set; permission matrix from lib/permissions applied as gates.
6. Observability: requestId on every log line; security events logged.

## What stays out of scope

Microservice split, TypeScript migration, CQRS/event sourcing, background-job framework
(not currently needed), WebSockets (no realtime requirement stated).
