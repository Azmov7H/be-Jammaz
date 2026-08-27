# Validation Tasks (Sprint 03)

## T-VAL-01 — Canonical zod module wired to every endpoint
- Critical · CRITICAL (VAL-001)
- **Objective**: Single source of truth; zero raw-body endpoints.
- **Scope**: consolidate validators.js + product.schema.js + controller copies into `validations/` canonical module (fix barrel double-export); create/extend schemas for: users(create/update), customers, suppliers, payments(customer/supplier/unified/debt), expenses, returns, PO create/receive/status, treasury manual tx, GL entries, pricing custom, settings invoice-design (replace T-ARC-04 allowlist), physical-inventory items/query, notifications markRead ids, all list-query params (page/limit/sort/dates). Wire via small `validate(schema,source)` middleware per route.
- **Files**: validations/**, every routes/*.js, controllers/*.
- **Steps**: per-domain vertical slices, commit each (products→invoices→payments→parties→admin).
- **Risks**: previously-accepted payloads now 400 — smoke suite updated deliberately; changelog mandatory.
- **Testing**: schema unit tests + route-level 400 assertions incl. fieldErrors shape.
- **Acceptance**: grep: no route handler touches req.body before validate().

## T-VAL-02 — Sanitize req.body defense-in-depth
- High · CRITICAL support (VAL-001b)
- **Scope**: routeHandler sanitizeInput extended to body (mutating req.body is safe pre-zod); add dotted-key stripping (`a.$b`, keys containing dots at depth) — document that mongoSanitize ordering remains primary.
- **Testing**: injection payload test ($gt login bypass attempt → rejected).

## T-VAL-03 — Numeric & array bounds
- High · MEDIUM (VAL-002)
- **Scope**: money fields `.max(1e9)` & `.multipleOf(0.01)` where cents matter or documented rounding rule; quantities max 1e6; arrays `.max()` (items≤500, images≤10, payments≤100); pagination shared schema (limit ≤100 default 20) used by T-PERF-01 helper; creditLimit min 0; dates coerced+clamped (no future >+1y ranges for reports).
- **Acceptance**: bounds tests; no unbounded arrays reachable.

## T-VAL-04 — Restore credit-sale-requires-customer rule
- Critical · CRITICAL defect slice
- **Problem/Evidence**: controller invoice schema dropped validators.js `.refine` — credit invoices without customer accepted today.
- **Scope**: refine restored in canonical schema: paymentType=credit ⇒ customerId required; also assert customer exists in service (defense vs stale id) with NotFoundError.
- **Testing**: negative + positive cases. **Data check**: audit query for existing violating invoices (report only; remediation = owner decision).

## T-VAL-05 — ObjectId param validation
- Medium · MEDIUM
- **Scope**: apply idSchema to every `:id` param via validate() middleware → invalid ObjectId → 404 (NotFoundError) not CastError-500.
- **Testing**: garbage-id sweep across routers.
