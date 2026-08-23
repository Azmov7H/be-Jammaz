# Production Readiness Checklist

Evidence column must link a PR, test run, or command transcript. Nothing is marked done
by default — this is the Sprint 11 exit artifact.

## Build & runtime
- [ ] `npm ci && npm start` boots clean with only `.env.example`-derived vars — evidence:
- [ ] Lint passes — evidence:
- [ ] Full test suite passes in CI — evidence:

## Authentication
- [ ] Login ok / bad-creds / disabled-account behaviors match spec (uniform errors) — evidence:
- [ ] Access token lifetime ≤ 15m; refresh rotation verified; reuse detected → family revoked — evidence:
- [ ] Logout invalidates server-side (refresh revoked; access expires ≤15m) — evidence:
- [ ] OAuth cannot create accounts without invitation/approval — evidence:
- [ ] Session response contains no password material — evidence: T-SEC-01 regression test

## Authorization
- [ ] Authorization matrix executed for all roles × protected endpoints (0 failures) — evidence:
- [ ] No endpoint grants write access to unintended roles — evidence:
- [ ] Last-owner protection verified (delete + deactivate) — evidence:
- [ ] markRead/delete scoped to recipient — evidence:

## Input validation
- [ ] All mutating endpoints reject invalid/negative/oversized payloads with 400 + fieldErrors — evidence:
- [ ] Credit sale without customer rejected — evidence:
- [ ] ObjectId params validated (404 not CastError-500) — evidence:

## Critical APIs verified
- [ ] Invoice create → payment → partial return → statement consistent — evidence:
- [ ] PO receive idempotent under double submit — evidence:
- [ ] Physical count completion all-or-nothing (fault injection) — evidence:

## Database
- [ ] Index list matches models (`getIndexes()` diff script) — evidence:
- [ ] Uniqueness enforced: invoice/return/PO numbers, receiptNumber, settings singleton — evidence:
- [ ] Money fields reject negatives at schema layer — evidence:

## Data integrity & concurrency
- [ ] Concurrent sales of last unit: exactly one succeeds — evidence:
- [ ] Concurrent debt payments: sum preserved exactly — evidence:
- [ ] Cashbox increments never lost under parallel writes — evidence:

## Rate limiting & abuse
- [ ] express-rate-limit ≥8.5.1 (IPv6 fix); auth limiter 429s brute force — evidence:
- [ ] Heavy report endpoints limited/cached — evidence:

## Security baseline
- [ ] /api/docs requires auth — evidence:
- [ ] CORS policy documented and enforced per NODE_ENV decision — evidence:
- [ ] No secrets in source/history re-verified — evidence:
- [ ] Production errors contain no stacks/internal paths — evidence:

## Errors & observability
- [ ] Unified error envelope across all endpoints (contract suite green) — evidence:
- [ ] Request IDs present in logs + X-Request-Id header — evidence:
- [ ] Security events logged (login, role change, treasury undo) — evidence:

## Lifecycle
- [ ] SIGTERM drains connections; exit code 0 — evidence:
- [ ] /health/live and /health/ready correct when DB down — evidence:
- [ ] Unknown routes → JSON 404 — evidence:

## Performance
- [ ] p95 dashboard < agreed budget under load baseline — evidence:
- [ ] explain() evidence attached for top-10 queries — evidence:

## Deployment & recovery
- [ ] Deployment runbook exists (env vars, index pre-flight, start, health) — evidence:
- [ ] Backup restore drill completed in staging + smoke passed — evidence:
- [ ] Rollback plan for current release tested — evidence:
