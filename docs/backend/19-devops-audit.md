# 19 — DevOps & Deployment Audit

## Current reality (DEVOPS-001)

| Area | State |
| ---- | ----- |
| Dockerfile / Compose | none |
| CI/CD | none |
| Build step | none needed (plain JS ESM) |
| Start | `node index.js` / nodemon dev |
| Health checks | GET / banner only; no readiness/liveness |
| Graceful shutdown | **absent** — SIGTERM kills in-flight requests and Mongo ops mid-write (compounds DATA-003 risks) |
| Migrations/index setup | none; indexes exist only as schema declarations (Mongoose syncIndexCreates applies them lazily per collection on first use of a connection — Atlas prod will build them at first boot after deploy; no pre-flight check) |
| Logging | stdout only |
| Monitoring/alerting | none |
| Env config | `.env*` gitignored ✔; **no .env.example**; 8 vars documented nowhere in repo |
| Package manager | npm scripts but pnpm lockfile also committed |

## Can the backend reliably…?

| Capability | Verdict |
| ---------- | ------- |
| Install / Start | yes |
| Connect MongoDB | yes; fail-fast with clear diagnostics ✔ |
| Handle requests | yes, within limits above |
| Handle errors | inconsistently (dual pipeline) |
| Shutdown gracefully | **no** |
| Recover from failures | process-level crash = platform restart; DB reconnect handled by mongoose driver defaults; transaction-fallback silently degrades integrity |
| Deploy multi-instance | blocked (in-memory limiter) |

## Sprint 10 target baseline

1. SIGTERM/SIGINT → server.close() → mongoose.connection.close() (drain, timeout 10s).
2. `/health/live`, `/health/ready` (db ping), Express 404 JSON handler.
3. GitHub Actions: install → lint (introduce eslint config in Sprint 00) → test → `npm audit --omit=dev` gate.
4. Optional Dockerfile (node:22-alpine, non-root, HEALTHCHECK hitting /health/live) — include
   even if deployment stays bare VM, it documents runtime expectations.
5. `.env.example` committed; startup validator that fails fast listing missing required vars.
6. Index pre-flight: script using `collection.getIndexes()` diff vs models, run in CI against memory server and documented as deploy step.

## Rollback strategy (roadmap-wide)

Each sprint branch merges behind green CI; DB changes follow tasks/database.md isolation
template (additive indexes first, constraint-tightening after data audit); every sprint doc
carries an explicit rollback note (revert merge; additive indexes are harmless left in place).
