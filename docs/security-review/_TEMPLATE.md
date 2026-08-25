# Security Review — <Feature Name>

**Prefix:** `<XX>` · **Iteration:** <n> · **Reviewed:** <YYYY-MM-DD> · **PR:** #<n>

**Backend:** `<endpoint files (route counts), service files (line counts), models, schemas>`
**Frontend:** `<module path, or "(in-app)" / "none">`
**Migrations:** `<revisions touching this feature's tables, or "none">`

---

## Scope

What was read in full, what was sampled, and what was **not** read, with the
reason. A reader must be able to tell which parts of the feature carry a
verified verdict and which do not.

## Route inventory

Every route in the feature, with its gate. This table is the evidence for
checklist dimensions 1 and 2 — a spot check is not an inventory.

| Method | Path | Auth dependency | Permission | Org-scoped | Notes |
| ------ | ---- | --------------- | ---------- | ---------- | ----- |

## Verified good ✅

Concrete, checked claims only — "all 41 routes carry a permission dependency,
enumerated above", not "security looks fine". **Name the mechanism** that makes
each claim true, so the next reviewer can re-check it cheaply rather than
re-deriving it.

## Findings

### <XX>-1 — <CRITICAL|HIGH|MED|LOW|NIT> — <one-line title> — <✅ FIXED | OPEN | FLAGGED>

**What:** the defect, in terms of the code.
**Where:** `path/to/file.py:123`.
**Failure scenario:** concrete inputs or state → what an attacker or an unlucky
user actually gets. Reproducible, not hypothetical.
**Impact:** who is affected and how badly.
**Fix:** what changed, or — if not fixed — why not, and the options.

<!-- FIXED = applied this iteration. OPEN = should be fixed, not yet.
     FLAGGED = needs an owner decision; mirror into KNOWN_LIMITATIONS.md. -->

## Schema & migration notes

Model/migration drift, `SET NULL` nullability, JSON-column shape, seeded-grant
migrations. "n/a" if the feature owns no tables.

## Guard tests added

Tests that make a fixed class fail on reintroduction, with the invariant each
one asserts. Empty is a valid answer; silence is not.

## Completion gate

| Check                  | Result |
| ---------------------- | ------ |
| `flake8 app/ tests/`   |        |
| `black --check`        |        |
| backend tests (scoped) |        |
| `tsc --noEmit`         |        |
| `eslint .`             |        |
