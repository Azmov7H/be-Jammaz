# 02 — Architecture Audit

Classification legend: [D]=Defect, [A]=Architectural Problem, [T]=Technical Debt,
[M]=Maintainability Problem, [O]=Optimization.

## Layering

### What works
- Service-oriented core: 20+ domain services own business logic (treasury, stock,
  debt, accounting, physical inventory). Route files mostly stay thin where they
  delegate to services through `routeHandler`.
- Repository pattern exists for user/product/invoice/customer/debt.
- Central wrapper (`routeHandler`) gives uniform success envelope and async error capture.

### Violations [A]

| Location | Problem |
| -------- | ------- |
| `financeRoutes.js:82-101` | `/financial/payments` fetches `Debt` and `PurchaseOrder` models in the route file and dispatches payment flows inline |
| `financeRoutes.js:104-144` | `/financial/receipts/:id` builds full receipt DTO inline (40 lines, settings fallback, partner resolution) |
| `stockRoutes.js:12-39,50-59` | Mongo query construction + `Product.find` directly in routes |
| `customerRoutes.js:34-60` | Pricing response mapping inline in route |
| `physicalInventoryRoutes.js:27-31` | Inline accessor with TODO-style comment ("might need implementation") |
| `settingsController.js` | Persistence logic (`Object.assign(settings, updates); settings.save()`) inside controller |

### Repository bypass [M]
`userService`, `customerService`, `productService`, `treasuryService`,
`stockService`, etc. import models directly despite repositories existing for the
same aggregates. Two data-access idioms coexist → inconsistent selection/projection
habits (this is how the password-hash exposure risk in SEC-002 arose).

### Competing cross-cutting conventions [A]
- Error signaling: string throws (`throw 'ليس لديك صلاحية'`) vs `AppError` vs plain
  `Error`. The string heuristic in `route-handler.js:79` mis-maps Arabic "not found"
  messages to 500s and permission failures to 400s (see 13-error-handling-audit.md).
- Response shaping: `routeHandler` envelope vs unused `ApiResponse` helper vs raw
  `res.json` in settingsController.
- Model registration: 4 different hot-reload guard styles across 24 models
  (see 08-mongodb-audit.md §Registration).

## Duplication [T]

| Item | Instances |
| ---- | --------- |
| product zod schema | 3 divergent copies (`validations/validators.js`, `validations/product.schema.js`, `controllers/productController.js`) with conflicting min-length/unit/gender rules |
| login schema | 2 copies (validators.js, authController.js) |
| invoice schema | 2 copies; controller copy **dropped** the credit-sale-customer `.refine` |
| installments endpoints | `GET /financial/debts/:debtId/installments` ≡ `GET /financial/installments/:debtId` |
| purchase routes | `/api/purchases` and `/api/purchase-orders` mount the same router (documented alias) plus duplicate status-update endpoints `PUT /:id/status` and `PATCH /:id` |
| price-history report | `GET /reports/price-history` and `/price-history/:productId` |

## Dead code [T]

- `validations/` — 13 schemas imported nowhere outside their folder.
- `services/exportService.js` — Excel/PDF generator referenced by nothing (PDF path unconditionally throws).
- `lib/api-response.js` — never imported by routes/services.
- `jspdf`, `jspdf-autotable` deps — server-side PDF explicitly rejected by exportService design.
- Docs payload advertises `POST /api/auth/register` which does not exist.

## Circular/global state

- `global.mongoose` cache in `lib/db.js` (acceptable dev pattern; harmless in single-process prod).
- `TreasuryTransaction.js:54-56` registers a throwaway `UnifiedCollection` model on the
  `customers` collection at import time — hidden global side effect [M].

## Verdict

The architecture is salvageable without rewrite: consolidate error handling and
response envelope first (Sprint 01), extract route-inline logic, then everything
else (validation wiring, transactions, tests) becomes mechanical.
