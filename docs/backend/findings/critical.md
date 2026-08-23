# Findings — CRITICAL (11)

Full evidence in the referenced audit docs. Format: ID · title · evidence anchors →
recommendation → linked tasks.

---

## ACL-001 — Dead `admin` role locks out 10+ endpoints
- **Category**: Defect / Broken Access Control · **Audit doc**: 06
- **Evidence**: `roleMiddleware(['admin'])` gates at customerRoutes, productRoutes,
  invoiceRoutes delete; logRoutes.js:9 (whole router); stockRoutes.js:90 adjust;
  purchaseRoutes delete; treasuryRoutes.js:56 undo; physicalInventoryRoutes.js:51,57.
  `models/User.js` role enum has no `'admin'`; no API path can create one.
- **Impact**: deletion/correction workflows impossible via API; audit logs unreadable;
  invites dangerous "fixes" (widening gates) under pressure.
- **Fix**: choose canonical role set; replace dead gates with intended roles
  (`owner` or `['owner','manager']`); add migration note for any legacy docs.
- **Tasks**: T-AUTH-01

## ACL-002 — Manager can escalate to owner / destroy last owner
- **Category**: Defect / Vertical Privilege Escalation · **Audit doc**: 06
- **Evidence**: userRoutes.js:9 gate `['owner','manager']` covers create/update/delete;
  userService.js spreads raw body incl. `role`, `isActive`; delete = bare findByIdAndDelete;
  no last-owner guard (contrast physicalInventoryService.js:356 which requires an owner).
- **Impact**: any manager becomes owner silently; sole-owner deletion bricks owner-only ops.
- **Fix**: owner-only for role assignment & user deletion; forbid self-demotion/deletion;
  last-active-owner guard on delete AND isActive=false.
- **Tasks**: T-ACL-01

## ACL-003 — Money-touching writes have zero role restrictions
- **Category**: Defect / Broken Access Control · **Audit doc**: 06
- **Evidence**: manual treasury income/expense (treasuryRoutes), custom pricing
  (pricingRoutes/customerRoutes), GL entry posting (accountingRoutes — middleware imported,
  unused), stock transfer/move (stockRoutes), all payment recording (financeRoutes),
  PATCH physical-inventory items (physicalInventoryRoutes.js:40) while its sibling
  create/complete ARE gated.
- **Impact**: a cashier/viewer token can move cash, set prices, book journal entries.
- **Fix**: permission matrix from lib/permissions.js applied as route gates after
  T-AUTH-01 repairs the role model.
- **Tasks**: T-ACL-02

## ACL-004 — Notification markRead IDOR
- **Category**: Defect / IDOR · **Audit doc**: 06
- **Evidence**: notificationService.js:150-153 updates `{_id:{$in:ids}}` with no recipient filter;
  delete asymmetry for role-targeted notifications (:168-169).
- **Impact**: cross-user unread-count manipulation; inconsistent lifecycle.
- **Fix**: scope updates to `recipientId:user OR isGlobal/targetRole` semantics; unify delete rule.
- **Tasks**: T-ACL-03

## AUTH-001 — No token revocation/rotation; logout is cosmetic
- **Category**: Defect / Authentication Failure · **Audit doc**: 05
- **Evidence**: lib/auth.js static HS256 JWT, default 24h; authController.logout clears cookie only;
  no denylist/version claim anywhere.
- **Impact**: stolen token valid up to 24h post-compromise; cannot evict a session.
- **Fix**: short-lived access token + rotating refresh tokens stored hashed w/ reuse detection
  (or minimal `tokenVersion` on User checked per request — middleware already loads user).
- **Tasks**: T-AUTH-02

## DATA-001 — Stock read-modify-write race (oversell / lost updates)
- **Category**: Defect / Concurrency · **Audit doc**: 09
- **Evidence**: stockService.js:17-81 reduceStockForSale (JS decrement + `$set` bulkWrite);
  same pattern increaseStockForPurchase:93-163 (also AVCO buyPrice math), transfer/move variants
  :168-239, :452-587; bulkMoveStock has no sufficiency check at all.
- **Impact**: concurrent sales both pass check and overwrite each other; AVCO cost corrupted.
- **Fix**: conditional atomic ops `findOneAndUpdate({...qty:{$gte:n}}, {$inc:{...}})` +
  movement ledger write only on success; AVCO inside transaction.
- **Tasks**: T-DB-05

## DATA-002 — Balance lost-update races (cashbox, debt, invoice paidAmount)
- **Category**: Defect / Concurrency · **Audit doc**: 09
- **Evidence**: treasuryService.updateDailyCashbox:226-274 findOne→JS add→save;
  debtService.updateBalance:118-146 findById→subtract→save (callers pass no session:
  paymentService.js:57,107,183,228); models/Invoice.js:65-88 recordPayment array-push+save.
- **Impact**: concurrent payments/collections silently drop increments; books drift from reality.
- **Fix**: guarded `$inc` mutations (`remainingAmount:{$gte:paid}` precondition);
  atomic `$push`+`$inc` on invoices; upsert-`$inc` cashbox.
- **Tasks**: T-DB-06

## DATA-003 — Multi-document financial flows without transactions (+ silent fallback)
- **Category**: Defect / Data Integrity · **Audit doc**: 09
- **Evidence**: utils/dbUtils.js:11-41 attempts a standalone fallback but it is **dead code**
  (confirmed by Sprint 00 test bring-up): `mongoose.startSession()` succeeds lazily on
  standalone servers; the failure ("Transaction numbers are only allowed on a replica set")
  surfaces at first use/commit, so the catch never fires and invoice creation hard-fails with
  a 500 on non-replica-set MongoDB. Only 2 flows use transactions at all (invoiceService.create:47,
  saleService.reverseSale:94); untransactioned flows: paymentService ×3, purchaseService.recordPurchaseReceive:15-58,
  returnService.processSaleReturn:60-139, physicalInventoryService.completeCount:150-241 ("Transaction Removed" comment),
  debtService.createInstallmentPlan:302-368, customer/supplier opening-balance creates.
- **Impact**: mid-flow crash leaves permanently inconsistent financial state.
- **Fix**: hard-require transactions in production (fail fast if unsupported); wrap each flow.
- **Tasks**: T-DB-07, T-BIZ-01, T-BIZ-02, T-BIZ-03

## VAL-001 — Body sanitization gap; validation layer unwired; credit-refine dropped
- **Category**: Defect / Injection & Mass Assignment · **Audit doc**: 07
- **Evidence**: lib/route-handler.js sanitizes params/query only (body excluded);
  validations/ imported nowhere; controllers/productController.js copy of invoice schema lacks
  the credit-customer `.refine`; raw-body endpoints list in audit doc 07; UserService/SettingsController mass assignment.
- **Impact**: credit sales without customers; arbitrary fields written; operator-injection
  surface depends entirely on middleware ordering.
- **Fix**: single source-of-truth zod schemas wired per endpoint; sanitize body defensively;
  restore refine.
- **Tasks**: T-VAL-01, T-VAL-02, T-VAL-04

## SEC-001 — API docs endpoint protected only transitively (reframed during Sprint 00)
- **Category**: Defect / Security Misconfiguration (fragile implicit coupling) · **Audit doc**: 11
- **Evidence**: routes/docsRoutes.js has no auth middleware of its own; mounted at index.js:130.
  **Sprint 00 correction**: the smoke suite proved the endpoint currently returns 401 because
  `reportRoutes` is mounted at bare `/api` (index.js:127) with router-level
  `router.use(authMiddleware)`, which intercepts every unmatched `/api/*` request — including
  `/api/docs`. The protection is real but *accidental*: moving/unmounting reportRoutes silently
  makes /api/docs public. Also advertises nonexistent POST /auth/register.
- **Impact**: attack-surface enumeration risk returns on any route reorganization.
- **Fix**: explicit authMiddleware on docsRoutes (or remove route); decouple from mount order.
- **Tasks**: T-SEC-03 (scope updated accordingly).

## SEC-002 — Session endpoint may return password hash (VERIFY then fix)
- **Category**: Defect / Sensitive Data Exposure · **Audit doc**: 05
- **Evidence**: authService.getSession spreads `user.toObject()` (authService.js:91-99);
  User.password lacks `select:false` (models/User.js); other call sites manually exclude,
  implying repository does not.
- **Impact**: credential hash exposed to the client on every session fetch if projection missing.
- **Fix (regardless of verification outcome)**: `select:false` on schema + explicit safe
  projection in getSession + regression test asserting shape.
- **Tasks**: T-SEC-01
