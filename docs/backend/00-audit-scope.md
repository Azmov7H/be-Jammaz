# 00 — Audit Scope & Method

## In scope (audited, evidence-based)

Everything under the backend root:

- `index.js` (entry point, middleware wiring, route mounting)
- `routes/` — 19 files, 118 endpoints inventoried
- `controllers/` — 4 files (auth, product, invoice, settings)
- `services/` — 22 files + `services/financial/` (6 files)
- `repositories/` — 5 files
- `middlewares/` — authMiddleware.js, errorHandler.js
- `lib/` — auth.js, db.js, permissions.js, route-handler.js, api-response.js, cache*.js
- `models/` — 24 schemas
- `utils/`, `validations/`, `scripts/`
- `package.json`, lockfiles, `.gitignore`, git history (7 commits, no `.env` ever committed)

Verification performed: full file reads of all source directories, `npm audit --omit=dev`,
grep sweeps for env vars and secret patterns, git history check for committed env files.

## Out of scope

- The frontend (Next.js app referenced via `NEXT_PUBLIC_BASE_URL`). Frontend-facing
  problems are recorded as **Frontend Contract Impact** notes only.
- MongoDB Atlas cluster configuration (network access, users) — not visible from repo.

## Categories audited but intentionally without dedicated documents

| Category | Result |
| -------- | ------ |
| WebSockets / Socket.IO | Not present in the codebase |
| File uploads | Not present (no multer/busboy; no upload endpoints) |
| Server-side caching | Not present (`lib/cache.js` / `cache-config.js` are React Query client configs misplaced in the backend repo — tracked as CLEAN-001) |
| Background jobs | None (all work synchronous within requests) |

## Method

1. Discover stack from manifests and runtime behavior (not README claims).
2. Map request flow `route → middleware → controller/service → model → Mongo`.
3. Read every service/model/route file; record evidence quotes with file:line.
4. Classify each issue: Defect / Architectural Problem / Technical Debt /
   Maintainability Problem / Optimization. Personal preference is not a defect.
5. Assign finding IDs, severities (CRITICAL/HIGH/MEDIUM/LOW/INFO — no inflation),
   convert to tasks, order into sprints with branch isolation.

## Hard rules honored

- No source code modified; no dependencies installed; no branches created.
- No secrets copied into docs (secret sweep found none in source; values redacted policy documented in 11-security-audit.md §Secrets).
