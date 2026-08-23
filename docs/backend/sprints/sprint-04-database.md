# Sprint 04 — MongoDB & Data Integrity

> **STATUS: COMPLETE** (branch `feat/backend-sprint-04-data-integrity`).
>
> Acceptance evidence:
> - Concurrency suite green: 50 parallel sales of stock=10 → exactly 10
>   succeed, final qty 0, ledger rows == successes; guarded transfers and
>   moveStock never overdraw (migrates to Sprint 08)
> - All stock mutations are conditional `$inc`/`findOneAndUpdate` with
>   guards + compensating writes; balances (cashbox/debt/invoice payments)
>   mutate atomically via pipeline updates
> - `withTransaction` hard-fails in production on unsupported topology;
>   dev standalone requires explicit ALLOW_NON_ATOMIC_DEV=true
> - INV/RET/PO numbering via atomic counters (`lib/counters.js`), seeded by
>   scripts/db/seed-counters.js — Date.now() fallback removed
> - lint clean; 83/83 tests across 8 files

## Isolation rules record (mandatory per task)

| Task | Schema impact | Existing-data audit | Migration/backfill | Rollback | Prod risk |
| ---- | ------------- | ------------------- | ------------------ | -------- | --------- |
| DB-01 indexes + Log TTL | none (declarative) | n/a | none | drop indexes | none |
| DB-02 min:0 constraints | validation-time only | `scripts/db/audit-data-integrity.js` negative scan — **run vs prod snapshot before merge**; owner sign-off if violators found | none unless violators | schema revert | low |
| DB-03 uniqueness | unique/partial-unique indexes | same script: receiptNumber dupes (+FIX mode), settings singletons, debt guard dupes, supplier phones | dedupe script for receipts | index drop | medium — merge blocked if dupes unfixed |
| DB-04 counters | new Counter rows | seed from maxima (`seed-counters.js`) | required before rollout | revert service imports | low |
| DB-05 stock atomicity | none | n/a | none | revert stockService | behavior-preserving serially |
| DB-06 balance atomicity | none | n/a | none | revert three sites | overpay now rejected (was silently capped) |
| DB-07 txn infra | none | topology check at boot | env flag opt-in only | revert dbUtils | standalone dev must set flag |
| DB-08 hygiene | soft maxlengths | n/a | none | schema diff | none |

**Decision recorded:** Invoice.profit intentionally NOT bounded below zero —
below-cost sales are a legitimate business case.

- **Branch**: `feat/backend-sprint-04-data-integrity`
- **Objective**: The database stops trusting application code: constraints, indexes, atomic
  mutations, real transactions.
- **Findings**: MONGO-001..005, DATA-001/002/004
- **Tasks**: T-DB-01..08 (tasks/database.md)
- **In scope**: index rollout; min:0 money constraints; uniqueness repairs; Counter adoption for
  INV/RET/PO numbering; atomic stock/balance mutations; withTransaction hard-fail in prod;
  schema hygiene (maxlengths, array caps, Log TTL); registration-pattern unification.
- **Out of scope**: flow-level transaction wrapping (Sprint 05 uses this sprint's primitives);
  data migrations beyond casing (Sprint 09).
- **Dependencies**: Sprint 03 (validated inputs reduce garbage before constraints tighten).
- **Implementation order**:
  1. DB-01 indexes (additive — safe first)
  2. DB-02/03 constraints + DB-08 hygiene — **after data audit queries prove no violating docs**
  3. DB-04 counters → DB-05 stock atomicity → DB-06 balance atomicity → DB-07 transaction infra
- **Database isolation rules (mandatory per task)**: each task documents schema impact,
  index impact, existing-data impact (with pre-flight audit query + result count),
  migration/backfill need, rollback strategy, production risk. Constraint tasks must run their
  audit query against a production snapshot/staging before merge.
- **Validation**: pre-flight scripts committed under scripts/db/; tests for each atomic op under
  concurrency (Promise.all ×50); explain() shows IXSCAN for new-index-backed queries.
- **Rollback**: additive indexes harmless if left; constraint tightening reverts via schema diff;
  counter adoption keeps old format readable.
