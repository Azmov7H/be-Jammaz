# 06 — Authorization Audit (critical section)

## Role model reality

- `lib/permissions.js` defines ROLES: owner, manager, cashier, warehouse, viewer and a
  permission matrix. `models/User.js` enum is **broader**: adds `accountant`, `sales`.
  Route gates reference a role that exists in **neither**: `admin`.

### ACL-001 (CRITICAL): the dead `admin` role
`roleMiddleware(['admin'])` can never pass for any API-created user (enum rejects
`role:'admin'`; `hasPermission` treats unknown roles as empty). Locked-out operations:

| Endpoint | File |
| -------- | ---- |
| DELETE customers | customerRoutes.js |
| DELETE products | productRoutes.js |
| DELETE invoices | invoiceRoutes.js |
| Entire `/api/logs` router | logRoutes.js:9 |
| POST /stock/adjust | stockRoutes.js:90 |
| DELETE purchases | purchaseRoutes.js |
| DELETE treasury transaction | treasuryRoutes.js:56 |
| physical-inventory unlock/delete | physicalInventoryRoutes.js:51,57 |

Impact: data-cleanup/correction workflows are impossible via API; worse, developers may
"fix" this by widening gates without review, or legacy docs with `role:'admin'` bypass
the intended owner/manager model entirely.

### ACL-002 (CRITICAL): vertical privilege escalation in user management
Gate is `['owner','manager']` on the whole /api/users router (userRoutes.js:9). Therefore:
- A **manager** can create an `owner`, promote themselves (`PUT /users/:id {role:'owner'}`),
  delete the sole owner, or deactivate anyone.
- No last-owner guard: deleting/deactivating every owner bricks owner-only operations
  (physical inventory unlock expects an owner password — physicalInventoryService.js:356).

Required fix: role changes restricted to owner; manager sub-tree only; last-owner guard;
no self-demotion/self-deletion.

### ACL-003 (CRITICAL): sensitive writes with no role gate at all
Any authenticated user (incl. cashier/viewer) can:

| Action | Endpoint |
| ------ | -------- |
| Post manual cash income/expense | POST /treasury/manual-income, /manual-expense |
| Set/remove customer custom pricing | POST/DELETE /customers/:id/pricing, /pricing/custom |
| Book GL journal entries | POST /accounting/entries/expense, /income |
| Move/transfer stock | POST /stock/transfer, /move |
| Record customer/supplier payments | POST /financial/payments/* |
| Edit physical count items | PATCH /physical-inventory/:id (while create/complete are gated!) |
| Trigger returns | POST /financial/returns, /invoices/:id/return |

(`roleMiddleware` is imported and unused in accountingRoutes.js:4, pricingRoutes.js:4,
reportRoutes.js:5 — evidence gating was intended.)

### ACL-004 (HIGH→CRITICAL): notification IDOR
`markRead` updates `{_id:{$in:ids}}` with no recipient filter (notificationService.js:150-153)
— any user can mark others' notifications read. Delete asymmetry: role-targeted recipients
cannot delete their notifications (delete requires recipientId match even for global/targetRole docs).

## Horizontal escalation (IDOR) sweep

- Resources are shop-wide, not per-user-owned by design (ERP). Ownership checks therefore
  reduce to **role checks**, which are broken per above.
- Checked and OK: notifications read scoping (self/global/role), non-owner notification delete.
- Param injection: no ObjectId validation anywhere (`idSchema` exists unused); malformed ids
  produce CastError → 500 instead of 400/404 (ERR-002 family).

## Permission system usage

`lib/permissions.js` (matrix + requirePermission/getProductFilterInternal) is effectively
dead code at the HTTP boundary:
- `requirePermission()` throws strings → mapped to HTTP 400 (not 403) by route-handler,
  so it cannot be adopted without the Sprint-01 error foundation.
- `getProductFilterInternal('cashier')` filter `{shopQty:{$gt:-1}}` matches everything ≥0…
  and also everything since qty can't be negative — i.e., it filters nothing [M].

## Verdict

Authorization is the highest-risk domain in this backend: one enum mismatch disables the
entire restrictive model, user management allows full privilege escalation, and money-touching
endpoints rely solely on authentication. Sprint 02 must land before any business-logic work.
