# Pull Request Strategy

## Flow

```
One Sprint → one isolated branch
    → one commit per task (logical units)
    → sprint Validation run locally
    → Pull Request (template below)
    → review (1 reviewer; 2 for Sprint 02/04)
    → merge squash? NO — merge commit preserving task commits
```

## Commit prefixes

```
feat(backend):     new capability
fix(backend):      defect fix
refactor(backend): no behavior change
perf(backend):     measured performance change
security(backend): vulnerability closure
test(backend):     tests only
chore(backend):    tooling/deps/docs
docs(backend):     docs/backend updates
```

Every commit message ends with the finding/task reference, e.g.:
`security(backend): gate manual treasury endpoints behind manager+ [T-ACL-02][ACL-003]`

## PR template (paste into description)

```md
Sprint: <id> · Branch: <name> · Closes findings: <IDs>

## What & why
<2-4 sentences>

## Task-by-task
- [ ] T-XXX-NN — <title> (commit <sha>)

## Validation evidence
- lint/test: <output tail>
- API checks: <curl/supertest transcript>
- DB impact: <audit query + counts / "none">

## Frontend Contract Impact
<none | list with before→after shapes/status codes>

## Rollback
<how>
```

## Review focus by sprint type

| Sprint | Reviewer must verify |
| ------ | -------------------- |
| Auth/AuthZ (02) | matrix completeness; no gate widened without owner sign-off |
| Database (04) | pre-flight queries actually ran against prod-like data; rollback real |
| Business flows (05) | fault-injection tests genuinely kill process mid-flow |
| Performance (07) | explain() before/after present; cache has user-isolation test |

## Merge order enforcement

Branch dependencies in branch-map.md are enforced socially via PR "Depends on #N" links;
CI (from Sprint 10) additionally runs the full suite on every PR.
