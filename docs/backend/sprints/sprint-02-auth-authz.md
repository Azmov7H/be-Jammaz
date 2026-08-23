# Sprint 02 — Authentication & Authorization

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
