# Security Review 07 — Users & Organizations

**Prefix:** `USR` · **Iteration:** 07 · **Reviewed:** 2026-08-25 · **PR:** TBD

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
`member_leaves.py` 251→297 L) — smaller, proportionally, than elections'
near-doubling last iteration, and unlike that case the growth traces to
specific, already-fixed, already-tested commits rather than one large
undocumented feature: `fix(users): restrict hire date profile updates`
(2026-08-16, adds `hire_date` to the leadership/secretary/membership-coordinator
restricted-field set — `hire_date` drives automatic tier advancement and was
editable with the broader `users.edit` grant; own regression test), `Require
scheduling permission when creating leave` (2026-08-17, `create_leave_of_absence`
now requires `scheduling.assign` in addition to `members.manage` via
`require_all_permissions`), and several admin-navigation/PII-redaction
commits (`Redact directory profile security metadata`, `Centralize
administration navigation permissions`) verified present in current code
below. No new undocumented feature of the `SavedBallotTemplate` shape was
found in this module.

**Read in full:** every route decorator and its auth dependency across all
four files (61 routes). The privilege-ceiling call sites
(`_enforce_role_grant_ceiling`, `_enforce_rank_grant_ceiling`) and their
callers. The PII-redaction call sites (`_clear_hidden_contact_fields`,
`_clear_leadership_only_fields`, `_redact_contact_fields`). The settings
redaction call sites in `organizations.py`. Every `.scalars().all()` call
across the four files, for dimension 6.

**Re-verified by targeted check, not full re-read:** the pre-existing
findings (ORU-1…9, ORU-7a/b/c/d) — each has a re-verification history across
5 passes; this iteration confirmed the mechanisms are still wired at their
documented call sites rather than re-deriving them.

**Not re-read line-by-line:** the full ~5,100 combined lines. Sections with
no signal of change (no new route, no doc drift, no migration) were not
re-read past the auth-coverage and ceiling/redaction spot checks.

## Route inventory

All 61 routes across the four files carry either `require_permission`,
`require_all_permissions`, or (for self-service/self-scoped mutations)
`get_current_user` with an explicit self-or-admin check in the handler body —
enumerated mechanically, not spot-checked. One route
(`POST /leaves-of-absence`) uses `require_all_permissions("members.manage",
"scheduling.assign")`, which a plain grep for `require_permission` initially
missed; confirmed by reading the route directly. No route falls through to
bare `get_current_user` without a self-scoping check in the body.

## Verified good ✅ (re-confirmed this pass)

- **The privilege-escalation ceilings are still wired at their documented
  call sites.** `_enforce_role_grant_ceiling` (`users.py:677`) is called from
  `create_member` (`:325`) and the add-role paths (`:828`, `:954`).
  `_enforce_rank_grant_ceiling` (`users.py:713`) is called from
  `create_member` (`:253`) and `update_user_profile`'s rank-change branch
  (`:1433`) — closing both ORU-1 and the CRITICAL ORU-7d parallel-escalation
  path (rank granting permissions beyond a role's own ceiling).
- **PII redaction gates (ORU-8) still wired on both `with-roles` callers.**
  `_clear_hidden_contact_fields`/`_clear_leadership_only_fields` run in both
  `get_user_with_roles` (`:596-597`) and `list_users_with_roles`'s per-user
  `_redact_contact_fields` (`:639`) and the detail-view equivalent
  (`:1192-1193`) — the setting can no longer be bypassed by hitting the
  detail URL instead of the roster.
- **Settings secret redaction (ORU-2/3/5) still holds.** `email_settings`,
  `storage_settings`, and `auth_settings` all `return ….redacted()`
  (`organizations.py:241,283,326`), and `settings.manage_contact_visibility`
  is confirmed absent from the full-settings route's permission list (ORU-2's
  fix).
- **`hire_date` restriction (2026-08-16 fix) confirmed present and
  tested.** `update_user_profile`'s `restricted_fields` set includes
  `hire_date` alongside `rank`/`station`/`platoon`/`membership_number`
  (`users.py:1330-1338`); `tests/test_user_profile_permissions.py` covers it.
- **Audit-history query is org-scoped and paginated.** `GET
/users/{id}/audit-history` filters `AuditLog.organization_id` directly
  (closing the deferred ORU-9 item) and applies `.offset()/.limit()`
  (`users.py:2205,2231-2232`) — not the FIN-9/ELEC-12 unbounded shape.
- **No SQL injection; no CSV export in this module.** Zero `.like()`/
  `.ilike()` calls across all four files — nothing for the LIKE-escaping
  class to apply to, and no exporter to require `SafeCsvWriter`.
- **Schema & migration integrity clean.** `users`/`organizations` are
  initial-schema (migration `20260118_...`) tables; `member_leaves_of_absence`
  has its own dedicated creating migration. The one `ondelete="SET NULL"` FK
  across `models/user.py` is `nullable=True`.

## Findings

No fixable defect and no new flaggable gap found. This module's remaining
open item (ORU-7c) was already flagged by a prior pass and is unchanged.

### On why this iteration found no ELEC-12-shaped gap

Both `list_users_with_roles` (`users.py:630`) and `get_archived_members`
(`member_status.py:746`) run unbounded `.scalars().all()` queries — the same
surface shape that produced FIN-9 and ELEC-12 in the last two iterations.
The distinction: those were unbounded over **accumulating, user-generated
data with no natural ceiling** (every pending approval ever created
platform-wide; every ballot template an org ever saves). These two are
bounded by an organization's actual membership headcount — a fire department
roster (active or archived) does not grow without limit the way a template
library or an approval queue does. Recorded so a future reviewer does not
have to re-derive why the same query shape isn't the same finding here.

## Schema & migration notes

`users` and `organizations` are part of the initial schema migration — not
`create_all`-only, unlike several modules reviewed earlier in this rotation.
`member_leaves_of_absence` (`member_leaves.py`'s table) has its own dedicated
migration (`20260220_0300_add_member_leaves_of_absence.py`). The one
`ondelete="SET NULL"` FK in `models/user.py` is paired `nullable=True`.

## Guard tests added

None. No code changed this iteration — every mechanism checked was already
covered by an existing regression test from the commit that introduced or
fixed it (`test_rank_grant_ceiling.py`, `test_role_edit_ceiling`,
`test_user_profile_permissions.py`, `test_pii_exposure.py`).

## Completion gate

| Check                                                                                                 | Result                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                         | ✅ 0 violations (no Python file changed)                                                                    |
| `black --check app/ tests/ alembic/`                                                                  | ✅ unchanged                                                                                                |
| `isort --check-only app/ tests/ alembic/` (8.0.1, CI's pin)                                           | ✅ clean                                                                                                    |
| `validate_migrations.py --strict`                                                                     | ✅ 356 revisions, single head                                                                               |
| `pytest tests/ -k "user or organization or member_status or member_leave or rank_grant or role_edit"` | ✅ 295 passed, 2 skipped (unrelated: `py_vapid` optional dep, `user_roles` table not found in this sandbox) |
| `tsc --noEmit`                                                                                        | ✅ 0 errors (no frontend file changed)                                                                      |
| `eslint .`                                                                                            | ✅ 0 errors/warnings (no frontend file changed)                                                             |
