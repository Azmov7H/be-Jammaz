# Sprint 01 — Architecture & Error Foundation Tasks

## T-ARC-01 — Unified error model (foundation)
- **01 / error-foundation branch** · Critical priority · HIGH (ERR-001)
- **Objective**: Single AppError hierarchy + single mapper; string throws eliminated.
- **Problem**: route-handler string heuristic sends Arabic not-found→500, permission strings→400; two pipelines produce different shapes.
- **Evidence**: lib/route-handler.js:56-99 vs middlewares/errorHandler.js; throw sites listed in audit doc 13.
- **Root cause**: AppError introduced late; services never migrated.
- **Scope**: create `lib/errors.js` (`AppError{statusCode,code,message,details}` + NotFoundError/ValidationError/ForbiddenError/ConflictError/BadRequestError); mapper in route-handler delegates to one function; add CastError→404, E11000→409 mappings; migrate every `throw '...'` and business `new Error(...)` across services/routes (~30 sites per audit docs); delete legacy string branches from mapper; eslint rule `no-throw-literal` → error.
- **Affected files**: lib/errors.js(new), lib/route-handler.js, middlewares/errorHandler.js, all services/financial/*, routes with inline throws (financeRoutes, physicalInventoryRoutes…), utils/dbUtils.js warning path.
- **Steps**: errors module → mapper consolidation → mechanical migration service-by-service (commit each) → lint gate on.
- **Risks**: message text changes reach clients — keep Arabic user-facing messages identical; status codes intentionally change (documented).
- **Security**: permission failures now 403 — verify no client depends on 400. **Perf**: n/a.
- **Testing**: mapper unit tests (each class→status/shape); smoke suite updated where codes changed.
- **Acceptance**: grep zero literal throws; contract tests for the 6 mapped classes green.
- **Related**: ERR-001, ERR-002 partial.

## T-ARC-02 — Response envelope consolidation
- 01 · High · MEDIUM (API-001)
- **Objective**: One success shape everywhere: `{success:true,data,message:null,timestamp}` (+pagination field).
- **Scope**: settingsController returns via wrapper (extract persistence first? no — envelope only here); deprecate+delete lib/api-response.js; document pagination meta convention `{pagination:{page,limit,total,pages}}`.
- **Files**: controllers/settingsController.js, lib/api-response.js(del), docs/backend API notes.
- **Frontend impact**: invoice-design endpoints' body shape changes.
- **Testing**: contract smoke asserts shape on representative endpoints incl. settings.

## T-ARC-03 — Extract inline route logic into services
- 01 · High · HIGH (ARCH-001)
- **Objective**: Routes only wire HTTP; logic lives in services.
- **Scope**: financeRoutes payments dispatcher → FinanceService.resolvePayment; receipts/:id assembly → TreasuryService.buildReceipt; stockRoutes inline Product queries → StockService.listStock/listStatus; customerRoutes pricing mapping → PricingService.getCustomerPricingView; physicalInventory recent-movements stub → implemented or removed (decision recorded).
- **Files**: routes/{finance,stock,customer,physicalInventory}Routes.js, services/{financeService,stockService,pricingService}.js.
- **Testing**: existing smokes stay green (pure refactor); new unit tests optional here.
- **Related**: ARCH-001.

## T-ARC-04 — Settings persistence out of controller
- 01 · Medium · MEDIUM
- **Objective**: settingsController delegates to InvoiceSettingsService.updateInvoiceDesign(ownerUser, payload) with explicit field allowlist (real validation lands T-VAL-01; allowlist is interim mass-assignment stopgap).
- **Files**: controllers/settingsController.js, services/invoiceSettingsService.js(new).
- **Security**: closes settings Object.assign vector early. **Acceptance**: unknown fields ignored + logged.

## T-API-01 — Contract surface cleanup
- 01 · Medium · MEDIUM (API-001)
- **Objective**: Remove ambiguity for clients.
- **Scope**: pick canonical `/api/purchases`, alias kept but marked deprecated header `Deprecation` + note; collapse duplicate installments endpoint (keep one, alias other internally); collapse PUT/POST invoice-design to PUT; fix docsRoutes payload (remove register, align paths); duplicate price-history path removal decision recorded.
- **Frontend impact**: audit frontend usage before removing aliases (grep Next.js repo if available; otherwise keep aliases + deprecation headers this sprint, removal decision documented).
- **Acceptance**: every endpoint appears once canonically; deprecation policy written.
