# Security Audit — Jammaz System

## Execution Environment
- **Backend only** — No frontend in this repository
- **Framework**: Express.js 4.21.0
- **Database**: MongoDB with Mongoose 8.7.0
- **Authentication**: JWT (HS256), Google OAuth, cookies
- **Environment**: Node.js with dotenv

## Authentication Security

### ❌ Critical Findings

| Finding ID | Description | Severity |
|-----------|-------------|----------|
| **SEC-001** | **No token invalidation/revocation** — Logging out clears the `token` cookie, but the JWT remains cryptographically valid until its 1-day expiry. An intercepted token can be used until it expires. | CRITICAL |
| **SEC-002** | **No refresh token rotation** — Only access tokens exist. When they expire, users must re-authenticate. No refresh token flow means either frequent re-authentication or long-lived tokens. | HIGH |
| **SEC-003** | **Cookie not always `secure`** — `secure` flag is conditional on `NODE_ENV === 'production'`. If env is misconfigured, cookies could be sent over plain HTTP. | HIGH |
| **SEC-004** | **No CSRF protection** — express-rate-limit and helmet are used, but no explicit CSRF middleware. SameSite='lax' provides partial CSRF protection but is not sufficient for state-changing POST requests from external sites. | MEDIUM |
| **SEC-005** | **Google OAuth client secrets in code** — `OAuth2Client` is initialized with `process.env.GOOGLE_CLIENT_ID` and `process.env.GOOGLE_CLIENT_SECRET`. If these are committed to source control, Google account compromise risk. | MEDIUM |

### ⚠️ Medium Findings

| Finding ID | Description | Severity |
|-----------|-------------|----------|
| **SEC-006** | **JWT uses HS256 (symmetric)** — The `JWT_SECRET` is shared for signing and verification. If the secret is compromised, all tokens can be forged. HS256 is appropriate for single-service apps but less ideal than RS256 for distributed systems. | MEDIUM |
| **SEC-007** | **No token expiry differentiation** — Both access token signing and cookie `maxAge` use `60 * 60 * 24 * 1000` (1 day). No short-lived access tokens with long-lived refresh tokens. | LOW |
| **SEC-008** | **Google callback URL hardcoded** — `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/google/callback` — if base URL is wrong, OAuth flow breaks. No URL validation beyond what google-auth-library provides. | LOW |

## Authorization Security

### ❌ Critical Findings

| Finding ID | Description | Severity |
|-----------|-------------|----------|
| **SEC-010** | **Role-based authorization is inconsistent** — Some routes use `roleMiddleware(['admin'])` while others manually check permissions. The `hasPermission()` function in `lib/permissions.js` is not used uniformly. Resource-level authorization (ownership checks) is entirely absent. | CRITICAL |
| **SEC-011** | **Horizontal privilege escalation possible** — `roleMiddleware` only checks if the user's role is in the allowed list. A manager role could potentially access admin-only endpoints if the middleware list is misconfigured. | HIGH |
| **SEC-012** | **No ownership/resource checks** — Endpoints like `/api/customers/:id`, `/api/products/:id`, `/api/invoices/:id` do not verify that the authenticated user owns or has permission to modify the specific resource. | HIGH |

### ⚠️ Medium Findings

| Finding ID | Description | Severity |
|-----------|-------------|----------|
| **SEC-013** | **`owner` role has `['*']` permissions** — `hasPermission(role, permission)` returns `true` if `role === 'owner'`. This is a bypass risk if the role field can be set arbitrarily. | HIGH |
| **SEC-014** | **`role` field trust issue** — The `role` value from the JWT payload is used directly without re-verification against a source of truth (database). If the JWT is compromised or the role field is tampered, authorization can be bypassed. | MEDIUM |

## Validation Security

### ❌ Critical Findings

| Finding ID | Description | Severity |
|-----------|-------------|----------|
| **SEC-015** | **No XSS sanitization** — `express-mongo-sanitize` only prevents NoSQL injection. There is no HTML/XSS sanitization for any user-generated content that might be displayed. | CRITICAL |
| **SEC-016** | **Mass assignment risks** — Several routes accept `req.body` directly or partially. For example, `UserService.create()` creates a user from `data` without explicitly listing allowed fields — any field in the request body that matches the Mongoose schema can be set. | HIGH |

### ⚠️ Medium Findings

| Finding ID | Description | Severity |
|-----------|-------------|----------|
| **SEC-017** | **Zod schema vs Mongoose validation mismatch** — Some routes use Zod validation (e.g., `productController.js` schemas) while others rely on Mongoose native validation. Inconsistent coverage — a field might pass Zod but fail Mongoose or vice versa. | MEDIUM |

## Injection & NoSQL Risks

### ❌ Critical Findings

| Finding ID | Description | Severity |
|-----------|-------------|----------|
| **SEC-018** | **NoSQL injection via query operators** — `lib/route-handler.js` has `sanitizeInput` that deletes keys starting with `$`, but this is only applied in the route handler as a secondary defense. Direct Mongoose queries in services may not sanitize inputs. | HIGH |
| **SEC-019** | **Mongoose `$where` or operator risks** — Not explicitly used in the codebase, but the `text` index on Customer (`name: 'text', phone: 'text'`) could be exploited for text injection if not properly sanitized. | LOW |

## Session & Cookie Security

| Finding | Description | Impact |
|---------|-------------|--------|
| Cookie `httpOnly` flag | ✅ Set on all cookie writes (`res.cookie('token', ... , { httpOnly: true })`) | Prevents XSS-based token theft |
| Cookie `secure` flag | ⚠️ Conditional on `NODE_ENV === 'production'` | May be absent in dev/staging |
| Cookie `sameSite` | ⚠️ `'lax'` — provides basic CSRF protection but may not suffice for all use cases | Consider `'strict'` or `'none'` |
| Token expiry | ✅ 1 day (`JWT_EXPIRES_IN || '1d'`) | Reasonable but no refresh flow |
| Token storage | ✅ HttpOnly cookie | Good practice |

## Security Headers (Helmet Configuration)

| Header | Status | Notes |
|--------|--------|-------|
| `helmet()` | ✅ Enabled | Basic security headers |
| `crossOriginResourcePolicy` | ✅ Set to `"cross-origin"` | Prevents resource embedding in cross-origin iframes |
| HSTS | ⚠️ Not explicitly checked | Helmet may include it by default; verify |
| `X-Frame-Options` | ⚠️ Not explicitly set | Helmet may include it |
| `Content-Security-Policy` | ❌ Not configured beyond CROSP | Consider adding restrictive CSP |

## Environment & Configuration Risks

| Finding | Description | Severity |
|---------|-------------|----------|
| **SEC-020** | **`.env` file not in `.gitignore` risk** — The `.gitignore` should be checked to ensure `*.env` is excluded. If env files are committed, all secrets (MONGODB_URI, JWT_SECRET, Google Client secrets) are exposed. | CRITICAL |
| **SEC-021** | **Missing environment variable validation** — `MONGODB_URI` and `JWT_SECRET` are required; the code throws errors if missing, but there's no graceful fallback or validation at startup beyond the `dbConnect()` call. | HIGH |
| **SEC-022** | **CORS configuration allows all origins in non-production** — `if (!origin) return callback(null, true);` and `or process.env.NODE_ENV !== 'production'` means any origin can access the API in non-production. | MEDIUM |

## Recommendations Summary

1. **Immediate (CRITICAL)**:
   - Add token invalidation/revocation mechanism (blacklist or short-lived tokens with rotation)
   - Ensure `.env` is gitignored and no secrets are in source control
   - Fix CORS to restrict origins even in development
   - Add XSS sanitization for user-generated content

2. **Short-term (HIGH)**:
   - Implement refresh token flow with rotation
   - Consistent use of `roleMiddleware` and `hasPermission` across all routes
   - Add ownership/resource-level authorization checks
   - Use `secure: true` for cookies always (or enforce HTTPS everywhere)
   - Add CSRF protection for state-changing endpoints

3. **Medium-term (MEDIUM/LOW)**:
   - Migrate from HS256 to RS256 for JWT
   - Add CSP and other security headers
   - Implement input validation at the API boundary
   - Add rate limiting specifically on auth routes
   - Audit all database queries for NoSQL injection risks

4. **Long-term**:
   - Security headers hardening (HSTS, X-Frame-Options, CSP)
   - Penetration testing
   - Dependency vulnerability scanning (npm audit, Snyk, etc.)