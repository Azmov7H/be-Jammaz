# Sprint 01 — Architecture & Error Foundation

- **Branch**: `feat/backend-sprint-01-error-foundation`
- **Objective**: One error model and one response envelope; business logic out of route files.
- **Findings**: ERR-001, ERR-002 (partial), ARCH-001, API-001
- **Tasks**: T-ARC-01..04, T-API-01 (tasks/architecture.md, tasks/api.md)
- **In scope**: AppError hierarchy + mapper consolidation; string-throw migration across
  services/routes; settingsController service extraction + envelope fix; inline route logic →
  services; duplicate endpoint deprecation plan.
- **Out of scope**: role gate values (Sprint 02); validation schemas (Sprint 03);
  status-code fixes requiring new gates.
- **Dependencies**: Sprint 00 merged (lint/test available).
- **Implementation order**: ARC-01 (foundation) → ARC-02 (envelope) → ARC-03/04 (extraction)
  → API-01 (duplicates/deprecations).
- **Validation**: grep proves zero `throw '` string throws in services/routes; contract tests
  from Sprint 00 still green after envelope normalization; manual smoke of login/invoice flows.
- **Acceptance criteria**: single error shape `{success,message,code?,details?,timestamp}`;
  Arabic not-found returns 404; permission failures return 403 path ready (gate wiring in 02).
- **Frontend Contract Impact**: HIGH — response bodies and some status codes change; ship with
  changelog entry for frontend team; coordinate before merge.
- **Rollback**: revert merge; no DB impact.
