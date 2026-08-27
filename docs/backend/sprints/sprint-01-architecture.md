# Sprint 01 — Architecture & Error Foundation

> **STATUS: COMPLETE** (branch `feat/backend-sprint-01-architecture`).
> Commits: T-ARC-01 `481ade9` · T-ARC-02 `b7bc833` · T-ARC-03 `74595d2` ·
> T-ARC-04 `3056691` · T-API-01 `de4a769`.
>
> Acceptance evidence:
> - `grep "throw '"` across services/routes/controllers/lib/middlewares → **0**
> - Single error shape `{success,message,code,details?,data,timestamp}`;
>   mapper unit tests (13) + characterization suite (20) = 33/33 green
> - Arabic not-found → 404; permission failures → 403 (UnauthorizedError/
>   ForbiddenError in lib/permissions.js, gate wiring deepens in Sprint 02)
> - `npm run lint`: 0 errors / 47 documented warnings
>
> Deviations from plan (all recorded):
> - T-API-01 canonical purchases path **flipped** to `/api/purchase-orders`
>   after verifying actual frontend usage (`Jammaz-System/src`)
> - T-ARC-03: removed `/:id/recent-movements` stub (unimplementable as-is)
> - Frontend changelog: docs/backend/api-deprecations.md

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
