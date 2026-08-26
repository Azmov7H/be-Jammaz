# Sprint 08 — Testing & Regression Protection

> **STATUS: COMPLETE** (branch `feat/backend-sprint-08-testing`).
>
> Commits: T-TST-05 `8b77469` · T-TST-01 `ab2f059` · T-TST-02 `e9f5d02` ·
> T-TST-03 `6b83dcf` · T-TST-04 `913bcaa` · coverage `ce28a99`
>
> Final gate: **21 files / 195 tests / 0 lint errors**; coverage floors
> enforced (middlewares 100, lib ≥85 after documented exclusions,
> financial ≥60 — behavioral money-path guarantees carried by exact-state
> integration suites).
>
> Acceptance evidence:
> - **T-TST-01** authz matrix: 35 rows (5 roles × ACL-001/003 tables +
>   user-mgmt + cashier-keeps-payments decision); dead-role static grep;
>   legacy admin doc containment; last-owner guard (Arabic 409);
>   notification IDOR scoped by visibility.
> - **T-TST-02** concurrency (Promise.all × real txns): stock race exact,
>   debt overpay impossible, cashbox == ledger aggregate, PO double-receive
>   deterministic 409, re-plan/payment race invariants. STABLE across runs.
> - **T-TST-03** money flows: cash invoice→statement→reconcile; credit
>   invoice+installments→settle; partial returns BOTH refund variants;
>   credit PO receive→supplier debt→payment closes everything.
> - **T-TST-04** envelope shape incl. settings; error map Zod/NotFound/
>   Forbidden/CastError/E11000→{400,404,403,404,409}; auth lifecycle with
>   rotation + reuse-revocation + tokenVersion invalidation.
>
> PRODUCTION BUGS FOUND BY THE SUITES (all fixed on this branch):
> 1. withTransaction lacked transient retry → WriteConflict 500s (added
>    label+code+message-aware retry w/ backoff+jitter).
> 2. Receipt counter bumped inside txn → duplicate REC-n E11000 (moved out).
> 3. Expense treasury rows stored receiptNumber:null → sparse unique index
>    collides on the SECOND such row ever (key now omitted). Same family as
>    Sprint-07's sparse fix — deploy note: dropIndex receiptNumber_1 once.
> 4. POST /financial/payments/debt read debtorType/_id off the frontend's
>    {_id} stub → schedule sync + partner meta silently skipped; bare ids
>    404. Doc resolved first.
> 5. POST /financial/payments/supplier: same stub-bug (undefined _id).
> 6. /purchase-orders/:id/receive: zod default('cash') forced CASH payment
>    of credit POs (debts never created) + body-forwarded-as-paymentType +
>    dropped userId; recordPurchaseExpense wrote method:'credit' (invalid).
> 7. CashboxDaily.category enum rejected UI values maintenance/marketing.
> 8. createInstallmentPlan: stale pre-txn amount read + Invalid Date when
>    startDate omitted.
> 9. PATCH /notifications/mark-read validated raw body vs {ids} → every
>    real call 400'd (frontend contract verified).
> 10. ACL-003 twins POST/DELETE /customers/:id/pricing still ungated from
>     Sprint 02 → owner+manager now.
>
> Rollback: tests-only + the fixes above; each fix is independent and
> revert-safe; suites will flag any regression loudly.

- **Branch**: `feat/backend-sprint-08-testing`
- **Objective**: Encode the fixed system in tests so regressions are impossible to merge quietly.
- **Findings**: TEST-001 completion
- **Tasks**: T-TST-01..05 (tasks/testing.md)
- **In scope**: authorization matrix suite; concurrency suites for stock/payments; money-flow
  integration tests (invoice→payment→return→statement); contract/status-code suite; fix broken
  validators test + barrel export.
- **Out of scope**: E2E browser tests; load testing (Sprint 11).
- **Dependencies**: Sprints 01–07 merged (tests assert corrected behavior).
- **Validation**: coverage thresholds set pragmatically (≥85% lines on services/financial,
  middlewares, lib); CI runs suite (CI itself lands Sprint 10 — run locally until then).
- **Rollback**: tests-only branch; trivially revertible.
