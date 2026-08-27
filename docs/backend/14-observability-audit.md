# 14 — Logging & Observability Audit

## Current state

| Aspect | Reality |
| ------ | ------- |
| Request logging | morgan('dev') to stdout (dev-formatted) |
| Error logging | console.error of raw objects (route-handler.js:94, errorHandler.js:3, authMiddleware.js:26) |
| Auth/security events | console.log lines: cookie-set with email (authController.js:21), token-presence debug (authController.js:33, authService.js:87), DB diagnostics incl. Arabic troubleshooting banners (lib/db.js) |
| Request IDs / correlation | none |
| Structured logging | none |
| Metrics / APM | none |
| Health checks | GET / banner JSON only |
| Audit trail | Log collection exists — unreadable via API due to dead admin gate (ACL-001), unindexed, no TTL |

## Issues

### LOG-001 (MEDIUM): PII/debug leakage + no structure
Emails logged at login; debug logs ship in production paths; morgan('dev') not
machine-parseable; no request-ID correlation → production debugging requires stdout access.

### LOG-002 (LOW): minor info disclosure
db.js prints cwd when URI missing; script prints resolved dotenv path. URI masking at
lib/db.js:11 is a good pattern to preserve.

### Audit-log design gaps (folded into MONGO-001 task)
Log.diff is Mixed and could carry sensitive payloads as writers evolve; adopt a writer-side
field allowlist convention.

## Target observability baseline (Sprint 10)

1. Structured JSON logging with requestId middleware (uuid per request, echoed as
   `X-Request-Id` response header).
2. Replace ad-hoc console.* in lib/services/controllers; single structured request-log line.
3. Security event logging: login success/failure, role change, user CRUD, owner-gated ops,
   treasury undo — all currently invisible.
4. Health endpoints: `/health/live` and `/health/ready` (DB ping).
5. Optional: pino + pino-http keeps deps light; avoid heavy APM until deployment platform known.
