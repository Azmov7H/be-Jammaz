# Sprint 02 — Authentication & Authorization

> **STATUS: COMPLETE** (branch `feat/backend-sprint-02-auth-authz`).
> Commits: T-SEC-01 `3655202` · T-AUTH-01 `752281b` · T-ACL-01/02 `cfc6c65` ·
> T-ACL-03 `fd32926` · T-AUTH-02/03/04 `24ed8d9` · matrix+fixes `b4cf2d5`.
>
> Acceptance evidence:
> - Authorization matrix suite green (25 rows): privesc paths → 403,
>   last-owner/self-delete → 409, deleted-session → 401, refresh replay
>   revokes family, logout kills session
> - Zero reachable write endpoints grant access below intended role;
>   zero 'admin' gate references remain (were unreachable by any real role)
> - Stolen-refresh scenario has revocation path (reuse detection + tv bump
>   on role/password/deactivation)
> - Manager cannot obtain owner: /api/users writes owner-only + service-level
>   defense (only owner grants 'owner', nobody edits own role)
> - lint 0 errors; 61/61 tests across 6 files
>
> Decisions recorded:
> - Canonical roles = owner|manager|cashier|warehouse|viewer;
>   accountant/sales removed from enum (no permission mapping ever existed);
>   migration script scripts/db/migrate-legacy-roles.js (accountant→manager,
>   sales→cashier, DRY_RUN supported) — run against production BEFORE merge
> - Payments dispatcher gated manager+ (can reach supplier/unified paths);
>   cashiers keep POST /payments/customer
> - Notification delete unified to visibility predicate (view deletion)
> - Access token TTL now 15m default (ACCESS_TOKEN_TTL); frontend must call
>   POST /api/auth/refresh on 401

- **Branch**: `feat/backend-sprint-02-auth-authz`
- **Objective**: Correct RBAC everywhere; secure token lifecycle; close escalation and IDOR holes.
- **Findings**: ACL-001..004, AUTH-001/002/003/004, SEC-002
- **Tasks**: T-AUTH-01..04, T-ACL-01..03, T-SEC-01 (tasks/auth.md, tasks/authorization.md)
- **In scope**: role-gate repair/replacement; user-management hardening; last-owner guard;
  notification markRead scoping; refresh-token rotation + revocation; OAuth provisioning policy;
  uniform login errors; password field hardening.
- **Out of scope**: per-endpoint zod validation (03); rate limiting (06).
- **Dependencies**: Sprint 01 (typed errors → ForbiddenError gives real 403s).
- **Implementation order**:
  1. SEC-01 (hash exposure — smallest, highest privacy value)
  2. AUTH-01 (role model repair — unblocks everything)
  3. ACL-01, ACL-02 (user mgmt), ACL-03 (financial gates), ACL-04 (IDOR)
  4. AUTH-02 (tokens), AUTH-03 (OAuth), AUTH-04 (enumeration)
- **Validation**: authorization matrix test suite green (built here, expanded in Sprint 08);
  manual matrix: each role × representative endpoint.
- **Acceptance criteria**: no reachable endpoint grants write access below intended role;
  stolen-token scenario has revocation path; manager cannot obtain owner.
- **Frontend Contract Impact**: 401 vs 404 on deleted-user session; possible new refresh
  cookie; role-gated buttons may 403 where they used to succeed (dead-admin endpoints become
  usable again).
- **Database Considerations**: tokenVersion/refresh collection = additive; document in task.
- **Rollback**: revert merge; additive index/collection harmless.
