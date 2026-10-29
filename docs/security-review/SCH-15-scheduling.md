# Security Review 15 — Scheduling

**Prefix:** `SCH` · **Iteration:** 15 · **Reviewed:** 2026-08-26 (pass 1),
2026-09-17 (pass 6), 2026-10-06 (pass 7), 2026-10-15 (pass 8), 2026-10-19
(pass 9), 2026-10-23 (pass 10), 2026-10-26 (pass 11), 2026-10-29 (pass 12) ·
**PR:**
[#1846](https://github.com/thegspiro/the-logbook/pull/1846) (pass 1),
[#2628](https://github.com/thegspiro/the-logbook/pull/2628) (pass 6),
[#2971](https://github.com/thegspiro/the-logbook/pull/2971) (pass 7, 0
fixed, SCH-10 confirmed fixed),
[#3291](https://github.com/thegspiro/the-logbook/pull/3291) (pass 8, 0
fixed, 1 new scope-boundary item),
[#3293](https://github.com/thegspiro/the-logbook/pull/3293) (pass 8
addendum, SCH-18 fixed, SCH-19 flagged),
[#3436](https://github.com/thegspiro/the-logbook/pull/3436) (pass 9, 0
fixed, 0 new findings, SCH-19 re-confirmed OPEN),
[#3617](https://github.com/thegspiro/the-logbook/pull/3617) (pass 10, 0
fixed, 1 new route, 0 new findings),
pass 11 (1 fixed — an unrelated alembic triple-fork, riding along — 0 new
findings),
pass 12 (0 fixed in Scheduling itself — EC-17, shared with Feature 14, closed
by a commit riding along in scope — 0 new findings)

**Backend:** `api/v1/endpoints/scheduling.py` (4,476 L, 108 routes, up from
107), `api/v1/endpoints/scheduling_module_config.py` (3 routes, unchanged),
`api/v1/endpoints/calcom_sync.py` (1 route, unchanged),
`services/scheduling_service.py` (11,172 L, up from 11,165 — pass 12's own
two commits, below),
`services/scheduling_module_config_service.py`,
`services/standing_shift_service.py` (unchanged logic, mypy-typed),
`services/call_tracking_service.py` (887 L, up from ~700),
`services/shift_eligibility_service.py` (1,491 L, up from ~1,200),
`services/shift_completion_service.py` (2,283 L, up from 2,238 — shared with
Feature 14, EC-17's fix, pass 12 below),
`services/integration_services/calcom_service.py` (zero diff since pass 6),
`services/scheduling_widget_service.py` (185 L — in this pass's declared
scope for the first time; a trivial mypy-narrowing diff, otherwise unchanged
from the dashboard-widgets endpoint pass 1 already reviewed),
`services/pre_shift_work_service.py` (714 L, **new this pass**),
`mcp/tools/scheduling.py`, `schemas/scheduling.py`,
`schemas/scheduling_module_config.py` (zero diff),
`models/call_tracking.py`, `models/scheduling_module_config.py`,
`utils/scheduling_dates.py` (zero diff)
**Frontend:** `modules/scheduling`, `pages/scheduling`
**Migrations:** `20260823_1400_e7a41b6d09c2_add_standing_shift_claims.py` (from
an earlier pass); `84819ea78a79` (pass 7 window, seeds `training.view_analytics`
on existing leadership positions); `20261006_0436_56c91e7d9e10` (pass 8
window, widens `shift_assignments.position` / `standing_shift_claims.position`
to VARCHAR — see Pass 8 below); `20261011_0030_46c55e6a3330` (pass 8 window,
adds `shift_pre_work_sessions`, out-of-declared-scope table, reviewed
opportunistically below)

---

## Pass 12 (2026-10-29) — near-zero delta (8 non-merge commits touch 2 of 18 declared backend files + 7 of the frontend's 54, out of 212 non-merge commits repo-wide since baseline), 0 new routes, 0 fixed in Scheduling itself, 0 new findings; EC-17 (shared file, owned by Feature 14) confirmed fixed

**Watchdog pickup.** No open PR's head branch starts with
`claude/security-review-` (`search_pull_requests`, 0 results, re-checked
immediately before this pass's push — see Completion gate). The dedicated
`/loop 30m /security-review` session remains unreachable. PR #3837 (Feature
14, Equipment check & shifts, pass 13) had already merged, and its own "next
feature" note named Feature 15 (Scheduling); the rotation table's own row 15
still reads `⬜` (rows 12-14 show the same lag after their own merges — the
table is updated the iteration _after_ a PR merges, per `PROGRESS.md`'s Step 0,
not by the PR that does the review).

### Scope

Baseline: `1157a464` (PR #3744's merge, pass 11), found by `git log --all
--grep` for the PR number.

**8 non-merge commits since `1157a464` touch the declared scope** (18 backend
files + `modules/scheduling`/`pages/scheduling`), out of **212** non-merge
commits repo-wide in the same window — confirmed by `git log --oneline
--no-merges 1157a464..HEAD` with and without the path filter, not estimated.
Real content changed (`git diff --stat`) in exactly **2 of the 18 backend
files**: `scheduling_service.py` (+43/−20 across two commits) and
`shift_completion_service.py` (+49/−1). **Zero diff**, confirmed not assumed,
in the other 16 backend files and in all four scope-boundary groups
(External Shift Hours quartet, `pre_shift_work_service.py`,
`shift_history_import_*` trio — SCH-15/SCH-17, re-checked again this pass).
16 of the frontend's 54 scheduling files under `modules/scheduling`/
`pages/scheduling` plus the top-level `pages/SchedulingPage.tsx` (which the
feature's own `routes.tsx` and `SchedulingPage.tsx` import chain makes this
feature's entry page, even though it sits outside the `pages/scheduling/`
subdirectory the header names) changed; the rest have zero diff.

Every non-merge commit touching declared scope read in full:

- **`f53f766a`** (shift reports: an edit to a reviewed report sends it back
  to review) — **this is EC-17's fix**, landing in the shared
  `shift_completion_service.py`. `update_report` now computes
  `content_changed` (any `UPDATABLE_FIELDS` entry other than `review_status`
  whose incoming value differs from the stored one) **before** the
  field-assignment loop overwrites `report`'s attributes, then — after that
  loop runs — calls `_return_edited_report_to_review`, which sends a
  `flagged` report back to `pending_review` unconditionally and an `approved`
  one back only when the org's `report_review_required` setting is on,
  clearing `reviewed_by`/`reviewed_at` (the reviewer vouched for the earlier
  text) while leaving the reviewer's notes (a flag's reason is what the
  revision answers). Read against the training-credit gate immediately
  below it: that gate fires `_trigger_deferred_progress` only when
  `report.review_status == "approved"` and the report was not already
  released, so a report `_return_edited_report_to_review` just demoted to
  `pending_review` cannot also credit training in the same call — the two
  code paths cannot both fire for the same edit, confirmed by reading the
  order of statements, not inferred from the docstring. No new by-id query,
  no new client-supplied FK, no new lock. 93 new/changed lines in
  `test_shift_completion.py`, confirmed (per the commit's own message and a
  direct read of the test names) run against the unfixed code first
  (Pitfall #37). This fully closes EC-17 — not merely narrows it the way
  pass 11's `e3306a678` did — confirmed by direct read of the unchanged
  field-write loop immediately above the new gate: every `UPDATABLE_FIELDS`
  entry is now covered, not only `review_status`. EC-17 is owned by Feature
  14's own findings file (`EC-14-equipment-check-shifts.md`), which already
  records it FIXED in its own pass 13 (2026-10-29, same day); not re-added
  as a Scheduling finding, per this file's standing practice for shared
  files (see pass 11's handling of `e3306a678`).
- **`0a7e2a9e`** (stop sending an email whose template is switched off) —
  `scheduling_service.py`'s notification-send path now calls
  `email_svc._render_unless_switched_off` instead of
  `_render_with_fallback` for the template-backed branch, and skips
  `send_email` entirely when it returns `None`. `_render_unless_switched_off`
  is `email_service.py`'s own pre-existing helper (already used at 15+ other
  call sites there, confirmed by `grep -c`), so this is Scheduling catching
  up to a convention the notification system already enforces elsewhere, not
  a new code path. The in-app notification/action-item write this branch
  guards is unconditional and unaffected — only the email send is skipped.
  No query, permission or org-scoping change.
- **`bdf73eba`** (cap three refusals whose list is joined in a helper) —
  Scheduling's one-line share of a three-file disclosure-hygiene sweep:
  the assignment-conflict refusal's joined list of conflicting shift dates
  now goes through `list_within_detail_limit` instead of a bare
  `', '.join(...)`, so a member with many conflicts gets "and N more"
  instead of risking `safe_error_detail`'s length cap turning the refusal
  into "An unexpected error occurred" — same class as prior passes' fixes
  to this file and others (SCH's own header already notes a prior instance),
  not a new exposure.
- **`4c2504ff`** (frontend: stop offering assignment to manage-only
  officers, and correct the exclusion card) — `OpenShiftsTab.tsx`'s and
  `ShiftDetailPanel.tsx`'s `canAssign` no longer falls back to `canManage`.
  Verified against the server, not taken on the commit message: `POST
/shifts/{shift_id}/assignments` (`create_assignment`) and the sibling
  PATCH/DELETE assignment endpoints gate through
  `_authorize_shift_management(service, current_user, shift_id,
"scheduling.assign")`, which allows only a `scheduling.assign` holder or
  the shift's own named officer (`_is_shift_officer`) — `scheduling.manage`
  alone satisfies neither, confirmed by reading `_authorize_shift_management`
  itself (`scheduling.py:248-268`). The frontend was offering a form the
  server would 403; this closes KNOWN_LIMITATIONS' "Settings That Do
  Nothing" items 5/6 (owner decision 2026-10-29) by removing the false
  affordance rather than widening the server. The two read-only surfaces the
  same `canAssign` used to gate (the check-in QR code, the declined/removed
  list) now read `canAssign || canManage` instead, correctly staying visible
  to manage-only officers since those are display, not write, paths. The
  `EligibilitySettingsCard.tsx` text change in the same commit only corrects
  copy ("admins can still assign manually" → "an officer cannot assign them
  either, except on a shift opened to all") to match server behavior
  already enforced (assignment runs the same eligibility check and already
  refused an excluded type) — no logic change.
- **`9af732d9`** (`alert-error` → `alert-danger` class rename across four
  scheduling pages) — a Tailwind utility rename, confirmed by reading
  `styles/index.css`: `alert-danger` is the current name for the same
  utility `alert-error` aliased; no behavior change.
- **`f2ea7ba5`** (stop the remaining pages jumping while they load — a
  repo-wide CLS sweep) — Scheduling's share is three loading-skeleton
  changes: `ShiftSettingsPanel.tsx`'s General tab holds its last four cards
  invisible (never `hidden` — still mounts and fetches) until the feature
  settings answer arrives; `SchedulingAdminLayout.tsx` gained a
  `navPending` prop so its nav waits the same way; `SchedulingPage.tsx`'s
  summary stat tiles now render `SkeletonText` placeholders instead of
  withholding the whole row until `summary` resolves, and drop the row only
  on a genuine fetch error (`summaryError`), not while loading. Purely
  layout timing — no data, query, or permission change; `invisible` content
  is inert to interaction the same way `hidden` is.
- **`7416ef51`** (officer-in-charge qualification clears the officer seats)
  — the backend change (`qualification_service.py`) is **outside
  Scheduling's declared scope** (it owns the qualification catalog, not a
  scheduling file) and is a pure data addition: one new `QUALIFICATIONS`
  entry (`officer_in_charge`, `positions: ["officer", "captain",
"lieutenant"]`), no new query or permission surface, consumed unchanged by
  this feature's own `positions_for_qualifications` (confirmed
  `shift_eligibility_service.py` has zero diff this pass). Reviewed
  opportunistically, as this file's standing practice does for scope-
  boundary touches. Its frontend share (`PositionRosterPage.tsx`,
  `types/index.ts`) removes the unused `'position'` (held-RBAC-office)
  eligibility-source display, matching a backend removal from an earlier,
  already-reviewed pass — a display cleanup, not new behavior.
- **`5ec1897d`** (members: class and status as two controls) — a Members-
  feature commit; its only touch inside Scheduling's declared scope is
  `EligibilitySettingsCard.tsx` (plus its test), which now also offers the
  department's own membership tiers as exclusion-list options (alongside the
  built-in membership types), reading them from `useMembershipTierOptions`
  (a Members-feature hook, out of this review's scope). Pure display
  widening of what can be _selected_ for exclusion; the actual exclusion
  enforcement is unchanged (still server-side, still re-checked by the
  assignment eligibility path this pass's `4c2504ff` entry above already
  re-confirmed). No new API call, no new by-id surface.

**Migrations:** none of the many migration files added in this window (99+,
cross-cutting member-status/positions/email-template/follow-up-form work)
touch a Scheduling-owned table — confirmed by grepping every new migration's
`upgrade()`/`downgrade()` for `shift`/`scheduling`/`standing_shift`/
`call_tracking`/`pre_work` and reading each hit: all are either the frozen
`NotificationType`/email-template-type enum snapshot (which happens to list
`shift_assignment`/`shift_reminder`/`shift_decline` as existing, unrelated
template names) or a `_BASELINE_PERMISSIONS` list seeding a new committee
position kind with the same member-level `scheduling.view`/`scheduling.swap`
grants every member already holds (Permissions & Roles' own scope, row 02,
already ✅) — not a new table, column, or grant level.

### Re-verified standing items

- **SCH-9, SCH-10, SCH-13, SCH-18 (fixed, unchanged)** — none of this pass's
  two changed files touch `_all_users_in_org`, `calcom_service.py` (zero
  diff), `finalize_shift`/`save_closeout_calls`'s lock ordering, or
  `attach_call_ids`/`detach_call_ids`'s length cap.
- **SCH-15, SCH-17 (scope-boundary, unchanged)** — the External Shift Hours
  quartet and the `pre_shift_work_service.py`/`shift_history_import_*` group
  all show **zero diff** this window (confirmed by `git diff --stat`, not
  assumed from the file list surviving six passes unexamined). Recommendation
  stands, now six passes running.
- **SCH-16 (LOW, accepted, self-documented TOCTOU, unchanged)** — the
  unlocked `slugs_named_by_requirements` check in
  `_reject_deleting_a_used_call_type` is in `scheduling.py`, which has zero
  diff this pass.
- **SCH-19 (LOW, flagged, re-confirmed OPEN)** — `schemas/scheduling.py` has
  zero diff this pass; `reported_call_types: Optional[dict[str, ...]]` and
  `member_call_counts: Optional[List[MemberCallCredit]]` still carry no
  dict/list-length cap, confirmed by direct read. Unchanged disposition;
  mirrored in `docs/KNOWN_LIMITATIONS.md`, not re-added here.
- **EC-17 (shared file, owned by Feature 14) — now FIXED**, not merely
  narrowed. See `f53f766a` above and `EC-14-equipment-check-shifts.md`'s own
  pass 13, which independently records the same fix from Feature 14's side.

### Route inventory

**0 new routes this pass**, confirmed by an AST walk of every
`@router.{get,post,put,patch,delete}` decorator across all three declared
endpoint files (not a diff or a grep sample): `scheduling.py` 108 (unchanged
from pass 11), `scheduling_module_config.py` 3 (unchanged), `calcom_sync.py`
1 (unchanged). Total 112 (unchanged). The same walk confirms every one of the
112 carries a recognized auth dependency
(`get_current_user`/`require_permission`/`get_optional_current_user`) in its
signature — 0 missing.

### Verified good ✅ (pass 12)

- `_authorize_shift_management`'s `scheduling.assign`-or-shift-officer gate
  on `create_assignment`/`update_assignment`/`delete_assignment` is unchanged
  this pass (`scheduling.py` zero diff) and now also matches the frontend's
  own gating, confirmed by reading both sides rather than trusting either's
  comment.
- No new by-id/org-scoped lookup, no new client-supplied FK, no new
  `.like()`/`.ilike()`, no new JSON-column shallow-copy mutation, no new
  `ondelete="SET NULL"` column, no new outbound HTTP call, in either of the
  two changed backend files or anywhere else in declared scope this pass.
- The one behavior change inside Scheduling's own files
  (`0a7e2a9e`'s switched-off-template skip, `bdf73eba`'s message cap) is
  pure consistency/hygiene, matching an existing cross-cutting convention;
  neither widens what an already-authorized, already-org-scoped caller
  could do.
- The shared-file change (`f53f766a`) closes a real gap in the feature's
  favor (EC-17) and was re-derived from this feature's own read of the code
  and tests, not taken on Feature 14's word.

### Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                         | Result                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (pinned 7.4.1)                                                                                                                                                                                                                                                                                                                                  | ✅ 0 violations                                   |
| `black --check app/ tests/ alembic/` (pinned 26.10.1 — note: `/root/.local/bin/black` on `PATH` resolves to an unpinned 26.5.1 uv-tool install; ran `/usr/local/bin/black` explicitly, which is the pinned one)                                                                                                                                                               | ✅ clean (2,738 files unchanged)                  |
| `isort --check-only app/ tests/ alembic/` (pinned 9.0.2)                                                                                                                                                                                                                                                                                                                      | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                             | ✅ single head `e8a3f5c1b7d2`, 677 revisions      |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                         | ✅ 280 routes, 0 errors, 0 warnings               |
| `python3 scripts/generate_schema_docs.py --check`                                                                                                                                                                                                                                                                                                                             | ✅ up to date                                     |
| `pytest tests/ -q -k "scheduling or shift or swap or calcom or position_slots or call_tracking or call_type or pre_shift or pre_work or custom_crew or open_swap or xc1_scheduling or mcp_tools or member_shift_release or member_hard_delete or attribution_set_null or sunday_week_start or request_numeric_bounds or delete_reference_guards or scheduling_delete_in_use"` | ✅ 2812 passed, 1 pre-existing skip (`pywebpush`) |
| Tenancy/security guard tests (`test_like_escaping`, `test_capacity_locking`, `test_csv_writer_sweep`, `test_org_scoping_ratchet`, `test_account_status_gates`, `test_request_numeric_bounds`, `test_migration_create_all_tables`)                                                                                                                                             | ✅ 713 passed                                     |
| `npm run typecheck`                                                                                                                                                                                                                                                                                                                                                           | ✅ clean                                          |
| `npm run lint`                                                                                                                                                                                                                                                                                                                                                                | ✅ clean (`--max-warnings 10`, 0 warnings)        |
| `npx vitest run src/modules/scheduling src/pages/scheduling`                                                                                                                                                                                                                                                                                                                  | ✅ 1051 passed (71 files)                         |

No fix was needed in Scheduling's own code this pass — the one real gap
touched (EC-17) was already fixed, in a file this feature shares rather than
owns. Rotation row 15 → ✅ (pending this PR's merge). Next: Feature 16
(Events & requests).

## Pass 11 (2026-10-26) — real delta (15 non-merge commits, real diff in 5 of 18 declared files), 0 new routes, 0 fixes needed in Scheduling itself, 0 new findings; an unrelated alembic triple-fork found, independently fixed twice by concurrent sessions, resolved by merging in the one that landed first (#3742)

**Watchdog pickup.** No open PR's head branch starts with
`claude/security-review-` (`search_pull_requests`, 0 results, re-checked
immediately before this pass's push — see Completion gate). The dedicated
review-rotation session was unreachable. PR #3741 (Feature 14, Equipment
check & shifts, pass 12) had already merged. Rotation row 15 (Scheduling)
was confirmed the next `⬜` by reading the rotation table directly.

### Scope

Baseline: `6d3cd946f` (PR #3617's merge, pass 10, 2026-10-23 17:20 -04:00),
found by `git log --all --grep` for the PR number rather than trusting a
cited SHA.

**15 non-merge commits since `6d3cd946f` touch the 18 declared backend
files** (13 from the header above, plus the four External Shift Hours files
and the three `shift_history_import_*`/`pre_shift_work_service.py` files
swept opportunistically every pass since SCH-15/SCH-17 — see "Scope-boundary
items" below): `885cc14cd`, `609e04d21`, `4de87b568`, `79cd3aeb0`,
`33264d729`, `e3306a678`, `3fef56cfc`, `b2f246ddc`, `5b2bb3dbc`, `100e849c0`,
`dd4ba98a4`, `2833290db`, `b7e52361a`, `4cac9ff29`, plus the merge commits
that carried them to `main`. Real content changed (`git diff --stat`) in 5
of the 13 primary files: `scheduling.py` (+242/-?), `schemas/scheduling.py`
(+82/-?), `scheduling_service.py` (+912/-?), `shift_completion_service.py`
(+120/-?), `shift_eligibility_service.py` (+40/-?) — 1,129 insertions / 267
deletions combined, confirmed by `git diff --stat 6d3cd946f HEAD`. **Zero
diff**, confirmed not assumed, in the other 8 of the 13
(`scheduling_module_config.py`, `calcom_sync.py`,
`scheduling_module_config_service.py`, `standing_shift_service.py`,
`call_tracking_service.py`, `calcom_service.py`,
`scheduling_widget_service.py`, `pre_shift_work_service.py` itself,
`mcp/tools/scheduling.py`, `schemas/scheduling_module_config.py`,
`models/call_tracking.py`, `models/scheduling_module_config.py`,
`utils/scheduling_dates.py` — more than 8 named because several of the 13
header entries are themselves unchanged; verified individually).

Every non-merge commit touching a declared file read in full:

- **`885cc14cd`** (stop shift patterns generating from a deactivated
  template) — adds `inactive_templates_by_pattern()`
  (`scheduling_service.py`), which filters
  `ShiftTemplate.organization_id == str(organization_id)` explicitly; the
  list/create/get/update pattern endpoints now flag held patterns, and
  manual generation returns 409 rather than silently skipping. Org-scoped
  throughout; no new by-id surface.
- **`609e04d21`** (99 columns made `NOT NULL`, cross-cutting) —
  Scheduling's share is two call sites of `reject_null_for_required` in
  `scheduling_service.py`'s `_crud_update` and
  `shift_completion_service.py`'s `update_report`, both refusing an explicit
  `null` against a required column before it reaches the database (Pitfall
  #1's clear-vs-omit rule, applied correctly). The migration itself
  (`6dce1364ff7e`) is cross-cutting (36 tables, not scheduling-specific);
  it guards the `create_all`-only-table case (Pitfall #26) and is covered
  by its own `test_live_schema_drift.py`/`test_explicit_null_writes.py`,
  outside this feature's scope to re-derive.
- **`4de87b568`** (lock attendance and calls on finalized/cancelled
  shifts) — `add_attendance` now takes `for_update=True` on the shift row
  before a locking duplicate-check read
  (`select(ShiftAttendance.id)...with_for_update()`), matching
  `member_check_in`'s lock order (Pitfall #27); `update_attendance`,
  `remove_attendance`, `create_shift_call`/`update_shift_call` all refuse on
  a finalized shift through two new shared predicates
  (`_attendance_locked_error`/`_call_locked_error`); `finalize_shift` and
  `member_check_in` both refuse a cancelled shift. All eleven new tests in
  `test_shift_record_locks.py` were run against the unfixed code and seen to
  fail first (Pitfall #37). A real capacity/race hardening, closing gaps the
  rotation had not previously flagged as a missing lock — not a regression,
  and not introduced by anything open in this file; applied correctly.
- **`79cd3aeb0`** (hold every seat-placing path to the full candidate
  check) — `update_assignment` now runs `_validate_assignment_edit` (the
  same eligibility/named-seat-cap/leave/time-off/overlap check
  `create_assignment` already ran) under the shift row lock before a seat
  change or reviving a declined/cancelled row; `_validate_assignment_candidate`
  now checks seat eligibility on a shift with no named seats too, closing a
  path where a firefighter could be seated as officer through an offer,
  pickup, or officer-assignment edit rather than only through signup;
  `confirm_assignment`/`create_swap_request` gained corresponding state
  checks. `member_seated_shift_ids` (new) filters
  `ShiftAssignment.organization_id == str(organization_id)` and
  `.user_id == str(user_id)` explicitly — self-scoped, not a new by-id
  surface. New seat-name length caps (`SeatListInput`/
  `TemplatePositionsInput`, via `AfterValidator`) apply the existing
  100-character `SeatToken` limit to `positions` on `ShiftCreate`/`Update`,
  `ShiftTemplateCreate`/`Update` and `BasicApparatusCreate`/`Update` — the
  same class of fix as SCH-18, applied to a sibling field, not something
  this pass needed to add. 25 new tests run against `origin/main` and seen
  to fail first, then pass (Pitfall #37). This is a security-relevant
  hardening pass by the feature's own developers; re-reading it line by
  line found every org-scoping and candidate-check invariant intact and
  several gaps genuinely closed, not loosened.
- **`33264d729`** (report the numbers the backend already decided) — nine
  data-correctness fixes (settings round-trip, call counts by tracking mode,
  coverage report headcount order, scheduled-hours filtering, a leap-day
  clamp, pre-shift hours in history-import recompute, re-import not
  recreating a rejected entry, a 0-minute external-hours refusal). The one
  new query, `_shift_call_counts`, is reached only through already
  org-scoped shift rows (`shifts` passed in are already the caller's own,
  per `_enrich_shifts`'s and `get_shift`'s existing org filter) and itself
  filters `OrgCallResponse.organization_id`/joins `ShiftCall.shift_id` off
  those same ids — no new by-id or cross-tenant surface. Every new test run
  against the unfixed code first (Pitfall #37).
- **`e3306a678`** (shift reports: status moves only through review) —
  closes the exact gap Equipment & Shifts' pass 12 (EC-17) named as still
  open after its own hardening: a filing officer could previously PUT any
  `review_status`, including re-approving their own report and re-running
  its sign-offs. `update_report` now refuses any `review_status` change
  from a non-draft report outright (the department's
  `report_review_required` setting decides submission's destination, not
  the client), and `_create_skill_checkoffs` is keyed per-report
  (`SHIFT_REPORT_CHECKOFF_KEY`) so a second approval of the same report
  cannot record a duplicate sign-off or re-promote competency. **This
  narrows, but does not close, EC-17**: EC-17's own finding is that every
  _other_ `UPDATABLE_FIELDS` entry (`performance_rating`,
  `officer_narrative`, `skills_observed`, …) stays writable by the filing
  officer on an already-approved report with no re-review trigger — this
  commit's docstring claim ("drafts only") is still only true for the
  status field, confirmed by direct read: the field-level write loop
  (`for key, value in updates.items(): if key not in self.PROTECTED_FIELDS`)
  is unchanged below the new status gate. EC-17 stays OPEN, in
  `EC-14-equipment-check-shifts.md` and `docs/KNOWN_LIMITATIONS.md`, not
  re-added here since the file is shared, not owned, by this feature.
- **`3fef56cfc`** (reactivate templates, pause patterns, fix pattern
  generation) — `ShiftTemplateUpdate`/`ShiftPatternUpdate` gain `is_active`;
  generated seats now go through `_seat_generated_member`, which calls the
  same `_validate_assignment_candidate` an officer's assignment does, rather
  than writing `ShiftAssignment` rows directly — this closes a real gap
  (generation previously bypassed the candidate check entirely) in the
  feature's own favor, not a new one. The duplicate-guard query gained
  `.where(Shift.template_id == str(template.id))`, still inside the
  existing `organization_id` filter. 16 of 17 new tests run against the
  unfixed code and seen to fail (the 17th pins existing behavior) — Pitfall
  #37.
- **`b2f246ddc`** (clamp a custom annual window's 29 February) — pure date
  arithmetic fix (`_clamped()` helper), no query or permission change; three
  new tests seen to fail against the unclamped code first.
- **`5b2bb3dbc`** (open an unseated open-to-all shift to everyone; widen
  the trade picker) — `_current_member_entries` (new) filters
  `User.organization_id == str(organization_id)` explicitly, and is used
  only to widen an open-to-all shift's eligible pool, not to bypass it.
  Four new tests seen to fail first.
- **`100e849c0`** (mypy type-annotation widening only, no behavior change),
  **`dd4ba98a4`** (adds `ge=.../le=INT32_MAX` bounds to
  `reported_call_types`'s dict _values_ and `call_type_usage` — narrows
  accepted input, does not touch SCH-19's missing dict/list-length cap),
  **`2833290db`** (day/night pattern template fix — each side now builds
  from its own already org-scoped `get_template_by_id` lookup, unchanged
  scoping), **`b7e52361a`** (moves `basic_apparatus_in_use`'s logic into a
  shared `apparatus_ref.apparatus_in_use` used by both the full- and
  basic-apparatus deletes — same org-scoped queries, refactored not
  rewritten), **`4cac9ff29`** (wraps two call-type-deletion refusal
  messages in `list_within_detail_limit` so a long list still passes
  `safe_error_detail`'s length cap — a disclosure-hygiene fix, not a new
  exposure) — all read in full, none touch org-scoping, locking, or
  candidate-check invariants.

**Frontend:** 54 files under `modules/scheduling/`/`pages/scheduling/`
changed since `6d3cd946f` (`git log --name-only`, deduplicated), swept
individually (not sampled) for `window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, banned `.toLocale*`, and raw `date-fns`
imports — zero hits across all 54, confirmed by a direct per-file grep.
`routes.tsx`'s diff is purely wrapping seven existing admin routes in a new
shared `SchedulingAdminLayout`, inside the same `ProtectedRoute` each
already carried (same `requiredModule`/`requiredPermission` on every one,
confirmed by direct diff) — no new route, no new permission surface.

**Scope-boundary items re-checked, still out of scope:** the External
Shift Hours quartet (SCH-15) and the `pre_shift_work_service.py` /
`shift_history_import_*` group (SCH-17) both show diff this window —
`external_shift_hours_service.py` (+20/-6, the 0-minute-rounding refusal
from `33264d729`) and `shift_history_import_service.py` (+29/-13, the
rejected-entry and pre-shift-hours fixes, also from `33264d729`) — both
already read above as part of that commit, both pure data-correctness, no
new by-id/FK/lock surface. `pre_shift_work_service.py` itself and the three
External Shift Hours files besides the service have zero diff. The
standing recommendation (formally add these groups to Scheduling's declared
scope, or confirm they belong elsewhere) is unchanged and not repeated in
full — five passes in a row have now found real, review-worthy surface in
this position.

### Re-verified standing items

- **SCH-9, SCH-10, SCH-13 (fixed, unchanged)** — none of this pass's
  file-level changes touch `_all_users_in_org`, `calcom_service.py` (zero
  diff), or `finalize_shift`/`save_closeout_calls`'s lock ordering (the only
  `finalize_shift`-adjacent change this pass is the new cancelled-shift
  refusal in `4de87b568`, confirmed additive by direct read).
- **SCH-15, SCH-17 (scope-boundary, unchanged)** — see above; recommendation
  stands, widened by one more pass.
- **SCH-16 (LOW, accepted, self-documented TOCTOU, unchanged)** — the
  unlocked `slugs_named_by_requirements` check in
  `_reject_deleting_a_used_call_type` is outside this pass's `scheduling.py`
  diff apart from `4cac9ff29`'s message-wrapping (confirmed by direct read:
  the lock ordering and the unlocked second check are both unchanged).
- **SCH-18 (fixed, unchanged)** — `attach_call_ids`/`detach_call_ids` still
  carry `max_length=200`; not touched this pass.
- **SCH-19 (LOW, flagged, re-confirmed OPEN).**
  `reported_call_types: Optional[dict[str, ...]]` and
  `member_call_counts: Optional[List[MemberCallCredit]]` still carry no
  dict/list-length cap — confirmed by direct read after `dd4ba98a4`, which
  bounds the dict's integer _values_ (`ge=0, le=INT32_MAX`) but not its key
  count, and does not touch `member_call_counts` at all. Unchanged
  disposition: needs an owner-picked ceiling (already mirrored in
  `docs/KNOWN_LIMITATIONS.md`'s Scheduling Module table); not re-added.

### Ride-along fix (not a Scheduling finding): a three-way alembic merge collision

`backend/scripts/validate_migrations.py --strict` (part of this pass's own
completion gate, run before any scheduling-specific check) failed with
**3 head revisions**: `5510d5ff49eb`, `2382ef7e55c3`, `9ab7b4276c22`. All
three are themselves merge revisions resolving the _same_ pair of parents
(`0a8d11fcada1`, `b7e4c2a91d35`) — three different sessions each opened
their own join of the same fork within a few hours of each other
(`afff97c41`, a port in `3fa79a736`, and a third direct sibling), and each
merged clean on GitHub because the chain-fork check runs per-PR against
whatever was on `main` at that PR's open time, not against sibling PRs
doing the same join concurrently. The result was a new, three-way fork
instead of the one it was meant to close.

This is unrelated to Scheduling (none of the three colliding branches
touch any Scheduling file), but `alembic upgrade head` fails on it exactly
as it would on a Scheduling-caused fork, and CLAUDE.md's "no acceptable
pre-existing errors" rule applies regardless of which feature's rotation
pass happens to be the one that runs the gate and finds it. This PR
originally carried its own pure-join merge revision for the three heads
(`f6a0362deaaa`). Before it could land, a separate concurrent watchdog
session opened and merged
[#3742](https://github.com/thegspiro/the-logbook/pull/3742) — a different
join of the same three parents (`1ad0b594f3fb`) — which reached `main`
first. Landing both would have re-forked the exact pair (two sibling merge
revisions over the same three down_revisions), so this PR's own
`f6a0362deaaa` file was dropped and this branch merged with `main` to pick
up #3742's fix, rather than re-fixing what was already fixed. Verified
with `alembic current` / `alembic upgrade head` against this sandbox's own
database (not just the static parser): a clean chain to a single head,
`1ad0b594f3fb`, with no schema error. `validate_migrations.py --strict`
now reports a single head.

This also explains why the targeted pytest run initially failed one
test (`test_data_export.py::test_shift_reports_respect_trainee_visibility`)
with a MySQL 1406 "Data too long for column 'phone'": this sandbox's
long-lived database predates the `5510d5ff49eb` contact-encryption
migration (which widens `users.phone` to `TEXT`) and `create_all` never
widens an existing column (documented in `tests/conftest.py`'s own
docstring). Applying the now-unforked migration chain
(`alembic upgrade head`) brought the column in line and the test passes
unmodified — not a scheduling defect, and not a test to touch.

### Route inventory

**0 new routes this pass**, confirmed by an AST walk (every
`@router.{get,post,put,patch,delete}` decorator across all three declared
endpoint files, not a grep sample): `scheduling.py` 108 (unchanged from pass
10), `scheduling_module_config.py` 3 (unchanged), `calcom_sync.py` 1
(unchanged). Total 112 (unchanged). The same AST walk confirms every one of
the 112 carries `Depends(...)` in its signature. `routes.tsx`'s only change
(wrapping seven admin pages in a shared layout, see above) adds no route.

### Verified good ✅ (pass 11)

- Every by-id/org-scoped lookup touched or added this pass
  (`inactive_templates_by_pattern`, the attendance/call lock helpers'
  `get_shift_by_id` calls, `member_seated_shift_ids`, `_current_member_entries`,
  `_shift_call_counts`, `_seat_generated_member`'s candidate check) filters
  `organization_id` explicitly — enumerated above, not sampled.
- No new client-supplied FK accepted and stored without an in-org check, no
  new `.like()`/`.ilike()`, no new JSON-column shallow-copy mutation, no new
  outbound HTTP call, no new `ondelete="SET NULL"` column in this feature's
  tables this pass.
- Every behavior change this pass either hardens an existing gap in the
  feature's favor (full candidate check on edits and on generated seats,
  locked attendance/calls on finalized/cancelled shifts, seat-name length
  caps, report status locked to review) or is pure data-correctness (call
  counts, coverage headcount, leap-day clamp, settings round-trip,
  history-import recompute) — none widens what an already-authorized,
  already-org-scoped caller could do.
- EC-17 (Equipment & Shifts' own open finding, re-verified from this
  feature's side since `shift_completion_service.py` is shared) is narrowed
  by `e3306a678` but not closed — confirmed by direct read, not re-added
  here since it is owned by Feature 14's findings file.

### Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                         | Result                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (pinned 7.4.1)                                                                                                                                                                                                                                                                                                                                  | ✅ 0 violations                                                                                         |
| `black --check app/ tests/ alembic/` (pinned 26.10.1)                                                                                                                                                                                                                                                                                                                         | ✅ clean (2,676 files unchanged)                                                                        |
| `isort --check-only app/ tests/ alembic/` (pinned 9.0.2)                                                                                                                                                                                                                                                                                                                      | ✅ clean                                                                                                |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                             | ✅ single head `1ad0b594f3fb` (fixed by #3742, merged first; this branch merged onto it), 658 revisions |
| `alembic current` / `alembic upgrade head` (against this sandbox's own database, not just the static parser)                                                                                                                                                                                                                                                                  | ✅ clean chain, single head reached, no schema error                                                    |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                         | ✅ 279 routes, 0 errors, 0 warnings                                                                     |
| `python3 scripts/generate_schema_docs.py --check`                                                                                                                                                                                                                                                                                                                             | ✅ up to date                                                                                           |
| `pytest tests/ -q -k "scheduling or shift or swap or calcom or position_slots or call_tracking or call_type or pre_shift or pre_work or custom_crew or open_swap or xc1_scheduling or mcp_tools or member_shift_release or member_hard_delete or attribution_set_null or sunday_week_start or request_numeric_bounds or delete_reference_guards or scheduling_delete_in_use"` | ✅ 2784 passed, 1 pre-existing skip (`pywebpush`) — 1 failure before the alembic fix, 0 after           |
| Tenancy/security guard tests (`test_like_escaping`, `test_capacity_locking`, `test_csv_writer_sweep`, `test_org_scoping_ratchet`, `test_account_status_gates`, `test_request_numeric_bounds`, `test_migration_create_all_tables`)                                                                                                                                             | ✅ 712 passed                                                                                           |
| `npm run typecheck`                                                                                                                                                                                                                                                                                                                                                           | ✅ clean                                                                                                |
| `npm run lint`                                                                                                                                                                                                                                                                                                                                                                | ✅ clean (`--max-warnings 10`)                                                                          |
| `npx vitest run src/modules/scheduling src/pages/scheduling`                                                                                                                                                                                                                                                                                                                  | ✅ 1044 passed (71 files)                                                                               |

Rotation row 15 → ✅ (pending this PR's merge). Next: Feature 16 (Events &
requests).

## Pass 10 (2026-10-23) — real delta (8 non-merge commits, real diff in 5 of 13 declared files), 1 new route, 0 fixes needed, 0 new findings; all standing items re-confirmed

**Watchdog pickup.** No open PR's head branch starts with
`claude/security-review-` (`search_pull_requests`, 0 results). PR #3602
(Feature 14, Equipment check & shifts, pass 11) had already merged,
and is reflected on `main` as the prior **Open PR** entry. Rotation row 15
(Scheduling) was confirmed the next `⬜` by reading the rotation table
directly.

### Scope

Baseline: `764c733e` (PR #3436's merge, pass 9, 2026-10-19 07:24 -04:00),
found by `git log --all --grep` for the PR number rather than trusting a
cited SHA.

**8 non-merge commits since `764c733e` touch the 13 declared backend files**
(`git log` scoped to those exact paths): `294d5a74`, `78a6a57e`,
`8c504336`, `92505187`, `99b904c2`, `c9c35f85`, `381e6a5e`, `74638250`.
Real content changed (`git diff --stat`) in 5 of the 13: `scheduling.py`
(+84/-10), `scheduling_service.py` (+213/-16), `schemas/scheduling.py`
(+61/-30), `shift_completion_service.py` (+32/-25), `mcp/tools/scheduling.py`
(+19/-22, net smaller — see `c9c35f85` below). **Zero diff**, confirmed not
assumed, in the other 8, including `pre_shift_work_service.py` and
`calcom_service.py`.

Every commit read in full:

- **`381e6a5e`** (weeks start on Sunday) — adds `sunday_week_start()`
  (`scheduling_service.py`) and uses it for "shifts this week", the week
  calendar's default range (`scheduling.py:get_week_calendar`), and the
  call-volume report's weekly buckets, replacing three ad-hoc
  `today - timedelta(days=today.weekday())` computations that disagreed
  with the shift board (Sunday-drawn) every Sunday. Pure date-boundary
  correctness fix: the org-scoping `scope`/`where` clauses around each query
  are unchanged, confirmed by direct read of the diff context.
- **`c9c35f85`** (MCP `list_open_shifts` stops listing ended shifts) —
  moves the open-shift candidate WHERE clauses (previously duplicated in
  `mcp/tools/scheduling.py`) into a new
  `SchedulingService.open_shift_candidate_criteria()`, which both
  `_open_shift_candidates` and the MCP tool now select through. The new
  method takes `organization_id` as a parameter and filters
  `Shift.organization_id == str(organization_id)` first in its returned
  criteria list (confirmed by direct read); the MCP call site still sources
  that id from `org_uuid(principal)`, never the client, and the tool's
  `open_to_all_members` restriction and permission gate are untouched. One
  definition replaces two, and the one behavior change (a shift that has
  already ended is no longer offered as an open gap) narrows what both
  callers can return — not a tenancy or authz change.
- **`99b904c2`** (UTC datetime schema annotations) — adds `UTCDateTime` to
  `ShiftCreate`/`ShiftUpdate.start_time`/`end_time`,
  `ShiftAttendanceCreate/Update.checked_in_at`/`checked_out_at`,
  `ShiftCallCreate/Update.dispatched_at`/`on_scene_at`/`cleared_at` so a
  naive datetime is read as the already-UTC instant it is, rather than
  being stored by wall-clock (pymysql has no DATETIME offset to carry). A
  parsing/validation fix only — no query, permission or org-scoping code
  touched.
- **`92505187`** (reject deletes that would lose data) —
  `delete_shift` now refuses (400) a shift whose `start_time` has already
  passed (deleting cascades attendance/calls/swaps); `delete_shift_call` now
  refuses removing a call from a finalized shift. Both resolve their target
  through the existing org-scoped `get_shift_by_id`/`get_shift_call_by_id`
  (unchanged), so the new checks only narrow what a caller who already
  passes org scoping can do — no new by-id surface.
- **`8c504336`** (deactivate in-use templates/apparatus instead of deleting)
  — `delete_template`/`delete_basic_apparatus` (`scheduling.py`, both still
  gated `require_permission("scheduling.manage")`) now call
  `SchedulingService.remove_template`/`remove_basic_apparatus`, which
  check `template_in_use`/`basic_apparatus_in_use` — every query in both
  helpers filters `organization_id == organization_id` explicitly
  (`Shift`, `ShiftPattern`, `ShiftTemplate`, `ShiftPreWorkSession`,
  `ShiftEquipmentCheck`, `OrgCallResponse`, confirmed by direct read of
  each `select()`) — and deactivate (`is_active = False`) instead of
  deleting when a reference exists, else delete as before. `DELETE` still
  returns 204; an `X-Delete-Outcome` response header says which happened.
  No new by-id or client-FK surface; the in-use check reads only rows
  already scoped to the caller's own org.
- **`294d5a74`** (reactivate action) — adds
  `POST /scheduling/apparatus/{id}/reactivate`
  (`require_permission("scheduling.manage")`, lookup filters
  `BasicApparatus.organization_id == str(current_user.organization_id)`,
  audited as `basic_apparatus_reactivated`). The **one new route this
  pass** — see Route inventory below.
- **`78a6a57e`** (keep other members' records on permanent delete; release
  future shifts) — this feature's share is `shift_completion_service.py`:
  `officer_id` threads as `Optional[str]` through
  `_create_skill_checkoffs`/`_update_member_competency`/
  `_trigger_deferred_progress`/`approve_shift_report`, so a report whose
  filing officer's account was later hard-deleted still releases the
  trainee's credit with no evaluator attribution, instead of raising on
  `UUID(None)`. This is the frontend/backend pairing for
  `shift_completion_reports.officer_id` moving to
  `nullable=True`/`ondelete="SET NULL"` via migration `cbe0de50f202` — the
  model/migration side is shared with, and was already reviewed by, Feature
  14's pass 11 (`EC-14-equipment-check-shifts.md`); re-confirmed here as the
  correct Pitfall #2 pairing by direct read of both the model and the
  migration, which guards a missing table/column for the `create_all` path
  (Pitfall #26) and is idempotent. Not in this feature's declared file
  list but reviewed opportunistically for the same reason SCH-17 names:
  `backend/app/services/member_shift_release_service.py` (new, 149 L) —
  called from the users-module delete/deactivate/status-change paths to end
  a member's standing claims and release their seats on shifts that have
  not started. Every query filters `organization_id` explicitly
  (`StandingShiftClaim`, `ShiftAssignment` joined to `Shift`), takes a
  locking read on the claim rows before ending them (Pitfall #27: the shift
  generator seats from active claims, so a release must not race a
  generation), and delegates seat removal to the already-reviewed,
  org-scoped `SchedulingService.delete_assignment`. Clean; owned by Users
  (Feature 07), not re-scoped into this feature's declared file list.
- **`74638250`** (repo-wide numeric-bounds sweep) — adds
  `ge=INT32_MIN, le=INT32_MAX` / `ge=-FLOAT32_MAX, le=FLOAT32_MAX` to
  `min_staffing`, `duration_minutes`, `duration_hours`, `rotation_days`,
  `days_on`, `days_off` across `ShiftCreate/Update`,
  `ShiftAttendanceUpdate`, `ShiftTemplateCreate/Update`,
  `ShiftPatternCreate/Update`. Purely additive — narrows accepted input to
  the column's own range, closing a class of "value overflows MySQL's
  column and surfaces as a generic 500" reports rather than opening
  anything. Does not touch `reported_call_types`/`member_call_counts`
  (SCH-19, see below).

**Frontend:** 50 files under `modules/scheduling/`/`pages/scheduling/`
changed since `764c733e` (`git log --name-only`, deduplicated), swept
individually (not sampled) for `window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, banned `.toLocale*`, and raw `date-fns`
imports — zero hits across all 50, confirmed by a direct per-file grep.
The one route-adjacent change, `routes.tsx`, is a comment-only edit (no
`<Route>` added or removed), confirmed by direct diff read.

**Scope-boundary items re-checked, still out of scope:** the External
Shift Hours quartet (SCH-15) and the `pre_shift_work_service.py` /
`shift_history_import_*` group (SCH-17) both have **zero diff** since
`764c733e` (`git diff --stat`), so the standing recommendation to add them
to this feature's declared scope, or confirm they belong elsewhere, is
unchanged and not repeated in full here.

### Re-verified standing items

- **SCH-9, SCH-10, SCH-13 (fixed, unchanged)** — none of the files
  carrying these sit in this pass's 5-file delta in a way that touches the
  guarded code paths; `_all_users_in_org`, the `calcom_service.py`
  SSRF-safe transport (zero diff), and `finalize_shift`/
  `save_closeout_calls`'s row-locking order are all outside the diffs read
  above.
- **SCH-15, SCH-17 (scope-boundary, unchanged)** — zero diff this window
  in both groups (confirmed above); recommendation stands.
- **SCH-16 (LOW, accepted, self-documented TOCTOU, unchanged)** — the
  unlocked `slugs_named_by_requirements` check in
  `_reject_deleting_a_used_call_type` (`scheduling.py:4079` area) is
  outside this pass's `scheduling.py` diff (confirmed by `git diff`
  showing only `delete_template`/`delete_basic_apparatus`/the new
  reactivate route changed in that file), so the gap is unchanged.
- **SCH-18 (fixed, unchanged)** — `attach_call_ids`/`detach_call_ids`
  still carry `max_length=200` (`schemas/scheduling.py` lines ~296/441/445);
  not touched by `74638250`'s bounds sweep (which added numeric `ge`/`le`,
  not string length, to different fields) or any other commit this pass.
- **SCH-19 (LOW, flagged, re-confirmed OPEN).**
  `reported_call_types: Optional[dict[str, int]]` and
  `member_call_counts: Optional[List[MemberCallCredit]]`
  (`schemas/scheduling.py` lines 288/290/437/506) still carry no
  length/size cap — confirmed by direct read; `74638250`'s numeric-bounds
  sweep bounds scalar fields on the same schemas but does not touch these
  two. Unchanged disposition: needs an owner-picked ceiling, already
  mirrored in `docs/KNOWN_LIMITATIONS.md`'s Scheduling Module table; not
  re-added.

### Route inventory

**1 new route this pass**, confirmed by `grep -c "@router\."` against each
declared endpoint file: `scheduling.py` 108 (up from 107),
`scheduling_module_config.py` 3 (unchanged), `calcom_sync.py` 1
(unchanged). Total 112 (up from 111).

| Method | Path                                              | Auth dependency                    | Permission          | Org-scoped                                                                                | Notes                                                                          |
| ------ | ------------------------------------------------- | ---------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| POST   | `/scheduling/apparatus/{apparatus_id}/reactivate` | `Depends(require_permission(...))` | `scheduling.manage` | Yes — `BasicApparatus.organization_id == str(current_user.organization_id)` in the lookup | Audited (`basic_apparatus_reactivated`); no-op and unaudited if already active |

The other 111 routes carry no signature change this pass (confirmed by
`git diff` showing the only `scheduling.py` changes are inside
`delete_template`/`delete_basic_apparatus`'s bodies and the new route
above); their auth/permission gates carry over pass 9's 111/111
verification unchanged. A repo-wide AST walk of all three declared
endpoint files (every `@router.{get,post,put,patch,delete}` decorator,
not a sample) confirms all 112 routes have a `Depends(...)` present in
their signature; `check_route_permissions.py --strict` is the
permission-string-specific check (see Completion gate).

### Verified good ✅ (pass 10)

- Every by-id/in-use lookup added or touched this pass
  (`template_in_use`, `basic_apparatus_in_use`, `remove_template`,
  `remove_basic_apparatus`, `open_shift_candidate_criteria`, the
  reactivate route's `BasicApparatus` lookup) filters `organization_id`
  explicitly — enumerated above, not sampled.
- No new client-supplied FK accepted and stored, no new `.like()`/
  `.ilike()`, no new JSON-column shallow-copy mutation, no new outbound
  HTTP call.
- The one new `ondelete="SET NULL"` pairing this window
  (`shift_completion_reports.officer_id`, migration `cbe0de50f202`) is
  `nullable=True` on both the model and the live schema, and the migration
  guards the `create_all`-only-table case (Pitfall #26) — already verified
  by Feature 14's pass 11, re-confirmed here by direct read since the
  service-layer threading lives in this feature's own declared scope.
  `member_shift_release_service.py` (adjacent, Users-owned) locks the
  claim rows it reads before ending them (Pitfall #27) and delegates seat
  removal to an already-org-scoped method.
- Every one of this pass's behavior changes (reject-on-started-shift,
  reject-on-finalized-call-removal, deactivate-instead-of-delete,
  stop-listing-ended-open-shifts, Sunday week boundary) narrows or leaves
  unchanged what an already-authorized, already-org-scoped caller could do
  — none widens the surface.

### Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                         | Result                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (pinned 7.3.0)                                                                                                                                                                                                                                                                                                                                  | ✅ 0 violations                                   |
| `black --check app/ tests/ alembic/` (pinned 26.5.1)                                                                                                                                                                                                                                                                                                                          | ✅ clean                                          |
| `isort --check-only app/ tests/ alembic/` (pinned 9.0.1)                                                                                                                                                                                                                                                                                                                      | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                             | ✅ single head `4250eb8b8378`, 643 revisions      |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                         | ✅ 273 routes, 0 errors, 0 warnings               |
| `pytest tests/ -q -k "scheduling or shift or swap or calcom or position_slots or call_tracking or call_type or pre_shift or pre_work or custom_crew or open_swap or xc1_scheduling or mcp_tools or member_shift_release or member_hard_delete or attribution_set_null or sunday_week_start or request_numeric_bounds or delete_reference_guards or scheduling_delete_in_use"` | ✅ 2567 passed, 1 pre-existing skip (`pywebpush`) |
| Tenancy/security guard tests (`test_like_escaping`, `test_capacity_locking`, `test_csv_writer_sweep`, `test_org_scoping_ratchet`, `test_account_status_gates`, `test_request_numeric_bounds`, `test_migration_create_all_tables`)                                                                                                                                             | ✅ 671 passed                                     |
| `npm run typecheck`                                                                                                                                                                                                                                                                                                                                                           | ✅ clean                                          |
| `npm run lint`                                                                                                                                                                                                                                                                                                                                                                | ✅ clean (`--max-warnings 10`)                    |
| `npx vitest run src/modules/scheduling src/pages/scheduling`                                                                                                                                                                                                                                                                                                                  | ✅ 989 passed (69 files)                          |

Rotation row 15 → ✅ (pending this PR's merge). Next: Feature 16 (Events &
requests).

## Pass 9 (2026-10-19) — near-zero delta (2 non-merge commits, 2 of 13 declared files), 0 fixes needed, 0 new findings; SCH-19 re-confirmed OPEN

**Watchdog pickup.** No open PR's head branch starts with
`claude/security-review-` (`search_pull_requests`, 0 results), and the
dedicated loop session (`session_011T1ZyyLrD5HagusgK9uDw2`) was not
reachable (`ListAgents`). PR #3435 (Feature 14, Equipment check & shifts,
pass 10) had merged. Rotation row 15 (Scheduling) was the next pending
feature.

### Scope

**Full-depth clone confirmed** — `git fetch --unshallow` run before trusting
any commit count (the session's clone started shallow). Baseline: the merge
commit for PR #3293, `2e187929d` (2026-10-15 19:00 -04:00), found via
`git log --all --grep` for the PR number rather than trusting a cited SHA —
this is the commit that carries pass 8's own PR #3291 **and** its same-day
addendum (SCH-18 fixed, SCH-19 flagged), both already fully documented in
this file's **Pass 8** / **Pass 8 addendum** sections above, so nothing from
either needed re-deriving, only re-verifying as unchanged.

**2 non-merge commits since `2e187929d` touch the 13 declared backend
files** (`git log` scoped to those exact paths): `efa1523c6` and
`27f0a20c2`. Real content changed in exactly 2 of the 13 files
(`git diff --stat`): `scheduling.py` (+10/-1) and `scheduling_service.py`
(+37/-3). **Zero diff**, confirmed not assumed, in the other 11, including
`pre_shift_work_service.py` and `calcom_service.py`.

Both commits read in full — see "Real commits reviewed" below. Frontend:
`modules/scheduling/` and `pages/scheduling/` swept for every changed file
since `2e187929d` (16 files, from 4 non-merge commits — 2 of them,
`53e37f9a3` and `37c057558`, are repo-wide form-payload fixes that happen to
touch this module's edit forms) against the checklist's banned patterns
(`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
`.toLocale*`, raw `date-fns` imports) — zero hits across all 16, confirmed
by a direct grep per file, not a sample.

**Scope-boundary items re-checked, still out of scope:** the External Shift
Hours quartet (SCH-15) and the `pre_shift_work_service.py` /
`shift_history_import_*` group (SCH-17) both have **zero diff** since
`2e187929d` (confirmed by `git diff --stat`), so the standing
recommendation to formally add them to this feature's declared scope, or
confirm they belong elsewhere, is unchanged and not repeated in full here.

### Re-verified standing items

- **SCH-9, SCH-10, SCH-13, SCH-15, SCH-16, SCH-17, SCH-18 (all fixed /
  accepted / scope-boundary, unchanged)** — none of the files carrying these
  live in the 2-file delta above, so each is confirmed unchanged by the
  `git diff --stat` showing zero diff on every other declared file, rather
  than re-read line-by-line. `_reject_deleting_a_used_call_type`
  (`scheduling.py:4011`) and its unlocked `slugs_named_by_requirements` call
  (SCH-16) are outside the 10-line delta `efa1523c6` made to this file
  (confirmed by `git diff`), so the accepted TOCTOU gap is unchanged.
- **SCH-19 (LOW, flagged, re-confirmed OPEN).** `schemas/scheduling.py` has
  zero diff this window (confirmed above). Re-read directly:
  `reported_call_types: Optional[dict[str, int]]` (lines 287, 436, 505) and
  `member_call_counts: Optional[List[MemberCallCredit]]` (line 289) still
  carry no length/size cap, unlike their sibling `attach_call_ids`/
  `detach_call_ids` (`Field(default=None, max_length=200)`, lines 296, 441, 445) which SCH-18 capped last pass. Still needs an owner-picked ceiling
  (no existing bound to borrow, since the call-type vocabulary itself is
  org-configurable) rather than a guess — unchanged disposition from the
  addendum. Already mirrored in `docs/KNOWN_LIMITATIONS.md`'s Scheduling
  Module table; not re-added.

### Real commits reviewed (feature commits, read in full)

- **`efa1523c6`** (empty-week "next shift" pointer; member self-signup saved
  confirmed) — the "next shift" lookup
  (`frontend/src/pages/scheduling/board/ShiftBoard.tsx`) calls the existing,
  already-reviewed `schedulingService.getShifts()` client-side with no new
  backend route or query; it is a client-side navigation hint only. The
  backend change is confined to `signup_for_shift`
  (`scheduling.py:3302`): the shift is resolved via
  `service.get_shift_by_id(shift_id, current_user.organization_id)` (already
  org-scoped, unchanged), and the only new behavior is setting
  `assignment_status = CONFIRMED` / `confirmed_at = now()` on the caller's
  **own** assignment row (`user_id = str(current_user.id)`) — a self-scoped
  write to a record the function was already creating, not a new write
  surface or a new id accepted from the client. No tenancy or authz change.
- **`27f0a20c2`** (stop listing ended shifts on Open Shifts) — the new
  `shift_not_over_criteria()` helper (`scheduling_service.py:281`) is a pure
  filter predicate (no DB write); `_open_shift_candidates` still filters
  `Shift.organization_id == str(organization_id)` first (unchanged, verified
  by direct read) and the new predicate narrows the result set further, so
  this tightens rather than loosens what a candidate query can return. The
  one new query it adds — a lookup of the organization's own settings
  (`select(Organization).where(Organization.id == str(organization_id))`) —
  is scoped to the same `organization_id` already governing the call, not a
  client-supplied id. Purely a correctness fix (an admin's live "Sign Up"
  button could previously be offered on an already-ended shift); not a
  security change.
- **`53e37f9a3`** / **`37c057558`** (repo-wide "don't drop or mis-store a
  cleared/entered form field" fixes; Scheduling's edit-form share only) —
  both are the CLAUDE.md Pitfall #1 pattern applied correctly:
  `PatternFormModal.tsx` and `TemplateFormModal.tsx` now use the shared
  `formCoercions()` helper to send an explicit `null` for a cleared field on
  **edit** (`initialData !== undefined`) rather than omitting the key, which
  the backend's `exclude_unset`-based partial update reads as "leave it
  alone." The one client-supplied FK touched, `apparatus_id` on
  `update_template`, is unchanged server-side and still validated in-org
  before being stored (`scheduling_service.py:3646`,
  `apparatus_ref_exists(self.db, apparatus_id, organization_id)` — the SCH-6
  fix from an earlier pass, confirmed still in place by direct read). The
  swap-request fix in `MyShiftsTab.tsx` (block submission until the shift
  picker has finished loading, so a specific-shift request can no longer
  silently go out as an open giveaway) is a client-side UX/correctness fix
  only — the chosen `requesting_shift_id` still passes through
  `createSwapRequest`, an existing, already-reviewed, org-scoped endpoint. No
  new backend surface in either commit.

### Route inventory

No route added, removed, or re-gated this pass — confirmed by
`grep -c "@router\."` against each of the three declared endpoint files:
`scheduling.py` 107 (unchanged), `scheduling_module_config.py` 3
(unchanged), `calcom_sync.py` 1 (unchanged). Total 111, carrying over pass
8's 111/111 auth-dependency verification unchanged, since no route's
signature changed this window (confirmed by `git diff` showing the only
backend change is inside `signup_for_shift`'s body and the new
`shift_not_over_criteria`/`_open_shift_candidates` helper, neither of which
touches a route decorator or dependency list).

### Verified good ✅ (pass 9)

- No new by-id endpoint, no new unvalidated client-supplied FK, no new
  `.like()`/`.ilike()`, no new JSON-column shallow-copy mutation, no new
  `ondelete="SET NULL"` column, no new outbound HTTP call, no new migration
  this pass (confirmed: zero files under `backend/alembic/versions/` added
  since `2e187929d` that touch any of the 13 declared files or their
  tables — `git log --no-merges --name-only 2e187929d..origin/main --
backend/alembic/versions/` shows no scheduling-owned revision).
- The one tightened query (`_open_shift_candidates`'s new
  `shift_not_over_criteria`) and the one self-scoped write
  (`signup_for_shift`'s `assignment_status`/`confirmed_at`) both reduce or
  leave unchanged the set of actions a caller can take through this
  feature's surface — neither widens it.

### Completion gate

| Check                                                                                                                                                                                | Result                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                        | ✅ 0 violations                                   |
| `black --check app/ tests/ alembic/`                                                                                                                                                 | ✅ clean (2,455 files unchanged)                  |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                            | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                    | ✅ single head `2315d544d60a`, 623 revisions      |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                | ✅ 272 routes, 0 errors, 0 warnings               |
| `pytest tests/ -q -k "scheduling or shift or swap or calcom or position_slots or call_tracking or call_type or pre_shift or pre_work or custom_crew or open_swap or xc1_scheduling"` | ✅ 1840 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck`                                                                                                                                                                  | ✅ clean                                          |
| `npm run lint`                                                                                                                                                                       | ✅ clean                                          |

Rotation row 15 → ✅ (pending this PR's merge). Next: Feature 16 (Events &
requests).

## Pass 8 (2026-10-15) — real delta (32 non-merge commits touching 11 of 13 declared files), 0 fixes needed, 1 new scope-boundary item (SCH-17), all standing flags re-confirmed

**Watchdog pickup.** No `claude/security-review-*` PR was open (checked via
`list_pull_requests`, not `PROGRESS.md`'s own Open PR row, which still named
the just-merged PR #3290 for a different feature). Rotation row 15
(Scheduling) was the first `⬜`.

### Scope

**Full-depth clone confirmed before trusting any count** —
`git rev-parse --is-shallow-repository` returned `false` directly (no
`fetch --unshallow` needed this time). Baseline: pass 7's own merge commit,
`08063fea3` (PR #2971, merged 2026-10-06 04:46 UTC) — found by searching
`git log --all --grep` for the PR number rather than trusting a cited SHA, per
the lesson in pass 7's own "pass-6 citation error corrected" entry.

**32 non-merge commits since `08063fea3` touch the 13 declared backend files**
(confirmed by `git log` scoped to those exact paths, not a broader grep).
Real content changes (`git diff --stat`) landed in 11 of the 13:
`scheduling.py` (+503/-9), `scheduling_service.py` (+1,338/-193),
`schemas/scheduling.py` (+174/-15), `call_tracking_service.py` (+199/-8),
`shift_eligibility_service.py` (+160/-12), `shift_completion_service.py`
(+110/-7), `calcom_sync.py` (+1/-1, a type annotation),
`scheduling_module_config_service.py` (+4/-2, a type annotation),
`standing_shift_service.py` (+15/-14, type annotations only),
`mcp/tools/scheduling.py` (+32/-5), `models/call_tracking.py` (+22/-16, mypy
`Mapped`/`mapped_column` typing). **Zero diff**, confirmed not assumed:
`scheduling_module_config.py`, `calcom_service.py`.

Every commit was read individually (not sampled) and traced to one of:
mechanical mypy-narrowing (`265a26be3`, `7879398dc`, `f5ad6018a`, `d1d72a3c2`,
`51c77a9ce`, `668fca634`, `c1b61de67`, `17e289411`, `9aca4fb41` and their
merge commits — type annotations and `Mapped`/`mapped_column` migrations, no
behavior change, confirmed by reading each diff); a genuine XC-1 fix already
applied and tested (`970adc6b5`, see "Re-verified" below); five real features,
each reviewed in full (`b7a7482c0` shared-call picker, `77a7d6572` open-swap
pickup, `b0c189a9c` custom crew seats, `dea67d773` pre-shift work timing,
`6f8568583` Weekend Only pattern preset); two correctness/reporting changes
(`9bda6d96f` call-tracking-mode-since stamp, `7489c4865` SHIFTS-requirement
grading unification — Pitfall #29 class, owner-decided); one read-only
eligibility helper added for a different feature's gate (`ebb6bc6f9`'s
`shift_eligibility_service.py` change, see below); one pure extraction
refactor (`44d8edb6f`'s `scheduling.py` change, apparatus-options lookup
moved to a shared helper, logic unchanged); and groundwork for a different
feature's permission model that happens to touch `mcp/tools/scheduling.py`
(`6c45efd38`, see below).

**Adjacent-file sweep, per the standing lesson that a feature's real surface
can sit outside its declared scope list:** `backend/app/services/
pre_shift_work_service.py` (new, 715 L, introduced by `dea67d773`) and
`backend/app/api/v1/endpoints/shift_history_import.py` +
`backend/app/services/shift_history_import_{engine,service}.py` (new, 3,163 L
combined, introduced by a separate commit range culminating in `0a1817680`) —
both feed or are fed by scheduling data but are not in the declared 13-file
list. Reviewed opportunistically, same depth pass 7 gave the "External Shift
Hours" files it found in the same position — see SCH-17 below.

**Frontend:** `modules/scheduling/` and `pages/scheduling/` swept for every
changed file since `08063fea3` (67 files) against the checklist's banned
patterns (`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
`.toLocale*`, raw `date-fns` imports) — zero hits across all 67, confirmed by
a direct grep per file, not a sample. The new `admin/historyImport/` tree (12
files) and `PreShiftWork*`/`OpenSwapPickups` components were read in full as
part of reviewing SCH-17 and the two in-scope features above; the remaining
changed files (settings-panel mypy-adjacent type fixes, a notifications panel,
pattern-preset UI) were swept by the same grep and are not separately
narrated here.

### Re-verified standing items

- **SCH-9 (fixed)** — `_all_users_in_org` still called from both shift-call
  write paths (`create_shift_call`, `update_shift_call` in
  `scheduling_service.py`, lines shifted but logic byte-identical to pass 7's
  description). Confirmed by direct read, not assumed from the name surviving
  a grep.
- **SCH-10 (fixed 2026-10-05, confirmed unchanged)** — `calcom_service.py` has
  **zero diff** since pass 6 (confirmed above), and the cross-cutting
  `SSRFSafeAsyncTransport` fix it rides on is outside this feature's files
  entirely, so there is nothing in this feature's own scope that could regress
  it. Not re-verified line-by-line again this pass since the file is
  byte-identical to the version pass 7 already read in full.
- **SCH-13 (fixed)** — `finalize_shift` (`scheduling_service.py`) and
  `save_closeout_calls` (same file) both still lock the shift row before
  touching attendance/call rows; `save_closeout_calls` additionally now runs
  `detach_call_ids` before `attach_call_ids`, both before the count
  reconciliation (new this pass, part of `b7a7482c0` — see "Real commits
  reviewed" below), preserving the lock-ordering invariant rather than
  introducing a new race. `_reject_deleting_a_used_call_type`
  (`scheduling.py`) still locks the org row before the usage check, unchanged.
- **SCH-15 (scope-boundary, pass 7)** — pass 7's own recommendation ("add
  External Shift Hours to Scheduling's declared scope, or confirm it belongs
  elsewhere") was not acted on between passes; the four files it named
  (`models/external_shift_hours.py`, `services/external_shift_hours_service.py`,
  `services/external_apparatus_service.py`,
  `endpoints/external_shift_hours.py`) have **zero diff** since pass 7
  (confirmed by `git diff --stat`), so there is nothing new to re-review, and
  the recommendation stands unchanged — repeated in SCH-17 below alongside
  the two newer scope-boundary files, so a future pass can act on both at
  once rather than finding them one at a time.
- **SCH-16 (LOW, accepted, self-documented TOCTOU)** — the unlocked
  `slugs_named_by_requirements` check in `_reject_deleting_a_used_call_type`
  (`scheduling.py`, now ~line 4099) is unchanged: still runs after the locked
  `slugs_locked_by_history` check, still carries the same in-code
  acknowledgment of the gap. No action needed, unchanged from pass 7's
  disposition.

### New standing items added this pass

- **SCH-17 (scope-boundary, not a vulnerability).** Two more out-of-scope
  file groups appeared this pass, in the same position SCH-15 (pass 7)
  flagged External Shift Hours:
  - `backend/app/services/pre_shift_work_service.py` (715 L, new, from
    `dea67d773`) plus its schema/endpoint surface inside `scheduling.py` and
    `schemas/scheduling.py` (which _are_ in scope, so the wiring was reviewed
    in full as part of this pass — see "Real commits reviewed").
  - `backend/app/api/v1/endpoints/shift_history_import.py` (334 L) and
    `backend/app/services/shift_history_import_{engine,service}.py` (1,512 L
    - 1,317 L), a standalone CSV-import feature registered separately in
      `api.py`, not imported by any of the 13 declared files.

  Both reviewed opportunistically this pass and found clean:
  - `pre_shift_work_service.py`: every query org-scoped
    (`organization_id` filtered on every by-id lookup); self-review refusal
    enforced (`review()` raises `PermissionError` when the reviewer is the
    session's own member and lacks `scheduling.manage`); lock ordering
    matches `member_check_in`'s (shift before session) to avoid deadlock, with
    an in-code comment naming the reason; bounded duration
    (`MAX_PRE_WORK_MINUTES = 1440`); the one new `ondelete="SET NULL"` column
    (`reviewed_by`) is `nullable=True`; the new table is guarded against
    `create_all` (Pitfall #26) in its migration.
  - `shift_history_import_{engine,service}.py` / `shift_history_import.py`:
    all 9 routes gated `require_permission("scheduling.manage")`; upload
    capped at 10MB (`read_upload_limited`) and malware-scanned
    (`reject_if_malicious`) before parsing; a separate `MAX_IMPORT_ROWS` cap
    bounds row count independent of the byte cap; every by-id get
    (`get_import`/`get_draft`) filters `organization_id`; client-supplied
    member/apparatus ids in a mapping decision are validated in-org
    (`_validated_member_mapping`/`_validated_unit_mapping`) before being
    stored (XC-1); the commit path locks the draft row for its whole duration
    (`for_update=True`) so two concurrent commits of the same draft serialize
    rather than double-write; CSV template download uses `SafeCsvWriter`
    (Pitfall #15); the three new frontend routes are registered in all three
    registries (`APPLICATION_PAGES.md`, `testingRegistry.ts`,
    `mobile-route-inventory.ts`), confirmed by direct grep, each gated
    `scheduling.manage` client-side matching the server gate.

  **Recommendation for the next pass, repeated and widened from SCH-15:**
  formally add `pre_shift_work_service.py`, `shift_history_import.py` and the
  two `shift_history_import_*` service files (plus the still-unresolved
  External Shift Hours quartet from pass 7) to Scheduling's declared scope,
  or confirm each belongs to a different rotation feature — four passes in a
  row have now found real, review-worthy surface outside the declared file
  list, which is a pattern rather than a one-off.

- **No new vulnerability-class finding.** Every by-id query reviewed this
  pass filters `organization_id`; every client-supplied FK (the pattern's
  `template_id`/`assigned_members[].user_id`/`day_template_id`/
  `night_template_id` fixed by `970adc6b5`, the report's
  `tasks_performed[].equipment_check_id` fixed by the same commit, the
  history-import mapping ids, the pre-shift-work `apparatus_id`) is validated
  in-org before being stored; every new locking surface
  (`detach_response`/`list_attachable_calls` in `call_tracking_service.py`,
  `pick_up_open_swap` in `scheduling_service.py`,
  `PreShiftWorkService.start`/`end`/`review`, the history-import commit) takes
  its lock in an order consistent with the feature's existing deadlock-avoidance
  reasoning; no new `.like()`/`.ilike()` anywhere in scope; no new JSON-column
  shallow-copy mutation; the one widened column
  (`shift_assignments.position`/`standing_shift_claims.position`, ENUM to
  VARCHAR) ships with a migration that is guarded, idempotent and has a real,
  refusing-not-corrupting downgrade (see "Schema & migration notes" below);
  the new `SeatToken` request type caps length (`SEAT_NAME_MAX_LENGTH`) and
  settles through the same `resolve_seat`/`resolve_department_seat` whitelist
  every seating path already used, so a request cannot name a seat the shift
  (or, for a standing claim, the department) does not actually carry — no
  stored-XSS surface opened by widening the column, since the value is still
  validated against a known vocabulary before being accepted, not freeform
  text; the five new MCP scheduling tools added by `6c45efd38`'s pattern all
  declare `permissions=("scheduling.view", "scheduling.manage")`, matching
  the equivalent endpoints' gates, and are read-only.

### Real commits reviewed (feature commits, read in full)

- **`970adc6b5`** — XC-1 fix, already applied and tested
  (`test_xc1_scheduling_events.py`, 440 L): `create_pattern`/`update_pattern`
  now validate `template_id`, `assigned_members[].user_id` and
  `schedule_config.{day,night}_template_id` in-org via
  `assert_in_org`/`assert_all_in_org` before any write; a partial update
  checks only the keys present, and an explicit `null` still clears
  `template_id`. `ShiftCompletionService.create_report`/`update_report` gained
  the same check for `tasks_performed[].equipment_check_id`. Before this fix,
  a foreign id here was never read back cross-tenant (generation re-resolves
  every reference in-org and silently drops what it cannot find), so the
  actual pre-fix impact was within-org referential integrity only — a pattern
  could silently generate without its template or a member — matching the
  severity class of the already-closed SCH-9. Fixed, not merely flagged.
- **`b7a7482c0`** (shared-call picker, SCHED-10 owner decision) —
  `CallTrackingService.list_attachable_calls`/`detach_response` both filter
  `organization_id` on every table joined (`OrgCall`, `OrgCallResponse`,
  `Shift`); `detach_response` takes a locking read of every response row for
  the call before deciding whether this shift is the last responder (so a
  concurrent attach by another unit is visible before the decision);
  `list_attachable_calls` is bounded (`MAX_ATTACHABLE_CALLS = 200`); the
  endpoint resolves the shift through `_authorize_shift_management` (manage
  permission or shift officer) before either method is reachable. Cross-org
  cases are explicitly tested
  (`test_attach_rejects_a_call_from_another_org`,
  `test_another_orgs_calls_are_never_offered`,
  `test_another_orgs_call_is_untouched`).
- **`77a7d6572`** (open-swap pickup, W33-4 owner decision) —
  `get_open_swaps_for_member`/`pick_up_open_swap` both filter
  `organization_id` throughout; `pick_up_open_swap` locks request → shift →
  offered assignment, in the order `respond_to_swap_offer` already uses, so a
  concurrent pickup attempt serializes on the request row; the vacating seat
  is excluded from its own capacity check (it moves in the same transaction);
  the full `_validate_assignment_candidate` (duplicate, overlap, leave,
  eligibility, EVOC, seat cap) runs with no override path; a training seat is
  refused outright. `self.requesting_user_id == member_id` ("pick up your own
  shift") is refused. 458 L of integration tests, including a cross-org case.
- **`b0c189a9c`** (custom crew seats, SCHED-CUSTOM-SEAT owner decision) — the
  widened VARCHAR columns accept a value only through `resolve_seat`
  (matches a seat the specific shift already carries) or
  `resolve_department_seat` (matches the department's own defined
  vocabulary for a standing claim) — never arbitrary client text. Both raise
  `UnknownSeatError` (422) otherwise. `SeatToken`'s `AfterValidator` caps
  length at `SEAT_NAME_MAX_LENGTH` before any of that runs. Migration
  `56c91e7d9e10` reviewed in full: guarded against `create_all`-only tables
  (checks column existence first), idempotent (the one data rewrite is a
  case-sensitive `BINARY` match on legacy uppercase values, safe to re-run),
  and its downgrade inspects every row for a non-built-in seat and refuses
  with the offending values named rather than truncating data.
- **`dea67d773`** (pre-shift work timing) — reviewed as SCH-17 above.
- **`6f8568583`** (Weekend Only pattern preset) — `_parse_weekday_shifts`
  reads `schedule_config["weekday_shifts"]` defensively (Pitfall #19 shape:
  malformed input is dropped, not raised), and the existing
  `MAX_GENERATION_DAYS` cap on shift generation is untouched by this change —
  confirmed the new code path is additive to, not a replacement for, the
  bounded generation loop.
- **`9bda6d96f`** (call-tracking mode-since stamp, SCHED-14/15 owner decision)
  — `_stamp_call_tracking_mode_since` explicitly strips any client-supplied
  `mode_since` before saving (`{k: v for k, v in incoming.items() if k !=
"mode_since"}`) and computes the stamp itself from `org_today`, so a client
  cannot backdate or forge the adoption date the report later warns against.
- **`7489c4865`** (SHIFTS-requirement grading unification, Pitfall #29 class,
  owner-decided) — the Shift Compliance report's SHIFTS rows now go through
  the same shared grader (`evaluate_member_requirement_detail`) and shared
  shift-count source (`load_credited_shift_dates`) as every other screen that
  shows this figure, closing the three-sources-of-truth gap KNOWN_LIMITATIONS
  already named. `load_credited_shift_dates` is `organization_id`-scoped.
  Primarily a correctness fix (CMP-20 already covers it from the Compliance
  feature's side per its own doc reference in the commit), not a new
  tenant-isolation surface.
- **`ebb6bc6f9`** (crew training recording — Training feature, not
  Scheduling's) — only its `shift_eligibility_service.py` change is in this
  feature's scope: a new read-only `can_serve_as_shift_officer` helper,
  org-scoped (`_get_org(organization_id)`), built from the same
  rank/qualification/training sources `get_eligible_positions` already uses,
  deliberately excluding the org-wide open-positions grant per its own
  docstring. No write path, no new surface. The feature's own endpoint/service
  files (`training_submissions.py`, `training_submission_service.py`) are
  Training's scope (rows 17/18, not yet reached by this rotation) and were
  not reviewed here.
- **`44d8edb6f`** (suggestion-box answer types — Forms feature, not
  Scheduling's) — only its `scheduling.py` change is in this feature's scope:
  a pure extraction, moving the existing (already org-scoped, already
  reviewed) apparatus-options lookup into a shared
  `app/services/apparatus_options.py` helper so the Forms module's vehicle
  question can reuse it. No logic change at the call site, confirmed by diff.
- **`6c45efd38`** (MCP OAuth groundwork — MCP feature, not Scheduling's) —
  only its `mcp/tools/scheduling.py` change is in this feature's scope: the
  four existing read-only scheduling MCP tools gained a `permissions=(...)`
  declaration (`scheduling.view`, `scheduling.manage`) as part of a
  repo-wide change requiring every MCP tool to declare member permissions.
  Matches the equivalent endpoints' own gates; no scheduling-specific
  authorization logic changed.

### Route inventory

**`scheduling.py`: 107 routes (was 98)** — verified by direct `@router.*`
decorator parse via a small AST script (not a commit message or a diff of
the prior count), cross-checked against `grep -c "@router\."` (both agree).
All 107 carry a recognized auth dependency
(`get_current_user`/`require_permission`/`get_optional_current_user`) in
their signature — 0 with none, confirmed by the same script scanning every
route's argument list for one of those three names.
**`scheduling_module_config.py`: 3 routes, unchanged** (zero diff this
window). **`calcom_sync.py`: 1 route, unchanged** (zero diff this window).
**Total across the three declared endpoint files: 111 routes, 111/111 with a
recognized auth dependency.**

### Verified good ✅ (pass 8)

- No new by-id endpoint missing org-scoping; no new unvalidated
  client-supplied FK (`970adc6b5` closed the one gap that existed, in
  pattern/report refs); no new unbounded query (`list_attachable_calls`
  capped at 200, `get_open_swaps_for_member` capped at
  `OPEN_SWAP_LIMIT`, history-import rows capped at `MAX_IMPORT_ROWS`, upload
  bytes capped at 10MB); no new `.like()`/`.ilike()`; no cache-exclusion-list
  gap (`/scheduling/` already covers every new route under that prefix; the
  separately-mounted `shift_history_import.py` routes are also under
  `/api/v1/scheduling/history-import`, so the same prefix rule already
  covers them — confirmed by reading the mount path in `api.py`); no JSON-
  column shallow-copy mutation; no new `ondelete="SET NULL"` column missing
  `nullable=True` (`reviewed_by` on `shift_pre_work_sessions` checked
  explicitly); the one migration narrowing/widening a column
  (`56c91e7d9e10`) has a real, non-destructive downgrade; no new outbound
  HTTP call in scope (`calcom_service.py` zero diff).
- Four new read-then-write / capacity-sensitive paths landed this window
  (`detach_response`, `pick_up_open_swap`, `PreShiftWorkService.start`/`end`/
  `review`, the history-import commit) and all four lock in an order
  consistent with the feature's existing deadlock-avoidance reasoning, with
  an in-code comment naming the reason in three of the four (the fourth,
  `detach_response`, reasons about the lock in its docstring instead of
  inline).
- Separation of duties holds on the two new approval-shaped paths:
  `pick_up_open_swap` refuses the offerer picking up their own shift;
  `PreShiftWorkService.review` refuses a shift officer approving their own
  session (requires `scheduling.manage` instead).

### Completion gate

| Check                                                                                                                                                                                | Result                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                        | ✅ 0 violations                                   |
| `black --check app/ tests/ alembic/`                                                                                                                                                 | ✅ clean (2,334 files unchanged)                  |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                            | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                    | ✅ single head `c903fc771081`, 601 revisions      |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                | ✅ 270 routes, 0 errors, 0 warnings               |
| `pytest tests/ -q -k "scheduling or shift or swap or calcom or position_slots or call_tracking or call_type or pre_shift or pre_work or custom_crew or open_swap or xc1_scheduling"` | ✅ 1826 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck`                                                                                                                                                                  | ✅ clean                                          |
| `npm run lint`                                                                                                                                                                       | ✅ clean                                          |

Rotation row 15 → ✅ (pending this PR's merge). Next: Feature 16 (Events &
requests).

## Pass 8 addendum (2026-10-15) — SCH-18 fixed, SCH-19 flagged (found after pass 8's own PR #3291 merged)

A second, independently-launched watchdog iteration reviewed Feature 15 at
the same time as the pass above (PR #3291) and surfaced one real gap pass 8
did not catch, plus a sibling gap left open. Recorded as an addendum rather
than a competing "Pass 8" section since #3291 already holds that pass's
record; the rotation's own "next: Feature 16" pointer is unchanged by this
addendum — it is a follow-up fix, not a new pass.

**SCH-18 (LOW, fixed).** `ShiftFinalizeRequest.attach_call_ids` and
`CloseoutCallsRequest.attach_call_ids`/`detach_call_ids` had no
list-length bound. Each id costs the server a locking DB lookup in a loop
(`CallTrackingService`'s attach/detach paths), so an authenticated
`scheduling.manage`/shift-officer caller could submit an unbounded list of
ids to inflate one request's DB cost — an abuse-resistance gap, not a
tenant-isolation one (every id is still resolved through an org-scoped
query). Fixed in `backend/app/schemas/scheduling.py` with
`Field(default=None, max_length=200)`, matching
`CallTrackingService.MAX_ATTACHABLE_CALLS` — the one legitimate source of
these ids.

**SCH-19 (LOW, flagged, not fixed).** Same shape of gap on
`ShiftFinalizeRequest.member_call_counts` (a list) and `.reported_call_types`
(a dict keyed by call type). Left open: unlike `attach_call_ids`, there is no
existing ceiling to borrow for the call-type vocabulary, which is itself
unbounded in org settings, so closing this needs an owner-picked cap rather
than a guess. `responding_members`'s existing 100-entry cap is a plausible
precedent for the list side. Mirrored to `KNOWN_LIMITATIONS.md`'s Scheduling
Module table.

**Gate** (independently re-run against CI's pinned tool versions —
flake8==7.3.0, black==26.5.1, isort==9.0.1): `flake8`/`black --check`/
`isort --check-only` clean over `app/ tests/ alembic/`;
`validate_migrations.py --strict` — single head, 601 revisions;
`check_route_permissions.py --strict` — 270 routes, 0 errors;
`check_endpoint_permissions.py --strict` — 1,815 documented handlers, 0
errors; `pytest tests/test_scheduling.py tests/test_scheduling_endpoints.py
tests/test_xc1_scheduling_events.py -q` — 151 passed; `npm run typecheck` —
0 errors; `npm run lint` — 0 errors/0 warnings.

---

## Pass 7 (2026-10-06) — real delta (23 backend + 46 frontend commits), 0 fixes needed, 2 standing items added (1 scope-boundary, 1 accepted low-severity TOCTOU), a pass-6 citation error corrected

**Watchdog pickup.** PR #2970 (Feature 14, Equipment check & shifts, pass 7) had merged with 0 application-code changes (docs-only), so per
`PROGRESS.md`'s own rule it was not independently recordable. No
`claude/security-review-*` PR was open; rotation row 15 (Scheduling) was
the first `⬜`.

### Scope

**Confirmed full-depth clone before trusting any commit count** —
`git fetch --unshallow` reported "already a complete repository"; no
shallow-clone truncation risk here, unlike the Inventory pass earlier in
this rotation run. Since pass 6's merge (PR #2628, `15f5f978`,
2026-09-17): **23 non-merge commits** touch the 13 declared backend scope
files, with real content changes confirmed via `git diff --stat` in only
7 of the 13 (`scheduling.py`, `schemas/scheduling.py`,
`call_tracking_service.py`, `scheduling_module_config_service.py`,
`scheduling_service.py`, `shift_completion_service.py`,
`shift_eligibility_service.py`); **zero diff**, confirmed not assumed, in
`scheduling_module_config.py`, `calcom_sync.py`, `standing_shift_service.py`,
`calcom_service.py`, `mcp/tools/scheduling.py`, `models/call_tracking.py`.
Frontend: **46 non-merge commits**, including 7 carrying the
workflow-review rotation's `docs(workflow-review)` label — each verified
(per the lesson from this rotation run's Equipment-check pass, where two
such commits turned out not to be docs-only) to touch real logic as its
own PR body discloses, not a hidden undisclosed change; all reviewed and
clean.

### Re-verified standing items

- **SCH-9 (fixed)** — `_all_users_in_org` shifted to
  `scheduling_service.py:1920` (was `:1879`); still called from both
  call-write paths, now `:3167`/`:3237` (was `:3096`/`:3166`). Logic
  unchanged, confirmed by direct read.
- **SCH-10 — confirmed fixed, not merely unchanged.** `calcom_service.py`
  itself has zero diff since pass 6, and the standing `assert_outbound_url_safe`
  check at `:123` is still there byte-identical — but the DNS-rebinding
  TOCTOU this flagged is now closed anyway, by a cross-cutting fix that
  landed in the shared factory this file already calls into.
  `calcom_service.py:131,158` build their HTTP client via
  `create_integration_client()` (`integration_services/base.py`), which
  now wraps `SSRFSafeAsyncTransport` — it resolves the host once and
  connects to the validated address itself, closing the second-resolution
  window `assert_outbound_url_safe` could only narrow. `KNOWN_LIMITATIONS.md`
  already records this (SCH-10, resolved 2026-10-05) and names
  `calcom_service.py` explicitly among the six senders it covers; verified
  here by reading the actual import/call sites rather than re-asserting
  the doc's claim. Not re-opened as a new finding — confirming an
  already-recorded fix, closing this feature's one standing flag.
- **SCH-13 (fixed) — and a pass-6 documentation error corrected.** Pass 6
  cited `finalize_shift`/`save_closeout_calls` as living in
  `scheduling.py:7803`/`:8359` — but `scheduling.py` is only ~4,100 lines;
  those methods have always lived in `scheduling_service.py` (confirmed
  against the pass-6 baseline commit's own tree). Corrected here rather
  than repeated. Current locations: `scheduling_service.py::finalize_shift`
  `:8595`, `::save_closeout_calls` `:9151` — both still carry the
  documented lock-ordering (shift row locked before attendance/call
  rows, matching order on both paths to avoid deadlock), intact.
  `_reject_deleting_a_used_call_type` (correctly in `scheduling.py`, now
  `:3758`, was `:3703`) also intact — org row locked first, then the
  locking-read usage check, unchanged ordering.

### New standing items added this pass

- **SCH-15 (scope-boundary, not a vulnerability).** `c4215b499` added a
  new "External Shift Hours" feature (`models/external_shift_hours.py`,
  `services/external_shift_hours_service.py`,
  `services/external_apparatus_service.py`,
  `endpoints/external_shift_hours.py`, registered separately in
  `api.py`) that feeds shift/hours compliance totals
  `scheduling_service.py` reads, but sits entirely outside this feature's
  declared 13-file scope. Reviewed opportunistically this pass and found
  clean: every by-id op org-scoped, the client-supplied
  `external_apparatus_id` FK validated in-org via `get_pickable_apparatus`
  (XC-1), `ondelete="SET NULL"` columns all `nullable=True`, self-service
  routes scoped to the caller's own id, officer-review routes gated on
  `scheduling.manage`. **Recommendation for the next pass:** formally add
  these four files to Scheduling's declared scope (or confirm them as a
  different feature's responsibility) so they get a tracked review going
  forward instead of being swept in incidentally.
- **SCH-16 (LOW, accepted, self-documented TOCTOU).** `0b90e74c9`'s new
  `slugs_named_by_requirements` check inside
  `_reject_deleting_a_used_call_type` (`scheduling.py`, ~line 3844) runs
  without the row lock its sibling `slugs_locked_by_history` check uses.
  The author's own comment acknowledges the gap. Failure scenario: admin
  A deletes call-type "MVA" (the usage check finds no referencing
  requirement, passes); concurrently admin B saves a training requirement
  naming "MVA" as a counted call type; both commit; the requirement now
  names a slug the department no longer offers. Consequence is
  degradation (the stale requirement still matches historical reports by
  slug, it just can't be newly logged), not corruption or a tenant leak —
  matching the author's own risk assessment in-code. **Accepted as
  documented, no action needed**, recorded here as a durable standing
  item rather than left to be rediscovered.

### Real commits reviewed, all clean (two are genuine security-positive fixes)

- **`7df93344f`** — separation-of-duties fix: `create_report` now refuses
  `trainee_id == officer_id`, enforced centrally across every
  report-creation path.
- **`2f08c5d6a`** — XC-2-class fix: a "written by me" endpoint that
  previously served department-wide data to anyone holding
  `training.manage` (every company officer) is now gated `scope=department`
  behind a new `training.view_analytics` permission
  (`shift_completion.py:347-353`), seeded via migration `84819ea78a79` to
  existing leadership positions.
- **`5eb5cc669`** — re-signup after decline/cancellation deletes the stale
  assignment row under the existing shift-row lock before inserting the
  new one — correct Pitfall #27 shape, lock held throughout.
- **`28934f50c`** — fixes a `scheduling_module_config` get-or-create race
  with a `begin_nested()` savepoint + `IntegrityError` fallback to a
  locking re-read — textbook Pitfall #27 fix.
- **`06bafb229`** — new "vacate seat → cancel dependent swaps" feature
  deliberately runs the cancellation as a second, separate transaction
  after commit specifically to avoid a lock-order inversion against
  `review_swap_request` (reasoned in-code); the new query is org-filtered
  and takes `.with_for_update()`.
- **`377215211`** — two-way shift exchange requiring mutual qualification;
  the new `GET /exchange-candidates` endpoint org-scopes via
  `get_shift_by_id(shift_id, current_user.organization_id)`;
  `override_qualification` gated on `scheduling.manage` and audit-logged.
- **`c4215b499`** — External Shift Hours feature; see SCH-15 above.
- **`4a6f6737a`, `f8c3bea43`, `92803f32f`, `3a49bb432`, `0392fc6df`,
  `6aa066ace`, `ea939c38d`** — department-local-date correctness series
  and requirement-matching/grandfathering fixes (Pitfall #29 class), all
  via the shared helpers, all org-scoped where relevant.
- **`b5fe2ca00`, `72dfb4f1e`, `ab531b850`, `0eb353a2c`, `f92fbd927`,
  `60855c344`, `d14972edc`, `ff09e2660`, `0b90e74c9`** — email-preference
  plumbing (one incidentally hardens a recipient query with an added
  `organization_id` filter — not previously exploitable, still a
  defense-in-depth improvement), department-setting gates with
  Pitfall #19-compliant defensive JSON reads, display-name cosmetics,
  eligibility/roster widening (intentional, opt-out available, no
  privilege escalation), setup-guide counts, an apparatus-tag-to-shift
  resolver tightened to a time-window+status filter, and the call-type
  vocabulary unification covered by SCH-16 above. All clean.

### Route inventory

**`scheduling.py`: 98 routes (was 92)** — verified by direct
`@router.*` decorator parse (49 GET, 27 POST, 9 PATCH, 10 DELETE, 3 PUT),
not a commit message; all 98 carry an auth dependency, zero bare routes.
**`scheduling_module_config.py`: 3 routes, unchanged** — zero diff this
window, pass 6's count stands.

### Verified good ✅ (pass 7)

- No new by-id endpoint missing org-scoping; no new unvalidated
  client-supplied FK (the one new FK, `external_apparatus_id`, is
  validated in-org); no new unbounded query; no CSV/export code added in
  scope; no new unescaped `.like()` (one `.like()` touched by
  `7df93344f` keeps `escape=LIKE_ESCAPE_CHAR`); no cache-exclusion-list
  gap; no JSON-column shallow-copy mutation; the one new permission
  (`training.view_analytics`) ships with a migration seeding existing
  leadership positions; no new `ondelete="SET NULL"` column missing
  `nullable=True`; no new outbound HTTP call anywhere in scope (nothing
  touches `calcom_service.py`/`calcom_sync.py` this window).
- Two new read-then-write race-condition fixes landed this window
  (`28934f50c`, `06bafb229`) and both handle locking/ordering correctly,
  reasoning explicitly about deadlock avoidance in SCH-13's own style —
  no new unguarded capacity/duplicate-submission/status-transition path.

### Completion gate

| Check                                                                                                         | Result                                            |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `flake8` (scope files)                                                                                        | ✅ 0 violations                                   |
| `black --check` (scope files)                                                                                 | ✅ clean                                          |
| `isort --check-only` (scope files)                                                                            | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`                                                             | ✅ single head `15802f3df5c4`, 527 revisions      |
| `python3 scripts/check_route_permissions.py --strict`                                                         | ✅ 245 routes, 0 errors, 0 warnings               |
| `pytest tests/ -q -k "scheduling or shift or swap or calcom or position_slots or call_tracking or call_type"` | ✅ 1517 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck`                                                                                           | ✅ clean                                          |
| `npm run lint`                                                                                                | ✅ clean                                          |
| `npx vitest run src/modules/scheduling`                                                                       | ✅ 336 passed (25 files)                          |

Rotation row 15 → ✅ (pending PR merge). Next: Feature 16 (Events &
requests).

---

## Revision note

Two rounds of Codex review corrected this draft. The first caught three
issues: a real efficiency gap (SCH-9's original per-id validation loop, up
to 100 serial queries) and two inaccurate claims in the draft's own
write-up — SCH-9's cross-tenant impact was overstated (there is no
cross-tenant failure scenario; corrected below), and a "Verified good" claim
that `calcom_service.py` closes the DNS-rebinding TOCTOU was wrong (it
narrows the window; filed as SCH-10, flagged). The second round caught that
the SCH-10 correction itself undercounted the affected surface — six files
sharing one fix, when it's actually **seven callers across three distinct
transports**, two of which (a hand-built `httpx.AsyncClient` in
`audit_ship_service.py`, and `pywebpush` in `push_service.py`) would not be
reached by the single shared-client fix the first correction implied.
SCH-9's fix (in-org validation) survives, batched; SCH-10 is flagged rather
than fixed either way, since closing it is a cross-cutting change spanning
multiple transports, not a scheduling-specific one.

## Scope

Module-audit iteration 19 (SCH-1 through SCH-8) plus four app-review Tier B
passes (2026-08-06 through 2026-08-09) already covered this module in depth —
this is its first pass through the security-review rotation. Both
`scheduling.py` and `scheduling_service.py` have roughly **doubled in size**
since the last full read (endpoints: ~1,900 → 3,437 L; service: ~5,000 →
7,018 L), so this iteration re-verified every prior finding and read the
entire current file rather than treating the growth as incremental.

**Read in full, not sampled:** `scheduling.py` (all 92 routes, enumerated
below), `scheduling_service.py` (all 7,018 lines), `standing_shift_service.py`
(570 L, new since the last audit — recurring member shift claims, not
previously reviewed), `scheduling_module_config.py` +
`scheduling_module_config_service.py` (department shift-settings CRUD, small,
not previously reviewed), `calcom_sync.py` + `calcom_service.py` (Cal.com
booking read, not previously reviewed).

**Not read line-by-line:** the frontend module (56 files) — checked only for
the cache-exclusion and auth-interceptor checklist items (both already
correct; see Verified good).

## Route inventory

92/92 routes in `scheduling.py` carry an inline auth dependency (either
`Depends(get_current_user)`, `Depends(require_permission(...))`, or an inline
authorization helper) — the router's own `module_gate("scheduling", ...)`
dependency uses the **optional** current-user resolver and passes
unauthenticated requests through, so it provides no authentication of its own;
every route's real gate is the one on the route itself. Confirmed by reading
all 92 handler signatures, not by the module gate's presence.

| Group                                                     | Routes | Gate                                                                                                                                                   |
| --------------------------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shifts CRUD                                               |      5 | `scheduling.view`/`scheduling.manage`; `/shifts/open` self-filtered `get_current_user`                                                                 |
| Shift lifecycle (finalize/closeout/reopen/handoff/cancel) |      9 | `get_current_user` + `_authorize_shift_management`/`_authorize_handoff_access` (manage perm OR shift officer OR, for handoff, an active roster member) |
| Attendance                                                |      6 | mix of `_authorize_shift_management` and `scheduling.view`/`scheduling.manage`                                                                         |
| Self check-in/out + history                               |      4 | `get_current_user`, self-scoped to `current_user.id`                                                                                                   |
| Apparatus active-shift                                    |      1 | `get_current_user`                                                                                                                                     |
| Calendar (week/month)                                     |      2 | `scheduling.view`                                                                                                                                      |
| Summary/dashboard                                         |      4 | `scheduling.view` (summary); `scheduling.manage` (dashboard widgets — deliberately elevated above `.view`, see below)                                  |
| Shift calls                                               |      6 | `_authorize_shift_management` or `scheduling.view`/`scheduling.manage`                                                                                 |
| Templates                                                 |      5 | `scheduling.view`/`scheduling.manage`                                                                                                                  |
| Patterns + generate                                       |      6 | `scheduling.view`/`scheduling.manage`                                                                                                                  |
| Assignments                                               |      8 | mix of `require_permission`, `_authorize_assignment_management`, self-scoped confirm                                                                   |
| Swap requests                                             |     ~9 | `scheduling.swap`/`scheduling.manage`; `respond_to_swap_offer` self-scoped `get_current_user` by design                                                |
| Time-off                                                  |     ~6 | `scheduling.view`/`scheduling.swap`/`scheduling.manage`                                                                                                |
| Availability                                              |      1 | `scheduling.assign`                                                                                                                                    |
| Personal (`/my-shifts`, `/my-assignments`)                |      2 | `get_current_user`, self-scoped                                                                                                                        |
| Reports                                                   |      4 | `scheduling.report`                                                                                                                                    |
| Signup/withdraw                                           |      2 | `get_current_user`, self-scoped                                                                                                                        |
| Standing shifts (preview/claim/list/create/delete)        |      5 | `get_current_user`, self-scoped throughout                                                                                                             |
| Apparatus options + basic-apparatus CRUD                  |     ~6 | reads `get_current_user`; writes `scheduling.manage`                                                                                                   |
| Eligibility (positions/bulk/roster/settings)              |     ~6 | member-facing reads `get_current_user`; roster/settings gated on `scheduling.manage`/`training.view_all`/`training.manage` (OR)                        |
| Department shift settings                                 |      2 | `scheduling.view` (read); `scheduling.manage` (write)                                                                                                  |
| Calendar feed (issue/rotate)                              |      2 | `get_current_user`, self-scoped                                                                                                                        |
| Platoons (overview/bulk-assign)                           |      2 | `scheduling.manage`                                                                                                                                    |

No route was found with zero auth dependency. No route gates a write with a
`.view`-level permission. `/dashboard/widgets` and its preference endpoints
deliberately require `scheduling.manage` rather than the baseline `.view`
grant, with an in-code comment explaining the reasoning (leadership reporting,
not operational data) — a correctly _tightened_ gate, not a weak one.

`scheduling_module_config.py` (3/3 routes: GET self-scoped `get_current_user`,
PUT/DELETE `scheduling.manage`) and `calcom_sync.py` (1/1 route:
`integrations.manage`) are both fully gated.

## Verified good ✅

- **SCH-1 through SCH-8 all still hold**, re-verified against current code,
  not carried forward from the doc: `self_signup=True` still guards the
  officer-auto-promote block (SCH-1); self-signup still rejects
  `CANCELLED`/finalized/past-dated shifts (SCH-2); `MAX_GENERATION_DAYS=366`
  still caps pattern generation (SCH-3); `shift_officer_id` and the
  hours-report `User` join are still org-validated (SCH-4);
  `manual_hours[].user_id` and `create_shift`/`update_shift`'s `apparatus_id`
  are still org-validated (SCH-6); `create_template`/`update_template`'s
  `apparatus_id` is still org-validated (SCH-7); `_get_apparatus_map` is still
  called with both arguments everywhere (SCH-8).
- **Every by-id lookup still filters `organization_id`.** Confirmed for
  `get_shift_by_id`, `get_shift_call_by_id`, `get_template_by_id`,
  `get_pattern_by_id`, `get_assignment_by_id`, `get_swap_request_by_id` /
  `get_swap_request_for_user_by_id`, `get_time_off_by_id` /
  `get_time_off_for_user_by_id`, and (new since the last audit)
  `StandingShiftService.get_claim` — each filters `organization_id` in its
  `WHERE` clause. `ShiftAttendance` has no `organization_id` column of its own;
  `update_attendance`/`remove_attendance` resolve it through a `JOIN Shift`
  that does carry the filter.
- **Every client-supplied foreign-key id is org-validated before being
  stored**, including on surface added since the last audit:
  `save_closeout_attendance`'s `entries[].user_id` (new close-out wizard),
  `_validate_training_slot_fields`'s `training_program_id` /
  `training_evaluator_id` (new training-slot assignment fields),
  `create_swap_request`'s `offering_shift_id` / `requesting_shift_id` /
  `target_user_id` (explicit IDOR-mitigation comment in code),
  `bulk_assign_platoon`'s `user_ids` (explicit "IDOR-safe" comment),
  `StandingShiftService.create`'s `apparatus_id`. One gap found and fixed —
  see SCH-9.
- **Capacity/locking (Pitfall #27) is correct on both the existing and the new
  locking surface.** `create_assignment` / `_validate_assignment_candidate`
  still locks the shift row (`for_update=True`) and both seat-count queries
  (`.with_for_update()`) — unchanged from the shape
  `test_capacity_locking.py::TestShiftSeatCapacity` already guards. New since
  the last audit: `review_swap_request` locks the swap request, then every
  participant `User` row, then every involved `Shift` row, then every involved
  `ShiftAssignment` row, in that order, before mutating; `respond_to_swap_offer`
  (the SCH-5-adjacent self-service accept path) locks the swap request, the
  offering shift, and the offered assignment, then re-validates via
  `_validate_assignment_candidate(..., enforce_capacity=True)` before moving
  the seat. No new count-then-insert pattern anywhere in the file lacks a lock.
- **No SQL injection / no LIKE surface at all** — zero `.like()`/`.ilike()`
  calls in `scheduling_service.py`; the one `text()` use is a static
  `"MINUTE"` literal passed to `func.timestampdiff`, not user input.
- **No Pitfall #12 JSON-mutation violations.** Every JSON-column write
  (`Shift.positions`, `.activities`, `ShiftCall.responding_members`,
  `ShiftTemplate.positions`, `ShiftPattern.schedule_config` /
  `.assigned_members`) either assigns a fresh object wholesale or, in the one
  genuinely-nested case (`reopen_shift`'s `activities` field), rebuilds a new
  dict via comprehension with a comment explaining why in-place mutation would
  be silently dropped.
- **Update payloads correctly distinguish omitted from explicit-null.** All
  five update methods in `scheduling_service.py` iterate only the keys present
  in a `model_dump(exclude_unset=True)` payload, which is the same semantic
  `apply_updates` exists to provide (though this file predates that shared
  utility and doesn't import it — no divergence in behavior found across any
  of the five sites).
- **`calcom_service.py` re-validates its outbound URL immediately before
  every outbound request** (`_assert_base_url_safe()` in both
  `test_connection` and `list_bookings`) — the pattern the checklist calls
  for, applied correctly to this integration's org-configurable
  `api_base_url` (self-hosted Cal.com support). **Correction, not a finding:**
  this narrows the DNS-rebinding TOCTOU window, it does not close it — see
  SCH-10, a pre-existing, repo-wide gap rather than a defect in this file.
- **`scheduling_module_config_service.py` deep-copies its module-level
  defaults** before returning them (`copy.deepcopy(DEFAULT_SHIFT_SETTINGS)`,
  with a comment naming Pitfall #12 explicitly) and builds fresh dicts on every
  write via `model_dump()` — no shared-reference aliasing.
- **`standing_shift_service.py` (570 L, new since the last audit) is
  correctly built**: `create()` validates a client-supplied `apparatus_id`
  in-org before storing it (with an explicit Pitfall #14 comment), caps series
  length at `MAX_SERIES_DAYS=366` (same DoS-prevention shape as SCH-3),
  delegates all capacity/eligibility/driver checks to the caller-supplied
  `assign` callable (`SchedulingService.create_assignment`) rather than
  reimplementing them, and its `StandingShiftClaim` model uses
  `ondelete="CASCADE"` (not `SET NULL`) on both foreign keys, so Pitfall #2
  does not apply.
- **`/scheduling/` is already in `UNCACHEABLE_PREFIXES`** in
  `frontend/src/utils/apiCache.ts`, covering every endpoint in this feature
  including the ones added since the last audit. The module's own
  `services/api.ts` uses the shared axios factory for auth/CSRF (Pitfall #7)
  — confirmed via its own `SEC:` comment naming the reason.
- **Separation of duties holds.** Manager swap review rejects both the
  requester and a targeted participant; time-off review rejects the
  submitting member. Rejected reviews leave the request pending, not silently
  approved.

## Findings

### SCH-9 — NIT (referential integrity, not cross-tenant) — `ShiftCall.responding_members` accepted a foreign user id — ✅ FIXED

**What:** `create_shift_call` and `update_shift_call` stored a client-supplied
`responding_members` list (user-id strings) straight into the `ShiftCall.
responding_members` JSON column with no in-org check — the one client-supplied
user-id write path in this file that didn't follow the pattern every other one
does (`manual_hours[].user_id`, `attendance_data.user_id`,
`save_closeout_attendance`'s `entries[].user_id`, `create_swap_request`'s
`target_user_id`, all of which validate via `_user_in_org` or an equivalent
before persisting).

**Where:** `app/services/scheduling_service.py` — `create_shift_call`
(was line 2052) and `update_shift_call` (was line 2100).

**Corrected impact (was overstated in the draft; caught by Codex review):**
the draft claimed a foreign id here could "inflate an unrelated org's
member's call count." It cannot. `compute_member_call_counts` is scoped to
one shift's own (already org-validated) attendance rows and only looks up
each attendee's own id in the count map
(`app/services/scheduling_service.py:6401-6403`) — a foreign id in the map
simply has no attendee to match. `ShiftCompletionService`'s trainee lookup is
the same shape: it validates `trainee_id` is in-org (or the shift is)
_before_ searching `responding_members` for it
(`shift_completion_service.py:282-310`), and searches only the one
already-org-scoped `shift_id` passed in — never scans other shifts or other
orgs for a matching id. So a foreign id here can never attribute a count to,
or affect a report for, another organization's member. There is no
cross-tenant failure scenario.

**Actual impact:** within-org referential integrity only. An org could store
an arbitrary or foreign-looking string as a "responder" on its own shift
call, which is inert noise (no attendee will ever match it) rather than a
security issue — but it's still the one write path in this file that didn't
validate a client-supplied user id, and the fix costs nothing.

**Fix:** both methods now validate every id in `responding_members` via a new
batched `_all_users_in_org` helper (one `IN` query rather than one
`_user_in_org` call per id — the schema allows up to 100 entries per payload,
so a per-id loop could cost 100 serial round trips; also caught by Codex
review), rejecting with "One or more members are not in your organization"
before the write — `create_shift_call` before `self.db.add(call)`,
`update_shift_call` before the `setattr` loop (only when the key is present
in the update payload). Guard tests:
`test_scheduling_org_scoping.py::TestShiftCallRespondingMembersScoping` (4
tests: create/update each reject a foreign id and a partial match, and
create accepts a fully in-org list).

### SCH-10 — LOW/MED (correction; repo-wide, not scheduling-specific) — the DNS-rebinding TOCTOU is narrowed, not closed — ✅ FIXED 2026-10-05 (direct connections)

**Resolution (2026-10-05, owner decision: pin the resolved IP via
`SSRFSafeAsyncTransport` in the shared factory plus `audit_ship`):**
`create_integration_client()` now wraps its direct transport in
`SSRFSafeAsyncTransport`, which resolves once, refuses a non-public answer,
and connects to the validated address with the original hostname kept for
`Host` and TLS SNI — so `calcom_service.py` and every other factory sender no
longer re-resolve at connect time. `audit_ship_service.py` builds its client
from the factory, with `AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION` carried through
as a pinned, metadata-refusing private opt-in. Guarded by
`backend/tests/test_integration_dns_pinning.py`. Residual: a request routed
through an egress proxy is not pinned (the proxy resolves, and httpcore's
`CONNECT` tunnel ignores `sni_hostname`), recorded in
`docs/KNOWN_LIMITATIONS.md`. The original finding follows unchanged.

**What:** the draft of this review claimed `calcom_service.py` "closes the
DNS-rebinding TOCTOU" by calling `assert_outbound_url_safe()` immediately
before each outbound request. Caught by Codex review: it does not close it.
`assert_outbound_url_safe` resolves the hostname once via
`socket.getaddrinfo()` to check it isn't private (`app/utils/
url_validator.py:105-116`), then returns — the actual request is a separate,
ordinary `httpx.AsyncClient.get()` call (`calcom_service.py:106-111,132-137`)
that performs its **own** independent DNS resolution when it connects. A
hostname that resolves to a public IP for the validation check and an
internal IP moments later for the connection (classic DNS rebinding) passes
the check and still reaches the internal address. The function's own
docstring is accurate about this and the draft's "Verified good" claim was
not: it says the check "shrink[s] the rebinding window... versus
save-time-to-send," not that it closes it.

**Where:** not specific to this feature. `assert_outbound_url_safe` has
**seven** callers across three transports — corrected after a second Codex
review caught this write-up's own first draft undercounting them as six and
implying one shared fix would cover all of them:

- Five go through the shared `create_integration_client()` (plain
  `httpx.AsyncClient`) and would share one remediation:
  `integration_services/{teams,webhook,slack,discord,calcom}_service.py`.
- `audit_ship_service.py` constructs its own `httpx.AsyncClient` directly,
  not through `create_integration_client` — a fix to the shared factory
  alone would not reach it.
- `push_service.py`'s `_send_one` dispatches through `pywebpush.webpush()`,
  not `httpx` at all — a synchronous library with its own connection
  handling, needing its own transport-specific fix rather than the
  httpx-level one the other five share.

`calcom_service.py` follows the established repo pattern correctly; the
pattern itself is the gap, and it is not one gap but (at least) three.

**Impact:** LOW/MED. Requires an attacker who controls DNS for a domain an
org has configured as an integration endpoint (webhook URL, self-hosted
Cal.com host, audit-ship collector) to flip its resolution within the
narrow window between the check and the connect — a real but hard-to-land
SSRF variant, not a trivially exploitable one.

**Fix:** not applied here. Closing this properly means pinning the
validated, resolved address for the actual connection (while preserving the
original Host header / SNI), separately for each of the three transports
above — not one shared-infrastructure change, and not a scheduling-module
fix, and a behavior change to how every integration
connects. Flagged for a dedicated cross-cutting pass (the shape SEC-00 exists
for), not fixed unilaterally here. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

## Schema & migration notes

`standing_shift_claims` (added `20260823_1400_e7a41b6d09c2`) is the only table
this feature owns that's new since the last audit. Both foreign keys
(`organization_id`, `user_id`) use `ondelete="CASCADE"` with `nullable=False`
— not `SET NULL`, so Pitfall #2's nullability requirement doesn't apply.
Indexed on `(organization_id, is_active, weekday)` for the shift-creation
reader's lookup pattern. No other schema changes this iteration; migration
chain validated at a single head (`b272a5d5535c`, 371 revisions).

## Guard tests added

- `test_scheduling_org_scoping.py::TestShiftCallRespondingMembersScoping` — 4
  tests, asserting SCH-9: create and update each reject a foreign
  `responding_members` id, update rejects a partial match (one valid id
  alongside one foreign id), and create accepts a fully in-org list —
  exercising the batched `_all_users_in_org` check rather than the
  since-replaced per-id loop.

## Completion gate

| Check                                                                                                                                                                                    | Result                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (changed files)                                                                                                                                            | ✅ 0 violations                                                 |
| `black --check app/ tests/ alembic/` (changed files)                                                                                                                                     | ✅ clean                                                        |
| `isort --check-only app/ tests/ alembic/` (changed files)                                                                                                                                | ✅ clean                                                        |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                        | ✅ single head, 371 revisions                                   |
| `pytest tests/test_scheduling_org_scoping.py tests/test_scheduling.py tests/test_call_tracking.py tests/test_scheduling_module_config_service.py tests/test_calcom_bookings_endpoint.py` | ✅ 196 passed                                                   |
| `pytest tests/` (full backend suite)                                                                                                                                                     | ✅ 8546 passed, 22 skipped (pre-existing Docker/no-MySQL skips) |
| `tsc --noEmit` / `eslint .`                                                                                                                                                              | n/a — no frontend file changed this iteration                   |

---

## Pass 2 (2026-08-28) — 1 fix (test), 2 stale-doc corrections (SCH-5 resolved; migration scope; `_account_is_active` purpose), 0 new findings

**PR:** #1968 (was mis-cited as #1966 in an earlier revision of this
section — corrected) · **Scoped since pass 1's merge:** `5d19cefa` (PR #1847,
the Codex-follow-up merge — the final state pass 1's doc reflects, not the
earlier `c92f0438`/#1846 merge that preceded it).

**Codex follow-up (same PR, same day):** three P2 findings against this
pass's own first draft — a real scope gap (a migration search that never
looked in `alembic/versions/`), a real test-strength gap (SCH-11's cited test
couldn't have caught the regression it was named for), and a real
mechanism-accuracy error (the `_account_is_active` write-up, and the
identical claim in the code's own docstring, both misattributed to a
"stale session" gap that `get_current_user` already closes on every request).
All three verified independently against the current code before acting;
none dismissed. See the migration-review subsection, the SCH-11 correction,
and the `_account_is_active` correction below for each.

### Scope

`git diff --stat 5d19cefa..HEAD` on the three declared endpoint files plus
`scheduling_service.py`, `scheduling_module_config_service.py`,
`standing_shift_service.py`, `integration_services/calcom_service.py` shows
real (non-byte-identical) churn in three files: `scheduling.py` (+20/-20),
`scheduling_service.py` (+6/-1), `scheduling_module_config_service.py`
(+70/-0, all-new).

**Correction (Codex review of this PR):** the line above originally read "No
new migration touches a scheduling table... since pass 1." That was false —
`backend/alembic/versions/20260826_1400_e2c8f5a71d40_canonicalize_paramedic_seat.py`
was added in this exact range (`Create Date: 2026-08-26 14:00:00`, after pass
1's `5d19cefa` scope point) and rewrites both `shifts.positions` and
`shift_templates.positions`. The `git diff --stat` command that produced the
claim above was scoped to the six declared source files and never listed
`alembic/versions/` at all, so it could not have found a migration if one
existed — the check that ran and the claim it was used to support did not
match. Reviewed in full below, in its own subsection rather than folded into
the file list above, precisely so a future pass greps for "migration" and
finds it.

**Adjacent-file grep, per the EC-14 lesson** (files referencing `ShiftCall`,
`ShiftSwapRequest`, `ShiftAssignment`, `StandingShiftClaim`,
`SchedulingService`, `standing_shift_service`, `calcom_service`,
`scheduling_module_config` outside the declared list, changed since
`5d19cefa`): `api/v1/api.py` and `models/__init__.py` (both incidental —
adding the unrelated new Testing Checklist module's router/model imports, no
scheduling-relevant lines touched); `models/training.py` (+23/-1, the
`grants_qualification` column on `TrainingCourse` — unrelated to scheduling —
plus a new `ShiftPosition.PARAMEDIC` member, reviewed below);
`schemas/scheduling.py` (+18/-3, `ShiftPosition.PARAMEDIC` +
`PositionEligibilitySource.expires_on`, reviewed below);
`email_template_service.py` (+2, an unrelated inventory-feature docstring
key, no code path); `nfc_tag_service.py` (+15/-5, the AP-13 pass 2 fix already
reviewed and merged under that rotation feature, not this one);
`scheduled_tasks.py` (+168/-30, CRON2-31 dedup/rollback-safety fixes to the
shift-start-reminder and post-shift-validation cron tasks, reviewed below);
`shift_eligibility_service.py` (+90/-43, a real security fix — reviewed
below — landed via a different feature's PR, already applied by Codex on that
PR, not newly found here).

**Frontend, swept broadly rather than scoped to `modules/scheduling/`** (the
same correction feature 06's pass 2 had to make for `BallotBuilder.tsx`):
`modules/scheduling/` (56 files, 4 changed — `services/api.ts`,
`types/index.ts`, `types/shiftSettings.ts`, and
`ApparatusTypeDefaultsCard.tsx` — all reviewed below) plus, **newly
identified this pass**, `pages/scheduling/` — 81 files, ~34,000 lines,
**never mentioned in any prior scheduling review** (module-audit, app-review,
or SCH-15 pass 1 — confirmed by grep, zero hits for the path in any of the
three). This directory holds real scheduling UI outside `modules/scheduling/`
proper: the shift board (`board/ShiftBoard.tsx`, `MonthGrid.tsx`,
`DayDetailPanel.tsx`, `GiveUpShiftModal.tsx`, `StandingShiftModal.tsx`,
`ShiftSeatList.tsx`, `PhoneDaySheet.tsx`, `PhoneMonth.tsx`), `MyShiftsTab.tsx`,
`OpenShiftsTab.tsx`, `RequestsTab.tsx`, `ShiftCloseoutWizard.tsx`,
`ShiftReportsTab.tsx`, `PositionRosterPage.tsx`, `SchedulingPlatoonsPage.tsx`,
`SchedulingSettingsPage.tsx`, `DriverExceptionsPanel.tsx`, and more — alongside
a large amount of equipment-check UI already covered by EC-14's own frontend
sweep (`EquipmentCheckForm.tsx`, `CheckLogPage.tsx`, `CheckLap.tsx`, etc.,
which live in the same directory). Only **one** file under `pages/scheduling/`
changed since pass 1 (`PositionRosterPage.tsx` + its test, +72/-11) — read in
full (below). The other 79 files were swept with the same targeted greps
EC-14 used for its equipment-check frontend pages
(`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
`.toLocale*`, direct `fetch()`) rather than read line-by-line — noted as
partial-scope, not assumed clean, consistent with how EC-14 pass 2 flagged its
own equivalent grep-only sweep.

### Migration review (added on Codex follow-up) — `e2c8f5a71d40` — ✅ reviewed, clean

`20260826_1400_e2c8f5a71d40_canonicalize_paramedic_seat.py` rewrites stored
crew-seat entries so a case variant of "paramedic" (`"Paramedic"`, `"PARAMEDIC"`,
...) folds onto the canonical `"paramedic"` token, matching what
`app/utils/positions.canonical_position` now does on every write. Checked
against `CHECKLIST.md` dimension 7 (schema & migration integrity):

- **Guards a `create_all`-only table (Pitfall #26).** `upgrade()` calls
  `_has_table(table)` before touching any of its four targets
  (`basic_apparatus`, `shifts`, `shift_templates`, `apparatus`) and also checks
  the column is present, so it is a no-op — not a crash — against a database
  that has not run `create_all` yet (e.g. CI's `alembic upgrade head` against
  an empty schema). Confirmed by reading `_has_table`/`upgrade()` directly.
- **Idempotent.** `_settle()` returns `None` (skip the row) when folding
  produces no change, so a second run of the same migration touches zero rows
  the first run already settled — re-running it is a no-op, not a
  double-write.
- **Correctly scoped — does not destroy or rename data it shouldn't.**
  `_canonical()` only case-folds the exact string `"paramedic"`; every other
  spelling (a department's own custom seat, e.g. `"Medic"`) passes through
  `_settle()` unchanged, matching the explicit intent in the module docstring
  and in `app/utils/positions.py`'s own docstring (custom seat names must
  round-trip verbatim). It also preserves the stored _shape_ — a string entry
  stays a string, a `{"position", "required"}` dict stays a dict — rather than
  reshaping into `normalize_stored_positions`'s output; that full reshape was
  already done by the earlier `20260819_2037_1eeb053d59b7`, and folding a name
  is the only thing this migration is for.
- **Irreversible, and documented as such for a specific reason.** `downgrade()`
  is a no-op with a docstring pointing at the module-level explanation: nothing
  records which spelling a row originally carried, so rewriting `"paramedic"`
  back to a capitalized form would corrupt rows that were always correct.
- **Follows an established, already-reviewed precedent exactly.** Its sibling
  migration from the same day, `20260826_1200_d7a4e9c31b60_canonicalize_crew_seat_names.py`
  (`"EMT"` → `"ems"`), has the identical shape — frozen inlined vocabulary
  (not imported from `app/utils/positions.py`, per Pitfall #20's "a migration
  must keep transforming rows the way it did the day it ran"), the same
  `_has_table`/column guard, the same no-op downgrade for the same reason. This
  migration is the second application of a pattern already proven safe, not a
  new one.

No fix needed. This was a scope gap in how the migration was searched for
(see the correction above), not a defect in the migration itself.

### Verified good ✅ (re-confirmed by reading the current code, not re-citing the doc)

- **Route/permission enumeration re-run from scratch** (AST walk over all
  three endpoint files, not a diff against pass 1's table): **96/96 routes**
  (92 + 3 + 1, unchanged) carry a recognized auth dependency
  (`get_current_user`, `require_permission(...)`, or
  `get_optional_current_user`) — 0 routes with no auth dependency. Matches
  pass 1's inventory with no regression.
- **SCH-9's fix is intact at its current lines**: `create_shift_call`
  (`scheduling_service.py:2057-2098`) and `update_shift_call`
  (`:2128-2152`) both still call the batched `_all_users_in_org` guard before
  persisting `responding_members`, unchanged in shape from pass 1.
- **SCH-10 remains accurately flagged** and is already being tracked
  cross-cuttingly outside this feature: `KNOWN_LIMITATIONS.md`'s entry was
  updated by the training-extended pass (TRX-18) to 8 call sites (was 7 at
  SCH-15 pass 1); no correction needed from this pass.
- **`ShiftPosition.PARAMEDIC`** (new enum member, `models/training.py`,
  `schemas/scheduling.py`) backs a MySQL `Enum(...)` DDL column
  (`shift_assignments.position`, `standing_shift_claims.position` — confirmed
  by reading the column definitions directly, not assumed) and needs no
  migration: `standing_shift_claims`/`shift_assignments` are both listed in
  `app/utils/enum_normalization.py`'s `_TARGET_COLUMNS`, which widens the
  live MySQL `ENUM(...)` DDL to match the Python enum's current value set on
  **every** startup (`main.py:1510`, unconditional, not fresh-install-only) —
  confirmed by reading `_normalize_one`'s comparison
  (`set(current) == set(target)`) rather than assuming the comment's claim.
- **`apparatus_type_defaults_for_org`** (new, `scheduling_module_config_service.py`)
  reads `Organization.organization_type` filtered on the caller's own
  `organization_id` (never a client-supplied id) — no tenant-isolation or
  injection surface; a read-only display concern (EMS-only orgs no longer see
  fire apparatus types in the picker fallback).
- **The RBAC-position-eligibility fix is real and already applied**
  (`a72fed15`, authored by Codex on a different feature's PR, landed on `main`
  before this pass): `shift_eligibility_service.py` no longer resolves a
  member's _held RBAC position_ (an org-chart/role slug like `captain`) as a
  source of _operational_ shift-position eligibility — the removed comment in
  the diff states the reason directly: a role manager could otherwise create
  a position and grant themselves shift eligibility through it. Verified by
  reading the current `_get_slug_eligibility_map`/`get_eligible_positions`,
  not by trusting the commit message: the map is built only from
  `operational_ranks` and qualification/training data now, and
  `_get_held_position_slugs`'s result is deliberately discarded (called and
  ignored, per the inline comment, "for compatibility with lightweight
  session adapters"). Also verified: the new `_account_is_active` gate runs
  **ahead of** the open-to-all-shift bypass in both `get_eligible_positions`
  and `get_eligible_positions_bulk`. **Correction (Codex review of this PR):**
  the original write-up described this as closing a "stale session" gap —
  wrong, and the code's own docstring made the same claim before this pass
  corrected it too. `get_current_user` calls
  `AuthService.get_user_from_token` (`app/services/auth_service.py:684-778`),
  which reloads the `User` row from the database on **every** request and
  returns `None` unless `user.is_active` holds (`status == ACTIVE` and no
  `deleted_at`, `app/models/user.py:515-518`) — so a member's own session is
  already rejected on the very next request after their status changes,
  regardless of this gate. The per-request `request.state` cache in
  `get_current_user` (`app/api/dependencies.py:121-123`) doesn't reopen that
  window either: it's built from that same request's fresh DB read, not
  carried across requests.

  The actual, narrower gap `_account_is_active` closes:
  `_validate_assignment_candidate`'s `enforce_position_eligibility` branch
  (`scheduling_service.py:2982-2991`) loads the _candidate_ by a
  client-supplied `user_id` with **no** status or `deleted_at` filter, and
  that candidate is not always the caller's own session — `create_assignment`
  calls it with `self_signup=False` when an officer assigns a _different_
  member to a shift. An officer's own session is perfectly valid throughout;
  the target's retired/suspended/on-leave status was never checked by
  anything before this fix, because that member's session — valid or not —
  is never consulted on this path at all. Fixed the same inaccurate claim in
  the code's own docstring (`shift_eligibility_service.py:200-225`) in this
  pass, so the mechanism is now stated correctly at its source, not just
  here.

- **`scheduled_tasks.py`'s CRON2-31 changes to the two scheduling-specific
  cron tasks** (`run_shift_reminders`, `run_post_shift_validation`) are
  dedup/rollback-safety correctness fixes, not security changes, and remain
  org-scoped throughout: both iterate `Organization` rows and issue every
  inner query filtered to `Shift.organization_id == str(org.id)` (or against
  ids drawn from that already-org-scoped shift), the same pattern EC-14 pass
  2 verified for the equipment-check reminder task in this same file.
- **`ShiftReportsTab.tsx`'s auto-save draft** (`saveDraft`/`loadDraft`/
  `deleteDraft` from `utils/shiftReportDrafts.ts`, `shift-report-draft-*`
  localStorage keys) is swept by the same `clearAllDrafts()` logout purge
  EC-14 pass 2 confirmed for the equipment-check draft namespace — traced
  here for the first time specifically against the scheduling shift-report
  key: `clearAllDrafts()` matches both `DRAFT_KEY_PREFIX` ("shift-report-draft-")
  and `EQUIPMENT_CHECK_DRAFT_KEY_PREFIX`, and the file's own `SEC (FE-6)`
  comment names member PII/operational notes as the reason.
- **`PositionRosterPage.tsx`** (the one `pages/scheduling/` file that
  changed since pass 1) read in full: the new qualification-expiry badge uses
  `formatCalendarDate`/`calendarDaysFromToday` from the approved
  `dateFormatting.ts` (no banned `.toLocale*`/raw `Date` formatting), and
  every rendered `source.label` goes through plain JSX text interpolation
  (React-escaped), never `dangerouslySetInnerHTML` — no XSS surface from the
  new training-program/qualification label text.

### Findings

#### SCH-11 — NIT (doc correction, plus a Codex-follow-up test fix) — SCH-5 was already resolved, not open — ✅ FIXED

**What:** `KNOWN_LIMITATIONS.md` (two separate rows), `docs/module-audit/scheduling.md`,
and `docs/app-review/scheduling.md` all still described SCH-5 ("swap
accept-path skips target re-validation + a looser approver-identity check
than manager review") as **Open**, deferred for an owner decision. SCH-15
pass 1 (2026-08-26) noted the current `respond_to_swap_offer` method in its
"Verified good" section as "SCH-5-adjacent" — reviewed for capacity locking
(Pitfall #27) — but never connected that to closing the SCH-5 finding itself,
so the stale "Open" status persisted through pass 1 unchanged.

**Where:** `docs/KNOWN_LIMITATIONS.md` (both the combined SCH-5/6 row and the
standalone SCH-5 row), `docs/module-audit/scheduling.md:71`,
`docs/app-review/scheduling.md:134,162`.

**Investigation:** `respond_to_swap_offer` (`scheduling_service.py:4263-4409`,
introduced `0fd34614`, 2026-08-24 — two days before pass 1, not new this
pass) is a deliberate redesign, not a partial fix: it replaced the general
"accept a swap" path with a narrower **one-way offer** accept, and the
docstring states explicitly that "a two-way exchange moves two rosters and
stays with the manager review that exists for it" — confirmed by reading
`respond_to_swap_offer` itself (rejects with "A two-way swap has to be
reviewed by a duty officer" whenever `requesting_shift_id` is set) and by
enumerating the swap-request routes (`get`, `review`, `respond`, `cancel` —
no fifth "self-accept a two-way swap" route exists). Both SCH-5 sub-claims no
longer hold against the current code:

- **"Target shift's state (capacity, cancellation, finalization) is not
  re-validated at accept time"** — it now is:
  `_validate_assignment_candidate(require_mutable=True, reject_past=True,
enforce_capacity=True)` is called before the seat moves
  (`scheduling_service.py:4363-4373`), and `require_mutable` rejects both
  `ShiftStatus.CANCELLED` and `shift.is_finalized`
  (`scheduling_service.py:2825-2829`) — read directly, not assumed from the
  parameter name.
- **"The approver-identity check is looser than the manual-review path"** —
  it is now a strict equality check: `str(swap_request.target_user_id) !=
str(responder_id)` rejects with "This offer was not made to you"
  (`scheduling_service.py:4305-4308`), before any other validation runs.

Two-way exchanges (the case SCH-5's own capacity/cancellation/finalization
concern is sharpest for, since a seat swap moves two rosters) are unaffected
by this class of gap at all: they can only be approved through
`review_swap_request`, which SCH-15 pass 1 already verified re-validates
fully and enforces separation of duties, and which this pass re-read in full
(`scheduling_service.py:4030-4261`) and confirms unchanged.

**Test coverage:** `tests/test_swap_offer_response.py` (17 tests at the time
this pass first ran, added in the same commit range as the redesign)
exercises the two claims above by name (`test_only_the_member_it_was_offered_to`,
`test_not_the_offerer_themselves`,
`test_an_ineligible_accepter_is_refused_and_the_seat_stays_put`,
`test_a_two_way_swap_still_goes_to_a_duty_officer`) plus a
`test_approved_time_off_is_rechecked_not_only_at_candidate_selection` case
the original SCH-5 write-up didn't anticipate.

**Correction (Codex review of this PR) — the coverage claim for the
cancelled/finalized-shift half was wrong; fixed, not just corrected in
prose.** `test_the_acceptance_path_runs_that_validation` was cited above as
guarding the "target shift's live state is re-validated at accept time"
sub-claim. It does not: it is `assert "_validate_assignment_candidate" in
inspect.getsource(...)`, a check on the _text_ of the calling method, and
every other test in the file replaces `_validate_assignment_candidate` with a
bare `AsyncMock(return_value=validation_error)` — so none of the 17 could
fail if `require_mutable=True` were dropped from the call, or if
`_validate_assignment_candidate`'s own `CANCELLED`/`is_finalized` check broke.
Verified by reading the test file directly, not by taking the finding on
faith. Two changes now close this, in `tests/test_swap_offer_response.py`:

1. `test_the_seat_being_handed_over_is_excluded_from_the_checks` (which
   already inspects `_validate_assignment_candidate`'s call kwargs for other
   arguments) now also asserts `kwargs["require_mutable"] is True` and
   `kwargs["reject_past"] is True` — this fails if either argument is dropped
   from the call, which the mocked style can support since it's the call
   itself, not the mock's internal logic, under test.
2. Two new tests, `test_a_cancelled_shift_is_rejected_at_acceptance` and
   `test_a_finalized_shift_is_rejected_at_acceptance`, run the **real**
   `_validate_assignment_candidate` — no mock — against a shift whose
   `status`/`is_finalized` marks it immutable, and assert
   `respond_to_swap_offer` returns `"Shift was cancelled"` /
   `"Shift was finalized"` and leaves the assignment and swap-request status
   untouched. `require_mutable`'s checks run before any further database
   access in `_validate_assignment_candidate`, so the existing
   `_Session` test double (which only queues three canned rows) needs no
   changes to reach them. Confirmed both new tests fail (with
   `require_mutable=False` swapped in temporarily) and the strengthened kwarg
   assertion fails the same way, then confirmed all 19 pass against the
   unmodified code.

All 19 tests (17 + 2 new) confirmed passing against current `main`.

**Impact:** the SCH-5 resolution itself is unaffected — `respond_to_swap_offer`
was already correct, re-read directly at its current lines in this pass. What
was wrong was the _evidence_ offered for it: a test that would not have
caught the regression it was cited as guarding against. That gap is now
closed by the two changes above, not by re-describing the existing test.

**Fix:** updated the four documents above to mark SCH-5 (and the also-stale
"SCH-6 manual_hours has no bound" half of the combined `KNOWN_LIMITATIONS.md`
row — SCH-6's `hours` value was already `Field(gt=0, le=48)` at the schema
even at the time that row was written, per the app-review doc's own "Not a
finding" note) resolved, each citing the specific mechanism and test file
above rather than a bare "fixed" claim. Guard tests added this follow-up —
see above and "Guard tests added (pass 2)" below.

### No new findings

Every other checklist dimension came back clean on the files that actually
changed since pass 1: no new `.like()`/`.ilike()` call (still zero in
`scheduling_service.py`); no new CSV/export surface; no new JSON-column
mutation (the two changed service files don't touch `Shift.positions`/
`.activities`/`ShiftCall.responding_members`/`ShiftPattern.*`); no new
client-supplied FK id reaching a write path unvalidated (`apparatus_type_defaults_for_org`'s
only input is the caller's own `organization_id`); no new `SET NULL` FK
without `nullable=True` (no new columns at all this pass); no new
capacity/count-then-insert pattern requiring a Pitfall #27 lock.

## Guard tests added (pass 2)

- `tests/test_swap_offer_response.py::TestAcceptance::test_the_seat_being_handed_over_is_excluded_from_the_checks`
  — strengthened (not new) to also assert `require_mutable=True` and
  `reject_past=True` on the `_validate_assignment_candidate` call.
- `tests/test_swap_offer_response.py::TestTheValidationIsRecheckedAtAcceptance::test_a_cancelled_shift_is_rejected_at_acceptance`
  — new, runs the real (unmocked) validation against a `CANCELLED` shift.
- `tests/test_swap_offer_response.py::TestTheValidationIsRecheckedAtAcceptance::test_a_finalized_shift_is_rejected_at_acceptance`
  — new, same shape against a finalized shift.

Added on Codex follow-up (see the SCH-11 correction above) — the original
pass 2 claimed no guard test was needed here, which was itself wrong; see that
correction for why.

## Completion gate (pass 2, including the Codex follow-up)

| Check                                               | Result                                                                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                       | ✅ 0 violations                                                                                                                                                        |
| `black --check app/ tests/ alembic/`                | ✅ 1323 files unchanged                                                                                                                                                |
| `isort --check-only app/ tests/ alembic/`           | ✅ clean (installed, not skipped)                                                                                                                                      |
| `python3 scripts/validate_migrations.py --strict`   | ✅ single head, 389 revisions                                                                                                                                          |
| `pytest tests/ -q -k "scheduling or shift or swap"` | ✅ 716 passed, 1 skipped (pre-existing optional-dep skip)                                                                                                              |
| `pytest tests/` (full backend suite)                | ✅ 9181 passed, 22 skipped (pre-existing Docker/no-MySQL) — +2 over the pre-follow-up baseline of 9179, the two new `test_swap_offer_response.py` tests, 0 regressions |
| `tsc --noEmit`                                      | ✅ 0 errors (no frontend file changed this follow-up)                                                                                                                  |
| `eslint .`                                          | ✅ 0 errors, 10 warnings (pre-existing, same set as SEC-00)                                                                                                            |

## Pass 3 (2026-09-03) — 1 fix, 0 flagged, 1 new finding (SCH-12)

**Revision note.** Two rounds of Codex review corrected this draft.

The first caught two real scope gaps and one real correctness gap, all
corrected below rather than argued with:

1. The baseline commit (`299a163a`) was itself a scheduling change
   (`shifts.template_id` plus its org-validation in `create_shift` and
   pattern generation) — using it as the diff's exclusive lower bound
   silently excluded its own content. Re-reviewed against `299a163a` itself
   (see "Reviewed on the Codex-caught baseline gap" below); clean, no
   finding.
2. "Four frontend files" undercounted the real diff — 17 more files in
   `modules/scheduling/` and `pages/scheduling/` had genuine (non-deletion)
   changes and were not read, only grep-swept for banned patterns. All 17
   now read in full (see below); clean, no finding, but the draft's "read in
   full" claim was false for them and is corrected here.
3. **SCH-12 (LOW, fixed)** — a real TOCTOU gap in `create_template`'s
   two-write structure that the draft's own "a bad id never leaves an orphan
   template row" claim overstated. See the finding below.

The draft also recorded the completion gate as green without having run the
frontend test suite or build — CLAUDE.md's own gate doesn't list them as
mandatory the way flake8/pytest/tsc/eslint are, but a pass claiming "full
completion gate green" should not omit checks it has the means to run. Both
now run; see the gate table.

The second round, against the commit that fixed the first round, caught two
more real gaps:

4. **The SCH-12 fix's `except Exception` was too broad.** It caught any
   failure inside the nested savepoint — not just the expected FK
   violation — and misreported all of them as "Equipment checklist not
   found," which would hide a genuine bug (a query error, an ORM defect)
   behind a wrong, misleading message. Narrowed to `except IntegrityError`;
   anything else now propagates to the app's global unhandled-exception
   handler (`main.py`, logs to `error_logs` and returns a generic 500)
   instead of being silently mischaracterized.
5. **The corrected file count (21) was still short.** The actual
   added/modified set in `modules/scheduling/`+`pages/scheduling/` against
   the corrected baseline is 29 files (Codex counted 30 against a
   marginally later commit that had one more), not 21 — seven test files
   and one type file were grep-swept but not read, and a third scheduling
   migration (`20260831_0003_..._drop_equipment_check_settings.py`) was
   never in scope at all. All now reviewed; see below.

**Baseline:** `299a163a^` (the parent of `299a163a`, 2026-08-31 — the
correction above), the true last commit before the first post-pass-2 change
to any declared file. Pass 2's own merge commit is no longer reachable in
this worktree's shallow history, the same gap EC-14 pass 3 hit; the shallow
clone was deepened to reach this point. Five-plus days of `main` sit between
it and this pass, dominated by the 2026-08-31 move of equipment-checklist
ownership from Scheduling to Inventory (already reviewed under EC-14 pass 3)
and a new Claude MCP integration (`app/mcp/`, not a declared file of this
feature — see below).

**Diff-scoped, not re-read whole.** Against the corrected baseline, real
churn is in: `scheduling_service.py` (+269/-38, including `299a163a`'s own
`template_id` addition), `scheduling_module_config_service.py` (-6, a dead
settings field removed), the two new migrations, and 21 frontend files
(`modules/scheduling/` and `pages/scheduling/` combined) — up from the four
originally read. `scheduling.py`, `scheduling_module_config.py`,
`calcom_sync.py`, `standing_shift_service.py`, `calcom_service.py` remain
byte-identical to pass 2. All changed files now read in full, not sampled.

### Reviewed this pass

- **New client-supplied FK id list, validated correctly (XC-1/Pitfall #14c).**
  `create_template`/`update_template` gained an `equipment_check_template_ids`
  field (a shift template naming which Inventory checklists its shifts
  carry, part of the same EC-14 module move). `_validated_check_ids`
  (`scheduling_service.py`) queries `EquipmentCheckTemplate.id.in_(wanted)`
  filtered on `EquipmentCheckTemplate.organization_id == organization_id`
  **before** `_crud_create`/`_crud_update` writes anything — deliberately
  ordered that way per an in-code comment, because the create path commits
  the template first and validating after it left an orphan row behind on a
  bad id **known at request time**. A bad id that only becomes bad _after_
  validation (deleted concurrently) is a distinct gap — see SCH-12 below;
  the ordering here does not cover that case, and this pass's first draft
  overstated that it did. `_replace_equipment_check_links` writes
  `ShiftTemplateEquipmentCheck` rows with a server-set `organization_id`
  (never client-supplied) and replaces the set atomically (unticked links
  deleted, not merely left). Frontend (`TemplateFormModal.tsx`) sends the
  field unconditionally on every save, including an empty array, with an
  explicit CLAUDE.md Pitfall #1 comment — an update payload read with
  `exclude_unset` means an omitted key silently keeps stale links, which the
  code avoids. Verified good, no finding.
- **Two new migrations, both correctly guarded.**
  `20260831_0001_fab0ab7897d3_add_shift_template_id.py` adds
  `shifts.template_id` — `ondelete="SET NULL"` with `nullable=True`
  (Pitfall #2 holds) — guarded on `shifts` existing first (Pitfall #26,
  `shifts` is a `create_all`-only table) and on `shift_templates` existing
  before adding the FK. `20260831_0002_191a99d1d16f_...` creates
  `shift_template_equipment_checks` with all three FKs `ondelete="CASCADE"`
  - `nullable=False` (not `SET NULL`, so Pitfall #2 doesn't apply) and a
    `(shift_template_id, equipment_check_template_id)` unique constraint. Both
    read in full; no schema-integrity gap.
- **`get_member_visible_shifts` closed its own unbounded-read gap.** Pass 1/2
  did not flag this as it stood then, but the current code now bounds the
  date window to `MEMBER_SHIFT_WINDOW_DAYS=366` via a new
  `_bound_shift_window` helper whenever either end of the range is open or
  the caller's explicit range exceeds it — matching the DoS-prevention shape
  `/shifts/open` already used (SCH-3's pattern). Before this pass's baseline
  commit the method had no such bound; verified the current code closes it,
  not a regression to flag.
- **New `open_to_all_only` parameter on `get_shifts`/`get_summary` — checked
  its only two call sites.** Not called from `scheduling.py` (the declared
  endpoint file, byte-identical to pass 2) at all — its only callers are the
  new `app/mcp/tools/scheduling.py` (`list_shifts`, `get_scheduling_summary`),
  passed as `not principal.expose_full_schedule`. Read that file in full
  (377 L): every query filters `Shift.organization_id ==
principal.organization_id` (the MCP principal's own org, not
  client-suppliable), `_visible_shift_criteria` and `list_open_shifts` both
  add the `open_to_all_members` restriction unless the connection is
  explicitly configured for the elevated view, notes go through
  `scrub_text` (redaction) before being returned, and every listing is
  bounded (`clamp_limit`, `MAX_OPEN_SHIFT_CANDIDATES=500`,
  keyset-cursor pagination) — no unbounded read, no cross-tenant leak, no
  raw SQL. `app/mcp/` (5,068 L total) is a large new cross-cutting
  integration spanning most modules, not a declared file of this feature and
  not reviewed beyond the scheduling-specific tool file above; it already
  has its own `docs/KNOWN_LIMITATIONS.md` entry ("Claude (MCP)", added
  2026-09-03) from its own review process outside this rotation, so no
  duplicate flag added here.
- **`get_summary` now resolves the department's own timezone**
  (`resolve_scheduling_timezone`) instead of a bare `date.today()` (UTC) for
  its "this week"/"this month" boundaries — a correctness fix (SCH-15 has no
  prior finding about it), not a new attack surface: the org id driving the
  lookup is the caller's own, same as every other org-scoped read in this
  file.
- **Frontend settings-panel changes are the same module-move consolidation
  EC-14 pass 3 covered from the Inventory side.** `ShiftSettingsPanel.tsx`
  and `ShiftReportsSettingsPanel.tsx` had their `equipment_check_settings`/
  `checklist_timing` editors removed (now edited in Inventory) and replaced
  with signpost links gated on the same permissions the destination routes
  require (`inventory.check_manage`, `settings.manage` OR
  `organization.update_settings`) — read in full, no privilege-escalation
  shape (a link to a page the viewer cannot use is hidden, not merely
  disabled). `ShiftReportsSettingsPanel.tsx`'s own comment documents why it
  must send only `post_shift_validation` rather than the whole
  `shift_reports` object now that `checklist_timing` lives on the same key
  but is saved from Inventory: sending the full object from both screens
  would let whichever saved last silently revert the other's setting — a
  real deep-merge-payload concern, verified against the code, not asserted.
  `positionLabels.ts` (new, 54 L) is a display-only token→label mapper with
  no backend call and no injection surface (values interpolated as plain JSX
  text).
- **No new banned pattern.** `grep` across `modules/scheduling/` and
  `pages/scheduling/` for `window.confirm`/`alert`/`prompt`,
  `dangerouslySetInnerHTML`, banned `.toLocale*`, and `date-fns` imports: zero
  hits.

### Reviewed on the Codex-caught baseline gap

`299a163a` itself (excluded by the draft's baseline choice — correction
above) adds `Shift.template_id` (`models/training.py`, `ondelete="SET NULL"`

- `nullable=True`, Pitfall #2 holds), the matching `ShiftCreate.template_id`
  / `ShiftResponse.template_id` schema fields, and the org-validation in
  `create_shift`: a client-supplied `template_id` is checked against
  `ShiftTemplate.id == template_id, ShiftTemplate.organization_id ==
organization_id` before being stored (XC-1/Pitfall #14c) — not merely a
  dangling-FK risk, since this id decides which checklists a crew is shown.
  Pattern-generation's own stamp (`template_id=getattr(template, "id", None)`)
  uses a template object already resolved through an org-scoped path, not a
  second client input. The migration itself
  (`20260831_0001_fab0ab7897d3_...`) was already reviewed above (it was in the
  originally-declared diff, just its source-file counterpart was not) —
  correctly guarded on `shifts` and `shift_templates` both existing first
  (Pitfall #26). Verified good, no finding — the gap was in this pass's scope,
  not in the code.

### Reviewed: the 17 frontend files the first draft grep-swept but did not read

All read in full this revision. Every one is the same mechanical rollout
already described above for the four originally-read files: a
`POSITION_LABELS[token]` raw lookup replaced with the new `positionLabel()`
helper (`modules/scheduling/components/TemplatesOverviewCard.tsx`,
`pages/scheduling/{CrewBoardSlot,MyShiftsTab,OpenShiftsTab,PositionEditor,
PositionRosterPage,ShiftDetailPanel,ShiftReportsTab}.tsx`,
`pages/scheduling/board/{GiveUpShiftModal,PhoneDaySheet,ShiftSeatList}.tsx`)
— every call site interpolates the result as plain JSX text, never
`dangerouslySetInnerHTML`, so no injection surface moved with the rename;
two static navigation-target updates from the old in-scheduling equipment-
check route to the new Inventory one (`ShiftCheckInPage.tsx`,
`ShiftDetailPanel.tsx`), consistent with the module move EC-14 pass 3
covered; and type/export housekeeping for the same move
(`modules/scheduling/index.ts`, `services/api.ts`,
`types/shiftSettings.ts`, `components/shiftTemplateTypes.ts`,
`components/schedulingSettingsSections.ts` — the last two also carry the new
`equipment_check_template_ids` field already reviewed on the backend side).
No new API call, no new user-input sink, no privilege-escalation shape.
Verified good, no finding.

### SCH-12 — LOW (fixed, revised twice more on further Codex rounds) — `create_template` could leave a checklist-less orphan template if a checklist is deleted between validation and the link write

**What:** `_validated_check_ids` runs one read-only query to confirm every
`equipment_check_template_id` is in-org, _before_ `_crud_create` commits the
new `ShiftTemplate` row. That ordering closes the case this pass's first
draft credited it with (a bad id known at request time never reaches a
write) but not a distinct one: if the referenced `EquipmentCheckTemplate` is
deleted in the gap between that validation and the subsequent
`_replace_equipment_check_links` write — two officers acting on the same
org's checklists concurrently, not a hypothetical — the link insert violates
its FK constraint and raises. The `ShiftTemplate` row from the _first_,
already-committed write survives that failure: the caller sees an error, but
a checklist-less template now exists for a retry to duplicate.

**Where:** `app/services/scheduling_service.py` — `create_template`.

**Impact:** LOW. Requires a real race (concurrent delete of the specific
checklist within the same request's short write window) with no cross-tenant
or privilege component — the worst case (in the first two fix attempts,
closed by the third — see below) was a stray, checklist-less template an
officer would need to notice and delete, or duplicate on a naive retry. Not
exploitable for unauthorized access or data exposure at any revision.

**Fix history — three rounds, each catching a real gap in the last:**

1. **First attempt:** the link write ran inside a `self.db.begin_nested()`
   SAVEPOINT with an explicit `flush()`, catching bare `except Exception` to
   delete the orphan template and report `"Equipment checklist not found"`.
   Closed the original race, but two problems remained.
2. **Second round (Codex: "catch only the missing-checklist integrity
   failure"):** bare `except Exception` would also swallow an unrelated
   failure inside the same savepoint (a query error, an ORM defect) and
   misreport it as the same message — hiding the real problem behind a
   plausible-sounding wrong one. Narrowed to `except IntegrityError` (already
   imported and used elsewhere in this file,
   `scheduling_service.py:17,3453`), with any other exception left to
   propagate to `main.py`'s `@app.exception_handler(Exception)` (logs to
   `error_logs`, visible on Error Monitoring, returns a generic 500) instead
   of being mischaracterized.
3. **Third round (Codex, two comments: "verify the violated constraint
   before deleting the template" and "create the template and links in one
   transaction"):** both real, and related. Catching `IntegrityError` still
   didn't confirm the FK that fired was the checklist one specifically — a
   same-pair unique-constraint race (`uq_stec_template_pair`) on this exact
   template's own links is vanishingly unlikely for a brand-new id nothing
   else could yet reference, but "vanishingly unlikely" is not "impossible,"
   and the code shouldn't guess. Separately, and more importantly: the
   nested-savepoint design still committed the bare template via
   `_crud_create` **before** attempting the link write, so it was
   observable — listable, or referenceable as a shift's `template_id` — for
   the whole window between that commit and the cleanup delete. A shift
   created against it in that window would have its `template_id` silently
   `SET NULL`ed by the cleanup delete once it ran, detaching a real shift
   from its intended checklist configuration with no error to anyone.

   **Fixed by dropping `_crud_create` for this method and inlining an
   atomic create:** the template is `add()`ed and `flush()`ed (assigns its
   id, executes the INSERT, commits nothing) rather than committed; the
   links are written against the flushed-but-uncommitted template; **one**
   `commit()` lands both together. Nothing is observable to any other
   transaction until both writes are ready, so there is no window for a
   concurrent request to act on a template that might still be rolled back.
   On `IntegrityError`, the whole (uncommitted) attempt is rolled back — a
   plain `session.rollback()`, safe here because nothing committed yet in
   this attempt, unlike the abandoned first-draft approach that tried to
   rollback partway through an already-committed sequence and broke this
   repo's `join_transaction_mode="create_savepoint"` test fixture — and the
   _specific_ named checklists are re-validated via `_validated_check_ids`
   before deciding the message: only if one of them no longer resolves does
   the caller see `"Equipment checklist not found"`; any other integrity
   failure falls through to the same `str(e)` handling every other failure
   in this method already gets, matching the file-wide convention rather
   than introducing a second one.

**Guard tests** (`test_shift_template_equipment_checks.py::TestLinkManagement`):

- `test_a_checklist_deleted_after_validation_leaves_no_orphan_template` —
  wraps the real `_replace_equipment_check_links` to delete the checklist
  from inside it (standing in for the moment a concurrent delete would
  land, since a real race can't be made deterministic), asserts the correct
  error and that no template row survives.
- `test_an_unrelated_integrity_error_is_not_misreported` — raises a
  synthetic `IntegrityError` after a successful link write (so the named
  checklist still resolves on re-check), asserts the error is _not_
  `"Equipment checklist not found"` and carries the real underlying message
  instead.

Also updated `tests/test_position_slots.py::TestWritePathWiring._service()`
to mock `db.flush`, which the two existing tests in that class didn't need
before this rewrite made `create_template` call it unconditionally.

### Reviewed on the second Codex round: the remaining 8 files and 1 migration

Second-round Codex review re-ran the file enumeration against a slightly
later commit and found 30 added/modified files in
`modules/scheduling/`+`pages/scheduling/`, not the 21 the first-round
correction had reached — 8 more (7 test files, 1 type file) were still only
grep-swept, plus a third scheduling migration was never in scope. All now
reviewed:

- **`types/index.ts`** — removes a dead re-export block for equipment-check
  types (the same module-move cleanup already reviewed elsewhere). No logic.
- **`utils/positionLabels.test.ts`** (new) — unit tests for the already-
  reviewed `positionLabel()` helper; correct `mockReset()`-before-default
  discipline (Pitfall #28).
- **`components/ShiftSettingsPanel.test.tsx`,
  `components/TemplateFormModal.test.tsx`,
  `pages/scheduling/{OpenShiftsTab,ShiftDetailPanel}.test.tsx`,
  `pages/scheduling/board/{ShiftBoard,ShiftSeatList}.test.tsx`** — all
  exercise already-reviewed source changes (the `positionLabel` rollout, the
  permission-gated Equipment signpost links, `equipment_check_template_ids`
  round-tripping including the omitted-key-vs-empty-array distinction
  required by CLAUDE.md Pitfall #1). All use `beforeEach`
  reset-then-default for their mocks (Pitfall #28); one comment in three
  files explicitly notes making the `useAuthStore` mock callable-with-
  `getState` to match the real store's shape used outside React.
- **`20260831_0003_4e7e125cb00f_drop_equipment_check_settings.py`** — drops
  `scheduling_module_configs.equipment_check_settings`, the column backing
  the dead settings field this pass's diff-scoped section already noted was
  removed from `DEFAULT_SHIFT_SETTINGS`. Guarded on table _and_ column
  existing (Pitfall #26); `downgrade()` restores the column shape, not its
  contents, and says so in the docstring rather than implying a round-trip.
  No security-relevant surface — a dead-code cleanup, not an access or
  data-integrity change.

No new findings in any of the nine. Verified good.

### No new findings (all other dimensions)

SCH-9 and SCH-11's fixes were not touched by this pass's diff (both live in
`scheduling_service.py` regions this diff didn't reach) and are not re-cited
as re-verified from scratch, unlike pass 2's practice, since the full file
was not re-read this pass — the diff-scoped approach traded that for speed,
consistent with EC-14 pass 3's precedent once a baseline commit is
reachable. SCH-10 (DNS-rebinding TOCTOU, cross-cutting) is unchanged and
still accurately tracked in `KNOWN_LIMITATIONS.md`; not re-investigated here
since none of the three affected transports (`calcom_service.py` included)
appear in this pass's diff. No new `.like()`/`.ilike()` call, no new
CSV/export surface, no new Pitfall #12 JSON-mutation (the `positions`
reordering in `_flat_positions`/shift-generation is a wholesale
reassignment through `normalize_stored_positions`, not an in-place mutation
of a loaded JSON value), no new capacity/count-then-insert pattern.

## Completion gate (pass 3)

| Check                                                                           | Result                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                   | ✅ 0 violations                                                                                                                                                         |
| `black --check app/ tests/ alembic/`                                            | ✅ 1451 files unchanged                                                                                                                                                 |
| `isort --check-only app/ tests/ alembic/`                                       | ✅ clean                                                                                                                                                                |
| `python3 scripts/validate_migrations.py --strict`                               | ✅ single head, 414 revisions                                                                                                                                           |
| `pytest tests/ -q -k "scheduling or shift or swap or calcom or position_slots"` | ✅ 886 passed, 1 skipped (pre-existing optional-dep skip) — re-run on PR #2212's base after #2210 merged                                                                |
| `pytest tests/` (full backend suite)                                            | ✅ 10549 passed, 21 skipped (pre-existing Docker/no-MySQL/optional-dep)                                                                                                 |
| `tsc --noEmit`                                                                  | ✅ 0 errors                                                                                                                                                             |
| `eslint .`                                                                      | ✅ 0 errors                                                                                                                                                             |
| `npx vitest run src/modules/scheduling src/pages/scheduling`                    | ✅ 375 passed (26 files) — not in CLAUDE.md's mandatory gate list, run anyway since a "full completion gate green" claim should not omit a check there's a means to run |
| `npm run build` (frontend)                                                      | ✅ built in 6.62s, PWA precache generated — pre-existing chunk-size warning only                                                                                        |

## Pass 4 (2026-09-09) — 1 fix (SCH-13, LOW/MED, four Codex-caught rounds), 0 flagged, SCH-10 re-verified unchanged

**Revision note.** Codex review of the draft PR caught four real gaps, all
verified against the current code and addressed rather than disputed: (1)
the draft's own churn inventory and full-read list omitted two files —
`shift_eligibility_service.py` (+183/-3) and `shift_completion_service.py`
(+95/-1) — that changed since pass 3's baseline and implement real pieces
of the reviewed surface (the signup-window settings reader, the call-type
normalization/label-disambiguation logic, and the report call-type-
provenance tracking); both now read in full below. (2) The completion gate
never ran `npm run build` despite the pass auditing 79 changed frontend
files — run now, clean, matching pass 3's own precedent of running it as a
bonus check. (3) **SCH-13** — a real TOCTOU race between deleting a call
type and a concurrent close-out naming it, which could orphan history
referring to a slug no longer configured. Fixed below. (4) The draft
marked rotation row 15 `✅` and reported "0 fixed" while its own PR was
still open — corrected in `PROGRESS.md` to `⏳` (awaiting merge), matching
the tracker's own legend and established convention.

**PR note.** The draft PR ([#2435](https://github.com/thegspiro/the-logbook/pull/2435))
merged before these four fixes were pushed — a merge race, not a rejection;
see `PROGRESS.md`'s Open PR section for the full account. All four items
below are carried on a same-day follow-up PR
([#2437](https://github.com/thegspiro/the-logbook/pull/2437)), the same
shape the EC-15 follow-up (Feature 14) used for the identical situation. A
Codex review of #2437 itself then caught two further gaps in SCH-13's own
locking fix — see "Round 2" in the SCH-13 write-up below — both fixed on
the same branch before merge. A further Codex review of round 2's push
caught two more real gaps — one of them a genuine deadlock, not merely a
race — plus a robustness gap in round 2's own guard test that had kept it
from being able to catch either; see "Round 3," also fixed on the same
branch before merge. A fourth Codex review, of PR #2437 itself, then found
one more real gap — this time in the lock _order_ rounds 1-3 together
established, not in any one lock's own completeness: an attach-and-report
close-out could lock call-then-organization, the reverse of the deletion
guard's own order, a genuine deadlock between two otherwise ordinary
requests; see "Round 4," fixed on a fresh branch after PR #2437 had already
merged (CLAUDE.md Pitfall #24 — never push to a merged branch), the same
same-day-follow-up shape #2437 itself used for #2435. CLAUDE.md's stance on
this is explicit: no round limit — repeated findings on a pushed fix mean
the root cause isn't closed yet, not that review has become noise.

**Baseline:** `8b89f319d` (the merge commit of PR #2212, pass 3's actual landing
point — found via `git merge-base --is-ancestor` against pass 3's own tip
commit `05b910382`, not assumed from the doc's prose). Six days and
substantial churn sit between it and `fda025c8` (this pass's HEAD): a large
new "editable call types" feature (department-defined call-type slugs, with
retirement instead of deletion, three follow-on migrations, and multiple of
its own internal Codex review rounds per its commit messages), a close-out
backlog queue, a member's own hours-history screen, a late-signup escape
hatch, and a self-scoped decline-assignment endpoint.

**Diff-scoped, not re-read whole**, consistent with pass 3's practice once a
baseline commit is reachable (the shallow clone needed deepening to reach it,
as in prior passes). Real churn against the **nine** declared/adjacent
backend files — two more than the draft's "seven," corrected on Codex
review (see the Revision note): `scheduling.py` (+503/-20),
`scheduling_service.py` (+1083/-47), `schemas/scheduling.py` (+152/-4),
`models/training.py` (+10, one new nullable column), `calcom_service.py`
(+30/-9), `shift_eligibility_service.py` (+183/-3), and
`shift_completion_service.py` (+95/-1) — the last two omitted from the
draft's own inventory entirely despite being reached from `scheduling.py`'s
settings endpoints and `record_shift_calls`/`update_report`'s call-type
handling, and now read in full below. `scheduling_module_config.py`,
`calcom_sync.py`, `standing_shift_service.py`,
`app/mcp/tools/scheduling.py` are byte-identical to pass 3. 79 frontend files
under `modules/scheduling/`+`pages/scheduling/` changed (+11250/-2322) — grep-swept
for the checklist's red flags (`window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, banned `.toLocale*`, `date-fns` imports, raw
`fetch()`) rather than read line-by-line; zero hits, and the same is enforced
independently by ESLint's `noBlockingBrowserDialogs` rule, which the
completion gate confirms at 0 errors. Partial-scope, not assumed clean, per
the same disclosure pass 2/3 used for their own grep-only sweeps.

**Route/permission enumeration re-run from scratch** (not diffed against pass
3's table): **101/101 routes** (97 in `scheduling.py`, up from 92 — five new:
`GET /shifts/needing-closeout`, `POST`/`DELETE /shifts/{id}/late-signup`,
`POST /assignments/{id}/decline`, `GET /my-hours-history`; +3 in
`scheduling_module_config.py`; +1 in `calcom_sync.py`) carry a recognized auth
dependency. No route with none. Cross-checked against `git diff` for
`require_permission`/`Depends(get_current_user)` changes on **existing**
routes:

- **Eight `.view`-only reads widened to `.view` OR `.manage`**
  (`list_shifts`, `get_shift`, `get_attendance`, `list_shift_calls`,
  `list_templates`, `get_template`, `list_patterns`, `get_pattern`,
  `list_shift_assignments` — nine, not eight; corrected while writing this up).
  Each carries an in-code comment naming the mechanism: `permission_matches`
  treats `scheduling.manage` and `scheduling.view` as unrelated literal
  strings, so a position holding only `.manage` — every page in Scheduling
  Administration — was refused the reads those same pages are built to show.
  Strictly widening, not a downgrade: every caller who could read these
  before still can, and `.manage` already permits every corresponding write.
  Verified `.manage` is the more sensitive grant, not the reverse
  (`create_shift`/`update_shift`/`delete_call`/etc. all already required
  it), so pairing it onto a read is not a XC-2 pattern.
- **One `require_permission` OR-gate narrowed**: `get_position_roster` went
  from `("scheduling.manage", "training.view_all", "training.manage")` to
  `("scheduling.manage")` alone, with a comment explaining why — the roster
  moved into Scheduling Administration and a training officer's continued
  access to the whole eligibility/EVOC roster via a wide OR-gate was the
  finding the code comment itself describes fixing. A narrowing is a
  behavior change in the opposite (safe) direction from what this checklist
  exists to catch, so re-verified rather than treated as a red flag: no
  other route in either file still grants read access to this data through
  `training.view_all`/`training.manage`.

**New XC-1/XC-3 surface, checked individually:**

- `open_late_signup`/`close_late_signup` (`scheduling_service.py:2085-2168`)
  resolve the shift via `get_shift_by_id(shift_id, organization_id,
for_update=True)` — the same already-established org-scoped, row-locked
  helper every other shift mutation in this file uses. `minutes` is
  server-clock-relative (`datetime.now(timezone.utc) + timedelta(minutes=...)`),
  never a client-supplied instant, and is both schema-bounded
  (`Field(ge=1, le=720)`, 12 hours) and further clamped against the shift's
  own roster deadline at write time — a reopening made a second before the
  cutoff cannot smuggle a window past it. Gated on `scheduling.assign` OR the
  shift's own officer via the existing `_authorize_shift_management` helper.
- `decline_assignment` (`:4453-4520`) resolves its row by `id` **and**
  `user_id` **and** `organization_id` in one `WHERE` — the same three-column
  shape `confirm_assignment` already used — so a foreign assignment id can
  never cross tenants or users.
- `get_my_hours_history`/`get_member_month_totals` (`:6630-6776`) filter on
  both `ShiftAttendance.user_id == user_id` and `Shift.organization_id ==
organization_id` via the join; self-scoped by the caller's own id, no
  permission gate needed for the same reason `/my-attendance-history` has
  none.
- `get_closeout_backlog`/`closeout_backlog_criteria` (`:1152-1195`,
  `:212-254`) scope every query on `Shift.organization_id ==
organization_id`; the raw-SQL `INTERVAL {int(cushion)} HOUR` fragment in
  `closeout_effective_end` is safe because `cushion` is coerced through
  `int()` before interpolation (`open_ended_cushion_hours`, which itself
  degrades to a bounded default rather than raising on a malformed stored
  setting, per Pitfall #19) — not a string an admin's JSON could turn into
  SQL.

**New feature reviewed in full: department-editable call types** (`models/
call_tracking.py`, `services/call_tracking_service.py`, both new since pass
3 and not previously in this doc's scope, but reached from the declared
`scheduling.py`'s settings endpoints — reviewed per the "check a file
`SchedulingService` newly reads" precedent pass 2 established). Read both
files in full (240 L + 601 L):

- Every query is `organization_id`-scoped; `attach_response` resolves a
  client-supplied `call_id` against `OrgCall.organization_id ==
organization_id` before permitting the attach (XC-1) rather than trusting
  the caller's permission alone (XC-3/Pitfall #14b, cited explicitly in the
  method's own docstring).
- `slugs_locked_by_history`'s `ShiftCompletionReport.call_types.like(...)`
  calls all pass `escape=LIKE_ESCAPE_CHAR` with `like_pattern()`-built
  patterns (Pitfall #25 compliant) — the only `.like()`/`.ilike()` surface
  this feature adds; `scheduling_service.py` itself remains at zero.
  `_partition_existing` explicitly locks (`with_for_update()`) the existing
  `OrgCallResponse` rows before a finalize/closeout-calls save reconciles
  them, citing AP-13 findings 8/9 as the precedent for why the shift-row
  lock alone doesn't refresh a REPEATABLE READ snapshot for a sibling table
  — Pitfall #27 applied correctly to a table outside `scheduling_service.py`
  itself.
- `OrgCall`/`OrgCallResponse` models (`models/call_tracking.py`): the one
  `ondelete="SET NULL"` column (`OrgCallResponse.shift_id`) is
  `nullable=True` (Pitfall #2); `MAX_CALLS_PER_SHIFT=100` and
  `MAX_CALL_TYPES=50` bound both the per-shift write and the org's
  configured list against a DoS-shaped abuse. `CallTypeOption.slug` is
  schema-validated (`pattern=r"^[a-z0-9_]+$"`, `max_length=50`) before it can
  reach `OrgCall.call_type` (`String(50)`).
- Three new migrations (`a3d7e2f18c45`, `c9f4a2b71d38`, `d7c1b95e2a40`, all
  2026-09-05) read in full: all guard `shift_completion_reports`/
  `organizations` existence before touching them (Pitfall #26), use
  parameterized `sa.text(...).bindparams(...)`/`{"param": value}` throughout
  — no f-string SQL — are explicitly idempotent, and correctly declare
  themselves irreversible (no-op `downgrade()`) where the information needed
  to reverse them was never retained. The table-creation migration
  (`82bdcb3b1e64`, 2026-08-18, predates pass 3 but was never previously in
  this doc's scope since the feature hadn't reached `scheduling.py` yet) is
  itself guarded and correct: both FKs use `nullable=True` where
  `ondelete="SET NULL"` applies.
- `add_shift_late_signup_until` (`c9f2a4b71d38`) touches `shifts` without an
  explicit `_has_table` guard, which looked at first read like a Pitfall #26
  gap matching the exact shape that migration `e2c8f5a71d40` (pass 2) and
  `fab0ab7897d3` (pass 3) were praised for adding. **Verified, not assumed,
  to be safe**: `shifts` is created unconditionally by
  `20260122_0015_add_training_programs_and_requirements.py`, an ancestor of
  every migration in this chain — confirmed by running the repo's own
  `test_migration_create_all_tables.py` detection logic
  (`_tables_created_by_migrations`) against the source directly, not by
  trusting pass 3's prose (which called `shifts` "a `create_all`-only
  table" — that description was already inaccurate then and remains so; not
  corrected further here since it's a passing reference in a completed
  section, not a standing claim this pass relies on). `shift_templates` and
  `basic_apparatus`, the tables `e2c8f5a71d40`/`fab0ab7897d3` guarded, are
  genuinely create_all-only — the two cases are not the same shape, and the
  new migration touching only `shifts` needs no guard.

**The two previously-omitted service files, read in full against all seven
checklist dimensions** (added on Codex review — see the Revision note):

- **`shift_eligibility_service.py` (+183/-3).** New methods:
  `get_signup_window_settings` (defensive `int()` casts with
  `min(max(value,0), ceiling)` clamping, degrading to a built-in default
  rather than raising on a hand-edited value — Pitfall #19), `stored_call_type_slugs`
  / `effective_call_type_slugs` / `effective_call_type_slugs_for` (pure
  reads off an already-loaded `org`, or `_get_org(organization_id)` for the
  by-id variant — no client-supplied FK, no injection surface),
  `_disambiguate_label` (pure string manipulation, no DB access). The one
  pre-existing method that gained two new parameters,
  `update_scheduling_settings`, still opens with
  `copy.deepcopy(org.settings or {})` before mutating — confirmed unchanged
  and still Pitfall #12-compliant (a shallow `dict()` here would let the two
  new fields silently fail to persist, the exact bug that pitfall
  describes). `_get_org`'s only caller-visible change this pass is the
  `for_update` parameter added for SCH-13 below; every existing call site
  (unaffected by the fix) keeps calling it with no `for_update` argument
  and is unaffected.
- **`shift_completion_service.py` (+95/-1).** `_edit_preserves_org_slugs`
  and `_shift_has_incident_rows` (new) decide whether an edited report's
  `call_types` list still supports an `org_calls` provenance marker — pure
  reads, `report.organization_id` and `shift_id` both already org-resolved
  by the caller (`update_report`, which itself double-checks
  `report.organization_id != str(organization_id)` before any mutation,
  in addition to its own `get_report(report_id, organization_id)` lookup —
  XC-3 satisfied twice over, unchanged this pass). The one nested-JSON write
  this diff adds (`update_report`, clearing a stale `data_sources` marker)
  correctly uses `copy.deepcopy(report.data_sources or {})` before mutating
  and reassigning — Pitfall #12 compliant, confirmed by reading the exact
  lines rather than assumed from the pattern being familiar elsewhere in
  this codebase.

No new finding in either file on its own. Reading both in full, however, is
what surfaced SCH-13 below: `shift_eligibility_service.py`'s `_get_org` and
`shift_completion_service.py`'s consumer `record_shift_calls` (in
`call_tracking_service.py`, itself already in scope) are the two ends of
the same race.

### SCH-13 — LOW/MED (fixed) — deleting a call type could race a concurrent close-out into orphaning it

**What:** `_reject_deleting_a_used_call_type` (the settings-save guard in
`scheduling.py`) decides whether a call-type slug can be dropped by reading
_current_ `OrgCall`/`ShiftCompletionReport` usage. `CallTrackingService.
record_shift_calls` (invoked from a shift close-out) decides whether a
submitted type breakdown names a _valid_ slug by reading _current_ settings.
Both reads were plain `SELECT`s. Under InnoDB's default REPEATABLE READ, a
plain `SELECT` answers from the snapshot taken at the transaction's first
read, not from whatever is current when the statement actually runs
(CLAUDE.md Pitfall #27 — the same shape FORM-10 fixed for duplicate form
submissions). Two overlapping requests — an administrator deleting "brush"
from settings, and an officer's close-out recording a call under "brush" —
could each pass its own validation against a stale read of the other's
in-flight change, and both commit.

**Where:** `app/api/v1/endpoints/scheduling.py:_reject_deleting_a_used_call_type`
and `app/services/call_tracking_service.py:record_shift_calls` (the
`if type_counts:` validation branch).

**Failure scenario:** at T0, "brush" is configured with zero current usage
(so the deletion guard's usage check would currently find nothing locked).
An admin's settings PUT (removing "brush") and an officer's close-out PUT
(reporting one call as "brush") arrive close enough together that both
transactions take their first real read before either commits. Regardless
of which one the database happens to serialize first: the admin's usage
check (a plain `SELECT` on `org_calls`) doesn't see the officer's
not-yet-committed (or, if it committed first, already-committed-but-outside-
this-transaction's-snapshot) call, so it finds no usage and proceeds; the
officer's validity check (a plain `SELECT` on `organizations.settings`)
still sees "brush" as configured, so it validates and inserts. Final state:
the org's settings no longer list "brush," but an `OrgCall` row exists with
`call_type="brush"` — the exact orphan retirement exists to prevent. No
cross-tenant or privilege component; this is a within-org data-integrity
race, not an access-control bypass.

**Impact:** LOW/MED. Requires a real race (an admin editing call-type
settings within the same narrow window as an officer's close-out naming
that type) with no security-boundary crossing — the outcome is an orphaned
history row (a call whose type resolves to a raw slug instead of a label,
and which can never again lock that slug's name from being reused for a
differently-meant type), not unauthorized access or data exposure.

**Fix (round 1):** threaded `for_update: bool = False` through
`ShiftEligibilityService._get_org` and, in `call_tracking_service.py`,
`get_settings` / `_valid_type_slugs` / `type_usage_counts` /
`slugs_locked_by_history` (each defaulting to the prior plain-read
behavior, so every other caller — settings `GET`, the usage-display
helpers — is unaffected). `for_update=True` is passed from exactly the two
call sites in the race:

- `_reject_deleting_a_used_call_type` now takes a locking read of the
  organization row (discarding the return value — only the lock matters,
  since `in_force`/`persisted`/`removed` were already computed from an
  earlier plain read that doesn't need freshness for the admin's own edit
  intent) immediately before calling `slugs_locked_by_history(...,
for_update=True)`.
- `record_shift_calls`'s `if type_counts:` branch now calls
  `self._valid_type_slugs(organization_id, for_update=True)`.

Both now serialize on the organization row. Locking the row alone is not
sufficient — the same "the row is locked and the count is stale anyway"
trap FORM-10 closed — so `type_usage_counts`'s `OrgCall` query is _itself_
also a locking read when `for_update=True`, verified directly against this
codebase's own test database that MySQL permits `SELECT ... GROUP BY ...
FOR UPDATE` without error (not assumed).

**Round 2 — Codex review of the round-1 fix caught two further real gaps,
both verified by reading the code directly and reproducing each with a
guard test before fixing (not taken on the review's prose alone):**

1. **Identity-map staleness — `_get_org`'s locking read never refreshed an
   already-loaded `Organization` object.** `for_update=True` locks the row
   and reads the latest committed data _at the database level_, but
   SQLAlchemy's identity map returns an already-loaded Python object
   unchanged unless the query also carries
   `execution_options(populate_existing=True)` — the exact gotcha
   `get_shift_by_id` already documents and handles for the identical shape.
   `finalize_shift` (`scheduling_service.py`) loads `Organization` with a
   plain, non-locking `select()` of its own (for its equipment-check and
   call-tracking-mode logic) well before it ever reaches
   `record_shift_calls`'s locking call — so a finalize that races a
   settings deletion would still validate against the `Organization` object
   `finalize_shift` loaded _before_ the lock, silently defeating round 1's
   entire fix for exactly the caller SCH-13 was written to protect.
   **Fixed:** `_get_org` now adds `.execution_options(populate_existing=True)`
   alongside `.with_for_update()`, matching `get_shift_by_id`'s existing
   pattern exactly.
2. **The `ShiftCompletionReport` half of the usage check was wrongly
   reasoned to be outside the race window.** Round 1's fix left this half a
   plain read, reasoning "a report is filed well after its shift's calls,
   not in the same race window." That covers report _creation_ and misses
   report _editing_: `ShiftCompletionService.update_report` /
   `_edit_preserves_org_slugs` can change an **existing** `org_calls`-sourced
   report to newly name a different slug at any later time, entirely
   independent of when its calls were recorded — and that edit never took
   the organization lock at all. An officer editing a report to reference
   "brush" and an admin deleting "brush" could each pass validation against
   a stale read of the other's in-flight change: the edit sees "brush" still
   configured and keeps the `org_calls` marker, the deletion's (still-plain)
   report scan doesn't see the edit yet and proceeds — the identical orphan,
   reached through the report-edit path instead of the close-out path.
   **Fixed two ways:** `slugs_locked_by_history`'s `ShiftCompletionReport`
   query is now also a locking read (`.with_for_update()`) when
   `for_update=True` — this query selects bare columns rather than mapped
   entities, so `populate_existing` doesn't apply to it; only the identity
   map (round-2 gap 1) needed that option. And
   `_edit_preserves_org_slugs` (`shift_completion_service.py`) now takes its
   own locking read of the organization row
   (`ShiftEligibilityService._get_org(..., for_update=True)`) before
   deciding whether to preserve the marker, joining the same protocol —
   scoped to only run past the method's two early returns, so an ordinary
   narrative-only edit that never touches `call_types` (or one on a report
   that was never `org_calls`-sourced, or one that empties the list) costs
   no lock at all. **This round's own claim that this introduced "no
   lock-order inversion" was wrong** — see round 3, gap 2 below, which
   Codex caught on this exact PR's next review and which this section is
   corrected to no longer assert.

**Guard tests:** `tests/test_call_type_deletion_race.py`, three classes:

- `TestCallTypeDeletionRace` (round 1) — two real, independently-committing
  sessions (not the savepoint-based `db_session` fixture, which never truly
  commits) with both transactions' REPEATABLE READ snapshots pinned via a
  throwaway real read before either coroutine's actual work starts, run
  through `asyncio.gather`. Asserts the winner-agnostic invariant: never
  both "brush" absent from settings and present on a committed `OrgCall`
  row.
- `TestPopulateExistingRefreshesTheLock` (round 2, gap 1) — a single
  session takes a plain read of `Organization` first (matching
  `finalize_shift`'s own shape), a second independent session commits a
  real settings change, then the first session's locking `_get_org` call is
  asserted to return the identity-mapped object refreshed with the second
  session's committed value, not its own stale first read.
- `TestReportEditVsDeletionRace` (round 2, gap 2) — same two-session,
  pinned-snapshot, `asyncio.gather` shape as the round-1 test, but racing
  `ShiftCompletionService.update_report` (editing an existing report to
  newly name "brush") against the deletion guard instead of a close-out.
  Asserts the same winner-agnostic invariant against the report's own
  `call_types`/`data_sources` rather than `org_calls`.

All three confirmed failing reliably against the code each is meant to
guard (round 1's test against the pre-round-1 code from its own commit
history; both round-2 tests confirmed failing 3/3 runs against the
round-1-only fix, i.e. with round 2's changes reverted) and passing
reliably (5/5 runs, all three together) against the fully-fixed code.

**Round 3 — Codex review of round 2's push caught two more real gaps in
the locking fix and one test-robustness gap in round 2's own guard test,
verified the same way (code read directly, each reproduced before fixing):**

1. **The bulk call-type-list save derived every settings-dependent value
   from a pre-lock read.** `_reject_deleting_a_used_call_type` only took
   the organization lock immediately before the usage check — `in_force`,
   `persisted`, and the cap-ratchet comparison against `incoming.call_types`
   were all computed from the plain read at the top of the function, before
   any lock. `populate_existing` (round 2, gap 1) refreshes the ORM
   object on a locking read; it cannot retroactively refresh values a
   caller already computed from an earlier, unrefreshed read of that same
   object. Two administrators saving different call-type lists
   concurrently — one shrinking a 60-type legacy list to 55, another to 40
   — could each derive `persisted=60` from their own pre-lock snapshot,
   each satisfy the cap ratchet against that stale ceiling, and between
   them leave the department's stored list larger than either save alone
   would have permitted. **Fixed:** the organization lock is now taken as
   the very first thing after resolving `org is None`, and every
   settings-dependent value (`in_force`, `persisted`, the cap check,
   `removed`) is derived from that locked, freshly-read `org` — not merely
   the usage check at the end.
2. **The report-edit fix (round 2, gap 2) introduced a genuine deadlock,
   not merely a race.** `update_report` assigns the new value to
   `report.call_types` via `setattr` _before_ calling
   `_edit_preserves_org_slugs`. SQLAlchemy's default autoflush means the
   very next query this session issues — `_edit_preserves_org_slugs`'s own
   `_get_org(..., for_update=True)` — first flushes (and row-locks) the
   dirtied report, _then_ tries to lock the organization: a
   report-then-organization order. The deletion guard
   (`_reject_deleting_a_used_call_type`, after gap 1's fix above) locks
   organization-then-report (`slugs_locked_by_history`'s locking scan of
   matching report rows). An ordinary report edit and a concurrent
   call-type deletion, overlapping, could each hold the lock the other
   wants next — a real InnoDB deadlock (error 1213), not a hypothetical
   one: reproduced reliably (15/15 runs) with round 3 gap 3's strengthened
   test, below, against the round-2-only code. **Fixed:** `update_report`
   now calls `_edit_preserves_org_slugs` — which reads only
   `report.data_sources` (untouched by the `setattr` loop; `data_sources`
   isn't in `UPDATABLE_FIELDS`) and the new `call_types` value already in
   hand, needing nothing the loop produces — _before_ the `setattr` loop
   runs, so its lock acquisition (when it reaches that far) is the first
   write-intent operation the transaction takes, establishing the same
   organization-then-report order the deletion guard uses. Purely a
   reordering: `_edit_preserves_org_slugs`'s answer cannot depend on
   `report`'s mutated state, since it never reads `report.call_types`
   directly.
3. **The round-2 guard test for gap 2 could not have caught either gap.**
   `TestReportEditVsDeletionRace`'s `edit_the_report()` caught bare
   `Exception`, converted it to a string, and returned — so a database
   deadlock (or any other unexpected failure) was indistinguishable from
   an ordinary, successful non-commit: the final orphan assertion passed
   either way, because an edit that never committed cannot itself create
   an orphan. **Fixed:** the broad `try/except` is removed; any exception
   now propagates to `asyncio.gather(..., return_exceptions=True)` as a
   real exception object, which the existing
   `assert not isinstance(outcome, BaseException)` loop already fails
   loudly on. Re-running the strengthened test against the round-2-only
   code (round 3's other two fixes reverted) reproduced the deadlock from
   gap 2 reliably — 15/15 runs, `OperationalError` 1213 — corroborating
   that finding directly rather than taking its analysis on faith; the
   same test then passes reliably (5/5, and a further 15/15 focused on
   this class alone) against the fully-fixed code.

No new guard test was added for gap 1 specifically — the fix is a
mechanical reordering equivalent in shape to `TestReportEditVsDeletionRace`
and `TestPopulateExistingRefreshesTheLock`'s own lesson, exercising a
same-organization two-different-payload race that is harder to make
deterministic than the settings-vs-usage races the existing three classes
already cover deterministically via `asyncio.gather` and pinned snapshots;
verified instead by inspection (the lock is now provably the first
settings-dependent read in the function) and by the existing
`test_call_tracking.py` mocked-unit-test suite (141 tests) passing
unchanged, confirming no behavioral regression in the non-concurrent case.

**Round 4 — Codex review of PR #2437 itself found one more real gap, this
time in the lock _order_ established by rounds 1-3, not in a specific
lock's own completeness:**

4. **A close-out that both attaches an already-logged call and reports a
   type breakdown locked call-then-organization — the reverse of the
   deletion guard's own organization-then-call order.**
   `SchedulingService.finalize_shift`/`save_closeout_calls` both call
   `CallTrackingService.attach_response` (attaching this shift to a call
   another unit already logged) _before_ calling `record_shift_calls`,
   whose organization lock (round 1) only runs when a type breakdown is
   also present. `attach_response`'s `INSERT` of an `OrgCallResponse` takes
   an implicit database lock on the referenced `OrgCall` row via its
   foreign key — so a close-out doing both attaches the call (lock A) and
   only afterward locks the organization (lock B): call-then-organization.
   The deletion guard (`_reject_deleting_a_used_call_type`, per gap 1
   above) locks organization-then-call. Two ordinary, unrelated requests —
   an attach-and-report close-out, a concurrent type deletion — can each
   hold the lock the other wants next: a real InnoDB deadlock (error
   1213), reproduced directly (see below), not merely a theoretical
   ordering concern. **Fixed:** both callers now lock the organization
   first — before the `attach_call_ids` loop runs — whenever this pass
   will also validate a type breakdown (mirroring each caller's own
   `record_shift_calls`-invocation gate: `reported_call_count is not None`
   for `finalize_shift`, `count_provided` for `save_closeout_calls`, both
   combined with a non-empty positive-valued `reported_call_types`), so
   `attach_response`'s call-row lock never precedes the organization lock
   in either caller.

   Reproducing this one needed more than the pinned-snapshot-plus-`gather`
   shape the first three classes use: that shape is built to expose
   _read staleness_, and this bug is about lock _order_, not a stale read.
   A gather-only version of the test (no explicit pausing) was run 15/15
   times against the pre-round-4 code with **zero** failures — confirming
   the natural interleaving isn't reliable here before spending effort on
   a deterministic one, not merely assumed. `TestAttachThenRecordVs
DeletionDeadlock` instead patches `CallTrackingService.attach_response`
   to pause immediately after its own flush (the exact point where,
   pre-fix, the attach-and-report close-out holds the attached call's row
   lock and nothing else), matching the pause-and-release pattern
   `test_facility_document_reference_race.py` already uses for its own
   lock-order races: waits for that pause, starts the deletion, confirms
   with a bounded wait that the deletion is genuinely blocked (not merely
   not-yet-scheduled), then releases the paused attach and awaits both.
   Confirmed failing 6/6 with `OperationalError` 1213 ("Deadlock found")
   against the pre-round-4 code, and passing 5/5 with zero deadlocks
   against the fix.

   The patch is applied once, from the test itself, before either task
   starts, and only the attach task ever calls the patched method — not
   the two-coroutines-hold-the-same-`patch()` shape CLAUDE.md Pitfall #22
   warns against (which corrupts the mock for the rest of the session
   rather than merely failing this one test).

**`calcom_service.py`'s 30-line change** (`parse_webhook_event`, now also
recognizing `MEETING_ENDED` and dropping Cal.com-flagged no-show attendees
from `attendee_emails`) is pure parsing logic with no outbound request and no
DB access — SCH-10 (the DNS-rebinding TOCTOU) is unaffected, since it
concerns the outbound `httpx` calls in `test_connection`/`list_bookings`,
neither of which changed. The consuming webhook
(`api/public/integrations_webhook.py:187-255`, a different rotation
feature's file, not re-reviewed in full here) still verifies
`X-Cal-Signature-256` via `verify_hmac_signature` before any payload is
parsed, still resolves the organization through `integration.organization_id`
rather than a client-supplied value, and still has replay protection
(`is_duplicate_webhook`) — spot-checked because the declared file's output
feeds directly into it, not because the endpoint itself is in scope this
pass.

**SCH-10 re-verified, unchanged.** `docs/KNOWN_LIMITATIONS.md`'s entry
(updated by the training-extended and push-service closures) still correctly
lists `calcom_service.py` among the six remaining unpinned `httpx` call
sites; nothing in this pass's diff touches the two `assert_outbound_url_safe`
call sites in that file. Not re-fixed here for the same reason pass 1 flagged
rather than fixed it: closing it means pinning the resolved address across
every `create_integration_client()`-based transport at once, not a
scheduling-scoped change.

**No new findings** on any other checklist dimension: no new
`.like()`/`.ilike()` call in `scheduling_service.py` itself (still zero); no
new CSV/export surface; no new Pitfall #12 JSON-mutation beyond the two
already reviewed above (`late_signup_until` is a scalar column, not JSON;
the call-type settings write is a wholesale `model_dump()` reassignment,
not an in-place nested mutation); no capacity/count-then-insert pattern
added without a lock beyond SCH-13 (`_partition_existing`, reviewed under
the call-tracking feature above, is the one other new instance, and it
already locks). Existing guard tests (`test_scheduling_org_scoping.py`,
`test_swap_offer_response.py`, `test_shift_template_equipment_checks.py`)
re-run clean as part of the full suite below; no regression in any of pass
1/2/3's fixes.

### Guard tests

- `tests/test_call_type_deletion_race.py` (new) — SCH-13's guard test; see
  above for its shape and the fail-before/pass-after confirmation.
  `TestAttachThenRecordVsDeletionDeadlock` (round 4) added to the same
  file.

Everything else: no fix was needed for the rest of this pass's scope, so no
further guard test was added. Existing coverage for the new surface
reviewed above was confirmed present and passing rather than written fresh:
`test_scheduling_closeout_backlog.py`, `test_member_hours_history.py`,
`test_shift_signup_window.py`, `test_shift_signup_window_enforcement.py`,
`test_call_tracking.py`, `test_call_type_provenance_narrowing_migration.py`,
`test_reserved_call_type_slug_migration.py`, plus decline/late-signup cases
inside `test_scheduling.py`.

## Completion gate (pass 4, after all four SCH-13 rounds)

| Check                                                                                                                                 | Result                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                         | ✅ 0 violations                                                                                                                          |
| `black --check app/ tests/ alembic/`                                                                                                  | ✅ 1556 files unchanged                                                                                                                  |
| `isort --check-only app/ tests/ alembic/`                                                                                             | ✅ clean (installed, not skipped)                                                                                                        |
| `python3 scripts/validate_migrations.py --strict`                                                                                     | ✅ single head, 440 revisions                                                                                                            |
| `pytest tests/ -q -k "scheduling or shift or swap or calcom or position_slots or call_tracking or call_type"`                         | ✅ 1251 passed, 1 skipped (pre-existing optional-dep skip) — +1 over round 3, round 4's new deadlock guard test                          |
| `pytest tests/test_call_type_deletion_race.py` — round-1 test, 5 runs each direction                                                  | ✅ fails 5/5 on the pre-round-1 code, passes 5/5 on the round-1 fix                                                                      |
| `pytest tests/test_call_type_deletion_race.py` — round-2 tests vs. round-1-only code                                                  | ✅ both fail 3/5/5 against round-1-only code (identity-map staleness and the report-edit orphan both reproduce)                          |
| `pytest tests/test_call_type_deletion_race.py::TestReportEditVsDeletionRace` — round-3's strengthened test vs. round-2-only code      | ✅ fails 15/15 with `OperationalError` 1213 (deadlock found) — corroborates round-3 gap 2 directly, not on the review's analysis alone   |
| `pytest tests/test_call_type_deletion_race.py::TestAttachThenRecordVsDeletionDeadlock` — gather-only variant vs. pre-round-4 code     | ➖ passed 15/15 with **no** failure — confirms natural interleaving alone doesn't expose this one; motivated the patch-and-pause rewrite |
| `pytest tests/test_call_type_deletion_race.py::TestAttachThenRecordVsDeletionDeadlock` — patch-and-pause version vs. pre-round-4 code | ✅ fails 6/6 with `OperationalError` 1213 (deadlock found)                                                                               |
| `pytest tests/test_call_type_deletion_race.py` — all 4 classes vs. the fully-fixed code                                               | ✅ passes 5/5 with zero deadlocks                                                                                                        |
| `pytest tests/` (full backend suite)                                                                                                  | ✅ 11971 passed, 21 skipped (pre-existing Docker/no-MySQL/optional-dep) — +1 over round 3, round 4's new guard test                      |
| `npm run typecheck` (aliased TS7 compiler, per CLAUDE.md)                                                                             | ➖ not re-run this round — no frontend file touched                                                                                      |
| `npx eslint .`                                                                                                                        | ➖ not re-run this round — no frontend file touched                                                                                      |

## Pass 5 (2026-09-15) — 0 fixed, 0 flagged, 0 new findings; all standing flags re-confirmed

**Step 0.** `git fetch origin main` clean; `PROGRESS.md`'s Open PR section
read "None." with the Feature 14 (Equipment check & shifts) pass 5 closure
note beneath it, naming "Next: Feature 15 (Scheduling), pass 5." explicitly.
`list_pull_requests` (open) returned only the three known-unrelated PRs —
dependabot #2567/#2552, and #2495 (`feat(scheduling): make "don't track
calls" selectable in settings` — a feature-workstream PR, not a
security-review PR; left untouched) — no concurrent Feature 15/scheduling
review or closure PR, so this session proceeds.

**Baseline:** `058459963`, the merge commit of PR #2441 — pass 4's actual
final landing point (the SCH-13 round-4 deadlock fix), not pass 4's own
`fda025c8` write-up point, which predates that merge. Confirmed from
`PROGRESS.md`'s Open PR history (the "Feature 15 follow-up, round 4" note)
rather than assumed from the findings doc's own prose.

### Delta check

`git diff --stat 058459963..HEAD` across the three declared endpoint files,
`scheduling_service.py`, `scheduling_module_config_service.py`,
`standing_shift_service.py`, `call_tracking_service.py`,
`shift_eligibility_service.py`, `shift_completion_service.py`,
`calcom_service.py`, `app/mcp/tools/scheduling.py`, `schemas/scheduling.py`
and `models/call_tracking.py` found real churn in exactly **four** files:

| File                          | +/-      |
| ----------------------------- | -------- |
| `scheduling.py`               | +115/-18 |
| `scheduling_service.py`       | +325/-11 |
| `shift_completion_service.py` | +60/-15  |
| `schemas/scheduling.py`       | +6/-0    |

`scheduling_module_config.py`, `calcom_sync.py`,
`scheduling_module_config_service.py`, `standing_shift_service.py`,
`call_tracking_service.py`, `calcom_service.py`, `app/mcp/tools/scheduling.py`
and `models/call_tracking.py` are all byte-identical to pass 4 — confirmed by
an empty `git diff --stat` against each, not assumed from the file list being
unchanged in a directory listing.

**No new migration touches a scheduling table.** Three migrations were added
in this range (`d19b2c2ae9b9` — public event requests, `0533644945cd` — event
request settlement, `6ab7d903fae5` — onboarding-status singleton); read all
three directly rather than by filename alone, and none references `shifts`,
`shift_`, `scheduling`, `org_calls`, or `standing_shift_claims`. Migration
chain re-validated at a single head (`6ab7d903fae5`, 444 revisions, up from
440 — the three above).

**Route/permission enumeration re-run from scratch.** `scheduling.py` still
carries **97** `@router.` decorators, each with a recognized auth dependency
(`grep -c` for `Depends(get_current_user)`/`require_permission(` matches 97
— no route with neither). No route added or removed since pass 4.
`scheduling_module_config.py` (3) and `calcom_sync.py` (1) unchanged.

**The four commits in the delta, read in full, all in the safe direction:**

- `d1070ecc2`/`241bdb3cb`/`229c3af80` — three more `.view`-only reads
  (`get_week_calendar`, `get_month_calendar`, `get_scheduling_summary`,
  `list_swap_requests`, `get_swap_request`, `list_time_off_requests`,
  `get_time_off_request`) widened to `.view` OR `.manage`, continuing the
  exact pattern pass 4 already reviewed and found correct for nine other
  routes (`permission_matches` treats the two grants as unrelated literal
  strings, so a position holding only `.manage` was refused reads its own
  pages render). Each carries an in-code comment naming the mechanism and,
  for the swap/time-off pair, why: both already _branch_ internally on
  `scheduling.manage` to decide what to return (the whole department's
  requests for a reviewer vs. the caller's own), so gating the read on
  `.swap`/`.view` alone put that branch behind a door the `.manage`-only
  grant couldn't open — the reviewer role `/swap-requests/{id}/review` and
  `/time-off/{id}/review` exist for. Strictly widening: `.manage` already
  gated every corresponding write in this file (confirmed unchanged), so
  pairing it onto a read is not an XC-2 downgrade. No route was narrowed to
  a _weaker_ gate anywhere in the diff.
- `2eee5c621` — `get_open_shifts` (`GET /shifts/open`) branches on
  `scheduling.manage`: a holder gets the existing department-wide
  staffing-gap view (`get_open_shifts`, unchanged), everyone else gets a new
  `get_claimable_shifts`, which intersects the shift's unclaimed named seats
  (a new `open_positions_by_shift` helper, mirroring
  `_validate_assignment_candidate`'s own seat-counting rule rather than
  `filter_shifts_with_open_positions`'s coarser one) against the caller's
  own eligible positions (`ShiftEligibilityService.get_eligible_positions_bulk`,
  pre-existing, unchanged, already org-scoped via
  `Shift.organization_id == organization_id`). Both new methods take
  `organization_id` from `current_user.organization_id` only (never a
  client-supplied value) and every query inside them
  (`open_positions_by_shift`'s `ShiftAssignment` scan,
  `_open_shift_candidates`'s `Shift` scan) filters `organization_id`
  explicitly — read directly, not inferred from the surrounding pattern.
  `get_eligible_positions`'s new `open_positions` field on the response
  (`EligiblePositionsResponse.open_positions`, `schemas/scheduling.py`) reuses
  the same `open_positions_by_shift` helper and resolves the shift via the
  existing org-scoped `get_shift_by_id`. This is a data-correctness fix (a
  member was previously shown, and then refused at signup for, a shift whose
  only empty seat was a position they don't hold), not a permission or
  tenancy change — no new by-id, FK, or capacity-write surface.
- `6df6a49a4` — `create_shift_call`/`update_shift_call`
  (`scheduling_service.py`) and `finalize_shift`/`save_closeout_calls`'s
  call-figure paths now refuse to write when the organization's configured
  tracking mode doesn't match the write being attempted (`update_shift_call`
  gated on `DETAILED` mode matching `create_shift_call`'s existing gate;
  `finalize_shift`/`save_closeout_calls` refuse `reported_call_count`/
  `reported_call_types`/`attach_call_ids`/`member_call_counts_in` outside
  `COUNT_ONLY` mode, and `record_shift_calls`'s own `OrgCall` writes outside
  `DETAILED`). A business-rule tightening (a stray write surviving a mode
  switch was previously silently accepted or silently ignored, per the
  in-code comments), not a security boundary — the mode value itself comes
  from `CallTrackingService.get_settings(str(organization_id))`, already
  org-scoped, and every refusal happens **before** any row is written or
  locked, so it cannot interact with SCH-13's lock ordering. Verified
  directly: the `count_only` branch inside `finalize_shift` that performs the
  SCH-13-round-4 organization-then-call lock (`will_lock_types` /
  `attach_response` / `record_shift_calls`) is unchanged and still reached
  the same way; the new refusal sits entirely in the `not count_only` branch
  that precedes it.

**`shift_completion_service.py`'s +60/-15 is EC-16, not a Scheduling
finding.** `git log 058459963..HEAD -- backend/app/services/
shift_completion_service.py` shows exactly one commit, `dbf489af6` — the
Feature 14 (Equipment check & shifts) pass 5 merge (PR #2568). That pass's
own write-up (`PROGRESS.md`'s Feature 14 pass 5 log entry,
`docs/security-review/EC-14-equipment-check-shifts.md`) already covers this
fix: `create_report`'s duplicate-trainee-report guard was a plain
read-then-write (Pitfall #27), fixed to a `begin_nested()`/`IntegrityError`
catch/locking-recheck shape matching `submit_check`'s own established idiom,
with a dedicated guard test (`tests/test_shift_report_duplicate_race.py`,
confirmed present). Cross-referenced here per this file's declared reach
into `shift_completion_service.py` (the same convention the task briefing for
this pass names the other direction — SCH-13 landing in a file EC-14 also
reads); re-verified present and unchanged in the current tree, not re-fixed
or re-flagged.

**Adjacent-file/frontend sweep.** `git log` on the four changed backend files
shows five commits total (`229c3af80`, `241bdb3cb`, `d1070ecc2`,
`2eee5c621`, `6df6a49a4`), all normal `fix(scheduling):` feature commits from
the ongoing app-review/feature workstream, not from this rotation. 29
frontend files under `modules/scheduling/` + `pages/scheduling/` changed;
grep-swept (not read line-by-line, per pass 3/4's own disclosed practice for
a file count this size) for `window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, the banned `.toLocale*` methods, `date-fns`
imports, and a re-enabled `closeOnClickOutside`/scrim click handler — zero
hits across every non-test file in the diff. One of the five commits
(`0d3f9b833`, "Stop a click outside a dialog from discarding the form",
`ShiftDetailPanel.tsx`) is itself a Pitfall #31 _fix_, not a regression —
confirmed by reading the diff: it removes a scrim click handler, matching
the rule's own "CORRECT" shape.

### Standing flags re-confirmed

- **SCH-9 (fixed)** — `_all_users_in_org` is still called from both
  `create_shift_call` and `update_shift_call` before their respective writes;
  unchanged since pass 1.
- **SCH-10 (flagged, cross-cutting, unchanged)** — `calcom_service.py` is
  byte-identical to pass 4; `docs/KNOWN_LIMITATIONS.md`'s entry (last updated
  2026-09-13, tracking seven remaining `assert_outbound_url_safe` call sites
  across two client-construction paths) still lists it correctly. Not
  re-fixed here for the same reason every prior pass gave: closing it is a
  cross-cutting transport change, not a scheduling-scoped one.
- **SCH-13 (fixed, all four rounds)** — `_reject_deleting_a_used_call_type`
  and `record_shift_calls`/`_edit_preserves_org_slugs` still take the
  organization-then-report/call lock in that order; the round-4
  organization-then-call reordering in `finalize_shift`/`save_closeout_calls`
  is unchanged by this pass's `6df6a49a4` (the new mode-refusal check sits
  entirely before the lock, in the branch that skips it — see above).
  `tests/test_call_type_deletion_race.py`'s four classes re-run clean as part
  of the full suite below.

### No new findings

Worked against all seven `CHECKLIST.md` dimensions for the delta:
authentication (no route lost or gained a dependency), authorization (all
five permission changes widen, none narrow, and each is justified by an
internal branch the old gate blocked), tenant isolation (every new/changed
query in `open_positions_by_shift`, `_open_shift_candidates`,
`get_claimable_shifts` filters `organization_id`; no new client-supplied FK),
injection (no new `.like()`/`.ilike()`; `scheduling_service.py` remains at
zero), data exposure (`EligiblePositionsResponse.open_positions` carries
position-name strings only, nothing new to cache-exclude), abuse resistance
(`open_positions_by_shift` is bounded by the existing `max_candidates=500`
ceiling on its caller; no new unbounded loop or dict), schema/migration
integrity (no scheduling migration this pass; chain single-headed).

### Guard tests

None added — the delta's five commits (four permission widenings, one
mode-refusal tightening) are all safe-direction, already-tested changes
(scoped suite below re-runs unaffected and green), and `shift_completion_
service.py`'s change carries its own guard test under EC-14's rotation entry,
not this one.

## Completion gate (pass 5)

| Check                                                                                                         | Result                                                                                            |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (feature files)                                                                 | ✅ 0 violations                                                                                   |
| `black --check app/ tests/ alembic/` (feature files)                                                          | ✅ 12 files unchanged                                                                             |
| `isort --check-only app/ tests/ alembic/` (feature files)                                                     | ✅ clean (installed, not skipped)                                                                 |
| `python3 scripts/validate_migrations.py --strict`                                                             | ✅ single head, 444 revisions                                                                     |
| `pytest tests/ -q -k "scheduling or shift or swap or calcom or position_slots or call_tracking or call_type"` | ✅ 1301 passed, 1 skipped (pre-existing optional-dep skip)                                        |
| `pytest tests/` (full backend suite)                                                                          | ✅ 12577 passed, 21 skipped (pre-existing Docker/no-MySQL/optional-dep/API-contract-opt-in skips) |
| `npm run typecheck` / `npx eslint .`                                                                          | ➖ not run — no frontend file touched this pass                                                   |

## Pass 6 (2026-09-17) — 0 fixed, 0 flagged, 0 new findings; all standing flags re-confirmed

**Watchdog iteration.** The `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) had produced no commit and had no open
security-review PR for roughly 1h30m past its 30-minute cadence at the time
this iteration's Step 0 was checked — `git fetch origin --prune` clean,
`list_pull_requests` (state=open) → `[]`, and `PROGRESS.md`'s Open PR row
already read "None." with the Feature 14 (Equipment check & shifts) pass 6
closure note beneath it, naming "Next: Feature 15 (Scheduling)" explicitly. No
`claude/security-review-feature15-*` branch was in flight (only a stale
`-close` branch from pass 5's own closure). This watchdog picked up Feature
15 directly, mirroring the Feature 08–14 pass-6/7 precedents recorded
elsewhere in `PROGRESS.md`.

**Baseline:** `6982a99e5`, the merge commit of PR #2570 (pass 5's landing
point, confirmed from `PROGRESS.md`'s own log entry for that merge rather
than assumed).

### Delta check

`git diff --stat 6982a99e5..origin/main` across all thirteen declared/adjacent
backend files (`scheduling.py`, `scheduling_module_config.py`,
`calcom_sync.py`, `scheduling_service.py`,
`scheduling_module_config_service.py`, `standing_shift_service.py`,
`call_tracking_service.py`, `shift_eligibility_service.py`,
`shift_completion_service.py`, `calcom_service.py`,
`app/mcp/tools/scheduling.py`, `schemas/scheduling.py`,
`models/call_tracking.py`) returns **empty for every one of them** despite 169
intervening commits — confirmed by `git diff --stat`, not inferred from an
unchanged file listing. No new migration touches a scheduling table (`git log
6982a99e5..origin/main -- backend/alembic/versions/` returns no commits at
all in this range; chain re-validated at a single head, 444 revisions,
unchanged from pass 5). flake8/black/isort re-run clean on all thirteen files.

**Frontend churn: two files, both reviewed, both safe.**
`git diff --stat 6982a99e5..origin/main -- frontend/src/modules/scheduling/
frontend/src/pages/scheduling/` shows real changes in exactly
`CallTypesCard.tsx` and `ShiftSettingsPanel.tsx` (plus their own test files,
already updated by the same commits). Both diffs read in full:

- `CallTypesCard.tsx` — copy-only change to the "these take effect when…"
  notice, now naming which of the three call-tracking modes is active rather
  than just "off". No new prop, no new API call, no `dangerouslySetInnerHTML`.
- `ShiftSettingsPanel.tsx` — replaces the two-state "record a call count"
  toggle with a three-option `radiogroup` (`detailed` / `count_only` / `off`),
  surfacing the `off` mode the backend has accepted since call tracking
  shipped (`CallTrackingSettings.mode` validates against
  `CallTrackingMode.ALL`, read directly at `schemas/scheduling.py:327-339` —
  `off` is already a member, not a new value this UI change invents). The
  write still routes through `saveFeature` →
  `schedulingService.updateFeatureSettings` → the same pre-existing
  `scheduling_module_config` PUT route (`scheduling.manage`-gated, unchanged),
  confirmed by reading `saveFeature`'s body directly rather than assuming from
  the diff. No new endpoint, no new client-writable field, no
  `window.confirm`/`alert`/`prompt`, no banned locale method, no `date-fns`
  import, no re-enabled click-outside-scrim.

### Standing flags re-confirmed (re-read directly, not inferred from the empty diff)

- **SCH-9 (fixed)** — `_all_users_in_org` (`scheduling_service.py:1879`) is
  still called from both call-write paths (`:3096`, `:3166`); unchanged since
  pass 1.
- **SCH-10 (flagged, cross-cutting, unchanged)** — `calcom_service.py`
  (`app/services/integration_services/calcom_service.py`) is byte-identical to
  pass 5; `assert_outbound_url_safe` still guards the one outbound call at
  `:123`. `docs/KNOWN_LIMITATIONS.md`'s entry remains accurate. Not
  re-fixed here for the same reason every prior pass gave: closing it is a
  cross-cutting transport change, not a scheduling-scoped one.
- **SCH-13 (fixed, all four rounds)** — `_reject_deleting_a_used_call_type`
  (`scheduling.py:3703`, called from `:3894`) and the
  organization-then-report/call lock ordering in `finalize_shift` (`:7803`)
  and `save_closeout_calls` (`:8359`) are unchanged since pass 5.
  `tests/test_call_type_deletion_race.py` re-ran clean as part of the scoped
  suite below.

### No new findings

Worked against all seven `CHECKLIST.md` dimensions for the delta: zero backend
line changed, so authentication, authorization, tenant isolation, injection,
data exposure, abuse resistance and schema/migration integrity are all
unchanged from pass 5's own analysis. The two frontend files reviewed above
introduce no new surface in any dimension.

### Guard tests

None added — no backend line changed, and the frontend change is a pure
UI/copy change surfacing an already-validated, already-gated backend value.

## Completion gate (pass 6)

| Check                                                                                                         | Result                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `flake8` (thirteen feature files)                                                                             | ✅ 0 violations                                                                        |
| `black --check` (thirteen feature files)                                                                      | ✅ 13 files unchanged                                                                  |
| `isort --check-only` (thirteen feature files)                                                                 | ✅ clean (installed, not skipped)                                                      |
| `python3 scripts/validate_migrations.py --strict`                                                             | ✅ single head, 444 revisions (unchanged from pass 5)                                  |
| `pytest tests/ -q -k "scheduling or shift or swap or calcom or position_slots or call_tracking or call_type"` | ✅ 1301 passed, 1 skipped (pre-existing optional-dep skip) — identical count to pass 5 |
| `npm run typecheck`                                                                                           | ✅ clean                                                                               |
| `npm run lint`                                                                                                | ✅ clean                                                                               |
| `npx vitest run CallTypesCard.test.tsx ShiftSettingsPanel.test.tsx`                                           | ✅ 56 passed                                                                           |
