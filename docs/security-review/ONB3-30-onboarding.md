# Security Review — Onboarding (passes 3-5)

**Prefix:** `ONB3` · **Iteration:** 30 (rotation pass 3; prior: module-audit
iteration 25, app-review B25 (4 passes), security-review pass 1 — PR #1913 +
follow-up (`docs/security-review/ONB2-30-onboarding.md`), security-review
pass 2 — PR #2093 (`docs/security-review/ONB-30-onboarding.md`))
· **Reviewed:** 2026-09-06/07 (pass 3), 2026-09-13 (pass 4), 2026-10-04
(pass 5) · **PR:** [#2358](https://github.com/thegspiro/the-logbook/pull/2358)
(pass 3), [#2521](https://github.com/thegspiro/the-logbook/pull/2521)
(pass 4)

---

## Pass 5 (2026-10-04)

**Method: delta-focused re-verification**, per the rotation's established
pass-3+ convention. Pass 4's baseline is PR #2521's head commit
(`abd4fefc`, merged `2026-09-13T20:57:11Z` into `main` at `543445c0`). This
worktree's shallow clone did not carry that commit (older than its fetch
horizon), so it was fetched directly (`git fetch origin abd4fefc... --depth=1`)
and diffed against current `origin/main` rather than assumed reachable.

1. Read `CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md` (passes 4-6,
   whose 13 standing sweep classes are whole-codebase and therefore cover
   this feature's files too), `docs/module-audit/onboarding.md` and
   `docs/app-review/onboarding.md` in full — both are fully superseded by
   this file's passes 1-4, no item in either is open that is not already
   tracked here (confirmed by reading both end to end, not assumed from
   their own "re-confirmed" language).
2. `git diff --stat` from pass 4's baseline against `origin/main`, scoped to
   this feature's file list (`onboarding.py`, `services/onboarding.py`,
   `models/onboarding.py`, `utils/onboarding_security.py`,
   `template_service.py`, `org_template_service.py`,
   `org_template_registry.py`, `email_test_helper.py`,
   `microsoft_oauth.py`, `email_providers.py`, and
   `frontend/src/modules/onboarding/`). **No diff** in `models/onboarding.py`,
   `utils/onboarding_security.py`, `template_service.py`,
   `org_template_service.py`, `org_template_registry.py`,
   `microsoft_oauth.py` — confirmed empty via `git diff --stat`, so every
   pass 3/4 finding scoped to those files is re-confirmed with the same
   confidence as a fresh read.
3. **Read in full, end to end:** the diffs to `onboarding.py` (46 lines),
   `services/onboarding.py` (4 lines), `email_providers.py` (80 lines),
   `email_test_helper.py` (4 lines) — small enough that sampling would have
   added nothing. Also read in full: `suggestion_service.py`'s
   `seed_compliance_box` (new call site from `services/onboarding.py`) and
   `email_service.py`'s `_cloudflare_endpoint`/`is_valid_cloudflare_account_id`
   use (the send-time consumer of `email_providers.py`'s new validator),
   neither of which is in this feature's own file list but both of which a
   one-line addition in this feature's files now calls into.
4. **Re-enumerated all 24 routes** by grepping every `@router.get/post`
   decorator against the current file and re-reading each route's guard
   chain directly — see Route inventory. 24/24, unchanged shape from pass 4.
5. **Frontend**, 52 files changed (1,382 insertions / 428 deletions) —
   almost all wording/UX/accessibility polish and a password-strength UI
   addition mirroring server-side rules that already existed
   (`core/security.py`'s sequential/repeated-character checks). Swept (not
   read line-by-line, matching pass 3/4's stated judgment that this class of
   frontend risk is server-enforced) for the same four risk classes:
   `window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, secrets
   written to `localStorage`/`sessionStorage`, and any raised/removed
   client-side cap that a server-side cap doesn't independently enforce —
   **0 hits** on all four. Read in full rather than swept: the diffs to
   `AdminUserCreation.tsx`, `OrganizationSetup.tsx`, `api-client.ts`,
   `errorHandler.ts`, and `useOnboardingSession.ts` (the files touching
   session lifecycle, password validation, or error-message construction)
   because those are the shapes a sweep's keyword list would not catch.

### What changed, and why each is verified good (no new finding)

1. **`services/onboarding.py`: `create_organization` now seeds a default
   "Compliance" suggestion box** (`SuggestionService.seed_compliance_box`,
   new call after `_create_default_roles`). Read in full: org-scoped on
   both its existence check and its position lookup (`organization_id ==
str(organization_id)` on both queries, where `organization_id` is the
   just-created org's own id — not client-suppliable), flushes without
   committing (same transaction as the org it belongs to, consistent with
   every other step of `create_organization`), and sets `is_active=False`
   when no position holds the `compliance_officer` slug rather than
   assigning a reviewer that doesn't exist. No new grant, no new
   client-controlled input — `compliance_officer` is a pre-existing
   `DEFAULT_POSITIONS` entry in `app/core/permissions.py`, unchanged by this
   diff. **Verified good.**
2. **`onboarding.py` / `email_providers.py`: Cloudflare account ID
   validation centralized into one function
   (`is_valid_cloudflare_account_id`, `[a-f0-9]{32}`) and checked at three
   points** — the onboarding `/test/email` connection test
   (`email_test_helper.py`), `invalid_for_enabled` (the settings-save
   pre-flight check both `/session/email` and the post-setup settings
   screen route through), and `email_service.py:930`'s `_cloudflare_endpoint`
   at **send time**, immediately before the account id is interpolated into
   the Cloudflare API URL. This closes the exact gap checklist item §4's
   "stored outbound URLs are re-validated at send time" asks about, for a
   value that previously had three independent regex copies (one per call
   site) rather than one. The regex is anchored (`fullmatch`) and rejects
   any value containing `/`, `.`, or non-hex characters, so a malformed
   account id cannot alter the URL path or redirect the request to a
   different host. **Verified good** — a correctness/consolidation fix that
   also closes a latent TOCTOU gap (the write-time and send-time checks
   could previously drift since they were different regex literals; now
   they are the same function).
3. **`onboarding.py` / `email_providers.py`: a stored config with
   `platform: "cloudflare"` and `enabled: true` now requires `from_email`,
   `cloudflare_account_id` and `cloudflare_api_token` to be present
   (`missing_for_enabled`), and a present-but-malformed account id is
   rejected at save time too (`invalid_for_enabled`)** — previously only the
   Microsoft-OAuth branch of `invalid_for_enabled` existed; Cloudflare had no
   completeness check at all, so a config missing its account id would save
   as "enabled" and then silently fail to send (or, before this pass's
   verified-good item 2 made the check universal, could in principle have
   sent to a malformed URL). Data-integrity fix, not a new input-validation
   gap: no new client-controlled field reaches a dangerous sink, this makes
   an existing one fail at save time instead of at send time. **Verified
   good.**
4. **`onboarding.py` `verify_email_configuration`: a self-hosted/other SMTP
   config with a username but no password is now rejected with a clear
   error** instead of silently being read by `test_smtp_connection` as "no
   authentication" and reported as a successful connection test. Narrows,
   rather than touches, the already-flagged ONB-30-3 SMTP-SSRF gap below —
   it changes what counts as _complete_, not what hosts/ports are reachable.
   **Verified good.**
5. **`onboarding.py` `reset_onboarding`: the response now clears the
   caller's `access_token`/`refresh_token`/`csrf_token` cookies**
   (`_clear_auth_cookies`, imported from `app.api.v1.endpoints.auth` — the
   same helper `/auth/logout` already uses). Before this, a reset performed
   while authenticated as the just-deleted System Owner left stale auth
   cookies in the browser, which made every subsequent request (including
   the next `/onboarding/start`) fail `get_optional_current_user`'s lookup
   for a user row that no longer existed — not a security regression in
   either direction (the cookies named a user who no longer exists, so they
   authenticate nothing; clearing them is strictly a correctness fix for the
   "start again" flow `/reset`'s own response promises). **Verified good.**
6. **Frontend: `OrganizationSetup.tsx`'s session-initialization effect no
   longer retries automatically on failure.** Previously, a failed
   `initializeSession()` left `sessionLoading` at `false`, which re-triggered
   the same `useEffect`, which could fail again — a tight client-side retry
   loop the pass's own commit message says reached "about 75 requests a
   second" into the rate-limited `/start` endpoint after a reset left stale
   credentials in the browser. Fixed with a `useRef` latch
   (`sessionAttempted`) that lets the effect run at most once per mount; a
   manual retry now requires an explicit Continue click. This is a
   client-side self-inflicted-DoS fix, not a backend change — relevant here
   because it was hammering this feature's own `_rate_limit_onboarding_start`
   dependency, and the rate limiter itself (server-side, unaffected by this
   client fix) is what had been containing the blast radius rather than
   this becoming a real abuse vector. **Verified good.**
7. **Frontend: `AdminUserCreation.tsx`'s password-strength checklist gained
   two checks (`noSequence`/`noRepeat`) that mirror
   `core/security.py`'s existing server-side rejection of sequential
   (`123`, `abc`) and repeated-character runs** — confirmed server-enforced
   already (`backend/app/core/security.py:151-190`, unchanged by this
   delta), so this closes a UX gap (a password rejected only after submit)
   rather than adding a new security boundary. Also added: an effect that
   auto-advances past this step if `/status` reports `admin_user.completed`,
   fixing a dead-end on Back navigation after the account already exists —
   reads `GET /onboarding/status`, which is unauthenticated by design and
   unaffected. **Verified good.**

None of the above, nor anything else in the delta, touches
`create_system_owner`'s lock (ONB3-30-3, confirmed still present at
`services/onboarding.py:1348-1350` — both the `OnboardingStatus` parent-row
lock and the `select(User.id).limit(1).with_for_update()` locking-read
existence check), `get_or_create_session`/`_require_owner_authority`
(confirmed still present and unchanged at `onboarding.py:696-765`), or
`validate_session`'s sliding-TTL renewal (confirmed still present and
unchanged, `onboarding.py:879`).

## Re-verification of pass 1-4 findings (all hold, no regressions)

Every still-open item was re-checked against current code directly, not
re-derived from the write-up:

- **ONB3-30-3** (System Owner creation race) — ✅ **FIXED, re-confirmed
  intact.** Both halves of the lock (`.with_for_update()` on
  `OnboardingStatus`, and the existence check itself as a locking read) are
  present at `services/onboarding.py:1348-1350`, unchanged since pass 4.
  `tests/test_onboarding_owner_race.py` (both the integration test and
  `TestTheLockIsDeclared`'s source-level assertions) still passes.
- **ONBOARD-7** (onboarding-status singleton race) — ✅ **FIXED, re-confirmed
  intact.** Unique `singleton` column and `begin_nested()` retry loop still
  present (`services/onboarding.py:252,337,364`).
- **ONB-7** (role editor accepts client-controlled `permissions`/`priority`/
  `is_custom`/arbitrary `module_id` keys) — 🚩 **re-confirmed OPEN, unchanged.**
  `save_session_roles` (`onboarding.py:2442`) and `expand_module_checkboxes`
  (`onboarding.py:2331`) are byte-identical to pass 4 (no diff in this
  pass's `git diff --stat`). Still a product decision (clamping priority,
  rejecting system-role re-mint, allowlisting `module_id` would change what
  the legitimate onboarding role editor can express), not a drive-by fix.
- **ONB2-30-8** (sliding 30-minute session TTL, no absolute cap; three GET
  routes slide it with `require_csrf=False`) — 🚩 **re-confirmed OPEN,
  unchanged.** `onboarding.py:879`'s renewal and the three routes'
  `validate_session(request, db, require_csrf=False)` calls at
  `/system-info`, `/security-check`, `/database-check` are unchanged.
- **ONB-30-3** (`/test/email`'s self-hosted SMTP path has no SSRF/
  private-network protection) — 🚩 **re-confirmed OPEN, unchanged in its
  core gap.** `test_smtp_connection` (`email_test_helper.py:87`) still
  connects to a fully client-supplied `smtpHost`/`smtpPort` via raw
  `smtplib` with no hostname/IP validation — narrowed only in scope by this
  pass's item 4 above (a username-without-password config is now rejected
  before the connection is even attempted, which does not change which
  hosts/ports are reachable). Not fixed for the same reason as every prior
  pass: blocking private IPs would break the legitimate on-premises SMTP
  relay case this app's audience uses.
- **ONB-8 audit-durability residual** (`reset_initiated` logged in the same
  transaction as `/reset`'s deletes) — 🚩 **re-confirmed OPEN, unchanged.**
  Confirmed directly at `onboarding.py:2787-2800`; the new cookie-clearing
  response (item 5 above) is constructed after this `try` block's logic and
  does not change the transaction boundary.
- **ONB-1 through ONB-6, ONB-9, ONB2-30-1 through ONB2-30-7, ONB3-30-1,
  ONB3-30-2** — all ✅ **FIXED/verified-good, re-confirmed intact**, via the
  byte-identical-file check for the files they live in (no diff this pass in
  `models/onboarding.py`, `utils/onboarding_security.py`,
  `template_service.py`, `org_template_service.py`,
  `org_template_registry.py`), and by direct re-read for the portions of
  `onboarding.py`/`services/onboarding.py` not touched by this pass's six
  items above.
- **Duplicate `role.id` within one `/session/roles` payload raises an
  unhandled `IntegrityError` → 500** — 🚩 re-confirmed OPEN, unchanged (no
  dedup logic in current `save_session_roles`, same as pass 3/4).
- **`POST /organization` missing the `except Exception` its twin
  `/session/organization` has** — re-confirmed unchanged (cosmetic
  robustness gap, not a security issue).
- **`ITTeamMemberRequest.email` is `str`, not `EmailStr`** — re-confirmed
  unchanged, intentionally loose.

## Route inventory (re-enumerated, 24/24)

Re-walked every `@router.get`/`@router.post` decorator in current
`onboarding.py` and read each handler's guard chain directly. Unchanged from
pass 3/4's table for every route. No route lost or gained a compensating
control; no route outside the documented 24 carries none.

| Route                        | Auth                                                                                                | Unchanged since                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `GET /status`                | none (rate-limited, ONB-8 minimal post-completion response)                                         | pass 2                               |
| `POST /start`                | none (rate-limited; `_require_owner_authority` once an owner exists)                                | pass 4                               |
| `GET /system-info`           | `validate_session(require_csrf=False)` (rate-limited)                                               | pass 2                               |
| `GET /security-check`        | `validate_session(require_csrf=False)` (rate-limited)                                               | pass 2                               |
| `GET /database-check`        | `validate_session(require_csrf=False)` (rate-limited; generic error)                                | pass 2                               |
| `POST /organization`         | none (session not yet mintable; single-org guard)                                                   | pass 2                               |
| `POST /system-owner`         | `validate_session` (rate-limited; locked single-owner guard, ONB3-30-3)                             | pass 4 (lock)                        |
| `POST /modules`              | `validate_session` (`needs_onboarding()`)                                                           | pass 2                               |
| `POST /notifications`        | `validate_session` (`needs_onboarding()`)                                                           | pass 2                               |
| `POST /complete`             | `validate_session` (`needs_onboarding()`; one-way latch; email-completeness pre-flight)             | pass 3                               |
| `POST /test/email`           | `validate_session` (rate-limited; SMTP SSRF gap open, ONB-30-3)                                     | pass 2                               |
| `POST /session/department`   | `validate_session` (`needs_onboarding()`)                                                           | pass 2                               |
| `POST /session/email`        | `validate_session` (`needs_onboarding()`; encrypted at rest; completeness pre-flight)               | pass 3                               |
| `POST /session/file-storage` | `validate_session` (`needs_onboarding()`; encrypted at rest)                                        | pass 1                               |
| `POST /session/auth`         | `validate_session` (`needs_onboarding()`)                                                           | pass 1                               |
| `POST /session/it-team`      | `validate_session` (`needs_onboarding()`; capped 50)                                                | pass 1                               |
| `POST /session/stations`     | `validate_session` (`needs_onboarding()`; capped 50)                                                | pass 2                               |
| `POST /session/apparatus`    | `validate_session` (`needs_onboarding()`; capped 100)                                               | pass 2                               |
| `POST /session/modules`      | `validate_session` (`needs_onboarding()`; module allowlist)                                         | pass 1                               |
| `POST /session/organization` | `validate_session` (`needs_onboarding()`; single-org guard)                                         | pass 2                               |
| `POST /session/roles`        | `validate_session` (`needs_onboarding()`; outer cap 200, per-role `permissions` cap 50; ONB-7 open) | pass 3 (cap)                         |
| `POST /session/positions`    | delegates to `/session/roles` (inherits all guards)                                                 | pass 1                               |
| `GET /session/data`          | `validate_session` (CSRF required; allowlisted fields only)                                         | pass 1                               |
| `POST /reset`                | `validate_session` (rate-limited; `_require_owner_authority`; audit log; now clears auth cookies)   | pass 4 (authority); pass 5 (cookies) |

24/24 accounted for.

## Findings

**0 new findings this pass.** Six real changes landed in this feature's own
files since pass 4 (items 1-7 above, minus one UI-only/accessibility change
not itemized); every one is a correctness or security-hardening fix already
shipped and verified good, not a new vulnerability. Every previously-open
finding (ONB-7, ONB2-30-8, ONB-30-3, the ONB-8 audit-durability residual, the
duplicate-role-id 500) was re-verified unchanged against current code. Every
previously-fixed finding (ONB3-30-3, ONBOARD-7, ONB-1 through ONB-9,
ONB2-30-1 through ONB2-30-8, ONB3-30-1, ONB3-30-2) was re-confirmed intact.

## Schema & migration notes

No new model or column in this feature's own tables
(`onboarding_status`, `onboarding_sessions`, `onboarding_checklist` — all
unchanged since pass 2). `validate_migrations.py --strict`: 509 revisions
(up from pass 4's 444 — unrelated feature work across the rest of the
rotation), single head `d058b5e7c1f4`, no duplicate ids.

## Guard tests added

None. No new finding to close a class on this pass; the six real changes
above are each either already covered by existing guard tests
(`test_onboarding_owner_race.py`, `test_onboarding_request_caps.py`) or are
correctness fixes with no security-boundary shape that this rotation's
existing guard-test conventions cover (e.g. a client-side retry-loop fix, an
added-field completeness check).

## Completion gate (pass 5)

| Check                                                                                             | Result                                         |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `python3 -m flake8 app/ tests/ alembic/` (7.4.1, with `flake8-pytest-style` 2.2.0; CI pins 7.3.0) | ✅ 0 violations                                |
| `python3 -m black --check app/ tests/ alembic/` (26.5.1, matches CI's pin)                        | ✅ clean, 1853 files unchanged                 |
| `python3 -m isort --check-only app/ tests/ alembic/` (9.0.1, matches CI's pin)                    | ✅ clean                                       |
| `python3 scripts/validate_migrations.py --strict`                                                 | ✅ 509 revisions, single head `d058b5e7c1f4`   |
| `pytest tests/ -q -k "onboard or org_template or template_service"`                               | ✅ 255 passed, 1 skipped (pywebpush, env-only) |
| `npm ci` (this worktree's `node_modules` was unpopulated — fresh worktree)                        | ✅ installed clean (621 packages)              |
| `npm run typecheck` (aliased 7.0.2 compiler, `tsc-native.mjs`)                                    | ✅ 0 errors                                    |
| `npm run lint` (`--max-warnings 10`)                                                              | ✅ 0 errors, 0 warnings                        |
| `npx vitest run src/modules/onboarding` (scoped)                                                  | ✅ 442 passed (31 files)                       |

No application code changed this pass — every item above is a
re-verification or a read of already-shipped code, so there is no fix diff
to run a behavior-neutrality check against.

---

## Pass 4 (2026-09-13)

**Which file is latest, and why this one:** three findings files exist for
this feature and none of their name suffixes are chronological —
`ONB2-30-onboarding.md` is its own "pass 1" (PR #1913 + a same-day follow-up,
merged 2026-08-27, `PROGRESS.md` line ~13482), `ONB-30-onboarding.md` (no
digit suffix) is its own "**pass 2**" (PR #2093, merged 2026-08-31,
`PROGRESS.md` line ~10236) and names `ONB2` as its predecessor, and this file,
`ONB3-30-onboarding.md`, is its own "pass 3" (PR #2358, merged 2026-09-07,
`PROGRESS.md` line ~16996/4078) and names both prior files as its own
predecessors in order. So the suffix and the chronology agree here (`ONB2` →
`ONB` → `ONB3`, i.e. 1 → 2 → 3) even though the plain, unsuffixed file sits
_between_ two numbered ones — cross-checked three independent ways: each
file's own self-description ("pass N", "prior: ..."), `PROGRESS.md`'s running
log (grep for `Onboarding`/`ONB`, giving merge dates 2026-08-27 <
2026-08-31 < 2026-09-07), and each file's cited PR number against real PR
merge order. This is therefore continued here as **Pass 4**, one more than
this file's own highest pass number, per the task's instruction — not
appended to `ONB2` or `ONB` despite `ONB3` numerically sorting _after_ the
plain `ONB` file, which is the opposite ordering trap the identically-shaped
`RPT`/`RPT2` fragmentation in Feature 29 had (there, alphabetical order
matched chronological order in neither direction reliably; here it happens to
match once you read each file's own stated position rather than trusting the
suffix alone).

**Scope of this pass: everything that changed in this feature's own files
since pass 3's baseline** (`services/onboarding.py`, `models/onboarding.py`,
`api/v1/onboarding.py` — the only three of this feature's files with any
diff; `email_test_helper.py`/`microsoft_oauth.py`/`email_providers.py`/
`template_service.py`/`org_template_service.py`/`org_template_registry.py`/
`utils/onboarding_security.py` confirmed byte-identical via
`git diff --quiet f0bda691..origin/main`, so every pass-3 finding scoped to
them is re-confirmed with the same confidence as a fresh read). Pass 3's
merge commit is `f0bda691`. `git diff --stat` against it: `onboarding.py`
+292/-, `models/onboarding.py` +28/-, `services/onboarding.py` +367/-; 565
insertions / 122 deletions combined. Read in full: both diffs, end to end —
not sampled, given the size and the fact that one of the two changes
(`get_or_create_session`'s guard) alters who can reach the bootstrap flow at
all. A large amount of unrelated onboarding feature work also landed in this
window (33 commits touching the frontend module and, incidentally, nothing
in this feature's own three backend files beyond the two changes below) —
`RoleSetup.tsx`/`positionTemplates.ts`/the rank-ladder and membership-ladder
screens grew substantially; re-swept at the same sampling depth pass 3 used
(grep for the frontend risk classes: `window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, secrets in `localStorage`/`sessionStorage`) —
**clean, 0 hits**, same conclusion as pass 3.

**Two backend changes account for the whole delta, both already-merged
production code, not proposals:**

1. **ONBOARD-7 (`docs/KNOWN_LIMITATIONS.md`, resolved 2026-09-12,
   migration `6ab7d903fae5`)** — `start_onboarding` was a read-then-write
   race on `onboarding_status` (two concurrent first-run page loads both read
   "none exists" and both inserted; `needs_onboarding()` then raised
   `MultipleResultsFound` and `/status` 500'd permanently). Fixed with a
   unique `singleton` column, a `begin_nested()`/rollback/retry loop in
   `start_onboarding`, and `.first()` instead of `scalar_one_or_none()` so an
   already-duplicated install recovers too. This landed and was verified
   _before_ this rotation pass started (the task brief's "recent
   onboarding-singleton migration" — confirmed already in place, not
   something this pass needed to add). Re-verified against current code
   (model's `UniqueConstraint`, the retry loop, the `.first()` reads) and
   against a real database: 8 consecutive runs of a genuine two-connection
   concurrent-insert reproduction (mirroring `KNOWN_LIMITATIONS.md`'s own
   "20 concurrent, verified against a real database" claim) all landed
   exactly one row. **Holds.**
2. **Onboarding resumability (commit `534bea6`, then narrowed by `4b708e8`'s
   step reorder) — no prior write-up; new to this pass.** `get_or_create_session`
   used to refuse a new session once _any_ organization existed, which made a
   lapsed 30-minute session unrecoverable (no System Owner exists yet at step
   1, so `/reset` had nothing to authenticate against either — dead install).
   Fixed by keying the refusal on `needs_onboarding() == False` (completion)
   instead, and introducing `_require_owner_authority`: once a System Owner
   exists, only that owner may mint a new session or reset; **before one
   exists, minting a session is unauthenticated by design** (stated in the
   fix's own commit message and asserted directly by
   `test_onboarding_session_resume.py::TestOwnerAuthority::
test_open_before_any_owner_exists`). This is a genuine, deliberate widening
   of who can obtain a valid onboarding session — previously bounded to
   "before step 1's org creation" (a near-instantaneous window on any
   ordinary install), now bounded to "before step 2's owner creation." The
   step reorder (`4b708e8`, landed the same window, its own commit message:
   "Identity is second so the remainder of setup belongs to a real account
   rather than to an anonymous 30-minute session") appears to have been
   written specifically to narrow this back down to two adjacent steps
   rather than the eight-step gap the resumability fix would otherwise have
   opened (System Owner creation was step 9 before the reorder, per
   `534bea6`'s own commit message). Net effect on current `main`: **any
   unauthenticated caller can obtain a valid onboarding session at any point
   between `POST /organization` and `POST /system-owner` succeeding** —
   verified this is intentional and tested as such, not an oversight, so not
   itself re-flagged as a new finding. But see **ONB3-30-3** below: this
   widened window is what makes a pre-existing gap newly and directly
   reachable by an unrelated caller rather than only by whichever single
   session already existed.

### ONB3-30-3 — HIGH — `create_system_owner`'s single-owner guard was an unlocked read-then-write; two concurrent callers both became the System Owner — ✅ FIXED

**What:** `OnboardingService.create_system_owner` (the handler behind
`POST /system-owner`) refused a second System Owner by reading "does any user
row exist" and then creating one, with nothing serializing the two —
the exact CLAUDE.md pitfall #27 shape ("a capacity check is a read-then-write
and needs the row locked"), and the exact shape ONBOARD-7 had just fixed one
table over for `onboarding_status`. ONB-2 (module-audit iteration 25,
2026-08) added this guard specifically to stop a _replayed single session_
from minting several owners; it was never load-tested against two
_independent_ concurrent callers, and until this pass there was no
documented way for an independent caller to reach `/system-owner` at all
except in the sub-millisecond pre-organization window.

**Where:** `backend/app/services/onboarding.py`, `create_system_owner`
(the guard sat at what was line 1325: `existing_user = await
self.db.execute(select(User.id).limit(1))`).

**Why this pass, not pass 3 or earlier:** the guard's code did not change
this pass — what changed is reachability. Per the resumability fix above,
any unauthenticated caller can now mint their own onboarding session during
the `/organization`-succeeded-but-`/system-owner`-not-yet-called window,
which — for an operator who fills the Organization form, submits it, and
takes even a few seconds before submitting the System Owner form on the very
next screen — is a real, if usually short, window on a network-reachable
instance. `validate_session` on `/system-owner` only requires _a_ valid
onboarding session, not any particular one, and `_require_owner_authority`
(the new resumability guard) does not apply to `/system-owner` at all — it
gates `/start` and `/reset`, not this route.

**Failure scenario, reproduced against a real database (not mocked), 8/8
runs:** two independent `AsyncSession`s, each on its own connection, both
call `create_system_owner` for the same organization within milliseconds of
each other (`asyncio.gather`) with distinct usernames/emails. Before the fix:
**both succeeded** — 2 rows in `users`, two accounts each holding the
`it_manager` position's wildcard `*` permission grant on the real,
freshly-provisioned organization. Script and output recorded in this PR's
description. This is precisely the "two people racing to claim initial-admin"
shape the task brief named.

**Impact:** HIGH. An attacker who wins this race gets full, unrestricted
administrative access to the department's real production instance — read
every member's PII, reconfigure permissions, disable audit logging, exfiltrate
data — indistinguishable at the account level from the legitimate operator's
own owner account, and the legitimate operator's own `/system-owner` call
then fails with "a system owner has already been created," which they would
most likely read as a transient error and retry rather than recognize as
"someone else just took this."

**Fix:** locks the `onboarding_status` singleton row
(`select(OnboardingStatus).with_for_update()`) before the existence check —
the same "lock the parent, not the not-yet-existing conflicting row" pattern
CLAUDE.md pitfall #27 and ONBOARD-7 both use, since there is no `User` row to
lock until one caller has already won. Critically, **the existence check
itself is now also a locking read** (`select(User.id).limit(1)
.with_for_update()`), not merely guarded by the parent lock — per pitfall
#27's own documented gotcha, a plain `SELECT` under InnoDB's REPEATABLE READ
answers from the snapshot taken at this transaction's first read, so the
loser (having already read once, earlier in the same request) would still
see zero users after being released from the lock, and would create a second
owner anyway. Both halves were necessary; verified by testing an
intermediate version with only the parent lock, which still let both callers
through for exactly this reason.

**Verification:** the reproduction script (2 real, independently-committing
connections, `asyncio.gather`) was re-run 8 times against the fixed code:
**8/8 → exactly 1 success, 1 row in `users`**. A permanent regression test,
`backend/tests/test_onboarding_owner_race.py`, reproduces the same shape
using the established two-connection pattern from
`test_auth_lockout_race.py` (`@pytest.mark.integration`, real
`database_manager.engine.connect()` per coroutine, not the shared
savepoint-wrapped `db_session` fixture, which cannot show a lost update since
there is no second connection to lose it to) plus two source-level guards so
the fix cannot be quietly reverted even where MySQL is unavailable. Verified
to **fail** (2 successes, not 1) with the fix reverted (`git stash`), and to
**pass** restored, in both the DB-backed test and the standalone repro
script.

**Guard test added:** `tests/test_onboarding_owner_race.py` —
`TestConcurrentSystemOwnerCreation::
test_two_concurrent_callers_produce_exactly_one_owner` (integration,
real MySQL, 2 connections) plus `TestTheLockIsDeclared`'s two source-level
assertions (the parent-row lock and the locking-read existence check are
each present in `create_system_owner`'s source).

## Re-verification of pass 1-3 findings (all hold, no regressions)

All prior findings were re-checked against current code, not re-derived.
`services/onboarding.py`'s and `models/onboarding.py`'s pass-3-reviewed
sections are unchanged apart from the two items above (confirmed by reading
the full diff, not by assuming the byte-identical-file shortcut pass 3 used
for its unchanged files — these two _did_ change).

- **ONB-1** (reset deletes `Location`/`Facility` before `users`) —
  unchanged, present in `/reset`'s delete ordering.
- **ONB-2** (single-org guard in `create_organization`; single-owner guard
  in `create_system_owner`) — the single-org guard is unchanged; the
  single-owner guard is the one just hardened by ONB3-30-3 above (the
  _check_ is unchanged, its atomicity is what was fixed).
- **ONB-3/ONB-9** (`needs_onboarding()` replay guard) — re-enumerated across
  all 24 routes this pass (see Route inventory below); present everywhere it
  was present in pass 3, unchanged.
- **ONB-4, ONB-5, ONB-6** — unchanged.
- **ONB-7** (role editor accepts client-supplied permissions/priority/
  system-flag on new roles) — re-confirmed still open, same shape;
  `save_session_roles` also gained an unrelated new feature this pass (an
  unticked seeded position is now deleted unless a member holds it, reported
  back as `removed`/`retained` rather than silently ignored) — traced by
  hand, this only affects **removal** of a role/position already in the
  database, is scoped to `existing_system_roles` (itself
  `organization_id`-filtered), explicitly protects `it_manager`/`member`, and
  checks `user_positions` before deleting — does not touch, widen, or narrow
  ONB-7's boundary (client-controlled grants on **new** roles), which remains
  a distinct, still-open, still-flagged item.
- **ONB-8** (reset re-authentication; `/status` minimal post-completion
  response; template mass-assignment) — reset re-authentication is now
  factored into the shared `_require_owner_authority` helper (used by both
  `/start`'s resume path and `/reset`), same boundary, same 403/409 split,
  confirmed by direct read; `/status` and template mass-assignment unchanged.
  Audit-durability residual (the `reset_initiated` log call shares a
  transaction with `/reset`'s deletes) — still open, unchanged.
- **ONB2-30-1 through ONB2-30-8, ONB3-30-1, ONB3-30-2** — all unchanged
  (confirmed via the byte-identical-file check for the files they live in,
  or by direct re-read for `onboarding.py`'s portions not touched by the two
  changes above). ONB2-30-8 (sliding session TTL, no absolute cap, three GET
  routes slide it without CSRF) — still open, unchanged.
- **ONB-30-3** (self-hosted SMTP path has no SSRF/private-network
  protection) — `email_test_helper.py` confirmed byte-identical to pass 3;
  still open, unchanged, for the same reason (blocking private IPs would
  break the legitimate on-premises-relay case).

## Route inventory (re-enumerated, 24/24)

Re-walked every `@router.get`/`@router.post` decorator in current
`onboarding.py` (24 found, matching pass 1-3's count and the SEC-00
baseline) and grepped each handler's body for `validate_session(` and
`needs_onboarding()`. Unchanged from pass 3's table for every route except
`/start` and `/reset`, whose guard chains now go through the new
`_require_owner_authority` (documented above) in addition to their existing
checks. No route lost a compensating control; no route outside the
documented 24 carries none. `/session/positions` still has neither
`validate_session` nor `needs_onboarding` in its own body by design — it
delegates to `save_session_roles`, which has both, confirmed by direct read
of the delegation call.

## Additional checks this pass

- **Tenant isolation (XC-1/XC-3):** unchanged conclusion from pass 3 — this
  feature is single-org by design (ONB-2), so there is no second tenant to
  leak across. The new `_rehydrate_department_org_id` helper (points a
  freshly-minted session at the one existing organization, needed by the
  resumability fix so `/session/stations`/`/session/apparatus` don't reject
  a setup whose org demonstrably exists) reads the organization by
  `order_by(Organization.created_at.asc()).limit(1)` with no client input
  involved — not client-suppliable, and correct precisely because
  single-instance onboarding provisions exactly one organization (ONB-2).
- **JSON-column mutation (Pitfall #12):** `_persist_session_data_to_org`'s
  new membership-counter read-back (`org_settings["membership_id"] =
copy.deepcopy(live_membership_id)`) and the new membership-tier default
  (`org_settings.setdefault("membership_tiers", ...)`) both operate on the
  same `copy.deepcopy(organization.settings or {})` snapshot this function
  already used pre-pass-4 (ONB-30 pass 2 verified this deep-copy) — no new
  shallow-copy-then-mutate introduced. `_rehydrate_department_org_id`
  reassigns the whole `session.data` mapping (`session.data = {**data,
"department": department}`) rather than mutating a nested key in place —
  correct, and its own comment says why (`MutableDict` only auto-tracks
  top-level key changes).
- **Membership numbering (`generate_next_membership_id`, called from the new
  IT-team/System-Owner numbering code):** not this feature's own code —
  lives in `OrganizationService`, already locks the organization row
  (`.with_for_update()`) and deep-copies `settings` before mutating the
  counter. Checked only for correct usage from onboarding's call sites (both
  pass `UUID(organization_id)` from the session/org context, no client
  override) — correct, no new finding.
- **Rank resolution for IT-team contacts (`_deferred_rank`,
  `resolve_configured_rank_code`):** org-scoped (`organization_id` is a
  required parameter, not client-suppliable — it comes from the session's
  own department context), fails soft (drops an unresolvable rank with a
  `logger.warning`, never raises) — cannot fail the whole of setup over an
  optional field, and cannot resurrect a rank the department has since
  deleted from its own ladder. No finding.
- **Frontend module (`modules/onboarding/`):** re-swept (not read
  line-by-line, matching pass 3's stated judgment that this class of
  frontend risk is server-enforced) for `window.confirm`/`alert`/`prompt`,
  `dangerouslySetInnerHTML`, and secrets written to
  `localStorage`/`sessionStorage` — **0 hits**, same as pass 3.
  `sessionStorage`/`localStorage` writes found are all non-sensitive (CSRF
  token, navigation-layout preference, a `has_session` flag) — none carry a
  password, API key, or config secret; `AdminUserCreation.tsx` still has its
  own `// SECURITY CRITICAL: Send password to server (NEVER sessionStorage!)`
  comment guarding the one field that would matter.

## Completion gate (pass 4)

| Check                                                            | Result                                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                    | ✅ 0 violations, **once run as `python3 -m flake8`** — see note below                                                                                                |
| `black --check app/ tests/ alembic/`                             | ✅ clean (after formatting the new test file); `python3 -m black` (26.5.1, CI's pin) agrees                                                                          |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned)     | ✅ clean                                                                                                                                                             |
| `python3 scripts/validate_migrations.py --strict`                | ✅ 444 revisions, single head `6ab7d903fae5`                                                                                                                         |
| `pytest tests/ -k "onboard or org_template or template_service"` | ✅ 247 passed, 1 skipped (pywebpush, env-only) — up from 183 (new: `test_onboarding_owner_race.py`, `test_onboarding_singleton.py` and others landed since pass 3)   |
| Guard-test reintroduction check (fix reverted via `git stash`)   | ✅ fails as expected (2/2 successes, not 1) with the fix removed; passes restored                                                                                    |
| `pytest tests/` (full suite)                                     | ✅ 12,496 passed, 21 skipped (all environment-only: optional `pywebpush`, Docker registry/daemon unavailable in this sandbox, opt-in API-contract suite), 0 failures |
| `npm run typecheck` (aliased 7.0.2 compiler, `tsc-native.mjs`)   | ✅ 0 errors                                                                                                                                                          |
| `npm run lint` (`--max-warnings 10`)                             | ✅ 0 errors, 0 warnings                                                                                                                                              |

**A note on this sandbox having two `flake8` installs, for the next pass:**
the bare `flake8` on `PATH` resolves to a `uv`-tool install
(`~/.local/share/uv/tools/flake8`) with **no `flake8-pytest-style` plugin**,
while `python3 -m flake8` resolves the `dist-packages` install that **does**
have it (CI installs `flake8-pytest-style==2.2.0` explicitly — see
`.github/workflows/ci.yml` → Backend Lint). The two disagree: bare `flake8`
reported this pass's new test file clean; `python3 -m flake8` correctly
caught `PT018` (a combined `assert X and Y` in
`test_onboarding_owner_race.py`, fixed by splitting it into two asserts).
Re-ran `python3 -m flake8 app/ tests/ alembic/` over the **whole tree**
after the fix — clean, so this was confined to the one new file, not a
sandbox-wide gap the bare binary had been silently hiding elsewhere. Same
shape as CLAUDE.md's documented `typescript`/`typescript-native` two-install
trap, just for a different tool and not yet written down anywhere else in
this repo's docs — **use `python3 -m flake8`, never bare `flake8`, in this
sandbox.**

**A note on test-database hygiene, for the next pass:** this feature's own
convention (per `KNOWN_LIMITATIONS.md`'s ONBOARD-7 entry and this session's
own reproduction) is to verify a bootstrap-path race against a real,
independently-committing connection pair, which bypasses the `db_session`
fixture's auto-rollback. The reproduction script and the new integration test
both write real, committed rows (`organizations`, `users`, `onboarding_status`,
and — since `create_system_owner` logs an audit event on success —
`audit_logs`). All four were confirmed empty before this pass's changes,
cleaned up after every manual reproduction run and left clean by the new
test's own teardown, and reconfirmed empty (`SELECT COUNT(*)` on all four) both
immediately before and immediately after the full 12,496-test suite run. One
stray `audit_logs` row from an early manual repro run _did_ leak into a
full-suite run before this cleanup was tightened, and caused 11 unrelated
`test_audit_*`/`test_election_voting_flow.py` failures purely from an
orphaned row referencing a since-deleted organization — not a regression in
this feature's code, confirmed by re-running just those 11 after clearing the
table (24/24 passed). Recorded here so a future session seeing the same
failure shape recognizes it as sandbox hygiene rather than re-diagnosing it.

---

**Backend:** `backend/app/api/v1/onboarding.py` (2,639 L, 24 unauthenticated
bootstrap routes), `backend/app/services/onboarding.py` (1,465 L, unchanged
since pass 2), `backend/app/models/onboarding.py` (unchanged), `backend/app/
utils/onboarding_security.py` (unchanged), `backend/app/services/
template_service.py` / `org_template_service.py` / `org_template_registry.py`
(all unchanged), plus the new email-provider infrastructure onboarding's
`/test/email` route now depends on: `backend/app/api/v1/email_test_helper.py`
(rewritten, 761 lines churned), `backend/app/utils/microsoft_oauth.py` (new),
`backend/app/utils/email_providers.py` (new).
**Frontend:** `frontend/src/modules/onboarding/` — `pages/RoleSetup.tsx`
(936 L, largely rewritten), `pages/positionTemplates.ts` (452 L, new — split
out of `RoleSetup.tsx`), `config/seededPositionGrants.ts` (465 L, new),
`store/onboardingStore.ts`, `types/index.ts`, `utils/storage.ts`,
`pages/EmailConfiguration.tsx`, `pages/EmailPlatformChoice.tsx`.
**Migrations:** `20260905_1600_e8a1c04f6b27_repair_prerename_positions_no_ops.py`
(rewrites stored `positions.permissions` rows for the `equipment_check.*` →
`inventory.check_*` rename in `app/core/permissions.py` — owned by a different
feature's scope, sanity-checked here only for interaction with onboarding's
own seeded-role logic; see Scope).

---

## Pass 3 (2026-09-06/07)

## Scope

**Method: delta-focused re-verification**, per the rotation's established
pass-3+ convention (see Feature 25–29's pass-3 entries in `PROGRESS.md`).
Pass 2's baseline commit is `e6a1eb45` (merged PR #2093, 2026-08-31). This
pass:

1. Read `CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md`,
   `docs/module-audit/onboarding.md`, `ONB-30-onboarding.md` (pass 2), and
   `ONB2-30-onboarding.md` (pass 1) in full before touching any code, and
   re-verified every still-open finding from all three against current code
   rather than re-deriving them.
2. Ran `git diff --stat e6a1eb45..origin/main` scoped to this feature's file
   list. **No diff** in `services/onboarding.py`, `models/onboarding.py`,
   `utils/onboarding_security.py`, `template_service.py`,
   `org_template_service.py`, `org_template_registry.py` — confirmed
   byte-identical (`git diff --quiet`), so every pass-2 finding/verified-good
   claim scoped to those files is re-confirmed with the same confidence as a
   fresh read, not merely assumed.
3. **Read in full, end to end:** the diff to `onboarding.py` (486 diff lines —
   the new `_email_settings_from_onboarding`/`_incomplete_session_email`/
   `_validated_microsoft_auth_method`/`_parse_smtp_port` helpers, and the
   `save_session_roles` permission-merge rework —
   `_merge_default_permissions`/`_untouched_modules`/`registry_checkboxes`);
   the rewritten `email_test_helper.py` in full (580 L); the new
   `microsoft_oauth.py` and `email_providers.py` in full — these are new
   dependencies of this feature's `/test/email` and `/session/email` routes
   and had not been reviewed under any prior onboarding pass.
4. **Re-enumerated all 24 routes** by grepping every `@router.get/post`
   decorator against the current file and re-reading each route's guard
   chain directly (not trusting the pass-2 table without re-checking) — see
   Route inventory.
5. **Sampled, not read line-by-line:** `RoleSetup.tsx` / `positionTemplates.ts`
   / `seededPositionGrants.ts` (1,853 L combined) — grepped for the risk
   classes that apply to a frontend onboarding surface (secrets in
   `localStorage`/`sessionStorage`, `dangerouslySetInnerHTML`, `window.confirm`
   /`alert`/`prompt`, hardcoded credentials) and diffed the smaller files
   (`onboardingStore.ts`, `types/index.ts`, `utils/storage.ts`,
   `EmailPlatformChoice.tsx`) in full. **Not read line-by-line**: the bulk of
   `RoleSetup.tsx`'s rendering/state logic and `positionTemplates.ts`'s
   per-agency-type template tables — this pass's judgment is that the
   security-relevant enforcement for this class of frontend code is entirely
   server-side (ONB-7 already covers the server not trusting client-submitted
   permissions/priority), so the backend's `save_session_roles` merge logic
   got the full read instead. State plainly: a defect confined to
   `positionTemplates.ts`'s per-agency-type role suggestions with no
   server-side echo would not have been caught by this pass.
6. **Not reviewed as this feature's own scope** (belongs to a different
   feature's rotation slot, e.g. Permissions/Inventory): the
   `equipment_check.*` → `inventory.check_*` permission rename and the
   `apparatus.view` revocation from rank-and-file positions in
   `app/core/permissions.py` (222 insertions / 50 deletions since pass 2's
   baseline). Checked only for whether it broke anything onboarding depends
   on — it did not (no stale `EQUIPMENT_CHECK_*` references anywhere in
   `app/` or the onboarding frontend; `LEGACY_PERMISSION_ALIASES` in
   `permissions.py` keeps `permission_matches` honoring the old stored strings;
   a real migration and its own guard test
   (`tests/test_seeded_position_grant_repair.py`) exist for the rewrite).

## Route inventory

All 24 routes, re-enumerated against current `onboarding.py` (not carried
forward from pass 2's table without re-checking):

| Method | Path                    | Auth dependency                        | Compensating control                                                                                                                                                                                                 | Org-scoped       | Notes                                                                                                                       |
| ------ | ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/status`               | none                                   | rate-limited (`_rate_limit_onboarding_status`, read-appropriate 60/60s budget); minimal post-completion response (ONB-8)                                                                                             | n/a (pre-org)    | unchanged since pass 2                                                                                                      |
| POST   | `/start`                | none                                   | rate-limited (`_rate_limit_onboarding_start`); blocked once an org exists                                                                                                                                            | n/a              | unchanged                                                                                                                   |
| GET    | `/system-info`          | `validate_session(require_csrf=False)` | rate-limited                                                                                                                                                                                                         | n/a              | unchanged; ONB2-30-8 (sliding TTL, no CSRF) still open                                                                      |
| GET    | `/security-check`       | `validate_session(require_csrf=False)` | rate-limited                                                                                                                                                                                                         | n/a              | unchanged; same ONB2-30-8 exposure                                                                                          |
| GET    | `/database-check`       | `validate_session(require_csrf=False)` | rate-limited; generic error (ONB-5)                                                                                                                                                                                  | n/a              | unchanged                                                                                                                   |
| POST   | `/organization`         | `validate_session` (CSRF required)     | `needs_onboarding()`; single-org guard (ONB-2)                                                                                                                                                                       | n/a              | still missing the `except Exception` its twin has — cosmetic, re-confirmed                                                  |
| POST   | `/system-owner`         | `validate_session`                     | rate-limited; `needs_onboarding()`; single-owner guard (ONB-2)                                                                                                                                                       | n/a              | unchanged                                                                                                                   |
| POST   | `/modules`              | `validate_session`                     | `needs_onboarding()` (ONB-3)                                                                                                                                                                                         | org from session | unchanged                                                                                                                   |
| POST   | `/notifications`        | `validate_session`                     | `needs_onboarding()` (ONB-3)                                                                                                                                                                                         | org from session | unchanged                                                                                                                   |
| POST   | `/complete`             | `validate_session`                     | `needs_onboarding()` (ONB-3); one-way latch; **new this pass's delta:** refuses completion if the session's saved email config cannot send (`_incomplete_session_email`) rather than silently persisting it disabled | org from session | new guard verified sound, see Findings §ONB3-30-2 (verified-good)                                                           |
| POST   | `/test/email`           | `validate_session`                     | rate-limited; SMTP self-hosted path still unvalidated (ONB-30-3, unchanged)                                                                                                                                          | n/a              | Gmail/Microsoft/Cloudflare paths reworked this delta — see Findings                                                         |
| POST   | `/session/department`   | `validate_session`                     | `needs_onboarding()` (ONB-3)                                                                                                                                                                                         | org from session | unchanged                                                                                                                   |
| POST   | `/session/email`        | `validate_session`                     | `needs_onboarding()` (ONB-3); config encrypted at rest; **new:** rejects an enabled-but-unsendable config at save time (`missing_for_enabled`/`invalid_for_enabled`) instead of only at `/complete`                  | org from session | verified-good, see Findings §ONB3-30-2                                                                                      |
| POST   | `/session/file-storage` | `validate_session`                     | `needs_onboarding()` (ONB2-30-3); encrypted at rest                                                                                                                                                                  | org from session | unchanged                                                                                                                   |
| POST   | `/session/auth`         | `validate_session`                     | `needs_onboarding()` (ONB2-30-3)                                                                                                                                                                                     | org from session | unchanged                                                                                                                   |
| POST   | `/session/it-team`      | `validate_session`                     | `needs_onboarding()` (ONB2-30-3); capped `max_length=50` (ONB2-30-1)                                                                                                                                                 | org from session | unchanged                                                                                                                   |
| POST   | `/session/stations`     | `validate_session`                     | `needs_onboarding()` (ONB-9); capped `max_length=50`                                                                                                                                                                 | org from session | unchanged                                                                                                                   |
| POST   | `/session/apparatus`    | `validate_session`                     | `needs_onboarding()` (ONB-9); capped `max_length=100`                                                                                                                                                                | org from session | unchanged                                                                                                                   |
| POST   | `/session/modules`      | `validate_session`                     | `needs_onboarding()` (ONB2-30-3); module allowlist                                                                                                                                                                   | org from session | unchanged                                                                                                                   |
| POST   | `/session/organization` | `validate_session`                     | `needs_onboarding()` (ONB-3); single-org guard (ONB-2)                                                                                                                                                               | n/a              | unchanged                                                                                                                   |
| POST   | `/session/roles`        | `validate_session`                     | `needs_onboarding()` (ONB-3); outer list capped `max_length=200` (ONB2-30-2); **new this pass:** per-role `permissions` dict now capped `max_length=50`                                                              | org from session | **ONB3-30-1 fixed this pass**; ONB-7 (client-controlled permissions/priority/is_system on new roles) re-verified still open |
| POST   | `/session/positions`    | delegates to `/session/roles`          | inherits every guard above, including the new cap                                                                                                                                                                    | org from session | unchanged                                                                                                                   |
| GET    | `/session/data`         | `validate_session` (CSRF required)     | returns only non-sensitive allowlisted fields                                                                                                                                                                        | org from session | unchanged                                                                                                                   |
| POST   | `/reset`                | `validate_session`                     | rate-limited; post-owner re-authentication as the exact System Owner (ONB-8); audit log (transaction-boundary issue still open)                                                                                      | n/a              | unchanged                                                                                                                   |

24/24 accounted for — matches SEC-00's baseline count and pass 1/2's tables.
No route lost or gained a compensating control since pass 2.

## Verified good ✅ (re-confirmed this pass, mechanism re-checked against current code)

- **ONB-1, ONB-2, ONB-3/ONB-9, ONB-4, ONB-5, ONB-6, ONB-8 (reset re-auth,
  `/status` disclosure, template mass-assignment), ONB2-30-1 through
  ONB2-30-7** — all re-confirmed present and unregressed. `services/
onboarding.py`, `models/onboarding.py`, `utils/onboarding_security.py`,
  `template_service.py` are byte-identical to the pass-2-reviewed version
  (`git diff --quiet e6a1eb45..origin/main` on those paths), so every
  finding scoped to them carries pass 2's verification forward unchanged
  rather than merely being assumed stable.
- **The Microsoft 365 OAuth token-request path (`microsoft_oauth.py`, new
  since pass 2) validates `tenant_id`/`client_id` as a GUID or verified
  domain before interpolating either into the authority URL**
  (`_GUID`/`_DOMAIN` regexes, `validate_tenant_id`/`validate_client_id`,
  `microsoft_oauth.py:54-57, 188-209`) — a value carrying `/` or `@` is
  rejected rather than sent, so a client-supplied tenant/client id cannot
  redirect the token request to an attacker-controlled host. The one
  remaining variable, `client_secret`, is presented only in the request body
  to the fixed `login.microsoftonline.com` host (via `msal`), never
  interpolated into a URL. No SSRF/host-redirection surface introduced by
  this new module.
- **`_https_urlopen` (`email_test_helper.py:33-43`) still restricts every
  Cloudflare API call to the `https` scheme** — re-confirmed unchanged from
  the prior pass's verified-good note; every URL it is given is a hardcoded
  `https://api.cloudflare.com/...` literal, not client-supplied.
- **No secret is echoed back in any response, across the rewritten
  `email_test_helper.py`.** Every `details` dict built by `test_smtp_
connection`/`_test_microsoft_oauth_connection`/`test_cloudflare_email`
  carries only host/port/encryption/connection-state/auth-method flags —
  grepped the full file for every `details[...] =` assignment and every
  `return` tuple; none carries `smtpPassword`, `microsoftClientSecret`, an
  OAuth access token, or a Cloudflare API token.
- **`frontend/.../utils/storage.ts`'s `saveEmailConfig` still never persists
  the credential-bearing `config` object** — re-confirmed against the
  updated field set (the diff added `microsoftAppPassword` to the
  sensitive-field warning check, dropped the now-removed `googleClientSecret`
  field): the function only ever writes the platform/method and a boolean
  flag to `sessionStorage`, matching the ONB-30-2 finding's own description of
  this file's design.
- **The `save_session_roles` permission-merge rework (`_merge_default_
permissions`/`_untouched_modules`/`registry_checkboxes`, new since pass 2)
  is a correctness fix, not a new privilege-escalation surface.** Traced by
  hand: for a **known registry slug**, an admin who edits nothing
  (`_untouched_modules`) now gets the seeded position's full grant list
  verbatim instead of a checkbox-only rebuild that dropped every non-view/
  manage action permission (the regression the code comments call out — an
  `emt` position created before its registry entry shipped stored a
  role-type heuristic's checkbox output, `reports.view` among it, as an
  `is_system` row). This closes a real under/over-grant correctness bug
  server-side; it does not touch the boundary ONB-7 already flags — a client
  can still declare an arbitrary, non-seeded `module_id` key inside
  `permissions` and have it survive into the stored grant list, because
  `expand_module_checkboxes` never validates its keys against a module
  allowlist. Confirmed by hand-tracing `_merge_default_permissions`: any
  submitted module not equal to `registry_checkboxes(default_perms,
module_id)` for that role's own defaults is classified "touched" and its
  checkboxes pass straight through `expand_module_checkboxes` regardless of
  whether the module is real. Same shape ONB-7 already describes; no
  regression, no new distinct finding.
- **`/complete`'s new pre-flight email check (`_incomplete_session_email`)
  fails closed on a malformed stored config.** Reads `session.data`, decrypts
  the stored config, and returns a generic "could not be read" message on
  any exception (`except Exception: return "..."`) rather than propagating a
  decryption/JSON error — checked this does not leak `decrypt_data`'s
  internals or the encrypted blob.

## Findings

### ONB3-30-1 — LOW — `RoleSetupItem.permissions` had no cap on dict size — ✅ FIXED

**What:** Every sibling collection in this schema module that a client fully
controls is capped (`ITTeamRequest.it_team` at 50 — ONB2-30-1;
`RolesSetupRequest.roles`/`PositionsSetupRequest.positions` at 200 —
ONB2-30-2), each with the same stated rationale: "the cap exists so a
malformed or hostile payload cannot drive an unbounded write loop." But
`RoleSetupItem.permissions` — a `dict[str, RolePermission]` keyed on an
arbitrary client-supplied module-id string (there is no server-side
allowlist; ONB-7 documents that this key is unrestricted) — had no cap of its
own. The outer list caps bound how many _roles_ one request can carry, not
how many permission-dict entries one _role_ can carry.

**Where:** `backend/app/api/v1/onboarding.py:558` (`RoleSetupItem.
permissions`), reached via `POST /session/roles` and `/session/positions`.

**Failure scenario:** a session holder during the bootstrap window (obtained
via the rate-limited but otherwise open `POST /start`) submits up to 200 role
entries (the existing outer cap), each carrying a `permissions` dict with an
arbitrarily large number of distinct bogus module-id keys. `expand_module_
checkboxes` iterates every key unconditionally, producing up to 2-3 permission
strings per key with no bound, all written into the `Role.permissions` JSON
column via `db.add(new_role)`. This is a data-bloat/storage-abuse vector, not
a privilege-escalation one (ONB-7 already covers the escalation angle of
unrestricted module-id keys) — the missing piece was specifically the missing
size bound this class of collection is supposed to have everywhere else in
the file.

**Impact:** LOW. Requires the same pre-completion, rate-limited window every
other onboarding write does; does not escalate privilege beyond what ONB-7
already documents; the practical damage is oversized JSON rows and CPU spent
on unbounded loop iterations per request, not data exposure or auth bypass.

**Fix:** added `max_length=50` to `RoleSetupItem.permissions`, mirroring the
existing `stations`/`apparatus`/`it_team` caps' rationale and headroom margin
(34 real modules exist in the registry today; the cap gives room to grow
without needing another change). Guard test added in
`tests/test_onboarding_request_caps.py` (`TestRoleSetupItemPermissionsCap`),
verified to fail against the pre-fix schema (`test_rejects_over_the_cap`
raised nothing without the cap) and pass with it applied.

### ONB3-30-2 — Verified-good (not a finding) — the new email-completeness gate does not weaken any existing guard

Noted here rather than only above because it is new code on a security-review
axis (data integrity of what gets written to `Organization.settings`, an
authenticated-later surface). `save_email_config` (`/session/email`) and
`complete_onboarding` (`/complete`) both now route through the same
`_email_settings_from_onboarding` → `missing_for_enabled`/`invalid_for_enabled`
pair, so a config that would be stored `enabled=True` but cannot actually send
is refused at save time with a 400 naming the missing/invalid field, and — for
data that predates this check (a session persisted by an earlier release) —
refused again at `/complete` rather than silently persisted `enabled=False`
behind a success response. Traced both call sites: neither function has a
side effect (`missing_for_enabled`/`invalid_for_enabled` in `email_providers.py`
are pure), so calling the same function twice on the same input cannot
produce divergent verdicts between the pre-flight check and the actual
persist. No weakening of `needs_onboarding()`, session validation, or the
encryption-at-rest of secret fields — this is additive validation on top of
the existing guarded write path.

## Still flagged, re-confirmed unchanged (no new information this pass)

- **ONB-7** — `save_session_roles` accepts client-supplied `permissions`
  (unrestricted module-id keys), `priority` (0-100), and `is_custom` (which
  sets `is_system`) on a new role/position, keyed on the client-supplied
  slug. Re-verified by direct read of the current `save_session_roles` (lines
  2249-2412) including the new merge-logic rework (see Verified good above) —
  the rework changed what a _known_ registry slug's grants look like, not
  whether an unknown slug/arbitrary module-id can be injected. Still a
  product-policy call (clamping priority, rejecting system-role re-mint,
  allowlisting `module_id` would change what the legitimate onboarding role
  editor can express), not a drive-by fix. `KNOWN_LIMITATIONS.md` entry
  unchanged.
- **ONB-30-3** — `POST /onboarding/test/email`'s self-hosted SMTP path
  (`test_smtp_connection` in the rewritten `email_test_helper.py`) still
  connects to a fully client-supplied `smtpHost`/`smtpPort` via raw
  `smtplib` with no hostname/IP validation. Re-verified against the rewritten
  file: the function's core shape (host/port straight from `config`, no
  `url_validator` involvement) is unchanged by the rewrite — only the Gmail/
  Microsoft paths around it were reworked (now SMTP+OAuth via
  `email_providers.py`/`microsoft_oauth.py` instead of the old, unused OAuth
  stub this pass's diff shows was renamed away from `test_gmail_oauth`/
  `test_microsoft_oauth`). Reachability (pre-auth via `POST /start` during
  the bootstrap window) and the fingerprinting-via-differentiated-errors
  concern both still apply exactly as pass 2 described. Not fixed for the
  same reason: blocking private IPs would break the legitimate on-premises
  SMTP relay case this app's audience actually uses. `KNOWN_LIMITATIONS.md`
  entry unchanged.
- **ONB2-30-8** — session TTL is a sliding 30-minute window with no absolute
  cap; `/system-info`, `/security-check`, `/database-check` slide it on the
  session id alone (no CSRF). `services/onboarding.py` is unchanged
  (confirmed via the byte-identical diff check), so this is unregressed by
  construction, not merely re-asserted.
- **ONB-8 residual (reset-audit transaction boundary)** — `reset_initiated`
  is still logged in the same transaction as `/reset`'s deletes. Unchanged
  file, unregressed.
- **Role/position dedup** — a duplicate `role.id` within one `/session/roles`
  payload still raises an unhandled `IntegrityError` → 500 rather than a
  clean 400. Re-confirmed: no dedup logic exists anywhere in the current
  `save_session_roles` (grepped for `seen_ids`/`duplicate`/`dedup` — no
  matches). Pre-existing, larger fix than a cap, left flagged per prior
  passes' judgment.
- **`POST /organization` missing the `except Exception`** its twin
  `/session/organization` has — re-confirmed via direct read (only `except
ValueError` present at the route, lines 1135-1233). Cosmetic robustness
  gap, not a security issue (`safe_error_detail`/production `DEBUG=false`
  still apply to whatever FastAPI's own handler does with an uncaught
  exception).
- **`ITTeamMemberRequest.email` is `str`, not `EmailStr`** — re-confirmed
  unchanged (`onboarding.py:461-467`). Kept loose intentionally, matching
  `create_it_team_users`'s skip-if-invalid behavior.

## Schema & migration notes

No new model or column in this feature's own tables (`onboarding_status`,
`onboarding_sessions`, `onboarding_checklist` — all unchanged since pass 2,
still created by a real migration, not `create_all`-only). The
`equipment_check.*` → `inventory.check_*` permission rename that landed in
`app/core/permissions.py` since pass 2 is a different feature's schema
concern (`positions.permissions` JSON, not an onboarding table), sanity-checked
only for interaction with this feature's seeded-role logic — see Scope §6.
`validate_migrations.py --strict`: 432 revisions, single head `ee7390dcdf47`,
clean.

## Guard tests added

- `tests/test_onboarding_request_caps.py::TestRoleSetupItemPermissionsCap` —
  asserts `RoleSetupItem(permissions={...50 keys...})` is accepted and
  `{...51 keys...}` raises `ValidationError`. Verified to fail
  (`test_rejects_over_the_cap` raised nothing) against the code with the new
  `max_length=50` reverted, and to pass with it restored.

## Completion gate

| Check                                                            | Result                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                    | ✅ 0 violations                                                                                                                                                                                                      |
| `black --check app/ tests/ alembic/`                             | ✅ clean (1513 files unchanged)                                                                                                                                                                                      |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned)     | ✅ clean                                                                                                                                                                                                             |
| `python3 scripts/validate_migrations.py --strict`                | ✅ 432 revisions, single head `ee7390dcdf47`                                                                                                                                                                         |
| `pytest tests/ -k "onboard or org_template or template_service"` | ✅ 183 passed, 1 skipped (pywebpush, env-only)                                                                                                                                                                       |
| `pytest tests/` (full suite)                                     | ✅ 11639 passed, 21 skipped (all pre-existing Docker/optional-dependency skips), 0 failures                                                                                                                          |
| `npm run typecheck` (aliased 7.0.2 compiler, `tsc-native.mjs`)   | ✅ 0 errors                                                                                                                                                                                                          |
| `npm run lint` (eslint, `--max-warnings 10`)                     | ✅ 0 errors, 2 pre-existing warnings in `frontend/src/modules/scheduling/components/CallTypeChips.tsx` (unrelated to onboarding, not touched this pass — `react-refresh/only-export-components`, well under the cap) |
