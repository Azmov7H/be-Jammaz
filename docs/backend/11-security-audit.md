# 11 — Security Audit (OWASP-based)

## Broken Access Control — see 06-authorization-audit.md
ACL-001 dead admin role · ACL-002 manager→owner privesc · ACL-003 ungated financial
writes · ACL-004 notification markRead IDOR. **Highest-risk category.**

## Authentication Failures — see 05-authentication-audit.md
AUTH-001 no revocation · AUTH-002 OAuth auto-provisioning · AUTH-003 enumeration +
email logging. No brute-force-specific protection beyond global IP limiter.

## Injection
- NoSQL: mongoSanitize global ✔; routeHandler body gap VAL-001b (defense-in-depth);
  no `$where` usage found.
- Regex DoS: `new RegExp(userInput)` in search paths (stockRoutes inline queries) — escape required.
- Command/SQL: N/A.

## Security Misconfiguration
- CORS: origin-less allowed; all origins when NODE_ENV≠production (SEC-003 — decide policy;
  risk if staging runs without NODE_ENV=production).
- Helmet enabled ✔ (only CRP relaxed for cross-origin assets).
- Stack traces: suppressed only for 500s in production via errorHandler; routeHandler
  passes err.message through in non-production — acceptable if NODE_ENV set correctly;
  add startup warning when NODE_ENV is unset (DEVOPS task).
- Public API docs endpoint SEC-001.
- trust proxy = 1: correct for one proxy layer (Vercel front / reverse proxy).

## Cryptographic Failures
- bcrypt cost 10 ✔; JWT HS256 with required secret ✔; no secrets in source ✔.
- Gaps: password hash potentially serialized to client (SEC-002), no minlength on hash field,
  JWT 24h static (AUTH-001).

## SSRF / Open Redirect / Path Traversal
- No outbound fetches driven by user input (Google OAuth uses fixed endpoints) ✔.
- No file serving/upload → path traversal N/A.
- scripts/verify-bank-integration.js writes fabricated transactions to whatever DB .env
  targets and never rolls back CashboxDaily mutations (DATA-005) — operational safety issue.

## XSS / CSRF
- API-only JSON backend; no HTML rendering server-side.
- Cookies: sameSite=lax + httpOnly + secure-in-prod → CSRF surface minimal;
  state-changing GETs absent ✔. Revisit strictness in hardening sprint (Frontend Contract Impact).

## Prototype Pollution / Mass Assignment
- hpp ✔; no deep-merge utilities.
- Mass assignment live in: UserService.create/update (role!, isActive), settingsController
  Object.assign, CustomerService.update body spread → VAL-001 tasks.

## DoS
- Global limiter only (RATE-001); unbounded aggregations & lists are amplifiers (PERF-001);
  regex-abuse in searches; express.json default cap ✔.

## Sensitive Data Exposure
- Potential password hash via /auth/session (SEC-002).
- Notifications broadcast customer names/balances to role audiences — intended, but
  document as data-classification decision.
- Logs contain emails; dev stack traces when NODE_ENV≠production.

## Logging Exposure
- morgan('dev') colored output unsuitable for prod aggregation; console.error of full err
  objects may include query payloads (LOG-001).

## Debug/Admin Endpoints
- `/api/docs` public (SEC-001). No debug endpoints found ✔.

## Dependency vulnerabilities
- 17 known vulns incl. high: express-rate-limit IPv6 bypass (weakens RATE-001 further),
  body-parser limit-disable DoS, lodash injection/prototype-pollution, minimatch/tmp/
  brace-expansion DoS family, ip-address; moderate: uuid, dompurify (transitive).
  Full plan in 17-dependency-audit.md.

## Secrets sweep result

Searched source (node_modules excluded) for embedded credentials: connection strings,
`sk_live/sk_test`, AKIA keys, PEM blocks, literal `password/secret/api_key` assignments —
**zero matches**. `.gitignore` covers `.env*`; git history contains no committed env files.
No SECRET-EXPOSURE findings issued. Residual hygiene items: print of resolved dotenv path
in script logs, masked-URI logging pattern is good and should be preserved.
