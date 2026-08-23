# Sprint 04 — MongoDB & Data Integrity

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
