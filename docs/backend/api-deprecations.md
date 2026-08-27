# API Deprecation Policy & Contract Changes

Decisions are grounded in actual frontend usage (verified by grepping
`Jammaz-System/src` services/hooks on 2026-08-23).

## Policy

1. Every endpoint appears **once canonically**; aliases return the same handler
   with a `Deprecation: true` response header.
2. Deprecated aliases are removed only after the frontend stops calling them;
   removal is announced in this file first.
3. Breaking body-shape changes ship with a changelog entry for the frontend team.

## Decisions (Sprint 01 / T-API-01)

### Purchase orders — canonical `/api/purchase-orders`
- Audit originally proposed canonical `/api/purchases`; **flipped** because the
  frontend exclusively calls `/api/purchase-orders`.
- `/api/purchases` kept as deprecated alias (sends `Deprecation: true`).

### Installments — canonical `/api/financial/debts/:debtId/installments`
- Frontend uses BOTH paths (`useFinancial.js` → debts path; `debtService.js`
  → legacy `/installments/:debtId` + `POST /installments`).
- Added canonical POST (previously only existed as body-driven `POST /installments`).
- Legacy GET/POST now send `Deprecation: true`.

### Invoice design settings — canonical `PUT /api/settings/invoice-design`
- POST duplicate removed. Verified: frontend currently calls neither.
- Envelope changed to standard `{success,data,message,timestamp}` (T-ARC-02).

### Price history — no duplicate found
- Only `GET /api/reports/price-history(/:productId)` exists; frontend uses it.
- No action required.

### Removed endpoints
- `GET /api/physical-inventory/:id/recent-movements` — stub that always returned
  `[]`; no frontend consumer found (T-ARC-03 decision).

## Error/status contract changes (T-ARC-01) — HIGH frontend impact

| Situation | Before | After |
| --------- | ------ | ----- |
| Not found (any entity) | 400 or 500 (string heuristic) | **404** `code=NOT_FOUND` |
| Permission denied | 400 | **403** `code=FORBIDDEN` |
| Unauthenticated | string → 400/500 | **401** `code=UNAUTHORIZED` |
| Duplicate unique value | 400 | **409** `code=CONFLICT` |
| Validation (Zod/Mongoose) | fieldErrors in `data` | fieldErrors in **`details`**, `data:null` |
| Error body shape | `{success,error}` (middleware path) | `{success,message,code,data,timestamp}` |
| Success envelope | mixed | `{success:true,data,message:null,timestamp}` everywhere |
