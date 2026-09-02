# Security Review 07 — Users & Organizations

**Prefix:** `USR` · **Iteration:** 07 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-02 (pass 3) · **PR:** [#1814](https://github.com/thegspiro/the-logbook/pull/1814) (pass 1), [#1949](https://github.com/thegspiro/the-logbook/pull/1949) (pass 2)

---

## Pass 3 (2026-09-02)

**Scope:** full domain since pass 2's merge commit `6823bece` (PR #1949):
`endpoints/users.py`, `endpoints/organizations.py`, `endpoints/member_status.py`,
`endpoints/member_leaves.py`, `services/user_service.py`,
`services/organization_service.py`, `services/member_leave_service.py`,
`models/user.py`, `schemas/user.py`, `schemas/organization.py`, every
migration touching these tables since, and the in-app frontend surface (no
dedicated module directory, same as pass 1/2) — `git diff --stat` against
`frontend/src/` since `6823bece`, reviewed file by file for every match on
user/organization/member terms.

**Read in full (diff-driven):** the `users.py`/`models/user.py` diff since
pass 2 (the "stated one of two membership columns, refuse to guess the other"
guard added to `update_user_profile`, and `_reconcile_membership`'s "keep the
existing class/status when the split can't answer" fix); the
`schemas/organization.py` diff (the `testing` module flag); every changed
frontend file (`AddMember.tsx`, `ImportMembers.tsx`, `MemberAdminEditPage.tsx`,
`MemberIdCardPage.tsx`, `Members.tsx`, `userServices.ts`, `types/user.ts`,
`purgeLocalMemberData.ts`).

**Re-enumerated, not re-derived:** all 62 routes across the four files (24 +
19 + 12 + 7 — up one from pass 1's 61, the new
`update_user_profile` guard added no route) — every route's auth dependency
and permission string checked against the route inventory below. Every
by-id (`{user_id}`, `{leave_id}`) fetch in all four files traced for an
`organization_id` filter (CLAUDE.md Pitfall #14 / CHECKLIST XC-3), and every
client-supplied FK on a create path (`member_leaves.py`'s `create_leave_of_
absence` → `MemberLeaveService.create_leave`) traced for an in-org check
(XC-1). `organizations.py`'s 19 routes carry no by-id path parameter at all —
every one resolves exclusively off `current_user.organization_id`, so XC-3
does not apply to that file by construction; confirmed by reading all 19
handlers, not inferred from the file's shape.

**Re-verified against current code, not re-derived:** every pass-1/pass-2
"Verified good" claim below the by-id trace (privilege-ceiling wiring, PII
redaction, settings-secret redaction, the class/rank invariant's now-four
locked writers, USR-1…4 fixes). USR-5 (unbounded lists) and ORU-7c
(mass-escalatable `member` role) re-checked against current line numbers and
`KNOWN_LIMITATIONS.md` — both still open, unchanged, already mirrored; not
re-flagged.

**Not re-read line-by-line:** `member_status.py` lines 1–281 (imports/schemas/
helpers above the first route) and `organization_service.py`'s non-module-
settings methods — no diff signal since pass 2 pointed at either.

## Findings (pass 3)

### USR-7 — LOW — `GET /users` silently dropped `platoon` (and declared-but-unset `member_class`/`member_status`/`compliance_exempt`) from every roster response — ✅ FIXED

**What:** `UserListResponse` (`schemas/user.py:271-298`) declares `platoon`,
`member_class`, `member_status` and `compliance_exempt`, but
`UserService.get_users_for_organization` (`services/user_service.py:54-69`)
never set any of the four in the `user_dict` it builds per row — each one
came back as the schema's bare default (`None`/`False`) regardless of the
real column value, for every caller of `GET /users`.

**Where:** `services/user_service.py:54-69`.

**Failure scenario:** `PlatoonRosterPanel.tsx` (scheduling module) loads its
"current assignment" column straight from `GET /users`'s `platoon` field to
seed the officer's edit grid. Every member showed as unassigned regardless of
their actual platoon, and the panel's own "only send rows that changed" diff
compares against that same wrong baseline — an officer who didn't touch a row
believing it already showed the true value would leave it unset while
believing it was confirmed correct.

**Impact:** functional defect, not a permission or tenancy bug — reproducible
on any organization using platoon-based scheduling.

**Fix:** `platoon` added to the dict `UserListResponse` is built from,
matching what the schema already declares and the model already stores.
`member_class`/`member_status`/`compliance_exempt` deliberately left unset —
see USR-8, which found the same gap for those three but for a reason worth
weighing before it's fixed rather than incidentally: `compliance_exempt` in
particular is a more sensitive field to widen to every `members.view` holder
(every default position) than `platoon` is, and USR-8 is the same "should
this whole endpoint's field set be tiered by permission" decision. Guarded by
`tests/test_user_list_platoon.py` (2 tests), confirmed to fail against the
pre-fix code via `git stash`.

### USR-8 — MED — `GET /users` sends the full admin-facing member record to every `members.view` holder; a 2026-09-01/02 frontend change frames a reduced "Member Directory" experience for that tier without any matching backend change — 🚩 FLAGGED

**What:** `members.view` is, per the route's own docstring
(`users.py:103-106`), "the baseline grant every default position carries" —
every member of the department holds it. `UserService.get_users_for_
organization` returns the same `UserListResponse` regardless of which of the
three OR-gated permissions (`users.view`, `members.view`, `members.manage`)
the caller holds, and that response unconditionally includes `username`,
`hire_date`, `membership_number`, `rank`, and `station` for every member in
the organization.

Since pass 2, `Members.tsx` was changed (comment at line ~36-41) to render a
visibly different experience by permission tier: a caller without
`members.manage` sees "Member Directory" / "Find and contact department
members" instead of "Membership Management", loses the username line, the
Hire Date column, the CSV export, bulk-select, and the edit/delete actions —
framed in the code comment as "administrative furniture ... a member without
the grant gets a directory; a coordinator gets the management table
unchanged." That framing describes an access-control boundary. No such
boundary exists server-side: the fields the directory-tier UI hides are still
in the JSON `GET /users` response reaching that caller's browser — visible in
the network tab, or to any script the member runs against their own
authenticated session — regardless of the UI's rendering choice.

**Where:** `services/user_service.py:24-91` (unconditional field set);
`schemas/user.py:271-298` (`UserListResponse`); `api/v1/endpoints/users.py:
99-155` (`list_users`, OR-gated on `members.view`); frontend framing at
`frontend/src/pages/Members.tsx:36-41`.

**Failure scenario:** a plain member (no `members.manage`, no `users.view`)
opens the roster, sees the reduced "Member Directory" the new UI presents,
and reasonably infers that a colleague's username, hire date, and membership
number are coordinator-only information. They are not: the same member can
open browser devtools' Network tab (or call `GET /api/v1/users` directly with
their own session cookie — no additional privilege needed) and read every
one of those fields, plus `rank`/`station`, for the entire roster. The
severity is capped by two things: this is disclosure _within_ the caller's
own organization (no cross-tenant leak — `get_users_for_organization` filters
on `current_user.organization_id` throughout), and none of the exposed
fields are on the leadership-only list `GET /{user_id}/with-roles` already
enforces (DOB, emergency contacts) — but the mismatch between the new UI's
implied tiering and the actual wire payload is real and user-visible to
anyone who looks.

**Impact:** MED — org-internal PII over-exposure relative to the access
model the newest UI change now implies, not a cross-tenant or unauthenticated
leak. Also interacts with USR-7: `member_class`/`member_status`/
`compliance_exempt` are declared on the same response and were found
similarly unpopulated (fixed for a different reason there); populating them
now, before this is resolved, would extend the same over-exposure to a
plausibly more sensitive field (`compliance_exempt` reads as a compliance/
medical-tracking exemption) with no product decision behind it — left unset
for that reason.

**Fix:** not applied. `GET /users` is consumed by at least 25 frontend files
(scheduling rosters, messaging composer, election nominations, meeting
attendance, waiver management, shift reports, and more) via the shared
`userService.getUsers()` call, several of which need fields (`rank`,
`station`, `platoon`) that a naive "trim to `members.manage`" would also
strip from those legitimate, non-directory consumers — this is a response-
shape/product decision (which fields belong at the `members.view` tier vs.
`members.manage`, and whether `GET /users` should serve two shapes by
permission or a second, narrower directory endpoint should be split out),
the same category of call left flagged for FIN-7/ELEC-12/USR-5/MP-10/MS-6.
Mirrored into `KNOWN_LIMITATIONS.md`.

## Verified good ✅ (re-confirmed pass 3)

- **Every by-id fetch across all four files org-scopes.** Traced individually
  in `users.py` (`get_user_roles`, `assign_user_roles`, `add_role_to_user`,
  `remove_role_from_user`, `get_user_with_roles`, `update_contact_info`,
  `update_user_profile`, `delete_user`, `admin_reset_password`,
  `admin_reset_mfa`, `upload_photo`, `delete_photo`,
  `get_member_audit_history`, `anonymize_member` (via
  `MemberAnonymizationService.get_user_for_anonymization`, org_id passed
  explicitly), `get_user_consents`), `member_status.py`
  (`change_member_status`, `get_property_return_preview`, `archive_member`,
  `reactivate_member` (via service), `change_membership_type`,
  `set_compliance_exemption`), and `member_leaves.py` (`get_member_leaves`,
  `update_leave_of_absence`/`delete_leave_of_absence` via
  `MemberLeaveService.get_leave`, both of which filter
  `organization_id == organization_id` at `member_leave_service.py:182-188`).
  No exception found.
- **The one client-supplied FK on a create path is validated in-org (XC-1).**
  `create_leave_of_absence`'s `user_id` is checked against the caller's org
  inside `MemberLeaveService.create_leave` (`member_leave_service.py:108-118`,
  `SELECT User.id WHERE id = :user_id AND organization_id = :organization_id`,
  raises `ValueError` → 400 if absent) before the leave (and its linked
  training waiver) is written — confirmed present and unchanged since pass 2.
- **The class/rank invariant now has a fourth guard, and it holds.**
  `update_user_profile`'s new "stated one of `member_class`/`member_status`,
  refuse to guess the other" check (`users.py:1571-1592`) and
  `_reconcile_membership`'s matching "keep the existing class/status when
  `split_membership_type` can't answer, don't overwrite with `None`"
  (`models/user.py:588-594`) were read in full, cross-checked against the
  documented failure mode (`('senior', None, None)` silently becoming
  `('active', 'operational', 'regular')` on a status-only PATCH), and found
  correctly guarded by existing tests in `test_membership_class_status.py`.
- **`organizations.py` has no by-id path parameter across all 19 routes** —
  confirmed by reading every handler, not inferred from route shapes alone;
  every response is derived exclusively from `current_user.organization_id`,
  so cross-tenant IDOR (XC-3) does not apply to this file's surface.
- **Secrets stay redacted; infrastructure identifiers stay gated on
  `settings.manage`.** `GET /settings` calls `.redacted()` then
  `.without_infrastructure()` for non-`settings.manage` callers
  (`organizations.py:70-79`); `PATCH /settings/email`, `/settings/file-storage`,
  `/settings/auth` each return `.redacted()`, never the raw payload
  (`organizations.py:241,283,326`) — unchanged since pass 1's ORU-2/3/5/8b,
  re-read directly rather than taken on the prior pass's word.
- **`JSON` settings mutation still deep-copies.** `update_module_settings`
  and its siblings in `organization_service.py` (`:397`, `:494`, `:548`) all
  `copy.deepcopy(org.settings or {})` before mutating, never a shallow
  `dict()` — Pitfall #12 holds; the new `testing` module flag flows through
  the same path and needs no migration (module toggles live in the JSON
  `settings` column, not a dedicated column).
- **No new `.ilike()`/`.like()` or raw `csv.writer` in any of the four files**
  (grepped fresh this pass — 0 hits either way).
- **USR-5 (unbounded lists) unchanged, still open, still mirrored.** Verified
  current line numbers still match: `get_archived_members`
  (`member_status.py:738-747`), `list_users_with_roles`
  (`users.py` — `.scalars().all()` at the loader), `leave_widget_summary`
  (`member_leaves.py:58-70`), `MemberLeaveService.list_leaves`
  (`member_leave_service.py:167-176`, sliced in-memory by callers).
- **ORU-7c (org-wide `member` role mass-escalation) unchanged, still a
  documented product decision, not a defect** — `KNOWN_LIMITATIONS.md`
  entry re-read, still accurate.

## Completion gate (pass 3)

| Check                                                                                                                                                                                        | Result                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                | ✅ 0 violations                                                                                                                                           |
| `black --check app/ tests/ alembic/`                                                                                                                                                         | ✅ clean (1387 files unchanged)                                                                                                                           |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                                                                                                  | ✅ clean                                                                                                                                                  |
| `validate_migrations.py --strict`                                                                                                                                                            | ✅ 409 revisions, single head — unchanged (no migration needed)                                                                                           |
| `pytest tests/ -k "users or user_list or organization or member_status or member_leave or member_class or platoon or rank_grant or role_edit or audit_history or ceiling or administrative"` | ✅ 323 passed, 1 skipped (pre-existing `py_vapid`), 0 failed                                                                                              |
| `pytest tests/` (full backend suite)                                                                                                                                                         | ✅ 9833 passed, 21 skipped (pre-existing/environmental: Docker daemon/registry unavailable, `py_vapid` optional dep, opt-in API-contract suite), 0 failed |
| `tsc --noEmit`                                                                                                                                                                               | ✅ 0 errors                                                                                                                                               |
| `eslint .`                                                                                                                                                                                   | ✅ 0 errors/warnings (no frontend file modified this pass)                                                                                                |

Every new/modified guard test confirmed to fail against the pre-fix code via
`git stash` before being counted as covering its finding.

---

## Pass 2 (2026-08-27)

Scoped to the **full domain** since pass 1's merge commit (`5f610f1f`,
PR #1814): `endpoints/users.py`, `endpoints/organizations.py`,
`endpoints/member_status.py`, `endpoints/member_leaves.py`,
`services/user_service.py`, `services/organization_service.py`,
`models/user.py`, `schemas/user.py`, every migration since (checked by
content, not filename), and — since this module has **no dedicated
frontend module directory** (noted in pass 1's own scope, and exactly the
condition that hid `BallotBuilder.tsx` from ELEC-06's first pass) — a
`git diff --stat` against `frontend/src/` broadly, grepped for
user/organization/rank/membership terms, rather than any directory glob.

Two real feature changes since pass 1, both reviewed in full:

- **The member-class/status split** (`20260826_1400_f1a2b3c4d5e6`,
  already read in full during ELEC-06's pass 2 for its voter-eligibility
  angle) reaches this module directly: `models/user.py` owns the
  `member_class`/`member_status` columns and the `_reconcile_membership`
  listener, and `users.py`/`member_status.py`/`schemas/user.py` are where
  a client actually sets them. Re-read from this module's angle
  (authorization and tenant isolation, not eligibility):
  - `MembershipClassificationFields`' two field validators reject any
    value outside the closed `MemberClass`/`MemberStatus` vocabularies —
    a typo 422s rather than silently landing a member in no class at all
    (unlike `membership_type`, which doubles as a free-form,
    org-configurable tier id and genuinely cannot be enum-constrained;
    confirmed by reading `split_membership_type`'s own docstring on why).
  - `member_class`/`member_status` were added to `update_user_profile`'s
    `restricted_fields` set — gated behind the same
    leadership/secretary/membership-coordinator check as `rank`,
    `hire_date`, `station`. Without this, any `users.edit` holder could
    move themselves from social/administrative into operational and vote
    on ballots restricted to that class. Also added to the actual
    `allowed_fields` write-set below the gate — the two sets are
    separate, and a field present in one but not the other is a real,
    previously-seen bug shape in this codebase (a permission-checked,
    audited request that silently no-ops). Confirmed both sets agree.
  - **A cross-endpoint race the first draft called closed — it wasn't,
    on three separate counts (Codex, all confirmed and fixed).** An
    administrative member holds no operational rank — a rank's default
    permissions are unioned into effective permissions regardless of
    class, so an unranked-by-policy administrative member with a rank
    would carry chain-of-command authority they are by definition outside
    of. Setting a rank and setting the class to administrative are
    different requests that can each read an operational, rankless
    member, each pass their own check, and each write only their own
    column — landing a row that is administrative _and_ ranked, which
    neither request alone would have allowed.
    1. **A fourth, unlocked writer.** `MembershipTierService.advance_all`
       — the scheduled/unattended tier-advancement scan — also clears
       rank on a move into an administrative tier, but its batch
       `select(User)` carried no `.with_for_update()` at all. The
       `TestEveryWriterIsCovered`/`TestTheTwoWritersSerialize` tests this
       pass's first draft cited as proof only covered three writers,
       not four, and never actually asserted the fourth's lock (which did
       not exist). Fixed: each member `advance_all` is about to mutate is
       now re-selected with `.with_for_update()` immediately before the
       write, re-checking eligibility under the lock rather than locking
       the whole batch upfront (hundreds of rows for the scan's whole
       duration would have been its own contention problem). Guarded by
       a new `TestTheTwoWritersSerialize` test asserting the lock via
       source inspection.
    2. **The lock alone wasn't enough on a self-update.** Neither locking
       `SELECT` in `update_user_profile`/`change_membership_type` carried
       `populate_existing=True`. On a self-update specifically,
       `get_current_user` already loaded the same `User` row into this
       request's session; with `expire_on_commit=False` (`core/database.py`)
       that instance sits in the identity map, and a re-`SELECT` for a row
       already there returns the cached pre-lock object without copying
       the new row's columns onto it — the lock is acquired at the SQL
       level, but `user.member_class`/`user.rank` could still read
       whatever they were before a concurrent request's commit. The exact
       shape ELEC-06 already found and fixed in `quorum_service.py`; this
       file hadn't caught up. Fixed on both locking reads.
    3. **An explicit `member_class: null` was judged against the wrong
       value.** `resulting_class = update_data.get("member_class") or
user.member_class` can't distinguish "the client omitted this
       field" from "the client explicitly cleared it" — both read back as
       `None` from `.get()`. An explicit null is a request to reset to
       `DEFAULT_CLASS` (operational, per `_reconcile_membership`), not
       "leave the old class in place" — so clearing an administrative
       member's class while assigning a rank in the same request was
       wrongly refused, judged against the stale administrative value
       instead of the operational one the save would actually land on.
       Fixed by checking `"member_class" in update_data` before falling
       back to the stored value.

    All three fixed and guarded: `test_the_automatic_tier_advancement_
locks_each_member_it_advances`, `populate_existing` assertions added to
    the two existing lock tests, and
    `test_an_explicit_null_class_is_judged_as_the_resulting_default`
    (all `test_administrative_rank_restriction.py`).

  - `_canonical_rank_or_400` closes a real, previously-live gap:
    `User.rank` is a plain unconstrained `String(100)`, so a typo'd rank
    silently resolved to no eligible seats and no default permissions
    (looks like the app is broken, not like a typo). Now resolved through
    `OperationalRankService.resolve_rank_code` at write time, on every
    writer (`create_member`, `update_user_profile`) — confirmed the
    canonicalized value is what gets persisted, not the caller's original
    string, which is the exact reuse of a checked-then-discarded value
    that would have re-created the bug one layer down.
  - `_valid_emails`/scheduling-settings reconstruction in
    `organization_service.py` is a read-path robustness fix (a legacy
    `cc_emails` value saved before `EmailStr` tightened the field no
    longer raises on every future settings read for that org, including
    an unrelated module toggle) — confirmed read-only, never on the write
    path, which stays strictly validated.
  - `_trusted_stored_modules`/the module-settings dual-write recovery
    logic: re-derived the "empty dict vs. real all-off configuration"
    distinction (Pitfall #19 territory) and confirmed the two callers
    (`_resolve_module_settings`, `get_enabled_modules`'s new `configured`
    field) share the one implementation rather than risking drift.
- **`schemas/user.py` — a production-breaking regression the first draft
  read straight past (Codex, P1).** Refactoring `AdminUserCreate` to
  inherit `MembershipClassificationFields` also silently dropped
  `password`, `role_ids`, `send_welcome_email`, every address field
  (`address_street`/`_city`/`_state`/`_zip`/`_country`), and
  `emergency_contacts` — fields the diff's own removed lines showed, but
  the first pass never checked against what `create_member` actually
  reads. Pydantic discards a request key the schema no longer declares,
  so `POST /api/v1/users` reached `if user_data.password` with no such
  attribute and raised `AttributeError` on every single call — **member
  creation was completely broken** on `main`. Fixed by restoring the
  dropped fields to `AdminUserCreate`. Every existing test for this route
  was source-inspection style (asserting a ceiling-check call appears in
  the right order), so none of them constructed a real schema instance or
  would ever have caught a field silently disappearing — confirmed by
  checking each one before concluding this needed a new test, not a
  stronger assertion on an existing one. Guarded by
  `test_create_member_reads_only_declared_admin_user_create_fields`
  (`test_privilege_ceiling_wiring.py`): extracts every `user_data.<attr>`
  access from the route's own source via regex and asserts each is a
  field `AdminUserCreate` declares, so a hardcoded field list can't rot
  out of sync with either side and the two can never drift silently
  again.
- **`frontend/src/hooks/ranksCache.ts`/`useRanks.ts` — a real prior bug
  fixed, not introduced.** The rank list cache was previously a single
  module-level variable shared across the whole browser session,
  unscoped by organization — a user who switched organizations without a
  full page reload could see the _previous_ org's rank list in a
  rank-selection dropdown. Now keyed by `(organizationId, activeOnly)`.
  Also guards the exact stale-response race this rotation's AUTH-3 found
  in `PhotoUseConsentPage.tsx` (a ref holding the current cache key,
  checked before an async fetch's result is applied) — confirmed present
  and correct by direct read, and covered by a dedicated
  `does not expose ranks cached for another organization` test.

**5 real findings, all fixed** (a production-breaking schema regression,
three separate gaps in the class/rank invariant's enforcement — an
unlocked fourth writer, a missing `populate_existing` on the two locked
ones, and an explicit-null misjudgment — caught across two Codex review
rounds on this PR). Everything else read either closed a real,
previously-live gap (unconstrained rank strings, cross-org rank-cache
leakage, a read-path settings crash) or correctly re-derived an
already-solved pattern from elsewhere in the codebase (Pitfall #19
dual-write recovery, the stale-response ref guard). All fixes
independently verified against the real code (reproduced the
`AttributeError` directly, traced the identity-map/`expire_on_commit`
behavior the same way as the ELEC-06 quorum fix, traced
`model_dump(exclude_unset=True)`'s omitted-vs-null distinction) before
fixing — not taken on Codex's word.

**Completion gate (pass 2):** flake8/black/isort clean on `app/ tests/
alembic/`; `validate_migrations.py --strict` passed (single head); scoped
backend tests (`-k "users or organization or member_status or
member_class or rank or administrative or tier"`) 430 passed, 1 skipped
(pre-existing), 0 failed; full backend suite 9110 passed, 22 skipped
(pre-existing), 0 failed; `tsc --noEmit` 0 errors; `eslint` on every
changed frontend file 0 errors; `vitest run` on the two new/changed
frontend test files 9 passed. Every new/modified guard test confirmed to
fail against the pre-fix code via `git stash` before being counted as
covering its finding.

---

## Pass 1 (2026-08-25)

**Backend:** `api/v1/endpoints/users.py` (2,484 L, 23 routes),
`api/v1/endpoints/organizations.py` (1,272 L, 19 routes),
`api/v1/endpoints/member_status.py` (1,046 L, 12 routes),
`api/v1/endpoints/member_leaves.py` (297 L, 7 routes) — 61 routes total
**Frontend:** (in-app, no dedicated module directory)
**Migrations:** `users`/`organizations` are initial-schema tables;
`member_leaves_of_absence` has its own creating migration
(`20260220_0300_add_member_leaves_of_absence.py`). See Schema & migration
notes.

---

## Scope

The highest-risk surface in the codebase by design (privilege escalation):
module-audit iteration 21 (three parallel readers) plus four dedicated
app-review passes (2026-08-06 through 2026-08-09) that exist specifically
because this module governs role/permission/rank assignment. Every finding
across both series is closed except ORU-7c (org-wide `member` role
mass-escalation), which is an intentional-but-sharp design flagged for a
product decision, not a defect — unchanged, re-confirmed still accurate in
`KNOWN_LIMITATIONS.md`.

`member_leaves.py` is not in the module-audit's own file list for this
grouping — it was reviewed under a different module-audit entry
(`module-audit/membership-pipeline.md`, iteration 9, MP-3/MP-4 fixed) that
groups it with `membership_pipeline.py`/`member_status.py` instead. Both
findings there are closed; re-verified below rather than re-derived.

**File sizes have grown since the last full pass** (`users.py` 1,774→2,484 L,
`organizations.py` 1,026→1,272 L, `member_status.py` 911→1,046 L,
`member_leaves.py` 251→297 L) — traced to specific, already-fixed,
already-tested commits (the `hire_date` restricted-field fix, a
`scheduling.assign` permission added to leave creation, admin-navigation/PII
redaction) rather than one large undocumented feature. No new feature of the
`SavedBallotTemplate` shape was found in this module.

**Corrected — a Codex review round on the PR caught eight real issues** the
first pass of this file missed, seven of them by checking only part of what
each claim required (auth coverage checked permission-vs-authenticated but
not a third bare-`get_current_user`-with-no-self-check category; the
unbounded-query dismissal checked current headcount but not that accounts
are archived, never deleted; the completion gate's test selector matched 2
of 37 relevant tests; a "table not found" skip was actually a stale table
name; the audit-history allowlist and its query predicate both had real
gaps; a "covered by existing regression test" claim was true of the helper
function but not its call sites). All eight are addressed below — six with
code fixes, two with corrected claims. Full detail in Findings.

**Read in full:** every route decorator and its auth dependency across all
four files (61 routes), corrected below to a third bare-auth category the
first pass mischaracterized. The privilege-ceiling call sites
(`_enforce_role_grant_ceiling`, `_enforce_rank_grant_ceiling`) and their
callers. The PII-redaction call sites. The settings redaction call sites in
`organizations.py`. Every `.scalars().all()` call across the four files, for
dimension 6. The member audit-history query's full predicate
(`users.py:2198-2246`) and the `_AUDIT_EVENT_DESCRIPTIONS` allowlist it
filters through. `member_leaves.py`'s create/update/delete handlers and
`MemberLeaveService`.

**Re-verified by targeted check, not full re-read:** the pre-existing
findings (ORU-1…9, ORU-7a/b/c/d) — each has a re-verification history across
5 passes; this iteration confirmed the mechanisms are still wired at their
documented call sites rather than re-deriving them.

**Not re-read line-by-line:** the full ~5,100 combined lines. Sections with
no signal of change (no new route, no doc drift, no migration) were not
re-read past the auth-coverage and ceiling/redaction spot checks.

## Route inventory

61 routes across the four files, in three categories — corrected from the
original two-category pass:

- **`require_permission`/`require_all_permissions`-gated:** the large
  majority of the 61.
- **Bare `get_current_user`, self-or-admin checked in the handler body:**
  self-service mutations (contact-info, profile, photo) and the
  target-vs-caller comparisons in `member_leaves.py`.
- **Bare `get_current_user`, no self-check — org-wide reads with no
  permission string at all:** `GET /users/contact-info-enabled`, and in
  `organizations.py` — `GET /settings`, `GET /modules`, `GET /profile`. The
  original pass's route inventory claimed no route falls into this third
  category; wrong. Verified this is the same, already-audited pattern
  ORU-8b covers for `/settings` (`without_infrastructure()` strips secrets/
  `it_team` for non-`settings.manage` callers before the bare-auth response
  goes out) — the org derives exclusively from `current_user.organization_id`
  in all three, and none returns another org's data or a secret to a caller
  who merely authenticated. Not a defect; a genuine third category the
  inventory should have named.

## Verified good ✅ (re-confirmed this pass)

- **The privilege-escalation ceilings are still wired at their documented
  call sites.** `_enforce_role_grant_ceiling` (`users.py:677`) is called from
  `create_member` (`:325`) and the add-role paths (`:828`, `:954`).
  `_enforce_rank_grant_ceiling` (`users.py:713`) is called from
  `create_member` (`:253`) and `update_user_profile`'s rank-change branch
  (`:1433`) — closing both ORU-1 and the CRITICAL ORU-7d parallel-escalation
  path. **Corrected:** the original pass cited `test_rank_grant_ceiling.py`
  as covering this; it calls `_enforce_rank_grant_ceiling` directly, not
  through either route, so it cannot detect the call being silently dropped
  from either wiring point — which is exactly how ORU-1 and ORU-7d
  originally happened. A new source-inspection guard test closes that gap
  (see Guard tests).
- **PII redaction gates (ORU-8) still wired on both `with-roles` callers.**
- **Settings secret redaction (ORU-2/3/5) still holds.**
- **`hire_date` restriction (2026-08-16 fix) confirmed present and tested.**
- **No SQL injection; no CSV export in this module.**
- **Schema & migration integrity clean** (see Schema & migration notes).

## Findings

Six fixed, two doc corrections (no code change needed for those two).

### USR-1 — LOW/MED — Leave-of-absence create/update/delete never wrote an audit event — ✅ FIXED

**What:** `_AUDIT_EVENT_DESCRIPTIONS` and `_AUDIT_EVENT_FILTERS` have
declared `leave_of_absence_created`/`_updated`/`_deleted` since the
audit-history feature shipped, but no code anywhere called `log_audit_event`
with any of the three — confirmed by a repo-wide search for the literal
strings. `create_leave_of_absence`/`update_leave_of_absence`/
`delete_leave_of_absence` (`member_leaves.py`) committed straight to the
database with no audit trail.

**Failure scenario:** an officer creates, backdates, or deactivates a
member's leave of absence — which also drives training-waiver eligibility
and shift-assignment cancellation — and nothing records who did it or when.
A member disputing an incorrect leave record, or an audit of officer
activity, finds no entry for any of it.

**Fix:** each handler now calls `log_audit_event` with the declared event
type, `target_user_id` set to the leave's member, and the relevant detail
(dates/type on create, changed field names on update, the leave id on
delete) — matching the shape every other event in the allowlist already
uses, so the audit-history query picks these up with no further change.

### USR-2 — MED — Member audit-history query leaked unrelated members' events into an actor's own history — ✅ FIXED

**What:** the query's final `OR` clause was `AuditLog.user_id ==
user_id_str` with no further condition — "this member was the actor,"
unconditionally. Every other clause matches on a specific target field
(`target_user_id`, `new_user_id`, etc.), so an event where this member acted
**on someone else** was included by the actor clause even though the target
fields correctly identify a different person.

**Where:** `users.py:2198-2246` (`get_member_audit_history`).

**Failure scenario:** a manager views member A's audit history (advertised
as "changes to the member's record"). A previously reset member B's MFA
(`admin_mfa_reset`, `target_user_id=B`). That event now appears in **A's**
history too, because A was the actor — showing the manager an entry that
names B and describes an action on B's account, under a page whose header
says it's A's record.

**Fix:** the actor-fallback clause now additionally requires that none of
the five known target-field keys are populated in `event_data` — i.e. it
only fires for genuinely self-inherent events (no separate target recorded
at all, such as a member editing their own contact info). Any event that
does carry a target is decided solely by the target-match clauses, on their
own merits — narrower than before, never broader.

### USR-3 — LOW — Two real, emitted audit event types were invisible in member history — ✅ FIXED

**What:** `admin_mfa_reset` (`users.py:1820`) and `compliance_exemption_changed`
(`member_status.py:1028`) are both real events, already written with a
`target_user_id` in the same shape every other tracked event uses — but
neither was a key in `_AUDIT_EVENT_DESCRIPTIONS`, so `member_event_types =
list(_AUDIT_EVENT_DESCRIPTIONS.keys())` silently excluded both from the
query's `event_type.in_(...)` filter regardless of the target match.

**Failure scenario:** a manager investigating a member's account cannot see
that their MFA was administratively reset, or that a compliance exemption
was granted or revoked — two of the more security/compliance-relevant
actions this endpoint exists to surface.

**Fix:** added both to `_AUDIT_EVENT_DESCRIPTIONS`.

### USR-4 — LOW — A schema regression test silently skipped instead of verifying anything — ✅ FIXED

**What:** `test_user_roles_junction_has_both_fks` looked up a table named
`user_roles` in the reflected schema. `models/user.py:546` declares
`user_roles = user_positions` — a **Python-level** backward-compatible
alias, not a second database table; the live table is `user_positions`
(`:522`). The lookup always returned `None`, so the test always
`pytest.skip()`'d and never once checked the real junction table's foreign
keys.

**Fix:** look up `user_positions` and assert its FKs target `users` and
`positions` (not `roles` — `Role = Position` is also just an alias). Now
passes for real rather than skipping (verified: reverting the fix reproduces
the skip).

### USR-5 — LOW/MED — Unbounded lists over data that accumulates without deletion — 🚩 FLAGGED (corrected from "no defect")

**What:** the original pass of this section checked `list_users_with_roles`
and `get_archived_members` for the FIN-9/ELEC-12 unbounded-scan shape and
dismissed both, reasoning they're bounded by "real department headcount."
That reasoning is wrong: `archive_member` changes `User.status` without
deleting the row, so archived accounts accumulate for the organization's
entire lifetime, and `list_users_with_roles` filters only `deleted_at`, not
`status` — both grow with **all-time membership**, not current headcount.
The same pass also missed two more instances in this module's own file set:
`leave_widget_summary` (`member_leaves.py:57-69`, every `active` leave, and
end dates don't clear that flag) and `MemberLeaveService.list_leaves`
(`member_leave_service.py:160-177`), which runs `.scalars().all()` before
`member_leaves.py`'s callers apply an in-memory slice.

**Impact:** LOW today for a young/small department, growing over the life of
the organization; all four are `members.manage`-gated (not reachable by an
ordinary member) and org-scoped (not cross-tenant).

**Fix:** not applied — pagination on any of these four is a response-envelope
change needing a decision on default page size and whether existing callers
(the roster page, the leave widget) tolerate a paginated response without a
frontend change, the same category of judgment call FIN-7's export cap and
ELEC-12 were left flagged for. Mirrored into `KNOWN_LIMITATIONS.md`.

### USR-6 — Doc correction — Route inventory omitted a third bare-auth category

Covered under Route inventory above — not a code defect, a mischaracterization
of the existing (already-audited, ORU-8b-covered) design.

## Schema & migration notes

`users` and `organizations` are part of the initial schema migration — not
`create_all`-only, unlike several modules reviewed earlier in this rotation.
`member_leaves_of_absence` (`member_leaves.py`'s table) has its own dedicated
migration (`20260220_0300_add_member_leaves_of_absence.py`). The one
`ondelete="SET NULL"` FK in `models/user.py` is paired `nullable=True`.

## Guard tests added

- `tests/test_member_leave_audit_events.py` — three tests (create/update/
  delete) asserting the expected `leave_of_absence_*` audit row now exists
  with the correct `target_user_id` (USR-1).
- `tests/test_member_audit_history_scoping.py` — asserts the two new
  allowlist entries are present (USR-3), and a DB-backed test proving a
  manager's own audit-history no longer includes an event they performed on
  a different member, while still including a genuine self-action
  (USR-2) — verified to fail without the fix.
- `tests/test_database_schema.py::test_user_roles_junction_has_both_fks`
  (USR-4) — corrected in place to look up the live table name; verified to
  actually run (not skip) and to still pass against the real schema.
- `tests/test_privilege_ceiling_wiring.py` — two source-inspection tests
  asserting `create_member` calls both ceiling functions and
  `update_user_profile` calls the rank ceiling — cheap, and it fails loudly
  if either call is ever silently dropped (the exact shape of the original
  ORU-1/ORU-7d bugs), closing the coverage gap Codex identified in the
  existing helper-level tests.

## Completion gate

| Check                                                                                                                             | Result                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                     | ✅ 0 violations                                                                     |
| `black --check app/ tests/ alembic/`                                                                                              | ✅ clean                                                                            |
| `isort --check-only app/ tests/ alembic/` (8.0.1, CI's pin)                                                                       | ✅ clean                                                                            |
| `validate_migrations.py --strict`                                                                                                 | ✅ 356 revisions, single head                                                       |
| `pytest tests/test_pii_exposure.py`                                                                                               | ✅ 37 passed (full file — corrected from a `-k` selector that matched only 2 of 37) |
| `pytest tests/ -k "user or organization or member_status or member_leave or rank_grant or role_edit or audit_history or ceiling"` | ✅ 320 passed, 1 skipped (unrelated `py_vapid` optional dep)                        |
| `tsc --noEmit`                                                                                                                    | ✅ 0 errors (no frontend file changed)                                              |
| `eslint .`                                                                                                                        | ✅ 0 errors/warnings (no frontend file changed)                                     |
