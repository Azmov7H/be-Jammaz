# Dependency & Delivery Graph

## Sprint dependency chain

```mermaid
graph TD
    S00[Sprint 00 Baseline<br/>deps · test harness · lint] --> S01[Sprint 01 Error/Envelope Foundation]
    S01 --> S02[Sprint 02 AuthN/AuthZ Repair]
    S02 --> S03[Sprint 03 Validation & Contracts]
    S03 --> S04[Sprint 04 DB Integrity<br/>indexes · constraints · atomic ops · tx infra]
    S04 --> S05[Sprint 05 Business Flows<br/>transactional money paths]
    S02 --> S06[Sprint 06 Security Hardening<br/>rate limits · docs gate · CORS]
    S04 --> S07[Sprint 07 Performance<br/>caps · caching · N+1]
    S06 --> S07
    S01 --> S08[Sprint 08 Testing Suites]
    S07 --> S08
    S08 --> S09[Sprint 09 Cleanup]
    S00 --> S10[Sprint 10 DevOps/Observability]
    S08 --> S10
    S09 --> S11[Sprint 11 Final Hardening]
    S10 --> S11
```

## Conceptual fix-dependency chain (why the order)

```mermaid
graph TD
    E[Unified errors 403/404 semantics] --> A[Authorization gates meaningful]
    A --> V[Validation layer trusted inputs]
    V --> D[Schema constraints can tighten safely]
    D --> T[Transactions wrap flows on clean primitives]
    T --> P[Performance work measures stable system]
    P --> TS[Tests encode corrected behavior]
    TS --> H[Hardening proves it]
```

Authentication precedes dependent authorization work (Sprint 02 internal order:
SEC-01 → AUTH-01 role model → ACL gates → token lifecycle). Authorization precedes
business-logic hardening because flows assume callers are already correctly gated.

## Code-level dependencies introduced

- `lib/errors.js` (Sprint 01) ← used by every later sprint.
- `validations/` canonical module (Sprint 03) ← routes, and bounds reused by schema tasks.
- `utils/dbUtils.withTransaction` hardened (Sprint 04) ← Sprint 05 flows.
- Shared paginate helper (Sprint 07) ← replaces per-service ad hoc parsing.
- Logger + security-event helper (Sprint 10) ← consumed retroactively by auth events.
