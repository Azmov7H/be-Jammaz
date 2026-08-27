# Findings — LOW (5)

## AUTH-004 — Weak password policy
Audit doc 05 · creation min 6 chars only (and that schema is unwired); no max length before
bcrypt; User.password lacks minlength. Fixed within T-SEC-01 (policy + field hardening).

## LOG-002 — Minor log info disclosure
Audit doc 14 · db.js prints cwd when URI missing; verify script prints resolved dotenv path.
Fixed in T-OPS-01 / T-SEC-05 sweeps.

## CLEAN-003 — Commented-out filler & magic numbers
Audit doc 18 · index.js commented blocks; physical-inventory stub; scattered pagination
defaults; DailyInventory hardcoded threshold. Fixed in T-CLN-03.

## DEVOPS-002 — No .env.example; dual lockfiles
Audit doc 19 · npm and pnpm lockfiles both committed while scripts use npm; environment
contract undocumented. Fixed in T-B00-01.

## PERF-004 — No compression; body limit undocumented
Audit doc 15 · large JSON report payloads uncompressed; express.json default limit implicit.
Fixed in T-PERF-04/T-PERF-05.
