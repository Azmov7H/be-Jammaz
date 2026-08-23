# 17 — Dependency Audit

`npm audit --omit=dev` at audit time: **17 vulnerabilities — 1 critical, 9 high, 7 moderate.**
(Exact critical advisory was truncated by tooling output; re-run `npm audit` inside
TASK-B00-02 and record it in the PR before fixing.)

## Direct-dependency relevant items

| Package | Version policy affected | Severity | Issue | Action |
| ------- | ----------------------- | -------- | ----- | ------ |
| express-rate-limit | ^8.2.1 (8.0.1–8.5.0 vulnerable) | HIGH | IPv4-mapped IPv6 bypass defeats per-client limiting | upgrade to ≥8.5.1 — no breaking change expected |
| body-parser (via express 4.21) | ≤1.20.5 | MODERATE | invalid limit silently disables size cap | `npm audit fix`; verify express pulls patched transitive |
| exceljs | ^4.4.0 | HIGH/MODERATE via uuid (<11.1.1 buffer bounds), tmp (path traversal) | transitive | upgrade exceljs within v4 if possible; else accept + isolate (exportService is currently dead code — candidate for removal in CLEAN-001 which also removes the exposure) |
| lodash, minimatch, brace-expansion, glob, ip-address, dompurify, tmp | transitive | HIGH/MODERATE | ReDoS/DoS/injection family | `npm audit fix` first pass; re-audit |

## Direct dependency review (beyond advisories)

| Package | Verdict |
| ------- | ------- |
| jsonwebtoken ^9 **and** jose ^6 | duplicate JWT libraries — jose is used; remove jsonwebtoken (CLEAN-001) |
| jspdf + jspdf-autotable | server-side PDF explicitly rejected by design (exportService throws); unused → remove |
| zod ^4.3.3 | fine; wire it (Sprint 03) |
| cors/helmet/hpp/express-mongo-sanitize/morgan/cookie-parser/dotenv/bcryptjs/google-auth-library/date-fns | appropriate versions, keep |
| nodemon (dev) | fine |

## Rules for upgrades (per repo policy)

Every upgrade PR states: current → target, reason (advisory link), breaking-change risk,
required migration steps, and post-upgrade smoke test results. No blind major bumps.
exceljs major downgrade suggested by npm (`--force` to 3.4.0) is **rejected** — prefer
removal or minor-bump path.

## Repo hygiene found during audit

Both `package-lock.json` and `pnpm-lock.yaml` committed + `pnpm-workspace.yaml` present
while scripts use npm → pick one manager (DEVOPS-002).
