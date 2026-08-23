# Backend Definition of Done (roadmap-wide)

A task is complete only when **all applicable** boxes hold. The PR template embeds this.

## Every task

- [ ] Implementation complete per task's Scope — nothing more
- [ ] No unrelated modifications (diff matches Affected-files list)
- [ ] `npm run lint` passes (from Sprint 00 onward)
- [ ] Test suite passes; new/changed behavior has a test
- [ ] API behavior verified (curl/supertest transcript in PR)
- [ ] Security implications reviewed (who can call it? what can they send?)
- [ ] Performance implications considered (new queries indexed? bounded?)
- [ ] Error handling verified against the unified error model (Sprint 01+)
- [ ] Logs verified: no PII, no debug noise added
- [ ] Documentation updated where the task names docs
- [ ] Related finding(s) marked closed in findings registry (PR body links IDs)
- [ ] Rollback considered and stated

## Database-touching tasks (additional)

- [ ] Existing-data impact assessed (pre-flight audit query + counts in PR)
- [ ] Index impact assessed (added/dropped listed; explain() evidence)
- [ ] Migration/backfill assessed and scripted under scripts/db/
- [ ] Rollback strategy documented (inverse script or harmless-additive argument)

## Money-path tasks (payments, debt, treasury, stock, invoices) — additional

- [ ] Concurrency test written (parallel operations assert exact final state)
- [ ] Fault-injection considered: what happens if process dies mid-flow?
- [ ] Transaction coverage confirmed or justified-atomic reasoning recorded

## Auth/AuthZ tasks — additional

- [ ] Authorization matrix row updated (role × endpoint expected result)
- [ ] Negative test: forbidden role receives 403 (not 400/500)
