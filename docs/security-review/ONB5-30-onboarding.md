# Security Review — Feature 30: Onboarding (passes 7–13)

**Prefix:** `ONB5` · **Rotation pass:** 13 (prior: module-audit iteration 25,
app-review B25 (4 passes), security-review pass 1 — PR #1913 + follow-up
(`docs/security-review/ONB2-30-onboarding.md`), pass 2 — PR #2093
(`docs/security-review/ONB-30-onboarding.md`), passes 3–5 — PRs #2358, #2521,
#2898 (`docs/security-review/ONB3-30-onboarding.md`), pass 6 — PR #2996,
pass 7 — PR #3381, pass 8 — PR #3517 (both `docs/security-review/ONB4-30-onboarding.md`
and this file), pass 9 — PR #3658 + recovery PR #3686 (ONB6-30-1/2/3, both this
file), pass 10 — PR #3785, pass 11 — PR #3856, pass 12 — PR #4003) ·
**Reviewed:** 2026-10-17 (pass 7), 2026-10-21 (pass 8), 2026-10-24 (pass 9,
watchdog pickup), 2026-10-25 (pass 9 recovery), 2026-10-27 (pass 10, watchdog
pickup), 2026-10-30 (pass 11, watchdog pickup), 2026-11-04 (pass 12, watchdog
pickup), 2026-11-11 (pass 13, this PR)

**Backend (pass 13):** `backend/app/api/v1/onboarding.py` (3,295 L, **26**
unauthenticated bootstrap routes — unchanged count and auth posture from
passes 7–12, re-enumerated by AST this pass, not carried forward),
`backend/app/services/onboarding.py`, `backend/app/models/onboarding.py`,
`backend/app/utils/onboarding_security.py`,
`backend/app/api/v1/email_test_helper.py`. Touched this pass, in scope only
because the diff passes through onboarding's own route/service code: the new
`app.services.s3_storage` import and its `endpoint_allowed`/
`ENDPOINT_NOT_ALLOWED` symbols (read in full), `app.models.member_position_term`'s
`close_terms_for_positions` (read in full),
`app.services.location_service`'s `release_location_references` and
`save_system_named_location` (read in full), `app.services.grant_federal_programs`'s
`seed_federal_program_opportunities` (read in full),
`backend/app/schemas/organization.py` (diffed in full against pass 12's
baseline; the only onboarding-relevant symbol, `FileStorageStatusResponse`,
gained a field — `allowed_s3_endpoints` — that is read only by the
authenticated settings endpoint, never by onboarding's own persist function;
every other change in that file's diff is Finance/Minutes/Membership-tier
schema work from unrelated features that merely shares the file).
**Frontend (pass 13):** `frontend/src/modules/onboarding/` — new this pass:
`components/ExpiredSessionBanner.tsx` (read in full); diffed and read at each
changed line: `components/OnboardingGate.tsx`, `config/moduleRegistry.ts`,
`config/seededPositionGrants.ts`, `pages/FileStorageConfiguration.tsx`.
**Migrations:** none owned by this feature in this pass's window (last
onboarding-owned migration remains
`20261009_1045_7e1a3c94d2b6_add_encryption_key_custody.py`, pass 7); the
`public_info`-defaults backfill (`20261103_2316_289504a34d3c`, noted as
pending at pass 12) is confirmed merged and unchanged.

---

## Pass 13 (2026-11-11) — dedicated rotation session, 0 fixed, 0 new findings; five independent cross-feature touches verified good

**Step 0.** `list_pull_requests` (state=open) returned no PR whose head
branch starts with `claude/security-review-`. PR #4238 (Feature 29, Reports &
analytics, pass 15) had already merged (`413ab36e6`). Row 30 (Onboarding) was
the first `⬜` in the rotation table on a freshly-pulled `main`.

**Scope check.** Pass 12 landed as PR #4003, merge commit `4c52bfee2`.
`git diff --stat 4c52bfee2..HEAD`, restricted to this feature's full declared
file list (backend + frontend, as pass 7–12 defined it), found a real diff in
exactly two backend files (`onboarding.py`: 32 lines; `services/onboarding.py`:
129 lines) plus a 114-line diff in the shared `schemas/organization.py`, and a
7-file frontend diff under `modules/onboarding/`. Every other declared file
(`models/onboarding.py`, `utils/onboarding_security.py`,
`email_test_helper.py`, `email_providers.py`, `microsoft_oauth.py`,
`template_service.py`, `org_template_service.py`, `org_template_registry.py`,
`key_custody_service.py`, `system_notices.py` and its endpoint/schema,
`upload_scanning.py`, `google_drive_storage.py`) is byte-identical since pass 12.

All of the real deltas trace to five already-merged, independent engineering
commits (none from this security-review rotation), each re-verified against
its security properties:

- **S3 endpoint allowlisted at onboarding save time
  (`onboarding.py:2051-2063`, `save_file_storage_config`).** A new check
  rejects a submitted `s3EndpointUrl` that is not exactly one of the
  operator's `S3_ALLOWED_ENDPOINTS` entries (`s3_storage.endpoint_allowed`),
  mirroring `organization_service.py`'s `_refuse_unlisted_s3_endpoint` for
  the authenticated Settings screen — same function, same error message
  (`s3_storage.ENDPOINT_NOT_ALLOWED`), same owner decision (2026-11-01).
  Read `s3_storage.py` in full: the allowlist check alone (not the full
  `check_endpoint` SSRF/private-address guard) is deliberate at save time —
  by design the stricter check runs again, every time, wherever a client is
  actually built (`file_storage_service`'s short-lived config cache), which
  is what the module's own docstring states and is unchanged by this diff.
  Onboarding's check is therefore consistent with the one place this control
  already existed, not a new or weaker mechanism. The route still refuses
  once onboarding is complete (`needs_onboarding()`, ONB-3's guard,
  unaffected). **Verified good, no finding.**
- **A bulk role delete now closes open position terms first
  (`onboarding.py:2844,2861-2869`, `save_session_roles`).** Landed by the
  "Members: keep a dated history of positions held" feature. A bulk
  `DELETE` bypasses the ORM's before-flush hook that normally closes a
  deleted position's open `MemberPositionTerm` rows, which would otherwise
  leave a dangling-but-FK'd term; `close_terms_for_positions` is now called,
  scoped to the same `Role.organization_id == organization_id,
Role.is_system.is_(False)` predicate as the delete it precedes. Read
  `close_terms_for_positions` in full (`models/member_position_term.py:235-248`):
  a plain `UPDATE ... SET ended_at = now()` filtered to the given position
  ids and `ended_at IS NULL` — no new by-id query, no new write path, and
  the ids come from a `select(Role.id)` already filtered to this
  organization. **Verified good, no finding** — a correctness/data-integrity
  fix with no security dimension specific to this feature.
- **Reset now releases the wider set of location references before
  deleting `Location`, not just `Facility`/`users`
  (`onboarding.py:3204-3209`, `reset_onboarding`).** Other features since
  pass 12 added `ON DELETE RESTRICT` foreign keys from events, training
  history, meetings, requests and apparatus to `locations`; without this,
  `/reset` would FK-fail on any install where one of those rows existed,
  reproducing the exact un-resettable-instance shape ONB-1 fixed in 2026 for
  `Location.created_by`. `release_location_references` (read in full,
  `location_service.py:196-220`) clears nullable FK columns and deletes rows
  on NOT NULL ones, is called with no organization filter, which is correct
  here and not a tenant-isolation gap: reset is a whole-database wipe
  (single-department model), and the call sits immediately before an
  equally unfiltered `delete(Location)` that has had no org filter since
  this route was first written. **Verified good, no finding** — closes a
  latent robustness gap the same way ONB-1 did, before it could be hit.
- **`public_info` moved into the wizard's asked-about module set
  (`services/onboarding.py:85-88,106,152-200`, `ONBOARDING_OFFERED_MODULES`
  and `modules_from_setup_answers`).** Completes the W01-24 owner decision
  pass 12 described as already landed for the _write_ side
  (the backfill migration and the shared-helper dedup); this commit is the
  _ask_ side — the Modules step now actually offers Public Information, so
  an explicit "no" during setup is a real no rather than the
  "never asked → silently stored off" bug the backfill migration exists to
  undo for pre-existing installs. Re-read `modules_from_setup_answers`'s new
  three-way logic (named → on; asked-about-and-not-named → off;
  never-asked → the schema default) against its own docstring: internally
  consistent, and the one shared helper every writer
  (`configure_modules`, the completion-time persist, and
  `OrganizationService`'s legacy-record builder) still goes through.
  **Verified good, not a security finding** — correctness completion of an
  already-reviewed decision.
- **New-org creation now seeds the department's own Federal Programs grant
  opportunities (`services/onboarding.py:766-768`,
  `seed_federal_program_opportunities`).** Read in full
  (`grant_federal_programs.py:79-104`): writes `GrantOpportunity` rows
  stamped with the caller's `organization_id` (the newly-created org, not
  client input), is idempotent (checks what the org already holds before
  inserting — "a second call adds none", satisfying Pitfall #36 even though
  the single-org-creation guard (ONB-2) already makes a second call
  unreachable in practice), and introduces no new query shape or by-id
  lookup. **Verified good, no finding.** Same pass, the HQ facility's
  station `Location` and `_update_station`'s facility/location replacement
  now route through `save_system_named_location`/`LocationService.remove_location`
  instead of a bare insert/delete (LOC-41, de-duplicate-by-name and
  deactivate-instead-of-RESTRICT-violating-delete) — both read in full,
  both take `organization_id` from the already-established org context, no
  client-supplied id reaches either. **Verified good, no finding.**

**Frontend.** The 7-file diff is almost entirely the same W01-24 module-ask
work (`moduleRegistry.ts`'s new `public_info` entry, `seededPositionGrants.ts`'s
`mobile` → `public_info` rename, `FileStorageConfiguration.tsx`'s help-text
update for the new endpoint allowlist) plus one new component,
`ExpiredSessionBanner.tsx` (76 L, read in full): a presentational banner that
reads `apiClient.hasSession()` (itself backed by tab-scoped `sessionStorage`,
unchanged) and the onboarding Zustand store's already-local `departmentName`
— no network call, no new storage write, no secret or session-identifying
value rendered. `OnboardingGate.tsx`'s only change is mounting this banner
alongside its existing children. **Verified good, no finding.**

**Route inventory re-enumerated by AST from source** (not carried forward):
walked every `@router.{get,post,put,patch,delete}` decorator in
`onboarding.py` directly — **26 routes**, identical method/path/function set
and auth-dependency shape (`validate_session`/`needs_onboarding`/
`_require_owner_authority`/rate-limit dependency, checked per route) to
passes 7–12. No route gained, lost, or changed its auth posture.
`check_route_permissions.py --strict`: 305 routes repo-wide, 0
errors/warnings (grew from 298 at pass 12 — other features' new routes, not
this one's).

**Re-verified directly against current code (no diff in these mechanisms
this pass), not re-cited from pass 12:**

- `GET /session/key-custody` (no `needs_onboarding()` guard) and
  `GET /session/data` (same) — re-read in full. Both remain read-only and
  return only non-sensitive derived data (an HMAC key fingerprint and a
  confirmation boolean/timestamp; department info the caller itself
  submitted, plus `platform`/`configured`/count fields for the sensitive
  sections — never a password, API key, or OAuth secret), the same
  established, explicitly-reviewed shape as pass 7's table. Unchanged.
- Session tokens, CSRF comparison (`secrets.compare_digest`), and the
  30-minute sliding / 24-hour hard expiry — unchanged, re-read.
- `_require_owner_authority` and the completed/half-provisioned guards on
  `/start` and `/reset` — unchanged, re-read.
- The `/session/*` routes' per-field size caps (roles/positions 200,
  stations 50, apparatus 100) rather than a per-route rate limiter remain
  the documented, accepted design.

**Still OPEN (by design), unchanged:** **ONB-7** (no numeric rate cap
specifically on `/session/roles` beyond the 200-item size cap — the
session-minting rate limit on `/start` remains the accepted mitigation,
re-stood at passes 2–12). `ITTeamMemberRequest.email` (`onboarding.py:511`)
is still `str`, not `EmailStr` (intentionally loose, to match
`create_it_team_users`'s skip-if-invalid behavior).

**0 new findings.**

**Minor documentation correction, not a finding:** pass 12's own scope note
listed `backend/app/utils/upload_scanning.py`; the module actually lives at
`backend/app/services/upload_scanning.py`. Corrected in this pass's header
above.

### Completion gate (pass 13)

| Check                                                                                                                                                                                                 | Result                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)                                                                                                                                        | ✅ 0 violations                                |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned)                                                                                                                               | ✅ clean, 3,115 files unchanged                |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned)                                                                                                                            | ✅ clean                                       |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                                                                  | ✅ 757 revisions, single head `09f0171ccf5e`   |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                 | ✅ 305 routes, 0 errors/warnings               |
| `pytest tests/ -q -k "onboard or org_template or template_service or key_custody or system_notices or gmail_service_account or email_provider or encrypt_email or position_kind or position_seeding"` | ✅ 724 passed, 1 skipped (pywebpush, env-only) |
| `cd frontend && npm run typecheck`                                                                                                                                                                    | ✅ 0 errors                                    |
| `cd frontend && npm run lint` (`--max-warnings 10`)                                                                                                                                                   | ✅ 0 errors/warnings                           |
| `npx vitest run src/modules/onboarding`                                                                                                                                                               | ✅ 509 passed (44 files)                       |

No `KNOWN_LIMITATIONS.md` change needed — nothing this pass contradicts an
existing entry. Rotation row 30 → ✅ (pending this PR's merge). Next: Feature
31 (Scheduled tasks) — unless a later watchdog pass already advanced further;
check `list_pull_requests` fresh rather than trusting this note.

---

## Pass 12 (2026-11-04) — watchdog pickup, 0 fixed, 0 new findings; three independent correctness fixes re-verified against their security properties

**Step 0.** The dedicated loop session for this rotation
(`session_011T1ZyyLrD5HagusgK9uDw2`) has been unreachable across many
consecutive cycles (confirmed via `ListAgents`, "No reachable agents").
A GitHub search for `is:pr is:open head:claude/security-review` returned
zero results. PR #4001 (Feature 29, Reports & analytics, pass 14) had
already merged. Row 30 (Onboarding) was the first `⬜` in the rotation
table on a freshly-pulled `main`.

**Scope check.** Pass 11's own review landed as PR #3856, merged `6bf6ba32`.
`git diff --stat 6bf6ba32..HEAD`, restricted to this feature's full declared
file list (backend + frontend), found a real diff in three backend files
(`onboarding.py`, `services/onboarding.py`, `schemas/organization.py`) and a
large frontend diff (37 files, mostly new tests and wording/accessibility
copy) under `modules/onboarding/`. Every other declared file
(`models/onboarding.py`, `utils/onboarding_security.py`,
`email_test_helper.py`, `email_providers.py`, `microsoft_oauth.py`,
`template_service.py`, `org_template_service.py`,
`org_template_registry.py`, `key_custody_service.py`, `system_notices.py`
and its endpoint/schema, `upload_scanning.py`, `google_drive_storage.py`) is
byte-identical.

All three real backend deltas trace to already-merged, independent
engineering commits (a workflow-review pass, W01, and a direct fix), not to
this security-review rotation — each re-verified against its security
properties rather than re-derived from scratch:

- **`_lock_session_for_step` (`onboarding.py:2150-2168`), landed by
  `f4634e2fe` ("serialize a resubmitted stations/apparatus step", ONB2-3).**
  Closes a TOCTOU-shaped race this rotation flagged at pass 2 (`ONB2-3`,
  carried OPEN through passes 3–11 without being re-stated as a fresh
  finding each time — a gap in this document's own bookkeeping, corrected
  now by closing it below): `save_session_stations` and
  `save_session_apparatus` each read the session's previously-created
  row ids, delete them, and insert new ones to represent "replace what this
  step created last time." Two concurrent submissions of the same step
  (a double-tap, or a client retry of a POST that timed out after the
  server had already processed it) both read the same stale id list before
  either writes, so the first writer's rows become orphaned and
  unreachable by any later step. The fix takes `FOR UPDATE` locks, in the
  documented order (the `OnboardingStatus` row first, matching every other
  step's lock order, then a locking refresh of the session row), before
  the id read — serializing the two submissions rather than letting them
  interleave. Read in full; matches the Pitfall #27-shaped "read-then-write
  needs the row locked, and the read itself needs to be a locking read"
  pattern this CLAUDE.md documents elsewhere. **Verified good — closes
  ONB2-3 (below), not a new finding.**
- **`modules_from_setup_answers` (`services/onboarding.py:153-174`), landed
  by `510058d31` ("leave Public Information on by default when setup
  completes", W01-24) and consumed identically by both of this function's
  former duplicate implementations (`configure_modules` and
  `_persist_session_data_to_org`).** Not a security defect — a correctness
  bug with a privacy-adjacent consequence worth tracing: the wizard's
  Modules step only asks about `ONBOARDING_CORE_MODULES ∪
ONBOARDING_OFFERED_MODULES`; every other `ModuleSettings` key (Public
  Information, Finance, Medical Screening, …) is settings-only and has its
  own declared default. The old code mapped the _submitted_ enabled-list
  into every configurable key, writing `False` for a key nobody was asked
  about — turning "the wizard never asked" into "the department said no",
  which silently turned Public Information off on every fresh install
  despite its schema default being `True`. A migration
  (`20261103_2316_289504a34d3c_backfill_public_info_on_where_setup_...py`)
  backfills existing installs that already ran setup before the fix,
  settling rows already affected rather than only fixing new ones
  (CLAUDE.md Pitfall #35) — confirmed present and the sole migration in
  this window via `validate_migrations.py --strict` (single head). The new
  shared helper is called from both of the two places that used to
  duplicate this logic by hand, closing the drift between them. **Verified
  good, not a security finding — correctness fix with its own backfill,
  re-confirmed from both call sites.**
- **Mobile App Access retirement (`services/onboarding.py`'s
  `ONBOARDING_RETIRED_MODULES`, `schemas/organization.py`,
  `moduleRegistry.ts`), landed by `b70115e00` (W01-23).** The module toggle
  gated nothing — the PWA installs and works on a phone whether the switch
  is on or off — so setup and Settings → Modules both offered a control
  with no effect. The id stays in `ONBOARDING_ACCEPTED_MODULE_IDS` (so a
  setup session saved before this change still validates) and the
  `ModuleSettings.mobile` field is untouched (so stored settings and the
  `/organization/settings` API response shape are unchanged) — only the
  wizard's offered-module list and the Settings UI card are removed.
  **Verified good, not a security finding — no access-control surface
  removed, since none existed.**

**Re-verified directly against current code (no diff in these mechanisms
this pass), not re-cited from pass 11:**

- **Session tokens, CSRF comparison, and expiry — unchanged, re-read.**
  `secrets.token_urlsafe(32)` mints the session id and CSRF token;
  `secrets.compare_digest` compares the CSRF token; 30-minute sliding / 24-hour
  hard expiry on `validate_session`.
- **`_require_owner_authority` and the completed/half-provisioned guards on
  `/start` and `/reset` — unchanged, re-read.** `/start` refuses outright if
  `needs_onboarding()` is already false; `_require_owner_authority` refuses
  any caller not authenticated as the exact System-Owner-graded user, so a
  still-valid onboarding session alone cannot replay into an already-claimed
  install.
- **`/session/*` routes' reliance on `validate_session` plus per-field size
  caps, rather than a per-route rate limiter, remains the documented design**
  (re-confirmed at passes 2–11; the session id itself can only be minted by
  the rate-limited `/start`).

**Route inventory re-enumerated by AST from source** (not carried forward):
walked every `@router.{get,post,put,patch,delete}` decorator in
`onboarding.py` directly — **26 routes**, identical method/path/function set
to passes 7–11. No route gained, lost, or changed its auth posture.
`check_route_permissions.py --strict`: 298 routes, 0 errors/warnings
(repo-wide, unchanged in shape).

**Frontend.** The 37-file frontend diff is almost entirely new tests plus
wording/accessibility copy from the same W01 workflow-review pass (Entra ID
naming, Public Information/Custom Forms/Mobile wording, touch-target sizing,
`aria-describedby` additions). Swept the full diff for
`localStorage`/`sessionStorage`, `window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, `eval(`, and raw `Authorization` header usage:
zero hits (one false-positive match on the pre-existing
"NOT sessionStorage!" code comment, and one on a form field literally named
`localStoragePath`, a server-config string, not a browser API call). Two
files read in full for being the most security-adjacent:

- **`AdminUserCreation.tsx`** — diff is accessibility-only
  (`aria-describedby`, touch-target classes, a help string for the
  member-number field). The password submission path itself (still posts
  directly to the server, never to any client-side storage) is untouched.
- **`SetupComplete.tsx`** — adds a `GET /api/v1/auth/oauth-config` call via a
  bare `axios.get`, to report whether the chosen SSO provider's server-side
  credentials are actually configured (so the summary screen doesn't claim
  "Google" when the server has no Google OAuth client set up and members are
  still on passwords). Confirmed this is the same pre-existing **public**,
  unauthenticated endpoint (`auth.py:382`, `get_oauth_config`) the sign-in
  page itself already calls before any session exists — a read-only boolean
  flag lookup, no cookie/CSRF needed, no new backend surface. Using a bare
  `axios.get` instead of a configured instance is fine here specifically
  because the endpoint is intentionally public and side-effect-free; this is
  not the module-axios-needs-auth-interceptor case (CLAUDE.md Pitfall #7),
  which applies to authenticated calls. **Verified good, not a finding.**

## Findings — bookkeeping correction

**ONB2-3 is now ✅ FIXED, not OPEN.** It was opened at pass 2
(`docs/security-review/ONB-30-onboarding.md`) as a flagged race on the
stations/apparatus replace-on-resubmit path, and `f4634e2fe` fixed it
(independently of this rotation, dated before pass 10) with the
`_lock_session_for_step` locking described above. Passes 10 and 11's
"re-verify every prior finding" language did not explicitly call this one
out by id, so this document is the first to state its disposition plainly:
**FIXED**, verified by re-reading the lock order and confirming the fix is
still present and unchanged in the current diff.

**Still OPEN (by design), unchanged:** **ONB-7** (no documented numeric rate
cap specifically on `/session/roles` beyond the existing count cap — the
session-minting rate limit on `/start` is the accepted mitigation, re-stood
at passes 2–11). `ITTeamMemberRequest.email` (`onboarding.py:509`) is still
`str`, not `EmailStr` (intentionally loose, to match
`create_it_team_users`'s skip-if-invalid behavior).

**0 new findings.**

### Completion gate (pass 12)

| Check                                                                                                                                                                                                 | Result                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)                                                                                                                                        | ✅ 0 violations                                |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned)                                                                                                                               | ✅ clean, 2,872 files unchanged                |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned)                                                                                                                            | ✅ clean                                       |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                                                                  | ✅ 711 revisions, single head `289504a34d3c`   |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                 | ✅ 298 routes, 0 errors/warnings               |
| `pytest tests/ -q -k "onboard or org_template or template_service or key_custody or system_notices or gmail_service_account or email_provider or encrypt_email or position_kind or position_seeding"` | ✅ 711 passed, 1 skipped (pywebpush, env-only) |
| `cd frontend && npm run typecheck`                                                                                                                                                                    | ✅ 0 errors                                    |
| `cd frontend && npm run lint` (`--max-warnings 10`)                                                                                                                                                   | ✅ 0 errors/warnings                           |
| `npx vitest run src/modules/onboarding`                                                                                                                                                               | ✅ 504 passed (43 files)                       |

Rotation row 30 → ✅ (pending this PR's merge). Next: Feature 31 (Scheduled
tasks) — unless a later watchdog pass already advanced further; check
`gh api search/issues`/`list_pull_requests` fresh rather than trusting this
note.

---

## Pass 11 (2026-10-30) — watchdog pickup, 0 fixed, 0 new findings

**Step 0.** The dedicated loop session for this rotation
(`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable (confirmed via
`ListAgents`, "No reachable agents"). `search_pull_requests` for
`head:claude/security-review-` returned zero open results, both before
starting and again right before this push. PR #3855 (Feature 29, Reports &
analytics, pass 13) had already merged (`37270a94`). Row 30 (Onboarding) was
the first `⬜` in the rotation table on a freshly-pulled `main`.

**Scope check.** Pass 10's own review landed as PR #3785, merged `eb3e1a50`.
`git log eb3e1a50..HEAD`, restricted to this feature's full declared file
list (backend + frontend, as pass 7–10 defined it), found exactly two
commits with any touch on an in-scope file:

- **`4bff9d6d`** ("a position is an office, a committee or the platform's
  own") — a different rotation feature's (Permissions & roles) change, whose
  diff passes through two of this feature's own files because the onboarding
  wizard mints positions through the same code the authenticated app does.
  `onboarding.py:save_session_roles` now tags each newly-created role with
  `kind=position_kind_for(role_data.id)`; `services/onboarding.py`'s seed
  path mirrors it with `role_data.get("kind", "office")`. Read
  `position_kind_for` (`core/permissions.py:2859-2868`) in full: it is a pure
  lookup against the fixed `DEFAULT_POSITIONS` dict and the fixed
  `SYSTEM_POSITION_SLUGS` set, gated by `definition.get("kind") in
POSITION_KINDS`, and falls back to the literal `"office"` for any slug it
  doesn't recognize — so a client-supplied `role_data.id` from the onboarding
  wizard's unauthenticated payload cannot make this function return anything
  outside the fixed three-value enum, whatever string is submitted. No
  injection, escalation, or new by-id query. The matching frontend file
  (`modules/onboarding/pages/positionTemplates.ts`) only adds the four new
  committee template entries' own `kind: 'committee'` literal — no new logic.
  **Verified good, no finding.**
- **`b4d9388a`** ("Cap the refusals that join a list from data") — the same
  repo-wide error-message-length sweep already reviewed as "already
  correct" by three other features this rotation (Meetings & minutes,
  Messaging & notifications, Forms). This feature's slice is
  `configure_modules`'s `invalid_modules` `ValueError` in
  `services/onboarding.py:1510-1514`, now built with
  `list_within_detail_limit` instead of a bare `', '.join(...)`. The message
  still passes through `safe_error_detail()` unchanged on its way to the
  client; no new user-controlled input reaches it (`invalid_modules` is
  computed from the client's own submitted `enabled_modules` list against a
  fixed `available_modules` set, same as before). **Verified good, no
  finding.**

A third commit (`90925caa`) touches only
`modules/onboarding/config/seededPositionGrants.ts`, a generated
test-fixture-adjacent config file regenerated to include the four new
committee slugs — no runtime code, confirmed by reading the diff (60 lines,
all data entries matching the shape of the existing ones).

**Everything else in the window** (`61576727`, the bundle-splitting/
lazy-loading sweep) touches `frontend/src/modules/onboarding/routes.tsx`
only to convert eager page imports to `lazyWithRetry(() => import(...))` —
read the diff in full: the same eighteen pages, the same `gated()` wrapper
applied below (unchanged by this diff), no route added, removed, or
re-ordered, and no auth/guard logic touched. Purely a performance change
(first-load bundle size), consistent with the identical pattern CLAUDE.md
documents for every other module's `routes.tsx`.

**Onboarding's own three files most central to the bootstrap-security
model — `onboarding.py`, `services/onboarding.py`'s `validate_session`/
`_require_owner_authority`/session-minting code, and the frontend
`OnboardingGate` — carry no diff beyond the two lines above**, so this
pass's independent re-verification (rather than re-citing pass 10) focused
on re-reading those mechanisms directly against current code:

- **Session tokens are cryptographically random and not vulnerable to
  replay forgery — verified good.** `secrets.token_urlsafe(32)` (256 bits)
  mints both the session id (`onboarding.py:881`) and the CSRF token
  (`onboarding.py:984`); CSRF comparison uses `secrets.compare_digest`
  (`onboarding.py:967`), not `==`. `validate_session` (`onboarding.py:897`)
  looks the session up by exact `session_id` equality, checks a 30-minute
  sliding expiry and a 24-hour hard expiry, and 401s on missing/invalid/
  expired — unchanged from pass 2's original review.
- **A half-provisioned or completed install cannot be hijacked or replayed
  into by an unauthenticated caller — verified good, re-read in full.**
  `_require_owner_authority` (`onboarding.py:784-817`) is called from both
  `/start` (the resume path) and `/reset` (the destructive path): once a
  System Owner exists (identified by the wildcard-grant position, not
  creation-timestamp ordering), any caller who is not authenticated _as that
  exact user_ is refused with 403 — mere possession of a still-valid
  onboarding session cookie/id is not enough. `/start` additionally refuses
  outright with 400 if `needs_onboarding()` is already false (fully
  completed), before `_require_owner_authority` is even reached. Fails
  closed if users exist but none carries the owner grant (a damaged-row
  case), rather than promoting an arbitrary first user. This directly
  answers this pass's own "can `/complete` or `/start` be replayed to
  re-claim an already-provisioned org" question: no — re-running `/start`
  past completion is refused by the first check, and re-running it on a
  half-finished install requires the real owner's authenticated session,
  not the onboarding session alone.
- **`/reset` remains bounded correctly — verified good, re-read in full.**
  Refuses if `onboarding_status.is_completed`; requires a valid
  `validate_session`; requires owner authority per above; writes a durable
  audit record in its own committed transaction _before_ any row is
  deleted (and refuses the reset outright if that audit write fails) —
  unchanged from pass 4/5's fix, still rate-limited via
  `_rate_limit_onboarding_reset`.
- **The `/session/*` data-entry routes' lack of a per-route rate limiter is
  a long-settled, documented design, not an oversight — re-confirmed, not a
  new finding.** Every `/session/*` route requires `validate_session`,
  which requires a session id that can only be minted by the heavily
  rate-limited `/start`; within a session, per-field caps bound payload size
  (`it-team` 50, `stations` 50, `apparatus` 100, `roles` outer 200/
  per-role-permissions 50) rather than request _rate_. This shape has stood
  unchanged and been independently re-reviewed at passes 2–10; re-verified
  here against current code rather than re-deriving from scratch. The one
  still-open item in this family, **ONB-7** (no documented numeric rate cap
  specifically on `/session/roles` beyond the count cap), remains OPEN,
  unchanged.

**Route inventory re-enumerated by AST from source** (not carried forward
from pass 10's count): walked every `@router.{get,post,put,patch,delete}`
decorator in `onboarding.py` directly — **26 routes**, identical method/
path/function set to passes 7–10. No route gained, lost, or changed its auth
posture. `check_route_permissions.py --strict`: 280 routes, 0 errors/
warnings (repo-wide, unchanged).

**Still OPEN (by design), unchanged:** `ITTeamMemberRequest.email`
(`onboarding.py:509`) is still `str`, not `EmailStr` (ONB-7's sibling note,
intentionally loose to match `create_it_team_users`'s skip-if-invalid
behavior). **ONB-7** (above) also unchanged.

**Schema & migration:** no onboarding-owned migration in this pass's
window. `validate_migrations.py --strict`: 678 revisions, single head
`f90b1124e6f4`, clean.

**Guard tests:** none added — nothing here is a new defect to close.
`tests/test_agency_position_seeding.py` (the other feature's own guard for
the `kind` column, run directly: 37 passed) exercised as part of this pass's
verification that `position_kind_for`'s fixed-enum behavior holds.

### Completion gate (pass 11)

| Check                                                                                                                                                                                                 | Result                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)                                                                                                                                        | ✅ 0 violations                                |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned)                                                                                                                               | ✅ clean, 2,743 files unchanged                |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned)                                                                                                                            | ✅ clean                                       |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                                                                  | ✅ 678 revisions, single head `f90b1124e6f4`   |
| `python3.13 scripts/check_route_permissions.py --strict`                                                                                                                                              | ✅ 280 routes, 0 errors/warnings               |
| `pytest tests/ -q -k "onboard or org_template or template_service or key_custody or system_notices or gmail_service_account or email_provider or encrypt_email or position_kind or position_seeding"` | ✅ 695 passed, 1 skipped (pywebpush, env-only) |
| `cd frontend && npm run typecheck`                                                                                                                                                                    | ✅ 0 errors                                    |
| `cd frontend && npm run lint` (`--max-warnings 10`)                                                                                                                                                   | ✅ 0 errors/warnings                           |
| `npx vitest run src/modules/onboarding`                                                                                                                                                               | ✅ 457 passed (34 files)                       |

Rotation row 30 → ✅ (pending this PR's merge). Next: Feature 31 (Scheduled
tasks) — unless a later watchdog pass already advanced further; check
`search_pull_requests`/`list_pull_requests` fresh rather than trusting this
note.

---

## Pass 10 (2026-10-27) — watchdog pickup, 0 fixed, 0 new findings; two pass-9 OPEN items re-confirmed FIXED

**Step 0.** The dedicated loop session for this rotation
(`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable, so this is a watchdog
pickup. `list_pull_requests` (`state=open`) returned only two unrelated docs
PRs (#3774, #3772); no PR with a `claude/security-review-` head branch is
open. PR #3784 (Feature 29, Reports & analytics, pass 12) had already merged.
Row 30 (Onboarding) was the first `⬜` in the rotation table on a
freshly-pulled `main` (`65b566ee`).

**Scope check.** Pass 9's own review landed as `6636cee6` (PR #3658), and a
separate recovery PR (#3686, `e6da6486`) applied three fixes
(ONB6-30-1/2/3, see the **Pass 9 addendum** section above) immediately after.
`e6da6486` is this pass's baseline. `git log e6da6486..HEAD`, restricted to
this feature's full file list (as pass 7–9 defined it) plus the new
`backend/app/utils/google_oauth.py` (new this pass's window, pulled in the
same way Core Infrastructure's `system_notices.py`/`key_custody_service.py`
were in pass 7 — reviewed now because it sits in `email_test_helper.py`'s own
call graph, not because this feature owns Gmail sending generally), found
real changes in:

- `backend/app/api/v1/email_test_helper.py` — Gmail service-account
  connection testing added alongside the existing App Password path.
- `backend/app/utils/email_providers.py` — `google_auth_method`/
  `uses_google_service_account` helpers, wired into `missing_for_enabled`/
  `invalid_for_enabled`/`resolve_smtp_settings`/`connection_identity`.
- `backend/app/utils/google_oauth.py` — new file, delegated Gmail API token
  acquisition.
- `backend/app/api/v1/onboarding.py` — one line, `NotificationsConfig.smtp_port`
  gained `Field(None, ge=1, le=65535)`.
- `backend/app/models/onboarding.py` / `backend/app/services/onboarding.py` —
  `OnboardingStatus.admin_email` moved to `EncryptedText`; the IT-team-member
  existence check now matches by `User.email_hash` fingerprint instead of
  plaintext `User.email`; the `user_created` audit event no longer carries
  the raw email in `event_data`.
- `frontend/src/modules/onboarding/pages/EmailConfiguration.tsx` — a Gmail
  sending-guidance note block (shared copy, `GMAIL_SENDING_NOTES`).
- `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx` — a WCAG
  contrast token rename (`border-theme-surface-border` →
  `border-theme-input-border`), no behavior change.

Everything else in the window belongs to other, already-reviewed rotation
features (the app-wide email-at-rest encryption migration, Gmail API sending
for the authenticated Settings screen, the numeric-bounds hardening sweep)
and only passes through a file this feature owns, or through a shared helper
this feature's own pre-auth test endpoint calls.

**Gmail service-account testing is correctly unreachable from the onboarding
wizard, by design — verified good, no finding.** `_email_settings_from_onboarding`
(`onboarding.py:219-254`), the one function that maps the onboarding wizard's
submitted config into org settings for both `/session/email`'s save-time
validation and `_persist_session_data_to_org`'s completion-time persist, maps
only `googleAppPassword` for `platform == "gmail"` — it has no
`googleAuthMethod`/`googleServiceAccountKey` mapping. Read `KNOWN_LIMITATIONS.md`
before treating this as a gap: "**Onboarding offers App Password only.** A
department chooses the service account after setup, in **Settings → Email**,
where the `admin.access` check applies" (the "Gmail — Sending Through a
Service Account" entry, owner decision 2026-10-25) states this is deliberate,
and `tests/test_gmail_service_account_settings.py::TestOnlyAnAdministratorConfiguresTheServiceAccount`
confirms the authenticated save path itself refuses the switch to
non-administrators with a `PermissionError`. Onboarding runs before any user
or permission exists, so it cannot evaluate `admin.access` at all; omitting
the mapping is the only way the onboarding save/completion path could enforce
that gate, and it does — a hand-built API call that submits
`googleServiceAccountKey` during onboarding falls through to the ordinary
App Password check in `missing_for_enabled` (`email_providers.py:246-264`:
`uses_google_service_account` reads `google_auth_method`, which is absent
from the mapped dict and defaults to `"app_password"`) and is refused with
"a Google App Password is required," not silently accepted. Confirmed the
frontend wizard (`EmailConfiguration.tsx`) never renders or submits a service-
account field (`grep` for `googleServiceAccountKey`/`googleAuthMethod`/
`serviceAccount` in that file: no hits) — only the App Password input exists,
matching the documented decision exactly.

**The pre-auth `/test/email` connection test _can_ exercise the service-
account path directly (`email_test_helper.py:426-462`'s new
`_test_google_service_account_connection`, reachable from `verify_email_configuration`
since `test_gmail_connection` → `_test_provider_connection` checks
`uses_google_service_account` against the raw, unmapped request config) — but
this grants no new capability.** The function only calls
`acquire_gmail_send_token` (`google_oauth.py:203-233`) to obtain an OAuth
token for the caller-supplied key; it never calls anything that sends mail
(confirmed: `gmail_api_sender.py`'s send functions are not imported by
`email_test_helper.py`). A caller already needs the private key to reach this
path at all, and anyone holding that key can already ask Google's own token
endpoint the same question directly (`google_oauth.py:40`'s
`_GOOGLE_TOKEN_URI` is Google's fixed endpoint, and `parse_service_account_key`
refuses any `token_uri` that isn't it — closing the SSRF/credential-redirect
shape the module's own docstring names). So the pre-auth route is an oracle
for a secret the caller must already possess, gated the same way the existing,
owner-accepted SMTP connection-test oracle is (ONB-30-3/`_rate_limit_onboarding_test_email`
still applies, unchanged) — not a new abuse surface. Error messages
(`_refresh_error_message`, `google_oauth.py:176-200`) name only Google's OAuth
error _code_, never the exception text or key material, so a probing caller
learns "delegation not authorized" / "key or sending account rejected," the
same tier of information the owner already accepted for the SMTP equivalent.
The process-wide credential cache (`google_oauth.py:48-50,70-71`) is capped
at 32 entries with LRU eviction (Pitfall #9 compliant) and keyed by a SHA-256
hash of the key material plus sending address, not by organization — a bogus
submission cannot poison another caller's entry.

**Email-at-rest encryption reaching `onboarding_status.admin_email` and the
IT-team user lookup — verified good, no finding (reviewed as this feature's
piece of a cross-cutting change; the migration and `User.email_hash` design
belong to a different rotation feature and are not re-derived here).**
`OnboardingStatus.admin_email` is now `EncryptedText`
(`models/onboarding.py:75`); the generic, table-driven migration
(`20261026_1211_b8236e29ec44_encrypt_email_addresses_at_rest.py:87`) lists
`onboarding_status`/`admin_email` with `nullable=True` preserved, and the
migration refuses outright (leaving the database untouched) if
`ENCRYPTION_KEY` is unset while rows exist — satisfying Pitfall #35 for a
tightened/retyped column without a bespoke per-table test, since the
backfill logic itself is generic and already exercised by
`tests/test_encrypt_email_migration.py` against other tables in the same
dict. Confirmed `admin_email` is write-only in code (`services/onboarding.py:1468`,
`status.admin_email = email`; no other read-by-value site exists anywhere in
`backend/app/` — `grep -rn "admin_email" backend/app/` returns only this write
and unrelated Google-Workspace-integration fields of the same name on a
different model), so no fingerprint/hash column is needed for it, unlike
`users.email_hash`. The IT-team-member existence check
(`services/onboarding.py:1246-1250`) now matches
`User.email_hash.in_(email_fingerprints(email))` scoped to
`organization_id` rather than a plaintext `User.email ==` comparison — this
is the identical fingerprint-lookup pattern already used by `keep_email_fingerprint`
elsewhere (confirmed no residual `User.email ==` comparison remains anywhere
in `onboarding.py`/`services/onboarding.py`: `grep -n "User\.email\b"` on
both files returns nothing), and `email_fingerprints` checks every live and
legacy `ENCRYPTION_KEY` so a lookup keeps working across a key rotation
(`core/security.py:707-719`). The `user_created` audit event
(`services/onboarding.py:1479` area) dropped the raw `"email": email` key
from `event_data` — tightens checklist dimension 5 (PII absent from audit
payloads) for a feature this review has not previously flagged on this exact
point.

**`smtp_port` bound — verified good, no finding.**
`NotificationsConfig.smtp_port` (`onboarding.py:358`) gained
`Field(None, ge=1, le=65535)`, part of a wider, already-engineered and
already-tested numeric-bounds sweep (`dd4ba98a`) that is a correctness/input-
validation hardening with no security dimension specific to this feature.

**Two pass-9 "OPEN" standing findings are now FIXED, by the recovery PR that
merged after pass 9's own analysis was written — re-confirmed against current
code:**

- **Duplicate `role.id`/position id within one payload (previously: unhandled
  `IntegrityError` → 500).** `RolesSetupRequest`/`PositionsSetupRequest`
  (`onboarding.py:636-684`) now run `_reject_duplicate_ids`
  (`onboarding.py:622-633`) as a Pydantic `field_validator`, so a payload
  with a repeated id is refused with 422 before `save_session_roles`'s body
  ever runs. This is `ONB6-30-3`, landed in PR #3686 (addendum above) after
  pass 9's text was written; pass 9 correctly reported it OPEN against the
  code as it stood at the time. **FIXED, re-confirmed.**
- **`POST /organization` missing `except Exception` (previously: an uncaught
  non-`ValueError` failure fell through to Starlette's default 500 instead of
  the service's own message).** `create_organization`
  (`onboarding.py:1504-1511`) now has `except HTTPException: raise` (so the
  logo-scan's own 400 is not buried) followed by a generic `except Exception`
  that logs and returns a 500 with a safe, fixed message — the same shape
  `/session/organization` already had. This is `ONB6-30-2`, same PR.
  **FIXED, re-confirmed.**

**Still OPEN (by design), unchanged:** `ITTeamMemberRequest.email`
(`onboarding.py:509`) is still `str`, not `EmailStr` — confirmed unchanged,
intentionally loose to match `create_it_team_users`'s skip-if-invalid
behavior.

**Route inventory re-enumerated by AST this pass** (walked every
`@router.{get,post,put,patch,delete}` decorator in `onboarding.py`, not
carried forward from pass 9's count): **26 routes**, identical method/path/
function set to pass 7–9. No route gained, lost, or changed its auth
posture. The three that call no `validate_session` directly
(`get_onboarding_status`, `start_onboarding`, `save_session_positions`) are
unchanged from every prior pass's review: the first two are the public
bootstrap entry points (ONB-8's established reasoning), and the third
delegates to `save_session_roles`, which validates the session on its behalf.

**Schema & migration:** no onboarding-owned migration in this pass's window
(the email-encryption migration above belongs to a different feature's file
set; onboarding's own last migration remains
`20261009_1045_7e1a3c94d2b6_add_encryption_key_custody.py`, pass 7).
`validate_migrations.py --strict`: 666 revisions, single head `0d9897752425`,
clean.

**Guard tests:** none added by this pass — nothing here is a new defect to
close. `tests/test_onboarding_organization_error_handling.py`,
`tests/test_onboarding_request_caps.py` (ONB6-30-2/3's guards) and
`tests/test_gmail_service_account_settings.py` (the cross-feature work's own
guard) re-run and still passing in the scoped run below.

### Completion gate (pass 10)

| Check                                                                                                                                                            | Result                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned, installed this pass)                                                                              | ✅ 0 violations                                |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned, installed this pass)                                                                     | ✅ clean, 2,706 files unchanged                |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned, installed this pass)                                                                  | ✅ clean                                       |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                             | ✅ 666 revisions, single head `0d9897752425`   |
| `pytest tests/ -q -k "onboard or org_template or template_service or key_custody or system_notices or gmail_service_account or email_provider or encrypt_email"` | ✅ 603 passed, 1 skipped (pywebpush, env-only) |
| `npm run typecheck` (frontend)                                                                                                                                   | ✅ 0 errors                                    |
| `npm run lint` (frontend, `--max-warnings 10`)                                                                                                                   | ✅ 0 errors, 0 warnings                        |

Findings doc for this pass is this section; no `KNOWN_LIMITATIONS.md` change
needed — the one entry a reader might expect to update ("Gmail — Sending
Through a Service Account") is already accurate against current code, as
verified above. Rotation row 30 → ✅ (pending this PR's merge). Next: Feature
31 (Scheduled tasks) — unless a later watchdog pass already advanced further;
check `search_pull_requests`/`list_pull_requests` fresh rather than trusting
this note.

---

## Pass 9 (2026-10-24) — watchdog pickup, 0 fixed, 0 new findings

**Step 0.** The dedicated loop session for this rotation
(`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable, so this is a watchdog
pickup. `search_pull_requests` (`is:pr is:open head:claude/security-review-`)
and `list_pull_requests` (`state=open`) both returned 0 rotation PRs,
re-checked fresh immediately before starting. PR #3647 (Feature 29, Reports &
analytics, pass 11) had already merged, docs-only (findings file +
`PROGRESS.md`), nothing to record per the "docs-only PR is not a recordable
event" rule. Row 30 (Onboarding) was the first `⬜` in the rotation table on a
freshly-pulled `main` (`1bce6940`).

**Scope check.** Pass 8 landed as PR #3517, merge commit containing
`dbe57bf6` ("security(onboarding): refuse /test/email once onboarding is
complete") as its tip on this feature's files. `git log dbe57bf6..HEAD`
restricted to this feature's full file list (as pass 7/8 defined it, plus
`schemas/organization.py` since the diff touches it) found real changes in
exactly two of this feature's own files:

- `backend/app/api/v1/onboarding.py` — 8 lines, in `_persist_session_data_to_org`
  (`onboarding.py:1081-1089`): the Google Drive mapping switched from
  `googleDriveClientId`/`googleDriveClientSecret` to
  `googleDriveServiceAccountKey`/`googleDriveSharedDriveId`.
- `backend/app/services/system_notices.py` — 51 new lines, a
  `BACKUPS_NOT_ENCRYPTED` system notice.

Everything else in the diff since pass 8 is frontend (`OnboardingGate.tsx` and
its routing, copy/a11y edits) or belongs to a different rotation feature
(Google Drive/S3 storage backends, backup encryption) and only passes through
a file this feature owns.

**Google Drive field rename — verified good, no finding.** Read end-to-end:
`onboarding.py:1081-1089` now maps `googleDriveServiceAccountKey` →
`google_drive_service_account_key` and `googleDriveSharedDriveId` →
`google_drive_shared_drive_id`, matching `FileStorageSettings`
(`schemas/organization.py:415-424`, docstring: "encrypted at rest and never
returned"). Confirmed `google_drive_service_account_key` is a member of
`_FILE_STORAGE_SECRET_FIELDS` (`schemas/organization.py:117-123`), and that the
same `encrypt_settings_secrets(org_settings)` call onboarding's email-config
branch already used (reviewed in prior passes) runs again, unconditionally,
right after this storage block is built
(`onboarding.py:1125` area) — so the service-account key is encrypted
(`enc:` + `encrypt_data`) before `organization.settings = org_settings` is
assigned, the same mechanism, not a new one. The raw value itself never
touches the wire from the browser as plaintext either: it arrives inside
`storage_data["config_encrypted"]`, which `/session/file-storage`
(`onboarding.py:1953`, unchanged) already encrypts with `encrypt_data` at
submit time — the field rename changes only which key the decrypted dict is
read from, not when or whether encryption happens. **No security
consequence; a correctness/naming change following a different feature's new
storage backend.**

**Frontend `OnboardingGate` — verified good, no finding.** `OnboardingGate.tsx`
(new, 76 L) wraps every setup-step route except `/onboarding/complete` (which
must render immediately after the backend just flipped
`needs_onboarding()` to false) and calls `GET /onboarding/status` once per
browser session (cached in `onboardingGateState.ts`'s module-level variable,
not `localStorage`/`sessionStorage`), redirecting to `/login` when the backend
says setup is finished. Confirmed by direct read that this is advisory UX
only, not a new security boundary: the component's own docstring states it
"deliberately fails open" on an errored or rate-limited status call, and every
mutating `/session/*`/top-level route it fronts already enforces
`needs_onboarding()` or `_require_owner_authority` server-side (established in
passes 1-8, re-confirmed unchanged below). A visitor who bypasses the gate
(disabled JS state, direct navigation, a stale cached `'open'`) reaches
exactly the same backend refusal the gate exists to pre-empt, not a weaker
one. `routes.tsx`'s restructuring wraps existing routes only (no new route
added — confirmed against the AST enumeration below, still 26/26), so
CLAUDE.md Pitfall #30a's three registries are unaffected.

**Backup-encryption system notice — verified good, no finding.**
`backups_are_unencrypted()` (`system_notices.py`, new) reads a fixed path
(`/backups/.backup_status`, not client- or session-influenced), fails closed
to "no notice" on `FileNotFoundError` or a JSON decode error (logged, not
raised), and is surfaced only through the existing `GET /system-notices`
endpoint already gated on `require_permission("settings.manage")` — unchanged
by this diff. Not reachable from any of onboarding's 26 unauthenticated
routes. Read `scripts/backup-sidecar.sh`'s write side only far enough to
confirm the path and shape match (`{"encrypted": bool, ...}`); the backup
tooling itself belongs to a different rotation feature (Core infrastructure /
scheduled tasks) and is not re-reviewed line-by-line here.

**Route inventory re-enumerated by AST this pass** (not carried forward from
pass 7/8's table): 26 routes, identical method/path/function set to pass 7's
table — see that table in this same file, still accurate. No route gained,
lost, or changed its auth dependency.

**Standing findings re-verified unchanged, by direct read at current line
numbers:**

- Duplicate `role.id` within one `/session/roles` payload still raises an
  unhandled `IntegrityError` → 500 — `save_session_roles`'s creation loop
  (`onboarding.py:2770-2846` at current line numbers) still has no dedup of
  `data.roles`' own `id` values against each other; `_check_submitted_positions`
  only checks a submitted id against the organization's _existing_ system
  roles. `await db.commit()` at the end of the function
  (`onboarding.py:2901`) is not wrapped in try/except, so the `IntegrityError`
  propagates uncaught. Confirmed the app is constructed with no explicit
  `debug=` flag (`main.py:2031`, defaults to `False`) and no global
  `add_exception_handler` exists for unhandled exceptions
  (`grep -rn "exception_handler(" app/` — no hits), so Starlette's default
  `ServerErrorMiddleware` returns a generic 500 with no traceback either way —
  confirmed this is a robustness/availability gap (one onboarding session can
  500 itself with a malformed payload), not a data-exposure one. OPEN,
  unchanged across 6 passes (first flagged in `ONB3-30-onboarding.md`); not
  attempted as a "safe, low-risk" fix this pass either, consistent with every
  prior pass's judgment that resolving it means deciding what a duplicate
  submission _should_ do (reject the whole payload? keep first-seen? merge
  permissions?) — a product decision, not a one-line guard.
- `POST /organization` (`onboarding.py:1363-1409` at current line numbers)
  still has only `except ValueError` around `service.create_organization(...)`,
  not the `except Exception` its twin `/session/organization` carries.
  Confirmed by reading the full try/except block. Cosmetic robustness gap, not
  a security finding for the same reason as above (no handler difference in
  what reaches the client). OPEN, unchanged.
- `ITTeamMemberRequest.email` (`onboarding.py:488`) is still `str`, not
  `EmailStr` — confirmed unchanged, intentionally loose to match
  `create_it_team_users`'s skip-if-invalid behavior. OPEN (by design),
  unchanged.

**Minor documentation correction, not a finding:** the rotation table's row
30 in `docs/security-review/PROGRESS.md` described this feature's principal
code as "24 unauth bootstrap routes," unchanged since before pass 7 added the
two key-custody routes. Corrected to 26 in this PR (see `PROGRESS.md`'s own
diff). `SEC-00-cross-cutting-baseline.md` carries the same stale "24" in
several whole-codebase counts from its own most recent pass (predates pass 7) — left alone here; that file is Feature 00's own territory and will be
refreshed the next time the rotation wraps to it, per the skill's "re-verify,
don't re-derive another feature's settled count" guidance.

**Minor note, not a finding:** `FileStorageConfiguration.tsx`'s new
`multiline` field (the pasted Google service-account-key JSON) renders as a
plain `<textarea>` with no masking — HTML has no `type="password"` equivalent
for a multi-line control, so this is the same accepted tradeoff every
paste-a-key-file UI (GitHub's deploy-key box included) makes, not a regression
from the single-line `secret: true` `<input type="password">` the OAuth
client-secret field used before this feature's Google Drive redesign replaced
it. No action.

**Schema & migration:** no migration in this pass's window; `validate_migrations.py --strict`
clean, single head, 651 revisions (see completion gate below).

**Guard tests:** none added by this pass — nothing here is a new defect to
close; `dbe57bf61`'s structural test from pass 8 (`tests/test_onboarding_test_email_completion_guard.py`)
re-run and still passing in the scoped run below.

### Completion gate (pass 9)

| Check                                                                                                       | Result                                         |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.3.0, CI-pinned)                                              | ✅ 0 violations                                |
| `python3 -m flake8 app/ tests/ alembic/` (system interpreter, 7.3.0 after installing `flake8-pytest-style`) | ✅ 0 violations                                |
| `python3.13 -m black --check app/ tests/ alembic/` (26.5.1, CI-pinned)                                      | ✅ clean, 2,624 files unchanged                |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned)                                  | ✅ clean                                       |
| `python3.13 scripts/validate_migrations.py --strict`                                                        | ✅ 651 revisions, single head `3d67883cd461`   |
| `pytest tests/ -q -k "onboard or org_template or template_service or key_custody or system_notices"`        | ✅ 323 passed, 1 skipped (pywebpush, env-only) |
| `npm run typecheck` (frontend)                                                                              | ✅ 0 errors                                    |
| `npm run lint` (frontend, `--max-warnings 10`)                                                              | ✅ 0 errors, 0 warnings                        |

Findings doc for this pass is this section; no `KNOWN_LIMITATIONS.md` change
needed — the one onboarding-adjacent entry a reader might expect to update
(file storage) was already corrected 2026-10-22/23 by the engineering work
itself, independent of this pass, and is accurate as read. Rotation row 30 →
✅ (pending this PR's merge). Next: Feature 31 (Scheduled tasks) — unless a
later watchdog pass already advanced further; check `search_pull_requests`
fresh rather than trusting this note.

---

## Pass 9 addendum (2026-10-25) — 3 fixes recovered from an orphaned pre-merge branch (ONB6-30-1/2/3)

**Not a new rotation pass.** A separate session had already written and
committed these three fixes (single commit `2e48054e`, dated 2026-10-24) on
branch `claude/security-review-onboarding-p12`, cut from `main` before this
feature's pass 9 above (PR #3658) merged. That branch was never turned into a
pull request, so pass 9 ran against `main` without it, independently
re-confirmed two of these three as still-open gaps (see pass 9's "Standing
findings" above — the duplicate `role.id`/position-id 500 and `POST
/organization`'s missing `except Exception`), and merged with 0 fixes. This PR
(`claude/security-review-onboarding-p12-recovered`) reapplies the orphaned
branch's three fixes on top of current `main`; it is a recovery of
already-written work, not a fresh review. `onboarding.py` had not changed
between the orphaned branch's cut point and this recovery, so the fixes
applied with no adaptation needed.

### ONB6-30-1 — LOW — FIXED — Free-form config dicts had only the 60 MB request ceiling

`EmailTestRequest.config`, `EmailConfigRequest.config`,
`FileStorageConfigRequest.config` and `ITTeamRequest.backup_access`
(`onboarding.py`) were bare `dict[str, Any]`. `/session/email`,
`/session/file-storage` and `/session/it-team` encrypt and store them in the
session's JSON `data` column for a caller holding only a session cookie, so
one request could park up to `MAX_REQUEST_BODY_SIZE` (60 MB) in the row and
spend CPU encrypting it. **Fix:** a `BoundedConfig` type caps the serialized
value at 64 KiB (`ONBOARDING_CONFIG_MAX_BYTES`; the largest honest value is a
~2.5 KB service-account key). Over the cap is a 422. **Guard:**
`tests/test_onboarding_request_caps.py::TestFreeFormConfigCap`, including an
AST check that no `*Request` model in `onboarding.py` declares a bare
`dict[str, Any]`.

### ONB6-30-2 — LOW — FIXED — A rejected logo was reported as "Failed to create organization" (500)

`/session/organization` runs `scan_and_validate_logo` inside its `try`; a bad
or malicious image makes it raise `HTTPException(400, "Invalid image: …")`,
which the route's `except Exception` caught and turned into a generic 500
whose text sends the administrator to the server logs instead of telling them
what was wrong. The same blanket handler was missing entirely from `POST
/organization` (pass 9's "missing `except Exception`" standing item), and
adding one naively would have copied the same bug. **Fix:** both routes now
re-raise `HTTPException` before the generic handler, and `POST /organization`
has a generic handler for the first time. **Guard:**
`tests/test_onboarding_organization_error_handling.py` (6 tests across both
routes: a rejected logo keeps its 400, an unexpected error is a generic 500
that does not echo the exception text, a `ValueError` is a 400). Verified
against the pre-fix code as part of this recovery: `test_a_rejected_logo_keeps_its_own_400[session]`
and `test_an_unexpected_failure_is_a_generic_500[organization]` fail without
the fix (the latter with an unhandled `RuntimeError`, confirming `POST
/organization` truly had no blanket handler) and pass with it.

### ONB6-30-3 — LOW — FIXED — A repeated position id in one payload was a 500

The id is the stored slug, unique per organization, so two new entries
sharing one id fail at flush with an `IntegrityError` — this is exactly the
duplicate-`role.id` gap pass 9 re-confirmed as OPEN above. **Fix:**
`RolesSetupRequest` and `PositionsSetupRequest` now refuse a repeated id with
a 422 via a shared `_reject_duplicate_ids` validator. The wizard cannot
produce one (`positionsConfig` is a record keyed by id), so this changes only
what a hand-built request sees. **Guard:**
`tests/test_onboarding_request_caps.py::TestDuplicatePositionIds`.

### Completion gate (this recovery)

| Check                                                                                                  | Result                                                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/`                                                            | ✅ 0 violations                                               |
| `python3.13 -m black --check app/ tests/ alembic/`                                                     | ✅ clean, 2,638 files unchanged                               |
| `python3.13 -m isort --check-only app/ tests/ alembic/`                                                | ✅ clean                                                      |
| `pytest tests/ -q -k "onboard or org_template or template_service or key_custody or system_notices"`   | ✅ 336 passed, 1 skipped (pywebpush, env-only)                |
| `pytest tests/test_onboarding_organization_error_handling.py tests/test_onboarding_request_caps.py -v` | ✅ 21/21 passed                                               |
| Pre-fix regression check (fix reverted, tests re-run)                                                  | ✅ 2 of 21 fail exactly as expected, pass again once restored |

No frontend files are touched by this recovery, so no frontend verification
is needed. `docs/security-review/PROGRESS.md`'s rotation table is left
untouched by this PR — row 30 already reflects the normal rotation's own
state, and this recovery does not advance or re-run the rotation.

---

## Pass 8 (2026-10-21) — watchdog pickup, 1 independently-landed fix re-confirmed, 0 new findings

**Step 0.** `search_pull_requests` (`is:pr is:open head:claude/security-review-`)
returned 0 results, checked fresh immediately before starting and again
immediately before branching — no open security-review PR either time. PR
#3479 (Feature 29, Reports & analytics, pass 10) had merged
(`e9a9baef0`, 2026-10-21T04:46:27Z) with nothing started for the next
feature since; row 30 (Onboarding) was the first `⬜` in the rotation table.

**Scope check.** Pass 7 landed as `8f308088c` (PR #3381, merged
2026-10-17). `git log 8f308088c..HEAD` restricted to this feature's full
pass-7 file list (`onboarding.py`, `services/onboarding.py`,
`models/onboarding.py`, `utils/onboarding_security.py`,
`email_test_helper.py`, `email_providers.py`, `microsoft_oauth.py`,
`template_service.py`, `org_template_service.py`,
`org_template_registry.py`, `key_custody_service.py`, `system_notices.py`
(service + endpoint + schema), `upload_scanning.py`, and
`frontend/src/modules/onboarding/`) found exactly one real commit:
`dbe57bf61` ("security(onboarding): refuse /test/email once onboarding is
complete", 2026-10-20). No migration, no other feature-owned file changed
in this window.

**`dbe57bf61` re-verified by direct read, not taken on its own commit
message.** `POST /onboarding/test/email` (`verify_email_configuration`,
`onboarding.py:1713-1752`) opens an outbound SMTP connection to a
caller-chosen host/port and previously only called `validate_session` —
proof a session exists and has not idled out, not proof onboarding is
still in progress. Every sibling state-changing `/session/*` route (ONB-3,
ONB-9, ONB2-30-3) already refuses once `needs_onboarding()` is false;
this route did not, so a session minted before completion stayed usable as
an authenticated-adjacent SSRF/internal-port probe for up to
`SESSION_MAX_LIFETIME_HOURS` (24h) after setup actually finished. The fix
adds the identical `needs_onboarding()` check (`onboarding.py:1736-1747`)
**before** `test_smtp_connection_uniform` is called, confirmed by reading
the function body end-to-end: the check sits between `validate_session`
and the first line that touches `request.platform`/`request.config`, so no
network I/O happens on a completed install. The new structural test
(`tests/test_onboarding_test_email_completion_guard.py`) walks the AST of
`onboarding.py` and fails if any future mutating session route reaches
`validate_session` without also reaching `needs_onboarding()`/
`is_completed` through its own call graph — read in full, confirmed it
actually exercises `verify_email_configuration` (both the refused-after-
completion and still-runs-while-in-progress branches) and would have
caught this gap before it shipped. Not a security-review-flagged item in
any prior pass's findings file — it was found and fixed by regular
engineering work; this pass's job is confirming the fix is complete and
correct, which it is. **No new finding.**

**Standing findings re-verified unchanged, by direct read at current line
numbers (not re-cited from pass 7):**

- Duplicate `role.id` within one `/session/roles` payload still raises an
  unhandled `IntegrityError` → 500 — `save_session_roles`'s creation loop
  (`onboarding.py:2774-2850`) still has no dedup of `data.roles`' own `id`
  values against each other; `_check_submitted_positions` only checks a
  submitted id against the organization's _existing_ system roles. OPEN,
  unchanged.
- `POST /organization` (`onboarding.py:1370-1409`) still has only
  `except ValueError` around `service.create_organization(...)`, not the
  `except Exception` its twin `/session/organization` carries. Confirmed by
  reading the full try/except block. Cosmetic robustness gap, not a
  security finding — `safe_error_detail()`/production `DEBUG=false` still
  govern an uncaught exception's response either way. OPEN, unchanged.
- `ITTeamMemberRequest.email` (`onboarding.py:484`) is still `str`, not
  `EmailStr` — confirmed unchanged, intentionally loose to match
  `create_it_team_users`'s skip-if-invalid behavior. OPEN (by design),
  unchanged.

**Schema & migration:** no migration in this pass's window.
`validate_migrations.py --strict` — see gate below.

**Guard tests:** none added by this pass — `dbe57bf61`'s own structural
test (above) already closes the class for the next route; re-run and
confirmed passing in the scoped run below.

### Completion gate (pass 8)

| Check                                                                                                | Result                |
| ---------------------------------------------------------------------------------------------------- | --------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/`                                                          | ✅ 0 violations       |
| `python3.13 -m black --check app/ tests/ alembic/`                                                   | ✅ clean              |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned)                           | ✅ clean              |
| `python3.13 scripts/validate_migrations.py --strict`                                                 | ✅ single head, clean |
| `pytest tests/ -q -k "onboard or org_template or template_service or key_custody or system_notices"` | ✅ see Step 9 report  |
| `npm run typecheck` (frontend)                                                                       | ✅ 0 errors           |
| `npm run lint` (frontend, `--max-warnings 10`)                                                       | ✅ 0 errors           |

Findings doc for this pass is this section; no `KNOWN_LIMITATIONS.md` change
needed — nothing here is an owner-decision item, and the one existing
onboarding row that mentions `/test/email` (ONB-30-3, the SMTP-uniform-error
decision) is unrelated to this pass's finding and unchanged. Rotation row 30
→ ✅ (pending this PR's merge). Next: Feature 31 (Scheduled tasks) — unless a
later watchdog pass already advanced further; check `search_pull_requests`
fresh rather than trusting this note.

---

## Pass 7 (2026-10-17) — watchdog pickup, 0 fixed, 0 new findings

## Scope

Pass 6's baseline is PR #2996's head commit `16766f61`. This pass:

1. Read `CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md`,
   `docs/KNOWN_LIMITATIONS.md`'s onboarding rows, and all four prior findings
   files in full before reading any code. Every item those left open or
   flagged is re-verified below against current code.
2. `git diff --stat 16766f61..HEAD`, scoped to this feature's file list
   (20 files changed, +919/-160). The delta is substantive, not
   drive-by: a new required onboarding step (encryption-key custody
   confirmation), a malware-scan gate added to all three logo-upload call
   sites, a narrowed allowlist + priority clamp on the role/position editor
   (ONB-7), an absolute session-lifetime ceiling (ONB2-30-8), and uniform
   SMTP failure messages (ONB-30-3) — the last three already recorded in
   `KNOWN_LIMITATIONS.md` as owner decisions resolved 2026-10-11, independent
   engineering work, re-verified here against current code rather than taken
   on the doc's own say-so.
3. Read `onboarding.py`'s full diff hunks end-to-end (not a line-count
   sample) plus the two new routes in context; read `models/onboarding.py`'s
   new `EncryptionKeyCustody` class, `key_custody_service.py`,
   `system_notices.py` (service + endpoint + schema) in full, since none of
   that surface appears in any other feature's file list and Core
   Infrastructure (Feature 33) has not yet reached this rotation — the same
   "review it now, from whichever feature's diff surfaces it" rule the
   Integrations pass applied to Google Workspace.
4. `email_test_helper.py`, `template_service.py`, `org_template_registry.py`,
   `org_template_service.py`, `microsoft_oauth.py` diffed in full; the
   non-onboarding changes in the latter two (mypy annotation cleanup, a
   `resolve_outline` helper for the meetings/minutes module, a Microsoft
   Graph scope for the Workspace-provisioning integration) belong to other
   features already reviewed or in scope there, and are noted but not
   re-derived.
5. Frontend: `KeyCustody.tsx` read in full (new file, 178 L) since it is the
   UI for a new required step handling a security-sensitive confirmation.
   Every other changed frontend file in the diff was read at the changed
   lines; none introduces `window.confirm`/`dangerouslySetInnerHTML`/a
   client-side secret store, the four risk classes passes 3–6 established.

## Route inventory (26/26, 24 carried forward + 2 new)

All 24 routes pass 6 enumerated are unchanged in gate (re-confirmed by
reading `onboarding.py` end to end at each row; table not reproduced here —
see `ONB4-30-onboarding.md`'s table, still accurate). Two new:

| Method | Path                   | Auth dependency                        | Compensating control                                                                                                           |
| ------ | ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/session/key-custody` | `validate_session(require_csrf=False)` | read-only; returns only a fingerprint (HMAC, never the key) and a confirmation boolean/timestamp                               |
| POST   | `/session/key-custody` | `validate_session`                     | `needs_onboarding()`; requires the system owner to already exist; fingerprint must match the live key (409 otherwise); audited |

Both resolve `organization_id` the same way every other `/session/*` route
does — from `session.data["department"]["organization_id"]`, set only by
that same session's own earlier `/session/organization` (or `/organization`)
call, never a client-supplied parameter (XC-1/XC-3 n/a, same reasoning ONB-2
already established).

The authenticated counterpart (`GET`/`POST /system-notices/encryption-key-custody`,
plus `GET /system-notices`) is a separate router, gated on
`require_permission("settings.manage")` — the correct sensitivity tier for a
security confirmation (checklist dimension 2), not org-scoped because the
encryption key and its confirmation are installation-wide, not per-tenant (by
design: one server, one key, one row per key fingerprint).

28/28 routes across both surfaces accounted for; no route lost a
compensating control.

## Verified good ✅ (independently-landed fixes, re-confirmed against current code)

- **ONB-7 — role/position editor now allowlists `permissions` keys and
  clamps priority/`is_system`.** `_check_submitted_positions`
  (`onboarding.py:2614-2651`) rejects any `permissions` key outside
  `ONBOARDING_POSITION_EDITOR_MODULE_IDS` — confirmed that set excludes
  `users`, `audit`, and any wildcard module (`onboarding.py:108-110`:
  `ONBOARDING_CORE_MODULES` + `ONBOARDING_OFFERED_MODULES` + `positions` +
  `settings`; `services/onboarding.py:46-68` lists the members: training,
  inventory, medical_supplies, scheduling, apparatus, facilities,
  storefront, elections, minutes, reports, notifications, mobile,
  integrations, prospective_members — no admin-only or global-wildcard
  module), closing the "arbitrary string key → arbitrary `{key}.*` grant"
  shape the original finding described. `_stored_priority`
  (`onboarding.py:2680-2694`) ignores the client's priority for any
  registry-known slug and clamps anything client-defined to
  `_custom_priority_ceiling()` (one below `it_manager`'s own priority,
  `onboarding.py:2659-2666`). `is_system` is now `bool(registry_defaults)`
  (`onboarding.py:2863`) rather than the client's `is_custom` flag, so an
  invented slug can no longer be stored as an undeletable system row. The
  reserved-name check (`_check_submitted_positions`'s second half) also now
  runs **before** the existing non-system roles are deleted
  (`onboarding.py:2730-2749`: the read-and-check precedes the `delete`),
  closing a sequencing gap none of passes 1–6 flagged on its own: before
  this reordering, a submission that failed the (not-yet-existing) reserved-
  name check would still have already deleted the organization's prior
  custom roles. **What remains, matching the owner decision in
  `KNOWN_LIMITATIONS.md`:** a custom position still cannot be given its own
  priority or reuse of a built-in name — an intentional narrowing of what
  the editor can express, not a residual bug.
- **ONB2-30-8 — session TTL now has an absolute 24-hour ceiling.**
  `SESSION_MAX_LIFETIME_HOURS = 24` (`onboarding.py:670-679`);
  `_session_hard_expiry`/`_slid_expiry` (`onboarding.py:681-696`) cap both
  places that slide the expiry — `get_or_create_session`
  (`onboarding.py:816-824`) and `validate_session`
  (`onboarding.py:898-934`). `validate_session` now checks the hard ceiling
  **before** the sliding one and returns a distinct 401 message ("reached
  its 24-hour limit") so the two causes are distinguishable to the
  administrator, not just internally. A session past the ceiling is not an
  outage: `get_or_create_session` falls through to minting a fresh one, and
  `_rehydrate_department_org_id` (unchanged since ONB-9, pass 1) restores the
  one piece of state every later step depends on — `organization_id` — from
  the row the earlier session's `/organization` call already created in the
  database, not from the dead session's own JSON blob. The three read-only
  routes that still slide the expiry with `require_csrf=False`
  (`/system-info`, `/security-check`, `/database-check`) are bounded by the
  same ceiling now, closing the "poll forever on the session id alone" tail
  the original finding described. **Verified by direct read; this pass adds
  no code.**
- **ONB-30-3 — self-hosted SMTP test no longer differentiates
  connection-stage failures.** `test_smtp_connection_uniform`
  (`email_test_helper.py:88-125`) is now what `verify_email_configuration`
  calls for `platform in ("selfhosted", "other")`
  (`onboarding.py:1776-1779`), including on the endpoint's own `TimeoutError`
  branch (`onboarding.py:1790-1801`, not just the inner one
  `test_smtp_connection` itself raises). Traced every exception branch in
  `test_smtp_connection` (`email_test_helper.py:220-306`) against the
  wrapper's gate (`success or details.get("connected") or "host" not in
details`): `SMTPConnectError`, the generic `SMTPException` branch (refused /
  timed out / DNS failure, the three cases the original finding named by
  name), `ssl.SSLError` raised while establishing the implicit-TLS
  connection, and the outer `TimeoutError`/generic `Exception` handlers all
  return before `details["connected"]` is ever set, so all of them fall
  through to the one uniform message and detail shape. A response is only
  ever specific (auth failure, a TLS error during `STARTTLS`) once
  `details["connected"] = True` has been set, which in the `STARTTLS` branch
  requires a completed `server.ehlo()` round-trip — i.e., the target has
  already behaved like a real SMTP server, which is the condition the
  finding's own "Verified good" note on the three OAuth-based test paths
  used for the same distinction. **One residual, not a regression and not
  new:** in the implicit-SSL branch (`encryption: "ssl"`), `connected = True`
  is set immediately once the TLS handshake completes, before any SMTP
  command is sent — unchanged by this fix, present identically before it.
  With no credentials supplied, the function can therefore return
  `success=True, "SMTP connection successful"` for _any_ TLS-terminating
  service on the probed host:port, SMTP or not. This is weaker than the
  original finding (a single boolean — "a TLS service answered here" — not
  the four-way failure fingerprint the fix closes) and is inherent to a test
  whose entire purpose is confirming reachability, the same tradeoff the
  owner's 2026-10-11 decision already accepted for the SMTP-greeting case.
  Not re-flagged as a new, separate finding: same mechanism, same accepted
  tradeoff, no new attacker capability beyond what "the test can succeed"
  already implies. `KNOWN_LIMITATIONS.md`'s existing entry already names
  "a target that greets as SMTP is distinguishable from one that does not"
  as accepted; this is the same shape one layer earlier for the SSL
  variant and needs no separate row.
- **New: onboarding's three logo-upload call sites now pass through malware
  scanning before validation.** `/organization`, `/session/department`,
  `/session/organization` (`onboarding.py:1437-1438, 1844-1848, 2437-2440`)
  all call `scan_and_validate_logo` (`upload_scanning.py:102-121`) in place
  of the bare `validate_logo_image` prior passes reviewed. It decodes the
  base64 payload, runs it through `reject_if_malicious` (fails closed per
  `is_malware_scan_enabled()`/`MalwareScanUnavailable`, the same gate every
  other upload path in the app uses — `upload_scanning.py:30-67`) before
  falling through to the existing `validate_logo_image` re-encode, and
  silently defers to that function's own 400 on genuinely undecodable input
  rather than treating a decode failure as a bypass. `user=None` is correct
  here (no account exists yet pre-System-Owner); the audit row this records
  on a detection carries no user, matching every other pre-auth path in this
  feature. **Closes a gap no prior pass named**: onboarding was previously
  the one place in the app accepting a file (even a small base64 image) with
  no malware scan at all. **Verified good, no finding** — this is additive
  hardening already landed, not something this pass needed to fix.
- **New: the authenticated key-custody surface
  (`GET /system-notices`, `GET`/`POST /system-notices/encryption-key-custody`)**
  is permission-gated at `settings.manage` (`system_notices.py` endpoints,
  all three), the correct tier for a security confirmation (checklist
  dimension 2 — not a `.view` grant on sensitive state). Not org-scoped,
  correctly: the encryption key and `encryption_key_custody` are
  installation-wide (one key, one row per fingerprint), not per-tenant.
  `KeyCustodyConfirm.key_fingerprint` is pattern-constrained to
  `^[0-9a-f]{16}$` (`schemas/system_notices.py:31`), so the confirm endpoint
  cannot be used to store or reflect arbitrary text. `key_custody_service.confirm`
  re-reads the live fingerprint and raises `ValueError` → 409 if it no longer
  matches what the caller was shown (`key_custody_service.py:62-68`), so a
  key rotated between page-load and submit is never silently confirmed
  against the new key. The race between two concurrent confirmations is
  handled correctly: `db.begin_nested()` plus the table's own
  `uq_encryption_key_custody_key` unique constraint
  (`models/onboarding.py:178-180`), with the loser's `IntegrityError` caught
  and resolved by re-reading the winner's row rather than raising
  (`key_custody_service.py:80-88`) — the same read-after-conflict shape
  CLAUDE.md pitfall #27 asks for, applied correctly to a uniqueness
  conflict rather than a counting one. `current_key_fingerprint()`
  (`core/file_encryption.py:153-155`) returns a derived `key_id`, never the
  key itself — confirmed by reading `_current_kek()`'s key-derivation path.
  No password, key material, or `ENCRYPTION_KEY` value is ever present in
  any request or response this surface sends. **Verified good, no finding.**
- **Schema/migration for the above:** `20261009_1045_7e1a3c94d2b6` creates
  `encryption_key_custody` with `confirmed_by` as `ondelete="SET NULL"` +
  `nullable=True` (Pitfall #2 compliant), guards table existence before
  creating (Pitfall #26), and is a genuine migration, not `create_all`-only.
  `validate_migrations.py --strict`: 618 revisions, single head, clean (the
  head is from this watchdog session's own, unrelated merge-conflict fix on
  a different in-flight PR earlier today — `backend_onboarding` tables
  themselves are unaffected).
- **`DepartmentInfoRequest.name`'s bound widened from 3–100 to 2–255,
  matching `OrganizationSetupCreate.name`/the `organizations.name` column**
  (`onboarding.py:432-442`) — a correctness fix (the navigation step resends
  step 1's name, so the narrower range could refuse a name step 1 already
  accepted), not a security change; the new `strip_name` validator measures
  the length after trimming, so a padded 1-character name is still refused.
  `save_department_info` now deep-copies `session.data`
  (`onboarding.py:1845-1862`) before merging the department dict rather than
  replacing it outright, preserving `organization_id` other steps depend on
  and complying with Pitfall #12's deep-copy-before-nested-mutate rule.
  Both are in scope only because they sit in files this feature owns;
  neither is itself a finding.
- **Reset's raw `Table.delete()` calls became ORM-level `delete(Model)`
  with `execution_options(synchronize_session=False)`**
  (`onboarding.py:3065-3108`) — a SQLAlchemy 2.0-style modernization with the
  identical DDL/ordering/exception handling pass 1's ONB-1 established;
  re-confirmed the delete order (sessions → status → Location/Facility →
  user_positions → users → roles → organizations) and the
  `ProgrammingError`/`OperationalError`-only catch on the raw
  `user_positions` delete are both unchanged. No behavior difference.
- **`_merge_default_permissions`'s dedup rewrite** (`onboarding.py:2547-2551`,
  `dict.fromkeys` in place of a hand-rolled `seen` set) — same output, same
  order-preserving semantics; read side-by-side with the prior version to
  confirm no behavior change.
- **No LIKE/ILIKE, no CSV export, no new nested-JSON mutation without
  `copy.deepcopy`/`flag_modified`** in this pass's diff, beyond the
  `save_department_info` deep-copy already noted above. N/A / no violation.

## Findings

None. Every real change in this pass's diff is either already-landed,
independently-engineered hardening (verified above) or a correctness fix
with no security dimension. No new finding to fix or flag.

## Re-verification of prior findings (all hold, no regressions)

- **ONB-1 through ONB-6, ONB-9, ONB2-30-1 through ONB2-30-8 (now resolved,
  see above), ONB3-30-1 through ONB3-30-3, ONB4-30-1, ONB4-30-2** — all
  re-confirmed present and unregressed by direct read of every call site
  cited in `ONB4-30-onboarding.md`, each still at an equivalent or
  renumbered line after this pass's diff.
- **Duplicate `role.id` within one `/session/roles` payload still raises an
  unhandled `IntegrityError` → 500** — re-confirmed OPEN. No dedup of the
  submitted list's own `id` values anywhere in `save_session_roles`
  (`onboarding.py:2730-` through the creation loop); `_check_submitted_positions`
  only checks a custom position's id against _existing_ system roles, not
  against sibling entries in the same payload. Pre-existing, larger fix
  than a cap, unchanged from pass 6's assessment.
- **`POST /organization` still missing the `except Exception` its twin
  `/session/organization` has** — re-confirmed OPEN (`onboarding.py:1394`
  area: only `except ValueError`). Cosmetic robustness gap, not security —
  `safe_error_detail`/production `DEBUG=false` still govern an uncaught
  exception's response either way.
- **`ITTeamMemberRequest.email` is `str`, not `EmailStr`**
  (`onboarding.py:488`) — re-confirmed unchanged, intentionally loose to
  match `create_it_team_users`'s skip-if-invalid behavior.

## Schema & migration notes

One new migration this pass's window: `20261009_1045_7e1a3c94d2b6` (see
Verified good above). `onboarding_status`/`onboarding_sessions` unchanged
since pass 2. `validate_migrations.py --strict`: 618 revisions, single head
`1117b642643b`, clean.

## Guard tests added

None by this pass — every behavior change this pass reviewed already shipped
with its own guard test from the engineering work that made it (per
`KNOWN_LIMITATIONS.md`: `tests/test_onboarding_role_clamps.py`,
`tests/test_onboarding_session_lifetime_cap.py`,
`tests/test_onboarding_smtp_uniform_errors.py`), each spot-checked to exist
and pass in the scoped run below.

## Completion gate

| Check                                                                                                | Result                                         |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/`                                                          | ✅ 0 violations                                |
| `python3.13 -m black --check app/ tests/ alembic/`                                                   | ✅ clean (2,423 files unchanged)               |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned)                           | ✅ clean                                       |
| `python3.13 scripts/validate_migrations.py --strict`                                                 | ✅ 618 revisions, single head `1117b642643b`   |
| `pytest tests/ -q -k "onboard or org_template or template_service or key_custody or system_notices"` | ✅ 320 passed, 1 skipped (pywebpush, env-only) |
| `npm run typecheck` (frontend)                                                                       | ✅ 0 errors                                    |
| `npm run lint` (frontend, `--max-warnings 10`)                                                       | ✅ 0 errors, 0 warnings                        |
