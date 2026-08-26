# Sprint 09 — Code Quality & Cleanup

> **STATUS: COMPLETE** (branch `feat/backend-sprint-09-cleanup`).
>
> Commits: T-CLN-01 `a73b445` · T-CLN-02 `7b7af18` · T-CLN-03 `fbc7c08`
>
> Gates: 21 files / 195 tests green (triple-run), lint **0 errors**/54
> warnings, coverage floors enforced.
>
> Acceptance evidence:
> - **T-CLN-01**: jsonwebtoken uninstalled (jose-only, grep-verified);
>   lib/cache.js deleted (+ its dead CACHE_TAGS import in customerService);
>   exportService/jspdf/api-response already absent. MMS boot retry added to
>   test helpers (kills recurring 10s-startup flake).
> - **T-CLN-02** decisions recorded:
>     * accountant/sales roles REMOVED — executed back in Sprint 02
>       (T-AUTH-01); legacy docs handled by migrate-legacy-roles.js.
>     * PaymentSchedule.status → lowercase aligning with Debt's public
>       contract (frontend consumes debt statuses; schedule statuses are
>       backend-internal). All code refs updated; paired migration
>       scripts/db/migrate-schedule-casing.js with CASE=down inverse.
>     * ShortageReport 'viewed'→'VIEWED' completing PENDING/VIEWED/RESOLVED;
>       migrate-shortage-casing.js + inverse.
>     * Product.unit stays free text (max 30, default 'piece') — frontend has
>       no unit field; no enum, no migration.
>   DEPLOY ORDER: schema/code first → run migrations → traffic. Rollback =
>   CASE=down + revert.
> - **T-CLN-03**: lib/permissions.js + models/DailyInventory.js deleted
>   (grep-verified zero importers; DailyInventory's hardcoded-threshold
>   contradiction already resolved via per-product minLevel in live alert
>   paths). index.js comments audited = documentation-grade only. PI stub was
>   resolved in Sprint 01 (T-ARC-03). Pagination constants already centralized
>   (lib/paginate.js).
>
> Rollback: per-commit reverts; migrations carry inverse scripts.

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
