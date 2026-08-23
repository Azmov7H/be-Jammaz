# Sprint 09 — Code Quality & Cleanup

- **Branch**: `feat/backend-sprint-09-cleanup`
- **Objective**: Remove dead weight and align enums/roles so future readers aren't misled.
- **Findings**: CLEAN-001..003, CLEAN-002
- **Tasks**: T-CLN-01..03 (tasks/cleanup.md)
- **In scope**: delete exportService+jspdf+api-response+jsonwebtoken (grep-verified unused);
  unify model registration guards; decide accountant/sales roles (implement permissions or
  remove from enum — owner decision recorded in PR); status enum casing normalization
  (**data migration** for stored values — isolated task); remove commented filler.
- **Out of scope**: service splitting; renames of public API fields.
- **Dependencies**: Sprint 08 (tests catch accidental behavior change), except CLN-01 which
  can ride earlier with grep proof.
- **Validation**: full test suite green; grep proves no imports of deleted modules;
  casing migration has rollback script.
- **Rollback**: per-commit reverts; casing migration script paired with inverse script.
