# API / Contract Tasks

## T-API-01 — Contract surface cleanup (executed in Sprint 01)
Full task definition lives in [architecture.md](architecture.md) (T-API-01 section) for
execution locality; referenced here for registry completeness. Related finding: API-001.

## T-API-02 — Status-code hygiene completion
- **Sprint/Branch**: 03 / validation branch · High · MEDIUM (ERR-002)
- **Objective**: Correct status codes on every path.
- **Problem/Evidence**: authMiddleware 404s deleted-user-with-valid-token; getById handlers return 200+null (purchases, physical-inventory); any residual mis-maps after T-ARC-01.
- **Scope**: authMiddleware 404→401 (message: session invalid); NotFoundError in getById services returning null; verify all `غير موجود` paths now 404 via typed errors.
- **Files**: middlewares/authMiddleware.js, services/{purchaseOrderService,physicalInventoryService}.js + audit-doc-13 list.
- **Frontend impact**: 200+null consumers must handle 404 — changelog.
- **Testing**: contract suite rows for each fixed path.
