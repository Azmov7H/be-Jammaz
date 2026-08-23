# Sprints Overview

12 sprints · 60 tasks · one branch per sprint. Execution order below is a dependency chain —
do not reorder without reading the sprint's Dependencies section.

| # | Sprint | Branch | Objective | Tasks |
| - | ------ | ------ | --------- | ----- |
| 00 | [Baseline & Safety](sprint-00-baseline.md) | `feat/backend-sprint-00-baseline` | Deps, test harness, repo hygiene | 4 |
| 01 | [Architecture & Error Foundation](sprint-01-architecture.md) | `feat/backend-sprint-01-error-foundation` | Single error/response model; extract route logic | 5 |
| 02 | [Authentication & Authorization](sprint-02-auth-authz.md) | `feat/backend-sprint-02-auth-authz` | Repair RBAC, tokens, OAuth, IDORs | 8 |
| 03 | [Validation & API Contracts](sprint-03-validation-contracts.md) | `feat/backend-sprint-03-validation` | Wire zod everywhere; sanitize body; contract cleanup | 6 |
| 04 | [MongoDB & Data Integrity](sprint-04-database.md) | `feat/backend-sprint-04-data-integrity` | Indexes, constraints, atomic ops, counters | 8 |
| 05 | [Business Logic Flows](sprint-05-business-flows.md) | `feat/backend-sprint-05-business-flows` | Transactional payments/returns/receive/inventory | 5 |
| 06 | [Security Hardening](sprint-06-security.md) | `feat/backend-sprint-06-security` | Rate limits, docs gate, CORS policy, log hygiene | 4 |
| 07 | [Performance & Scalability](sprint-07-performance.md) | `feat/backend-sprint-07-performance` | Pagination caps, dashboard caching, N+1 fixes | 5 |
| 08 | [Testing & Regression Protection](sprint-08-testing.md) | `feat/backend-sprint-08-testing` | Auth matrix, concurrency, money-flow suites | 5 |
| 09 | [Code Quality & Cleanup](sprint-09-cleanup.md) | `feat/backend-sprint-09-cleanup` | Dead code, enum consistency | 3 |
| 10 | [Observability & DevOps](sprint-10-devops.md) | `feat/backend-sprint-10-devops` | Structured logs, shutdown, health, CI | 4 |
| 11 | [Final Production Hardening](sprint-11-hardening.md) | `feat/backend-sprint-11-hardening` | Checklist execution, self-pentest, load baseline | 3 |

Total: **60 tasks** (task IDs prefixed T-; see tasks/README.md for the authoritative registry).

Notes:
- The recommended template's "External Services/WebSockets" sprint was dropped: the only
  external integration is Google OAuth (folded into Sprint 02) and no WebSockets exist.
- Testing (Sprint 08) is deliberately placed *after* integrity sprints so tests encode the
  fixed behavior — but Sprint 00 installs the harness and Sprint 04/05 tasks each carry
  their own targeted tests.

Dependency graph: see [../architecture/dependency-graph.md](../architecture/dependency-graph.md).
Branch rules per sprint: [branch-map.md](branch-map.md). Commit/PR conventions:
[pr-strategy.md](pr-strategy.md).
