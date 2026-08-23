# DevOps & Final Hardening Tasks (Sprints 10–11)

## T-OPS-01 — Structured logging + request IDs
High · MEDIUM/HIGH (LOG-001, LOG-002)
- pino + pino-http (or equivalent minimal); requestId middleware (crypto.randomUUID) → logs + X-Request-Id echo; morgan removed in favor of single structured line; redact paths: never log bodies; security-event helper `logSecurityEvent(event, {userId,...})` used at login/role-change/treasury-undo/user-CRUD sites (Sprint 02/03 code gets instrumented here).
- Acceptance: sample request log JSON with correlation across two log lines.

## T-OPS-02 — Graceful shutdown + 404 + health
Critical-for-prod · HIGH (DEVOPS-001)
- SIGTERM/SIGINT → stop intake, server.close() w/ 10s force-exit, mongoose.connection.close(); Express JSON 404 for unknown routes (before errorHandler); /health/live (process) + /health/ready (db ping, adminCommand ping).
- Acceptance: kill -TERM during slow request → completes or 503, exit 0; health endpoints verified DB-up/down.

## T-OPS-03 — CI pipeline
High · HIGH (DEVOPS-001)
- GitHub Actions: on PR → npm ci, lint, test (with memory Mongo service or in-process), `npm audit --omit=dev` (fail on high+ unless allowlist file dated), artifact = nothing needed. Branch protection documented.
- Acceptance: green run on sprint branch.

## T-OPS-04 — Deployment artifacts & runbook
Medium · MEDIUM
- Dockerfile (node:22-alpine, non-root, HEALTHCHECK /health/live), optional compose with mongo replica-set single-node for local transaction parity; DEPLOYMENT.md runbook: env vars table, index pre-flight step, start, health verification, rollback steps.
- Acceptance: image builds; compose boots app+mongo and smokes pass against it.

## T-FIN-01 — Production-readiness execution
Sprint 11 · Critical · closure
- Execute sprints/production-readiness.md item-by-item; every box gets evidence link; gaps found → new hotfix tasks, not silent check-offs.

## T-FIN-02 — OWASP self-review re-run
Sprint 11 · High
- Re-walk audit doc 11 categories post-remediation; append "post-hardening status" section to 11-security-audit.md; targeted manual probes: IDOR sweep with two accounts, mass-assignment probes on top endpoints, token replay scenario, brute-force burst.

## T-FIN-03 — Load baseline + rollback drill
Sprint 11 · High
- autocannon/bombardier profiles: dashboard mix, invoice create, payment recording (staging data); record p50/p95/p99 into docs/backend/perf-baseline.md; backup restore drill into staging + smoke suite pass; document RTO/RPO observed.
