# Authorization Tasks (Sprint 02)

## T-ACL-01 — User management hardening
- Critical · CRITICAL (ACL-002)
- **Objective**: No privilege escalation via /api/users; last owner protected.
- **Problem/Evidence**: router gate ['owner','manager']; body spread incl. role; bare findByIdAndDelete; no self/last-owner guards.
- **Steps**:
  1. Split gates: GET → owner|manager; POST/PUT/DELETE → **owner only**.
  2. zod schema (T-VAL-01 provides base; interim explicit allowlist here): role changes only via owner; manager cannot assign above 'manager'; nobody edits own role; self-deletion blocked.
  3. Last-owner guard: on delete and isActive=false, count active owners; if target is last → 409 ConflictError.
  4. Deactivate instead of hard-delete by default? — keep delete but soft-block when owner (decision in PR).
- **Security**: closes vertical privesc. **DB**: none. 
- **Testing**: matrix rows: manager→create owner (403), manager→self-promote (403), owner delete sole owner (409), manager deletes cashier (200).
- **Acceptance**: all escalation paths return 403/409.

## T-ACL-02 — Role-gate the financial/pricing/GL/stock surface
- Critical · CRITICAL (ACL-003)
- **Objective**: Intended permission per endpoint from audit doc 06 table.
- **Proposed gates (owner may adjust before implementation)**:
  | Endpoint group | Gate |
  | manual treasury income/expense, transaction undo | owner \| manager |
  | custom pricing set/remove | owner \| manager |
  | GL expense/income entries | owner \| accountant(if kept) \| manager |
  | stock transfer/move/bulk | warehouse \| owner \| manager |
  | payments recording | cashier(invoice-pay) \| manager \| owner — split: invoice payment = cashier+; supplier payment & unified = manager+ |
  | returns processing | manager \| owner |
  | physical-inventory PATCH items | same as create (manager+) |
  | reconcile | manager+ (existing) |
- **Steps**: apply gates → remove unused imports excuse → matrix tests for each row.
- **Frontend impact**: UI must hide now-403 actions (contract note).
- **Acceptance**: zero ungated money-touching writes.

## T-ACL-03 — Notification scoping fixes
- High · CRITICAL (ACL-004)
- **Problem/Evidence**: markRead `{_id:{$in}}` no recipient filter (notificationService.js:150-153); delete asymmetry :168-169.
- **Scope**: markRead filter `{$in:ids, $or:[{recipientId:userId},{isGlobal:true,targetRole-visible}]}` — implement visibility predicate shared with read path; unify delete: recipients of global/targetRole notifications may delete their *view* (add per-user ReadReceipt subdoc) OR simply allow delete by any visible-to user (choose simpler; record). Owner deleteAll unchanged but logs security event.
- **Testing**: user A cannot mark B's targeted notification read (404 semantics); global mark-read works for all.
