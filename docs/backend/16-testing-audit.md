# 16 — Testing Audit

## Reality (TEST-001, HIGH)

- No test framework installed. No script (`package.json` has only start/dev).
- Two stray files:
  - `lib/validators.test.js` — **cannot even load**: imports `'./validators.js'` which does
    not exist at that path (real file: `validations/validators.js`); also imports unused `z`.
  - `services/notificationService.test.js` — self-contained with manual model mocks;
    reasonable quality but runs nowhere.
- No fixtures, no test DB strategy, no CI.

## Critical missing coverage (priority order)

1. **Authorization matrix**: every role × every gated endpoint (would have caught ACL-001..003).
2. **Authentication**: login ok/bad-creds/disabled, session shape (would have caught SEC-002),
   logout semantics.
3. **Money integrity**: invoice create→payment→return round-trip preserves balances;
   concurrent payments to one debt; concurrent sales of last unit (would have caught DATA-001/002).
4. **Validation contract**: credit sale without customer rejected; negative amounts rejected;
   payload bounds.
5. **State machines**: PO single-receive; installment replacement; count completion.
6. Regression pack for error mapping (404 vs 400 vs 500) once Sprint 01 lands.

## Recommended harness (TASK-B00-03)

- Runner: **vitest** (ESM-native, zero-config with `"type":"module"`) or node:test.
- DB: mongodb-memory-server for integration tests; unit tests mock models as
  notificationService.test.js already does.
- npm scripts: `test`, `test:watch`, `coverage`. Add to CI (Sprint 10).
- Seed helpers per domain (user/token factory, product/customer/invoice builders).

## Acceptance bar for "tested" in this roadmap

A flow counts as tested only when the test exercises HTTP layer (supertest-style via app
export) or service layer with real Mongo (memory server) — mocks-only tests don't satisfy
DoD for money-path tasks.
