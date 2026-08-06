# Application Review — <Feature Name>

**Prefix:** `<XX>` · **Iteration:** <A1/B1/…> · **Reviewed:** <YYYY-MM-DD>

**Backend:** `<files with line counts and endpoint counts>`
**Frontend:** `<files, or "(in-app)" / "none">`
**Docs:** `<docs/FEATURE.md, or "none — see finding XX-n">`

---

## Scope

What was read, and what was explicitly *not* read (with the reason). A reader
must be able to tell which parts of the feature carry a verified verdict.

## Verified good ✅

Concrete, checked claims only — "all 41 endpoints carry a permission
dependency", not "security looks fine". This section is what makes the next
reviewer's job cheaper, so cite the mechanism that makes each claim true.

## Findings

### <XX>-1 — <SEVERITY> — <one-line title> — <✅ FIXED | OPEN | FLAGGED>

**What:** the defect, in terms of the code.
**Where:** `path/to/file.py:123`.
**Impact:** what actually goes wrong, and for whom.
**Fix:** what was changed, or — if not fixed — why not and what the options are.

<!-- Severity: CRITICAL / HIGH / MED / LOW / NIT.
     FIXED = applied this iteration. OPEN = should be fixed, not yet.
     FLAGGED = needs an owner decision; mirror into KNOWN_LIMITATIONS.md. -->

## Duplication

Pairs or clusters of duplicated logic, with a proposed single owner. Include the
shared utility that already exists if the duplication is a reimplementation of
one.

## Dead code

Unreferenced symbols with the grep that established they are unreferenced.
Separate *deleted this iteration* from *left in place, and why*.

## Documentation gaps

What is missing or wrong, and whether it was corrected here.

## Future development

Numbered opportunities, each actionable on its own. Distinguish: incomplete
feature · missing test coverage · scale limit · UX gap · separation-of-duties ·
product decision.

## Completion gate

| Check | Result |
|-------|--------|
| tsc --noEmit | |
| flake8 | |
| black --check | |
| eslint | |
| frontend tests | |
| backend tests | |
</content>
