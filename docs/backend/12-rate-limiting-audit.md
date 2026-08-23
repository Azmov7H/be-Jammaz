# 12 — Rate Limiting & Abuse Protection Audit

## Current state (RATE-001)

Single global limiter, index.js:79-87:

```
windowMs: 15min · max: 100 req/IP · /api/* only · in-memory store · standardHeaders ✔
```

### Assessment against the questions

| Question | Answer |
| -------- | ------ |
| Global limit | Yes — 100/15min per IP. Too tight for ERP bulk UI usage (dashboard fires ~12 aggregation endpoints per unified load → one user session can consume a large fraction of the budget), too loose for abuse. |
| Route-specific limits | None. Login, OAuth callback, payments, reports all share the global bucket. |
| User-based limit | None. |
| IP-based limit | Yes; `trust proxy=1` set correctly. Vulnerable version installed (express-rate-limit 8.x IPv4-mapped-IPv6 bypass — DEP-001). |
| Distributed deployment | In-memory store breaks under >1 instance and resets on restart. Current deployment appears single-instance; document constraint. |
| Storage mechanism | Memory (default MemoryStore). |

## Abuse-protection gaps by vector

| Vector | Protection today | Needed |
| ------ | ---------------- | ------ |
| Brute force login | global IP limiter only; no per-account lockout/throttle | dedicated authLimiter (e.g., 10/15min/IP + per-email delay) |
| Credential stuffing | none specific | same as above + uniform errors (AUTH-003) |
| OAuth endpoint abuse | none on /google/callback | small limiter + code validation |
| Expensive reports/dashboard | none beyond global | route limiter or caching (PERF-002) |
| Search abuse (regex built from query) | none | escape regex + limiter |
| Password-reset abuse | N/A (feature absent) | when added, ship with limiter |
| File upload abuse | N/A | – |

## Recommendation shape (Sprint 06)

1. Upgrade express-rate-limit (fixes IPv6 bypass).
2. Keep relaxed global (e.g., 300/15min) + strict `authLimiter` on /api/auth/login and
   /google/callback + `heavyLimiter` on /reports/*, /dashboard*.
3. If multi-instance becomes real: swap store to redis (rate-limit-redis); note in DEVOPS docs.
4. Fix dashboard client chattiness (frontend contract impact) before tightening global limit,
   otherwise legitimate users get locked out.
