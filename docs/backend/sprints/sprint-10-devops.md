# Sprint 10 — Observability & DevOps

- **Branch**: `feat/backend-sprint-10-devops`
- **Objective**: Operable in production: structured logs, graceful lifecycle, health, CI.
- **Findings**: DEVOPS-001 completion, LOG-001/LOG-002
- **Tasks**: T-OPS-01..04 (tasks/devops.md)
- **In scope**: pino-style JSON logs + X-Request-Id middleware; security-event log lines;
  SIGTERM/SIGINT drain (server.close → mongoose close, 10s cap); Express 404 JSON handler;
  /health/live + /health/ready; GitHub Actions (install→lint→test→audit gate); optional
  Dockerfile with HEALTHCHECK; index pre-flight script.
- **Out of scope**: APM vendor choice; multi-instance store migration (documented only).
- **Dependencies**: Sprint 00 scripts; Sprint 08 suite for CI green gate.
- **Validation**: kill -TERM during in-flight request → response completes or 503 after drain,
  process exits 0; CI run green on PR; health endpoints verified with DB up/down.
- **Rollback**: revert merge; infra files additive.
