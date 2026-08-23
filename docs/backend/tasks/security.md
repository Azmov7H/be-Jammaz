# Security Hardening Tasks (Sprint 06)

## T-SEC-02 — Rate limiting strategy
High · HIGH (RATE-001)
- Steps: upgrade express-rate-limit ≥8.5.1 (may already land via T-B00-02 — verify) → global relaxed to 300/15min (dashboard chattiness noted as frontend contract impact) → authLimiter 10/15min/IP on login + google/callback + refresh → heavyLimiter 30/15min on /reports/*,/dashboard*,/accounting/ledger → skip successful-request counting for GETs? keep default; document MemoryStore constraint prominently + redis migration note for multi-instance future.
- Testing: burst script → 429 with Retry-After on auth; global still active.
- Acceptance: limits per table live; headers standard.

## T-SEC-03 — Gate the docs endpoint
High · CRITICAL→closed (SEC-001)
- authMiddleware on docsRoutes router (any authenticated role); correct payload drift (T-API-01 covers content). Alternative accepted: disable route entirely outside development. Decision recorded.
- Testing: unauthenticated 401; authenticated 200.

## T-SEC-04 — CORS & environment policy
Medium · MEDIUM (SEC-003)
- Decide and document: origin-less requests allowed only for same-host tooling? Default KEEP (mobile/health probes) but deny when NODE_ENV=production unless ALLOW_ORIGIN_LESS=true set; production requires explicit origin list (fail startup if empty); NODE_ENV unset → startup warning banner + treat as development explicitly.
- Files: index.js, .env.example, docs note.
- Acceptance: matrix tested (prod w/o origins fails fast; dev open; prod+list enforced).

## T-SEC-05 — Log hygiene sweep
Medium · MEDIUM (LOG-001 slice)
- Remove email logging (done in T-AUTH-04 if ordered later—this task sweeps residuals), debug token logs, db.js cwd print (LOG-002), dotenv path print in scripts; add eslint no-console rule with allowlist (lib/logger placeholder until Sprint 10 structured logger).
- Acceptance: grep clean; lint enforces.
