# Security Review — Admin Hours

**Prefix:** `AH` · **Iteration:** 21 · **Reviewed:** 2026-08-26/27 (pass 1), 2026-08-30 (pass 2), 2026-09-05 (pass 3) · **PR:** [#1903](https://github.com/thegspiro/the-logbook/pull/1903) (pass 1, merged), [#2065](https://github.com/thegspiro/the-logbook/pull/2065) (pass 2, merged), pass 3 (this PR)

## Pass 3 (2026-09-05)

**Backend:** `app/api/v1/endpoints/admin_hours.py` (1,061 L, 27 endpoints),
`app/services/admin_hours_service.py` (1,883 L), model `app/models/admin_hours.py`,
schema `app/schemas/admin_hours.py`.
**Frontend:** the 26-file `modules/admin-hours/` module (grown from pass 2's 21
via three new UI-only files — see below) plus the same 6 outside consumers pass
2 established: `components/member-profile/AdminHoursSection.tsx`,
`pages/events-settings/HourTrackingSection.tsx`, `pages/Dashboard.tsx`,
`pages/MemberProfilePage.tsx`, `pages/ComplianceRequirementsConfigPage.tsx`,
`modules/membership/pages/CheckInStationPage.tsx`.
**Migrations:** none since pass 1 — confirmed by content-grepping every
migration file added since pass 2's merge for an `admin_hours`/`AdminHours`
reference, not by filename.

### Scope

Read the current `admin_hours.py`, `admin_hours_service.py`, and
`admin_hours.py` (model) directly rather than diffing pass 2's merge commit —
this repo's git history is shallow beyond a certain point in this environment
(`git fetch --unshallow` recovered full history, but the pass-2 PR's exact
merge commit reference in this doc, `991c04d2`, does not correspond to a
first-parent merge commit reachable from `main`'s current linear history,
likely a squash), so the fixes below were re-verified against the file
contents themselves — every claim is "read at its current line," not "diffed
against a hash."

**One backend commit landed since pass 2, and it is a correctness fix with no
security dimension**, confirmed by reading its diff directly
(`eb9c2f957`, 2026-08-31, "Stop requirement progress crashing for members who
logged hours"): `get_user_hours_compliance`'s percentage calculation divided a
MySQL `Decimal` (from `func.sum`) by a JSON-derived `float`
(`required_hours`), raising `TypeError` for any member who had logged approved
hours against the category — the empty-sum `or 0` fallback happened to
produce an `int`, so the endpoint only worked for members it had nothing to
report about. Fixed by using the `hours_from_minutes` helper the module's five
other call sites already use, and grading against the un-rounded
`total_minutes / 60.0` rather than the rounded display value. The AH-7
org-scoping filter this calculation sits inside (`UserModel.organization_id ==
organization_id` on the target-user fetch, confirmed still present at its
current line) is untouched by this diff. No migration touches an admin-hours
table since pass 1.

**Frontend: extended scope to cover a change pass 2's own listed outside
consumer went through outside this rotation, which a preliminary pass at this
same iteration missed entirely.** Two PRs (#2233, #2236, both merged
2026-09-04/05, both outside the security-review rotation) changed
`Dashboard.tsx`'s admin-hours summary read — the exact file pass 2 named as
one of the module's 6 outside consumers. Since a security-review pass's job is
to re-verify everything that changed in its declared scope since the last
pass, not only the module's own files, this pass reads both PRs' effect on the
current code rather than treating them as pre-verified because a bot reviewed
them on GitHub:

- **PR #2233** removed a client-side `admin_hours.view` permission gate on the
  dashboard's summary read. Verified this matches actual server behavior: the
  `GET /admin-hours/summary` endpoint (`admin_hours.py:809`) depends only on
  `get_current_user`, no `require_permission` — no default position or rank
  grants `admin_hours.view`, so the removed gate was blocking a read the
  backend has always allowed, leaving every ordinary member's card reading
  "Unavailable." Confirmed no backend permission changed; this is a
  client-side-only fix with no security dimension.
- **PR #2236** (a same-day follow-up after Codex review caught two P1
  consequences of #2233 going unconditional) fixed a genuine defect
  #2233 introduced: `Dashboard.tsx` called `getSummary()` with no `userId`,
  so a caller **holding** `admin_hours.manage` (an officer) got the whole
  organization's total under a card headed "My Hours" — before #2233 this
  only reached wildcard-permission holders (everyone else was gated out of
  the request), so removing the gate widened a latent cross-member data
  exposure to every officer. It also sent bare `YYYY-MM-DD` date bounds,
  which `_parse_optional_date` parses as UTC midnight — the endpoint filters
  `clock_in_at <= end_date`, so every entry logged "today" fell outside the
  month, and the unconverted start cut at UTC midnight rather than the
  department's, pulling in the previous month's tail for any department west
  of UTC.

  **Re-verified fixed at the current code** (`frontend/src/pages/Dashboard.tsx`
  lines ~945–992): `getSummary` is now called with
  `userId: currentUser?.id` explicitly, and both bounds go through
  `startOfReportingDayUTC`/`endOfReportingDayUTC`
  (`modules/admin-hours/utils/reportingRange.ts`, a new file this pass) rather
  than bare date strings. Read `reportingRange.ts` in full: it converts a
  local calendar day to a UTC instant via the existing `localToUTC` helper
  with `useTimezone()`, and the end bound is computed as "midnight opening the
  next day, minus one millisecond" so the whole selected day is covered
  without spilling into the next — correct, and consistent with
  `AdminHoursPage.tsx`'s own use of the same helpers (see below). No new
  by-id query or FK write is involved; this is a request-shaping fix on an
  already self-scoped read.

**Three new files in the module itself, all client-side form UX, no new
server surface:** `utils/entryTimes.ts` (pure date-math for the manual-entry
and pending-review edit forms — `addHours`, `syncEndToStart`),
`components/QuickDurationButtons.tsx` (1/2/4/8-hour preset buttons), and
`utils/reportingRange.ts` (above), wired into `AdminHoursPage.tsx` and
`PendingReviewTab.tsx`. Read all three in full. None issues a network call —
they only pre-fill the `clock_in_at`/`clock_out_at` fields that flow into the
existing, already-reviewed `create_manual_entry`/`edit_pending_entry` submit
paths, whose server-side guards (AH-1's future-time rejection and 24h cap,
AH-12's parity guards including the overlap re-check) apply identically
regardless of how the client arrived at the value. Also verified
`AdminHoursPage.tsx`'s own `fetchMySummary` calls (initial load, post-clock-out,
post-manual-submit) all pass `userId: currentUserId` explicitly — the same
scoping fix as `Dashboard.tsx`, applied independently in this file already
before this pass, not introduced by it.

Swept the full 26-file module plus all 6 outside consumers for the standing
pitfalls: `window.confirm`/`alert`/`prompt` (0 hits), `dangerouslySetInnerHTML`
(0 hits), banned `.toLocale*`/`date-fns`/`toISOString().slice` (0 hits), and
direct `fetch(`/raw `axios` imports (0 hits outside comments and the guard
tests themselves — `moduleFetchIntegrity.test.ts`'s two scans, from AH21-1/
AH21-4, still pass against the module's larger file set).

### Re-verification of pass-1/pass-2 fixes (AH-7 through AH-14, AH21-1 through AH21-4)

Read the current `admin_hours_service.py`, `admin_hours.py` (endpoint), and
the frontend files directly (not re-cited from prior passes):

- **AH-7** — `get_user_hours_compliance`'s target-user fetch still filters
  `UserModel.organization_id == organization_id` (line ~1751), alongside the
  unrelated `eb9c2f957` percentage-calculation fix above.
- **AH-8** — `clock_out` still filters `organization_id`.
- **AH-9** — `update_category` still routes through
  `apply_updates(category, kwargs, skip={"organization_id", "id"})`.
- **AH-10** — `clock_in`'s `User`-row lock (`select(User.id)...with_for_update()`,
  line 226) followed by the locking active-session read is unchanged.
- **AH-11** — both `create_event_hour_mapping` and `update_event_hour_mapping`
  still lock their percentage-sum queries (`with_for_update(of=EventHourMapping)`
  and the complete-locked-set fix respectively, lines 1388/1462).
- **AH-12** — `edit_pending_entry` still applies the future/24h/overlap guards.
- **AH-13** — `_parse_optional_date` still guards all four date-accepting
  endpoints (`list_my_entries`, `list_all_entries`, `export_entries`,
  `get_summary`).
- **AH-14** — `credit_event_attendance`'s stale-cleanup and idempotency
  queries, and `delete_event_attendance_entries`, all still filter
  `organization_id` (re-read in full at lines 1576–1713); the resync branch's
  in-place `duration_minutes` update without re-running
  `_determine_post_clockout_status` is unchanged — see "Confirmed still open"
  below.
- **AH21-1/AH21-4** — `adminHoursEntryService.exportCsv` still routes through
  the shared `createApiClient()` with `responseType: 'blob'` and `timeout: 0`;
  `moduleFetchIntegrity.test.ts`'s bare/`window`/`globalThis`/`self` `fetch(`
  scan and its direct-`axios`-import scan both still pass.
- **AH21-3** — `createApiClient.ts`'s blob-error-JSON-decoding fix is
  unchanged (verified by re-reading the interceptor, not just re-running its
  test).

**Route inventory — re-enumerated from scratch** (AST-equivalent: every
`@router.<verb>` decorator counted and its `Depends(...)` read): **27/27**,
unchanged from pass 1/2. Every route carries either `Depends(get_current_user)`
or `Depends(require_permission("admin_hours.manage"))` — no ungated route, no
mix of `.view`/`.manage` permission strings to check for the XC-2 pattern (the
module uses exactly one permission string for every gated route). Self-scoped
routes (`GET /active`, `GET /entries/my`, `GET /summary`,
`GET /compliance/{user_id}`) re-read directly: `get_summary` and
`get_user_hours_compliance` both force `effective_user_id` to the caller's own
id unless `current_user.positions`/`.permissions` includes
`admin_hours.manage`/`compliance.view`/`*` — independent of the client-supplied
`user_id` query param, matching pass 2's description exactly.

Freshly re-swept every `select(...)` call site in the service (~65 sites) for
a missing `organization_id` filter: none found. Line counts in this doc's
per-pass headers are measured at different points and are not a reliable
diff proxy on their own (the file's current 1,883 L vs. pass 2's stated
1,780 L is a larger gap than the single `eb9c2f957` commit's own +17/-3 diff
accounts for) — this pass verified scope by reading `git log --follow`'s full
commit list for the file and confirming `eb9c2f957` is the only commit
between pass 2's last real change and `HEAD`, not by reconciling line counts.
The two
by-id `User` fetches with no visible org filter (`force_clock_out`'s and
`edit_pending_entry`'s `select(User).where(User.id == entry.user_id)`, used
only to build a display name in the endpoint file) resolve `entry.user_id`
from an already-org-scoped `AdminHoursEntry`/entry object fetched earlier in
the same function — the checklist's named exception, not a gap.

Checked `admin_hours.py` (model) and `admin_hours.py` (schema) for drift: both
`ondelete="SET NULL"` foreign keys (`events.id`, `event_rsvps.id` on
`AdminHoursEntry`) are `nullable=True`; no new column or table since pass 1.

### Confirmed still open — unchanged from pass 1/2

Re-read both items against the current code:

- **Per-org SoD toggle (AH-4 refinement)** — the self-approval guard
  (`assert_different_person` in `approve_or_reject`; the `skipped_self` skip
  in `bulk_approve`) is still unconditional. Unchanged, still deliberate.
- **`credit_event_attendance`'s resync path can grow an already-APPROVED
  entry past its category's auto-approve threshold without re-review** —
  re-read the resync branch (lines 1643–1657) directly: `duration_minutes` is
  still updated in place with no call to `_determine_post_clockout_status`.
  Unchanged, still deliberate per the method's own docstring. Both items
  remain mirrored in `docs/KNOWN_LIMITATIONS.md` (added pass 2), re-read there
  too — still accurate.

**No new findings, no code changes this pass.**

## Completion gate (pass 3)

| Check                                                                                                                                     | Result                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                             | clean (0 violations)                     |
| `black --check app/ tests/ alembic/`                                                                                                      | clean (1477 files unchanged)             |
| `isort --check-only app/ tests/ alembic/`                                                                                                 | clean (isort 9.0.1, CI's pinned version) |
| `python3 scripts/validate_migrations.py --strict`                                                                                         | PASSED — 422 revisions, single head      |
| backend tests, scope (`-k "admin_hours"`)                                                                                                 | 72 passed, 1 pre-existing skip           |
| backend tests, full suite                                                                                                                 | 10876 passed, 21 pre-existing skips      |
| `npx tsc --noEmit` (frontend)                                                                                                             | 0 errors                                 |
| `npx eslint .` (frontend)                                                                                                                 | 0 errors, 0 warnings                     |
| `npx vitest run` (admin-hours module, 7 files)                                                                                            | 88 passed                                |
| `npx vitest run` (adjacent consumers: Dashboard, MemberProfilePage, member-profile, ComplianceRequirementsConfigPage, CheckInStationPage) | 151 passed                               |

No backend or frontend files were modified this pass — every change since
pass 2 (the `eb9c2f957` correctness fix, and PRs #2233/#2236 on `Dashboard.tsx`)
was independently verified to be already correct, not requiring a further fix
from this rotation.

---

## Pass 1 (2026-08-26/27)

**Backend:** `app/api/v1/endpoints/admin_hours.py` (1,052 L, 27 endpoints),
`app/services/admin_hours_service.py` (1,780 L), model `app/models/admin_hours.py`,
schema `app/schemas/admin_hours.py`. Touches `app/services/event_service.py`
(3 call sites threading `organization_id` into a signature change).
**Frontend:** `modules/admin-hours`; not reviewed this pass — backend only,
per rotation scope
**Migrations:** none touched this iteration

---

## Scope

Read in full via three parallel background agents: (A) the endpoint file
end-to-end, (B) the service file's first ~970 lines, (C) the service file's
remaining ~810 lines through EOF. This module is explicitly labeled
HIGH-sensitivity in prior audits — an `admin_hours.manage` holder both logs
their own hours into this pool **and** approves entries from it, so the
self-approval control is the module's core invariant.

Prior context read first: `docs/module-audit/admin-hours.md` (iteration 15)
and `docs/app-review/admin-hours.md` (4 passes, prefix AH2, through
2026-08-09). Both were exhaustive — this pass does not re-derive AH-1
through AH-6, and starts from what grew since 2026-08-09 (endpoint file
+5 L, service file +212 L) plus the one item those passes deliberately left
as a product decision.

## Verified good ✅ (re-confirmed, not re-derived)

- **AH-1** — `create_manual_entry` always starts `PENDING`, rejects a future
  `clock_in_at`/`clock_out_at`, and caps duration at `MAX_MANUAL_ENTRY_MINUTES`
  (24h).
- **AH-2** — `auto_close_stale_sessions` takes an optional `organization_id`;
  the per-org endpoint passes the caller's org, the global scheduled task
  omits it to sweep every org.
- **AH-3** — an auto-approved clock-out stamps `approved_at` (`approved_by`
  stays `None` to denote a system approval).
- **AH-4 / AH-6 (separation of duties)** — the single-entry approve path
  (`approve_or_reject`) still calls `assert_different_person`; `bulk_approve`
  still **skips** (never approves, never aborts the batch) any entry the
  approver owns, tracked via `skipped_self`.
- **AH-5** — `_get_active_session`, `_check_overlap`, and `delete_category`'s
  active-session count all still filter `organization_id`.
- **No impersonation** — `create_manual_entry` sets `user_id` from
  `current_user`, never from the request body; `AdminHoursEntryCreate`
  exposes no `user_id`/`organization_id` field.
- Every client-supplied FK id that gets persisted (`category_id` on
  `clock_in`, `create_manual_entry`, `edit_pending_entry`;
  `admin_hours_category_id` on `create_event_hour_mapping`) is validated
  in-org before storage.
- No SQL injection, no LIKE/ilike anywhere in the module, `SafeCsvWriter`
  used for the entries export (not raw `csv.writer`).

## Findings

### AH-7 — HIGH — `get_user_hours_compliance` resolved a target user with no org filter — ✅ FIXED

**What:** `GET /compliance/{user_id}` restricts **non-admin** callers to
their own id, but any caller holding `admin_hours.manage` /
`compliance.view` / `*` could pass **any** `user_id`, including one from a
different organization. The service then fetched that `User` row
(`select(UserModel).where(UserModel.id == user_id)`, no org filter) and used
its `membership_type`/`positions` to pick a compliance profile from the
**caller's own org**, plus a hours-sum query that also carried no org
filter.
**Where:** `app/services/admin_hours_service.py` — the `User` fetch and the
per-requirement hours-sum query inside `get_user_hours_compliance` (was
unscoped on both).
**Failure scenario:** an officer in Org A with `compliance.view` calls
`GET /compliance/{some-Org-B-user-id}`. The target user's row resolves
regardless of tenant; their `membership_type`/`positions` are matched
against Org A's compliance profiles, and a `category_id` collision (in-org
category ids are UUIDs, so unlikely but not structurally prevented by this
query alone) would sum that user's hours into the response. At minimum this
is a cross-tenant existence/attribute oracle on `User`; independently
identified by two separate review agents (endpoint-side and service-side),
which is why it's rated HIGH despite the hours data itself rarely lining up
in practice — the `User` row and its membership/position data is a real,
reachable cross-tenant read regardless.
**Fix:** both queries now filter `organization_id` — the `User` fetch
directly, and the hours-sum query for defense-in-depth consistency with
every other by-id query in this file (the category id it also filters was
already org-validated earlier in the function, so this one was likely
non-exploitable on its own, but the invariant should hold uniformly).

### AH-8 — LOW — `clock_out` was the one query in this file not yet org-scoped — ✅ FIXED

**What:** `clock_out` filtered only `id` + `user_id` + `status == ACTIVE`,
with no `organization_id` predicate — the exact class of gap AH-5 closed
everywhere else in this module. Not currently exploitable (one org per
user, so `user_id` alone happens to scope correctly), but inconsistent with
the codebase's own stated invariant, and notably: a same-day commit
(`aebfbd84`, part of the apparatus/NFC feature's own review) fixed the
identical shape on the sibling method `clock_out_by_category` and its
commit message explicitly deferred `clock_out` itself "for the Admin Hours
module's own rotation turn" — i.e., this pass.
**Where:** `app/services/admin_hours_service.py` (`clock_out`).
**Fix:** added an `organization_id` parameter, threaded through from
`clock_out_by_category`'s internal call and the endpoint, filtering the
query the same way its sibling already does.

### AH-9 — MED — `update_category` used a blind `setattr` loop — ✅ FIXED

**What:** `for key, value in kwargs.items(): setattr(category, key, value)`.
The method's own docstring already documented the intended behavior
("setting description=None clears it"), but a blind loop applies an
explicit null to **any** field including NOT NULL columns (`name`,
`require_approval`, `is_active`, `sort_order`) — which would reach
`flush()` and raise an unhandled `IntegrityError` (500) instead of a clean 400.
**Where:** `app/services/admin_hours_service.py` (`update_category`).
**Fix:** routed through `apply_updates`, which is the drop-in replacement
for exactly the behavior the docstring already promised — nullable columns
still clear on an explicit null, NOT NULL columns now raise a clean
`ValueError` instead of crashing at flush.

### AH-10 — MED — `clock_in` was a read-then-write race with no lock (Pitfall #27) — ✅ FIXED

**What:** `clock_in` reads `_get_active_session` (a plain SELECT) to check
"no other active session," then inserts a new ACTIVE entry — no row lock
anywhere in between. Two concurrent clock-in requests for the same user
(a double-tap, or two open tabs/devices) could both pass the check and both
insert an ACTIVE row, corrupting the "one active session at a time"
invariant `clock_out`/`get_active_session` depend on.
**Where:** `app/services/admin_hours_service.py` (`clock_in`).
**Fix:** both halves Pitfall #27 requires: locks the caller's own `User`
row first (guaranteed to exist, one per user — the same "lock a guaranteed
parent row" pattern used for SKT-4 in this rotation), then makes the
active-session check itself a locking read (`_get_active_session` gained a
`for_update` parameter, used only here — the plain read path,
`get_active_session`, is unaffected).

### AH-11 — LOW/MED — event-hour-mapping percentage totals could race past 100% — ✅ FIXED (best-effort)

**What:** `create_event_hour_mapping` and `update_event_hour_mapping` each
sum existing active mappings' `percentage` for the same source
(`event_type` or `custom_category`), then write a new/updated percentage —
with no lock on the read. Two concurrent creates/updates for the same
source could both read a total under 100 and jointly exceed it, so more
than 100% of an event's duration gets credited across categories. This is a
data-integrity issue, not a tenant-isolation or auth bypass.
**Where:** `app/services/admin_hours_service.py` (both methods' percentage
sum query).
**Fix:** added `.with_for_update()` to both sum queries. **Residual, stated
plainly:** there is no single row representing "a source" (`event_type` is
a string, not an FK to a lockable row), so this closes the race whenever at
least one mapping for the source already exists — the common case once a
source has any allocation — but does not fully close a race between two
concurrent **first** mappings for a brand-new source. A DB-level unique/
check constraint would close that gap completely; that's a schema decision
left for a future pass, not attempted here.

**Revised after Codex review:** the first version of `update_event_hour_mapping`'s
fix locked only the _other_ mappings for the source, excluding the target
row being updated (`EventHourMapping.id != mapping_id`). Codex correctly
identified a lock-order inversion this introduces: two concurrent updates
to two _different_ mappings under the same source could each lock the row
the other was about to write to (via the exclusion-based sum), then each
block writing their own row at flush — InnoDB resolves that by killing one
side as a deadlock, surfaced to the caller as a 500. Fixed by locking the
**complete** set of mappings for the source — including the target itself —
in one query, ordered consistently by `id`, before reading or writing any
of them; `other_total` is then computed in Python from that locked set. A
second transaction reaching the same source now queues behind the first
instead of each holding what the other needs. `create_event_hour_mapping`
does not have this failure mode (a fresh `INSERT` never needs to acquire a
write lock on an existing row, so there is nothing for its own write to
deadlock against). Guard test:
`test_locked_set_includes_the_target_row_itself` in
`tests/test_admin_hours_service.py`, asserting the target's own id is not
excluded from the locked query.

### AH-12 — LOW — `edit_pending_entry` skipped the guards `create_manual_entry` enforces — ✅ FIXED

**What:** editing a pending entry's times only checked ordering
(`end > start`) and a 1-minute minimum — no future-time rejection, no 24h
cap, and no overlap re-check, even though the entry can be moved just as
freely as the original manual entry could. Prior app-review passes called
this "a parity nit, not a hole" (admin-only surface, entry stays `PENDING`
under the AH-4 approval gate) and left it open; closing it needs no product
decision, just applying the same guards the sibling create path already
has.
**Where:** `app/services/admin_hours_service.py` (`edit_pending_entry`).
**Fix:** added the future check, the `MAX_MANUAL_ENTRY_MINUTES` cap, and an
overlap check via the existing `_check_overlap(..., exclude_entry_id=...)`
(already built for exactly this call, just never wired in).

### AH-13 — LOW — four `datetime.fromisoformat` call sites turned a bad date into a 500 — ✅ FIXED

**What:** `list_my_entries`, `list_all_entries`, `export_entries`, and
`get_summary` all parsed `start_date`/`end_date` query params with a bare
`datetime.fromisoformat(...)`, unguarded by any try/except — a malformed
date string raised an unhandled `ValueError` surfaced as a raw 500. Flagged
by the 2026-08-08 app-review pass as "a module-wide status-code robustness
gap... recorded for a future robustness sweep," not fixed at the time.
**Where:** `app/api/v1/endpoints/admin_hours.py`, all four endpoints.
**Fix:** a small `_parse_optional_date(value, field_name)` helper raises a
clean `HTTPException(400, ...)` on a bad value; all four call sites route
through it.

### AH-14 — LOW — `source_rsvp_id`-keyed queries carried no org filter — ✅ FIXED

**What:** `credit_event_attendance`'s stale-entry cleanup and
idempotency-existence check, and `delete_event_attendance_entries`, all
queried `AdminHoursEntry` by `source_rsvp_id` (and sometimes
`category_id`) with no `organization_id` predicate. `rsvp_id` is always
resolved server-side from an already org-scoped `EventRSVP`/`Event` in
every current caller (confirmed by reading `event_service.py`'s call
sites), so this was not reachable as cross-tenant IDOR from client input —
but it's the same inconsistency-against-the-codebase's-own-invariant class
as AH-5 and AH-8, in code added since the last audit.
**Where:** `app/services/admin_hours_service.py` (`credit_event_attendance`,
`delete_event_attendance_entries`).
**Fix:** added `organization_id` filters to all three queries;
`delete_event_attendance_entries` gained an `organization_id` parameter
(threaded through its two callers in `event_service.py`, one of which —
`_revoke_event_attendance_credit` — also gained the parameter and now
org-scopes its own RSVP lookup via a join to `Event`).

## Confirmed still open — flagged, not fixed (product/design decisions)

- **Per-org SoD toggle (AH-4 refinement)** — re-confirmed unchanged: the
  self-approval guard is unconditional by design; a genuine sole-officer
  department would need a second `admin_hours.manage` holder. Still a
  deliberate product/config decision, not a bug.
- **`credit_event_attendance`'s resync path can grow an already-APPROVED
  entry past its category's auto-approve threshold without re-review.**
  When an event is reopened and an attendee's corrected check-out time
  lengthens their session, the resync update path
  (`credit_event_attendance(resync=True)`) updates `duration_minutes` in
  place on an entry that may already be `APPROVED`, without re-running
  `_determine_post_clockout_status`. The method's own docstring documents
  this as deliberate — status/`approved_by`/`approved_at` are intentionally
  left untouched so a correction doesn't silently revoke an officer's
  already-made review decision — but the flip side is that the same
  mechanism never re-evaluates it either, so an entry can grow past a
  threshold that would have required review had it been that long from the
  start. This is officer/leader-driven (not member self-service), so lower
  severity than a raw self-credit bug, but it's a genuine gap in the
  approval-integrity model that needs a product decision (re-queue for
  review above some growth threshold? leave as-is and rely on the officer
  noticing?), not a unilateral code fix that might contradict the documented
  intent.

## Schema & migration notes

n/a — no model or migration changes this iteration.

## Guard tests added

All in `tests/test_admin_hours_service.py` unless noted:

- `TestClockOutOrgScoped` — `clock_out`'s compiled WHERE clause includes
  `organization_id`.
- `TestClockInLocking` — the User-row lock query and the active-session
  check both render `FOR UPDATE`, against `users` and
  `admin_hours_entries` respectively, in that order.
- `TestUpdateCategoryNullabilityGuard` — `name` (NOT NULL) rejects an
  explicit null; `description` (nullable) still clears.
- `TestEditPendingEntryParityGuards` — an edit that would exceed 24h, land
  in the future, or overlap another entry is now rejected the same as a
  create; the overlap check excludes the entry being edited itself.
- `TestEventHourMappingPercentageLocking` — both `create_event_hour_mapping`
  and `update_event_hour_mapping`'s percentage-sum queries render
  `FOR UPDATE`.
- `TestUserHoursComplianceOrgScoped` — the target-user fetch's compiled
  WHERE clause includes `organization_id`.
- `tests/test_event_attendance_lock.py` — updated the existing
  `delete_event_attendance_entries` call-signature assertion for the new
  `organization_id` argument.
- `test_locked_set_includes_the_target_row_itself` in
  `TestEventHourMappingPercentageLocking` — guards the Codex-caught
  lock-order deadlock: the target mapping's own id must not be excluded
  from the locked source set.

## Completion gate

| Check                                              | Result                  |
| -------------------------------------------------- | ----------------------- |
| `flake8` (changed files)                           | clean                   |
| `black --check` (changed files)                    | clean                   |
| `isort --check-only` (changed files)               | clean                   |
| `python3 scripts/validate_migrations.py --strict`  | PASSED (no migrations)  |
| backend tests, scope (`-k "admin_hours or event"`) | 604 passed, 1 skipped   |
| backend tests, full suite                          | 8846 passed, 22 skipped |

---

## Pass 2 (2026-08-30)

**Backend:** `app/api/v1/endpoints/admin_hours.py`, `app/services/admin_hours_service.py`,
`app/models/admin_hours.py`, `app/schemas/admin_hours.py`.
**Frontend:** established for the first time this pass — `modules/admin-hours/`
(services, store, pages, components, types), plus every outside consumer,
found by a repo-wide import search rather than assumed complete from memory
(a Codex review comment on the first version of this doc caught an
undercounted list — see AH21-2 below):
`components/member-profile/AdminHoursSection.tsx`,
`pages/events-settings/HourTrackingSection.tsx` (event-hour-mapping config,
reachable only through `eventHourMappingService`, not the module's own pages),
`pages/Dashboard.tsx` (read-only monthly hours summary card,
`adminHoursEntryService.getSummary`), `pages/MemberProfilePage.tsx`
(read-only summary + compliance for the viewed member,
`adminHoursEntryService.getSummary` / `adminHoursComplianceService.getUserCompliance`,
gated behind `isSelf || checkPermission('admin_hours.manage')`),
`pages/ComplianceRequirementsConfigPage.tsx` (read-only category list for the
compliance-profile editor, `adminHoursCategoryService.list`), and
`modules/membership/pages/CheckInStationPage.tsx` (read-only category list
for the kiosk clock-in flow, `adminHoursCategoryService.list`).
`modules/reports/components/renderers/AdminHoursRenderer.tsx` was listed as a
consumer by the first version of this doc; it does not import the
admin-hours module at all (it renders the `AdminHoursReport` shape returned
by the reports endpoint, a separate data path) and has been removed from
this list.
**Migrations:** none since pass 1.

### Scope since pass 1's merge (`598a8063`, PR #1903)

`git diff --stat 598a8063..HEAD` against the four backend files: only
`admin_hours_service.py` changed (+24/-7), and the diff is a pre-existing-bug
fix unrelated to this rotation — `get_user_hours_compliance`'s `User` fetch
gained `.options(selectinload(UserModel.positions))`, because a lazy load of
`positions` inside an async session raises `MissingGreenlet` rather than
running the query. It only ever surfaced when an officer looked up _someone
else's_ compliance (checking your own returns the already-loaded
`current_user` object, whose `positions` the auth dependency had already
populated) — not a security regression, and the AH-7 org-scoping fix it sits
inside is unchanged (still filters `UserModel.organization_id ==
organization_id`, confirmed by reading the current diff, not assumed from the
commit message).

`event_service.py` also changed (+28/-0) but is EV-17's fix (feature 16, PR
#1973) threading an org-scoped attachment-path validator through the same
call sites this module's own AH-14 fix touched last pass — read directly and
confirmed unrelated to admin hours' own invariants.

No migration touches an admin-hours table since pass 1 (`git log --oneline
598a8063..HEAD -- backend/alembic/versions` has no admin_hours-referencing
file; confirmed by grepping the changed migration files' content directly,
not by filename).

### Re-verification of pass-1 fixes (AH-7 through AH-14)

Read the current `admin_hours_service.py` and `admin_hours.py` directly
(not re-cited from the pass-1 doc) and confirmed every fix is intact at its
current line:

- **AH-7** (`get_user_hours_compliance`) — `UserModel.organization_id ==
organization_id` still present on the target-user fetch (now alongside the
  unrelated eager-load addition above).
- **AH-8** (`clock_out`) — still filters
  `AdminHoursEntry.organization_id == str(organization_id)`.
- **AH-9** (`update_category`) — still routes through
  `apply_updates(category, kwargs, skip={"organization_id", "id"})`.
- **AH-10** (`clock_in`) — the `User`-row lock (`select(User.id).where(User.id
== user_id).with_for_update()`) followed by the locking active-session read
  (`_get_active_session(..., for_update=True)`) are both still present, in
  order.
- **AH-11** (event-hour-mapping percentage locking) — `create_event_hour_mapping`
  still locks the sum query with `.with_for_update(of=EventHourMapping)`;
  `update_event_hour_mapping` still locks the **complete** source set
  (target row included, ordered by `id`) per the Codex-caught deadlock fix,
  not the narrower excluding-the-target version.
- **AH-12** (`edit_pending_entry`) — future-time rejection, the 24h cap, and
  the overlap check (`exclude_entry_id=entry_id`) are all still present.
- **AH-13** (`_parse_optional_date`) — all four endpoints
  (`list_my_entries`, `list_all_entries`, `export_entries`, `get_summary`)
  still route through it.
- **AH-14** (`source_rsvp_id`-keyed queries) — `credit_event_attendance`'s
  stale-cleanup and idempotency-check queries, and
  `delete_event_attendance_entries`, all still filter `organization_id`.

Re-ran an AST route enumeration from scratch (not a diff against pass 1's
count): **27/27** routes, matching pass 1 exactly. Every route carries either
`Depends(get_current_user)` or
`Depends(require_permission("admin_hours.manage"))` — no ungated route, and
the permission string is uniform across every mutating/admin-view route (no
mix of `.view`/`.manage` to check for the XC-2 pattern). Self-scoped routes
(`/active`, `/entries/my`, `/summary`, `/compliance/{user_id}`) all filter on
the caller's own id server-side, independent of any client-supplied
`user_id` query param — re-read `get_summary`'s and
`get_user_hours_compliance`'s permission-membership checks
(`current_user.positions`/`.permissions`) directly rather than trusting the
pass-1 description.

Also independently re-read every `select(...)` call site in
`admin_hours_service.py` (not a diff — a fresh mechanical sweep, ~60 sites)
for a missing `organization_id` filter: none found. The two by-id `User`
fetches with no visible org filter (`admin_force_clock_out`'s and
`edit_pending_entry`'s `select(User).where(User.id == entry.user_id)`, used
only to build a display name) resolve `entry.user_id` from an
already-org-scoped `AdminHoursEntry` fetched two lines above in the same
function — the checklist's "resolves through an already-org-scoped parent"
exception, not a gap.

### Frontend scope — established for the first time this pass

Pass 1 was explicitly backend-only. Traced every file importing an
admin-hours service, store, or type export: the 21-file `modules/admin-hours/`
module (services/api.ts, the Zustand store, 5 pages, 9 components, 2 type/
util files) plus 6 outside consumers that reach in through the module's own
service exports rather than duplicating them (see AH21-2 — the first version
of this doc's list of "3 outside consumers" was incomplete: it named
`AdminHoursRenderer.tsx`, which does not actually import the module, and
missed `Dashboard.tsx`, `MemberProfilePage.tsx`,
`ComplianceRequirementsConfigPage.tsx`, and `CheckInStationPage.tsx`, found
by re-running the import search repo-wide rather than trusting the original
list). All six outside consumers call only read methods
(`getSummary`/`getUserCompliance`/`list`) — none creates, updates, or
deletes through the admin-hours service, so CLAUDE.md Pitfall #1's
create/update payload semantics don't apply to any of them.

`services/api.ts` — every method routes through `createApiClient()`
(`withCredentials: true`, the CSRF double-submit header on state-changing
methods, and the shared 401-refresh-and-retry interceptor), matching Pitfall
#7's requirement, **with one exception below (AH21-1)**.

Swept the full 21-file module plus all 6 outside consumers for:
`window.confirm`/`alert`/`prompt` (0 hits — destructive actions
(deactivate-category) go through `useConfirm()`; approve/reject/bulk-approve
use inline confirmation UI, not a blocking dialog, which is not this
pitfall's concern), `dangerouslySetInnerHTML` (0 hits), banned
`.toLocale*`/`date-fns` (0 hits — `formatDate`, `formatForDateTimeInput`,
`localToUTC` with `useTimezone()` used throughout
`PendingReviewTab.tsx`/`AllEntriesTab.tsx`), and direct `fetch(` (**1 hit,
AH21-1 below**). `apiCache.ts`'s `UNCACHEABLE_PREFIXES` already carries a
full-prefix `/admin-hours/` entry covering all 27 routes (present since
before this pass; verified, not assumed).

Checked the two update-payload forms against CLAUDE.md Pitfall #1's
create-vs-update semantics: `CategoriesTab.tsx`'s `handleUpdate` sends every
field the form owns on every save, with `description: formData.description
|| null` correctly sending an explicit `null` to clear (not omitting the
key) — matching the update-payload rule even though it doesn't call the
shared `blankToNull` helper by name. `HourTrackingSection.tsx`'s event-hour-
mapping form only creates and deletes mappings (no edit UI reaches
`eventHourMappingService.update`, which is otherwise unused from the
frontend) so the update-payload rule has no live call site to check there.

### AH21-1 — LOW — CSV export bypassed the shared auth client — ✅ FIXED

**What:** `AllEntriesTab.tsx`'s `handleExportCSV` built a plain URL
(`adminHoursEntryService.getExportUrl(...)`) and called the browser's global
`fetch()` directly with a manually-set `credentials: 'include'`, instead of
going through the module's shared axios client
(`services/api.ts`, `createApiClient()`). Functionally it worked — cookies
were sent, and the export is a GET so no CSRF header was needed — but it
bypassed the 401-refresh-and-retry interceptor and the shared error-reporting
integration every other request in this module (and the rest of the app)
gets. Every comparable export elsewhere in the codebase
(`modules/reports/services/api.ts`'s `reportExportService.exportReport`,
`modules/storefront/services/api.ts`) goes through the shared client with
`responseType: 'blob'`; this was the one outlier (confirmed by grepping the
whole frontend for `credentials: 'include'` — 3 hits total, the other two are
`onboarding/services/api-client.ts` and `services/errorReporting.ts`, both of
which run _before_ a session/CSRF context exists, which this export does
not).

**Where:** `frontend/src/modules/admin-hours/components/AllEntriesTab.tsx`
(`handleExportCSV`), `frontend/src/modules/admin-hours/services/api.ts`
(`adminHoursEntryService.getExportUrl`).

**Failure scenario:** an officer's session is on the edge of expiry (the
access-token cookie has lapsed but the refresh cookie hasn't) when they click
Export CSV. Every other request in the app would transparently refresh the
session and retry; this one got a bare 401 from the raw `fetch()`, which the
code correctly surfaced as a generic "Failed to export CSV" toast rather than
crashing — but the export failed where an equivalent list-entries fetch on
the same page, one click earlier, would have silently refreshed and
succeeded. Not a data-exposure or tenant-isolation defect (the export is
still correctly permission-gated and org-scoped server-side, unaffected by
this), but a real, user-visible robustness gap this rotation's own
established pattern (module axios instances must carry the same auth
handling, Pitfall #7) exists to prevent.

**Fix:** replaced `getExportUrl` (URL-builder, paired with a raw `fetch()`)
with `adminHoursEntryService.exportCsv(...)`, an async method on the
existing service that issues the request through the shared `api` client
with `responseType: 'blob'` — the same pattern
`reportExportService.exportReport` already uses. `AllEntriesTab.tsx` now
awaits the Blob directly instead of hand-rolling the fetch/credentials/
error-check sequence. No behavior change from the user's perspective (same
filename, same trigger); the difference is only that a 401 mid-export now
gets the same transparent refresh-and-retry as every other request.

**Follow-up (same finding, caught by Codex review on the PR, round 1):** the
raw `fetch()` this replaced had no timeout at all, while `createApiClient()`
applies `API_TIMEOUT_MS` (30s) to every request. `export_entries_csv`
(`admin_hours_service.py`) runs one org-scoped query with no row cap, then
serializes every row before the response starts — for a long-tenured
department's unfiltered history, that can legitimately exceed 30s, and
routing the request through the shared client would have newly aborted an
export that used to succeed. Verified this is a real risk this specific fix
introduces (not merely a pre-existing pattern the PR's own body already
disclaims): `reportExportService.exportReport` and the storefront order
export have the identical unbounded-query-then-30s-timeout shape, but
neither is touched by this PR, so fixing only admin-hours' new call site is
the correctly-scoped fix rather than widening this PR into those modules.
First fix: added `EXPORT_TIMEOUT_MS` (120s) and passed it as `exportCsv`'s
request timeout.

**Follow-up, round 2 (same finding, Codex correctly rejected round 1's fix):**
120s is still a finite cap — any client-side timeout still aborts a download
the unbounded raw `fetch()` would have let finish once an organization's
history grows past it, so the "regression" wasn't actually resolved, only
raised. Reverted `EXPORT_TIMEOUT_MS`/`constants/config.ts` (dead code once
unused) and set `timeout: 0` on `exportCsv`'s request config instead — axios's
documented "no timeout" value, which exactly restores the raw `fetch()`'s
behavior rather than approximating it with a bigger number. The backend
query itself remains unbounded/non-streaming, matching the two other
export endpoints with the same shape; still out of this PR's scope.

**Guard test:**
`frontend/src/modules/admin-hours/moduleFetchIntegrity.test.ts` — walks
every non-test `.ts`/`.tsx` file under the module and fails on a bare
`fetch(` call, naming the file and line. Verified to fail on reintroduction
by temporarily reinserting a `fetch()` call in `AllEntriesTab.tsx` (failed,
naming the exact line) and confirmed clean after reverting. Broadened
further under AH21-4 below.

### AH21-2 — LOW (documentation accuracy) — "every outside consumer" claim was incomplete — ✅ FIXED

**What:** Caught by a Codex review comment on the PR. This doc's first
version claimed the frontend sweep covered "every outside consumer" but
listed only 3: `AdminHoursSection.tsx`, `AdminHoursRenderer.tsx`, and
`HourTrackingSection.tsx`. A repo-wide import search
(`grep -rln "admin-hours/services/api\|adminHoursService\|AdminHours"
frontend/src`, excluding the module itself) turns up ten matches, not three:
the original three, four more genuine consumers the original search missed
(`pages/Dashboard.tsx`, `pages/MemberProfilePage.tsx`,
`pages/ComplianceRequirementsConfigPage.tsx`,
`modules/membership/pages/CheckInStationPage.tsx`), and `App.tsx` plus three
`.test.tsx` files (route registration and test files, not consumers in the
security-scope sense). `AdminHoursRenderer.tsx` itself does not import the
admin-hours module at all — it renders the `AdminHoursReport` shape the
reports endpoint returns, an unrelated data path — so its inclusion in the
original list was also wrong in the other direction.

Since a pass that "establishes frontend security scope for the first time"
and then marks the feature done is exactly the kind of claim a later pass
would take on faith rather than re-deriving, an incomplete list here would
have let a real consumer go unswept indefinitely.

**Fix:** re-ran the sweep (`window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, banned `.toLocale*`/`date-fns`, direct `fetch(`)
against all four newly-found files — 0 hits on all four checks, and all four
call only read methods on the admin-hours service (`getSummary`,
`getUserCompliance`, `list`), so CLAUDE.md Pitfall #1's create/update
payload rules don't apply to any of them. Corrected the consumer list in
the "Pass 2" header and the "Frontend scope" section above (now 6, not 3,
with `AdminHoursRenderer.tsx` removed and a note on why). No code change —
this finding is about the doc's own claim, not the application.

### AH21-3 — MEDIUM — a JSON error body from a `blob`-typed request was silently undecoded, losing the error detail and support code — ✅ FIXED

**What:** Caught by Codex review on `exportCsv`'s new call site, but the
defect is in shared code, not admin-hours' own: `responseType: 'blob'`
applies to axios' error responses too, so a 403/500 with a JSON body
arrives at `error.response.data` as an undecoded `Blob`, not parsed JSON.
`toAppError`/`getErrorMessage` (`utils/errorHandling.ts`) and
`reportApiError`'s support-code extraction (`services/errorReporting.ts`)
both read `data.detail`/`data.message`/`data.code` directly; against a
`Blob` those are all `undefined`, so a failed export's toast degrades to a
generic `statusText` fallback and the Error Monitoring record loses the
`LB-*` support code an administrator would use to match a member's report
to the row.

**Where:** `frontend/src/utils/createApiClient.ts` (response interceptor) —
not admin-hours-specific. `reportExportService.exportReport`
(`modules/reports/services/api.ts`) and the storefront order export
(`modules/storefront/services/api.ts`) share the exact same latent bug,
since both also request with `responseType: 'blob'` through an instance
built by the same `createApiClient()`; neither is touched by this PR.

**Fix:** the fix went in the one place all blob-response callers funnel
through rather than admin-hours' own file, so it covers the other two
call sites too, not just this PR's new one. `createApiClient()`'s response
interceptor now runs first: if `error.response.data instanceof Blob` and
its `type` includes `json`, decode it via `.text()` + `JSON.parse` and
replace `error.response.data` in place, before the 401-retry and
`reportApiError` logic that reads it. A non-JSON blob (e.g. an HTML error
page from a proxy) is left undecoded rather than throwing — downstream
code already falls back to `statusText`/`error.message` for that case, the
same as it did before this fix.

**Guard test:** `frontend/src/utils/createApiClient.test.ts`, new `blob
error responses` block (3 cases) — drives the real interceptor chain
(stub adapter, not a mocked axios) rather than asserting the fix's source:
a JSON error blob's `detail` and `code` both survive to the object
`reportApiError` receives; a non-JSON error blob is left as the original
`Blob` rather than crashing; a successful blob response is untouched.

### AH21-4 — LOW (test coverage) — the guard test scanned only one `fetch(` spelling and no test exercised `exportCsv` itself — ✅ FIXED

**What:** Also caught by Codex review. `moduleFetchIntegrity.test.ts`'s
regex excluded any `fetch(` preceded by a `.`, so a bypass rewritten as
`window.fetch(...)` or `globalThis.fetch(...)` — still a real bypass of
the shared client — would not have been caught; and no test anywhere
actually called `exportCsv()`, so AH21-1's "the fix works" conclusion was
a source scan's absence of one string, never checked against the
function's real behavior (its request shape, or that a failure propagates
instead of being swallowed).

**Fix:** two changes. `moduleFetchIntegrity.test.ts` now runs two checks:
the existing bare-`fetch(` scan, extended to also match
`window.fetch(`/`globalThis.fetch(`/`self.fetch(`; and a new scan
rejecting any direct `import ... from 'axios'` in the module (the other
way to bypass `createApiClient()`). New file
`services/exportCsv.behavior.test.ts` mocks only the module's
`createApiClient` dependency (not `exportCsv` itself, and not `fetch`) and
asserts the real function sends the expected URL, `params`,
`responseType: 'blob'`, and `timeout: 0` (AH21-1 round 2), and that a
rejection from the client propagates to the caller rather than being
swallowed.

**Guard tests:** `moduleFetchIntegrity.test.ts` — verified to fail on
reintroduction by temporarily reinserting a bare `fetch(`, a
`window.fetch(`, and an `import axios from 'axios'` in turn (each failed,
naming the exact file) and confirmed clean after reverting.
`services/exportCsv.behavior.test.ts` — 2 new tests, both passing against
the real `exportCsv` implementation.

### Confirmed still open — unchanged from pass 1

Re-read both items from pass 1's "Confirmed still open" section against the
current code: the per-org SoD toggle (AH-4 refinement) and
`credit_event_attendance`'s resync-can-grow-a-decided-entry gap are both
still present, both still deliberate per the code's own docstrings, and
neither is touched by anything that changed since pass 1. No new open items
in this class this pass.

## Completion gate (pass 2)

| Check                                                               | Result                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                       | clean (0 violations)                                      |
| `black --check app/ tests/ alembic/`                                | clean (1335 files unchanged)                              |
| `isort --check-only app/ tests/ alembic/`                           | clean (isort 8.0.1, already installed)                    |
| `python3 scripts/validate_migrations.py --strict`                   | PASSED — 394 revisions, single head                       |
| backend tests, scope (`-k "admin_hours"`)                           | 67 passed, 1 skipped                                      |
| `npx tsc --noEmit` (frontend)                                       | 0 errors                                                  |
| `npx eslint .` (frontend)                                           | 0 errors, 8 pre-existing warnings (none in touched files) |
| `npx vitest run` (admin-hours module, 5 files)                      | 67 passed                                                 |
| `npx vitest run` (adjacent: compliance-adminHours + member-profile) | 7 passed                                                  |

No backend files were modified this pass (only the pre-existing eager-load
fix from an unrelated commit landed in scope, reviewed above) — the backend
gate re-confirms nothing regressed, not that new backend code was checked.
Two frontend files modified (`AllEntriesTab.tsx`, `services/api.ts`) plus one
new guard test.
