# Sprint 07 — Performance & Scalability

> **STATUS: COMPLETE** (branch `feat/backend-sprint-07-performance`).
>
> Acceptance evidence:
> - **T-PERF-01** (`8805fe1`): `lib/paginate.js` (parsePagination limit≤100/skip,
>   boundedRange window clamp) applied to users, logs, treasury+partner
>   transactions, inventory counts, accounting entries/ledger, daily-sales,
>   customer statement, stock movements; getProductHistory dead-limit fixed;
>   getSummary decoupled from capped list via $group. 9-endpoint sweep suite.
> - **T-PERF-05** (`22abe98`): `lib/safeRegex.js` literalContains at all 6
>   search sites; `scripts/perf/explain-evidence.js` executionStats harness +
>   data-flow.md addendum (index selection table); express.json=1mb decision.
> - **T-PERF-02** (`502706f`): KPIs today+month merged into faceted scans
>   (4 aggs→2); strategy single-scan; `lib/ttlCache.js` role-scoped
>   (privileged|staff), DASHBOARD_CACHE_TTL env (0=off, default 30s);
>   isolation/stale/expiry tests.
> - **T-PERF-03** (`2c4f8ea`): TreasuryBalance running doc transactionally
>   bumped by all writers via choke points; lazy rebuild + rebuild script
>   (DRY_RUN default); getSummary `transactions`→`recentTransactions`(≤20)
>   CONTRACT CHANGE; receiptNumber unique index made SPARSE (latent Sprint-04
>   bug: second expense/manual insert always hit 11000). DEPLOY: drop legacy
>   index once — db.treasurytransactions.dropIndex('receiptNumber_1').
> - **T-PERF-04** (`7a89cc7`): deleteTransactionByRef single-pass (day-grouped
>   cashbox writes, deleteMany, one balance delta); notification scanners
>   batched via createMany (1 find + 1 insertMany per sweep, spy-tested);
>   compression middleware added (no SSE present). ENVELOPE FIX: routeHandler
>   `result || null` → `result ?? null` (0 no longer serialized as null).
> - lint clean; **122/122 tests across 16 files**
>
> Rollback notes: cache off via DASHBOARD_CACHE_TTL=0; balance rollback =
> delete TreasuryBalance doc (lazy rebuild recomputes); caps are behavior
> changes — changelog entries required for frontend.

- **Branch**: `feat/backend-sprint-07-performance`
- **Objective**: Hot paths bounded, cached where safe, and provably indexed.
- **Findings**: PERF-001..004
- **Tasks**: T-PERF-01..05 (tasks/performance.md)
- **In scope**: shared pagination helper + hard caps on all unbounded endpoints; dashboard
  aggregation consolidation + short-TTL cache; treasury balance/summary redesign (running-balance
  doc or bounded window); deleteTransactionByRef batching; regex escaping in searches;
  compression middleware; explain() evidence pass.
- **Out of scope**: multi-instance infra work (documented as constraint); frontend refactors
  (chattiness noted as contract impact only).
- **Dependencies**: Sprint 04 (indexes exist before measuring), Sprint 06 (rate limits sized
  after caching reduces load).
- **Implementation order**: PERF-01 caps → PERF-05 explain baseline → PERF-02 dashboard →
  PERF-03 treasury → PERF-04 N+1/compression.
- **Validation**: before/after `explain("executionStats")` attached to PR; p95 latency captured
  via simple autocannon/bombardier run recorded in task file; cache user-isolation test
  (two users get distinct dashboards).
- **Rollback**: feature-flag the cache (env var); caps are behavior changes — changelog.
