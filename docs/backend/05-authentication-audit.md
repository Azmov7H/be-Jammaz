# 05 — Authentication Audit

## Token model

| Question | Answer | Evidence |
| -------- | ------ | -------- |
| Where is auth state stored? | Stateless JWT in httpOnly cookie (`token`), Bearer header fallback. DB lookup per request validates user still exists. | authMiddleware.js:6-24 |
| How generated? | jose SignJWT HS256, payload `{userId,email,role}`, iat+exp (default 24h). Secret required at boot (throws if missing — good). | lib/auth.js |
| How validated? | jwtVerify per request + `User.findById` | authMiddleware.js:14-21 |
| How invalidated? | **They are not.** No denylist, no version claim, no refresh model. | — |
| After expiration? | 401 → user re-logs in. | |
| After logout? | Cookie cleared client-side; JWT remains fully valid until exp if exfiltrated. | authController.js:26-30 |

## Findings

### AUTH-001 (CRITICAL): No revocation / rotation / refresh
- 24h static tokens; logout is cosmetic; compromised token cannot be revoked short of
  rotating `JWT_SECRET` (logs out everyone) or deleting the user.
- Recommendation: short-lived access token (15m) + rotating refresh token stored hashed
  in DB (reuse-detection), or at minimum a `tokenVersion` claim checked against User.

### SEC-002 (CRITICAL, VERIFY): session response may include password hash
- `AuthService.getSession` spreads `...user.toObject()` (authService.js:91-99).
  `User.password` has **no `select:false`** (models/User.js). Whether the hash leaks
  depends on `UserRepository.findById`'s projection (must be verified during fix;
  other call sites explicitly use `-password`, implying the repo does not).
- Fix regardless: `select: false` on password + explicit projection in getSession.

### AUTH-002 (HIGH): Google OAuth auto-provisioning
- Any Google account that completes OAuth gets a user created with role `cashier`
  (authService.js:56-66). No invite/approval step. Combined with open `/api/auth/google/callback`
  and no state validation on `code`, this is an unintended sign-up channel into a
  financial system.
- Also: `googleClient.setCredentials(tokens)` mutates shared client instance — latent bug
  under concurrency.

### AUTH-003 (HIGH): Account enumeration + PII logging
- Login distinguishes "account disabled" (403, authService.js:31) from wrong-credentials
  (401) → confirms email existence.
- `[Auth] Cookie 'token' set for user: ${email}` logged to console (authController.js:21);
  debug token-presence lines in prod paths (authController.js:33, authService.js:87).

### Password handling
- Hashing: bcryptjs cost 10 — acceptable.
- Policy: creation min 6 chars (validators.js — unwired!), login min 1. No max length
  guard before bcrypt (long-input DoS mitigated by express.json 100kb cap; still add max 72/128).
- No registration endpoint exists (users created only by managers or Google auto-provision),
  so policy enforcement point is `UserService.create`.

### Missing flows
No password reset, no email verification, no account recovery, no MFA. Documented as
product gaps, not defects — except password reset absence means **compromised accounts
have no self-service recovery path** (INFO note for roadmap).

### Session fixation / CSRF
- Cookie `sameSite:'lax'`, httpOnly, secure in prod — decent baseline; CSRF risk low for
  JSON APIs but state-changing GETs don't exist, so acceptable. Note for hardening sprint:
  consider `sameSite:'strict'` feasibility with the Next.js frontend (Frontend Contract Impact).

## Answers to audit questions (state machine)

```
login ──► JWT(24h) ──► every request: verify + DB lookup
logout ──► cookie cleared only; token valid
user deleted ──► middleware 404s (should be 401)
role changed ──► old token still carries old role in payload BUT middleware reloads
                 user from DB each request and uses req.user.role → effective immediately ✔
```
(The DB-lookup-per-request design accidentally provides role revocation — keep it when
adding refresh tokens.)
