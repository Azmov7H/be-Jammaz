# Findings Registry

42 findings — 11 CRITICAL · 14 HIGH · 12 MEDIUM · 5 LOW. Each entry here is a summary;
full evidence lives in the numbered audit documents referenced by each finding's `Audit doc`
column. Remediation mapping lives in [sprints/](../sprints/README.md) and
[tasks/](../tasks/README.md).

| ID | Severity | Title | Audit doc | Tasks |
| -- | -------- | ----- | --------- | ----- |
| ACL-001 | CRITICAL | Dead `admin` role locks 10+ endpoints | 06 | T-AUTH-01 |
| ACL-002 | CRITICAL | Manager→owner escalation; no last-owner guard | 06 | T-ACL-01 |
| ACL-003 | CRITICAL | Financial/pricing/GL/stock writes have no role gates | 06 | T-ACL-02 |
| ACL-004 | CRITICAL | Notification markRead IDOR | 06 | T-ACL-03 |
| AUTH-001 | CRITICAL | No token revocation/rotation; logout cosmetic | 05 | T-AUTH-02 |
| DATA-001 | CRITICAL | Stock RMW race → oversell / lost updates | 09 | T-DB-05 |
| DATA-002 | CRITICAL | Cashbox/debt/paidAmount lost-update races | 09 | T-DB-06 |
| DATA-003 | CRITICAL | Non-transactional financial flows; silent txn fallback | 09 | T-DB-07, T-BIZ-01..03 |
| VAL-001 | CRITICAL | Body sanitization gap; validation layer unwired; credit-refine dropped | 07 | T-VAL-01/02/04 |
| SEC-001 | CRITICAL | Public API docs endpoint | 11 | T-SEC-03 |
| SEC-002 | CRITICAL | Session may leak password hash (VERIFY+fix) | 05 | T-SEC-01 |
| AUTH-002 | HIGH | Google OAuth auto-provisions any account as cashier | 05 | T-AUTH-03 |
| AUTH-003 | HIGH | Login enumeration + email logged | 05 | T-AUTH-04 |
| DEP-001 | HIGH | 17 dependency vulnerabilities (incl. rate-limit bypass) | 17 | T-B00-02 |
| ERR-001 | HIGH | Dual error systems; Arabic not-found→500; permission→400 | 13 | T-ARC-01 |
| MONGO-001 | HIGH | Missing indexes (+Log TTL) | 08 | T-DB-01 |
| MONGO-002 | HIGH | Money/qty fields without min:0 | 08 | T-DB-02 |
| MONGO-003 | HIGH | receiptNumber unique:false; Supplier.phone; settings singleton | 08 | T-DB-03 |
| DATA-004 | HIGH | Date.now() document numbers collide | 09 | T-DB-04 |
| RATE-001 | HIGH | Single weak global limiter; vulnerable version; no auth limits | 12 | T-SEC-02 |
| PERF-001 | HIGH | Unbounded endpoints; full-collection dashboard scans | 15 | T-PERF-01/02 |
| PERF-002 | HIGH | N+1 write loops; deep populate fan-out | 15 | T-PERF-04, T-PERF-03 |
| ARCH-001 | HIGH | Business logic inline in routes/controllers; repos bypassed | 02 | T-ARC-03/04 |
| DEVOPS-001 | HIGH | No graceful shutdown/404/health/CI | 19 | T-OPS-01..05 |
| TEST-001 | HIGH | No runnable test suite; broken test file | 16 | T-B00-03/04, T-TST-* |
| API-001 | MEDIUM | Envelope drift; duplicate mounts/endpoints; docs drift | 04 | T-ARC-02, T-API-01 |
| VAL-002 | MEDIUM | No array/numeric bounds anywhere | 07 | T-VAL-03 |
| MONGO-004 | MEDIUM | Unbounded arrays; no maxlength; Mixed unvalidated | 08 | T-DB-08 |
| MONGO-005 | MEDIUM | 4 model-registration patterns; UnifiedCollection side effect | 08 | T-DB-08 |
| ERR-002 | MEDIUM | Status-code hygiene (404s as 500; deleted-user 404; null-data 200) | 13 | T-API-02 |
| LOG-001 | MEDIUM | PII/debug logging; no structured logs/request IDs | 14 | T-OPS-01, T-SEC-05 |
| PERF-003 | MEDIUM | Treasury balance/summary full-scan design | 15 | T-PERF-03 |
| CLEAN-001 | MEDIUM | Dead code cluster (validations dupes, exportService, api-response, jsonwebtoken/jspdf) | 18 | T-CLN-01 |
| CLEAN-002 | MEDIUM | Role/enum inconsistencies (accountant/sales zero perms; casing) | 10 | T-CLN-02 |
| DATA-005 | MEDIUM | verify-bank-integration script mutates live data w/o rollback | 11 | T-BIZ-05 |
| SEC-003 | MEDIUM | CORS origin-less allowance; NODE_ENV-dependent openness undocumented | 11 | T-SEC-04 |
| BIZ-001 | MEDIUM | PO receive double-execution race (check-then-act) | 09/10 | T-BIZ-04 |
| AUTH-004 | LOW | Weak password policy (min 6, no max, hash field selectable) | 05 | T-SEC-01 |
| LOG-002 | LOW | Minor log info disclosure (cwd, dotenv path) | 14 | T-OPS-01 |
| CLEAN-003 | LOW | Commented-out blocks, magic numbers | 18 | T-CLN-03 |
| DEVOPS-002 | LOW | No .env.example; dual lockfiles | 19 | T-B00-01 |
| PERF-004 | LOW | No compression; body limit undocumented | 15 | T-PERF-05 |

*(42 rows; canonical counts: 11 CRITICAL / 14 HIGH / 12 MEDIUM / 5 LOW.)*
