# Tahweesh (التحويش) — Set-Aside Account

Money intentionally parked aside. Isolated from operating totals and from
Net Profit by construction.

## Accounting contract

- A **deposit / return-to-cash** is a PAIRED transfer sharing
  `meta.transferId`: `(EXPENSE source + INCOME tahweesh)` or the reverse,
  `referenceType: 'TahweeshTransfer'`. The pair nets to zero on
  `TreasuryBalance` and writes no `AccountingEntry` — Net Profit cannot move.
- A **spend** is exactly ONE business transaction whose treasury leg has
  `method: 'tahweesh'` (debt/supplier payment, purchase via credit-then-pay,
  operating expense). There is no separate "withdrawal" leg.
- `POST /api/tahweesh/deposit {source: cash|instapay|wallet, amount, note,
  transferId, sourceNumber?}` — sourceNumber required for instapay/wallet.
- `POST /api/tahweesh/withdraw {amount, note, transferId}` — returns money
  to cash. Funding a payment is NOT a withdraw; pay with `method:'tahweesh'`.
- `GET /api/tahweesh/balance` — stored `TahweeshBalance` (rebuilt from the
  ledger when missing; `rebuildTahweeshBalance()` is the drift detector).
- No overdraft: deposits check source lifetime net; every outflow decrements
  with a `$gte` guard (concurrent overspends fail 400, never negative).
- Idempotent on `transferId`: replays return `{duplicate: true}`.
- Single-leg undo of a transfer pair is refused (409) — reverse via withdraw.
  Undoing a tahweesh-funded spend restores the set-aside automatically.

## Read-path isolation (do not break)

- `getSummary`/`getCashFlow` exclude `TahweeshTransfer` from period
  income/expense; `breakdown.tahweesh` carries the set-aside net.
- Day buckets never see tahweesh legs (`fieldFor` returns null); cash legs
  of deposits/returns book as manual cash-out/in (a transfer is neither a
  purchase nor a sale).
- Dashboard expenses filter `Manual` referenceType only, so transfer legs
  never leak into dashboard profit; tahweesh-funded operating expenses are
  real expenses and appear exactly once in both profit lenses.

## Frontend

- `TahweeshDialog` (deposit/withdraw, ceilings from `breakdown` + balance,
  toast on over-amount, never clamps) mounted on the treasury page.
- `MethodBalancesCard` shows the `تحويش (مرصود)` row; `getPaymentLabel`
  renders `تحويش` on receipts/history. `bank` stays input-removed (T-08);
  `tahweesh` must never be added to generic payment selectors.
