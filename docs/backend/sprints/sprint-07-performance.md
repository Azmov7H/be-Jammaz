# Sprint 07 — Performance & Scalability

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
