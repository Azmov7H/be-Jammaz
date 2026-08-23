# Backend Audit & Remediation Roadmap — be-Jammaz (Transfer ERP)

> Audit date: 2026-08-23 · Auditor: Principal backend audit (evidence-based, read-only)
> Scope: backend only (`index.js`, `routes/`, `controllers/`, `services/`, `middlewares/`,
> `lib/`, `models/`, `repositories/`, `utils/`, `validations/`, `scripts/`).
> No source code was modified during this phase.

## Stack (verified from code, not docs)

| Component   | Version / Detail                                        |
| ----------- | ------------------------------------------------------- |
| Node.js     | v24.14.1 (runtime), ESM (`"type": "module"`)            |
| Express     | ^4.21.0                                                 |
| MongoDB     | Atlas (URI via `MONGODB_URI`), driver via Mongoose      |
| Mongoose    | ^8.7.0                                                  |
| Language    | JavaScript (no TypeScript)                              |
| Auth        | JWT (jose HS256) in httpOnly cookie, bcryptjs, Google OAuth |
| Validation  | zod ^4 — **present but almost entirely unwired**        |
| Testing     | None configured (2 stray `*.test.js` files, no runner)  |
| Deploy      | No Dockerfile / CI; started via `node index.js`         |

## Backend Health: **AT RISK**

The domain model is rich (24 collections, double-entry accounting, cashbox, debt,
inventory) but the safety layer around it is thin: broken role gates, non-atomic
money operations, unwired validation, and no tests.

## Production Readiness: **NOT READY** (see [sprints/production-readiness.md](sprints/production-readiness.md))

## Findings Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 11    |
| HIGH     | 14    |
| MEDIUM   | 12    |
| LOW      | 5     |
| **Total**| **42**|

Full registry: [findings/](findings/README.md)

## Critical Findings (top of the burn-down)

| ID      | Title                                                                 |
| ------- | --------------------------------------------------------------------- |
| ACL-001 | Dead `admin` role locks out 10+ endpoints (role enum mismatch)        |
| ACL-002 | Manager can escalate to owner / delete last owner (vertical privesc)  |
| ACL-003 | Financial write endpoints have zero role restrictions                 |
| ACL-004 | IDOR: any user can mark any other user's notifications read           |
| AUTH-001| No token revocation/rotation; logout leaves JWT valid for 24h         |
| DATA-001| Stock reduction is read-modify-write → oversell & lost updates        |
| DATA-002| Cashbox / debt / invoice paid-amount lost-update races                |
| DATA-003| Multi-document financial flows run without transactions (+ silent fallback) |
| VAL-001 | `req.body` never sanitized; validation layer dead; credit-invoice rule dropped |
| SEC-001 | Public unauthenticated API documentation at `GET /api/docs`           |
| SEC-002 | Session endpoint likely returns password hash (VERIFY + fix)          |

## High / Medium / Low

See [findings/high.md](findings/high.md), [findings/medium.md](findings/medium.md),
[findings/low.md](findings/low.md).

## Totals

- Findings: **42**
- Tasks: **60**
- Sprints: **12**
- Branches: **12** (one per sprint)

## Current Sprint

Sprint 00 — Baseline & Safety (not started).

## Recommended Starting Sprint / Branch

`feat/backend-sprint-00-baseline` — dependency remediation, test harness,
repo hygiene. Nothing else should merge before Sprint 01's error foundation
lands, because every later task depends on a single error/response model.

## Recommended First Task

`TASK-B00-02` — Dependency remediation (`npm audit`: 17 vulnerabilities incl.
a vulnerable `express-rate-limit` whose IPv6 bypass directly weakens the only
rate limiter present).

## Architecture Summary

Classic layered Express monolith:
`routes → routeHandler wrapper → controllers (4 only) / services (20+) → models/repositories → MongoDB`.
Most business logic lives in services (good), but several routes contain inline
queries and payment-dispatch logic, repositories are inconsistently used, and two
competing error-handling systems coexist. Details: [architecture/current.md](architecture/current.md).

## Documentation Index

| Doc | Content |
| --- | ------- |
| [00-audit-scope.md](00-audit-scope.md) | Scope, method, what was excluded and why |
| [01-current-state.md](01-current-state.md) | Verified stack, entry point, middleware order, module map |
| [02-architecture-audit.md](02-architecture-audit.md) | Layering, boundaries, duplication findings |
| [03-express-audit.md](03-express-audit.md) | App init, middleware order, routes, middleware quality |
| [04-api-contract-audit.md](04-api-contract-audit.md) | Full 118-endpoint inventory with auth/validation/pagination flags |
| [05-authentication-audit.md](05-authentication-audit.md) | JWT lifecycle, OAuth, sessions, enumeration |
| [06-authorization-audit.md](06-authorization-audit.md) | Role matrix, dead roles, escalation paths, IDORs |
| [07-validation-audit.md](07-validation-audit.md) | Zod usage, gaps, injection surface |
| [08-mongodb-audit.md](08-mongodb-audit.md) | All 24 models: indexes, constraints, Mongoose patterns |
| [09-data-integrity-audit.md](09-data-integrity-audit.md) | Races, transactions, counters, atomicity |
| [10-business-logic-audit.md](10-business-logic-audit.md) | Money flows, state machines, bypassable rules |
| [11-security-audit.md](11-security-audit.md) | OWASP pass, CORS/Helmet, secrets sweep |
| [12-rate-limiting-audit.md](12-rate-limiting-audit.md) | Limiter config, abuse protection gaps |
| [13-error-handling-audit.md](13-error-handling-audit.md) | Dual error systems, status-code mapping |
| [14-observability-audit.md](14-observability-audit.md) | Logging, request IDs, PII exposure |
| [15-performance-audit.md](15-performance-audit.md) | Unbounded queries, N+1, aggregation cost |
| [16-testing-audit.md](16-testing-audit.md) | Test coverage reality, broken tests |
| [17-dependency-audit.md](17-dependency-audit.md) | Vulnerability inventory with upgrade targets |
| [18-code-quality-audit.md](18-code-quality-audit.md) | Dead code, duplication, cleanup risk classes |
| [19-devops-audit.md](19-devops-audit.md) | Deployment, shutdown, health, CI reality |

Sub-directories:

- [findings/](findings/README.md) — registry by severity
- [sprints/](sprints/README.md) — sprint plans, branch map, PR strategy, DoD, production checklist
- [tasks/](tasks/README.md) — atomic implementation tasks grouped by domain
- [architecture/](architecture/current.md) — current/target architecture, dependency graph, request/data flow

Notes on absent categories: no WebSockets, no server-side file uploads, and no
server-side cache exist in this codebase (`lib/cache*.js` are React Query configs
for the frontend that live in this repo); dedicated audits for those categories
are therefore omitted.
