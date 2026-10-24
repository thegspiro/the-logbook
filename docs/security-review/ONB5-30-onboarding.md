# Security Review — Feature 30: Onboarding (passes 7–9)

**Prefix:** `ONB5` · **Rotation pass:** 9 (prior: module-audit iteration 25,
app-review B25 (4 passes), security-review pass 1 — PR #1913 + follow-up
(`docs/security-review/ONB2-30-onboarding.md`), pass 2 — PR #2093
(`docs/security-review/ONB-30-onboarding.md`), passes 3–5 — PRs #2358, #2521,
#2898 (`docs/security-review/ONB3-30-onboarding.md`), pass 6 — PR #2996,
pass 7 — PR #3381, pass 8 — PR #3517 (both `docs/security-review/ONB4-30-onboarding.md`
and this file)) · **Reviewed:** 2026-10-17 (pass 7), 2026-10-21 (pass 8),
2026-10-24 (pass 9, watchdog pickup, this PR)

**Backend:** `backend/app/api/v1/onboarding.py` (now 3,200 L, 26
unauthenticated bootstrap routes — unchanged count from pass 7/8, re-enumerated
by AST this pass), `backend/app/services/onboarding.py`,
`backend/app/models/onboarding.py`, `backend/app/utils/onboarding_security.py`,
`backend/app/api/v1/email_test_helper.py`, `backend/app/utils/email_providers.py`,
`backend/app/utils/microsoft_oauth.py`, `backend/app/services/template_service.py`,
`backend/app/services/org_template_service.py`,
`backend/app/services/org_template_registry.py`,
`backend/app/services/key_custody_service.py`,
`backend/app/services/system_notices.py` (51 new lines this pass — a backup
system notice; reviewed in full even though it sits behind a post-onboarding
permission, same reasoning as pass 7),
`backend/app/api/v1/endpoints/system_notices.py`,
`backend/app/schemas/system_notices.py`,
`backend/app/utils/upload_scanning.py`. Also touched this pass, in scope only
because the diff passes through onboarding's own persist function:
`backend/app/schemas/organization.py` (`FileStorageSettings`,
`encrypt_settings_secrets`/`decrypt_settings_secrets`,
`_FILE_STORAGE_SECRET_FIELDS`), `backend/app/services/google_drive_storage.py`
(read for context on how the service-account key is used downstream, not a
full line-by-line re-review — that storage backend belongs to a different
rotation feature and was engineered/tested on its own, `test_google_drive_storage.py`).
**Frontend:** `frontend/src/modules/onboarding/` — new this pass:
`components/OnboardingGate.tsx`, `utils/onboardingGateState.ts` (both read in
full); diffed and read at each changed line: `routes.tsx`,
`pages/FileStorageConfiguration.tsx`, `pages/FileStorageChoice.tsx`,
`services/api-client.ts`, `types/index.ts`, and the a11y-only token-rename
diffs in `pages/ApparatusSetup.tsx`, `pages/OnboardingCheck.tsx`,
`pages/RoleSetup.tsx`, `pages/SetupComplete.tsx`.
**Migrations:** none in this pass's window (last onboarding-owned migration
remains `20261009_1045_7e1a3c94d2b6_add_encryption_key_custody.py`, pass 7).

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
