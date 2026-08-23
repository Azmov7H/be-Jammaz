# Sprint 00 — Baseline Tasks

## T-B00-01 — Repo & environment hygiene
- **Sprint/Branch**: 00 / `feat/backend-sprint-00-baseline` · **Priority**: High · **Severity**: LOW (DEVOPS-002)
- **Objective**: One package manager; env contract documented.
- **Problem**: npm + pnpm lockfiles both committed; no `.env.example`; 8 env vars undocumented.
- **Evidence**: repo root listing; audit doc 01 env table.
- **Root cause**: tooling drift during development.
- **Scope**: remove pnpm lockfile + workspace file (or commit to pnpm fully — decision recorded); add `.env.example` with all 8 vars and comments; add `engines.node`.
- **Affected files**: `.env.example` (new), `package.json`, delete `pnpm-lock.yaml`, `pnpm-workspace.yaml`.
- **Steps**: decide manager → delete other lockfile → write .env.example → verify fresh install+boot.
- **Dependencies**: none. **Risks**: contributor workflow change — announce.
- **Security/DB/Perf**: n/a.
- **Testing**: fresh clone install + boot script run.
- **Acceptance**: single lockfile; `.env.example` complete; boots.
- **Related**: DEVOPS-002.

## T-B00-02 — Dependency remediation
- 00 / same branch · High · HIGH (DEP-001)
- **Objective**: Zero known vulnerabilities in production deps or documented accepted risk.
- **Problem/Evidence**: `npm audit --omit=dev` = 17 vulns (1 critical, 9 high, 7 moderate); express-rate-limit IPv6 bypass directly weakens RATE-001; body-parser DoS; exceljs→uuid/tmp chain. Audit doc 17.
- **Root cause**: no dependency update discipline/CI gate.
- **Scope**: `npm audit fix` non-breaking pass; targeted bumps: express-rate-limit ≥8.5.1, exceljs latest 4.x; identify the truncated critical advisory by re-running audit and record it here; evaluate exceljs removal instead via future CLN-01 (preferred if export stays dead).
- **Affected files**: package.json, package-lock.json.
- **Steps**: record full audit output in PR → apply fixes → smoke all routes → document any accepted risk table.
- **Risks**: transitive major bumps — inspect lockfile diff; reject npm's suggested exceljs 3.4 downgrade.
- **Testing**: Sprint-00 smoke suite (T-B00-04) green post-upgrade.
- **Acceptance**: `npm audit --omit=dev` = 0 or accepted-risk table reviewed.
- **Related**: DEP-001, unblocks RATE-001 fix.

## T-B00-03 — Test harness bootstrap
- 00 / same branch · High · HIGH enabler (TEST-001)
- **Objective**: Runnable test infrastructure with real-Mongo integration support.
- **Problem**: no runner; broken lib/validators.test.js imports nonexistent module.
- **Scope**: add vitest + mongodb-memory-server + supertest; app factory export from index.js (`export { app }` without listen when imported); npm scripts test/test:watch/coverage; port notificationService.test.js to runner; fix or quarantine lib/validators.test.js (full fix in T-TST-05).
- **Affected files**: package.json, vitest.config.js (new), index.js (export only), tests/** (new), two *.test.js files.
- **Steps**: install → config (single Mongo instance per worker) → migrate existing tests → first passing run.
- **Risks**: index.js currently calls startServer() at import — guard behind `if (process.env.NODE_ENV !== 'test')`.
- **Testing**: harness self-evident. **Acceptance**: `npm test` green with ≥1 integration + ≥1 unit test running.
- **Related**: TEST-001.

## T-B00-04 — Characterization smoke suite + lint baseline
- 00 / same branch · Medium · enabler
- **Objective**: Lock current behavior for critical flows before we change anything; lint gate.
- **Scope**: eslint (flat config) with no-unused-vars, no-throw-literal ready (warn now, error in Sprint 01); smoke tests: login success/fail shape, products list envelope, invoice create happy path, session shape — asserting CURRENT responses verbatim.
- **Affected files**: eslint.config.js (new), tests/smoke/* (new), package.json scripts.
- **Dependencies**: B00-03. **Acceptance**: lint passes on untouched codebase (warnings allowed); smokes green.
