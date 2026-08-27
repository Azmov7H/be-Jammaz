# Cleanup Tasks (Sprint 09)

## T-CLN-01 — Dead-code removal
Medium · MEDIUM (CLEAN-001)
- Delete (grep-verified unused): services/exportService.js + jspdf/jspdf-autotable deps; lib/api-response.js; jsonwebtoken dep (jose retained); any remaining validators duplicates post T-VAL-01. If export feature is wanted later it returns client-side per its own design comment.
- Class SAFE after grep proof in PR; full suite green.

## T-CLN-02 — Role & enum consistency
High · MEDIUM (CLEAN-002)
- accountant/sales decision executed (T-AUTH-01 default removes them; migration if data exists); status casing normalization: ShortageReport → PENDING/VIEWED/RESOLVED with data migration + inverse script; PaymentSchedule vs Debt casing aligned to UPPERCASE (or lowercase — single decision, one migration); Product.unit enum decided (free text documented OR enumerated).
- Class HIGH-RISK (data migrations) — isolated commits, each with audit-query counts.

## T-CLN-03 — Commented filler & magic numbers
Low · LOW (CLEAN-003)
- Remove index.js commented blocks; physical-inventory stub resolved (T-ARC-03 decision); extract constants (pagination defaults, DailyInventory threshold → uses product minLevel per business decision from audit doc 10 contradiction #2 — coordinate with owner).
