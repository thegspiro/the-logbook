# Security Review — Onboarding (pass 3)

**Prefix:** `ONB3` · **Iteration:** 30 (rotation pass 3; prior: module-audit
iteration 25, app-review B25 (4 passes), security-review pass 1 — PR #1913 +
follow-up (`docs/security-review/ONB2-30-onboarding.md`), security-review
pass 2 — PR #2093 (`docs/security-review/ONB-30-onboarding.md`))
· **Reviewed:** 2026-09-06/07 · **PR:** (opened this pass)

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
