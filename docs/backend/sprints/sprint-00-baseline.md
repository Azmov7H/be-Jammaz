# Sprint 00 — Baseline & Safety

> **STATUS: COMPLETE** (branch `feat/backend-sprint-00-baseline`).
> Commits: T-B00-01 hygiene · T-B00-02 deps 17→0 vulns (incl. removal of unused
> exceljs/jspdf stack + dead exportService — absorbs the CLN-01 slice) ·
> T-B00-03 vitest harness (in-memory replica set; transactions work like Atlas) ·
> T-B00-04 eslint baseline (0 errors / 79 documented warnings) + 13-test
> characterization suite. `npm run lint` ✅ · `npm test` 20/20 ✅.
>
> Audit corrections discovered during bring-up (recorded in findings registry):
> 1. SEC-001 reframed — /api/docs is protected only transitively via reportRoutes'
>    bare-`/api` mount; fix is now about making protection explicit, not adding it.
> 2. DATA-003 refined — withTransaction's standalone fallback is dead code;
>    standalone MongoDB hard-fails invoice creation with a 500 today.

- **Branch**: `feat/backend-sprint-00-baseline`
- **Objective**: Make the repo safe to change — patched dependencies, runnable test harness,
  reproducible environment, lint baseline.
- **Findings**: DEP-001, TEST-001 (partial), DEVOPS-002, CLEAN-003 (lint enablement only)
- **Tasks**: T-B00-01..04 (see tasks/baseline.md)
- **In scope**: dependency upgrades; vitest+mongodb-memory-server setup; eslint config;
  .env.example; lockfile unification; characterization smoke tests (login, product list,
  invoice create) that pass against current behavior.
- **Out of scope**: any behavior change; error-model changes; schema changes.
- **Dependencies**: none. First branch of the roadmap.
- **Implementation order**: B00-01 → B00-02 → B00-03 → B00-04.
- **Validation**: `npm audit` clean or documented accepted-risk table; `npm test` green;
  `npm run lint` green; app boots with `.env.example` as template.
- **Acceptance criteria**: all four tasks DoD-complete.
- **Definition of Done**: sprint README updated; CI-ready scripts exist (`test`, `lint`);
  no unrelated files touched.
- **Rollback**: revert merge; dependency bumps re-verifiable via lockfile diff.
