# Sprint Branch Map

One sprint = one branch = one reviewable PR. Branches cut from `main` sequentially;
a branch may start only after its dependency column is satisfied (merged to main).

| Sprint | Branch | Objective | Depends on | Tasks | Key findings closed |
| ------ | ------ | --------- | ---------- | ----- | ------------------- |
| 00 | `feat/backend-sprint-00-baseline` | Baseline & safety | – | 4 | DEP-001, TEST-001*, DEVOPS-002 |
| 01 | `feat/backend-sprint-01-error-foundation` | Error/response model | 00 | 5 | ERR-001, ARCH-001 |
| 02 | `feat/backend-sprint-02-auth-authz` | AuthN/AuthZ repair | 01 | 8 | ACL-001..004, AUTH-001..004, SEC-002 |
| 03 | `feat/backend-sprint-03-validation` | Validation & contracts | 02 | 6 | VAL-001/002, API-001*, ERR-002 |
| 04 | `feat/backend-sprint-04-data-integrity` | MongoDB integrity | 03 | 8 | MONGO-001..005, DATA-001/002/004 |
| 05 | `feat/backend-sprint-05-business-flows` | Transactional flows | 04 | 5 | DATA-003, BIZ-001, DATA-005 |
| 06 | `feat/backend-sprint-06-security` | Hardening | 02 | 4 | RATE-001, SEC-001/003 |
| 07 | `feat/backend-sprint-07-performance` | Performance | 04,06 | 5 | PERF-001..004 |
| 08 | `feat/backend-sprint-08-testing` | Regression suites | 01–07 | 5 | TEST-001 |
| 09 | `feat/backend-sprint-09-cleanup` | Cleanup | 08 | 3 | CLEAN-001..003 |
| 10 | `feat/backend-sprint-10-devops` | Observability/DevOps | 00,08 | 4 | DEVOPS-001, LOG-001/002 |
| 11 | `feat/backend-sprint-11-hardening` | Final proof | all | 3 | closure pass |

(*) partial closure; remainder in listed later sprint.

## Per-branch rules template

Every branch document (the sprint file) declares:

- **Purpose**: the sprint objective.
- **Allowed changes**: only files named by that sprint's tasks (+ task-scoped tests/docs).
- **Forbidden changes**: frontend files; unrelated refactors; dependency changes outside
  Sprint 00; destructive DB operations outside Sprint 04/09 isolated tasks.
- **Expected files**: enumerated per task in tasks/*.md "Affected files".
- **Validation**: the sprint file's Validation section, run locally before PR.
- **Commit discipline**: one logical task per commit (see pr-strategy.md).

Hotfix exception: a CRITICAL security regression discovered post-merge may bypass the queue
with a dedicated `hotfix/backend-*` branch referencing the finding ID; it merges after review
and its fix gets a regression test within 48h.
