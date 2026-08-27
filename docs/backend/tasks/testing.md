# Testing Tasks (Sprint 08)

Suites live under tests/; all run in CI from Sprint 10. Money-path tests use real Mongo
(memory server) + real transactions; mocks are not accepted for DoD here.

## T-TST-01 — Authorization matrix suite
High · TEST-001 closure
- Generated matrix: roles(owner,manager,cashier,warehouse,viewer) × protected endpoints from audit doc 06 tables; expected results encoded from Sprint-02 gate decisions; fails on any drift.
- Includes: dead-role regression (no 'admin' anywhere), last-owner guard cases, IDOR cases (notifications).

## T-TST-02 — Concurrency suites
Critical support · DATA-001/002 regression protection
- Parallel sales vs limited stock; parallel debt payments; parallel cashbox increments; PO double-receive; installment replace during payment. Pattern: Promise.all workers against app+memory Mongo; assert exact final states.

## T-TST-03 — Money-flow integration tests
High
- invoice(cash) create→pay→statement; invoice(credit)+installments→partial payments→close; return partial→refund-to-treasury AND credit variants; purchase receive→supplier debt→payment. Each asserts accounting entries created and balances reconcile (cashbox = sum transactions invariant where applicable).

## T-TST-04 — Contract & status-code suite
Medium
- Envelope shape on representative endpoints incl. settings; error classes → status map (Zod 400 fieldErrors, NotFound 404, Forbidden 403, Conflict 409, CastError 404, E11000 409); auth lifecycle: login/refresh rotation/reuse-revocation/logout.

## T-TST-05 — Fix broken unit tests + barrel
Medium
- lib/validators.test.js repointed to canonical validations module and expanded to cover T-VAL-03 bounds; fix validations/index.js double star-export; delete obsolete copies when T-VAL-01 landed.
