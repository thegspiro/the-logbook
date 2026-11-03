# Security Review — Permissions & Roles

**Prefix:** `PERM` · **Iteration:** 02 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3), 2026-09-08 (pass 4), 2026-09-14 (pass 5), 2026-09-15 (pass 6), 2026-10-05 (pass 7), 2026-10-12 (pass 8, watchdog pickup), 2026-10-14 (pass 9, watchdog pickup), 2026-10-18 (pass 10, watchdog pickup), 2026-10-22 (pass 11, watchdog pickup), 2026-10-25 (pass 12, watchdog pickup), 2026-10-28 (pass 13, watchdog pickup), 2026-10-31 (pass 14, watchdog pickup) · **PR:** #1805 (pass 1), #2136 (pass 3), #2391 (pass 4), #2538 (pass 5), #2596 (pass 6), #2933 (pass 7), #3097 (pass 8), #3212 (pass 9), #3398 (pass 10), #3557 (pass 11, the header's own "this PR" placeholder was never filled in after merge; corrected here), #3685 (pass 12), #3803 (pass 13, same stale-placeholder correction applied here), pass 14 (this PR)

Passes are recorded in this one file rather than a new `PERM<n>-02-*.md` per
lap, matching what passes 2 and 3 already did here. Newest pass first.

---

## Pass 14 (2026-10-31, watchdog pickup) — 1 fixed (PERM-12, LOW), 0 new OPEN findings; PERM-10/PERM-11 re-verified still open

Watchdog pickup: the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable — confirmed via
`ListAgents`, no reachable agents at all. Step 0 re-checked fresh against
GitHub (`search_pull_requests`, `is:pr is:open head:claude/security-review-`):
0 results. PR #3870 (Feature 01, Auth & session lifecycle, pass 14) had
already merged (`f9220b364`, a true zero-delta pass for that feature plus
an unrelated `follow-redirects` npm-audit fix). Rotation row 01 is `✅`; row
02 (Permissions & roles) is the next `⬜` row, read directly off a
freshly-pulled `main`.

**Baseline:** `4f21727a` (main's state when pass 13 began its own review;
pass 13's own merge, PR #3803, landed one commit later at `d2cd227fd` and
touched only the two docs files, so it introduces no code delta to diff
against). **Head:** current `main` (`f9220b364`, PR #3870's merge). 267
commits between them (175 non-merge). `git diff --stat` against every one of the eleven files/pairs
this feature tracks (`dependencies.py`, `core/permissions.py`, `roles.py` +
`role_service.py`, `operational_ranks.py` + `operational_rank_service.py`,
`officers.py` + `officer_service.py`, `org_chart.py` +
`org_chart_service.py`, `admin_continuity_service.py`, and the
rank/role-assignment surface in `users.py`) is non-empty in four:
`roles.py` (+2), `core/permissions.py` (+109), `operational_rank_service.py`
(+11/-4), `role_service.py` (+26), `users.py` (+62/-10, computed excluding
the schema-import reordering). `dependencies.py`, `officers.py`,
`officer_service.py`, `org_chart.py`, `org_chart_service.py`, and
`admin_continuity_service.py` are byte-identical to pass 13.

### Route inventory — re-enumerated by AST, not diffed

**28 routes, unchanged from pass 13** — re-walked with a fresh AST script
over all four endpoint files: `roles.py` (13), `operational_ranks.py` (7),
`officers.py` (3), `org_chart.py` (5), same methods, same paths, same
handler names as pass 13's inventory. `officers.py` and `org_chart.py` are
byte-identical to pass 13, so neither could have regressed; `roles.py` and
`operational_ranks.py` changed but not in a way that touches a route
decorator, a `Depends`, or a permission string (confirmed by reading both
diffs in full, below).

### The four changed files, reviewed

- **`core/permissions.py` + `role_service.py` + `roles.py` — a position now
  carries a `kind`: `office`, `committee`, or `system`.** This is a new
  feature (four seeded committee positions — `community_outreach_team`,
  `history_committee`, `fundraising_committee`, `membership_committee` —
  plus the ability for a department to mark its own custom position as a
  committee), not a permissions change: `kind` decides how the member
  screens group a held position and grants nothing of its own.
  - **The four seeded committees carry a _copy_ of the `member` baseline
    permission list, not the same list object**
    (`core/permissions.py:2850-2886`: `DEFAULT_POSITIONS[_slug]["permissions"]
= list(DEFAULT_POSITIONS["member"]["permissions"])`) — Pitfall #23's
    exact failure mode (a rank/position grant reaching the database by way
    of a shared mutable object) is the thing this code comment and the
    `list()` copy are deliberately avoiding, and
    `tests/test_position_kinds.py::test_a_committee_carries_the_baseline_as_a_copy`
    machine-checks both the value equality and the `is not` identity check.
    Not seeded with anything beyond the baseline — confirmed by reading the
    four definitions (`permissions: []` in source, overwritten to the
    baseline copy by the loop immediately below the dict, never the module
    wildcard or any `*.manage` string).
  - **Migration `d8f1a4c27b93`** (`backend/alembic/versions/20261029_1300_*`)
    adds `positions.kind` with `server_default="office"` (settles existing
    rows per Pitfall #35, rather than relying on an app-level default), is
    guarded on `_has_table("positions")`/`_has_table("organizations")`
    before touching either (Pitfall #26), inlines its own frozen copy of
    the system-slug list and the baseline permission snapshot rather than
    importing from `core/permissions.py` (Pitfall #20 — "a migration keeps
    doing what it did the day it ran"), and the committee backfill is an
    `INSERT ... WHERE (org, slug) NOT IN existing` per organization, so
    running it twice inserts nothing twice. `downgrade()` deletes only the
    seeded committee rows nobody holds (`id NOT IN (SELECT position_id FROM
user_positions)`) and demotes the column rather than stripping a held
    position from a member. Ran `validate_migrations.py --strict` against
    it: single head, 678 revisions.
  - **`kind` cannot be used to mint a fake system position — except through
    one validation gap, found and fixed this pass (PERM-12, below).** The
    `RoleCreate`/`RoleUpdate` Pydantic schemas restrict the field to
    `Literal["office", "committee"]` (`schemas/role.py:35,47`), and
    `role_service.update_role`'s `is_system` branch separately refuses any
    `kind` change at all on a system row, and its non-system branch
    separately refuses `kind="system"`
    (`role_service.py:356-359,417-423`). `create_role`'s own check
    (`role_service.py:217`, pre-fix) was `if kind not in POSITION_KINDS`,
    and `POSITION_KINDS` **includes** `"system"` — so the service method
    itself would have accepted `kind="system"` from any caller that
    reaches it without going through the Pydantic schema. See **PERM-12**.
  - **Placement relative to the ceiling checks is correct.** The `kind`
    passthrough in `roles.py`'s `create_role`/`update_role` handlers
    (`roles.py:258,368`) sits after the existing
    `_enforce_permission_grant_ceiling` calls (`roles.py:244,344,354`, both
    byte-identical to pass 13), so `kind` cannot be used to skip a ceiling
    check that already ran — it is a field passed into an already-gated
    call, not a new code path around the gate.
  - **`clone_role`** (`role_service.py:597`) sets
    `kind=source.kind if source.kind == "committee" else "office"` — never
    `"system"`, so cloning a system position (e.g. a rank mirror) produces
    an ordinary office, not a copy of the platform's own kind. Correct and
    consistent with the rest of this feature's "system is never
    client-mintable" invariant.
  - **`operational_rank_service.py`'s own change is unrelated to `kind`** —
    it's `delete_rank`'s org-chart-seat-conflict error message switching
    from an unbounded joined string to `list_within_detail_limit()` (a
    pre-existing shared util, already used elsewhere, that caps the
    rendered detail at `MAX_ERROR_DETAIL_LENGTH` and says "and N more"
    rather than growing with the data) — an abuse-resistance hardening
    (checklist dimension 6), not a behavior or permission change. No
    `require_stepup`/`require_permission`/org-scoping change in this file.
  - **Frontend:** `types/role.ts` and `utils/positions.ts` gained `kind` /
    `PositionKind` / `isCommittee()` / `groupPositionsByKind()` — read in
    full; purely display grouping (which section a position chip renders
    under), no permission-gating component (`ProtectedRoute`, a
    `requiredPermission` prop, a permission-derived conditional render)
    touches `kind` anywhere in the diff. Confirmed via
    `grep -rn "kind" frontend/src/modules/settings` returning nothing and a
    read of both changed files end to end.
- **`users.py` — `create_member` and `update_user_profile` gained
  `member_status` validation against the organization's own membership
  tiers (`_accepted_member_status_or_400`, `users.py:1261-1303`).** This is
  feature work for the membership-tiers/standing model
  (commit `5ec1897d4`, "class and status as two controls; tiers become
  statuses"), not a permissions or role-assignment change, and it sits in
  functions this feature tracks only because `_enforce_rank_grant_ceiling`
  also lives in both of them. Read in full since it is new code in a
  tracked file:
  - **No new permission or org-scoping surface.** The helper takes
    `organization_id` from the caller (always `current_user.organization_id`
    at both call sites, `users.py:471,2042` — never a client-supplied org
    id) and locks that one `Organization` row (`.with_for_update()`) before
    reading `settings["membership_tiers"]`. No new by-id fetch of another
    table, no new client-supplied FK.
  - **Lock ordering is stated and consistent with the rest of the file.**
    The comment at the `update_user_profile` call site
    (`users.py:2036-2039`) explains the helper's Organization-row lock must
    run _before_ the function's own subsequent `User`-row lock, matching
    "the order every other writer of a member's standing uses" — the same
    Organization-before-member ordering `_enforce_rank_grant_ceiling` and
    the quorum-calculation code already follow, so this does not introduce
    a new lock-ordering hazard (Pitfall #27's deadlock risk is between two
    _different_ orderings, not a single consistent one).
  - **Fails closed.** An unrecognized `member_status` that is neither a
    built-in status nor one of the org's own tier ids raises `HTTPException`
    400; it is not silently stored.
  - This is adjacent, reviewed-for-correctness territory for this pass, not
    a PERM finding — it belongs to Feature 07 (Users & organizations) or
    Feature 08 (Membership pipeline)'s own scope for anything beyond the
    permissions-surface check given here.

### Re-verified, not re-derived

- **PERM-1 through PERM-9** — unaffected; every file they depend on is
  either byte-identical to pass 13 or, where changed (`role_service.py`,
  `operational_rank_service.py`), changed only in the ways described above,
  none of which touch the ceiling machinery those findings concern.
- **PERM-10 (MED, FLAGGED) and PERM-11 (MED, FLAGGED)** — re-read against
  current `main` rather than trusted from pass 13's text.
  `create_member` (`users.py:464`, ceiling call) and the rank-change branch
  of `update_user_profile` (`users.py:2174`, ceiling call) still carry no
  `require_stepup` — confirmed via `grep -n "require_stepup"
app/api/v1/endpoints/users.py`, which lists every other sensitive handler
  in the file (`admin_reset_password`, `admin_reset_mfa`,
  `admin_remove_passkey`, `delete_user`, `assign_user_roles`, etc.) but not
  these two line numbers. `operational_ranks.py`'s `create_rank`/
  `update_rank`/`delete_rank` are byte-identical to pass 13 (confirmed by
  the empty diff above) and so still carry none either. Both remain
  **OPEN / FLAGGED** — still an owner decision belonging to Feature 01's
  `STEPUP_HANDLERS` mechanism. `docs/KNOWN_LIMITATIONS.md`'s entries for
  both are present and accurate, unchanged.
- **OR-gate alternatives** — `positions.*`/`roles.*`/`members.manage`/
  `organization.update_settings`/`orgchart.manage` re-confirmed not seeded
  to `member` or `firefighter` (the new committee seeds carry an empty
  permission list widened to only the `member` baseline, confirmed above —
  none of the four gates this bullet tracks).

### PERM-12 — LOW — `RoleManagementService.create_role`'s `kind` check was weaker than its sibling `update_role` check, and would have accepted `kind="system"` — ✅ FIXED

**What:** `update_role` explicitly refuses `kind="system"` on a non-system
role (`role_service.py:417-423`, pre-existing, unchanged this pass):
"A position is an office or a committee; 'system' is reserved for the
platform's own." `create_role`'s check did not carry the same exclusion —
it was `if kind not in POSITION_KINDS`, and `POSITION_KINDS =
("office", "committee", "system")` (`core/permissions.py`), so `"system"`
passed this check and would have been stored.

**Where:** `app/services/role_service.py:217-220` (pre-fix).

**Failure scenario:** not reachable through the live HTTP API today —
`RoleCreate.kind` is `Literal["office", "committee"]`
(`schemas/role.py:35`), so the one route that calls `create_role`
(`POST /roles`, `roles.py:249`) can never pass `"system"` through, and the
only other live caller, `clone_role`, never passes it either (traced
above). The gap is in the service method's own defense in depth: a future
internal caller — a script, a new onboarding path, a different endpoint
added later that calls `RoleManagementService.create_role()` directly
without going through the `RoleCreate` schema — could create an ordinary
organization-scoped role with `kind="system"`, which the frontend's
`groupPositionsByKind()` and any future code trusting `kind == "system"` as
"this is the platform's own, not a department's" would then misclassify.
Not currently exploitable (no such caller exists), but it is exactly the
kind of latent gap CLAUDE.md Pitfall #23's broader lesson warns about: a
grant/classification-bearing field should not depend entirely on one
caller's schema to stay correct.

**Impact:** LOW — no live path reaches it, and `kind` grants no permission
by itself (it is UI grouping metadata, not an authorization boundary) — but
closing it is a one-line, mechanical, verifiable change that makes the two
sibling methods consistent and removes the latent gap rather than merely
noting it.

**Fix:** changed the condition to `if kind not in POSITION_KINDS or kind ==
"system"`, matching `update_role`'s existing exclusion, with a comment
explaining why (system positions are built by `initialize_default_roles`
directly via the ORM, never through `create_role`).

**Guard test:**
`TestTheService::test_create_role_also_refuses_system` in
`tests/test_position_kinds.py` — calls `create_role(..., kind="system")`
directly at the service layer (bypassing the Pydantic schema the way a
future internal caller would) and asserts it raises. Verified this test
fails against the pre-fix code (`DID NOT RAISE ValueError`) and passes
against the fix, per CLAUDE.md Pitfall #37.

### Completion gate (pass 14)

| Check                                                                                       | Result                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                             | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                    | ✅ clean, 2744 files unchanged                                      |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                 | ✅ clean                                                            |
| `python3 scripts/validate_migrations.py --strict`                                           | ✅ single head `f90b1124e6f4`, 678 revisions                        |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                           | ✅ 280 routes, 0 errors, 0 warnings                                 |
| scoped backend tests (`-k "permission or role or rank or officer or org_chart or passkey"`) | ✅ 1676 passed, 1 pre-existing skip (environment-only: `pywebpush`) |
| `cd frontend && npm run typecheck`                                                          | n/a — no frontend files touched this pass                           |
| `npm run lint` (frontend)                                                                   | n/a — no frontend files touched this pass                           |

1 finding fixed this pass (PERM-12, LOW). PERM-10 and PERM-11 remain
flagged (owner decision, Feature 01's test-pinned mechanism), re-verified
open and unchanged.

---

## Pass 13 (2026-10-28, watchdog pickup) — 0 fixed, 0 new findings; PERM-10/PERM-11 re-verified still open

Watchdog pickup: the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable — confirmed via
`ListAgents`, no reachable agents at all. Step 0 re-checked fresh against
GitHub (`search_pull_requests`, `is:pr is:open`): the only open
`claude/security-review-*` PR was #3802 (Feature 01, Auth & session
lifecycle, pass 13), already fully green (24/24 checks, `mergeable_state:
clean`, no unresolved review threads — the Codex bot's own comment was a
stale "usage limits" notice on an earlier commit, not a finding) and was
merged (squash, `4f21727a`). Rotation row 01 was the last `⬜` before this
one; row 02 (Permissions & roles) is the next `⬜` row, read directly off a
freshly-pulled `main`.

**Baseline:** `b16cfcca` (PR #3685's merge, pass 12). **Head:** current
`main` (`4f21727a`, PR #3802's merge). 323 commits between them.
`git diff --stat` against every one of the eleven files this feature
tracks (`dependencies.py`, `core/permissions.py`, `roles.py` +
`role_service.py`, `operational_ranks.py` + `operational_rank_service.py`,
`officers.py` + `officer_service.py`, `org_chart.py` +
`org_chart_service.py`, `admin_continuity_service.py`, and the
rank/role-assignment surface in `users.py`) is non-empty in three:
`dependencies.py` (+17/-4), `core/permissions.py` (+13), `users.py`
(+154/-10). `roles.py`, `role_service.py`, `operational_ranks.py`,
`operational_rank_service.py`, `officers.py`, `officer_service.py`,
`org_chart.py`, `org_chart_service.py`, and `admin_continuity_service.py`
are byte-identical to pass 12.

### Route inventory — re-enumerated by AST, not diffed

**28 routes, unchanged from pass 12** — re-walked with the same AST method
over all four endpoint files: `roles.py` (13), `operational_ranks.py` (7),
`officers.py` (3), `org_chart.py` (5). Since every one of those four files
(and their service-layer pairs) is byte-identical to pass 12, no gate,
permission string, or ceiling check in this set could have regressed —
confirmed by the empty diff, not merely assumed from the unchanged count.

### The three changed files, reviewed

- **`dependencies.py` / `core/permissions.py` — passkeys folded into the
  MFA-enrollment gate, and `require_stepup` split into a reusable
  `ensure_stepup(db, token)` helper.** Both are Feature 01's (Auth &
  session lifecycle) own new mechanism — a passkey now satisfies
  `get_current_user`'s "must enroll MFA" check the same way `mfa_enabled`
  does, and `require_stepup` is now a thin FastAPI-dependency wrapper
  around `ensure_stepup`, which four new conditional call sites in
  `auth.py` use directly (not through the dependency, since they only need
  step-up in some branches). Traced every caller of `ensure_stepup`:
  all four are in `auth.py` (`backend/app/api/v1/endpoints/auth.py:1815`,
  `:1899`, `:1957`, `:2027`), none in this feature's own files
  (`roles.py`, `operational_ranks.py`, `officers.py`, `org_chart.py`,
  `users.py`'s role/rank surface) — so this refactor does not touch, and
  does not close, PERM-10 or PERM-11 (below). `require_stepup` itself is
  unchanged in behavior (same `CodedHTTPException` on a stale/missing
  token), confirmed by reading the new body end-to-end rather than trusting
  the diff shape.
- **`core/permissions.py` — new `SENSITIVE_ANSWERS_VIEW`
  (`"sensitive_answers.view"`).** Forms' own new permission (gates revealing
  answers to form fields marked Sensitive, `forms.py:755,807,859`), added to
  this shared registry file rather than `forms.*` on purpose — the module
  wildcard matches by prefix before the first dot (confirmed by reading
  `permission_matches`, `core/permissions.py:1097`), so a `forms.*` grant
  (what the onboarding wizard's Forms "manage" checkbox writes) does **not**
  reach a `sensitive_answers.*` permission; the two module namespaces don't
  collide. Checked `DEFAULT_POSITIONS` (`core/permissions.py:1853` onward)
  directly for the string — not seeded to any of the eight rank-aliased
  positions, the `it_manager` global-wildcard position, or any of the other
  named positions; only the global `"*"` (System Owner) holds it out of the
  box, exactly as the code comment claims. Verified, not re-derived from the
  comment's own text.
- **`users.py` — two new passkey-admin routes, plus `admin_reset_mfa` now
  also clears passkeys, plus `create_member`/`update_contact_info` moved
  from a plaintext `User.email ==` lookup to `User.email_hash.in_(
email_fingerprints(...))`.** The email-hash change is an encryption/blind-
  index concern (cross-cutting, already reviewed under its own feature),
  not a permissions change — confirmed it still carries the existing
  `User.organization_id == current_user.organization_id` filter alongside
  the new hash lookup, so XC-3 org-scoping is preserved. The two new routes
  are this feature's own territory (admin mutation of another member's
  account) and were reviewed in full:
  - `GET /{user_id}/passkeys` (`admin_list_passkeys`, `users.py:2693`) —
    `require_permission("users.create", "members.manage")`, resolves the
    target through `_resolve_passkey_admin_target` which filters
    `User.id`, `User.organization_id == current_user.organization_id`, and
    `deleted_at.is_(None)` before any read (XC-3 satisfied). Read-only,
    returns only `name`/`created_at`/`last_used_at`/`backed_up` — no
    credential material. Correctly absent from `STEPUP_HANDLERS`
    (`backend/tests/test_mfa_policy.py`): a listing has no destructive
    effect, so step-up would be friction with no corresponding gain, unlike
    the delete route below.
  - `DELETE /{user_id}/passkeys/{passkey_id}` (`admin_remove_passkey`,
    `users.py:2722`) — same permission OR-gate, **does** carry
    `_stepup: User = Depends(require_stepup)` and calls
    `_enforce_account_reset_ceiling(current_user, user, db)` before the
    delete (same ceiling `admin_reset_password`/`admin_reset_mfa` already
    use) — both a fresh step-up and a ceiling check, matching the
    "account takeover path" shape `STEPUP_HANDLERS` groups it under.
    `passkey_service.get_passkey` is called with `passkey_id`, `user_id`,
    **and** `organization_id` all three (not just the primary key), so a
    passkey id from another org or another member cannot be targeted by
    guessing it (XC-1/XC-3 both satisfied at the lookup, not merely at the
    route's own permission gate). Self-targeting is explicitly refused
    (`str(user_id) == str(current_user.id)` → 400, "use your own Security
    settings"), which closes off the one path that would otherwise let an
    admin skip the ceiling check on their own account. Confirmed in
    `backend/tests/test_mfa_policy.py`'s pinned `STEPUP_HANDLERS` set
    (`("users.py", "admin_remove_passkey")` is present) and the file's own
    `_handlers_with_stepup() == STEPUP_HANDLERS` assertion, which fails if
    the decorator and the pinned set ever disagree — not just read as
    correct, machine-checked as correct.
  - `list_users_with_roles`'s new `has_passkey` field is computed only when
    `is_admin` and attached only to admin payloads (`users.py:1089`), the
    same gate the function's pre-existing contact-field redaction already
    uses — no new exposure path; a non-admin's own payload never carries
    the field key at all, not merely a `null` value.

### Re-verified, not re-derived

- **PERM-1 through PERM-9** — unaffected; every file they depend on is
  byte-identical to pass 12 (confirmed by the empty `git diff --stat`
  above). All remain fixed/closed.
- **PERM-10 (MED, FLAGGED) and PERM-11 (MED, FLAGGED)** — re-read against
  current `main` rather than trusted from pass 12's text.
  `update_user_profile`'s rank-assignment branch (`users.py:2029-2042`
  restricted-field check, ceiling call at `:2112`) and `create_member`
  (`users.py:323`, ceiling call at `:461`) still carry no `require_stepup`. `operational_ranks.py`'s `create_rank`/
  `update_rank`/`delete_rank` are byte-identical to pass 12 and so still
  carry none either. Neither finding was touched by this pass's
  `ensure_stepup` refactor (traced above: all four new call sites are in
  `auth.py`, none in these handlers). Both remain **OPEN / FLAGGED** —
  still an owner decision belonging to Feature 01's `STEPUP_HANDLERS`
  mechanism, unchanged in `docs/KNOWN_LIMITATIONS.md`.
- **OR-gate alternatives** — `positions.*`/`roles.*`/`members.manage`/
  `organization.update_settings`/`orgchart.manage` re-confirmed not seeded
  to `member` or `firefighter`; unchanged since pass 12 (no permission
  grant in this feature's own files changed this pass).

### Completion gate (pass 13)

| Check                                                                                       | Result                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                             | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                    | ✅ clean, no files reformatted                                      |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                 | ✅ clean                                                            |
| `python3 scripts/validate_migrations.py --strict`                                           | ✅ single head `0d9897752425`, 666 revisions                        |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                           | ✅ 279 routes, 0 errors, 0 warnings                                 |
| scoped backend tests (`-k "permission or role or rank or officer or org_chart or passkey"`) | ✅ 1631 passed, 1 pre-existing skip (environment-only: `pywebpush`) |
| `cd frontend && npm run typecheck`                                                          | ✅ 0 errors                                                         |
| `npm run lint` (frontend)                                                                   | ✅ 0 errors, 0 warnings                                             |

No source file needed a fix this pass — 0 fixed, 0 new findings. PERM-10
and PERM-11 remain flagged (owner decision, Feature 01's test-pinned
mechanism), re-verified open and unchanged.

---

## Pass 12 (2026-10-25, watchdog pickup) — 0 fixed, 2 new findings (PERM-10, PERM-11, both MED/flagged)

Watchdog pickup (step 0, re-verified immediately before branching):
`search_pull_requests` (`is:pr is:open head:claude/security-review-`) and
`list_pull_requests` (`state:open`) both returned 0 matching results — the 4
open PRs at the time (#3680, #3679, #3663, #3661) are unrelated feature/CI/docs
work. PR #3684 (Feature 01, Auth & session lifecycle, pass 12) had already
merged with no open rotation PR behind it. Rotation row 01 was already ✅;
row 02 (Permissions & roles) was confirmed the next `⬜` by reading the
rotation table directly off fresh `origin/main`.

**Baseline:** `4783dc35b` (PR #3557's merge, pass 11). **Head:** current
`main` (`d5f44cc4b`, PR #3684's merge). 383 commits between them. `git diff
--stat` against every one of the eleven files this feature tracks
(`dependencies.py`, `core/permissions.py`, `roles.py` + `role_service.py`,
`operational_ranks.py` + `operational_rank_service.py`, `officers.py` +
`officer_service.py`, `org_chart.py` + `org_chart_service.py`,
`admin_continuity_service.py`, and the rank/role-assignment surface in
`users.py`) is non-empty in five: `dependencies.py` (+114/-4),
`core/permissions.py` (+26), `roles.py` (+5), `operational_ranks.py` (+10/-1),
`operational_rank_service.py` (+22/-1), and `users.py` (+8). `role_service.py`,
`officers.py`, `officer_service.py`, `org_chart.py`, `org_chart_service.py`,
and `admin_continuity_service.py` are byte-identical to pass 11.

### Route inventory — re-enumerated by AST, not diffed

**28 routes, unchanged from pass 11** — enumerated with a Python AST walk over
every `@router.*` decorator and the full `Depends(...)` default list on the
function immediately below it, across all four endpoint files: `roles.py`
(13), `operational_ranks.py` (7), `officers.py` (3), `org_chart.py` (5). No
route gained or lost a permission string or an auth dependency; every gate
matches pass 11's table exactly (OR-gate `positions.*`/`roles.*` on
`roles.py`'s four mutating routes, `settings.manage`/`members.manage` on
`operational_ranks.py`'s mutating routes plus the independent
`settings.manage`-only `_refuse_ordering` gate on `sort_order`/`/reorder`,
`settings.manage`/`organization.update_settings` on `officers.py`,
`orgchart.manage`/`settings.manage` on `org_chart.py`'s four mutations and
auth-only `GET ""`). The only change at the route layer is additive and
orthogonal to permissions: `roles.py`'s four mutating routes
(`create_role`/`update_role`/`delete_role`/`clone_role`) each gained
`_stepup: User = Depends(require_stepup)` as the **last** parameter default —
confirmed to follow (not precede) the existing permission dependency in every
case, which matters because FastAPI resolves dependencies in signature order:
a caller lacking the permission is told that, not asked to re-verify first.

### The five changed files, reviewed

- **`dependencies.py` / `core/permissions.py` — the MFA-grace, kiosk-session,
  and `require_stepup` machinery.** This is Feature 01's (Auth & session
  lifecycle) own new mechanism, reviewed end-to-end from its own three files
  in `AUTH-01-auth-session.md`'s pass-12 section (dimensions 1-4 confirmed
  there, including `test_mfa_policy.py`'s AST-pinned `STEPUP_HANDLERS` set and
  the self-session-only scoping of the step-up stamp). Not re-derived here.
  `core/permissions.py`'s other diff, `SECURITY_KIOSK_SESSION`, is also
  Feature 01's permission to seed-check (confirmed there: seeded to no
  position). What **is** this feature's own question — whether the new
  step-up gate was applied completely and consistently across the
  grant-ceiling surface this feature owns — is PERM-10 and PERM-11 below.
- **`core/permissions.py` — `is_built_in_rank_code(rank_code)`.** A new, pure,
  read-only predicate (`rank_code in OPERATIONAL_RANKS`, no DB access, no
  permission-string change). Traced every caller: `assert_rank_code_may_change`
  (below) and `RankResponse.is_built_in` (a computed field, not a stored
  column — no migration needed, no schema finding). Nothing writes through
  it and no endpoint branches its authorization on it.
- **`roles.py` — `require_stepup` added to `create_role`/`update_role`/
  `delete_role`/`clone_role`.** Correct composition with this feature's own
  grant-ceiling guards: `_enforce_permission_grant_ceiling` /
  `_enforce_role_edit_ceiling` still run (unchanged) inside the handler body,
  so a caller now needs **both** the ceiling (cannot grant/edit above their
  own permissions) **and** a fresh step-up — strictly additive, no gap opened.
- **`operational_ranks.py` / `operational_rank_service.py` — a built-in rank's
  code can no longer be changed (commit `bdec1a878`, "Lock the code of
  built-in ranks," 2026-10-23, already shipped with its own tests and
  reviewed as ordinary feature work; re-verified here as this feature's own
  file).** `get_rank_default_permissions` resolves a rank's permissions by
  **code** against the static `OPERATIONAL_RANKS` registry, so renaming e.g.
  `captain` away from that code previously stripped its default permissions
  from everyone who held it, silently — a correctness/data-loss bug, not
  previously flagged as a security finding, now closed. `assert_rank_code_may_
change` (`operational_rank_service.py`) raises before any write once
  `is_built_in_rank_code(old_code)` is true, regardless of the caller's
  permissions ("refused for everyone," confirmed by reading: the function
  takes no permission/user argument at all). Wired at **both** layers —
  `operational_ranks.py:257-260` (API handler, ahead of the existing
  `_enforce_rank_grant_ceiling` ceiling check: "a built-in code is refused for
  everyone, and saying so beats a 403 that implies more authority would do")
  and `operational_rank_service.py:359` (service layer, defense in depth for
  any other caller of `update_rank`). A custom (non-built-in) rank's code
  still moves freely, with `_move_rank_references` still cascading the rename
  to `User.rank`/`OrgChartNode.rank_code`/`TrainingRequirement.required_roles`/
  `InventoryImpactPlan.filters["ranks"]` exactly as pass 11 described — this
  guard narrows **when** a rename may run, it does not change what a rename
  does. `RankCreate`/`RankUpdate` carry no `default_permissions` field (only
  `rank_code`/`display_name`/`description`/`sort_order`/`is_active`/
  `eligible_positions` — confirmed by reading `schemas/operational_rank.py`),
  so a rank's permissions are never directly settable; the only way `create_
rank`/`update_rank` can grant permissions is by choosing or renaming to a
  **built-in** code, which `_enforce_rank_grant_ceiling` already ceiling-checks
  on both paths. No new finding from this file's own change — it closes a gap,
  it does not open one.
- **`users.py` — `require_stepup` added to `assign_user_roles`/`add_role_to_
user`/`remove_role_from_user` (role-assignment handlers this feature tracks)
  plus `delete_user`/`admin_reset_password`/`admin_reset_mfa`/`anonymize_member`
  (Feature 01's/the users-feature's own territory, not re-reviewed here beyond
  confirming the diff is additive-only and does not touch this feature's
  rank/role-assignment logic otherwise).** The three role-assignment handlers
  are exactly parallel to `roles.py`'s mutating routes: ceiling-checked
  (`_enforce_role_grant_ceiling`, unchanged) **and** now step-up-gated. See
  PERM-10 for the asymmetry this surfaced.

### Re-verified, not re-derived

- **PERM-1 through PERM-9** — re-checked by direct read rather than trusted
  from this doc's own prior text: `operational_ranks.py:170`'s `/validate`
  still gated `settings.manage`/`members.manage`;
  `admin_continuity_service.py`'s last-administrator guard is present and
  byte-identical to pass 11 (confirmed by the empty diff above, not merely
  assumed). All remain fixed/closed; none reopened.
- **OR-gate alternatives** — `positions.*`/`roles.*`/`members.manage`/
  `organization.update_settings`/`orgchart.manage` re-confirmed not seeded to
  `member` or `firefighter` across `DEFAULT_POSITIONS`; unchanged since pass
  11 because no permission grant changed this pass (`SECURITY_KIOSK_SESSION`
  is new but is Feature 01's own permission, seeded nowhere, as noted above).

### PERM-10 — MED — The new step-up gate covers role-granting handlers but not the structurally equivalent rank-granting ones in the same file — FLAGGED (not fixed)

**What:** `users.py` gained `require_stepup` on `assign_user_roles`,
`add_role_to_user`, and `remove_role_from_user` (`users.py:1319`, `:1464`,
`:1573`) — all three already ceiling-checked by `_enforce_role_grant_ceiling`.
Two structurally identical, ceiling-checked grant paths in the **same file**
did not gain it:

- **`update_user_profile`'s rank-assignment branch** (`users.py:2011-2039`,
  ceiling call at `:2094`). Changing another member's `rank` is restricted to
  `members.manage` holders (`restricted_fields` includes `"rank"`,
  `users.py:2013`) and is bound by the identical `_enforce_rank_grant_ceiling`
  mechanism `ORU-7d`/`PERM-4` established as this feature's answer to "a rank
  change must not grant more than the caller's own permissions." It is exactly
  as sensitive as `assign_user_roles` (same ceiling guarantee, same
  `members.manage` gate, same "mutates someone else's effective permission
  set" shape) but has no step-up requirement.
- **`create_member`** (`users.py:319`, `POST /users`, gated `users.create`
  only). Sets a client-chosen initial password (`AdminUserCreate.password`)
  **and** a ceiling-checked rank (`_enforce_rank_grant_ceiling` at `:457`)
  **and** ceiling-checked `role_ids` (the `ORU-1` fix) in one call, with no
  step-up at all — despite combining the exact shape of `admin_reset_password`
  (sets a credential) with the exact shape of `assign_user_roles` (grants
  roles up to the ceiling), both of which are now step-up-gated on their own.

**Where:** `backend/app/api/v1/endpoints/users.py:319` (`create_member`),
`:1914` (`update_user_profile`, restricted-field check `:2011-2039`, ceiling
call `:2094`).

**Failure scenario:** an attacker who has obtained a member's **live session**
holding `members.manage` (AUTH-23's own precondition — cookie theft, an
unattended device, a session-fixation bug) cannot change that member's own
rank or role without a fresh step-up challenge via `PATCH /users/{id}/roles`-
family endpoints, but **can** reach the identical outcome — entrenching a
rank/role grant up to their own ceiling on an account, without ever
re-verifying — by instead calling `PATCH /users/{id}/profile` with a `rank`
field, or by calling `POST /users` to mint a brand-new account at a
caller-chosen password and a ceiling-bound rank/role set. Neither route asks
the attacker to prove they are still the legitimate session holder, which is
precisely the property `require_stepup` exists to add to this class of action.
`create_member` is the more serious of the two: it lets the attacker establish
a **persistent, attacker-known credential** rather than touching an existing
member's account at all, which is the more natural way to entrench access
from a stolen session and sidesteps `admin_reset_password`'s own step-up gate
entirely.

**Impact:** the ceiling still bounds the grant to the attacker's own
effective permissions (this is not privilege escalation beyond the stolen
session's own level), but it is a gap in the step-up control's stated purpose
— re-verifying identity before the most sensitive member-management actions —
on two paths that are functionally indistinguishable from three paths the
same commit just gated.

**Why flagged, not fixed:** `STEPUP_HANDLERS` (`backend/tests/
test_mfa_policy.py`) is Feature 01's own pinned, AST-checked set — adding a
handler to it is a deliberate, reviewed behavior change (every caller of that
handler now faces a re-verification prompt), not a mechanical fix, and `create_
member`/`update_user_profile` mix sensitive branches with routine, high-
frequency ones (ordinary self-service profile edits; routine member
onboarding) that a blanket `require_stepup` on the whole handler would also
gate — exactly the kind of UX-tradeoff decision CLAUDE.md's Pitfall #37 and
this skill's own instructions reserve for the owner, not for a mechanical
fix inside this review. The narrower options (split the rank-change branch of
`update_user_profile` into its own gated helper; gate `create_member` only
when a `rank`/`role_ids`/`password` field is actually supplied) are both
plausible but are a design choice belonging to Feature 01, which owns the
step-up mechanism and its test.

**Fix:** not applied. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Severity reasoning:** MED — same precondition and reasoning as `AUTH-23`
(a stolen live session of a privileged account is already a serious
compromise), scored the same because it is the same control gap applied to
a different, equally sensitive pair of call sites rather than a distinct
vulnerability class.

### PERM-11 — MED — Rank CRUD has no step-up gate, unlike the structurally parallel role CRUD it sits beside — FLAGGED (not fixed)

**What:** `roles.py`'s four mutating routes (`create_role`, `update_role`,
`delete_role`, `clone_role`) all gained `require_stepup` this pass.
`operational_ranks.py`'s three mutating routes that play the same role for
ranks — `create_rank` (`:117`), `update_rank` (`:211`), `delete_rank`
(`:284`) — did not. Both pairs are `settings.manage`/`members.manage`-gated
(roles: an OR-gate over `positions.*`/`roles.*`; ranks: `settings.manage`,
`members.manage`), both are ceiling-checked before the grant-bearing part of
the write (`_enforce_permission_grant_ceiling`/`_enforce_role_edit_ceiling`
for roles; `_enforce_rank_grant_ceiling` for ranks, as of this pass also
guarded by `assert_rank_code_may_change`), and `update_rank`'s own code
comment draws the same comparison unprompted: "the same escalation
settings.manage alone must not authorize... CLAUDE.md pitfall 23's aliasing
note is the same failure mode: a rank's grants reach the database by a side
door" (`operational_rank_service.py`, around the `update_rank` ceiling call).
`reorder_ranks` is correctly excluded from this comparison — it never touches
`_enforce_rank_grant_ceiling` and grants nothing; only the ladder's `sort_order`
moves, which is an inventory-visibility concern already handled by a dedicated
`settings.manage`-only gate (`_refuse_ordering`), not a permission grant.

**Where:** `backend/app/api/v1/endpoints/operational_ranks.py:117`
(`create_rank`), `:211` (`update_rank`), `:284` (`delete_rank`).

**Failure scenario:** the same stolen-live-session precondition as PERM-10 and
`AUTH-23`. An attacker holding a `settings.manage`/`members.manage` session
can rename a custom rank's code to a built-in one (still ceiling-checked,
still bounded to their own permissions, but a standing, hard-to-notice change
to every member who currently or later holds that rank) or delete/recreate
ranks, without the re-verification step `delete_role`/`update_role` now
require for the equivalent operation on roles.

**Impact:** same shape and bound as PERM-10 — ceiling-limited, not an
escalation beyond the attacker's own level, but an inconsistency in a control
whose entire purpose is raising the bar on exactly this class of action.

**Why flagged, not fixed:** identical reasoning to PERM-10 — expanding
`STEPUP_HANDLERS` is Feature 01's reviewed, test-pinned decision, and doing so
here would need that feature's own test file touched and its own judgment
call about where the UX cost of re-verification is worth paying. Unlike
`update_user_profile`/`create_member`, these three handlers _are_ narrow
enough that gating the whole handler would be a clean, low-collateral change
(no routine/self-service traffic through them) — which is why this is flagged
as the more actionable of the two findings, for whichever feature's next pass
picks it up.

**Fix:** not applied. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Severity reasoning:** MED, same reasoning as PERM-10.

### Completion gate (pass 12)

| Check                                                                            | Result                                                    |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                  | ✅ 0 violations                                           |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                         | ✅ 2637 files unchanged                                   |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                      | ✅ clean                                                  |
| `python3 scripts/validate_migrations.py --strict`                                | ✅ single head `3d67883cd461`, 651 revisions              |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                | ✅ 276 routes, 0 errors, 0 warnings                       |
| scoped backend tests (`-k "permission or role or rank or officer or org_chart"`) | ✅ 1512 passed, 1 skipped (environment-only: `pywebpush`) |
| `cd frontend && npm run typecheck`                                               | ✅ 0 errors                                               |
| `npm run lint` (frontend)                                                        | ✅ 0 errors, 0 warnings                                   |

No source file needed a fix this pass. Both findings are flagged (owner
decision / another feature's test-pinned mechanism), not fixed, and mirrored
into `docs/KNOWN_LIMITATIONS.md`.

---

## Pass 11 (2026-10-22, watchdog pickup) — 0 fixed, 0 new findings

Watchdog pickup: Step 0 confirmed via `search_pull_requests`
(`is:pr is:open head:claude/security-review-`) that no security-review PR
was open, and `ListAgents` found no other reachable session. PR #3556
(Feature 01, Auth & session lifecycle, pass 11) had just merged — not
docs-only (it carried a real `auth_service.py`/`dependencies.py` fix plus a
`consent_service.py` Pitfall #32 fix), so it has its own Log entry in
`AUTH-01-auth-session.md`; nothing further to record from it here beyond
clearing the **Open PR** row. Row 02 (Permissions & roles) was confirmed the
next `⬜` by reading the rotation table directly off fresh `origin/main`.

**Baseline:** `4838c5b2` (PR #3398's merge, pass 10). **Head:** current
`main` (`96b0c924`, PR #3556's merge). 604 commits between them. Of the
twelve files this feature tracks (`dependencies.py`, `core/permissions.py`,
`roles.py` + `role_service.py`, `operational_ranks.py` +
`operational_rank_service.py`, `officers.py` + `officer_service.py`,
`org_chart.py` + `org_chart_service.py`, `admin_continuity_service.py`, and
the rank/role-assignment handlers in `users.py`), confirmed individually by
`git diff --stat` against every tracked path (not assumed from a commit-log
skim): seven carry a real diff — `dependencies.py`, `core/permissions.py`,
`role_service.py`, `operational_ranks.py`, `operational_rank_service.py`,
`org_chart_service.py`, and `admin_continuity_service.py`. `users.py` also
has a large diff (+287/-24), but every hunk falls inside `create_member`,
`_enforce_account_reset_ceiling`, `update_user_profile`, `delete_user`, and
`get_deletion_impact` — all new directory-account-provisioning logic
(Google Workspace/Microsoft 365 account creation, department email,
inventory return on deletion). None of it touches this file's
rank/role-assignment handlers (`get_user_roles`, `assign_user_roles`,
`add_role_to_user`, `remove_role_from_user`, `get_user_with_roles`, lines
1041-1670), which carry zero diff and are confirmed byte-identical to pass 10. The directory-account feature is Feature 07's (Users & organizations)
territory by principal-code assignment and is left for that feature's own
pass, consistent with prior passes' practice of noting a caller's dependency
on another feature's file without reviewing that file's own logic here
(see pass 9's `release_position_from_folders` note). `roles.py`,
`officers.py`, and `org_chart.py` are byte-identical to pass 10.

### The seven changed files, reviewed

- **`dependencies.py`** wires `touch_activity=request.headers.get(
"x-background-request") != "1"` into `get_current_user`'s call to
  `auth_service.get_user_from_token` — the server half of
  `BACKGROUND_REQUEST_CONFIG`. Already audited end-to-end by this same
  rotation's Feature 00 (Cross-cutting baseline, pass 11), Feature 34
  (Frontend shared, pass 10), and Feature 01's own pass-11 review of this
  exact call site (PR #3556). Re-confirmed here only because `dependencies.py`
  is also tracked by this feature: the change is confined to the token/session
  path and touches no permission or role logic, so there is nothing
  feature-02-specific to add.
- **`core/permissions.py`** adds `RANK_MIRRORING_POSITION_SLUGS` (a frozenset
  mirroring `OPERATIONAL_RANKS`' keys) and `position_mirrors_rank(slug,
is_system)` — a pure, read-only predicate with no database access and no
  permission-string change. Consumed by `Position.mirrors_rank`
  (`models/user.py:874-882`), which is only ever read (surfaced in
  `RoleManagementService.list_roles`'s payload and the frontend's
  `mirrorsRank()` helper, which filters these positions out of assignment
  pickers so a volunteer isn't shown a position that duplicates their Rank
  field). Traced the whole path: nothing writes through this property, no
  endpoint branches its authorization on it, and it carries no seeded grant
  of its own — CLAUDE.md Pitfall #23 (a seeded rank grant reaching the
  database through a position) does not apply here because this change adds
  no grant; it only labels positions that already mirror a rank's existing
  grant, which is why no migration accompanies it. Verified no new route and
  no new permission string anywhere in the diff.
- **`role_service.py` — two independent new guards on `delete_role`, both
  read before any write:**
  - `assert_position_not_sole_box_reviewer` (`suggestion_service.py:207-247`)
    refuses the delete if the position is the sole reviewer of an open
    suggestion box. Org-scoped (`SuggestionBox.organization_id ==
str(organization_id)`), and the query is `.with_for_update()` — locked so
    a concurrent edit to a box's reviewer list cannot slip between this check
    and the delete (the same Pitfall #27 shape as a capacity check).
  - `release_role_from_messages` (`messaging_service.py:96-134`) strips the
    role's id and name out of every `DepartmentMessage.target_roles` list in
    the org before the role is deleted, so a later edit to the message does
    not try to re-send to an id that resolves to nobody. Org-scoped
    (`DepartmentMessage.organization_id == str(organization_id)`), rows
    `.with_for_update()`-locked, and the column is replaced with a new list
    (`kept = [...]`) rather than mutated in place — Pitfall #12 compliant, and
    the code comment says so directly.
  - Both guards run, and `release_role_from_messages`'s count is folded into
    the existing audit payload (`removed_from_message_audiences`), before
    the role row is deleted — consistent with the function's existing
    `release_position_from_folders` guard from pass 9.
- **`operational_ranks.py`** — `update_rank`'s call site now passes
  `actor_id`, `actor_username`, and `ip_address` (via the existing
  `get_client_ip` helper) through to the service so the new rename-audit
  event (below) can be attributed. No permission-gate change; the route's
  existing `require_permission("settings.manage", "members.manage")` OR-gate
  is untouched.
- **`operational_rank_service.py` — a rank-code rename now propagates to
  every store that references the code, in the same transaction:**
  - `get_rank(..., for_update=True)` locks the rank row before a rename, so
    two concurrent renames (or a rename racing a delete) cannot both decide
    from the same pre-rename snapshot.
  - `_move_rank_references` updates `User.rank` and `OrgChartNode.rank_code`
    (plain `UPDATE ... WHERE organization_id == organization_id AND
<column> == old_code`, both org-scoped) and rewrites the JSON-list
    membership of `TrainingRequirement.required_roles` and
    `InventoryImpactPlan.filters["ranks"]` wherever `old_code` appears,
    org-scoped on both (`TrainingRequirement.organization_id ==
organization_id`, `InventoryImpactPlan.organization_id ==
organization_id`), both rows locked with `.with_for_update()` before the
    rewrite. The `TrainingRequirement` list is reassigned with
    `flag_modified()`; the `InventoryImpactPlan.filters` dict is
    `copy.deepcopy()`'d before the nested `"ranks"` key is replaced and
    `flag_modified()` is called — both the correct Pitfall #12 patterns for a
    top-level reassign vs. a nested-key edit, and both are exercised by
    `_renamed_code_list`'s own dedup/order-preserving logic (verified by
    reading it: returns `None`, meaning "no match, skip" when `old_code`
    is absent, so an unrelated requirement/plan is never touched or
    unnecessarily flagged modified).
  - The rename is now `log_audit_event`'d (`operational_rank.code_renamed`,
    severity `warning`, carrying the old/new codes and a per-store count of
    rows moved) — previously a silent `UPDATE` with no audit trail at all.
  - `delete_rank` gained a parallel guard: an orphan check against
    `OrgChartNode.rank_code`, org-scoped, naming the blocking seats in the
    error, mirroring the existing member-count guard immediately above it.
  - Confirmed deliberately unmoved: `training_records.rank_at_completion`
    (a historical snapshot), audit rows, and onboarding's IT-contact-list
    copies — the docstring states this and it matches the stated invariant
    (history must not be rewritten by a later rename).
- **`org_chart_service.py` and `admin_continuity_service.py`** — both are the
  CLAUDE.md Pitfall #32 fix (`User.status == UserStatus.ACTIVE` →
  `User.status.in_(ACTIVE_ACCOUNT_STATUSES)`), applied to `is_administrator`,
  `_active_members_locked`, and three membership-lookup queries in
  `org_chart_service.py` (seat-holder lookup, rank-based lookup, and the
  org's full active-member query). All four already-existing org scoping
  filters (`User.organization_id == organization_id`) are untouched by the
  diff — confirmed by reading each hunk, not inferred from the import change
  alone. This closes the same class of bug Pitfall #32 names: a probationary
  member was previously invisible to "who can administer this org" and to
  org-chart seat/rank-based holder lookups, which is a correctness fix in
  the safer direction (more members counted as current, not fewer), not a
  new permission or a widened grant.

### Re-verified, not re-derived

- **Route inventory** — re-enumerated directly against the four endpoint
  files: `roles.py` (13), `operational_ranks.py` (7), `officers.py` (3),
  `org_chart.py` (5) — 28 routes total, unchanged from pass 10, and all four
  files are byte-identical to pass 10 (`git diff --stat` zero lines each).
  Same gates as pass 10: OR-gate `settings.manage`/`members.manage` on
  `operational_ranks.py`'s four mutating routes plus the independent
  `settings.manage`-only `_refuse_ordering` gate on `sort_order`/`/reorder`;
  `officers.py` on `settings.manage`/`organization.update_settings`;
  `org_chart.py`'s `GET ""` auth-only by design, its four mutations on
  `orgchart.manage`/`settings.manage`.
- **OR-gate alternatives** — `members.manage` and
  `organization.update_settings` re-confirmed not seeded to `member` or
  `firefighter` across all `DEFAULT_POSITIONS` entries; unchanged since pass
  10 because `core/permissions.py`'s only diff this pass is the new,
  grant-free `position_mirrors_rank` helper.
- **PERM-1, PERM-2 (fixed), PERM-5 and PERM-9 (both closed)** — re-checked by
  direct read rather than trusted from this doc's own prior text:
  `operational_ranks.py:170` (`/validate` still gated
  `settings.manage`/`members.manage`), `admin_continuity_service.py`'s "LAST
  WILDCARD HOLDER" guard (module docstring + `ADMIN_PERMISSION =
"members.manage"` + `is_administrator`) is present and, per the point
  above, now evaluates current status more broadly rather than being
  weakened. This file's own "Route inventory" static section (corrected at
  pass 9) still matches current code.

No finding this pass. Rotation row 02 moves to `✅`.

### Completion gate (pass 11)

| Check                                                                            | Result                                                    |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                  | ✅ 0 violations                                           |
| `black --check app/ tests/ alembic/` (26.5.1, CI's pin)                          | ✅ 2555 files unchanged                                   |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                      | ✅ clean                                                  |
| `python3 scripts/validate_migrations.py --strict`                                | ✅ single head `e5f9bb066e07`, 639 revisions              |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                | ✅ 273 routes, 0 errors, 0 warnings                       |
| standing guard suite (8 files, incl. `test_rank_mirroring_positions.py`)         | ✅ 198 passed                                             |
| scoped backend tests (`-k "permission or role or rank or officer or org_chart"`) | ✅ 1466 passed, 1 skipped (environment-only: `pywebpush`) |
| `cd frontend && npm run typecheck`                                               | ✅ 0 errors                                               |
| `npm run lint` (whole repo, backend + frontend)                                  | ✅ 0 errors, 0 warnings                                   |

No source file needed a fix this pass.

---

## Pass 10 (2026-10-18, watchdog pickup) — 0 fixed, 0 new findings

Watchdog pickup: Step 0 confirmed via `search_pull_requests` that no
`claude/security-review-*` PR was open anywhere on the repo, and the
dedicated `/loop 30m /security-review` session was not reachable via
`ListAgents`. The prior iteration (Feature 01, Auth & session lifecycle,
pass 10, PR #3397) merged clean. Rotation row 02 was the next `⬜`.

**Baseline:** `eee8be13` (PR #3212's merge, pass 9). **Head:** current
`main` (`ccb4b805`, PR #3397's merge). 620 commits (320 non-merge) between
them. Of the twelve files this feature tracks (`dependencies.py`,
`core/permissions.py`, `roles.py` + `role_service.py`,
`operational_ranks.py` + `operational_rank_service.py`, `officers.py` +
`officer_service.py`, `org_chart.py` + `org_chart_service.py`,
`admin_continuity_service.py`, and the rank/role-assignment handlers in
`users.py`), confirmed by `git diff --stat` against every tracked path
individually (not assumed from a commit-log skim) — only two carry any
diff at all: `role_service.py` (+2/-2) and `operational_rank_service.py`
(+9/-7). The other ten are byte-identical to pass 9's baseline.

### The two changed files, reviewed

Both diffs are from the same class of change: mypy-driven null-safety
hardening, not new logic.

- **`role_service.py`:**
  - `changes = {}` gained an explicit `Dict[str, Dict[str, Any]]`
    annotation — no behavior change.
  - `clone_role`'s `priority=source.priority` became
    `priority=source.priority or 0`. `Role.priority` is
    `Mapped[Optional[int]]` ("Higher priority = more powerful",
    `app/models/user.py:764`) — a cloned role whose source had a `None`
    priority now gets `0` instead of propagating `None`. `0` is the
    **lowest** end of this scale, so this cannot escalate a cloned role's
    effective priority; it only prevents a `None` from reaching whatever
    numeric comparison/ordering consumes `priority` downstream. Verified
    safe, not a finding.
- **`operational_rank_service.py`:**
  - `seed_defaults`'s existing-row guard changed `result.scalar() > 0` to
    `(result.scalar() or 0) > 0` — defends the same `COUNT(*)` check
    against a `None` scalar the same way pass 9 found in `role_service.py`'s
    sibling `remove_role_from_user` (`rows_affected()`) and Feature 01 pass
    9 found in `auth_service.py`. Same narrowing-not-widening direction:
    a `None` now reads as "0 existing rows" (seed proceeds) rather than
    raising `TypeError` — not a path that can be reached with a non-empty
    table, since `COUNT(*)` only returns `None` if the query itself errors
    before returning a row, which SQLAlchemy would surface as an exception
    rather than a bare `None` in practice; the hardening is defensive, not
    closing a live hole.
  - `validate_ranks`' member-lookup loop renamed its loop variable `row` to
    `member_row` throughout (five reference sites) — pure rename, confirmed
    by reading all five call sites; the logic (compare each member's stored
    `rank` string against the canonical code map, flag mismatches) is
    unchanged.

Neither file's permission gate, org-scoping, or audit-logging surface is
touched. No new route, no permission-string change, no migration.

### Re-verified, not re-derived

- **Route inventory** — re-enumerated directly against the four endpoint
  files (`roles.py`, `operational_ranks.py`, `officers.py`,
  `org_chart.py`), all four confirmed byte-identical to pass 9 via
  `git diff --stat` (zero lines). Same 28 routes, same gates as pass 9:
  `roles.py` (13), `operational_ranks.py` (7, OR-gate
  `settings.manage`/`members.manage` on the four mutating routes, the
  independent `settings.manage`-only `_refuse_ordering` gate on
  `sort_order`/`/reorder`), `officers.py` (3, `settings.manage`/
  `organization.update_settings`), `org_chart.py` (5, `GET ""` auth-only by
  design, four mutations on `orgchart.manage`/`settings.manage`).
- **OR-gate alternatives** — `members.manage` and
  `organization.update_settings` re-confirmed not seeded to `member` or
  `firefighter` across all `DEFAULT_POSITIONS` entries; unchanged since
  pass 9 because `core/permissions.py` carries zero diff since baseline.
- **PERM-1, PERM-2 (fixed), PERM-5 and PERM-9 (both closed)** all
  byte-identical to their pass-9 state (`operational_ranks.py`,
  `admin_continuity_service.py`, and this file's own "Route inventory"
  section all carry zero diff since `eee8be13`).

No finding this pass. Rotation row 02 moves to `✅`.

### Completion gate (pass 10)

| Check                                                                            | Result                                                                             |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                  | ✅ 0 violations                                                                    |
| `black --check app/ tests/ alembic/` (26.5.1, CI's pin)                          | ✅ 2426 files unchanged                                                            |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                      | ✅ clean                                                                           |
| `python3 scripts/validate_migrations.py --strict`                                | ✅ single head `1117b642643b`, 618 revisions                                       |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                | ✅ 270 routes, 0 errors, 0 warnings                                                |
| standing guard suite (12 files, run directly)                                    | ✅ 224 passed                                                                      |
| scoped backend tests (`-k "permission or role or rank or officer or org_chart"`) | ✅ 1379 passed, 1 skipped (environment-only: `py_vapid`/`pywebpush` not installed) |
| `cd frontend && npm run typecheck`                                               | ✅ 0 errors                                                                        |
| `cd frontend && npm run lint`                                                    | ✅ 0 errors, 0 warnings (no frontend files touched this pass)                      |

No source file needed a fix this pass.

---

## Pass 9 (2026-10-14, watchdog pickup) — 0 fixed in source, 1 doc correction, 0 new findings

Watchdog pickup: Step 0 confirmed via `list_pull_requests` (not trusted from
`PROGRESS.md`'s own row) that no `claude/security-review-*` PR was open
anywhere on the repo. The last security-review merge was PR #3210 (Feature
01, Auth & session lifecycle, pass 9) — docs-only, nothing further to record
from it beyond clearing the **Open PR** row. Rotation row 02 was the next `⬜`.

**Baseline:** `d9a3357c` (PR #3097's merge, pass 8). **Head:** current `main`
(`d5711ecc`). 370 commits between them. Of the twelve files this feature
tracks (`dependencies.py`, `core/permissions.py`, `roles.py` +
`role_service.py`, `operational_ranks.py` + `operational_rank_service.py`,
`officers.py` + `officer_service.py`, `org_chart.py` +
`org_chart_service.py`, `admin_continuity_service.py`, and the
rank/role-assignment handlers in `users.py`), only two carry a real diff —
`core/permissions.py` (+5) and `role_service.py` (+14/-2) — confirmed by
`git diff --stat` against every tracked file, not assumed from a commit log
skim.

### The two changed files, reviewed

- **`core/permissions.py` — one new seeded grant, `locations.create` added to
  the `quartermaster` position** (not `ems_supply_officer`, which sits
  immediately after it in the file and could be misread as the target from
  the diff context alone — confirmed by reading the surrounding block
  directly, `core/permissions.py:2186-2225`). **Pitfall #23 compliant**:
  backed by `20261011_2305_9e8b0b6f3fe8_grant_quartermaster_locations_create.py`,
  which the registry's own comment names. Read the migration in full: guarded
  on the `positions` table existing (Pitfall #26, though the table is never
  absent — `positions` predates the migration chain), scoped to
  `slug = "quartermaster" AND is_system = True`, gated on evidence
  (`inventory.manage` present, `locations.create`/`locations.manage`/
  `locations.*`/`*` all absent) rather than a whole-row snapshot comparison,
  idempotent, and its downgrade only removes a grant it can prove it added
  (same logic, mirrored). Registry and migration target the same slug and the
  same permission string — no drift. This is the owner's W38-1 decision
  (quartermaster can create rooms for the inventory setup wizard, not edit or
  delete them), already fully reasoned through in the migration's own
  docstring; nothing to add here beyond confirming the two sides agree.
  `locations.create` remains seeded only to officer/chief-tier positions
  (grep-confirmed across all 35 `DEFAULT_POSITIONS` entries) — never to
  `member` or any rank-and-file position, so this is not a department-wide
  widening.
- **`role_service.py` — two independent, unrelated changes, both benign:**
  - `delete_role` now calls `documents_service.release_position_from_folders`
    before deleting, refusing the delete (`ValueError` → 400 via
    `handle_service_errors`) if the position is the _sole_ opener of an
    organization-visibility document folder, naming the folders. Read
    `release_position_from_folders` in full
    (`documents_service.py:212-259`): org-scoped query, `.with_for_update()`
    locks the candidate folders before the check (Pitfall #27 shape — closes
    a race between a concurrent folder edit and this delete), and the
    surviving folders' `allowed_roles` lists are rebuilt as new lists rather
    than mutated in place before reassignment (Pitfall #12 compliant). This
    function lives in Feature 10's (Documents & legal) file, not this
    feature's — reviewed here only because this feature's `role_service.py`
    is the caller, and the call site passes nothing unscoped (organization id
    and position id both come from the already-org-resolved `role`/
    `current_user`).
  - The `remove_role_from_user` assignment-count check replaced a raw
    `result.rowcount == 0` with `rows_affected(result) == 0`
    (`app/utils/sql_results.py`) — the same AUTH-21-pattern hardening Feature
    01's pass 9 found in `auth_service.py`: it raises on an unexpected result
    type instead of silently reading it as `0`, narrowing a privilege-removal
    audit path's failure mode in the safer direction. Same comparison, same
    control flow otherwise.

### Re-verified, not re-derived

- **PERM-1, PERM-2 (fixed) and PERM-5 (closed by other work, pass 8)** all
  confirmed still in place: `operational_ranks.py:170` (`/validate` requires
  `require_permission("settings.manage", "members.manage")`,
  `operational_rank_service.py`'s savepoint-scoped `seed_defaults` rollback
  (`async with self.db.begin_nested()`), and
  `admin_continuity_service.py`'s "LAST WILDCARD HOLDER" guard — all
  byte-identical to pass 8 (zero commits to `admin_continuity_service.py`
  since `d9a3357c`, confirmed by `git log`).
- **Route inventory re-enumerated directly against the four endpoint files**
  (not trusted from this doc's own, now-corrected, legacy "Route inventory"
  section below): 28 routes, same four routers, same gates as pass 7/8 —
  `roles.py` (13), `operational_ranks.py` (7, OR-gate confirmed per-route by
  direct read: `create_rank`/`update_rank`/`delete_rank`/`validate_ranks` all
  `require_permission("settings.manage", "members.manage")`;
  `reorder_ranks` additionally gated by its own `_refuse_ordering` check,
  independent of `require_permission`, to `settings.manage` alone), 3
  `officers.py` (`require_permission("settings.manage",
"organization.update_settings")`), 5 `org_chart.py` (`GET ""` auth-only by
  design; the four mutations `require_permission("orgchart.manage",
"settings.manage")`).
- **OR-gate alternatives checked individually, per the checklist's dimension
  2 item** ("one broadly-seeded grant opens the endpoint to the whole
  department"): `members.manage` (the widened alternative on
  `operational_ranks.py`'s CRUD/validate routes) is seeded only to
  `president`, `vice_president`, `secretary`, `membership_coordinator`,
  `assistant_membership_coordinator`, and `assistant_secretary` — all
  officer-tier, never `member` or `firefighter` (grep-confirmed across all 35
  `DEFAULT_POSITIONS` entries, not assumed from the code comment's "roster
  officer" framing). `organization.update_settings` (officers.py's
  alternative) and `settings.manage`/`orgchart.manage` (org_chart.py's) were
  already confirmed not seeded to `member`/`firefighter` in prior passes;
  re-confirmed unchanged here, since none of the three files carry any diff.
- **Found and fixed one documentation-only drift, not a code finding — see
  PERM-9 below.**

### PERM-9 — INFO — this file's own legacy "Route inventory" section had been stale since pass 6 — ✅ FIXED (doc only)

**What:** the "Route inventory" section further down this file (the static
section, not the per-pass write-ups above it) stated `operational_ranks.py`'s
four mutating routes "all require `settings.manage`". That was accurate
through pass 5; pass 6 widened `create_rank`/`update_rank`/`delete_rank`/
`validate_ranks` to `require_permission("settings.manage", "members.manage")`
while keeping `sort_order` changes and `/reorder` gated to `settings.manage`
alone. Passes 6 and 7's own per-pass write-ups recorded the widening
correctly; the static section below was never updated to match, so a reader
who skipped straight to "Route inventory" (as this doc's own structure
invites, newest-pass-first notwithstanding) would see a stale, narrower gate
than the code actually enforces.

**Where:** `docs/security-review/PERM-02-permissions-roles.md` (the "Route
inventory" section, pre-fix).

**Impact:** INFO — no code defect; the live code has required
`settings.manage` OR `members.manage` since pass 6, correctly. A reviewer
reading only the static section could underestimate who may reach these
routes (believing it narrower than reality is not a security risk, but
believing it wider than a OR-gate actually reads — the opposite error — is
the one this checklist item exists to catch, and the stale text could cut
either way for a reader who trusts it).

**Fix:** corrected the section's `operational_ranks.py` paragraph to state
the actual current gates (OR-gate on the four mutating routes, independent
`settings.manage`-only gate on `sort_order`/`/reorder` via
`_refuse_ordering`), with a note that it was corrected at pass 9.

**Guard test:** none — this is a markdown correction, not a code path. The
existing route-gate guard tests (`test_permission_gate_composition.py`,
`test_read_permission_gates.py`) already assert the real gates in code; this
finding is about this findings file's own text, not about a missing check.

### Completion gate (pass 9)

| Check                                                                            | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                  | ✅ 0 violations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `black --check app/ tests/ alembic/` (26.5.1, CI's pin)                          | ✅ 2288 files unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                      | ✅ clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `python3 scripts/validate_migrations.py --strict`                                | ✅ single head `a39a1999776f`, 593 revisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                | ✅ 269 routes, 0 errors, 0 warnings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| standing guard suite (12 files)                                                  | ✅ 224 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| scoped backend tests (`-k "permission or role or rank or officer or org_chart"`) | ✅ 1362 passed, 1 skipped (environment-only: `py_vapid`/`pywebpush` not installed) — 1 unrelated failure (`test_finance_receipts.py`, Feature 05's territory, matched only via the `officer` keyword) on the first run, caused by the sandbox's test database being behind `main` by two migrations (`0d32069fea4d`, `a39a1999776f` — the latter landing same-day via PR #3208); fixed by `alembic upgrade head` against the test database (an environment-setup gap, not an application defect — same shape pass 7 recorded), then re-run clean |
| `cd frontend && npm run typecheck`                                               | ✅ 0 errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `cd frontend && npm run lint`                                                    | ✅ 0 errors, 0 warnings (no frontend files touched this pass)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

No source file needed a fix this pass. Rotation row 02 moves to `✅`.

---

## Pass 8 (2026-10-12, watchdog pickup) — 0 fixed by this pass, 0 new findings; PERM-5 closed by other work

Watchdog pickup: no `claude/security-review-*` PR or branch existed anywhere
in the repo, and `main`'s last security-review merge (Feature 01, pass 8,
PR #3096) had no follow-up iteration since. Rotation row 02 was the next
`⬜`.

**Baseline:** `e9e83612` (PR #2933's merge, pass 7). **Head:** current
`main`. 578 commits between them — not a zero-delta pass. Ten of the twelve
scoped files carry real changes (`operational_ranks.py` and `officers.py`
— the endpoint files, not their services — are byte-identical).

### PERM-5, re-verified: closed by other work, not by this pass

**PERM-5 (the only open item carried from pass 7) is now ✅ FIXED.** Pass 7
recorded that an unmerged PR (#2918, a different track) already proposed
option 2 ("protect the wildcard only") and recommended landing it rather
than re-deriving the same choice. #2918 merged 2026-10-06. Re-verified
directly in current code, not trusted from that PR's message:
`admin_continuity_service.py`'s `assert_positions_retain_administrator`
now refuses to take `*` from the organization's only active holder of it,
with its own module section ("THE LAST WILDCARD HOLDER") documenting the
exact PERM-5 shape and why only position changes are guarded this way (a
deactivated/archived member keeps their positions and gets `*` back on
restore). Wired at both call sites (`users.py:1237,1462`) and the parallel
role-level guard `assert_role_change_retains_administrator`
(`role_service.py:359,383,475`, for the case where editing a shared
position's permission list strips `*` from every holder at once — the W11-8
concurrency hardening pass 7 also flagged is implemented alongside it: the
organization's `admin_continuity` lock is taken before a locking read on
members+positions, closing the read-then-write race pass 7's CONCURRENCY
section describes). Guard tests:
`test_rejects_stripping_the_only_wildcard_holder`,
`test_allows_it_once_another_member_holds_the_wildcard`,
`test_allows_a_change_that_keeps_the_wildcard`,
`test_an_inactive_wildcard_holder_does_not_count` (all in
`tests/test_admin_continuity.py`, re-ran, pass). No `KNOWN_LIMITATIONS.md`
entry remains for PERM-5.

### The ten changed files, reviewed

- **`dependencies.py` / `core/permissions.py`'s AUTH-15 gate and
  `collect_user_permissions` export** — identical content already reviewed
  in full under Feature 01 (`AUTH-01-auth-session.md`'s Pass 8); confirmed,
  not re-derived.
- **`core/permissions.py` — two new permissions, `finance.budget_review`
  and `finance.request`.** `finance.budget_review` is seeded to no
  position (grep-confirmed: appears only in its own `Permission(...)`
  definition and the `ALL_PERMISSIONS` registry, never in
  `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS`), needing no backfill migration
  per the same pattern pass 7 verified for `system.manage_link_domain`.
  `finance.request` is seeded on the `member` position — every member — but
  its own migration backs the seed (`7db20aa49329`, confirmed present), and
  the grant is confined server-side: read directly in
  `endpoints/finance.py`/`services/finance_service.py`, every list and
  by-id lookup a `finance.request`-only caller reaches passes
  `restrict_to_user=<their own id>` through to the query's `WHERE` clause
  (`requested_by`/`submitted_by == restrict_to_user`), so another member's
  request 404s exactly as the docstrings claim — not merely a permission
  gate with the ownership check assumed. `get_all_permissions()` still
  contains no wildcard (120 permissions now, up from 118 at pass 7).
- **`operational_rank_service.py` — `resolve_rank_code` now honours the
  built-in seed codes only while an organization has no rank rows at all
  (ONBOARD-3), closing a real gap pass 7 did not flag:** previously a rank
  an administrator had deleted from the ladder could still be written by a
  direct call (member API, CSV import, prospect conversion), and
  `get_rank_default_permissions` would then grant that deleted rank's
  static defaults — e.g. Captain-level access under a rank the ladder no
  longer lists. Once an organization has any rank row, only stored rows are
  honored; the built-in fallback remains for a never-seeded organization
  (the original #1833 EMT-bug shape pass 4 recorded), and
  `find_members_with_unrecognized_rank`'s broader "what's on the books"
  check is deliberately left using the older, wider rule since it reports
  breakage rather than gating a write. Verified by direct read, not
  asserted from the docstring.
- **`role_service.py` / `roles.py` — a new `DuplicatePositionNameError` →
  409 (W05-5), not a security change.** Race-safe: the organization row is
  locked first, then a locking read on the `Role` name query, so two
  concurrent creates of the same name serialize rather than both
  succeeding (Pitfall #27 shape). `clone_role` delegates to `create_role`,
  so it inherits the check rather than needing its own.
- **`users.py` (+427 at pass 7, further real changes since):**
  - **New `GET /users/directory` (USR-8), a narrower roster than
    `GET /users`.** Read directly: org-scoped query
    (`User.organization_id == str(organization_id)`, from the caller's own
    record, never client-supplied), excludes archived/soft-deleted members,
    and the response is built field-by-field (`MemberDirectoryEntry(id=...,
first_name=..., ...)`) rather than `model_validate`-ing the full ORM
    object, so no attribute beyond the ones listed (no username, hire date,
    station, platoon, membership classification) can leak through.
    `_visible_contact_fields(..., honor_member_choice=True)` means a member
    who hid their own email/phone stays hidden here too — same rule
    `_clear_hidden_contact_fields` already applies on the profile endpoint,
    so the two cannot disagree.
  - **New `POST /users/{id}/unlock` (W02-4), lifting a sign-in lockout
    early.** `members.manage`; by-id query org-scoped
    (`User.organization_id == str(current_user.organization_id)`) and
    row-locked; calls the same `_enforce_account_reset_ceiling` privilege
    check `admin_reset_password`/`admin_reset_mfa` already use (a
    `members.manage` holder cannot act on an account whose effective
    permissions exceed their own — re-read the helper directly, not assumed
    from its docstring); audited; rate-limited via the existing
    `_rate_limit_admin_reset` dependency.
  - **`locked_until` is now hidden from non-admins and cleared once expired
    for admins** (`_redact_contact_fields`) — tightens exposure, does not
    weaken it.
  - **`_refuse_base_position_removal` (W11-9)** refuses to strip the
    baseline `member` position from a non-archived user on both the
    single-removal and replace-all-roles paths. Already recorded ✅
    Resolved in `KNOWN_LIMITATIONS.md`; re-confirmed present at both call
    sites (`users.py:1210`, `:1453`).
  - **Member-photo uploads now go through `reject_if_malicious` before
    re-encoding.** Out of this feature's scope (upload/document security,
    not permissions) — confirmed present, not reviewed in depth here.
  - **`admin_reset_password` now also clears `password_expiry_notified_at`**
    — the AUTH-15 companion fix, consistent with the same clear on the
    member-initiated change/reset paths reviewed under Feature 01.
- **`org_chart.py` / `officer_service.py` / `org_chart_service.py` /
  `operational_rank_service.py`'s remaining diff** — mypy-driven type
  annotations and a `# type: ignore` removal (`_office_slugs` replacing an
  assumed-list cast with an actual `isinstance` check). No behavior change.
- **Frontend: `apiCache.ts`'s two new `UNCACHEABLE_PREFIXES` entries**
  (`/training/skill-evaluations`, `/mcp-oauth/`) already reviewed in full
  under Feature 34 (`FE8-34-frontend-shared.md`); `ProtectedRoute.tsx`,
  `authStore.ts`'s `checkPermission`, and `createApiClient.ts` are
  byte-identical to pass 7.

### Route inventory — re-enumerated, unchanged

28 routes across the same four routers (13 `roles.py` + 7
`operational_ranks.py` + 3 `officers.py` + 5 `org_chart.py`), same gates as
pass 7's table. `/users/directory` and `/users/{id}/unlock` are new routes
but belong to Feature 07 (Users & organizations), not this feature's four
routers; `check_route_permissions.py --strict` (265 total application
routes, 0 errors/0 warnings) covers them there.

### Completion gate (pass 8)

| Check                                                                                                                          | Result                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `python3 -m flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                     | ✅ 0 violations                              |
| `python3 -m black --check app/ tests/ alembic/` (26.5.1, CI's pin)                                                             | ✅ 2176 files unchanged                      |
| `python3 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                         | ✅ clean                                     |
| `python3 scripts/validate_migrations.py --strict`                                                                              | ✅ single head `e1a5bfe7a2ed`, 571 revisions |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                              | ✅ 265 routes, 0 errors, 0 warnings          |
| standing guard suite (12 files) run directly                                                                                   | ✅ 224 passed                                |
| scoped backend tests (`-k "permission or role or rank or officer or org_chart or org_scoping or scoping or admin_continuity"`) | ✅ 1567 passed, 1 skipped (environment-only) |
| `cd frontend && npm run typecheck`                                                                                             | ✅ 0 errors                                  |
| `cd frontend && npm run lint`                                                                                                  | ✅ 0 errors, 0 warnings                      |

No source file was changed by this pass. Rotation row 02 moves to `✅`.

---

## Pass 7 (2026-10-05)

**Backend:** the same eleven files passes 4-6 named, all read in full again:
`app/api/dependencies.py`, `app/core/permissions.py`,
`app/api/v1/endpoints/roles.py` + `app/services/role_service.py`,
`app/api/v1/endpoints/operational_ranks.py` +
`app/services/operational_rank_service.py`,
`app/api/v1/endpoints/officers.py` + `app/services/officer_service.py`,
`app/api/v1/endpoints/org_chart.py` + `app/services/org_chart_service.py`,
`app/services/admin_continuity_service.py`, and the position/rank-assignment
handlers in `app/api/v1/endpoints/users.py`.
**Frontend:** none modified this pass (`ProtectedRoute.tsx`,
`authStore.ts`'s `checkPermission`, `apiCache.ts`, `createApiClient.ts` read
again — only `authStore.ts`'s `logout`/`endSessionLocally` split changed, and
it is AUTH-01's territory, not this feature's).
**Migrations:** none written by this pass; 512 revisions, single head
`34d3d56d1479` (one new migration landed since pass 6 — `add_users_preferred_name`
— unrelated to this feature, applied against the test database during this
pass's gate run, see Completion gate).

### Scope

Baseline `ea2b1ef87` (pass 6's merge commit, PR #2596). Unlike every prior
pass, this one is **not** a zero-delta re-verification: 113 commits touched
something under `backend/alembic/versions/` since that merge, and six of the
eleven feature files changed —

| File                                   |  Δ   | Shape of the change                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | :--: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/dependencies.py`                  | +15  | `get_request_enabled_modules` retyped `Request` → `HTTPConnection` so it stands aside for a WebSocket handshake instead of raising a 500 (`inventory_websocket` checks the module flag itself, post-`accept()`)                                                                                                                 |
| `api/v1/endpoints/roles.py`            |  +6  | `get_role_users` now returns `preferred_name`/`display_name` alongside the existing `first_name`/`last_name`/`email` — a display-name feature, not a new PII category                                                                                                                                                           |
| `core/permissions.py`                  | +176 | eight new seeded permissions (`inventory.kiosk`, `locations.manage_nfc_tags`, `apparatus.manage_nfc_tags`, `suggestions.manage`, `system.manage_link_domain`, `training.view_analytics`) and two new positions (`assistant_membership_coordinator`, `compliance_officer`), plus the `fire_chief` → "Chief" display-label rename |
| `services/operational_rank_service.py` | +15  | display-name formatting only (`format_display_name`), and the "Fire Chief" → "Chief" prose edit in a docstring                                                                                                                                                                                                                  |
| `services/org_chart_service.py`        | +17  | `_member_name` now prefers `preferred_name`, same display-name feature                                                                                                                                                                                                                                                          |
| `api/v1/endpoints/users.py`            | +427 | welcome-email availability gating, membership-number collision handling via `OrganizationService`, profile-redaction-on-write symmetry, display-name plumbing — **none of it touches the ceiling helpers or their call sites** (see below)                                                                                      |
| the other five                         |  0   | byte-identical to pass 6                                                                                                                                                                                                                                                                                                        |

All eleven files were read in full regardless, not diffed — this pass's
question (does anything newly reach the ceiling/continuity guards, or
newly seed a wildcard-adjacent grant without its migration) is answered by
how files interact, the same reasoning pass 4 gave for not trusting a narrow
diff.

**Also checked, outside the eleven-file list, because this pass's one open
finding lives in the file it calls into:**
`app/services/admin_continuity_service.py` — read in full; zero diff against
pass 6 (confirmed: `git log ea2b1ef87..HEAD -- backend/app/services/admin_continuity_service.py`
returns no commits on `main`).

**A second branch, not part of this PR, already carries a fix for this
pass's one finding.** `git branch --all --contains <sha>` on the commit
message found a commit titled "fix(permissions): lock the last-administrator
count; guard the last '*' holder" on `origin/claude/gracious-goodall-z1bv9g`
— **not merged to `main`**, open as PR #2918 (confirmed via the REST pulls
API; that branch does not start with `claude/security-review-`, so it is a
different track's work, not this rotation's, and Step 0 correctly did not
treat it as an open security-review PR). Its commit message states it
implements this finding's **option 2** ("protect the wildcard only") plus an
unrelated locking fix for the separate W11-8 concurrency finding already in
`docs/KNOWN_LIMITATIONS.md`. Verified directly against `main`, not trusted
from the message: `admin_continuity_service.py` on `main` is unchanged from
pass 6 and `assert_positions_retain_administrator` still has no "last `*`
holder" guard (see Findings). This pass leaves the finding OPEN rather than
re-implementing the same fix in parallel, which would only produce a merge
conflict against #2918 when it lands; the writeup below names the option
that branch already chose so a reviewer merging either PR can reconcile them
rather than rediscovering the choice.

### Route inventory

Unchanged count and unchanged gates — 28 routes, same four routers
(`grep -c '^@router\.' *.py` re-run: 13 `roles.py` + 7 `operational_ranks.py`

- 3 `officers.py` + 5 `org_chart.py`). Every route's `Depends()` was
  re-enumerated directly against pass 6's table rather than trusted from the
  zero-diff on those four files:

* **`roles.py` (13 routes)** — identical to pass 6's table; only
  `get_role_users`'s response shape grew two display-name fields, not its
  permission gate (`require_permission("positions.view", "roles.view",
"users.view")`, `roles.py:497`).
* **`operational_ranks.py` (7 routes)** — identical to pass 6's corrected
  table: `create_rank`/`update_rank`/`delete_rank`/`reorder_ranks`/
  `validate_ranks` all `require_permission("settings.manage",
"members.manage")`; `reorder_ranks`'s independent `_refuse_ordering` gate
  (`ORDERING_PERMISSION = "settings.manage"`) confirmed still present at
  `operational_ranks.py:52`.
* **`officers.py` (3 routes)** — all three still
  `require_permission("settings.manage", "organization.update_settings")`
  (`officers.py:36,61,114`).
* **`org_chart.py` (5 routes)** — `GET ""` still auth-only by design; the
  four mutations still `require_permission("orgchart.manage",
"settings.manage")`.

### Verified good ✅

- **All eight prior fixes (PERM-1, -2, -3, -4, -6, -7, -8, and pass 5/6's
  ceiling/ordering/case-folding verifications) are intact**, re-checked by
  direct grep at current line numbers: `is_read_only_permission`'s
  word-boundary match plus `_READ_ONLY_PERMISSION_EXCEPTIONS`
  (`core/permissions.py:1101,1094`); `MAX_RANKS_PER_REORDER = 500`
  (`schemas/operational_rank.py:105`); `assign_role_to_user`/
  `remove_role_from_user`/`set_user_roles` still take `organization_id` as a
  required keyword-only parameter; `_enforce_rank_grant_ceiling` /
  `_enforce_role_grant_ceiling` / `_enforce_account_reset_ceiling` all still
  present and still wired at every call site pass 6 named
  (`users.py:323,367,1127,1143,1261,1367,1843,2032,2174,2283` — re-grepped,
  not re-derived).
- **`get_all_permissions()` still contains no wildcard** despite eight new
  permissions landing this pass: `"*" not in get_all_permissions()`,
  confirmed by direct interpreter check against the current registry
  (118 permissions total, up from 110 at pass 6). `create_role`/`update_role`
  still validate against this list, so none of the new grants are reachable
  through role CRUD at a scope wider than seeded.
- **Every new seeded permission/position this pass's diff added has its own
  Pitfall #23 migration**, checked by name rather than assumed from the
  registry comment: `inventory.kiosk` →
  `20260925_0234_2000f4561f52_inventory_self_checkout_kiosk.py`;
  `locations.manage_nfc_tags`/`apparatus.manage_nfc_tags` →
  `20261002_2303_5bed4c485d2f_grant_nfc_tag_writers.py`;
  `suggestions.manage` →
  `20260923_2219_394600cbfae2_grant_suggestions_manage.py` (read in full —
  correctly gated on the grant's own absence rather than a whole-row
  snapshot, scoped to `is_system = True`, idempotent, frozen `_SLUGS` tuple
  rather than an import of the live registry); `assistant_membership_coordinator`
  → `20260924_1710_43e9df281412_seed_assistant_membership_coordinator_*.py`;
  `compliance_officer` → `20260924_1906_3c918c06466d_seed_compliance_officer_position_and_box.py`;
  `training.view_analytics` →
  `20261004_1459_84819ea78a79_grant_training_view_analytics_to_*.py`.
  `system.manage_link_domain` needs no backfill migration: it is "granted to
  no default role" by its own comment and only the wildcard `it_manager`
  position matches it, which needs no stored-row change. `inventory.check_manage`
  on the Quartermaster position is likewise backed by the
  `20260930`-dated `add_quartermaster_check_manage` migration its own code
  comment names (`core/permissions.py:2139`).
- **PERM-5's failure scenario still reproduces against the current registry,
  driven directly rather than reasoned from the diff**: `permission_matches("*",
DEFAULT_POSITIONS["secretary"]["permissions"])` and the same for
  `membership_coordinator` both evaluate `False`, while both still hold
  `members.manage` — the exact gap the finding describes is unchanged by
  everything else this pass's six changed files did.
- **No injection surface, no unbounded in-memory tracker, no new migration
  authored by this feature** — re-confirmed by the same greps prior passes
  ran (zero raw SQL, zero `.like(`/`.ilike(`, zero `csv.writer`, no new
  module-level dict/set) across the six changed files.

### Findings

**PERM-5 remains the rotation's one open item for this feature — re-verified,
not newly found.** Unchanged since pass 4's original writeup below, and still
reproduces against the current seeded `DEFAULT_POSITIONS` (see "Verified
good" above). **New to this pass:** an unmerged PR (#2918, branch
`claude/gracious-goodall-z1bv9g`, a different track's work) already proposes
the narrow fix this writeup's option 2 describes ("protect the wildcard
only") — refusing to strip `*` from its last active holder specifically,
rather than a general demotion ceiling. That PR has not merged as of this
pass; this pass does not duplicate it. **Recommendation for whoever merges
first:** land #2918's narrow guard (or the owner's preferred option from the
three below) rather than having this feature's next pass re-derive the same
choice a third time.

Zero other new findings this pass, despite the real (non-zero-delta) diff —
every changed line in the six files above is either a display-name feature,
a WebSocket-handshake carve-out already scoped to a non-auth dependency, or
a new seeded grant each individually backed by its own migration.

### Schema & migration notes

No model or migration authored by this feature this pass. `operational_ranks`,
`organization_officers`, `org_chart_nodes` FK nullability unchanged since
pass 4 (re-confirmed: `tests/test_database_schema.py::test_set_null_fks_are_nullable`
re-run clean). `validate_migrations.py --strict`: 512 revisions, single head
`34d3d56d1479` — one migration ahead of pass 6's `6ab7d903fae5`, from
`add_users_preferred_name` (an unrelated display-name feature). The test
database in this session's sandbox was one migration behind at the start of
this pass (`alembic upgrade head` applied exactly that one migration before
the gate's scoped test run; see Completion gate) — an environment-setup gap,
not an application defect, and not something a security review fixes in
code.

### Guard tests added

None — no new fix in this pass (the open finding's fix is in flight on a
different branch, not duplicated here). All standing guard tests from
passes 1-6 re-run clean (see Completion gate).

### Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Result                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `python3 -m flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                | ✅ 0 violations                                                                    |
| `python3 -m black --check app/ tests/ alembic/` (26.5.1, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                        | ✅ 1869 files unchanged                                                            |
| `python3 -m isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                    | ✅ clean                                                                           |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 512 revisions, single head `34d3d56d1479`                                       |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 244 routes checked, 0 errors, 0 warnings                                        |
| `python3 scripts/check_docs_links.py`                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ 428 Markdown files, 0 broken links                                              |
| backend tests, scoped (`-k "permission or role or rank or officer or org_chart or org_scoping or scoping or admin_continuity"`) — **first run failed 136/1584 on `Unknown column 'users.preferred_name'`** (test DB one migration behind sandbox's `alembic upgrade head`); fixed by running the pending migration, then re-run clean                                                                                                                     | ✅ 1448 passed, 1 skipped (`py_vapid` — environment), after `alembic upgrade head` |
| standing guard suite (`test_org_scoping_ratchet.py` + `test_require_permission_registry.py` + `test_endpoint_auth_coverage.py` + `test_permission_gate_composition.py` + `test_read_permission_gates.py` + `test_privilege_ceiling_wiring.py` + `test_permission_read_write_tiers.py` + `test_role_service.py` + `test_operational_rank_service.py` + `test_operational_rank_permissions.py` + `test_rank_grant_ceiling.py` + `test_admin_continuity.py`) | ✅ 212 passed                                                                      |
| backend full unit suite (`pytest tests/ -m "not integration and not slow and not docker"`)                                                                                                                                                                                                                                                                                                                                                                | ✅ 12574 passed, 1 skipped (environment), 0 failed                                 |
| `npm run typecheck` (frontend)                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ 0 errors                                                                        |
| `npm run lint` (frontend)                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ 0 errors, 0 warnings                                                            |

---

## Pass 6 (2026-09-15)

**Backend:** the same eleven files pass 4/5 named, all read in full again:
`app/api/dependencies.py`, `app/core/permissions.py`,
`app/api/v1/endpoints/roles.py` + `app/services/role_service.py`,
`app/api/v1/endpoints/operational_ranks.py` +
`app/services/operational_rank_service.py`,
`app/api/v1/endpoints/officers.py` + `app/services/officer_service.py`,
`app/api/v1/endpoints/org_chart.py` + `app/services/org_chart_service.py`,
`app/services/admin_continuity_service.py`, and the position/rank-assignment
handlers in `app/api/v1/endpoints/users.py`.
**Frontend:** none modified this pass.
**Migrations:** none written this pass; 444 revisions, single head
`6ab7d903fae5` (unchanged from pass 5).

### Scope

Baseline `916488124` (merge commit of PR #2538, pass 5's landing point).
`git diff 916488124 origin/main -- <the eleven files>` (`origin/main` =
`6da437f21`, the tip after PR #2593 — Feature 01's own pass-6 — merged)
returns **zero lines across all eleven files**, byte-identical to pass 5's
reviewed state. `git log 916488124..origin/main -- <the eleven files>` also
returns zero commits.

Despite the zero diff, every file was read in full this pass, not diffed, and
every claim below was re-checked by direct grep/read at current line numbers —
not by trusting the empty diff alone, the same discipline AUTH-01's own pass 6
and this feature's own pass 3/4/5 established. One outside-scope file this
feature's fixes depend on was also checked for drift:
`app/services/membership_pipeline_service.py` (PERM-3's other call site) has
one new commit since the baseline — `bcbeb9c72`, "close the election-vote
gate's transfer-path bypass (MP-30)" — but it touches only the unrelated
election-vote gate inside `_do_transfer`, not the rank-ceiling logic; the
`_enforce_rank_grant_ceiling` call in `membership_pipeline.py:1596` still runs
at the endpoint layer, before the service method (and therefore before
MP-30's new `_election_block_reason` check) is ever reached, so PERM-3's fix
and its alert-noise correction are both unaffected. `inventory_service.py`,
`operational_rank_service.py` and `users.py` all show zero diff against the
baseline as well.

### Route inventory

Unchanged count — 28 routes, same four routers (`grep -c '^@router\.' *.py`
re-run: 13 `roles.py` + 7 `operational_ranks.py` + 3 `officers.py` + 5
`org_chart.py`). Re-enumerated every route's `Depends()` directly against
pass 4/5's tables rather than trusting them:

- **`roles.py` (13 routes)** — every permission string at its current line
  number matches pass 4's table exactly: `create_role`
  (`roles.py:214-216`, `positions.create`/`positions.manage_permissions`/
  `roles.create`), `update_role`, `delete_role` (`:367-369`), `clone_role`
  (`:426-428`), `get_role_users` (`:496`), `get_user_permissions` (`:554`,
  target `user_id` resolved in-org at `:565-571` before the unscoped
  `get_user_permissions`/`get_user_roles` calls), `get_my_roles`/
  `get_my_permissions`/`check_admin_access` (auth-only, self-scoped by
  `current_user.id`). No drift.
- **`officers.py` (3 routes)** — all three still gated
  `require_permission("settings.manage", "organization.update_settings")`
  (`officers.py:36,61,114`); `set_officer` still validates the client-supplied
  `user_id` in-org before storing it (`officer_service.py:336-344`) and
  rejects an unknown `office_key` against the `OFFICE_KEYS` allowlist
  (`officer_service.py:333`); the settings-JSON mutation is still a
  `copy.deepcopy()` (`officer_service.py:315`).
- **`org_chart.py` (5 routes)** — `GET ""` is still auth-only by design
  (`org_chart.py:74-79`), deferring to `_can_manage` (`:41-42`) to decide
  whether unpublished nodes and the member/role/rank option lists are
  included; all four mutations still gate on `orgchart.manage` OR
  `settings.manage` (`:89,131,170,215`). `MAX_DEPTH=8`, `MAX_NODES=500`,
  `MAX_HOLDERS_PER_NODE=25` and `assert_in_org` on every client-supplied FK
  (`parent_id`, holder `user_id`) are all still present in
  `org_chart_service.py` at the line numbers pass 1 recorded them.
- **`operational_ranks.py` (7 routes)** — matches pass 5's table with **one
  correction to the table itself**, below. `create_rank` and `update_rank`
  still run `_enforce_rank_grant_ceiling` before the service write
  (`operational_ranks.py:137`, and `:252`+`:255` for both the old and new
  code on a rename); `_refuse_ordering`/`_may_order_ladder` still gate
  `sort_order` on `settings.manage` specifically (`:52-69`), and
  `create_rank` still appends one past the highest existing `sort_order`
  rather than counting rows (`:152-155`).

**Correction to pass 5's own route inventory table:** pass 5 listed `POST
/operational-ranks/reorder`'s permission as `` `settings.manage` (unchanged —
deliberately not widened) ``. That is wrong about the `Depends()` value,
though right about the net effect. The actual dependency, unchanged since the
widening commit pass 5 itself describes two paragraphs earlier ("moved five
of `operational_ranks.py`'s seven routes (`create`, `update`, `delete`,
`reorder`, `validate`)..."), is
`require_permission("settings.manage", "members.manage")`
(`operational_ranks.py:295-297`) — `reorder` **was** one of the five widened
routes at the FastAPI-dependency level, matching the opening paragraph and
contradicting the table two paragraphs later. What is true, and what makes
this a documentation fix rather than a security finding, is that
`_refuse_ordering(current_user)` runs as the unconditional first line of
`reorder_ranks` (`:307`, before any query) and independently requires
`settings.manage` by name (`ORDERING_PERMISSION = "settings.manage"`,
`:52`) — so a `members.manage`-only caller reaches the handler but is refused
with a 403 before any read or write, exactly the behavior the docstring at
`:303-305` describes. `TestReorder`-adjacent
`test_reorder_is_refused_without_the_ordering_grant` and
`test_reorder_is_allowed_with_it` in `tests/test_operational_rank_permissions.py`
already cover both directions and were re-run clean. The table entry above
is corrected to state the actual `Depends()` and name the second gate that
does the real enforcement, so a future pass reading the table alone is not
misled about what the route accepts.

### Verified good ✅

- **All eight prior fixes (PERM-1, PERM-2, PERM-3, PERM-4, PERM-6, PERM-7,
  PERM-8, and pass 5's ceiling/ordering/case-folding verifications) are
  intact, re-checked by direct grep at current line numbers, not by trusting
  the zero diff:**
  - PERM-1: `GET /operational-ranks/validate` still requires `settings.manage`
    OR `members.manage` (`operational_ranks.py:170`) — widened from
    `settings.manage`-only by the pass-5 commit, correctly following the
    ladder screen it backs, still a `require_permission` gate rather than
    auth-only.
  - PERM-2: `seed_defaults`'s savepoint-based concurrent-insert handling —
    confirmed present in `operational_rank_service.py` (unchanged, zero diff).
  - PERM-3: `transfer_prospect` still resolves the prospect and checks
    existence/transferred-status **before** `_enforce_rank_grant_ceiling`
    (`membership_pipeline.py:1574-1598`), so the CRITICAL-alert ceiling check
    still cannot be spammed with garbage prospect ids.
  - PERM-4: `update_rank`'s ceiling on both the old and new `rank_code`
    (`operational_ranks.py:252,255`), before `service.update_rank` at `:260`.
  - PERM-6: `is_read_only_permission`'s word-boundary match plus
    `_READ_ONLY_PERMISSION_EXCEPTIONS` (`core/permissions.py:1032,1025`).
  - PERM-7: `assign_role_to_user`/`remove_role_from_user`/`set_user_roles`
    all still take `organization_id` as a required, keyword-only parameter
    (`role_service.py:536-543` and neighbours) with no default.
  - PERM-8: `MAX_RANKS_PER_REORDER = 500` still caps `RankReorderRequest.ranks`
    (`schemas/operational_rank.py:105,112`).
  - Pass 5's case-folding argument: `resolve_rank_code` still folds to a
    canonical spelling before any downstream `User.rank` write
    (`operational_rank_service.py:394-414`), and `get_all_permissions()`
    still returns only `ALL_PERMISSIONS` names — `"*"` appears exactly once
    in the whole file, at the seeded `it_manager` position
    (`core/permissions.py:1745`), confirmed by grep, so a role cannot be
    minted or edited to hold it (`create_role`/`update_role` validate against
    `get_all_permissions()`).
- **PERM-5 is unchanged and still open**, re-verified directly rather than by
  the empty diff alone: `assign_user_roles` (`users.py:932`) and
  `remove_role_from_user` (`users.py:1168`) still call only
  `_enforce_role_grant_ceiling` (a no-op on a removal — it walks the
  **incoming** role list) and `assert_positions_retain_administrator`, whose
  signature (`admin_continuity_service.py:194-201`) takes no caller/current
  user argument at all — confirmed by reading the full signature, it compares
  the target's resulting permissions against nothing but "would some member
  still hold `members.manage`", never against the caller's own authority.
  Still mirrored in `docs/KNOWN_LIMITATIONS.md`, still awaiting an owner
  decision among the three options pass 4 laid out.
- **All 28 routes still carry an auth dependency and the route/permission
  inventory matches `docs/APPLICATION_PAGES.md`** — mechanism:
  `python3 scripts/check_route_permissions.py --strict` re-run directly,
  228 routes checked (whole app), 0 errors, 0 warnings; `git diff` confirms
  no route was added, removed, or renamed in this feature since pass 5.
- **No injection surface, no unbounded in-memory tracker, no new migration** —
  re-confirmed by the same greps prior passes ran (zero raw SQL, zero
  `.like(`/`.ilike(`, zero `csv.writer`, no new module-level dict/set), all
  unchanged.

### Findings

**None.** Zero new findings this pass — a true zero-delta re-verification,
with the one correction above being to pass 5's own prose (the `Depends()`
value on `/operational-ranks/reorder`), not to application code, which was
already and remains correct. PERM-5 remains the rotation's one open item for
this feature, unchanged since pass 4.

### Schema & migration notes

No model or migration touched this pass. `operational_ranks` table unchanged
since pass 4/5 (`organization_id` `ondelete="CASCADE"` + `nullable=False`,
`UniqueConstraint(organization_id, rank_code)`); `organization_officers.user_id`
and all three `org_chart_nodes` FKs remain `ondelete="SET NULL"` +
`nullable=True`. `validate_migrations.py --strict`: 444 revisions, single head
`6ab7d903fae5`, unchanged.

### Guard tests added

None — no new fix in this pass. All standing guard tests from passes 1-5
re-run clean (see completion gate).

### Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                 | Result                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `python3 -m flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                              | ✅ 0 violations                                                    |
| `python3 -m black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                       | ✅ 1596 files unchanged                                            |
| `python3 -m isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                  | ✅ clean                                                           |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                     | ✅ 444 revisions, single head `6ab7d903fae5`                       |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                                                 | ✅ 228 routes checked, 0 errors, 0 warnings                        |
| `python3 scripts/check_docs_links.py`                                                                                                                                                                                                                                                                                                                                                                 | ✅ 358 Markdown files, 0 broken links                              |
| backend tests, scoped (`-k "permission or role or rank or officer or org_chart or org_scoping or scoping"`)                                                                                                                                                                                                                                                                                           | ✅ 1250 passed, 1 skipped (`py_vapid` not installed — environment) |
| `test_org_scoping_ratchet.py` + `test_require_permission_registry.py` + `test_endpoint_auth_coverage.py` + `test_permission_gate_composition.py` + `test_read_permission_gates.py` + `test_privilege_ceiling_wiring.py` + `test_permission_read_write_tiers.py` + `test_role_service.py` + `test_operational_rank_service.py` + `test_operational_rank_permissions.py` + `test_rank_grant_ceiling.py` | ✅ 195 passed                                                      |
| backend full unit suite (`pytest tests/ -m "not integration and not slow and not docker"`)                                                                                                                                                                                                                                                                                                            | ✅ 10199 passed, 1 skipped (environment), 0 failed                 |
| `npm run typecheck` (frontend)                                                                                                                                                                                                                                                                                                                                                                        | ✅ 0 errors (no frontend file modified)                            |
| `npm run lint` (frontend)                                                                                                                                                                                                                                                                                                                                                                             | ✅ 0 errors, 0 warnings (no frontend file modified)                |

---

## Pass 5 (2026-09-14)

**Backend:** same ten files pass 4 named, all read in full again:
`app/api/dependencies.py`, `app/core/permissions.py`,
`app/api/v1/endpoints/roles.py` + `app/services/role_service.py`,
`app/api/v1/endpoints/operational_ranks.py` +
`app/services/operational_rank_service.py`,
`app/api/v1/endpoints/officers.py` + `app/services/officer_service.py`,
`app/api/v1/endpoints/org_chart.py` + `app/services/org_chart_service.py`,
`app/services/admin_continuity_service.py`, and the position/rank-assignment
handlers in `app/api/v1/endpoints/users.py`.
**Frontend:** none modified this pass.
**Migrations:** none written this pass; 444 revisions, single head
`6ab7d903fae5`.

### Scope

`git diff a96b7370..HEAD -- <the ten files>` (`a96b7370`, PR #2391, is pass
4's merge commit) reports exactly **three** files changed and seven
byte-identical:

| File                                    |    Δ     | Commits (all 2026-09-08/09)                                                                      |
| --------------------------------------- | :------: | ------------------------------------------------------------------------------------------------ |
| `api/v1/endpoints/operational_ranks.py` | +114/−14 | `3f09b9c43`, `09c6c904e`, `849af0251`, `bb93f270c` (merge)                                       |
| `core/permissions.py`                   |   +175   | `92c8cb574`, `849af0251`, `fb3ba0279`, `1e939465b`, `9c3a6111c`                                  |
| `services/operational_rank_service.py`  |   +40    | `3f09b9c43`, `92c8cb574`                                                                         |
| the other seven                         |    0     | byte-identical to pass 4, whose verdicts (including open **PERM-5**) stand without re-derivation |

Despite the narrow diff, all ten files were read in full this pass, not
diffed, for the same reason pass 4 gave: an escalation question is answered
by how files interact, not by one file's own patch.

`core/permissions.py`'s +175 lines are `module_checkbox_tier` /
`module_checkbox_grants` / `module_checkbox_is_held` / `module_for_permission`
— a lookup table for what the onboarding wizard's per-module View/Manage
checkboxes actually write, replacing a same-named-prefix assumption that broke
for four modules (`medical_supplies`, `mobile`, `integrations`, `positions`).
Read in full because the file is in this feature's scope, but the only callers
are in `app/api/v1/onboarding.py` (feature 30's own surface, excluded from this
pass's scope the same way `save_session_roles` was excluded in pass 4) — the
functions are pure lookups over static data, add no new permission string to
the registry, and change no existing `permission_matches` /
`get_all_permissions` / ceiling behavior this feature's endpoints rely on.
`tests/test_module_checkbox_grants.py` (14 tests) covers them; re-run clean.

The other two changed files are this pass's real subject: **`Let members.manage
edit the operational rank ladder`** (`3f09b9c43`) moved five of
`operational_ranks.py`'s seven routes (`create`, `update`, `delete`,
`reorder`, `validate`) from `settings.manage`-only to `settings.manage` OR
`members.manage`, because the ladder screen itself moved into Members
Administration. This is exactly the shape this rotation exists to catch —
a permission gate widened out from under a ceiling that used to be
redundant — and it already went through its own two rounds of review
(`09c6c904e` "Address Codex review: five findings, all real",
`849af0251` a CI fix + second Codex round, `1e939465b` "address the nine
open Codex findings on this branch", `9c3a6111c` closing four more) before
landing in `main`, all dated 2026-09-08/09, before this rotation reached it.

### Route inventory

Unchanged count — 28 routes, same four routers
(`grep -c '^@router\.' *.py` re-run: 13 + 5 + 3 + 7). The permission column
for five `operational_ranks.py` routes changed:

| Method | Path         | Permission (was → now)                                    | Org-scoped | Notes                                                                                                                            |
| ------ | ------------ | --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET    | ``           | authenticated only (unchanged)                            | org        | seeds defaults on first load                                                                                                     |
| POST   | ``           | `settings.manage` → `settings.manage` OR `members.manage` | org        | `_enforce_rank_grant_ceiling(rank_code)` before create; ordering forced to append unless the caller also holds `settings.manage` |
| GET    | `/validate`  | `settings.manage` → `settings.manage` OR `members.manage` | org        | disclosure unchanged (member name + rank-code mismatch), just a wider audience matching where the page moved                     |
| GET    | `/{rank_id}` | authenticated only (unchanged)                            | org        | `get_rank(id, org)`                                                                                                              |
| PATCH  | `/{rank_id}` | `settings.manage` → `settings.manage` OR `members.manage` | org        | ceiling on **both** the old and new `rank_code` when it changes; `sort_order` refused without `settings.manage`                  |
| DELETE | `/{rank_id}` | `settings.manage` → `settings.manage` OR `members.manage` | org        | unchanged member-count refusal; deleting an unused label grants nothing (see below)                                              |
| POST   | `/reorder`   | `settings.manage` (unchanged — deliberately not widened)  | org        | `_refuse_ordering` runs unconditionally, ahead of the service call                                                               |

The other 23 routes (`roles.py` 13, `officers.py` 3, `org_chart.py` 5,
`operational_ranks.py`'s two unchanged reads) are byte-identical to pass 4's
inventory; not re-tabulated.

### Verified good ✅

- **The ceiling is enforced on both the create path and both directions of a
  rename, and is missing from neither.** `create_rank` runs
  `_enforce_rank_grant_ceiling(current_user, data.rank_code, …)` before the
  service call (`operational_ranks.py:137`); `update_rank` runs it against
  `existing.rank_code` **and then** `update_data["rank_code"]`
  (`operational_ranks.py:252,255`) when the code is actually changing — the
  rename-out direction matters because `update_rank`'s service cascades the
  new code onto every member holding the old one, so renaming a rank a
  members.manage caller does not have the authority to grant is also stripping
  those members without the authority to strip them. Both directions have a
  dedicated test in `TestRenameCeiling` (`test_operational_rank_permissions.py`),
  and `TestCreateCeiling::test_the_ceiling_runs_before_the_row_is_written`
  confirms the check happens before any write, not after.
- **The ordering carve-out actually closes the hole it names.** Verified the
  mechanism it's built against, not just that a docstring claims one:
  `inventory_service.py:9287` (`_passes_restrictions`) admits a member when
  `rank_order <= min_rank_order` — lower `sort_order` is more senior — so a
  members.manage caller minting a rank at order 0 and assigning it to
  themselves (a custom code carries no default permissions, so the rank
  ceiling at assignment time would not have stopped that) would have cleared
  every rank-based inventory restriction in the org without touching a single
  permission. `_may_order_ladder`/`_refuse_ordering` gates `sort_order` on
  `update_rank`, `reorder_ranks` unconditionally, and forces `create_rank` to
  append **one past the highest existing `sort_order`** — checked that this is
  the max, not the row count, because `delete_rank` never renumbers survivors
  and a count-based append would land above a sparse ladder's only rung
  (`TestLadderOrdering::test_a_new_rung_clears_a_gapped_ladder_rather_than_counting_rows`
  exercises exactly that). All five ordering tests pass.
- **A case-differing `rank_code` cannot use `dict.get`'s case sensitivity to
  slip past the ceiling and later grant anything.** Worth checking directly,
  since `OPERATIONAL_RANKS.get(rank)` (`core/permissions.py:1644`) and
  `get_rank_default_permissions` are exact-string lookups with no case
  folding — a `members.manage` caller submitting `rank_code="Fire_Chief"`
  makes `get_rank_default_permissions("Fire_Chief") == []`, so the ceiling
  finds nothing to exceed and passes trivially. Two independent things close
  the gap this opens: (1) the database's default collation is
  `utf8mb4_unicode_ci` (`docker-compose.yml:28`), so the `UniqueConstraint`
  and the service's own duplicate check (`OperationalRank.rank_code ==
data.rank_code`, both `create_rank` and `update_rank` in
  `operational_rank_service.py`) already reject a case-variant of a rank the
  org has, seeded or not; (2) even bypassing that, no downstream consumer of
  `User.rank` reads this feature's raw row — every writer of `User.rank`
  (`create_member`, `update_user_profile`, `_do_transfer`) goes through
  `OperationalRankService.resolve_rank_code`, which folds to lowercase and
  matches the static `DEFAULT_RANK_CODES` **before** it ever queries the
  per-org table, so `"Fire_Chief"`, `"FIRE_CHIEF"` or `"fire_chief"` all
  resolve to the same canonical `"fire_chief"` at assignment time — the exact
  string `_enforce_rank_grant_ceiling` is checked against at that call site,
  independent of whatever the ladder's own display row is spelled. A
  case-variant row is at worst a confusing, permission-inert duplicate label
  (and `RankResponse.default_permission_count` would correctly show `0` for
  it, since that computed field runs the same case-sensitive lookup) — not a
  privilege escalation. This is deliberate design, documented in
  `resolve_rank_code`'s own docstring, not something this pass added.
- **`delete_rank` needed no ceiling of its own.** The per-org `operational_ranks`
  row carries no permissions (confirmed again: `grep -n permissions
models/operational_rank.py` — none); deleting one that no member currently
  holds (the existing `member_count` refusal, unchanged) removes a label, not
  an authority, and recreating a rank coded for something the caller cannot
  grant still has to clear `create_rank`'s ceiling. No path from delete to
  escalation.
- **PERM-6, PERM-7, PERM-8's fixes are all still in place, re-verified at
  current line numbers, not merely grepped for presence:**
  `is_read_only_permission`'s word-boundary match plus
  `_READ_ONLY_PERMISSION_EXCEPTIONS` (`core/permissions.py:1025,1032`, PERM-6);
  `assign_role_to_user`/`remove_role_from_user`'s required keyword-only
  `organization_id` with `assert_in_org` on both ids
  (`role_service.py:24-60` area, PERM-7); `MAX_RANKS_PER_REORDER = 500` on
  `RankReorderRequest` (`operational_rank_service.py` schema import,
  `schemas/operational_rank.py:105`, PERM-8). All three guard test files pass.
- **PERM-5 is unchanged and still open.** `users.py`,
  `admin_continuity_service.py` are byte-identical to pass 4
  (confirmed by the zero-length diff above) — the three user↔position
  assignment routes still carry only `_enforce_role_grant_ceiling` (a no-op on
  a removal) and `assert_positions_retain_administrator` (counts, doesn't
  compare caller to target), and neither guard has moved. Still mirrored in
  `docs/KNOWN_LIMITATIONS.md`, still awaiting an owner decision among the
  three options pass 4 laid out.
- **All 28 routes still carry an auth dependency**, mechanism unchanged:
  `tests/test_endpoint_auth_coverage.py` + `tests/test_require_permission_registry.py`,
  both re-run clean.
- **No injection surface, no unbounded in-memory tracker, no new migration** —
  re-confirmed by the same greps pass 4 ran, unchanged results.

### Findings

**None.** Zero new findings this pass. The one real behavioral change since
pass 4 — widening five `operational_ranks.py` routes to `members.manage` — was
built with the ceiling and ordering carve-outs described above and had already
been through its own review rounds (four follow-up commits, 2026-09-08/09)
before this rotation reached it; independently re-deriving rather than
trusting that history, the mechanism holds under all three angles checked
(ceiling completeness, the inventory-order attack this was written to close,
and the case-folding edge this pass went looking for). PERM-5 remains the
rotation's one open item for this feature.

### Schema & migration notes

No model or migration touched this pass. `operational_ranks` table unchanged
since pass 4 (still `organization_id` `ondelete="CASCADE"` +
`nullable=False`, still `UniqueConstraint(organization_id, rank_code)`).
`validate_migrations.py --strict`: 444 revisions, single head
`6ab7d903fae5`.

### Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                 | Result                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin — via `python3 -m flake8`, since the bare `flake8` on `PATH` resolves an isolated install missing the pytest-style plugin)                                                                                                                                                                                                                             | ✅ 0 violations                                                    |
| `black --check app/ tests/ alembic/` (26.5.1, CI's pin — via `python3 -m black`, since bare `black` on `PATH` resolves 26.3.1)                                                                                                                                                                                                                                                                        | ✅ 1592 files unchanged                                            |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                                                                                                                                                                                                                                                                                                           | ✅ clean                                                           |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                     | ✅ 444 revisions, single head `6ab7d903fae5`                       |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                                                 | ✅ 228 routes checked, 0 errors, 0 warnings                        |
| `python3 scripts/check_docs_links.py`                                                                                                                                                                                                                                                                                                                                                                 | ✅ 358 Markdown files, 0 broken links                              |
| backend tests, scoped (`-k "permission or role or rank or officer or org_chart or org_scoping or scoping"`)                                                                                                                                                                                                                                                                                           | ✅ 1087 passed, 1 skipped (`py_vapid` not installed — environment) |
| `test_org_scoping_ratchet.py` + `test_require_permission_registry.py` + `test_endpoint_auth_coverage.py` + `test_permission_gate_composition.py` + `test_read_permission_gates.py` + `test_privilege_ceiling_wiring.py` + `test_permission_read_write_tiers.py` + `test_role_service.py` + `test_operational_rank_service.py` + `test_operational_rank_permissions.py` + `test_rank_grant_ceiling.py` | ✅ 195 passed                                                      |
| backend full unit suite (`pytest tests/ -m "not integration and not slow and not docker"`)                                                                                                                                                                                                                                                                                                            | ✅ 10158 passed, 1 skipped (environment), 0 failed                 |
| `tsc --noEmit` / `eslint .`                                                                                                                                                                                                                                                                                                                                                                           | n/a — no frontend file modified                                    |

---

## Pass 4 (2026-09-08)

**Backend:** `app/api/dependencies.py` (537 L), `app/core/permissions.py`
(2353 L), `app/api/v1/endpoints/roles.py` (679 L, **13 routes**) +
`app/services/role_service.py` (943 L),
`app/api/v1/endpoints/operational_ranks.py` (214 L, **7 routes**) +
`app/services/operational_rank_service.py` (512 L),
`app/api/v1/endpoints/officers.py` (140 L, **3 routes**) +
`app/services/officer_service.py` (391 L),
`app/api/v1/endpoints/org_chart.py` (240 L, **5 routes**) +
`app/services/org_chart_service.py` (844 L). Also read, because this feature's
invariants are enforced there and nowhere else:
`app/services/admin_continuity_service.py` (216 L) and the six
position/rank-assignment handlers in `app/api/v1/endpoints/users.py`.
**Frontend:** `components/ProtectedRoute.tsx`, `stores/authStore.ts`'s
`checkPermission`, `utils/apiCache.ts`, `utils/createApiClient.ts` — read, not
modified.
**Migrations:** none written this pass; 438 revisions, single head
`1603bd9c59e7`.

### Scope

**The diff range is real this time and is stated as such.** Pass 3 established
that a date cutoff is the wrong query and that
`git log <prior-pass-merge-sha>..HEAD` is the right one; the repository this
session started from was a shallow clone whose history began after pass 3, so
the range could not be computed until the clone was deepened
(`git fetch --deepen=1500`, 9 359 commits). Pass 3's merge is
`074f6a79` (PR #2136, 2026-09-01), and
`git diff 074f6a79..HEAD -- <the ten feature files>` reports **three** files
changed and seven unchanged:

| File                       |  Δ  | Commits                                                                        |
| -------------------------- | :-: | ------------------------------------------------------------------------------ |
| `core/permissions.py`      | +89 | `bfe7c038`, `54e60202`, `7ff18d0c`, `f8ea3f66`, `ceb36a36`, `b311154f`         |
| `services/role_service.py` | +41 | `a9063055`                                                                     |
| `api/dependencies.py`      | +14 | `8fac5ed4` (feature 01's pass-4 AUTH-14 fix, reviewed there)                   |
| the other seven            |  0  | byte-identical to pass 3, whose verdicts therefore stand without re-derivation |

Despite that, **all ten files plus the four routers were read in full this
pass**, not diffed — the escalation questions this iteration is asked (can a
caller grant, or take, authority they do not hold?) are answered by the
interaction between files, not by any one diff, and PERM-5 below is a defect
that has been there since long before pass 3 and that three passes of
diff-scoped reading did not reach.

**Not read:** `users.py` outside its position/rank-assignment handlers and the
three ceiling helpers (that is feature 07); `app/mcp/*` and
`endpoints/mcp_keys.py` beyond confirming what the new
`integrations.mcp_keys` permission gates (feature 27);
`onboarding.py`'s `save_session_roles` (feature 30).

### Route inventory

28 routes across the four routers this feature owns. Every one carries an auth
dependency; the machine check behind that claim is
`tests/test_endpoint_auth_coverage.py`, which lists 24 unauthenticated
handlers under `app/api/v1/endpoints/` and none of them is in this feature.

**`roles.py` — 13 routes.** Every by-id fetch goes through
`role_service.get_role(role_id, organization_id)`, which filters both columns.

| Method | Path                          | Permission                                                              | Org-scoped | Notes                                                       |
| ------ | ----------------------------- | ----------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| GET    | `/permissions`                | authenticated only                                                      | n/a        | static catalog; no org or member data                       |
| GET    | `/permissions/by-category`    | authenticated only                                                      | n/a        | same catalog, grouped                                       |
| GET    | ``                            | `positions.view` OR `roles.view`                                        | org        | `list_roles(organization_id=…)`                             |
| POST   | ``                            | `positions.create` OR `positions.manage_permissions` OR `roles.create`  | org        | `_enforce_permission_grant_ceiling` before the service call |
| GET    | `/{role_id}`                  | `positions.view` OR `roles.view`                                        | org        | `get_role(id, org)`                                         |
| PATCH  | `/{role_id}`                  | `positions.edit`/`update`/`manage_permissions` OR `roles.edit`/`update` | org        | grant ceiling **and** `_enforce_role_edit_ceiling` (ORU-7)  |
| DELETE | `/{role_id}`                  | `positions.delete` OR `positions.manage_permissions` OR `roles.delete`  | org        | refuses `is_system`; last-admin guard in the service        |
| POST   | `/{role_id}/clone`            | `positions.create` OR `positions.manage_permissions` OR `roles.create`  | org        | ceiling runs against the **source** role's permissions      |
| GET    | `/{role_id}/users`            | `positions.view` OR `roles.view` OR `users.view`                        | org        | role resolved in-org, then `get_users_with_role(id, org)`   |
| GET    | `/user/{user_id}/permissions` | `users.view` OR `positions.view` OR `roles.view`                        | org        | target user resolved in-org **before** the unscoped lookups |
| GET    | `/my/roles`                   | authenticated only                                                      | self       | `current_user.id`                                           |
| GET    | `/my/permissions`             | authenticated only                                                      | self       | `current_user.id`                                           |
| GET    | `/admin-access/check`         | authenticated only                                                      | self       | reports the caller's own admin status                       |

The nine unregistered strings in that column (`roles.view`, `roles.create`,
`roles.edit`, `roles.update`, `roles.delete`) are the pre-rename names. None
of them is in `get_all_permissions()`, so no position can be created holding
one, and each is OR'd with a registered equivalent —
`tests/test_require_permission_registry.py` asserts exactly that, in both
directions. Re-derived here rather than trusted: an AST-ish sweep of every
`require_permission` / `require_all_permissions` call in `app/api/` found 15
unregistered strings in total, all of them from this legacy set, and **zero**
`require_all_permissions` calls with an unresolvable member (which would be
the fail-closed twin the registry test's `any()` cannot see).

**`operational_ranks.py` — 7 routes.**

| Method | Path         | Permission         | Org-scoped | Notes                                                          |
| ------ | ------------ | ------------------ | ---------- | -------------------------------------------------------------- |
| GET    | ``           | authenticated only | org        | seeds defaults on first load (PERM-2's savepoint)              |
| POST   | ``           | `settings.manage`  | org        | duplicate `rank_code` refused per org                          |
| GET    | `/validate`  | `settings.manage`  | org        | PERM-1's fix, still in place                                   |
| GET    | `/{rank_id}` | authenticated only | org        | `get_rank(id, org)`                                            |
| PATCH  | `/{rank_id}` | `settings.manage`  | org        | `_enforce_rank_grant_ceiling` on a `rank_code` change (PERM-4) |
| DELETE | `/{rank_id}` | `settings.manage`  | org        | refuses while any member (incl. archived) holds the code       |
| POST   | `/reorder`   | `settings.manage`  | org        | each item resolved by `get_rank(id, org)` — see PERM-8         |

**`officers.py` — 3 routes**, all `settings.manage` OR
`organization.update_settings`: `GET ``, `PUT /{office_key}`,
`DELETE /{office_key}`. `office_key`is validated against`OFFICE_KEYS`before it is used as a settings-dict key, and`set_officer`validates the
client-supplied`user_id` in-org before storing it.

**`org_chart.py` — 5 routes.** `GET ``: authenticated only, deliberately
(published seats only for a non-manager, decided by `_can_manage`). The four
mutations (`POST /nodes`, `PUT /nodes/{id}`, `POST /nodes/{id}/move`,
`DELETE /nodes/{id}`) all require `orgchart.manage`OR`settings.manage`, all
resolve the node through `_require_node(organization_id, node_id)`, and all
route their client-supplied FKs (`parent_id`, `position_id`, holder
`user_id`) through `_validate_references`, which uses `assert_in_org`; a
`rank_code` is resolved by an explicit org-filtered query.

### Verified good ✅

- **Every one of the 28 routes carries an auth dependency, and 22 carry a
  permission dependency.** Mechanism: the inventory above, cross-checked
  against `tests/test_endpoint_auth_coverage.py` (which fails in both
  directions) and `tests/test_require_permission_registry.py`.
- **The three ceiling helpers are all still present and all still wired.**
  Mechanism: `_enforce_permission_grant_ceiling` / `_enforce_role_edit_ceiling`
  (`roles.py:51,87`; call sites at 231, 329, 339, 452),
  `_enforce_role_grant_ceiling` (`users.py:775`; call sites at 321,
  `assign_user_roles` and `add_role_to_user`), and
  `_enforce_rank_grant_ceiling` (`users.py:848`; four call sites, verified by
  grep: `create_member`, `update_user_profile`'s rank branch,
  `membership_pipeline.transfer_prospect` (PERM-3) and
  `operational_ranks.update_rank` (PERM-4)).
  `tests/test_privilege_ceiling_wiring.py` pins the last two by source order.
- **`User.rank` has exactly one widening write path.** Mechanism: grep for
  every assignment to `.rank` outside the rank service — the only other two
  (`membership_tier_service.py:303`, `member_status.py:856`) set it to `None`,
  which can only narrow. So the four ceiling call sites above are the complete
  set, not a sample.
- **A rank the caller invents grants nothing.** Mechanism:
  `get_rank_default_permissions()` resolves against the static
  `OPERATIONAL_RANKS` catalog by code string, and the per-org
  `operational_ranks` table has no permissions column — so `POST
/operational-ranks` with `rank_code="fire_chief"` creates a label, not an
  authority, and assigning it still has to clear
  `_enforce_rank_grant_ceiling`.
- **`*` is not reachable through role CRUD.** Mechanism: `create_role` and
  `update_role` reject any permission outside `get_all_permissions()`, and
  that list contains no wildcard of any kind. The only `*` in the whole
  registry is the seeded `it_manager` position.
- **The three seeded-grant changes since pass 3 each shipped the migration
  Pitfall #23 requires**, and the direction of each was checked separately
  because the rules differ: `bfe7c038` **revokes** `apparatus.view` from
  `_LINE_MEMBER_PERMISSIONS` and `DEFAULT_POSITIONS['member']`, backed by
  `b6e4a0d17c93`, unconditional and scoped to `is_system = True` (correct for
  a revocation — a department's own customized row is left alone);
  `54e60202` **adds** `finance.approve` + `finance.configure_approvals` to the
  seeded treasurer, backed by a migration gated on positive evidence the row
  is an unrepaired seed (correct for an addition — the scoped-subset match,
  not a whole-row snapshot, for the reason its own message gives); `7ff18d0c`
  registers the missing `emt` **position** so onboarding stops re-creating the
  rows `f3b8d0c26a17` had just cleaned, and aliases the rank's list object
  rather than copying it, which is what keeps the two in step.
- **The frontend's `checkPermission` cannot disagree with the backend about a
  renamed permission.** Mechanism: `_build_current_user_dict` runs
  `expand_legacy_permissions` before serializing, so the literal list the
  client compares against already carries the canonical names — the frontend
  matcher deliberately implements only `*` / exact / `module.*`, and does not
  need the alias map.
- **`GET /org-chart` is not reachable by the response cache**, despite
  returning member names, emails and phone numbers and not being in
  `UNCACHEABLE_PREFIXES`. Mechanism: the governance module builds its client
  with `createApiClient()`, which has no cache interceptor;
  `getCached`/`setCacheIfCurrent`/`isCacheable` are still imported by exactly
  one file, `services/apiClient.ts`. This is the same "no-op today" shape PR
  #2381 recorded for three routes rather than excluding them, and it is
  recorded the same way here so the next pass does not rediscover it — the
  moment governance moves to the cached client, `/org-chart` needs a denylist
  entry.
- **No injection surface in any of the ten files.** Mechanism: grep — zero raw
  SQL, zero `.like(`/`.ilike(`, zero `csv.writer`. `tests/test_like_escaping.py`
  and `tests/test_csv_writer_sweep.py` cover the whole tree anyway.
- **No unbounded in-memory tracker in any of the ten files** (Pitfall #9 n/a —
  none of them defines one; the per-request caches in `dependencies.py` live on
  `request.state`, which its own comment names as the reason).

### Findings

### PERM-5 — MED — Nothing stops a low-privileged position manager from permanently demoting a higher one — ✅ FIXED (2026-10-04)

**What:** the three user↔position assignment routes are gated on
`users.update_positions` OR `members.assign_positions` (OR two legacy names),
and carry exactly two guards: `_enforce_role_grant_ceiling`, which walks the
**incoming** roles and so is a no-op on a removal, and
`assert_positions_retain_administrator`, which only asks whether _somebody_ in
the organization would still hold `members.manage`. Neither asks whether the
caller's own authority covers what the target currently holds. That question
is asked on the two neighbouring paths — `_enforce_role_edit_ceiling` on a
position's permission list (ORU-7), `_enforce_account_reset_ceiling` on a
credential reset — and not on this one.

**Where:** `app/api/v1/endpoints/users.py:931` (`assign_user_roles`, replaces
the whole set, including with `[]`), `:1167` (`remove_role_from_user`);
`app/services/admin_continuity_service.py:194`
(`assert_positions_retain_administrator`, whose whole contract is the count,
not the comparison).

**Failure scenario:** the seeded **Secretary** and **Membership Coordinator**
positions hold `members.assign_positions`, `users.update_positions` and
`members.manage`, and hold none of `settings.manage`, `security.manage` or
`positions.*` (verified against `DEFAULT_POSITIONS`). The Secretary sends
`PUT /users/{it_manager_id}/roles` with `{"role_ids": []}`. The grant ceiling
iterates an empty list and returns. The continuity guard finds two
administrators — the target and the Secretary themselves — so it returns too.
The wildcard `it_manager` position is removed and the department's only `*`
holder becomes an ordinary member. Reproduced against the real helpers, not
reasoned from the signatures: both guards were driven directly with this
state and both passed.

**And it cannot be undone through the API.** Re-granting the position runs
`_enforce_role_grant_ceiling`, which requires the caller to already hold `*`
— nobody does any more — and minting a replacement is impossible because
`create_role`/`update_role` validate against `get_all_permissions()`, which
contains no wildcard. Verified: `permission_matches("*", secretary_perms)` and
the same for the seeded President are both `False`, and `"*" not in
get_all_permissions()`. `admin_continuity_service`'s own module docstring
says recovery from an administrator-less state "needs a database
administrator"; this reaches the same place by a door that module does not
watch.

**Impact:** MED. No confidentiality gain and no privilege gain — this is
sabotage and self-inflicted lockout, reachable by an in-org member holding a
grant departments routinely delegate, and irreversible without database
access. It is the removal-direction twin of the escalation class this feature
otherwise guards thoroughly.

**Fix — flagged, not implemented.** The obvious guard ("you may not change the
positions of a member whose effective permissions exceed your own") is a
product decision, not a mechanical one: it would also block the legitimate
case a Membership Coordinator exists for, offboarding a departing chief, and
the department that most needs the guard is the one whose chief has left. The
options are not equivalent and the owner should pick:

1. **A demotion ceiling**, mirroring `_enforce_account_reset_ceiling` — refuse
   when the target holds anything the caller does not. Safest, most
   restrictive, and changes an existing workflow.
2. **Protect the wildcard only** — refuse to remove a position carrying `*`
   from its last holder, the way `assert_not_last_administrator` protects
   `members.manage`. Narrow, cheap, closes the irreversible case and nothing
   else.
3. **Accept it and make it recoverable** — leave the removal allowed but give
   `*` a restore path that does not require already holding it.

Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Resolution (2026-10-04): FIXED with the narrow "last `*` holder" guard**,
the option the owner chose. `assert_positions_retain_administrator`, which all
three assignment routes already call, now also refuses a change that takes `*`
from the organization's only active holder of it, whatever else the
remaining members hold. A member manager can still offboard a departing chief
once a position carrying `*` has been given to someone else; status changes
and archiving are not guarded this way because the member keeps their
positions and gets `*` back on restore. The count is the one W11-8 made safe
under concurrency (organization `admin_continuity` lock plus a locking read).
Tests: `TestLastWildcardHolder` in `backend/tests/test_admin_continuity.py`.

### PERM-6 — LOW — Two read-only permissions were classified as write-tier — ✅ FIXED

**What:** `is_read_only_permission` decided a permission's tier from its
action word with `action == "view" or action.startswith("view_")`. Two grants
in the catalog read but do not match that shape: `inventory.check_view`
(action `check_view` — a `view` the prefix test cannot see, because the
convention also produces two-word actions on a nested resource) and
`scheduling.report` ("View shift reports and analytics"). Both were filed as
writes.

**Where:** `app/core/permissions.py:835` (pre-fix), consumed by
`permission_matches_any_write` at `:847` and, through it, by
`documents_service._folder_admits_user(require_write=True)` at
`app/services/documents_service.py:298`.

**Failure scenario:** `permission_matches_any_write` authorizes a mutation by
keeping only the entries of a folder's `required_permissions` that it believes
are writes. A read filed as a write is therefore handed to the caller as proof
of write authority: a folder whose ACL named `inventory.check_view` would let
a holder of that read-only grant rename it, delete it, or move documents in
and out — the exact defect the helper was added to close, one permission
family over.

**Impact:** LOW, and **latent rather than live** — verified, not assumed. The
only writer of `DocumentFolder.required_permissions` anywhere in `app/` is
`documents_service`'s facility-folder path, which stores
`FACILITY_SENSITIVE_PERMISSIONS` (`facilities.view_sensitive`,
`facilities.edit`, `facilities.manage`); all three are classified correctly,
and no request schema exposes the column. So nothing is exploitable today, and
the finding is that the classifier is wrong for the next ACL somebody writes.

**Fix:** `view` is now matched as a **word** in the action
(`"view" in action.split("_")`), which covers `check_view` and any future
`<resource>_view`, plus a named `_READ_ONLY_PERMISSION_EXCEPTIONS` set for the
one grant no naming rule can express (`scheduling.report`). The docstring
records the asymmetry that makes this worth getting right: under-detecting a
read weakens a write check, while over-detecting only withholds a write, which
fails closed.

**Guard test:** `tests/test_permission_read_write_tiers.py`. It checks the
classifier against an **independent** signal the same file already carries —
each `Permission`'s hand-written `description` — so it fails on a new
permission whose name and prose disagree, rather than restating the
implementation. Two documented disagreements are pinned by name with the exact
prose they were written for, so a stale exception fails too. Verified red
against the pre-fix implementation (4 of 11 tests fail, including the
end-to-end `permission_matches_any_write` assertion) and green after.

### PERM-7 — LOW — The two remaining unscoped role-assignment helpers — ✅ FIXED

**What:** `a9063055` gave `RoleManagementService.set_user_roles` a required,
keyword-only `organization_id` because it had none and no caller in `app/` —
"an unreachable bulk role-replacement that would have crossed tenants the
moment an endpoint wired it up", as its new docstring puts it. Its two
siblings on the same service, `assign_role_to_user` and
`remove_role_from_user`, are the same shape and were left as they were: no org
parameter, no in-org check on either the client-supplied `user_id` or
`role_id`, and zero callers in `app/`.

**Where:** `app/services/role_service.py:536` and `:600` (pre-fix). Confirmed
by grep that the only `remove_role_from_user` with a caller is the
identically-named _endpoint_ in `users.py`, which is a separate function and
does resolve both ids in-org.

**Failure scenario:** not reachable today — that is the point. This is the
landmine shape AUTH-6 and AUTH-16 named: a plausible-looking service method
sitting under the obvious name, so the endpoint that eventually calls it
crosses tenants in a one-line diff whose reviewer sees a service call and
nothing else. `assign_role_to_user` would pin an arbitrary position onto an
arbitrary member id, across organizations, and positions carry permissions.

**Impact:** LOW today, and the impact of the class it belongs to when it fires.

**Fix:** both now take a required keyword-only `organization_id` and run
`assert_in_org` over the member and the position before any write, matching
`set_user_roles` exactly. Their docstrings state what they do **not** enforce
— the grant ceiling on assignment, the administrator-continuity guard on
removal — and name the live endpoints that do, so a future caller inherits the
list rather than the surprise.

**Guard tests:** `TestSingleAssignmentOrgScoping` in `tests/test_role_service.py`
— four tests driving a foreign member id and a foreign position id through
each method and asserting `ValueError` before any commit, plus a parametrized
signature test asserting `organization_id` is keyword-only and has no default
on all three methods (so a future edit cannot quietly reintroduce an unscoped
default).

### PERM-8 — LOW — A rank reorder issued one query per submitted item, with no cap on items — ✅ FIXED

**What:** `RankReorderRequest.ranks` carried `min_length=1` and no
`max_length`, and `OperationalRankService.reorder_ranks` resolves each item
with its own org-scoped `get_rank` query. The list length was therefore a
query count bounded only by `MAX_REQUEST_BODY_SIZE` (60 MB) against roughly 60
bytes per item — on the order of a million sequential round-trips holding one
worker and one database connection for the duration of a single request.

**Where:** `app/schemas/operational_rank.py:96` (pre-fix);
`app/services/operational_rank_service.py:376` (the per-item loop).

**Failure scenario:** a `settings.manage` holder — or anything that has taken
over such a session — posts `/operational-ranks/reorder` with a large
generated list and ties up a worker. Checklist §6: "no N+1 loop issuing a
query per row".

**Impact:** LOW. Authenticated, org-admin-gated, org-scoped, and the loop
already refuses ids outside the caller's organization, so this is availability
only and only from an insider or a compromised admin session.

**Fix:** `MAX_RANKS_PER_REORDER = 500` on the schema. The loop is left alone
deliberately: rewriting it into a single query would have to reproduce MySQL's
case-insensitive id comparison in Python to be behaviour-preserving, and a cap
is the change that cannot be subtly wrong. 500 is far above any real rank
ladder (the seed writes 8) so the number itself should not need revisiting.

**Guard tests:** `TestReorder::test_reorder_request_is_length_capped` and
`::test_reorder_request_still_rejects_an_empty_list` in
`tests/test_operational_rank_service.py`.

### Checked and deliberately not raised

Recorded so the next pass does not spend the time again:

- **`GET /operational-ranks` and `GET /operational-ranks/{id}` are
  authentication-only.** Deliberate and unchanged since pass 1: a rank is a
  label plus an eligible-seat list, the shift-signup UI needs it, and
  `RankResponse` carries no member data. `/validate` is the one that resolves
  member names and it is the one PERM-1 gated.
- **`role_service.get_user_permissions` omits rank defaults**, so
  `GET /roles/admin-access/check` can report `has_access: false` for a member
  whose administrative grants come from their rank alone. It drives navigation
  only, every endpoint behind it re-checks through `_collect_user_permissions`,
  and the direction of the discrepancy is closed rather than open. A
  correctness wart, not a security finding.
- **`list_roles(include_user_count=True)` issues one count query per
  position.** Bounded by the number of positions in the org (seeded: ~20,
  admin-created beyond that), not by anything a caller submits — so unlike
  PERM-8 there is no request that grows it.
- **`create_rank` accepts an arbitrary `eligible_positions` list and an
  unbounded `description`.** Both are stored, neither is executed, and both are
  bounded by `RequestSizeLimitMiddleware`; `eligible_positions` entries outside
  the shift vocabulary resolve to no seats rather than to extra ones.
- **The `it_manager` position's `["*"]` grant.** Intended, documented at the
  definition, and the only wildcard in the registry; it is also what PERM-5's
  irreversibility argument turns on.
- **`get_request_enabled_modules` swallowing an invalid-credential
  `HTTPException`.** Re-verified as pass 3 described: it resolves module
  enablement, never identity, and is never used as an auth dependency (grep).

### Schema & migration notes

No model or migration was written this pass. Re-verified: `operational_ranks`
has `organization_id` `ondelete="CASCADE"` + `nullable=False` (correct —
CASCADE does not require nullable) and a `UniqueConstraint(organization_id,
rank_code)`; `organization_officers.user_id` and all three `org_chart_nodes`
FKs are `ondelete="SET NULL"` + `nullable=True` (Pitfall #2), which
`tests/test_database_schema.py::test_set_null_fks_are_nullable` also asserts
tree-wide. `validate_migrations.py --strict`: 438 revisions, single head
`1603bd9c59e7`. The three seeded-grant migrations since pass 3 are all present
in the chain (see "Verified good").

### Guard tests added

| Test                                                                         | Invariant it pins                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/test_permission_read_write_tiers.py` (11 tests)                       | every catalogued permission's read/write tier agrees with its own description; the two-word `view` actions are reads; a read-only holder fails `permission_matches_any_write` |
| `TestSingleAssignmentOrgScoping` in `tests/test_role_service.py` (5 tests)   | both single-assignment helpers refuse a foreign member or position before committing, and all three take `organization_id` keyword-only with no default                       |
| `TestReorder::test_reorder_request_is_length_capped` (+ the empty-list twin) | a rank reorder cannot grow into an unbounded query loop                                                                                                                       |

### Completion gate

| Check                                                                                                                                                    | Result                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                            | ✅ 0 violations (flake8 7.3.0, CI's pin)                                              |
| `black --check app/ tests/ alembic/`                                                                                                                     | ✅ 1531 files unchanged (black 26.5.1, CI's pin)                                      |
| `isort --check-only app/ tests/ alembic/`                                                                                                                | ✅ clean (isort 9.0.1, CI's pin)                                                      |
| `python3 scripts/validate_migrations.py --strict`                                                                                                        | ✅ 438 revisions, single head `1603bd9c59e7`                                          |
| backend tests, scoped (`-k "permission or role or rank or officer or org_chart or org_scoping or documents or scoping"`)                                 | ✅ 1348 passed, 1 skipped (`py_vapid` not installed — environment)                    |
| `tests/test_org_scoping_ratchet.py`                                                                                                                      | ✅ 12 passed — no new unscoped by-id query                                            |
| `tests/test_require_permission_registry.py` + `test_endpoint_auth_coverage.py` + `test_permission_gate_composition.py` + `test_read_permission_gates.py` | ✅ 18 passed                                                                          |
| backend tests, full suite                                                                                                                                | ✅ 11 815 passed, 21 skipped (Docker/optional-dependency environment skips), 0 failed |
| `python3 scripts/check_docs_links.py`                                                                                                                    | ✅ 351 Markdown files, 0 broken links                                                 |
| `tsc --noEmit` / `eslint .`                                                                                                                              | n/a — no frontend file modified                                                       |

---

## Pass 3 (2026-09-01) — re-verified, no new findings

**Scope of this pass — corrected mid-review by Codex.** The first cut of this
pass used `git log --since=2026-08-27` (a date, not the actual merge commit)
against the six feature files and found three commits. That query is wrong in
general: a date-only cutoff can both include commits that were already part
of the reviewed merge and exclude commits that land later the same day, and it
did the latter here. Codex's review of this PR caught that `7ac83395` (merged
~45 minutes after pass 2's own closing merge `e601a95d`, confirmed with
`git merge-base --is-ancestor e601a95d 7ac83395`) carries a fourth relevant
commit, `4e40f96b`, touching `core/permissions.py` — present in the
`--since=2026-08-27` output as the boundary commit but not actually opened and
read. Re-run with the correct ancestry range
(`git log e601a95d..HEAD -- <six files>`) confirms exactly four commits, not
three: `cf033864` (permission rename), `9f6e7a7a` (member display-name
update), `a518957e` (module-gate exception handling), and `4e40f96b` +
`2959d2aa` (both merged via `7ac83395`, reviewed below). `officers.py`,
`officer_service.py`, `org_chart.py`, `org_chart_service.py`,
`operational_ranks.py`, and `operational_rank_service.py` are still
**byte-identical to pass 2** under the corrected range — zero commits,
confirmed via git log — so pass 2's "Verified good" write-up for those four
files stands without re-derivation, per this rotation's own rule not to
re-read what a prior pass already settled. Future passes on any feature
should use `git log <prior-pass-merge-sha>..HEAD`, never a date, for exactly
this reason.

All four changed commits (well, three original plus the two behind
`7ac83395`) reviewed in full against the checklist:

- **`cf033864` — rename `equipment_check.*` → `inventory.check_*`.**
  Authority-preserving: `LEGACY_PERMISSION_ALIASES` is additive (old string
  stays in the granted set, so a raw-grants report still shows what's
  actually stored) and is expanded at the one choke point every permission
  check funnels through (`_collect_user_permissions` in `dependencies.py`,
  which `permission_matches` also expands defensively — redundant but
  harmless, since expansion is idempotent). The accompanying migration
  (`ff8076f4987a`) rewrites **every** `positions.permissions` row, system and
  custom alike — correctly not scoped to `is_system=1`, since a _rename_
  (unlike a grant removal) would otherwise silently drop a grant a
  department deliberately gave itself (Pitfall #23's removal-scoping rule
  doesn't apply to a pure rename). Guarded on `positions` existing per
  Pitfall #26, and confirmed as a defensive-only guard since `positions` is
  created by the migration chain (rename ancestor `20260805_0008`), matching
  the corrected understanding in Pitfall #26 itself. No permission gained or
  lost by any **seeded** rank or position — verified by diffing every
  `OPERATIONAL_RANKS` / `DEFAULT_POSITIONS` entry touched: each
  `EQUIPMENT_CHECK_*` reference was replaced 1:1 (or the wildcard 1:3) with
  its `INVENTORY_CHECK_*` equivalent, nothing added or dropped there.
  **Correction (Codex review on this PR):** that seeded-only check does not
  cover every position. A **custom** position holding the `inventory.*`
  module wildcard genuinely gains authority it did not have before this
  rename: pre-rename, `inventory.*` could not satisfy `equipment_check.*`
  (different module segment, so `permission_matches`'s wildcard rule never
  matched across them), but post-rename `inventory.check_view` /
  `check_manage` / `check_submit` live inside the `inventory.*` namespace and
  are satisfied by it. This is real and not hypothetical — but it is also not
  a new finding, because the original commit's own message names it plainly
  as "one deliberate consequence" and gives the reason it's accepted: no
  seeded rank or position uses the `inventory.*` wildcard (confirmed again
  here by grep), so it only reaches a position a department configured for
  itself, and it is a widening in the same namespace the position already
  declared broad trust in. What was wrong was this write-up's own **blanket**
  "no permission gained or lost by any rank or position" claim, which
  overstated a seeded-only check into a universal one. Narrowed above.
- **`9f6e7a7a` — allow the `member` position's display name to be edited.**
  Scoped correctly: `role_service.update_role` raises `ValueError` for any
  system position other than the `member` slug (`role.slug != "member"`),
  the slug itself is never written, and the existing permission-ceiling
  checks (`_enforce_permission_grant_ceiling` / `_enforce_role_edit_ceiling`)
  are untouched by this diff and still run unconditionally on a permissions
  change. A name-only update does not touch permissions at all, so the
  ceiling functions are irrelevant to this diff and correctly not invoked
  for that case. Org-scoped via the existing `get_role(role_id,
organization_id)` lookup. Guard tests
  (`test_member_system_position_display_name_can_change`,
  `test_other_system_position_name_update_is_rejected`) cover both the
  allowed and rejected paths.
- **`a518957e` — `get_request_enabled_modules` catches an invalid-credential
  `HTTPException` instead of letting it propagate.** Re-verified this
  doesn't weaken authentication: the function only resolves whether a
  _module_ is enabled for gating purposes, never whether the caller is
  authenticated — any endpoint requiring a real session still declares its
  own independent `Depends(get_current_user)`, unaffected by this catch.
  Confirmed by grep that `get_request_enabled_modules` is never itself used
  as an auth dependency anywhere (`require_module` only reads the resolved
  module set, not identity). The one behavior change — a caller with a
  stale/invalid session cookie who hits a token-authorized public route
  (e.g. an emailed ballot link) is now treated as anonymous for the
  module-gate check instead of getting an unrelated 401 — matches the
  scenario the commit documents (already reviewed once as a Codex follow-up
  on PR #1948; re-confirmed here since it touches a PERM-02 file).
- **`4e40f96b` + `2959d2aa` (merged via `7ac83395`) — restrict baseline
  `facilities.view` grants.** A revocation, not a grant: removes
  `FACILITIES_VIEW` from `_LEADERSHIP_VIEW_PERMISSIONS`,
  `_LINE_MEMBER_PERMISSIONS`, the relevant `OPERATIONAL_RANKS` entries, and
  `DEFAULT_POSITIONS['member']`, so operational roles stop inheriting
  organization-wide facility reads by default. A revocation can only narrow
  authority, so this dimension-2 (authorization fit) direction is safe by
  construction — the finding worth checking is whether it was applied
  completely, not whether it over-grants. It wasn't, on the first commit:
  `4e40f96b` only edited the registry, and `DEFAULT_POSITIONS` is
  materialized into `positions` rows once, at onboarding (Pitfall #23) — so
  every already-running department's stored Captain/Lieutenant/etc. rows
  kept the grant the registry no longer issues. `2959d2aa`, merged 3.5 hours
  later in the same PR, is exactly the Pitfall #23 correction: migration
  `c7e2b9a41f83` strips `facilities.view` from the five affected system
  slugs' stored rows, scoped to `is_system=True` so a department's own
  customized Captain is untouched, verified by its author against a real
  MySQL table (system rows lose the grant, a custom Captain and a
  still-granted secretary don't, re-run is a no-op). Confirmed both
  migrations (`e4f5a6b7c8d9`, `c7e2b9a41f83`) are present in the current
  chain and the chain still validates to a single head. No residual gap:
  current `grep FACILITIES_VIEW app/core/permissions.py` shows it only in
  `FACILITIES_VIEW_SENSITIVE`-adjacent leadership/management contexts, not
  back in any baseline default.

**Re-verified still present:** the ceiling machinery
(`_enforce_permission_grant_ceiling`, `_enforce_role_edit_ceiling` in
`roles.py`; `_enforce_rank_grant_ceiling` in `users.py`, wired at
`create_member`, `update_user_profile`'s rank-change branch, and — per
PERM-3/PERM-4 above — `transfer_prospect` and `update_rank`), PERM-1's
`settings.manage` gate on `GET /operational-ranks/validate`, and PERM-2's
savepoint-based `seed_defaults` race fix. All four `roles.py` route additions
since pass 1 (`/permissions`, `/permissions/by-category`, admin-access/check,
etc.) re-enumerated: 13 routes total, every by-id fetch org-scoped via
`get_role(role_id, organization_id)`, and the two routes that call
`role_service.get_user_roles`/`get_user_permissions` with a _different_
user's id (`GET /user/{user_id}/permissions`) resolve that id through an
explicit org-scoped existence check first — the two service methods
themselves take no `organization_id` parameter, which is correct only
because every call site already validated the id in-org (confirmed via grep
of every call site: the other five call `get_user_roles`/`get_user_permissions`
with `current_user.id`, which is trivially self-scoped).

**No new findings.** Nothing in this pass's checklist coverage — the four
changed commits, plus the six unchanged files' pass-2 conclusions — surfaced
an authentication, authorization, tenant-isolation, injection, exposure, or
schema/migration defect. The one accuracy issue this pass's own first draft
introduced (the blanket wildcard-authority claim, corrected above) was in
this write-up, not in application code.

**Completion gate:** no backend or frontend source file was modified this
pass (documentation only). **Correction (Codex review on this PR):** the
first draft of this section cited PR #2133 as "the baseline already
confirmed green," which was wrong — PR #2134 (7 frontend files, 372 added
lines) merged into `main` after #2133 and is this branch's actual parent
commit, and #2133's own checks say nothing about it. The commits this pass
adds are documentation-only, so this PR's own CI run — which runs against
the real current tree, #2134 included — is the correct evidence rather than
citing any prior PR: `Frontend Lint, Typecheck & Build`, `Frontend Tests`,
`Frontend E2E`, and every backend job on this PR (#2136) all completed
green. `python3 scripts/validate_migrations.py --strict` re-run directly for
the schema dimension: single head, 399 revisions, no changes. `flake8 app/
tests/ alembic/` re-run directly: 0 violations.

---

## Pass 2 (2026-08-27)

Unlike feature 01, this feature's files grew substantially since pass 1
(`git diff 33f8f8ec HEAD`, the PR #1805 merge commit): `dependencies.py` +108
net, `core/permissions.py` +240 net, `role_service.py` +270 net,
`operational_rank_service.py` +271 net, `org_chart_service.py` +450 net,
`roles.py` +50, `org_chart.py` +21, `operational_ranks.py` +3.
`officers.py`/`officer_service.py` are unchanged. Three parallel background
agents reviewed org_chart, roles/role_service, and operational_ranks against
the full diff and current file content; I reviewed `dependencies.py` and the
`core/permissions.py` registry churn directly.

### Verified good ✅ (new since pass 1)

- **`dependencies.py`'s new per-request auth/module-enablement caching**
  (`request.state.authenticated_user`, `get_request_enabled_modules`) —
  the auth cache is populated only after every rejection check in
  `get_current_user` passes, so a second resolution within the same request
  can only replay an already-granted result, never short-circuit a refusal
  into an approval. `require_module`'s pass-through for a sessionless caller
  is deliberately scoped to `get_optional_current_user`, which itself still
  fails closed on a present-but-invalid credential (delegates to the
  mandatory `get_current_user`) — only a genuinely absent credential
  resolves to `None`. Confirmed the one place this matters in practice
  (`salesforce_sync.router`'s public OAuth callback, gated by
  `module_gate("integrations", ...)`) is exactly the case the function's
  own docstring names.
- **New `EMT` rank and `_LINE_MEMBER_PERMISSIONS` extraction** — a real bug
  fix (EMT-only members previously resolved to zero default permissions,
  per the code comment referencing #1833) rather than a new gap: rank
  defaults are computed at request time by `get_rank_default_permissions()`,
  never persisted, so there is no Pitfall #23 staleness to backfill — unlike
  `firefighter`, `emt` has no mirroring `DEFAULT_POSITIONS` entry, confirmed
  by grep.
- **New `training.configure` permission**, added to several officer ranks'
  `default_permissions` and to matching `DEFAULT_POSITIONS` entries — the
  migration `20260825_1400_e3b7c25f9a41_grant_training_configure.py`
  backfills exactly the seeded rows Pitfall #23 requires, and goes further:
  it only re-grants a position that still holds the permission
  (`training.manage`) it's mirroring, so a department that already
  deliberately stripped `training.manage` from a customized position isn't
  silently re-granted the sibling capability.
- **`org_chart_service.py`'s multi-holder rework** (new `position_id`/
  `rank_code`/`holders[]` on a node) — every new client-supplied reference
  is validated in-org before persisting (`assert_in_org` for `position_id`/
  holder `user_id`, an explicit org-scoped query for `rank_code`), every new
  read path re-derives holder identity through an org-filtered query, and
  the new `MAX_HOLDERS_PER_NODE = 25` is enforced in both the schema and the
  service. New FK `position_id` is `SET NULL` + `nullable=True`. No findings.
- **`role_service.py`'s transactional-audit rework** — the ceiling
  machinery (`_enforce_permission_grant_ceiling`, `_enforce_role_edit_ceiling`)
  is byte-for-byte unchanged; the diff only makes an audit-write failure roll
  back its role mutation instead of leaving them inconsistent. One
  LOW/informational note: `set_user_roles`/`assign_role_to_user` enforce only
  the administrator-retention guard, not the grant ceiling — inert today
  (confirmed via grep: no endpoint calls either), a trap only if a future
  bulk-assignment endpoint calls them directly without its own ceiling check.

### Findings

### PERM-3 — HIGH — Prospect-to-member transfer could mint an admin via a client-supplied rank — ✅ FIXED

**What:** `POST /prospects/{id}/transfer` creates a full `User` account
(active, password set) with a client-supplied `rank`, validated only for
"is this rank configured" (`OperationalRankService.resolve_rank_code`), never
for whether the caller's own permissions cover what that rank grants.
`_enforce_rank_grant_ceiling` exists specifically to close this class —
its own docstring names the exact scenario — but was never wired into this
path.

**Where:** `backend/app/api/v1/endpoints/membership_pipeline.py`
(`transfer_prospect`, pre-fix); `backend/app/services/membership_pipeline_service.py`
(`_do_transfer`).

**Failure scenario:** the endpoint is gated on `members.manage` OR
`prospective_members.manage` — neither implies `settings.manage` or
`security.manage`. A caller holding only one of those two (e.g. a Membership
Coordinator position) transfers a prospect in with `rank="fire_chief"` in the
request body. `resolve_rank_code` confirms `fire_chief` is a configured rank
and lets it through; the new `User` row is created with that rank and a
generated password, live immediately. `get_rank_default_permissions()`
resolves rank grants purely by code string at request time, so the new
account — or the caller's own account, if they transfer themselves in as a
"prospect" — now carries `security.manage`, `users.delete`, and every other
`fire_chief` default, gained through a parallel, previously-unguarded
permission source. Exactly the escalation `_enforce_rank_grant_ceiling`'s
docstring on `users.py` describes for `create_member`, reachable through a
second, un-audited door.

**Impact:** HIGH — full tenant-admin-equivalent privilege escalation from a
comparatively low, plausibly-held permission pair, requiring only a form
submission (no code execution, no existing admin cooperation).

**Fix:** `transfer_prospect` now resolves the canonical rank and enforces
`_enforce_rank_grant_ceiling` (the same helper `create_member` and
`update_user_profile` already use) before calling the service — no
duplicated ceiling logic, one owner. The already-canonicalized rank is
passed through to the service so its own redundant resolution is a no-op.

**Guard test:** `test_transfer_prospect_calls_rank_ceiling` in
`test_privilege_ceiling_wiring.py` — source-inspects `transfer_prospect`,
asserting the ceiling call is present and appears before
`service.transfer_to_membership(...)` in source order. Verified to fail
against the pre-fix endpoint.

**Correction (Codex review on PR #1931):** the fix above still let a caller
generate a **committed CRITICAL privilege-escalation alert**
(`report_privilege_escalation_attempt` inside `_enforce_rank_grant_ceiling`
commits on denial) for a prospect id that could never have been transferred
regardless of rank — nonexistent, wrong-org, or already
`ProspectStatus.TRANSFERRED` — since the ceiling check ran before the service
resolved and validated the prospect. Not a privilege-escalation gap (the
escalation itself was still correctly blocked), but real alert-noise: a
caller could spam garbage prospect ids alongside `rank="fire_chief"` to
generate CRITICAL alerts for requests that could never succeed, degrading
the signal value of that monitoring channel. Fixed by resolving the prospect
via `service.get_prospect(...)` and checking existence + transferred-status
**before** the ceiling check — same 404/400 responses the service would
eventually have produced, just returned before the alert-generating check
runs. Guard test:
`test_transfer_unknown_prospect_does_not_report_privilege_escalation` in
`test_prospect_create_privacy.py` — patches `_enforce_rank_grant_ceiling` to
raise if called, asserts a 404 for a `get_prospect() -> None` case. Verified
to fail against the pre-correction ordering.

### PERM-4 — HIGH — Renaming a rank's code could escalate every member currently holding it — ✅ FIXED

**What:** `OperationalRankService.update_rank` bulk-rewrites
`User.rank` for every member currently holding the rank's old code when the
`rank_code` field is changed (`update(User).where(User.rank == old_rank_code)
.values(rank=new_rank_code)`), with no check on what permissions the new code
grants versus the caller's own. The endpoint requires only `settings.manage`.

**Where:** `backend/app/services/operational_rank_service.py:322-329`
(pre-fix, unchanged this pass); `backend/app/api/v1/endpoints/operational_ranks.py`
(`update_rank`, pre-fix).

**Failure scenario:** a caller holding `settings.manage` but not
`security.manage` renames any rank currently held by one or more members
(including, if applicable, themselves) — e.g. a low-privilege "Probationary"
rank — to the reserved code `fire_chief`. `get_rank_default_permissions()`
resolves by code string with no notion of "this row was renamed rather than
created", so every member who held the old code instantly carries every
`fire_chief` default permission the next time their permissions are computed.
Same underlying threat model as `_enforce_rank_grant_ceiling` protects
against, reached through a rename instead of a direct grant.

**Impact:** HIGH — same class as PERM-3, and here it retroactively escalates
every existing holder of the renamed code at once, not just one new account.

**Fix:** the endpoint now fetches the existing rank, and — only when
`rank_code` is actually changing — calls `_enforce_rank_grant_ceiling` with
the new code before invoking `service.update_rank`. A rename to an
unrecognized/custom code (the common case — most departments' ranks aren't
reserved words) resolves to `get_rank_default_permissions() == []` and
passes trivially, so this does not block ordinary rank renames.

**Guard test:** `test_update_rank_calls_rank_ceiling_before_renaming` in
`test_privilege_ceiling_wiring.py` — source-inspects `update_rank`, asserting
the ceiling call precedes `service.update_rank(...)`. Verified to fail
against the pre-fix endpoint. The existing
`test_update_endpoint_returns_renamed_rank_after_member_migration` (renaming
to a non-reserved code) continues to pass unmodified in behavior, confirming
the fix doesn't block legitimate renames — it needed only a mock-sequencing
update for the endpoint's one added `get_rank` lookup.

**Completion gate (pass 2, after the Codex correction):** flake8/black/isort
clean on `app/ tests/ alembic/`; `validate_migrations.py --strict` passed
(381 revisions, single head); scoped tests (`-k "rank or permission or role
or membership_pipeline or transfer or org_chart or officer or prospect"`)
946 passed, 2 skipped (pre-existing); full backend suite 9039 passed, 22
skipped (pre-existing), 0 failed (pre-correction baseline — the correction
itself is covered by the scoped run above). No frontend files touched.

---

## Pass 1 (2026-08-25)

**Backend:** `app/api/dependencies.py` (381 L), `app/core/permissions.py`
(1960 L), `app/api/v1/endpoints/roles.py` (691 L) +
`app/services/role_service.py` (785 L), `app/api/v1/endpoints/operational_ranks.py`
(193 L) + `app/services/operational_rank_service.py` (263 L),
`app/api/v1/endpoints/officers.py` (140 L) + `officer_service.py`,
`app/api/v1/endpoints/org_chart.py` (235 L) + `org_chart_service.py`
**Frontend:** none touched
**Migrations:** `20260824_2330_f2a91c7d6b04_add_org_chart_nodes.py`

---

## Scope

`roles.py`/`role_service.py`/`dependencies.py`/`core/permissions.py` carry an
extremely thorough privilege-escalation history: one module audit plus four
app-review passes (`docs/module-audit/orgs-roles-users.md`,
`docs/app-review/orgs-roles-users.md`), the most recent dated 2026-08-09, with
the ceiling machinery (`_enforce_permission_grant_ceiling`,
`_enforce_role_edit_ceiling`, `_enforce_rank_grant_ceiling`) re-verified
multiple times. This iteration spot-checked that machinery still exists as
described (it does, unchanged — confirmed via git log showing zero commits to
these three files since 2026-08-09) rather than re-deriving it.

`officers.py`, `org_chart.py`, and `operational_ranks.py` are new since that
last pass — added 2026-08-21 and 2026-08-24 respectively, confirmed by git log
— and carry no prior audit. These three were read in full and given full
weight against all seven checklist dimensions.

## Route inventory

**officers.py** (3 routes, all `require_permission("settings.manage",
"organization.update_settings")`, org-scoped via `current_user.organization_id`):
`GET /`, `PUT /{office_key}`, `DELETE /{office_key}`.

**org_chart.py** (5 routes):

| Method | Path               | Auth dependency      | Permission                             | Org-scoped | Notes                           |
| ------ | ------------------ | -------------------- | -------------------------------------- | ---------- | ------------------------------- |
| GET    | ``                 | `get_current_user`   | none (deliberate, docstring'd)         | yes        | published-only for non-managers |
| POST   | `/nodes`           | `require_permission` | `orgchart.manage` OR `settings.manage` | yes        | FK validated in-org             |
| PUT    | `/nodes/{id}`      | `require_permission` | same                                   | yes        | `_require_node` org-scopes      |
| POST   | `/nodes/{id}/move` | `require_permission` | same                                   | yes        | cycle + depth-cap guarded       |
| DELETE | `/nodes/{id}`      | `require_permission` | same                                   | yes        | reparents children, renumbers   |

**operational_ranks.py** (7 routes): `GET /`, `GET /{id}` are auth-only
(config-labels, low sensitivity by design); `GET /validate` requires
`settings.manage` or `members.manage` (see PERM-1). `POST /`, `PATCH /{id}`,
`DELETE /{id}` require `settings.manage` **or** `members.manage` — widened at
pass 6 so a roster officer can maintain the ladder's contents without a
`settings.manage` grant — but `PATCH /{id}`'s `sort_order` field and
`POST /reorder` stay gated to `settings.manage` alone via the route's own
`_refuse_ordering` check, independent of `require_permission`, because
`sort_order` decides which restricted inventory a rank's holders may see (see
Pass 6/7 below and `operational_ranks.py:52-69`). **Corrected at pass 9** —
this paragraph previously read `settings.manage` only for all four mutating
routes, stale since the pass 6 widening.

## Verified good ✅

- **Ceiling machinery unchanged and intact.** `_enforce_permission_grant_ceiling`
  / `_enforce_role_edit_ceiling` (`roles.py:51,87`, call sites at 231/318/333/464)
  and `_enforce_rank_grant_ceiling` (`users.py:677,713`, wired at `create_member`
  and the rank-change branch of `update_user_profile`) are present exactly as
  the prior passes describe — zero commits touched `roles.py`, `role_service.py`,
  or `dependencies.py` since the 2026-08-09 pass (git log confirmed).
  `_collect_user_permissions` (`dependencies.py:52-69`) still unions position
  and operational-rank-default permissions verbatim.
- **officers.py — XC-1/XC-3 clean.** `set_officer` validates the client-supplied
  `user_id` belongs to the org before storing it (`officer_service.py:336-344`);
  `organization_officers.user_id` is `ondelete="SET NULL"` + `nullable=True`
  (Pitfall #2 compliant, `models/organization_officer.py:47-49`). JSON mutation
  uses `copy.deepcopy()` before reassigning `organization.settings`
  (`officer_service.py:315-317`) — Pitfall #12 compliant. The `settings.manage`
  / `organization.update_settings` OR-gate is not seeded to `member` or
  `firefighter`.
- **org_chart.py — XC-1/XC-3 clean, and DoS-hardened.** Every by-id fetch goes
  through `_get_node`/`_require_node`, which filters `organization_id`
  (`org_chart_service.py:53-69`); both client-supplied FKs (`parent_id`,
  `user_id`) are validated in-org via `assert_in_org` before create/update/move
  (`org_chart_service.py:159-181,262-264,299-302,333-340`). `orgchart.manage`
  is seeded only to the `fire_chief` rank and its mirroring position, not to
  `member`/`firefighter`. **Cycle prevention is real and layered**: `move_node`
  rejects `parent_id == node_id` and checks `_is_descendant` before
  re-parenting; `_is_descendant` treats a pre-existing loop as "is a
  descendant" (fails safe) rather than looping forever
  (`org_chart_service.py:341-346,419-437`); both `_depth_of` and the chart-walk
  cap at `MAX_DEPTH=8` with a `visited` set, so even a row written outside the
  service degrades rather than hanging a request
  (`org_chart_service.py:123-137,204-220`); `MAX_NODES=500` bounds tree size.
  Migration `f2a91c7d6b04` correctly guards its `positions`-table backfill on
  the table's existence (Pitfall #26) and all three new FKs are
  `ondelete="SET NULL"` + `nullable=True` (Pitfall #2). This surface already
  went through its own PR review (`cc58cfcf`, 2026-08-25) that fixed 5 issues
  before this pass — verified those fixes are present in the code read here
  (deleted-member filter, both-sides renumber on delete, required-but-nullable
  `parent_id` schema, and a move-audit trail).
- **operational_ranks.py — XC-3 clean, no XC-1 surface** (no FK besides
  `organization_id` itself). Confirmed the per-org `operational_ranks` DB table
  (labels + eligible positions, no permissions column) is a distinct concept
  from the static `OPERATIONAL_RANKS` catalog in `core/permissions.py` that
  `get_rank_default_permissions()` reads by `User.rank` string — CRUD here
  cannot be used to bypass the `_enforce_rank_grant_ceiling` machinery, since an
  unrecognized `rank_code` resolves to `[]` permissions.
- **No injection surface anywhere in the 6 files** — zero raw SQL, zero
  `.like()`/`.ilike()` (grep-confirmed), no CSV export.
- **No unbounded in-memory caches** (Pitfall #9 n/a — none of these 6 files
  define one).

## Findings

### PERM-1 — LOW — `GET /operational-ranks/validate` had no permission gate matching the screen it backs — ✅ FIXED

**What:** the route depended on `get_current_user` only, while its four CRUD
siblings in the same router (`POST`, `PATCH`, `DELETE`, `/reorder`) all require
`settings.manage`.

**Where:** `app/api/v1/endpoints/operational_ranks.py:92-107` (pre-fix).

**Failure scenario:** the only frontend caller is `SettingsPage`'s rank
section, and that page's route is gated `requiredPermission="settings.manage"`
(`frontend/src/modules/settings/routes.tsx:38`) — but that gate is
client-side only. Any authenticated member (any position, any rank) could call
`GET /operational-ranks/validate` directly and receive the name and current
(misconfigured) rank code of every active member whose rank doesn't match a
configured code for the org — a diagnostic/admin-facing list with no
`settings.manage` or `members.view` check enforced server-side.

**Impact:** LOW — the disclosed data is a member name plus a rank-code
mismatch flag (roster names are already broadly visible in this app per the
2026-08-04 ORU-8 PII-gate work), but it is still admin diagnostic tooling
leaking past its intended audience via a missing server-side check — exactly
the client-side-only gate pattern the checklist's dimension 2 flags.

**Fix:** changed the dependency to `require_permission("settings.manage")`,
matching its siblings and the frontend's actual (gated) usage. No legitimate
caller is affected — the only caller already requires that permission to reach
the page that calls it.

**Guard test:** `TestValidateRouteGate::test_validate_route_requires_settings_manage`
in `tests/test_operational_rank_service.py` — inspects the route's `Depends`
default and asserts `settings.manage` is in `required_permissions`, following
the existing pattern in `tests/test_read_permission_gates.py`.

### PERM-2 — LOW — `seed_defaults` had a narrow concurrent-first-load race that surfaced as an uncaught 500 — ✅ FIXED

**What:** `OperationalRankService.seed_defaults` checked `count == 0` then
inserted the 8 default ranks with no lock or exception handling around the
insert.

**Where:** `app/services/operational_rank_service.py:73-102` (pre-fix).

**Failure scenario:** two concurrent first-loads of a brand-new organization's
rank list (e.g., two admins opening Settings at once right after onboarding)
can both pass the `count == 0` check before either commits. The
`UniqueConstraint("organization_id", "rank_code")` prevents duplicate rows, but
the losing request's `flush()` then raised an unhandled `IntegrityError`,
surfacing to the caller as a generic 500 instead of the ranks simply loading
(which is what happens on every subsequent request once seeded). Not
exploitable for privilege gain — a narrow reliability defect, not a tenant- or
permission-boundary issue.

**Fix (revised after review):** the losing insert now runs inside a SAVEPOINT
(`async with self.db.begin_nested():`), and only that savepoint is rolled back
on `IntegrityError`, returning `[]` (the same value as the existing
skip-when-ranks-exist branch). **The first version of this fix called a plain
`self.db.rollback()`, which was itself a regression** — caught by an automated
Codex review comment on the PR before merge. Verified empirically against a
real MariaDB connection (not just by reasoning about it): a full-session
`rollback()` expires every object in the request's identity map
(`SessionTransaction._restore_snapshot(dirty_only=False)` in SQLAlchemy's
source), including `current_user`, loaded earlier by `get_current_user` on the
same request-scoped session. The endpoint's next access to
`current_user.organization_id` (to call `list_ranks` right after
`seed_defaults` returns) would then need an implicit refresh outside the async
greenlet context and raise `MissingGreenlet` — reproduced directly against a
real DB connection: the plain-rollback path raised
`MissingGreenlet("greenlet_spawn has not been called...")` on the next
attribute access, while the savepoint path did not. This is the same bug class
as the `reopen_event_attendance` 500 (CHANGELOG 2026-08-25) — a lazy
attribute/relationship load outside the greenlet context. A SAVEPOINT rollback
only expires objects modified within it (`dirty_only=True` in the same
SQLAlchemy method), leaving `current_user` untouched.

**Guard tests:**
`TestSeedDefaults::test_concurrent_first_seed_rolls_back_instead_of_500` —
forces `db.flush` to raise `IntegrityError` and asserts `[]` instead of the
exception propagating.
`TestSeedDefaults::test_concurrent_first_seed_uses_savepoint_not_full_rollback`
— asserts `begin_nested()` was used and the full-session `rollback()` was
**not** called, so a regression back to the plain-rollback form fails this
test even though the mock-level behavior of the first test alone couldn't
distinguish the two (mocks don't model SQLAlchemy's real expiration
semantics — this is why the fix was verified against a real DB connection
before being written up here, not just left to the mocked test suite).

## Schema & migration notes

`organization_officers.user_id` and all three new `org_chart_nodes` FKs
(`parent_id`, `user_id`, `updated_by`) are `ondelete="SET NULL"` +
`nullable=True` — Pitfall #2 compliant. `operational_ranks.organization_id` is
`ondelete="CASCADE"` + `nullable=False` — correct, CASCADE doesn't require
nullable. Migration `f2a91c7d6b04` guards its `positions`-table backfill and
its own `org_chart_nodes` creation on table existence — Pitfall #26 compliant.
No drift found between any of these 6 files' models and their migrations.

## Guard tests added

- `test_validate_route_requires_settings_manage` — fails if `GET /validate`
  ever loses its permission gate.
- `test_concurrent_first_seed_rolls_back_instead_of_500` — fails if the
  IntegrityError handling regresses.

## Completion gate

| Check                                                          | Result                                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                  | ✅ 0 violations                                                                                                         |
| `black --check app/ tests/ alembic/`                           | ✅ unchanged                                                                                                            |
| `isort --check-only app/ tests/ alembic/`                      | ✅ clean                                                                                                                |
| `validate_migrations.py --strict`                              | ✅ single head                                                                                                          |
| backend tests (scoped: rank/permission/role/officer/org_chart) | ✅ 489 passed, 3 skipped (environment-only: py_vapid not installed, 2 schema tests needing tables outside this feature) |
| `tsc --noEmit`                                                 | ✅ 0 errors (no frontend files touched)                                                                                 |
| `eslint .`                                                     | n/a — no frontend files touched                                                                                         |
