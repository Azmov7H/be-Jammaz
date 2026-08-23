# Sprint 08 — Testing & Regression Protection

- **Branch**: `feat/backend-sprint-08-testing`
- **Objective**: Encode the fixed system in tests so regressions are impossible to merge quietly.
- **Findings**: TEST-001 completion
- **Tasks**: T-TST-01..05 (tasks/testing.md)
- **In scope**: authorization matrix suite; concurrency suites for stock/payments; money-flow
  integration tests (invoice→payment→return→statement); contract/status-code suite; fix broken
  validators test + barrel export.
- **Out of scope**: E2E browser tests; load testing (Sprint 11).
- **Dependencies**: Sprints 01–07 merged (tests assert corrected behavior).
- **Validation**: coverage thresholds set pragmatically (≥85% lines on services/financial,
  middlewares, lib); CI runs suite (CI itself lands Sprint 10 — run locally until then).
- **Rollback**: tests-only branch; trivially revertible.
