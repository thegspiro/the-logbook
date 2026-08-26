# Security Review 13 — Apparatus & NFC

**Prefix:** `AP` · **Iteration:** 13 · **Reviewed:** 2026-08-26 · **PR:** [#1838](https://github.com/thegspiro/the-logbook/pull/1838)

**Backend:** `api/v1/endpoints/apparatus.py` (88 routes), `services/apparatus_service.py`,
`evoc_level_service.py`, `services/driver_exception_service.py` (new),
`api/v1/endpoints/nfc_tags.py` (6 routes, new), `services/nfc_tag_service.py` (new)
**Frontend:** `modules/apparatus`
**Migrations:** none this iteration (no schema change)

---

## Scope

Apparatus itself is well-audited: module-audit iteration 2 plus four
app-review Tier B passes (2026-08-06 through 2026-08-09) closed every FK
class this module had (AP-1 create-path, AP2-1 update-path read-leaks,
AP2-2 dangling-only FKs — all fixed, `assert_in_org` wired at 17 sites).
Re-verified rather than re-derived: FK validation still present at all 17
sites, 0 `# noqa: E712`, no free-`str`-to-enum write path.

`nfc_tags.py`/`nfc_tag_service.py` (member ID cards + check-in stations) is
genuinely new since any prior pass — added in three commits
(`63f4cc49` "Add NFC ID cards", then two of the feature's own review-fix
rounds, `e7d17770`/`9973c2ab`) with no rotation coverage until now. Read in
full. `driver_exception_service.py` (EVOC driving-requirement exceptions,
tied into scheduling eligibility) is likewise new and unaudited — read in
full given it's a sanctioned bypass of a safety control, the kind of
mechanism that warrants the most scrutiny in this module.

**Growth:** `apparatus.py` grew from 83 to 88 routes (all 5 new ones are the
driver-exception feature — list/list-approvers/request/review/revoke).

## Route inventory

88/88 `apparatus.py` routes carry auth. 87 via `require_permission`/
`require_all_permissions`; 1 bare `get_current_user`
(`list_driver_exception_approvers` — self-documented: any authenticated
member, returns only names/ranks, no contact details, scoped to the caller's
org). `nfc_tags.py`'s 6 routes are all `require_permission`-gated
(`members.manage_id_cards` for issue/list/update/delete, `members.check_in`
for the station endpoint) plus a server-side `require_nfc_id_cards` gate on
every route — the integration must be turned on for the org, checked on the
server rather than trusted from the frontend nav.

### Driver exceptions (new)

`request_driver_exception` requires `scheduling.assign`/`.manage`/
`apparatus.manage` (not a baseline grant — a member cannot request their own
exception). `review_driver_exception`/`revoke_driver_exception` require
`apparatus.approve_driver_exception` (chief-level by default). The service
layer (`driver_exception_service.py`) independently enforces separation of
duties via `assert_different_person` on **both** the requester and the
beneficiary — a chief cannot approve their own exception, and cannot approve
one requested by someone else _for_ the chief either. `review_exception`
settles a concurrent-approval race with a conditional `UPDATE ... WHERE
status = PENDING` (the same locking-decision shape as Pitfall #27, applied
to a status transition rather than a capacity count) rather than a
read-then-write. Validity window is mandatory and capped at 366 days from
both ends (start and span). All FK ids (`user_id`, `apparatus_id`)
org-validated via `assert_in_org`. No defect found — this is the
best-defended new feature reviewed in this rotation to date.

### NFC ID cards (new)

Card UIDs are never stored raw: `hash_tag_uid` SHA-256s the normalized UID
peppered with the installation's encryption salt; only a 4-character
`uid_preview` (for a human to eyeball "is this the right card") and the
hash are persisted. Every lookup (`resolve_tag`, `list_tags`, `get_tag`) is
`organization_id`-scoped. `check_in` never raises for a domain outcome
(unknown card, inactive card, inactive member) — it returns a typed status
the station renders, so a malformed tap can't take a kiosk down; a
non-existent target (shift/event/category id not found) still raises, since
that's a caller error, not a domain state. The three check-in targets
(shift, event, admin-hours) all resolve through org-scoped getters before
touching any record, and delegate the actual attendance mutation to each
target module's own existing service method (`SchedulingService.member_check_in`,
`EventService.self_check_in`, `AdminHoursService.clock_in`) rather than
reimplementing it. No defect found in the NFC-specific code.

## Verified good ✅

- **Auth coverage 88/88 (`apparatus.py`) + 6/6 (`nfc_tags.py`)**, enumerated
  above; the one bare-`get_current_user` route is self-scoped and
  low-sensitivity by design.
- **AP-1/AP2-1/AP2-2 (XC-1 FK classes) still closed** — `assert_in_org`
  present at all 17 previously-documented call sites.
- **No SQL injection, no PK-bypass** patterns anywhere in the three files.
- **NFC card UIDs are hashed, never stored raw** — verified the model has no
  plaintext UID column and every write path goes through `hash_tag_uid`.
- **Driver-exception separation of duties is real** — traced
  `assert_different_person` to `separation_of_duties.py`, the same shared
  helper finance/skills-testing/admin-hours approval paths use; not a
  reimplementation that could drift.
- **Lint:** flake8 clean.

## Findings

### AP-6 — LOW (defense-in-depth, not currently exploitable) — `clock_out_by_category` had no org filter on its own query — ✅ FIXED

**What:** `AdminHoursService.clock_out_by_category` selected the active
`AdminHoursEntry` by `category_id` + `user_id` + `status == ACTIVE` with no
`organization_id` filter on the query itself — the letter of CLAUDE.md
Pitfall #14a ("every by-id/client-supplied-id query must filter
organization_id, or resolve through an already-org-scoped parent") regardless
of whether either caller currently exploits it.
**Where:** `app/services/admin_hours_service.py:274` (reached via
`NfcTagService._check_in_admin_hours`, the code path this iteration is
reviewing, and directly by `admin_hours.py`'s own
`POST /clock-out-by-category/{category_id}` endpoint).
**Why not currently exploitable:** both callers pass `user_id=current_user.id`
(or the NFC-resolved card owner, itself org-validated) — never an
arbitrary member. An `AdminHoursEntry`'s `category_id` is always
org-consistent with the entry's own org, because `clock_in` validates the
category is in-org before creating the entry in the first place. So the
`user_id` scoping alone happens to make cross-org access unreachable today —
but that invariant lives in a different method (`clock_in`) than the one
being called, which is exactly the kind of implicit cross-method
dependency Pitfall #14 exists to not rely on.
**Fix:** added a required `organization_id` parameter, filtered directly on
`AdminHoursEntry.organization_id`, and updated both call sites
(`nfc_tag_service.py`, `admin_hours.py`) to pass it. Behavior-neutral for
every valid call (an entry that matches on category+user+status already
matches on org, by the invariant above) — this closes the gap on the query
itself rather than continuing to rely on `clock_in`'s enforcement holding
forever. `AdminHoursService.clock_out` (a sibling method with the same
shape, reached from `admin_hours.py`'s `/clock-out/{entry_id}`) has the
identical pattern and is equally non-exploitable today for the same
reason, but is out of scope for this iteration — it belongs to the Admin
Hours module (rotation feature 21), not Apparatus & NFC, and touching it
here would spread this PR into a module this rotation hasn't reached yet.
Noted for that iteration to pick up. Guard test:
`test_admin_hours_service.py::TestOrgScopedQueries::test_clock_out_by_category_query_is_org_scoped`.

## Schema & migration notes

No schema changes. `AdminHoursEntry.organization_id` is `nullable=False`
(pre-existing, unaffected by this fix — the fix only added a filter clause,
not a column).

## Guard tests added

- `test_admin_hours_service.py::TestOrgScopedQueries::test_clock_out_by_category_query_is_org_scoped`
  — asserts the compiled statement contains `organization_id`, matching the
  existing pattern in the same test class for the module's other two
  org-scoped queries. Fails on AP-6 reintroduction.

## Completion gate

| Check                                             | Result                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                                  |
| `black --check app/ tests/ alembic/`              | ✅ 1251 files unchanged                                          |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                                         |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head, no schema change                                 |
| `pytest tests/ -k "admin_hours or nfc"`           | ✅ 118 passed, 1 skipped (pre-existing optional-dependency skip) |
| `pytest tests/` (full backend suite)              | ✅ 8388 passed, 22 skipped (pre-existing Docker/no-MySQL skips)  |
| `tsc --noEmit` / `eslint .`                       | n/a — no frontend change                                         |
