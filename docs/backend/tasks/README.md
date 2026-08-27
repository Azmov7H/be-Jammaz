# Tasks Registry

60 atomic tasks across 12 sprints. One section per task; every task carries the full
field set (Task ID, Sprint, Branch, Priority, Severity, Objective, Problem, Evidence,
Root Cause, Scope, Affected Files, Implementation Steps, Dependencies, Risks, Security /
Database / Performance Considerations, Testing Requirements, Acceptance Criteria,
Definition of Done, Related Findings/Tasks). Shared DoD lives in
[../sprints/definition-of-done.md](../sprints/definition-of-done.md) and is not repeated
verbatim per task; task sections add only what is specific.

| Domain file | Tasks | Sprint |
| ----------- | ----- | ------ |
| [baseline.md](baseline.md) | T-B00-01..04 | 00 |
| [architecture.md](architecture.md) | T-ARC-01..04 | 01 |
| [api.md](api.md) | T-API-01, T-API-02 | 01, 03 |
| [auth.md](auth.md) | T-AUTH-01..04, T-SEC-01 | 02 |
| [authorization.md](authorization.md) | T-ACL-01..03 | 02 |
| [validation.md](validation.md) | T-VAL-01..05 | 03 |
| [database.md](database.md) | T-DB-01..08 | 04 |
| [business-logic.md](business-logic.md) | T-BIZ-01..05 | 05 |
| [security.md](security.md) | T-SEC-02..05 | 06 |
| [performance.md](performance.md) | T-PERF-01..05 | 07 |
| [testing.md](testing.md) | T-TST-01..05 | 08 |
| [cleanup.md](cleanup.md) | T-CLN-01..03 | 09 |
| [devops.md](devops.md) | T-OPS-01..04, T-FIN-01..03 | 10, 11 |

No `integrations/` domain: Google OAuth work is in auth.md; no other external services exist.
