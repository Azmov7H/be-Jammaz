# Sprint 03 — Validation & API Contracts

> **STATUS: COMPLETE** (branch `feat/backend-sprint-03-validation`).
>
> Acceptance evidence:
> - `grep "req.body" routes/` → every read sits behind `validate(schema)`
>   (authz gates run first); controllers no longer carry local schema copies
> - 19-row validation suite green: fieldErrors contract, injection payloads
>   (`$gt`, dotted keys), bounds (money ≤1e9, qty ≤1e6, arrays capped,
>   installments ≤60, pagination ≤100/default 20), credit-sale refine
>   (400 without customer; stale id → service-level 404), garbage
>   ObjectId sweep → 404 across 7 routers
> - T-API-02: purchases & physical-inventory getById no longer 200+null;
>   authMiddleware 404→401 already done in Sprint 02
> - lint clean; 80/80 tests across 7 files
>
> Contract notes:
> - Previously-accepted invalid payloads now → 400 `{details.fieldErrors}`;
>   global errorHandler now surfaces details on 400s (was dropped on the
>   middleware error path)
> - pagination default limit changed 10 → 20 (canonical shared schema)
> - payment `method` kept as enum cash|bank|wallet|check (optional) —
>   extend if frontend introduces new methods

- **Branch**: `feat/backend-sprint-03-validation`
- **Objective**: Every external input schema-validated; one source of truth for schemas;
  contract surface cleaned.
- **Findings**: VAL-001, VAL-002, ERR-002 remainder, API-001 remainder
- **Tasks**: T-VAL-01..05, T-API-02 (tasks/validation.md, tasks/api.md)
- **In scope**: consolidate validations/ into canonical zod module; wire into all mutating +
  query-param endpoints; body sanitization defense-in-depth; numeric/array bounds; restore
  credit-sale refine; ObjectId param validation; status-code normalization (401 vs 404, 200+null→404).
- **Out of scope**: schema-level DB constraints (Sprint 04); rate limiting.
- **Dependencies**: Sprint 01 error model (ZodError mapping), Sprint 02 gates settled
  (so 403 semantics stable).
- **Implementation order**: VAL-02 (sanitize) → VAL-01 (wire schemas) → VAL-04 (refine) →
  VAL-03 (bounds) → VAL-05 (params) → API-02 (status codes).
- **Validation**: negative-value and oversize-payload rejection tests; credit sale without
  customer → 400; unknown ObjectId → 404; envelope tests still green.
- **Frontend Contract Impact**: previously-accepted invalid payloads now 400 with fieldErrors;
  frontend must display them — changelog required.
- **Rollback**: revert merge; no DB impact.
