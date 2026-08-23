# Sprint 05 — Business Logic Flows

- **Branch**: `feat/backend-sprint-05-business-flows`
- **Objective**: Multi-document financial flows become all-or-nothing and idempotent.
- **Findings**: DATA-003 (+flows), BIZ-001, DATA-005
- **Tasks**: T-BIZ-01..05 (tasks/business-logic.md)
- **In scope**: wrap customer/supplier/unified payments, returns, purchase receive,
  physical-count completion, installment replacement, opening balances in transactions;
  guarded PO state transition; verify-bank-integration dry-run mode.
- **Out of scope**: new business features; report logic.
- **Dependencies**: Sprint 04 DB-07 (transaction infra hard-fails in prod when unsupported).
- **Implementation order**: BIZ-04 (smallest guard) → BIZ-01 payments → BIZ-02 returns+receive
  → BIZ-03 inventory/installments/opening → BIZ-05 script.
- **Validation**: integration tests kill process mid-flow (fault injection) and assert zero
  partial writes; double-submit receive → second call 409.
- **Acceptance criteria**: every flow in audit doc 09 table has a fault-injection test.
- **Database Considerations**: requires replica set (Atlas default ✔); standalone dev gets
  explicit failure, not silent degradation.
- **Rollback**: revert merge; no schema change.
