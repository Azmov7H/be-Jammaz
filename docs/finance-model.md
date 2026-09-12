# Jammaz Financial Model (source of truth)

Two ledgers, two jobs. Do not mix them.

## 1. Where money is — `TreasuryTransaction` + `TreasuryBalance`

- Every movement writes one `TreasuryTransaction` (`INCOME`/`EXPENSE`,
  `method`, `referenceType`) via `TreasuryService._createTransactions`,
  which also bumps the single-doc `TreasuryBalance` (`T-PERF-03`).
- Invariant: `TreasuryBalance.balance == ΣINCOME − ΣEXPENSE` (see
  `_rebuildBalance`; enforced by `scripts/db/finance-baseline.js`).
- Per-method funds (cash/bank/wallet/…) are **derived lifetime nets** in
  `getSummary.breakdown` — there is no per-method stored balance except
  `TahweeshBalance`.
- `CashboxDaily` holds **per-day buckets** for the daily close only. Its
  rollups are recomputed atomically on every `$inc` (pipeline update);
  `closingBalance` is physical-count truth set by `reconcile()` alone.

## 2. What profit was earned — `AccountingEntry`

- Canonical Net Profit = `ReportingService.getFinancialReport`: revenue
  (credits to revenue accounts) − COGS − operating expenses, GL only.
- Dashboard profit (`ΣInvoice.profit − Manual EXPENSE`) is a second lens;
  the two intentionally differ (e.g. credit refunds). Both are pinned by
  `tests/profit-lenses.test.js` — do not "fix" the divergence away.
- Treasury legs alone NEVER move canonical profit. Only GL writers do
  (`accountingService.js`). Returns, refunds, debt adjustments and supplier
  payments are treasury-only unless stated otherwise.

## 3. Rules for every new money path

1. Backend validates `requested <= available` and returns 400 with figures;
   frontend may pre-check but never clamps (`FIN-OVERDEDUCT` precedent).
2. Multi-write flows run in ONE `withTransaction`; services that accept a
   session must never open a nested one (conditional-wrap pattern, T-04).
3. Reversals mirror the exact buckets written (`reverseCashboxFor`); GL
   effects are compensated with `REVERSAL` entries, never deleted (T-05/T-06).
4. Internal relocation is a **paired transfer**, never an expense
   (see `tahweesh.md`). Do not invent new relocation types without copying
   the Tahweesh contract below.
5. `fieldFor(method, …)` is the ONLY method→bucket mapping. Unknown
   methods fall back to cash; `tahweesh` returns null (no day bucket).
6. Deleting/voiding never rewrites history: compensate, don't edit.
