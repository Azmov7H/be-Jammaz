# 07 — Validation & Sanitization Audit

## Current state

Three disconnected validation layers exist; only fragments run:

1. **Global middleware**: `express-mongo-sanitize` (strips `$` keys from body/query/params)
   and `hpp`. Runs for every request ✔.
2. **routeHandler sanitizeInput** (lib/route-handler.js:18-29): recursive `$`-key strip on
   `req.params`/`req.query` **only** — body deliberately excluded → VAL-001 (defense-in-depth gap;
   mongoSanitize covers most body cases but not dotted-key pollution, and ordering coupling
   is implicit).
3. **Zod schemas** — wired in exactly 3 places: authController (login), productController,
   invoiceController. Everything else passes raw `req.body` into services.

## The dead validation library (VAL-001)

`validations/validators.js` defines 13 schemas (idSchema, paginationSchema, loginSchema,
userSchema±update, productSchema, stockMoveSchema, customerSchema, supplierSchema,
invoiceSchema, purchaseOrderSchema, poReceiveSchema, expenseSchema). **Zero imports
outside the folder.** Additionally:

- `validations/product.schema.js` is a second divergent productSchema; `validations/index.js`
  star-exports both → duplicate export name, barrel is ambiguous/broken.
- The controller's invoice copy **dropped** the `.refine` requiring a customer for credit
  sales (validators.js:111-113) → **credit invoices without a customer pass validation**
  today (money-impacting defect).
- `lib/validators.test.js` imports `'./validators.js'` which does not exist → test suite broken.

## Input-source coverage

| Source | Coverage |
| ------ | -------- |
| req.body | mongoSanitize only, except 3 controllers with zod. Raw-body endpoints include: all /financial/payments/*, expenses, returns, users create/update, suppliers, settings PUT (**mass assignment**, comment admits it), PO create/receive, pricing custom, manual treasury income/expense, GL entries, physical-inventory items |
| req.params | never validated as ObjectId (CastError → 500); `$`-stripped |
| req.query | `$`-stripped; pagination parsed ad hoc per service; dates cast via raw `new Date(x)` (Invalid Date propagates into $match) |
| headers/cookies | cookie token verified; nothing else consumed |
| uploads | N/A |

## Specific gaps (VAL-002)

- No array length limits anywhere (invoice.items, stockMove.items, images[]).
- No numeric maxima (prices, amounts, tax) — only bound in the entire codebase is
  `paginationSchema.limit.max(100)` (unwired).
- Negative values accepted where nonsensical: creditLimit, prices, payment amounts
  (schema-level min:0 also missing — see MONGO-002; both layers must agree).
- Email normalization absent in zod (relies on Mongoose lowercase on User only).
- Mass assignment vectors: UserService.create/update spread raw body (role!, isActive);
  SettingsController.updateInvoiceDesign `Object.assign(settings, updates)`;
  CustomerService.update spreads body.

## Injection notes

- NoSQL operators: mitigated primarily by mongoSanitize; routeHandler body gap tracked
  as defense-in-depth (VAL-001b). No `$where`/`$function` usage found in codebase.
- Regex injection: product/customer search builds `new RegExp(q)` unescaped inline
  (stockRoutes.js:12-39 etc.) → ReDoS/matcher-abuse possible by authenticated users
  (folded into PERF/RATE hardening; escape or use `$expr`/index-friendly prefix match).
- Prototype pollution: no unsafe deep-merge utilities used; hpp covers query duplication.

## Remediation order

Sprint 01 error/response foundation → Sprint 03 wires zod per endpoint (single source of
truth in `validations/`, controllers import from there), restores the credit refine,
adds bounds, deletes duplicates.
