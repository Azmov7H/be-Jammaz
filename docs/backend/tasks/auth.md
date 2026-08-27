# Authentication Tasks (Sprint 02)

## T-SEC-01 — Eliminate password-hash exposure path
- High priority · CRITICAL (SEC-002, AUTH-004 partial)
- **Objective**: Password hash can never serialize to a client.
- **Problem/Evidence**: User.password lacks select:false (models/User.js); getSession spreads user.toObject() (authService.js:91-99).
- **Steps**: add `select:false` (+minlength when present) to schema → audit every password read site and use `.select('+password')` explicitly (login, userService.create/update) → getSession returns explicit safe projection `{name,email,role,picture,id}` → regression test asserting absence of keys.
- **Risks**: any code reading user.password without +select breaks visibly in tests — that's the point.
- **Acceptance**: test asserts session/login payloads contain no password key; login still works.

## T-AUTH-01 — Role model repair (unblocks ACL-001)
- Critical · CRITICAL (ACL-001)
- **Objective**: One canonical role set used by enum, gates, and permission matrix.
- **Problem**: route gates reference 'admin' which cannot exist; enum has 'accountant'/'sales' with no permissions.
- **Steps**:
  1. Decision (recorded in PR): canonical roles = owner, manager, cashier, warehouse, viewer (+accountant only if owner confirms need — default: remove from enum after data check).
  2. Pre-flight query: count users with role ∉ canonical (`db.users.aggregate([{$group:{_id:'$role'}}])`); migrate legacy docs if any (script under scripts/db/).
  3. Replace every `roleMiddleware(['admin'])` with intended gate per endpoint table (audit doc 06): deletes→owner; stock adjust→owner|manager; treasury undo→owner; logs→owner|manager; PI unlock/delete→owner.
  4. Align lib/permissions.js entries; delete getProductFilterInternal or implement meaningfully.
- **Database**: role migration script + inverse; additive-safe.
- **Testing**: matrix tests begin here (roles × repaired endpoints).
- **Acceptance**: every previously-dead endpoint reachable by intended role and 403 for others.

## T-AUTH-02 — Token lifecycle: rotation & revocation
- Critical · CRITICAL (AUTH-001)
- **Objective**: Compromised sessions are revocable; logout is real.
- **Design chosen**: access JWT 15m (payload unchanged + `tv` tokenVersion) + refresh token random 256-bit stored **hashed** in new RefreshToken collection {userId, hash, expiresAt(30d), revokedAt, replacedByHash} rotated on use w/ reuse-detection (revoke family). Middleware keeps DB user lookup (already present) and checks tv match.
- **Steps**: env additions (ACCESS_TTL, REFRESH_TTL) to .env.example → RefreshToken model+index → authService.login issues pair; /auth/refresh endpoint; logout revokes family; cookie updates (refresh: httpOnly path=/api/auth) → Frontend impact note: refresh call on 401.
- **Security**: refresh hashed at rest; reuse detection logs security event. **Perf**: +1 indexed read per refresh only.
- **Acceptance**: stolen-refresh replay revokes family; logout kills session; old long-lived tokens invalidated via tv bump on next password/role change.

## T-AUTH-03 — Google OAuth provisioning policy + hardening
- High · HIGH (AUTH-002)
- **Objective**: OAuth cannot mint accounts without approval; flow hardened.
- **Steps**: config flag OAUTH_AUTO_PROVISION=false default → uninvited Google login returns 403 "contact administrator" unless a User row pre-exists (invite flow = manager creates the row with matching email) → stop shared-client mutation (create client per exchange or use id_token verification) → validate `code` presence/schema → limiter applied (T-SEC-02 wires).
- **Frontend impact**: error surface for unprovisioned users.
- **Acceptance**: fresh Google account cannot access system; provisioned account works.

## T-AUTH-04 — Anti-enumeration + PII log removal
- High · HIGH (AUTH-003)
- **Steps**: unify disabled-account and bad-credentials responses (identical body/status 401; disabled flag surfaced post-auth internally if needed) → remove email console.log and token-presence debug lines → security-event log line (structured, Sprint-10 compatible) on login success/failure without PII beyond userId.
- **Acceptance**: responses indistinguishable for unknown vs disabled emails; grep clean.
