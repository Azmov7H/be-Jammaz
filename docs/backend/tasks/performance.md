# Performance Tasks (Sprint 07) — every task attaches explain("executionStats") before/after

## T-PERF-01 — Pagination & range caps everywhere
High · HIGH (PERF-001)
- Shared paginate helper (page,limit≤100) applied to: users list, logs entity query, treasury transactions (+financial variants w/ default 30d window + max 90d), physical-inventory list, accounting ledger (add skip), daily-sales summary/best-sellers (max 180d), customer statement (max 1y). Fix dead `limit` param in getProductHistory.
- Acceptance: endpoint sweep test asserts caps; helper unit-tested.

## T-PERF-02 — Dashboard consolidation + cache
High · HIGH
- Merge ~12 aggregations into fewer pipelines with date-bounded $match defaults; introduce tiny TTL cache (in-memory Map, 30s, keyed per role-scope — user isolation test mandatory) behind env flag DASHBOARD_CACHE_TTL; document invalidation = short TTL only (no event invalidation needed at 30s).
- Acceptance: p95 improvement recorded; two users never share cross-role data.

## T-PERF-03 — Treasury read redesign
Medium · MEDIUM (PERF-003)
- getCurrentBalance → running-balance document updated transactionally by writers (SystemMeta or dedicated doc) with lazy rebuild fallback; getSummary stops returning full transaction list (returns aggregates + latest N=20); partner transactions endpoint gains defaults+cap.
- DB note: new balance doc = additive; rebuild script provided; rollback = delete doc (fallback recomputes).

## T-PERF-04 — N+1 elimination & compression
Medium · HIGH→MEDIUM (PERF-002, PERF-004)
- deleteTransactionByRef → aggregate affected dates → bulkWrite incs → deleteMany (single pass); notification sync loops batched via insertMany; add compression middleware (level default) — verify SSE/streaming none present.
- Acceptance: query-count assertion tests (mongotool or event listener counting commands).

## T-PERF-05 — Regex hardening + explain evidence pack
Medium · LOW/MEDIUM
- Escape user regex input (`q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')`) or anchor-prefix strategy in product/customer search; compile explain-evidence appendix for top-10 queries into docs/backend/architecture/data-flow.md addendum; document express.json limit decision.
