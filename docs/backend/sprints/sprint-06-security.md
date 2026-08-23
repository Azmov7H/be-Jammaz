# Sprint 06 — Security Hardening

- **Branch**: `feat/backend-sprint-06-security`
- **Objective**: Abuse protection and configuration policy finalized.
- **Findings**: RATE-001, SEC-001, SEC-003, LOG-001 (hygiene slice)
- **Tasks**: T-SEC-02..05 (tasks/security.md)
- **In scope**: limiter upgrade + auth/heavy route limiters; docs endpoint gate; CORS/NODE_ENV
  policy decision documented + enforced; log scrubbing of emails/debug lines (structured logging
  itself is Sprint 10); startup warning when NODE_ENV unset.
- **Out of scope**: token model (done in 02); validation (03).
- **Dependencies**: Sprint 02 (auth endpoints stable); Sprint 07 not required but dashboard
  chattiness note feeds T-PERF-02.
- **Implementation order**: SEC-03 (trivial) → SEC-02 → SEC-04 → SEC-05.
- **Validation**: burst test against login returns 429; /api/docs unauthenticated → 401;
  grep shows no email logging; config matrix documented in README of sprint PR.
- **Frontend Contract Impact**: 429 bodies must be surfaced gracefully.
- **Rollback**: revert merge.
