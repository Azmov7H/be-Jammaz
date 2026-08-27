# 18 — Code Quality Audit

Cleanup risk classes: **SAFE** (delete/change, no behavior), **VERIFY** (check callers first),
**HIGH-RISK** (behavioral change needing tests).

## Duplication

| Item | Instances | Class |
| ---- | --------- | ----- |
| product zod schema | 3 conflicting copies | HIGH-RISK (choosing wrong copy changes rules) |
| login schema | 2 copies | SAFE |
| invoice schema | 2 copies, wired one is weaker | HIGH-RISK |
| model-registration guards | 4 styles | VERIFY |
| endpoints | installments ×2, PO status ×2, invoice-design PUT/POST, price-history ×2 | VERIFY (frontend may call any) |

## Dead code (CLEAN-001)

- `validations/` entire folder unwired (13 schemas) — but becomes the Sprint-03 foundation:
  do NOT delete; consolidate and wire. Class: HIGH-RISK if deleted blindly.
- `services/exportService.js` unused; PDF path always throws. SAFE to delete (with jspdf deps).
- `lib/api-response.js` unused. SAFE.
- `jsonwebtoken` dep unused (jose used). SAFE to remove after grep confirmation.
- `roleMiddleware` imported-unused in accounting/pricing/report routes — evidence of intended
  gating; keep imports, add gates (ACL-003).
- Docs payload advertising nonexistent endpoint. SAFE fix.

## Type quality

Plain JS with no JSDoc typing on service boundaries; money math in floats throughout
(no integer-minor-unit strategy) — documented as Technical Debt; rounding conventions must be
defined before DATA tasks touch calculations (note in tasks/database.md).

## Naming / structure

Generally consistent kebab-case routes, PascalCase services/models. No god files: largest are
treasuryService (27KB), stockService (21KB), accountingService (17KB) — large but cohesive;
splitting is optional debt, not scheduled.

## TODO/FIXME & commented code (CLEAN-003)

- index.js:33-41, 133-142 blank/commented filler.
- physicalInventoryRoutes.js:29-31 "might need implementation" stub endpoint.
- Magic numbers: DailyInventory threshold 5; pagination defaults scattered (10/20/50/100).

## Error-handling duplication

Covered by ERR-001 — the duplication here is systemic (two pipelines), not cosmetic.

## Verification sweep results (audit-time greps)

No `any` (JS repo); no console.log-only debugging beyond items in LOG-001; no unused imports
scan performed exhaustively — deferred to lint introduction (T-B00-01 adds eslint with
no-unused-vars gate).
