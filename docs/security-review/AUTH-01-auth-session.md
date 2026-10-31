# Security Review — Auth & Session Lifecycle

**Prefix:** `AUTH` · **Iteration:** 01 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3), 2026-09-08 (pass 4), 2026-09-14 (pass 5), 2026-09-15 (pass 6), 2026-10-05 (pass 7), 2026-10-12 (pass 8, watchdog pickup), 2026-10-14 (pass 9, watchdog pickup), 2026-10-18 (pass 10, watchdog pickup), 2026-10-22 (pass 11, watchdog pickup), 2026-10-25 (pass 12, watchdog pickup), 2026-10-28 (pass 13), 2026-10-31 (pass 14, watchdog pickup) · **PR:** #1804 (pass 1), #1929 (pass 2), #2133 (pass 3), #2389 (pass 4), #2536 (pass 5), #2593 (pass 6), #2924 (pass 7 — the header's own "this PR" placeholder was never filled in after merge; corrected here the way pass 7 corrected pass 6's), #3096 (pass 8, corrected here the same way), #3210 (pass 9, corrected here the same way), #3397 (pass 10, corrected here the same way), #3556 (pass 11, corrected here the same way), #3684 (pass 12, corrected here the same way), #3802 (pass 13, corrected here the same way), pass 14 (this PR)

Passes are recorded in this one file rather than a new `AUTH<n>-01-*.md` per
lap, matching what passes 2 and 3 already did here. Newest pass first.

---

## Pass 14 (2026-10-31, watchdog pickup) — 0 fixed, 0 new findings; true zero-delta pass, every tracked file byte-identical

Watchdog pickup. The dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable (confirmed via
`ListAgents` → "No reachable agents" immediately before this iteration was
dispatched). Step 0 re-verified fresh, not trusted from that briefing:
`search_pull_requests` for `head:claude/security-review-` `is:open` against
`thegspiro/the-logbook` returned 0 results. PR #3869 (Feature 00,
Cross-cutting baseline, pass 14 — the full-rotation reset-and-restart
iteration) had already merged (`10312c364`), resetting the rotation table
from all-`✅` back to `⬜` and marking row 00 `✅` again for its own pass.
Rotation row 01 (Auth & session lifecycle) was confirmed the next `⬜` row on
a freshly fetched `origin/main` (`git fetch && git reset --hard origin/main`).

**Baseline:** `4f21727a` (PR #3802's merge, pass 13). **Head:** `10312c364`
(current `main`, PR #3869's merge). 263 commits between them, 172 non-merge.

**Every one of the eighteen files this feature tracks is byte-identical to
pass 13** — confirmed with `git diff --stat`/`git diff --quiet` across all of
them at once, not inferred from an empty stat line on a subset:
`auth.py`, `auth_service.py`, `mfa_service.py`, `oauth_service.py`,
`consent_service.py`, `passkey_service.py`, `models/passkey.py`,
`dependencies.py`, `security.py`, `suspicious_ip.py`, `schemas/auth.py`
(backend), and `authStore.ts`, `authService.ts`, `apiClient.ts`,
`utils/passkeys.ts`, `components/settings/PasskeySettingsCard.tsx`,
`contexts/StepUpContext.tsx`, `utils/stepUp.ts` (frontend). `git diff
4f21727a..HEAD` against the full set of eighteen paths produced zero output.

**Checked for a new file hiding the real change, per this skill's own
warning that a diff table shows which files changed, not that one of them
gained a route:** `git log --diff-filter=A --name-only 4f21727a..HEAD` over
`backend/app` and `frontend/src`, filtered to `auth|mfa|oauth|session|
passkey|stepup|webauthn` (case-insensitive) — zero matches. No new
auth-adjacent file was added anywhere in the 263-commit range.

### Route inventory — re-enumerated by AST, not assumed unchanged from the empty diff

**Still 38 routes**, same set, same names, same order as pass 13's table.
Re-walked `auth.py`'s AST directly (every `@router.<verb>` decorator) rather
than trusting the zero-diff result to imply it — a route's decorator can in
principle change without the surrounding bytes differing if, say, a
`Depends(...)` default were edited in place elsewhere in the same
expression, so this pass repeats the walk rather than skipping it for a file
with no diff. Output matched pass 13's 38-route list exactly, route for
route (`/branding` … `/validate-reset-token`). Public/private split
unchanged at 17/21; `tests/test_endpoint_auth_coverage.py` (which encodes
`ALLOWLISTED_PUBLIC`) re-run directly: 1 passed.

### Standing items — reconfirmed unchanged from pass 13

**AUTH-23 (MED, OPEN/FLAGGED)** re-verified still accurate and still the
only open finding for this feature: `step_up`
(`backend/app/api/v1/endpoints/auth.py:1486-1549`, unchanged byte-for-byte
since pass 12) still has no account-tied lockout on its password/TOTP
branches — re-read the handler directly rather than trusting the unchanged
diff stat alone. `docs/KNOWN_LIMITATIONS.md`'s entry for it (under "A
member checked in after an election opens cannot vote" / the step-up row)
is present and unchanged — reconfirmed by direct read, not grep alone.

AUTH-15, AUTH-17, AUTH-21 and AUTH-22 remain closed (pass 8's and pass 10's
fixes); AUTH-4 (informational, unbounded roster query, accepted as an
app-wide pattern out of scope for a single-endpoint fix) remains accepted
and unchanged. No other AUTH finding exists in `docs/KNOWN_LIMITATIONS.md`
to re-verify — reconfirmed by grep.

### Completion gate (pass 14)

| Check                                                                                                                                                                                                                                                              | Result                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                                                                                                                    | ✅ 0 violations                                                             |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                                                                                                                           | ✅ clean, 2744 files unchanged                                              |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                                                                                                                        | ✅ clean                                                                    |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                  | ✅ single head `f90b1124e6f4`, 678 revisions                                |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                              | ✅ 280 routes, 0 errors/0 warnings                                          |
| scoped backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission or authentik or password or security_notification or stepup or kiosk or passkey or webauthn"`)                                                           | ✅ 1507 passed, 2 skipped (environment-only — `pywebpush`, Docker registry) |
| standing guards (`account_status_gates`, `auth_lockout_race`, `auth_refresh_rotation`, `capacity_locking`, `endpoint_auth_coverage`, `like_escaping`, `mfa_policy`, `org_scoping_ratchet`, `password_expiry_gate`, `session_limits`, `sign_in_audit`) run directly | ✅ 209 passed                                                               |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                 | ✅ 0 errors                                                                 |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                      | ✅ 0 errors, 0 warnings (`--max-warnings 10`)                               |

No guard test added this pass: nothing was fixed, no new finding, and the
file set under review did not change at all since pass 13.

Rotation row 01 moves to `✅`.

---

## Pass 13 (2026-10-28) — 0 fixed, 0 new findings; new passkey (WebAuthn) feature reviewed in full and verified good

Step 0 re-verified immediately before branching: `search_pull_requests`
`head:claude/security-review-` `is:open` → 0 results. PR #3800 (Feature 00,
Cross-cutting baseline, pass 13, watchdog pickup) had already merged
(`9c2a5bff`), closing out rotation lap "pass 11" and resetting the table to
`⬜` for pass 12. Rotation row 01 was the next `⬜`.

**Baseline:** `d5f44cc4` (PR #3684's merge, pass 12). **Head:** `9c2a5bff`
(current `main`). Repository was shallow and was unshallowed
(`git fetch --unshallow`) before trusting any commit count, per the standing
Pitfall #24 risk note. 325 commits between baseline and head (207 non-merge).
`git diff --stat` across the twelve files pass 12 scoped plus three new
principal files this pass's own feature adds (`passkey_service.py`,
`models/passkey.py`, `utils/passkeys.ts`) is non-empty in nine: `auth.py`
(+479/-4), `schemas/auth.py` (+119/-0), `authService.ts` (+87/-6),
`dependencies.py` (+23/-4), `security.py` (+66/-0), `authStore.ts` (+14/-2),
`oauth_service.py` (+3/-1), `apiClient.ts` (+4/-1), plus the three brand-new
files (`passkey_service.py` 498 lines, `models/passkey.py` 94 lines,
`utils/passkeys.ts` 74 lines; also new and read in full:
`components/settings/PasskeySettingsCard.tsx`, 326 lines). `mfa_service.py`,
`oauth_service.py`'s sibling `consent_service.py`, and `suspicious_ip.py` are
byte-identical to pass 12 (confirmed with `git diff --quiet`, not assumed from
the stat output's silence).

### Route inventory — re-enumerated by AST, not diffed

**38 routes, up from 31 at pass 12** — seven new: `POST /auth/mfa/challenge`,
`GET /auth/passkeys`,
`POST /auth/passkeys/register-options`,
`POST /auth/passkeys/register`,
`DELETE /auth/passkeys/{passkey_id}`,
`POST /auth/passkeys/recovery-codes`, and
`POST /auth/step-up/passkey-options`.
Enumerated with a Python AST walk over every `@router.*` decorator and every
`Depends(...)` default on the function immediately below it (not grepped from
the diff, per this skill's repeat-pass instruction), then diffed against the
same walk run on the pass-12 blob (`git show d5f44cc4:...auth.py`) to get the
added/removed sets directly rather than by eye. Nothing was removed. Public
route count moves from 16 to **17** (`mfa_challenge` joins
`ALLOWLISTED_PUBLIC`, already present in the file with its own justifying
comment — "Offers the second-factor choices (and a passkey challenge) for
that same pending sign-in; gated by the same `mfa_pending` token and rate
limit" — confirmed, not assumed); private moves 15 → **21**. All 31 routes
pass 12 classified were re-walked and are unchanged (same dependency, same
permission string) except the four already noted as changed at pass 12 itself
(`step-up`, `session/kiosk` ×2, `mfa/policy` PUT), which are re-confirmed
unchanged since.

New routes:

| Route                                  | Auth dependency           | Permission / scoping                                                                                     | Notes                                                                                                                                                                              |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/mfa/challenge`             | none (public, pre-login)  | gated by the short-lived `mfa_pending` token + `rate_limit_passkey()` + `enforce_suspicious_ip`          | issuing a challenge proves nothing about the caller, so it is not counted toward account lockout; a bad/expired token **is** counted toward the per-IP tally, same as `/mfa/login` |
| `GET /auth/passkeys`                   | `get_current_active_user` | self only — lists the caller's own passkeys                                                              | n/a                                                                                                                                                                                |
| `POST /auth/passkeys/register-options` | `get_current_active_user` | self only; 403 if the org disabled passkeys; `ensure_stepup` once the member already has a second factor | first-factor enrollment is intentionally not step-up-gated (nothing stronger than the password just used exists yet)                                                               |
| `POST /auth/passkeys/register`         | `get_current_active_user` | self only; same org-toggle check; `ensure_stepup` once already enrolled                                  | issues one-time recovery codes only when this is the member's first second factor                                                                                                  |
| `DELETE /auth/passkeys/{passkey_id}`   | `get_current_active_user` | self **and** org, via `get_passkey(..., user_id=, organization_id=)`; `ensure_stepup` unconditionally    | 404s a passkey id that exists but belongs to someone else, rather than 403ing — does not confirm the id's existence to another member                                              |
| `POST /auth/passkeys/recovery-codes`   | `get_current_active_user` | self only; requires a second factor to exist and a fresh passkey step-up                                 | n/a                                                                                                                                                                                |
| `POST /auth/step-up/passkey-options`   | `get_current_active_user` | self only                                                                                                | 400s with no leak when the caller has no usable passkey on this site                                                                                                               |

### The new feature, reviewed in full against all seven checklist dimensions: passkeys (WebAuthn) as a second factor

`backend/app/services/passkey_service.py` (new, 498 lines),
`backend/app/models/passkey.py` (new, 94 lines),
`backend/alembic/versions/20261025_1943_c616fa1bd492_add_user_passkeys.py`
(new), the seven routes above, every call site `has_second_factor`/
`has_passkey` replaces a bare `user.mfa_enabled` check at (`login`,
`_finish_oauth_login`, `mfa_disable`, `step_up`, `_build_current_user_dict`,
`AuthService.authenticate_user`'s lockout-clear), and the frontend half
(`utils/passkeys.ts`, `components/settings/PasskeySettingsCard.tsx`,
`authService.ts`, `authStore.ts`). Read in full, not spot-checked.

- **Dimension 1 (auth coverage) — correct.** Every management route requires
  `get_current_active_user`; the one pre-auth route (`mfa_challenge`) is
  allowlisted with a named compensating control and was already added to
  `tests/test_endpoint_auth_coverage.py`'s `ALLOWLISTED_PUBLIC` — re-ran the
  test, passes.
- **Dimension 2/3 (self-scoping, tenant isolation) — correct, verified by
  reading the query, not by trusting the route name.** Every passkey query in
  `passkey_service.py` filters `UserPasskey.user_id == str(user.id)`; the
  delete path additionally filters `organization_id` even though `user_id`
  alone already excludes every other tenant (belt-and-suspenders, matching
  XC-3's letter). No endpoint takes another member's id as a path or body
  parameter. `has_passkey`/`has_second_factor`/`usable_passkey_count` are
  called with `str(user.id)` sourced from the authenticated dependency, never
  from client input, at every call site (`auth.py`, `auth_service.py`,
  `dependencies.py`) — confirmed by reading each call site, not inferred from
  the function names.
- **Dimension 2 (separation / step-up as defense-in-depth) — correct.**
  Changing a member's own second factors with only a live session (no
  step-up) would let a stolen session plant a passkey of the attacker's
  choosing or delete the owner's real one; `_require_stepup_once_enrolled` /
  `ensure_stepup` gate every mutating passkey route **once the member already
  has a second factor**, and deliberately do not gate the _first_ enrollment
  (nothing stronger than the sign-in they just completed exists yet to step
  up with) — matching the exact reasoning already applied to authenticator
  setup. `test_step_up_is_on_exactly_the_documented_handlers`'s `STEPUP_HANDLERS`
  set and `test_step_up_always_follows_the_permission_check` were re-run;
  both pass (these specific routes use `ensure_stepup` as a direct call
  rather than the `require_stepup` dependency the AST sweep walks, which is
  why they are not newly added to that pinned set — the sweep's own docstring
  scopes it to the `Depends(require_stepup)` shape, and `set_mfa_policy` is
  still the one route using that shape in this feature).
- **Dimension 3 (capacity-check locking, Pitfall #27) — correct, mechanism
  confirmed by reading the lock, not merely by the docstring's claim.**
  `registration_options` does an unlocked read for an early, friendly error
  message; `verify_registration` repeats the check under
  `select(User.id)....with_for_update()` **then**
  `select(UserPasskey.id)...with_for_update()` before inserting — locking the
  parent row first and then the counted rows, exactly the two-step shape
  Pitfall #27 requires. Two concurrent registrations finishing together
  cannot both slip in under `MAX_PASSKEYS_PER_MEMBER`.
- **Dimension 4 (injection/untrusted output) — correct.** No raw SQL, no
  `.like()`. `PasskeyRegisterRequest.credential` and `StepUpRequest`/
  `MFALogin.passkey_credential` are bounded to 64 KB
  (`_bounded_credential`/`_MAX_CREDENTIAL_BYTES`) before `py_webauthn` ever
  sees them — an abuse-resistance control (dimension 6) as much as an
  injection one, since the WebAuthn JSON is otherwise attacker-shaped. The
  member-chosen passkey `name` (free text, ≤100 chars) reaches three sinks:
  the audit log (structured JSON, not HTML), the in-app `NotificationLog`
  (rendered by `NotificationCard.tsx` as a plain JSX text child — React
  escapes it — confirmed by reading the component, not assumed), and the
  security-notification email, which runs the **whole** message through
  `html_escape()` before `wrap_email_body` (`security_notifications.py:80,148`,
  AUTH-22's fix, re-confirmed unchanged). No stored-XSS path.
- **Dimension 5 (data exposure) — correct, and improved.** The OAuth-login
  audit events (`oauth_mfa_challenge`, `oauth_login`) dropped the member's
  `email` from `event_data` as part of this same feature's diff — PII that
  used to reach the audit-log payload and no longer does (checklist §5's
  "PII/PHI absent from audit logs", now true here where it previously was
  not; not a regression to fix, an improvement already present on `main`).
  `PasskeyResponse` exposes only `id`, `name`, `created_at`, `last_used_at`,
  `backed_up` — never the public key, the credential id, or the sign
  counter. Errors from the WebAuthn library (`WebAuthnException`/`KeyError`/
  `TypeError`/`ValueError`) are caught and replaced with a fixed, generic
  message at both verify sites (`passkey_service.py:376-380, 488-492`) —
  never `str(exc)` — so a library internal (which can include base64 of the
  attestation object) cannot reach the client.
- **Dimension 6 (abuse resistance) — correct.** `rate_limit_passkey()` (20/60s,
  its own bucket, documented reasoning for why challenge-issuing stays off the
  stricter login bucket) covers every passkey management route and
  `mfa_challenge`; the three routes that check a credential
  (`passkeys/register`, implicitly `mfa_login` and `step_up` which already
  carried it) stay on `rate_limit_login()`. `_MAX_OPEN_CHALLENGES = 5` per
  member caps `webauthn_challenges` row growth per user, with best-effort
  expiry cleanup on every new challenge issue — considered and not raised as
  a Pitfall #9-shaped finding: unlike an in-memory dict, this is a durable
  table with a **per-user** cap of 5, so worst case is 5 rows × the
  department's membership (tens to a few hundred, per this codebase's own
  stated scale assumption, same reasoning AUTH-4 already applied to an
  unbounded roster query) — not an attacker-scalable unbounded sink.
  `MAX_PASSKEYS_PER_MEMBER = 3` is an explicit, deliberate business cap
  ("Agreed with the department: a phone, a laptop and one spare").
- **Dimension 7 (schema/migration integrity) — correct.** Both new tables use
  `ondelete="CASCADE"` (not `SET NULL`, so Pitfall #2 is n/a) and are
  `nullable=False` on every FK/required column.
  `20261025_1943_c616fa1bd492_add_user_passkeys.py` guards both
  `op.create_table` calls with `_has_table()` — Pitfall #26's `create_all`
  tolerance — and the uniqueness constraint lives on `credential_id_hash` (a
  fixed-width SHA-256 hex digest) rather than on `credential_id` itself, with
  the model's own comment explaining why (the WebAuthn spec allows credential
  ids up to 1023 bytes, which base64url-encodes past what a MySQL utf8mb4
  unique index can cover). `validate_migrations.py --strict` re-run: single
  head, re-confirmed.
- **The library choice itself, checked rather than assumed (Pitfall #34):**
  `webauthn==3.0.1` (PyPI, homepage `github.com/duo-labs/py_webauthn`) and
  `@simplewebauthn/browser@14.0.0` (npm, repository
  `github.com/MasterKale/SimpleWebAuthn`) both resolve to the real,
  well-known WebAuthn libraries their names claim — checked against the
  registries directly, not recalled — and both are pinned exactly (no `^`/`~`)
  in `requirements.txt`/`package.json`, matching their neighbours.
- **Considered, not raised:** `passkey.sign_count` is updated unconditionally
  on every successful authentication rather than rejecting a counter that
  moved backward (the classic cloned-authenticator signal). Not a finding:
  the model's own comment states the reason — platform/synced passkeys
  (iCloud Keychain, Google Password Manager, the dominant real-world passkey
  shape) report a sign count of 0 on every use, so treating "the counter
  didn't increase" as a clone signal would make every synced passkey look
  cloned on its second use. The actual second-factor property here is "the
  device checked a biometric or PIN" (`UserVerificationRequirement.REQUIRED`,
  enforced on both registration and authentication, confirmed by reading both
  call sites), not the counter.

### Standing items — reconfirmed unchanged from pass 12

**AUTH-23 (MED, OPEN/FLAGGED)** re-verified still accurate and still the only
open finding: `step_up` (`auth.py:1570-1666`) still has no account-tied
lockout on its password/TOTP branches. The new passkey branch inside the same
handler does not change this finding's reasoning — a passkey cannot be
guessed (there is no secret small enough to brute-force; the private key
never leaves the authenticator), so adding it does not widen the gap AUTH-23
describes, and the password/TOTP branches it describes are byte-identical in
behavior to pass 12's read of them. No change to `docs/KNOWN_LIMITATIONS.md`'s
existing entry needed.

AUTH-15, AUTH-17, AUTH-21 and AUTH-22 remain closed (pass 8's and pass 10's
fixes); AUTH-4 (informational, unbounded roster query, accepted as an
app-wide pattern out of scope for a single-endpoint fix) remains accepted
and unchanged. Reconfirmed by grep against `docs/KNOWN_LIMITATIONS.md` — no
entry beyond AUTH-23 exists for this feature.

### Completion gate (pass 13)

| Check                                                                                                                                                                                                                                                              | Result                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                                                                                                                    | ✅ 0 violations                                                             |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                                                                                                                           | ✅ clean, 2706 files unchanged                                              |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                                                                                                                        | ✅ clean                                                                    |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                  | ✅ single head `0d9897752425`, 666 revisions                                |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                              | ✅ 279 routes, 0 errors/0 warnings                                          |
| scoped backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission or authentik or password or security_notification or stepup or kiosk or passkey or webauthn"`)                                                           | ✅ 1494 passed, 2 skipped (environment-only — `pywebpush`, Docker registry) |
| standing guards (`account_status_gates`, `auth_lockout_race`, `auth_refresh_rotation`, `capacity_locking`, `endpoint_auth_coverage`, `like_escaping`, `mfa_policy`, `org_scoping_ratchet`, `password_expiry_gate`, `session_limits`, `sign_in_audit`) run directly | ✅ 205 passed                                                               |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                 | ✅ 0 errors                                                                 |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                      | ✅ 0 errors, 0 warnings (`--max-warnings 10`)                               |

No guard test added this pass: nothing was fixed, and the feature's own new
behavior is already covered by its own test file (`tests/test_passkeys.py`,
58 tests, re-run directly: 58 passed — included in, not separate from, the
scoped-test count above) rather than by a cross-cutting sweep this review
would add to.

Rotation row 01 moves to `✅`.

---

## Pass 12 (2026-10-25, watchdog pickup) — 0 fixed, 1 new finding (AUTH-23, MED, flagged)

Watchdog pickup (step 0, re-verified immediately before branching): no
`claude/security-review-*` PR was open (`search_pull_requests`
`head:claude/security-review-` `is:open` → 0 results; `list_pull_requests`
`state:open` → the same 4 unrelated PRs, none matching). PR #3683 (Feature 00,
Cross-cutting baseline, pass 12) had already merged, closing out rotation lap
"pass 10" and resetting the table to ⬜ for pass 11. Rotation row 01 was the
next ⬜.

**Baseline:** `96b0c924` (PR #3556's merge, pass 11). **Head:** current
`main`. Repository was shallow and was unshallowed
(`git fetch --unshallow`) before trusting any commit count, per the standing
Pitfall #24 risk note. 383 commits between baseline and head (227 non-merge).
`git diff --stat` across all twelve scoped files (nine backend, three
frontend) is non-empty in six: `auth.py` (+195/-4), `dependencies.py`
(+114/-4), `auth_service.py` (+67/-5), `authService.ts` (+25/-3),
`apiClient.ts` (+15/-1) and `schemas/auth.py` (+14). The other six
(`mfa_service.py`, `oauth_service.py`, `consent_service.py`, `security.py`,
`suspicious_ip.py`, `authStore.ts`) are byte-identical to pass 11.

### Route inventory — re-enumerated by AST, not diffed

**31 routes, up from 28 at pass 11** — three new: `POST /auth/step-up`,
`POST /auth/session/kiosk`, `DELETE /auth/session/kiosk`. Enumerated with a
Python AST walk over every `@router.*` decorator and the `Depends(...)` on
the function immediately below it (not grepped from the diff, per this
skill's repeat-pass instruction), cross-checked against
`tests/test_endpoint_auth_coverage.py`'s `ALLOWLISTED_PUBLIC`. Public/private
split is **16 / 15** (unchanged public set — all three new routes are
private). Classification:

| Route                        | Auth dependency                                                                                | Permission                      | Notes                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/step-up`         | `get_current_active_user`                                                                      | none (self re-verification)     | rate-limited (`rate_limit_login()`); writes `stepup_verified_at` only on the caller's **own** session (`session.user_id == current_user.id`, checked explicitly) |
| `POST /auth/session/kiosk`   | `require_permission("security.kiosk_session")`                                                 | `security.kiosk_session`        | acts on caller's own session only (`_set_session_kiosk` 400s on a mismatched `user_id`)                                                                          |
| `DELETE /auth/session/kiosk` | `get_current_user`                                                                             | none (narrowing is always safe) | same self-scoping as the `POST`                                                                                                                                  |
| `PUT /auth/mfa/policy`       | `require_permission("settings.manage", "organization.update_settings")` **+** `require_stepup` | as listed                       | gained the step-up gate this pass (previously permission-only)                                                                                                   |

All other 27 routes unchanged from pass 11's table — re-confirmed by the same
AST walk rather than assumed carried-forward.

### The new feature, reviewed in full: MFA grace period, kiosk sessions, step-up re-verification

This is the auth-surface half of a feature `CI9-33-core-infra.md` already
reviewed from the config/settings side (new `app/core/config.py` settings:
`MFA_GRACE_DAYS`, `STEPUP_WINDOW_MINUTES`, `SESSION_KIOSK_IDLE_TIMEOUT_MINUTES`,
`SESSION_KIOSK_ABSOLUTE_MAX_HOURS`) and confirmed each has a real reader with a
safe default. This pass reviews the same feature from its own three files —
`auth.py`, `auth_service.py`, `dependencies.py` — against all seven checklist
dimensions, rather than re-deriving CI9's settings-level verdict.

- **`dependencies.py` — `evaluate_mfa_requirement` / `MfaRequirement`.**
  Extends the existing org-wide `mfa_required` gate with a second path: a
  member holding any of `mfa_policy.PRIVILEGED_PERMISSIONS` (`*`,
  `settings.manage`, `security.manage`, `users.create/edit/delete/
update_positions`, `audit.export/manage`, `medical_screening.view/manage`)
  must enroll within `MFA_GRACE_DAYS` of first being seen privileged and
  un-enrolled. **Dimension 2 (permission fit) correct:** the privileged set
  deliberately excludes `audit.view` and `members.manage` (held broadly by
  captains/lieutenants/treasurer) and the medical-_inventory_ permissions
  (expiry dates only, no patient data) — `test_mfa_policy.py`'s
  `test_the_seeded_positions_that_must_use_mfa` pins the resulting set to
  exactly 7 seeded positions, so a future broadening of one of those grants
  fails this test rather than silently widening who must enroll. **Correct
  "never started" vs "expired" handling:** `grace_expired(None, now)` returns
  `MFA_GRACE_DAYS == 0` rather than `False`, so a `0`-day install still closes
  the gate for a never-before-seen privileged member instead of leaving it
  open forever (re-verified directly; `test_mfa_policy.py`'s `TestGrace`
  covers both branches). **Losing privilege clears the clock**
  (`dependencies.py:160-166`) — a demoted-then-repromoted member gets a fresh
  grace period rather than inheriting an already-expired one, which is the
  right direction (erring toward re-starting the clock, not toward a
  permanent gate). The one-time notification (`_announce_mfa_grace`) sends a
  plain-text-only message built from `settings.MFA_GRACE_DAYS` (an int) with
  no user-controlled interpolation — dimension 4 (injection/untrusted output)
  n/a here.
  - **Considered, not raised:** two concurrent first-privileged requests from
    the same member could both observe `mfa_grace_started_at is None`, both
    set it to (nearly) the same `now`, and both call `_announce_mfa_grace` —
    a duplicate email, not a security weakening (the grace window measured
    from either timestamp is the same to the second). Not the shape Pitfall
    #27 exists for (no capacity/limit being raced), and the consequence is a
    UX nuisance, not a bypass. Not raised as a finding.
- **`dependencies.py` — `require_stepup`.** A second-factor-style gate
  ("re-verify, then proceed") for a named set of destructive/sensitive
  handlers, separate from the route's own permission check. **Dimension 1/2
  correct and machine-checked, not merely argued:** `test_mfa_policy.py`'s
  `test_step_up_is_on_exactly_the_documented_handlers` AST-walks every
  endpoint file and fails if a handler gains or loses the dependency without
  updating the pinned `STEPUP_HANDLERS` set (24 handlers: exports, security
  policy changes, `admin_reset_password`/`admin_reset_mfa` — the account-
  takeover paths — and `delete_user`/`anonymize_member`); a second test,
  `test_step_up_always_follows_the_permission_check`, asserts the
  `require_stepup` default is the _last_ positional default on every one of
  those handlers, so a caller lacking the permission is told that rather than
  asked to re-verify (FastAPI resolves dependencies in signature order).
  Re-ran both — pass. The stamp (`session.stepup_verified_at`) is read only
  off the **caller's own** session (resolved from the same cookie/header
  `get_current_user` itself authenticated against — `_request_access_token`'s
  resolution order, cookie-then-header, is identical to `get_current_user`'s,
  confirmed by reading both side by side, so the two can never resolve to
  different tokens within one request) and is never trusted across sessions
  — dimension 3 (tenant/self isolation) correct by construction, not merely
  asserted.
- **`auth.py` — `POST /auth/step-up`.** Correct: writes `stepup_verified_at`
  only after an explicit ownership check
  (`str(session.user_id) != str(current_user.id)` → 400, confirmed by
  `test_someone_elses_session_is_refused`), a failed attempt is audited
  (`stepup_failed`) and never stamps the session, and an SSO-only account
  (no password hash, no MFA) is told to enroll rather than silently treated
  as always-false. See **AUTH-23** below for the one gap this review did
  find.
- **`auth.py` / `auth_service.py` — kiosk sessions.** `POST
/auth/session/kiosk` requires `security.kiosk_session` (seeded to **no**
  position — Pitfall #23's concern directly checked: `grep -n
'"security.kiosk_session"' app/core/permissions.py` plus
  `DEFAULT_POSITIONS` shows it granted nowhere by default, so turning this on
  is a per-department decision, not an inherited one) and, like step-up, acts
  only on the caller's own session. The flag is **never trusted by itself**:
  `AuthService.holds_kiosk_session()` re-checks the live permission on every
  refresh (`auth_service.py:594-598` after this pass's line shift) and every
  access-token validation (`:1031-1038`), so a revoked permission drops the
  session to standard limits on its very next use, not at next login —
  re-confirmed by direct read, matching CI9's independent review of the same
  mechanism from the config side. `GET /auth/session-settings` (now richer:
  `session_ends_at`, `is_kiosk`, `kiosk_available`) answers for the request's
  **own** session only, by the same cookie/header `get_current_user` already
  authenticated with — not an IDOR surface, since there is no way to name a
  different session than the one the request is already authenticated by.
- **`schemas/auth.py` — `StepUpRequest`.** `code` bounded to exactly 6
  characters, `password` bounded to 1024 — same shape as the existing
  `MFAVerify`/`UserLogin` schemas, no new unbounded-input surface.
- **`authService.ts` / `apiClient.ts` / `utils/stepUp.ts` /
  `contexts/StepUpContext.tsx` (new, read in full though outside this
  feature's originally-scoped 12 files, since it is the frontend half of the
  same new auth mechanism `apiClient.ts`'s diff calls into).** The 403
  `LB-AUTH-013` → prompt → retry flow uses a `Modal` with a password/number
  input, never `window.prompt` (Pitfall #16 n/a — confirmed, not assumed).
  Concurrent 403s share one in-flight prompt (`requestStepUp`'s `inFlight`
  memo) rather than stacking dialogs. The field correctly switches
  `type="password"` for the no-MFA branch and `inputMode="numeric"` for the
  TOTP branch; `autoComplete` values are the standard ones for each case, not
  `"off"` (fighting password-manager autocomplete would be a separate,
  unrelated finding if attempted and wrong — it was not attempted here).
  `StepUpProvider` is mounted once at the app root, above the router, inside
  `ConfirmProvider` — same placement rule as `useConfirm()`'s own provider
  (Pitfall #16) for the same reason (public routes need it too, in principle,
  though in practice only an authenticated caller ever reaches a
  `require_stepup`-gated action).

### AUTH-23 — MED — `POST /auth/step-up` has no account-tied lockout; a stolen live session lets an attacker brute-force the password or TOTP code that gates the most sensitive actions in the app — FLAGGED (not fixed)

**What:** `step_up` (`backend/app/api/v1/endpoints/auth.py:1486-1549`) checks
a submitted password with `verify_password()` or a submitted TOTP code with
`_verify_and_consume_totp()` and, on a mismatch, only audits the failure
(`stepup_failed`) and returns 400 — it never touches
`user.failed_login_attempts` / `locked_until`, the columns the account-lockout
control (CLAUDE.md's Attack Protection table, second of four layers) is
measured against. The only throttle is `rate_limit_login()`
(`security_middleware.py:1010-1022`): 5 requests/60s per IP, keyed to the
shared `scope="login"` bucket, then a 30-minute **IP** lockout.

**Where:** `backend/app/api/v1/endpoints/auth.py:1486-1549` (`step_up`), the
`rate_limit_login()` dependency at line 1486.

**Failure scenario:** an attacker who has obtained a member's **live session**
(cookie theft via malware or a shared/unattended device, a session fixation
bug elsewhere, or physical access to an unlocked device) but does not know the
account's password or TOTP secret cannot use most of the app's destructive or
security-sensitive actions, because 24 handlers require a fresh step-up first
— `admin_reset_password`, `admin_reset_mfa`, `delete_user`,
`anonymize_member`, `set_mfa_policy`, every `ip_security.py`/`roles.py`
mutation, and several exports. Lacking the account-lockout tie-in, the
attacker can submit guesses against `/auth/step-up` at the shared per-IP rate
limit indefinitely (30 minutes idle after each cap, then resume) with **no
account-level consequence ever recorded against the real owner** — contrast
`/login` and `/mfa/login`, where the same wrong-password/wrong-code guess
**does** increment the lockout counter via `authenticate_user`'s
`.with_for_update()` re-read (AUTH-20, app-review track).
**This is not a new regression as a class** — `mfa_disable`,
`mfa_verify_setup` and `mfa_regenerate_recovery_codes` have carried the
identical shape (TOTP-only, same `rate_limit_login()`, no lockout tie-in)
since early passes and were never flagged, because a wrong guess there costs
the attacker a real TOTP search space and gates only the caller's own MFA
settings. **The delta this pass introduces:** `step_up` is the first member of
this family to accept a bare **password** guess (a much smaller, often
human-chosen search space than a TOTP code), and it is the gate in front of
the single largest set of sensitive actions in the codebase — materially
raising both the guessability and the blast radius relative to the precedent.

**Impact:** account takeover and destructive-action execution, conditioned on
an attacker already holding a live, valid session for a privileged account —
itself a serious prior compromise. Not an unauthenticated attack surface.

**Why flagged, not fixed:** tying step-up failures into the same
`failed_login_attempts`/`locked_until` columns `authenticate_user` uses is a
live option, but it is a genuine product tradeoff rather than a mechanical
fix: it would let the **same attacker** who stole the session deliberately
lock the legitimate owner out of logging in at all, by repeatedly failing
step-up on purpose — trading a guessing weakness for a new denial-of-service
lever against the real account holder, on exactly the privileged accounts
this feature exists to protect. A narrower per-account (not per-IP) rate
limit scoped to step-up specifically, with a longer window but no account
lock, is the other candidate and carries its own DoS-shaped tradeoff at a
smaller scale. Either choice is an owner decision about which failure mode to
prefer, not a verifiable one-line change safe to make inside this review.

**Fix:** not applied. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Severity reasoning:** MED — the precondition (a stolen live session) is
itself already a serious breach, which keeps this below HIGH; but the actions
gated are the most sensitive in the app (account takeover, destructive
deletes, security-policy changes) and the guessable secret (a password, for
an SSO-less account) is materially weaker than the TOTP-only precedent that
was never flagged, which keeps it above LOW.

**Disposition:** OPEN / FLAGGED. No guard test added — a test asserting
`step_up` does _not_ increment the lockout counter would freeze the gap
rather than catch a regression, which is not this suite's purpose.

### Standing items — reconfirmed unchanged from pass 11

AUTH-15, AUTH-17, AUTH-21 and AUTH-22 are all already closed (pass 8's and
pass 10's fixes, confirmed unchanged at pass 11), and `docs/KNOWN_LIMITATIONS.md`
carries no entry for any of them beyond the new AUTH-23 added by this pass —
reconfirmed by grep.

### Completion gate (pass 12)

| Check                                                                                                                                                                                                                                                              | Result                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                                                                                                                    | ✅ 0 violations                                                             |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                                                                                                                           | ✅ clean, 2637 files unchanged                                              |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                          | ✅ clean                                                                    |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                  | ✅ single head `3d67883cd461`, 651 revisions                                |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                              | ✅ 276 routes, 0 errors/0 warnings                                          |
| scoped backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission or authentik or password or security_notification or stepup or kiosk"`)                                                                                  | ✅ 1383 passed, 2 skipped (environment-only — `pywebpush`, Docker registry) |
| standing guards (`endpoint_auth_coverage`, `org_scoping_ratchet`, `capacity_locking`, `like_escaping`, `mfa_policy`, `session_limits`, `auth_lockout_race`, `auth_refresh_rotation`, `password_expiry_gate`, `sign_in_audit`, `account_status_gates`) run directly | ✅ 205 passed                                                               |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                 | ✅ 0 errors                                                                 |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                      | ✅ 0 errors, 0 warnings                                                     |

Rotation row 01 moves to `✅`.

---

## Pass 11 (2026-10-22, watchdog pickup) — 0 fixed, 0 new findings; all changed code already correct

Watchdog pickup: no `claude/security-review-*` PR was open
(`search_pull_requests`), and the dedicated `/loop 30m /security-review`
session was not reachable (`ListAgents`). PR #3555 (Feature 00,
Cross-cutting baseline, pass 11) had already merged clean, closing out
rotation lap "pass 9" (every row ✅); the table was reset to ⬜ for pass 10
and Feature 00 reviewed in that same iteration (see `PROGRESS.md` and
`SEC-00-cross-cutting-baseline.md`'s own Pass 11 section). Rotation row 01
was the next `⬜`.

**Baseline:** `ccb4b805` (PR #3397's merge, pass 10). **Head:** current
`main`. 611 commits between them (373 non-merge) — another shallow pass:
`git diff --stat` across all twelve scoped files (nine backend, three
frontend) is non-empty in exactly three — `auth_service.py` (+75/-31),
`dependencies.py` (+7/-1) and `consent_service.py` (+2/-2). The other nine
(`auth.py`, `mfa_service.py`, `oauth_service.py`, `security.py`,
`suspicious_ip.py`, `schemas/auth.py`, `authStore.ts`, `apiClient.ts`,
`authService.ts`) are byte-identical to pass 10.

### The three changed files, reviewed

- **`auth_service.py` — session idle timeout gains an absolute-lifetime
  twin, and the logic moves into a shared helper.** `session_end_reason
(session, now)` (module-level, new) returns `"idle"`, `"absolute"` or
  `None`, reading `HIPAA_SESSION_TIMEOUT_MINUTES` and the new
  `SESSION_ABSOLUTE_MAX_HOURS` (both 0-means-off, both measured from
  server-written timestamps — `last_activity`/`created_at` — so a client
  cannot lengthen either). It replaces the idle-only check that used to be
  inlined in `get_user_from_token`, and is now also called from
  `refresh_access_token`, which previously had **no** session-lifetime
  check of its own — a session that aged out on the access-token path could
  still be refreshed indefinitely as long as the refresh token kept getting
  rotated before its own 7-day expiry. Traced both call sites for a
  regression:
  - `get_user_from_token`: on `ended`, the function now returns `None`
    **without** deleting the session row (the prior idle-only code did
    delete it). The docstring's own rationale checks out: the browser's
    next move after a 401 is a refresh-token attempt, and
    `refresh_access_token` requires the row to exist to answer "sign in
    again" rather than "replay detected, revoke everything" — deleting the
    row here would have made every idle timeout look like token theft to
    the refresh path. Confirmed `refresh_access_token`'s "no session
    found" branch (which does revoke every session) is a genuinely
    different condition (refresh token not found at all, i.e. already
    rotated/replayed) from "session found but ended" (handled separately,
    just above it, by a plain delete + `(None, None)`) — the two can't be
    confused by a real client, since a legitimate idle session still has
    its row and its still-valid-shaped refresh token.
  - `refresh_access_token`: on `ended`, deletes the session and commits,
    same as the access-token path's old behavior — closing the gap
    described above. Ordering confirmed correct: this check runs after the
    session is found by refresh token (so it can't be reached by a
    genuinely replayed/unknown token, which hits the revoke-all branch
    first) and before the user/organization lookup, so an ended session
    can't incidentally succeed a refresh by having an inactive organization
    masked as "just refuse".
  - `touch_activity` (the new parameter on `get_user_from_token`, default
    `True`) only skips the `session.last_activity` **write** when `False`
    — every other check (token decode, session lookup, `ended`, user
    lookup) is unconditional before it, so a caller passing `False` can
    only ever make its own session's idle clock run for real while
    appearing to do nothing, never bypass or extend anything. (This is the
    server half of `frontend/src/utils/backgroundRequest.ts`'s
    `BACKGROUND_REQUEST_CONFIG`, wired in `dependencies.py` below — already
    audited end-to-end during this same pass's sibling reviews, Feature 34
    Frontend shared pass 10 and Feature 00 Cross-cutting baseline pass 11;
    re-confirmed here by direct read rather than re-cited blindly, since
    `dependencies.py` is this feature's own file.)
  - `created_at` is now stamped in Python (`datetime.now(timezone.utc)`) at
    session-creation time, matching the existing comment one line above it
    for `last_activity`: MySQL's own `now()`/`func.now()` follows the DB
    session's timezone, which pass 8 (Core infrastructure) already fixed
    at the connection level (`init_command: SET time_zone = '+00:00'`) —
    this is the same defensive belt-and-suspenders pattern as
    `last_reset_user`'s reset in pass 10, not a sign the connection-level
    fix is being second-guessed.
- **`dependencies.py` — `get_current_user`** passes
  `touch_activity=request.headers.get("x-background-request") != "1"` into
  `get_user_from_token`. Covered above.
- **`consent_service.py` — `get_consent_status_rollup`** (name approximate;
  the audience-listing method for a staff consent view) now filters
  `User.status.in_(ACTIVE_ACCOUNT_STATUSES)` instead of `User.status ==
UserStatus.ACTIVE`, closing a CLAUDE.md Pitfall #32 instance: a
  probationary member was previously dropped from this roster (and so
  silently excluded from `include_inactive=False` consent-audience views)
  despite being a current member who can hold a consent decision like
  anyone else. Already landed by other engineering work (the repo-wide
  Pitfall #32 sweep); re-verified by direct read rather than taken on the
  commit message — confirmed no second, un-migrated literal `==
UserStatus.ACTIVE` survives elsewhere in this file.

### Route inventory — re-enumerated

Still 28 routes, unchanged from pass 10 — confirmed by `grep -c
"^@router\.\(get\|post\|put\|patch\|delete\)" auth.py` (28) and
`check_route_permissions.py --strict` (273 routes repo-wide, 0 errors/0
warnings). `auth.py` itself has 0 diff this pass, so no route's decorator
or dependency could have changed.

### Standing items — reconfirmed unchanged from pass 10

AUTH-15, AUTH-17, AUTH-21 and AUTH-22 are all already closed (pass 8's and
pass 10's fixes), and `docs/KNOWN_LIMITATIONS.md` carries no entry for any
of them — reconfirmed by grep. No open AUTH finding exists to re-verify
this pass.

### No duplicate session-lifetime logic

`grep -rn "HIPAA_SESSION_TIMEOUT_MINUTES\|SESSION_ABSOLUTE_MAX_HOURS"
app/`: the only reader of either setting outside `core/config.py` is
`session_end_reason` itself, plus one read-only report of
`HIPAA_SESSION_TIMEOUT_MINUTES` in `auth.py` (a settings-echo endpoint the
frontend uses to display the configured timeout, not to enforce it) — no
second implementation of the idle/absolute decision exists to drift from
this one (Pitfall #29).

### Completion gate (pass 11)

| Check                                                                                                                                                                                                                                                                  | Result                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                          | ✅ 0 violations                                                             |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                   | ✅ clean (2555 files)                                                       |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                              | ✅ clean                                                                    |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                      | ✅ single head `e5f9bb066e07`, 639 revisions                                |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                                  | ✅ 273 routes, 0 errors/0 warnings                                          |
| scoped backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission or authentik or password or security_notification"`)                                                                                                         | ✅ 1205 passed, 2 skipped (environment-only — `pywebpush`, Docker registry) |
| standing guards (`endpoint_auth_coverage`, `org_scoping_ratchet`, `capacity_locking`, `like_escaping`, `mfa_verification_consumes`, `auth_lockout_race`, `auth_gate_remediation_paths`, `auth_refresh_rotation`, `password_expiry_gate`, `sign_in_audit`) run directly | ✅ 118 passed                                                               |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                     | ✅ 0 errors                                                                 |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                          | ✅ 0 errors, 0 warnings                                                     |

No frontend source file is in this pass's diff.

Rotation row 01 moves to `✅`.

---

## Pass 10 (2026-10-18, watchdog pickup) — 1 fixed, 0 new findings

Watchdog pickup: no `claude/security-review-*` PR was open
(`search_pull_requests`), and the dedicated `/loop 30m /security-review`
session was not reachable (`ListAgents`). PR #3396 (Feature 00,
Cross-cutting baseline, pass 10) had already merged clean. Rotation row 01
was the next `⬜`.

**Baseline:** `28850d09` (PR #3210's merge, pass 9, found via `git log
--all --format='%H %s' | grep security-review-auth-session`). **Head:**
current `main`. 631 commits between them (326 non-merge) — not a
zero-delta pass, but a shallow one: `git diff --stat` across all twelve
scoped files (nine backend, three frontend) is non-empty in exactly two —
`auth.py` (+59/-2) and `auth_service.py` (+35/-6). The other ten
(`mfa_service.py`, `oauth_service.py`, `consent_service.py`,
`dependencies.py`, `security.py`, `suspicious_ip.py`, `schemas/auth.py`,
`authStore.ts`, `apiClient.ts`, `authService.ts`) are byte-identical to
pass 9.

### The one changed commit, reviewed

Both diffed files come from a single regular-engineering commit adding
HIPAA §164.312(b) audit logging and a member-facing security notification
(in-app + email) to `/auth/change-password` and `/auth/reset-password` —
the same shape MFA enable/disable/recovery-code-regenerate already had.

- **`auth.py` — `change_password`** now takes `request: Request` and
  `background_tasks: BackgroundTasks`, and calls the existing
  `_audit_sign_in` helper (already reviewed at prior passes for the login
  path) on both the refusal and success branches, then
  `notify_security_event` on success. On refusal it explicitly
  `await db.commit()`s before raising the `HTTPException` — the same
  "`get_db` rolls back on the exception, so commit here or lose the row"
  pattern `_audit_refused_sign_in` already established; not a new pattern,
  just a new caller of it. The audit payload (`member` dict) is built from
  `current_user` — the already-authenticated caller, never a client-
  supplied id — so there is no IDOR surface (dimension 3 n/a: nothing is
  looked up by id).
- **`auth.py` — `reset_password`**'s audit row now attributes a
  **successful** reset to the member the token actually resolved to
  (`AuthService.last_reset_user`, set server-side inside
  `reset_password_with_token`), while a **refusal** still writes
  platform-level with no user attribution. This is the correct split, not
  an oversight: the submitted token may not resolve to any account, and a
  guessed/malformed token must not let a caller write an attributable row
  against someone else's account by supplying their id — the same
  no-enumeration-via-audit-log property this file's AUTH-7 already
  established for a different endpoint. Verified `last_reset_user` is
  reset to `None` at the top of `reset_password_with_token` on every call
  (`auth_service.py:1077`) so a stale value from an earlier request on the
  same `AuthService` instance can't leak forward — though in practice a
  fresh instance is constructed per request (`auth_service = AuthService(db)`
  at the top of the endpoint), so this is a belt-and-suspenders reset, not
  a fix for an observed cross-request reuse.
- **`auth_service.py` — `change_password`** gains
  `self.last_password_change_failure`, set to one of six new module-level
  constants (e.g. `PASSWORD_CHANGE_FAILURE_INVALID_CURRENT`,
  `PASSWORD_CHANGE_FAILURE_BREACHED`) at each refusal branch, read back by
  the endpoint for the audit row's `reason` field. Confirmed this is purely
  additive bookkeeping, not a behavior change: `current_hash = user.password_hash`
  is read once and reused everywhere the old code re-read
  `user.password_hash` (history check, same-as-current check, history
  save), and `if not current_hash or not current_valid:` is logically
  identical to the prior `if not current_valid:` — `current_valid` was
  already `False` whenever `current_hash` was falsy, via the ternary above
  it, so the added `or` clause changes no outcome, only makes the SSO-only
  (no password hash) case explicit for the new failure constant. Confirmed
  no response ever echoes the `reason` string back to an unauthenticated
  caller — `change_password` requires `get_current_active_user`, so this
  carries no enumeration risk the way a public-endpoint error detail would.

### AUTH-22 (LOW, FIXED) — security-notification email escaped on the `BackgroundTasks` path, not on the inline fallback

**File:** `backend/app/utils/security_notifications.py:148` (inline
fallback branch of `notify_security_event`)

`notify_security_event` has two paths to actually send the email:

- With `background_tasks` supplied (every current `auth.py`/`users.py`
  caller), `_send_security_email` builds the HTML with
  `f"<p>{html_escape(message)}</p>"` (line 80).
- Without it (`scheduled_tasks.py`'s password-expiry notifier, which runs
  outside a request and has no `BackgroundTasks` to queue onto), the
  inline fallback built the same HTML as `f"<p>{message}</p>"` — no
  escaping.

`wrap_email_body`'s own docstring (`app/services/email_service.py:329`)
documents its `body_html` parameter as "Pre-escaped HTML for the content
area" — the inline path violated that contract. **Failure scenario:** if a
future caller ever passes user-influenced text into `message` through the
inline path (the shape most likely for a new scheduled-task notifier,
which is exactly the kind of caller that has no `background_tasks` to
supply), an HTML/script payload in that text would render unescaped in the
recipient's mail client — a stored-XSS-in-email vector. **Not
exploitable today:** audited every current caller
(`grep -rn "notify_security_event(" backend/app/`, five call sites) —
`scheduled_tasks.py`'s is the only one that omits `background_tasks`, and
its `message` is an f-string built only from `max_age_days` (an int from
settings) and `when` (a `strftime`-formatted date), neither
attacker-reachable.

**Fix:** added the missing `html_escape(message)` call to the inline
fallback, matching the background-task path exactly:

```python
html = wrap_email_body(org, subject, f"<p>{html_escape(message)}</p>")
```

**Guard test:** `test_inline_fallback_escapes_message_html` in
`backend/tests/test_security_notifications.py`, patching
`app.services.email_service.wrap_email_body` and `EmailService` to capture
the HTML the inline path would send, calling `notify_security_event` with
`background_tasks=None` and a `<script>alert(1)</script>` message, and
asserting the captured HTML contains the escaped form and not the raw
`<script>` tag.

### Route inventory — re-enumerated

Still 28 routes, unchanged from pass 9. Neither changed function is a
route-gating change: `change_password`'s decorator
(`@router.post("/change-password", dependencies=[rate_limit_password_change()])`)
and `Depends(get_current_active_user)` are untouched; `reset_password`'s
decorator (`@router.post("/reset-password", dependencies=[rate_limit_password_reset_token()])`)
is likewise untouched — it was already public/token-scoped before this
commit. `ALLOWLISTED_PUBLIC` in `tests/test_endpoint_auth_coverage.py`
still lists the same 16 `auth.py` entries pass 9 confirmed.

### Standing items — reconfirmed unchanged from pass 9

AUTH-15, AUTH-17 and AUTH-21 were all already closed (pass 8's owner
decisions D8/D4 and the `RefreshTokenSuperseded` fix, respectively), and
`docs/KNOWN_LIMITATIONS.md` carries no entry for any of the three —
reconfirmed by grep, nothing to re-add. AUTH-22 above needs no
`KNOWN_LIMITATIONS.md` entry either: it is fixed outright, not an
owner-decision item.

### Completion gate (pass 10)

| Check                                                                                                                                                                                                                                                                  | Result                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/`                                                                                                                                                                                                                            | ✅ 0 violations                                                             |
| `python3.13 -m black --check app/ tests/ alembic/`                                                                                                                                                                                                                     | ✅ clean (after formatting the one new test file with `black`)              |
| `python3.13 -m isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                | ✅ clean                                                                    |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                   | ✅ single head `1117b642643b`, 618 revisions                                |
| `python3.13 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                               | ✅ 270 routes, 0 errors/0 warnings                                          |
| scoped backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission or authentik or password or security_notification"`)                                                                                                         | ✅ 1198 passed, 2 skipped (environment-only — `pywebpush`, Docker registry) |
| standing guards (`endpoint_auth_coverage`, `org_scoping_ratchet`, `capacity_locking`, `like_escaping`, `mfa_verification_consumes`, `auth_lockout_race`, `auth_gate_remediation_paths`, `auth_refresh_rotation`, `password_expiry_gate`, `sign_in_audit`) run directly | ✅ 118 passed                                                               |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                     | ✅ 0 errors (after `npm ci` from the repo root — see note below)            |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                          | ✅ 0 errors, 0 warnings                                                     |

**Note on the frontend gate:** `npm run typecheck` initially failed with
`TS2307: Cannot find module '@tiptap/react'`/`'@tiptap/starter-kit'` —
both are declared in `frontend/package.json` but were missing from this
sandbox's `node_modules`. This is a sandbox dependency-install gap, not a
code defect: `npm ci` from the repo root (the repo's documented single-
lockfile install path, not a lockfile-regenerating `npm install`) restored
them, and the typecheck then passed with 0 errors. No frontend source file
is in this pass's scope or diff.

Rotation row 01 moves to `✅`.

---

## Pass 9 (2026-10-14, watchdog pickup) — 0 fixed, 0 new findings; delta re-verify only

Watchdog pickup: the `/security-review` loop appeared stalled (no activity for
over an hour). Verified directly against GitHub, not against this file's own
Open PR row, that no `claude/security-review-*` PR was open (listed open PRs
and searched `head:claude/security-review-`, both empty). PR #3204 (Feature
00, Cross-cutting baseline, pass 9) had merged 2026-10-14T08:39:59Z with no
follow-up iteration since; that PR's own commit had already reset the
rotation table to `⬜` and left an Open PR row describing itself (stale now
that it merged — cleared as part of this pass's own PR, per Step 0/Step 8,
riding along without its own commit). Rotation row 01 was the next `⬜`.

**Numbering correction:** the task that queued this review called it "pass
8". It is pass 9 — `## Pass 8 (2026-10-12, watchdog pickup)` immediately
below already exists in this file and closed out PR #3096 before this
iteration started. Corrected here the same way pass 7 corrected pass 6's
unfilled header placeholder.

**Baseline:** `89ea4d6a` (PR #3096's merge, pass 8). **Head:** current `main`
(`7837b780`, confirmed an ancestor of the baseline via `git merge-base
--is-ancestor`). 357 commits between them, 198 non-merge — not a zero-delta
pass, but a shallow one: of the twelve files this feature tracks (nine
backend, three frontend), `git diff 89ea4d6a..HEAD` is non-empty in exactly
three — `auth.py` (+5/-2), `auth_service.py` (+4/-3), `apiClient.ts`
(+19/-2). The other nine (`mfa_service.py`, `oauth_service.py`,
`dependencies.py`, `security.py`, `schemas/auth.py`, `consent_service.py`,
`suspicious_ip.py`, `authStore.ts`, `authService.ts`) are byte-identical to
pass 8.

### The three changed files, reviewed

- **`auth.py` / `auth_service.py` — two unrelated mypy-driven commits, each
  with one real (and benign) fix, neither a security regression.**
  - `51c77a9c` ("Fix mypy errors in the API layer") widens
    `_set_auth_cookies`'s `response` parameter from `JSONResponse` to
    `Response` — type-only; the same five callers (login, MFA login,
    register, OAuth, refresh) still route through this one choke point for
    cookie issuance, matching `docs/app-review/auth-session.md`'s
    "Duplication" note that this is the single place `Secure`-flag logic
    lives. It also adds `if not locked_user.mfa_secret: return False` to
    `_verify_and_consume_totp` (`auth.py:1068`, inside the `.with_for_update()`
    locked read documented at `auth.py:1040-1057`). Before this, a locked row
    with no enrolled secret would have called
    `mfa_service.verify_totp_get_timestep(None, ...)`; the guard now fails
    closed on that case explicitly rather than depending on the callee to
    cope with `None`. No existing caller could reach this with
    `mfa_enabled=True`, so this hardens a theoretical gap rather than closing
    a live one — not raised as its own finding, since the fix already
    landed via the unrelated mypy pass.
  - `0d4d7c5a` ("fix(types): settle the three cross-cutting mypy error
    classes") replaces `auth_service.py`'s raw `.rowcount` reads with
    `app.utils.sql_results.rows_affected()` at AUTH-21's rotation guard
    (`auth_service.py:530`) and `revoke_all_user_sessions` (`:582`), and
    widens `register_user`'s `organization_id` parameter to `UUID | str`
    (annotation only — the body already received and used str ids).
    `rows_affected()` (`app/utils/sql_results.py`, read directly) raises
    `TypeError` when the result is not a `CursorResult`, rather than reading
    a wrong type as `0` — i.e. it narrows the AUTH-21 compare-and-swap's
    failure mode from "silently treat as lost the race" to "raise", the
    safer direction for a security-relevant concurrency guard. Same `== 0`
    comparison and same rotation/revocation logic pass 8 already reviewed;
    not a behavior change for the success path.
- **`apiClient.ts` — `c82fc99d`, "Stop silently retrying a deliberate 503 so
  its message reaches the user".** Narrows the existing 503-retry-with-
  backoff logic (reviewed clean at pass 4, unchanged in shape since) to fire
  only for `LB-SYS-002`, the generic `LB-API-503` fallback, or a response
  with no parseable `code` at all — a 503 the backend sends on purpose (e.g.
  `LB-UPLD-005`, malware scanner down, which carries `Retry-After: 60`) now
  surfaces immediately instead of being silently retried for roughly 4.75
  minutes. A UX/availability fix, not auth-adjacent: it touches no cookie,
  token, or refresh logic, and `performSharedRefresh` — the function this
  feature actually cares about in this file — is textually unchanged; the
  new code sits entirely between it and the interceptor's existing
  401-refresh branch.

### Route inventory — re-enumerated

28 routes, unchanged from pass 8. Public/private split still 16/12; every
`@router.` decorator and its `Depends(...)` (or `dependencies=[...]`) read
fresh against current `auth.py`, matching pass 8's table line for line — no
route gained, lost, or changed a gate or permission string.
`tests/test_endpoint_auth_coverage.py`'s `ALLOWLISTED_PUBLIC` still lists
exactly these 16 `auth.py` entries (confirmed by reading the list, not
assumed): `get_login_branding`, `get_oauth_config`, `get_captcha_config`,
`oauth_google_initiate`, `oauth_google_callback`, `oauth_microsoft_initiate`,
`oauth_microsoft_callback`, `oauth_authentik_initiate`,
`oauth_authentik_callback`, `register`, `login`, `mfa_login`,
`refresh_token`, `forgot_password`, `reset_password`,
`validate_reset_token`.

### Standing items — reconfirmed unchanged from pass 8

AUTH-15, AUTH-17 and AUTH-21 were all closed at pass 8 (owner decisions D8
and D4, PR #2918; and the `RefreshTokenSuperseded` 409 fix, respectively).
None of the files those fixes live in (`password_expiry.py`,
`scheduled_tasks.py`, the `refresh_access_token` rotation in
`auth_service.py`) show any further change in this delta beyond the
`rows_affected()` swap already covered above. No `KNOWN_LIMITATIONS.md`
entry exists for any of the three (re-confirmed by grep); none needed
re-adding. The app-review track's separate open item (`AUTH-2`/consent
enforcement for `PHOTO_USE` and `PUBLIC_ROSTER_LISTING`) is unchanged and
already correctly recorded as open in `docs/KNOWN_LIMITATIONS.md`'s
"Consent enforcement" row — not re-derived here.

### Considered and deliberately not raised

- `mfa_login`'s failed-attempt increment path for a contentless request
  (neither `code` nor `recovery_code`) — unchanged since pass 7/8's
  reasoning: it guesses nothing, so racing it buys an attacker zero
  information. Not raised.

### Completion gate (pass 9)

| Check                                                                                                                                                                                                                                                                  | Result                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.3.0, CI's current pin)                                                                                                                                                                                                  | ✅ 0 violations                                                            |
| `python3.13 -m black --check app/ tests/ alembic/` (26.5.1, CI's pin)                                                                                                                                                                                                  | ✅ 2281 files unchanged                                                    |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                                                                                                                                                              | ✅ clean                                                                   |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                   | ✅ single head `a17a47c5a871`, 591 revisions                               |
| `python3.13 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                               | ✅ 269 routes, 0 errors/0 warnings                                         |
| scoped backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission or authentik"`)                                                                                                                                              | ✅ 997 passed, 2 skipped (environment-only — `pywebpush`, Docker registry) |
| standing guards run directly (`endpoint_auth_coverage`, `org_scoping_ratchet`, `capacity_locking`, `like_escaping`, `mfa_verification_consumes`, `auth_lockout_race`, `auth_gate_remediation_paths`, `auth_refresh_rotation`, `password_expiry_gate`, `sign_in_audit`) | ✅ 118 passed                                                              |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                     | ✅ 0 errors                                                                |
| `cd frontend && npm run lint` (ESLint, `--max-warnings 10`)                                                                                                                                                                                                            | ✅ 0 errors, 0 warnings                                                    |

No source file was changed by this pass — every check above verifies a tree
this pass read but did not modify, not a regression check against a new fix.
Rotation row 01 moves to `✅`.

---

## Pass 8 (2026-10-12, watchdog pickup) — 0 fixed by this pass, 0 new findings; all three standing items closed by other work

Watchdog pickup: no `claude/security-review-*` PR or branch existed anywhere
in the repo (`list_pull_requests` state=open and `search_pull_requests
head:claude/security-review-`, both empty), and `main`'s last security-review
merge (Feature 00, pass 8, PR #3095) had no follow-up iteration since.
Rotation row 01 was the next `⬜`.

**Baseline:** `9aba1ea0` (PR #2924's merge, pass 7, confirmed via `git log
--all --grep`, not the first commit touching this doc file that `git log`
turns up — see the "Documentation correction" note below). **Head:**
current `main`. 634 commits between them — not a zero-delta pass.
`git diff 9aba1ea0..HEAD` across all twelve scoped files (nine backend,
three frontend) is non-empty in eight: `auth.py`, `auth_service.py`,
`oauth_service.py`, `dependencies.py`, `security.py`, `schemas/auth.py`,
`authStore.ts`, `authService.ts`, `apiClient.ts`. `mfa_service.py` and
`consent_service.py` carry mypy-driven type-annotation changes only (no
behavior change); `suspicious_ip.py` is byte-identical.

### All three standing items, re-verified: closed by other tracks, not by this pass

- **AUTH-15 (MED, HIPAA max password age enforced only in the browser) — now ✅ FIXED.**
  Owner decision D8 (PR #2918, merged 2026-10-06, after pass 7). Read directly:
  `app/utils/password_expiry.py` (new) defines `is_password_expired` /
  `is_past_grace` / `password_change_deadline`; `dependencies.py:239`'s
  `get_current_user` now raises 403 once a member is past the grace period
  that starts on the first authenticated request (or daily notice) after
  expiry — `HIPAA_PASSWORD_EXPIRY_GRACE_DAYS`, default 14, exists precisely so
  an installation turning this on for the first time does not lock out every
  overdue member (administrators included) the day it deploys. The gate
  exempts the same `_MUST_CHANGE_PW_ALLOWED_SUFFIXES` the `must_change_password`
  gate does, so the change-password screen itself stays reachable.
  `password_expiry_notified_at` is cleared on every password change/reset
  (`auth_service.py:812`, `:1111`), so a new password starts a fresh clock
  rather than inheriting a stale notification. Guard test:
  `tests/test_password_expiry_gate.py` (re-ran, passes).
- **AUTH-17 (LOW, no session reaper) — now ✅ FIXED.** Owner decision D4
  (PR #2918). Read directly: `scheduled_tasks.py`'s
  `run_reap_expired_sessions` (new) is registered in both the task-dispatch
  map and the interval map (`"reap_expired_sessions": 86400` — daily), batch-
  deletes (`_SESSION_REAP_BATCH = 1000`) session rows past
  `REFRESH_TOKEN_EXPIRE_DAYS + SESSION_RETENTION_DAYS_AFTER_REFRESH_EXPIRY`
  (30 days past refresh-token death, a documented owner decision dated
  2026-10-04). Not org-scoped by query, which is correct here and not an
  XC-3 gap: a maintenance sweep deleting globally-expired-by-timestamp rows
  returns nothing to any caller, so there is no tenant boundary to cross.
- **AUTH-21 (app-review track, LOW, double-fired refresh could revoke every
  session) — now ✅ FIXED.** Already recorded fixed in
  `docs/app-review/auth-session.md` (2026-10-05, option b, same day as this
  file's pass 7 — pass 7 re-confirmed it "unchanged" from a baseline that
  predates the fix landing). Re-verified directly in current code, not
  trusted from the other track's write-up: `auth_service.py`'s
  `refresh_access_token` rotates via `UPDATE … WHERE id = :id AND
refresh_token = :presented`; a losing concurrent request (`rowcount == 0`)
  raises the new `RefreshTokenSuperseded`, which `auth.py`'s `/refresh`
  handler answers with **409 `LB-AUTH-012`** rather than revoking anything.
  `frontend/src/services/apiClient.ts`'s `performSharedRefresh` recognizes
  that exact status+code pair and treats it as success (the shared cookie
  jar already holds the winner's tokens), re-raising anything else. A refresh
  that starts **after** the first has already committed still finds no
  matching row and is treated as replay, unchanged — this is deliberate, not
  a residual gap: telling that apart from theft needs the previous token on
  record, which a separate owner decision (CI3-33) removed the grace period
  for. Guard tests: `tests/test_auth_refresh_rotation.py` (interleaved
  rotation against the real database, both sessions survive) and
  `apiClient.test.ts`. No `KNOWN_LIMITATIONS.md` entry remains for any of
  the three — all three were already removed by the fixing commits.

### The eight changed files, reviewed

- **`auth_service.py` / `dependencies.py` — AUTH-15's gate**, described above.
  Also new: a frozen `AuthFailure` dataclass and `self.last_auth_failure`,
  set by `authenticate_user` on every refusal (unknown user, no password,
  locked, wrong password) and read only by the login endpoint to attribute a
  brute-force alert to the right account/department (SEC2-28-7 — out of this
  feature's scope, reviewed only as an external caller). Never returned to
  the caller — the response is still the same generic "Incorrect username or
  password" on every branch; the docstring says as much and the code matches
  it. Not an enumeration gap.
- **`auth_service.py` — AUTH-21's conditional-`UPDATE` rotation**, described
  above, plus a new `_revoke_mcp_connections` called alongside
  `_revoke_all_user_sessions` on both change-password and reset-password:
  a password change is how a member says "someone may have my account", and
  without this an MCP client's refresh token would keep working for up to
  its own grant's lifetime after the browser sessions were cut.
  `McpOAuthService.revoke_all_for_user` filters strictly by the caller's own
  `user_id` (server-derived, never client-supplied), so this is not an IDOR
  path. `password_expiry_notified_at` is also cleared here (see AUTH-15).
- **`dependencies.py` — `collect_user_permissions`**, a new public wrapper
  around the existing `_collect_user_permissions`. Exactly two external
  callers, both in the MCP OAuth subsystem (`mcp_oauth.py:127`,
  `mcp/oauth.py:1283`), matching its own docstring ("a connection can never
  hold a permission the member's positions and rank do not"). Full review of
  the MCP OAuth server is its own feature (`MCPO-27-mcp-oauth-server.md`);
  reviewed here only as a new caller of this feature's code, not re-derived.
- **`oauth_service.py` — Authentik (OIDC) sign-in, new in full.** Same
  account policy as Google/Microsoft (link-existing-only, verified email
  required, optional domain allowlist) with its own hardening: the discovery
  document's `issuer` must equal the configured issuer, and
  `authorization_endpoint`/`token_endpoint`/`jwks_uri` must each be on the
  issuer's own origin (`_same_origin`) before any of them is trusted — a
  tampered discovery document cannot redirect the token exchange or JWKS
  fetch elsewhere. `_verify_id_token` decodes with `algorithms=
_AUTHENTIK_ALGORITHMS` (asymmetric only — no HS256 confusion attack) and
  enforces both `audience` and `issuer`. `email_verified` is checked with
  `is not True` (the literal boolean, not merely truthy) before any account
  link, failing closed on a malformed claim. The discovery cache
  (`_authentik_discovery`) was already verified bounded-by-construction in
  `SEC-00-cross-cutting-baseline.md`'s Pass 8 (one entry, a new issuer
  replaces the old). Two new routes, `GET /oauth/authentik` and
  `GET /oauth/authentik/callback`, both public by the same design as the
  Google/Microsoft pairs (no auth dependency, `secrets.compare_digest` on
  state, a broad `except Exception` that redirects to a generic
  `server_error` code rather than surfacing internals) and both present in
  `tests/test_endpoint_auth_coverage.py`'s `ALLOWLISTED_PUBLIC`. Route count
  26 → 28; still exactly the entries in that allowlist, machine-checked in
  both directions.
- **`authStore.ts` / `apiClient.ts` — FE3-34-2 and FE3-34-5's fixes** (retried,
  then blocked, sign-out confirmation; owned-and-tagged offline queue items)
  **and AUTH-21's frontend half.** Already reviewed in full under Feature 34
  (`FE3-34-frontend-shared.md`, `FE8-34-frontend-shared.md`); not re-derived
  here, only confirmed present and consistent with this feature's own
  findings above.
- **`authService.ts` — AUTH-7's idempotency keys on `verifyMfaSetup` /
  `regenerateRecoveryCodes`**, and a `getAuthentikOAuthUrl()` helper mirroring
  the existing Google/Microsoft ones. Backend side read directly:
  `mfa_verify_setup` (`auth.py:1341`) and the recovery-codes endpoint both
  call `validate_idempotency_key` / `recall_issued_secret` /
  `remember_issued_secret` (`app/core/issued_secrets.py` — already verified
  bounded-and-capped in `SEC-00-cross-cutting-baseline.md`'s Pass 8), scoped
  by `user_id` (the authenticated caller, not client-supplied) + a fixed
  scope string + the submitted code as the body fingerprint. A retry returns
  the **same already-issued** codes, never mints a new set — not a replay
  risk, since nothing is granted that the first successful call didn't
  already grant, and the scope is unreachable without the victim's own
  session.
- **`schemas/auth.py` — `CurrentUser` gains `preferred_name` / `display_name`.**
  Display fields only, no new PII beyond what `first_name`/`last_name`
  already exposed to the signed-in member themselves. Not a finding.
- **`security.py` — mypy-driven type annotations throughout (no behavior
  change) plus one real fix: `reset_encryption_ciphers()` now also calls
  `app.core.file_encryption.reset_file_keys()`.** Keeps the file-encryption
  KEK cache (`_keks` — already verified bounded-by-construction in
  `SEC-00-cross-cutting-baseline.md`'s Pass 8) in step with the field-
  encryption ciphers it shares a derivation with, so a key rotation does not
  leave stale file keys cached after the rotation script resets everything
  else. A correctness improvement, not a weakening.

### Route inventory — re-enumerated in full

28 routes (up from 26 at pass 7 — the two new Authentik routes, both
reviewed above). Public/private split is now **16 / 12**. Every route's
`@router.` decorator and the `Depends(...)` immediately below it read fresh,
not from memory or the pass-4 table. No route lost its gate; no permission
string loosened.

### Considered and deliberately not raised as a finding

- **`mfa_login`'s failed-attempt increment is reachable without the row
  lock the password-step path takes, for a request supplying neither `code`
  nor `recovery_code`.** Re-confirmed unchanged from pass 7's reasoning: a
  contentless request guesses nothing, so racing it buys an attacker zero
  information. Not raised.

### Completion gate (pass 8)

| Check                                                                                                                                                                                                                                                                  | Result                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `python3 -m flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                                                                                                             | ✅ 0 violations                                                            |
| `python3 -m black --check app/ tests/ alembic/` (26.5.1, CI's pin)                                                                                                                                                                                                     | ✅ 2176 files unchanged                                                    |
| `python3 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                                                                                                                 | ✅ clean                                                                   |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                      | ✅ single head `e1a5bfe7a2ed`, 571 revisions                               |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                                  | ✅ 265 routes, 0 errors/0 warnings                                         |
| scoped backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission or authentik"`)                                                                                                                                              | ✅ 971 passed, 2 skipped (environment-only — `pywebpush`, Docker registry) |
| standing guards run directly (`endpoint_auth_coverage`, `org_scoping_ratchet`, `capacity_locking`, `like_escaping`, `mfa_verification_consumes`, `auth_lockout_race`, `auth_gate_remediation_paths`, `auth_refresh_rotation`, `password_expiry_gate`, `sign_in_audit`) | ✅ 114 passed                                                              |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                     | ✅ 0 errors                                                                |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                          | ✅ 0 errors, 0 warnings                                                    |

No source file was changed by this pass — every check above verifies a tree
this pass read but did not modify, not a regression check against a new fix.
Rotation row 01 moves to `✅`.

### Documentation correction

A plain `git log -- docs/security-review/AUTH-01-auth-session.md` turns up
only one commit touching this path in the repo's visible history (the
grafted/squashed-history problem `CLAUDE.md` and `CI6-33-core-infra.md`
already document), and it is not PR #2924's merge. The real pass-7 baseline
was found instead via `git log --all --grep="pass 7" -- <path>`, which
surfaces the actual squash-merge commit (`9aba1ea0`) by its commit message.
Recorded here so the next pass does not re-derive this from scratch.

---

## Pass 7 (2026-10-05)

**0 fixed, 0 new findings, 0 flagged.** Six files in this feature's scope
changed since pass 6's baseline; all six are other tracks' already-reviewed
work, re-verified here rather than taken on trust, plus a full re-enumeration
of all 26 routes and a re-check of every open item.

**Backend:** the same nine files pass 5/6 scoped —
`app/api/v1/endpoints/auth.py`, `app/services/auth_service.py`,
`app/services/mfa_service.py`, `app/services/oauth_service.py`,
`app/services/consent_service.py`, `app/api/dependencies.py`,
`app/core/security.py`, `app/core/suspicious_ip.py`, `app/schemas/auth.py`
**Frontend:** `stores/authStore.ts`, `services/apiClient.ts`,
`services/authService.ts`
**Migrations:** none written this pass; 511 revisions, single head
`edf608b5a8ea` — none touch this feature's tables

### Scope and method

Baseline: `6da437f21` (merge commit of PR #2593, pass 6's landing point,
confirmed via `gh api repos/thegspiro/the-logbook/pulls/2593
--jq '{merge_commit_sha, merged, title}'` — the shallow clone's commit
messages don't carry the PR-number grep trail passes 4–6 could follow, so the
SHA was fetched from GitHub directly rather than assumed). The clone needed
deepening (`git fetch --deepen=1500`) before that commit, and the baselines
for passes 4 and 5, were reachable at all.

`git diff 6da437f21 HEAD` across all twelve scoped files (nine backend, three
frontend) is non-empty in exactly six: `dependencies.py` (+15/-1), `auth.py`
(+39/-29 across several hunks), `schemas/auth.py` (+3), `auth_service.py`
(+15/-6), `authService.ts` (+5/-1), `authStore.ts` (+104/-61). The other six
(`mfa_service.py`, `oauth_service.py`, `consent_service.py`,
`core/security.py`, `core/suspicious_ip.py`, `apiClient.ts`) are
byte-identical to pass 6 — confirmed by the diff itself returning nothing for
each path, not inferred from an unrelated commit touching the file (an early
`git log -1 -- <path>` check was misleading here: it named a later merge
commit for three of these files that turned out, on inspection, to carry no
actual change to their content — a merge commit can be listed against a path
by history simplification even when the tree is identical to one parent).

Each of the six changed files was read in full rather than trusting the diff
hunks alone, per pass 5's own stated discipline.

### Route inventory — re-enumerated in full, unchanged

All 26 routes individually re-read against their current handler signatures
(not grepped from memory) — every `@router.` decorator in `auth.py` and the
`Depends(...)` on the function immediately below it. The table is identical
to pass 4's, still 14 public / 12 private, still exactly the 14 `auth.py`
entries in `ALLOWLISTED_PUBLIC` (`tests/test_endpoint_auth_coverage.py`). No
route added, removed, or re-gated. See pass 4's table for the full listing;
reproducing it unchanged here would not add information.

### The six changed files, reviewed

- **`dependencies.py` — `get_request_enabled_modules` retyped from `Request`
  to `HTTPConnection`, with an `isinstance` guard returning `None` for a
  WebSocket handshake.** This is module-gating infrastructure
  (`require_module`), not one of this feature's three auth-resolution
  functions (`get_current_user` / `get_current_active_user` /
  `get_optional_current_user`), none of which changed. The docstring is
  explicit that this does not weaken authentication anywhere: an endpoint
  that needs a signed-in user still declares its own
  `Depends(get_current_user)`, unaffected by this dependency's early return.
  Read in full (`dependencies.py:428-498`) rather than taken on the
  docstring's word; the `None` return only ever widens `require_module`'s
  pass-through, which already had to admit sessionless token-authorized
  callers (the public ballot link) for the reason documented at
  `dependencies.py:514-521`. Not a finding.
- **`auth.py` — `get_login_branding` now calls the new
  `branding_service.get_primary_branding()` helper instead of inlining the
  same query.** Read `get_primary_branding`
  (`app/services/branding_service.py:61-79`): identical query
  (`Organization.active.is_(True)`, oldest-first, `limit(1)`), identical
  degrade-to-default on a missing/malformed `appearance` block. A
  deduplication, not a behavior change.
- **`auth.py` — three `Organization.active == True` comparisons became
  `.is_(True)`.** Style/lint correctness (`# noqa: E712` removed because the
  comparison no longer needs it), not a security-relevant change — both
  forms produce the same `WHERE` clause against a boolean column.
- **`auth.py`/`schemas/auth.py` — `CurrentUser` gains `bottom_nav_slots`.**
  Read `normalize_bottom_nav_slots` (`app/schemas/user.py:110-131`): a
  non-list input returns `None`, and every element is checked against a
  compiled regex allowlist (`_BOTTOM_NAV_PATH`) before being kept, with
  malformed JSON degrading to "no customization" rather than raising
  (Pitfall #19's shape). Carries no PII/secret; dimension 5 is clean.
- **`auth.py` — `forgot-password` now echoes `RESET_TOKEN_EXPIRY_MINUTES` in
  both response branches (org found / not found).** The value is a constant,
  identical on every branch regardless of whether the account exists, so
  reporting it adds no enumeration signal — read both return sites
  (`auth.py:1500-1505`, `auth.py:1622-1625`) to confirm the constant, not a
  per-user computation, is what's returned. The message text is unchanged;
  this corrects a frontend copy that had guessed "1 hour" against an actual
  shorter expiry (not reviewed as a frontend defect — a wrong display string
  is not a security finding).
- **`auth_service.py` — `authenticate_user`'s success path no longer clears
  `failed_login_attempts`/`locked_until` when `user.mfa_enabled`.** This is a
  real hardening fix (workflow-review W04, landed before this pass started),
  closing a genuine lockout bypass: previously, a correct password reset the
  counter even though the second factor hadn't been checked yet, so an
  attacker holding a stolen password could guess
  `MAX_LOGIN_ATTEMPTS - 1` TOTP codes, resubmit the password to zero the
  counter, and repeat indefinitely — the account-lockout defense never
  tripped against second-factor guessing. Verified the other half of the
  invariant holds: `mfa_login` only zeroes the same two columns on a
  verified second factor (`auth.py:1000-1001`), after the TOTP/recovery-code
  check, never on the password step alone. Re-ran
  `tests/test_auth_lockout_race.py` — passes.

### Considered and deliberately not raised as a finding

- **`mfa_login`'s failed-attempt increment (`auth.py:965`) is reachable
  without ever taking the row lock the password-step path takes (Pitfall
  #27).** `MFALogin.code` and `MFALogin.recovery_code`
  (`schemas/auth.py:198-206`) are both `Optional` with no
  `model_validator` requiring at least one — a schema-valid request can omit
  both. When either is present and non-empty, `_verify_and_consume_totp` /
  `_verify_and_consume_recovery_code` runs first and takes
  `.with_for_update()` on the same user row before the handler's own
  `user.failed_login_attempts += 1` at line 965 executes; because
  `populate_existing=True` refreshes the same identity-mapped object (the
  mechanism pass 5 verified for the consuming helpers applies equally here —
  `locked_user is user`), the increment that follows is reading and writing
  the just-locked, just-refreshed value, not a stale one. The gap is real
  only for a request carrying **neither** field: that skips both consuming
  helpers entirely and reaches the increment with no lock ever taken. But a
  request with no code and no recovery code verifies nothing and guesses
  nothing — racing it buys an attacker zero information, since the "guess"
  that goes unlocked is not a guess at all. Same reasoning pass 5 already
  applied to `mfa_setup`'s unlocked secret write: a race with no
  attacker-observable secret or guess behind it is not a security
  improvement to close. Not raised as a new finding.

### Re-verified: both open items, unchanged

- **AUTH-15** (HIPAA max password age enforced only in the browser) — still
  🚩 FLAGGED, re-checked at current lines: `auth_service.py:295-298` still
  only logs; `auth.py:180-189` (`password_expired` computed) and `auth.py:1422`
  (reported via `/session-settings`) still only report it.
  `dependencies.py:119-239`'s `get_current_user` still has no gate on
  `password_expired` — only on `must_change_password` and org `mfa_required`.
  Still needs the rollout decision recorded in pass 4. Still accurate in
  `docs/KNOWN_LIMITATIONS.md`.
- **AUTH-17** (no session reaper) — still 🚩 FLAGGED. `delete(UserSession)`
  (`grep -rn "delete(UserSession)" app/`) is still reached only from
  `auth_service._revoke_all_user_sessions:484`; `scheduled_tasks.py` still
  has no session job among its registered tasks. Still needs the
  retention-window decision. Still accurate in `docs/KNOWN_LIMITATIONS.md`.
- **AUTH-21** (app-review track, double-fired refresh can revoke every
  session) — re-confirmed unchanged at `auth_service.py:392`
  (`select(UserSession).where(UserSession.refresh_token == refresh_token)`,
  still a plain `SELECT`, no `.with_for_update()`). Not this track's finding
  to fix; still flagged in `docs/app-review/auth-session.md` and
  `docs/KNOWN_LIMITATIONS.md`, both unchanged.

### Documentation correction

This file's own header never recorded pass 6's actual PR number — it said
"pass 6 (this PR)" and was never updated after #2593 merged. Corrected above
to `#2593`, fetched via the GitHub REST API rather than guessed.

### Completion gate (pass 7)

| Check                                                                                                                                                                                                | Result                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `python3 -m flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                                                                                                                           | ✅ 0 violations                                                                     |
| `python3 -m black --check app/ tests/ alembic/` (26.5.1, CI's pin)                                                                                                                                   | ✅ 1862 files unchanged                                                             |
| `python3 -m isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                                                                                               | ✅ clean                                                                            |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                    | ✅ single head `edf608b5a8ea`, 511 revisions                                        |
| scoped backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission"`)                                                                                         | ✅ 777 passed, 2 skipped (both pre-existing: optional `pywebpush`, Docker registry) |
| standing guards (`endpoint_auth_coverage`, `org_scoping_ratchet`, `capacity_locking`, `like_escaping`, `mfa_verification_consumes`, `auth_lockout_race`, `auth_gate_remediation_paths`) run directly | ✅ 67 passed                                                                        |
| backend full unit suite (`pytest tests/ -m "not integration and not slow and not docker"`)                                                                                                           | ✅ 12534 passed, 1 pre-existing skip, 0 failed                                      |
| `cd frontend && npm run typecheck`                                                                                                                                                                   | ✅ 0 errors (aliased 7.0.2 compiler)                                                |
| `cd frontend && npm run lint`                                                                                                                                                                        | ✅ 0 errors, 0 warnings                                                             |

No source file was changed by this pass — every check above verifies a tree
this pass read but did not modify, not a regression check against a new fix.
Rotation row 01 moves to `✅`.

---

## Pass 6 (2026-09-15)

**0 fixed, 0 new findings.** Zero-delta re-verification: every file this
feature scopes is **byte-identical** to pass 5's reviewed state.

**Backend:** the same nine files pass 5 scoped —
`app/api/v1/endpoints/auth.py`, `app/services/auth_service.py`,
`app/services/mfa_service.py`, `app/services/oauth_service.py`,
`app/services/consent_service.py`, `app/api/dependencies.py`,
`app/core/security.py`, `app/core/suspicious_ip.py`, `app/schemas/auth.py`
**Frontend:** `stores/authStore.ts`, `services/apiClient.ts`,
`services/authService.ts`
**Migrations:** none written this pass; 444 revisions, single head
`6ab7d903fae5` — unchanged from pass 5

### Scope and method

Baseline: `9170a20c2` (merge commit of PR #2536, pass 5's landing point,
confirmed via `git log --oneline --grep="#2536"`). `git diff 9170a20c2
origin/main` across all twelve files above (nine backend, three frontend)
returns **zero lines** — not "no functional change", literally no diff — and
`git rev-parse 9170a20c2:<path> origin/main:<path>` gives the identical blob
hash for `auth.py` specifically (`f33bedbae69...`), confirmed rather than
inferred from an empty `git diff` alone. `git log --oneline
9170a20c2..origin/main -- app/models/user.py app/core/config.py
app/services/scheduled_tasks.py` (the three files a fix for AUTH-15 or
AUTH-17 would have to touch) also returns nothing, so neither standing flag's
premise has moved either. No commit touching this feature's scope landed
between pass 5's merge and this pass's start.

Despite the zero diff, this pass re-read every file rather than trusting the
diff alone (pass 5's own stated discipline, "still read in full ... nothing
had reason to change, and nothing did") and specifically re-grepped the six
fixed/flagged findings at their current line numbers rather than assuming a
prior grep still matches:

| Finding                          | Re-checked at                                          | Result                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-1 (OAuth org-active check)  | `oauth_service.py:57`                                  | `.where(Organization.active.is_(True))` present, unchanged                                                                                                      |
| AUTH-14 (password-change gate)   | `dependencies.py:84,110` (+ coupling comment at `:94`) | `/auth/change-password` still on both suffix tuples                                                                                                             |
| AUTH-16 (non-consuming verifier) | `mfa_service.py:32-35`                                 | `verify_totp` docstring still says "Not for use by application code"                                                                                            |
| AUTH-19 (refresh_token index)    | `models/user.py:856`                                   | `Column(String(512), index=True)` still present                                                                                                                 |
| AUTH-20 (lockout row lock)       | `auth_service.py:238-258`                              | `.with_for_update()` re-fetch still precedes the failure-branch increment                                                                                       |
| AUTH-21 (refresh rotation, open) | `auth_service.py:383`                                  | still a plain `select(UserSession).where(UserSession.refresh_token == ...)`, no lock — confirms the flag's premise is unchanged, not merely unfixed by omission |

Route inventory unchanged: `grep -c '^@router\.' auth.py` → 26; the
`ALLOWLISTED_PUBLIC` entries for `auth.py` in
`tests/test_endpoint_auth_coverage.py` → still 14, still matching the public
routes tabled in pass 4. No route added, removed, or re-gated.

### Open items re-confirmed, unchanged

- **AUTH-15** (HIPAA max password age enforced only in the browser) — still
  🚩 FLAGGED. `auth_service.py:286` still only logs;
  `auth.py:178-187,1418` still only report `password_expired` /
  the day count. No gate added to `get_current_user`. Still needs the owner
  decision on rollout recorded in pass 4. Still in `KNOWN_LIMITATIONS.md`.
- **AUTH-17** (no session reaper) — still 🚩 FLAGGED. `delete(UserSession)`
  is still reached only from `_revoke_all_user_sessions` (`auth_service.py:475`);
  `scheduled_tasks.py` still has no session job. Still needs the
  retention-window decision. Still in `KNOWN_LIMITATIONS.md`.
- **AUTH-21** (app-review track, double-fired refresh can revoke every
  session) — still 🚩 FLAGGED in `docs/app-review/auth-session.md` and
  `KNOWN_LIMITATIONS.md`; `docs/app-review/auth-session.md` has no pass after
  its own pass 5, so nothing to re-verify there beyond confirming the code
  line above still matches what it describes.

No new finding was raised. Nothing considered-and-rejected from prior passes
needed re-litigating — the "Considered and deliberately not raised" sections
under passes 4 and 5 describe code paths that did not change either.

### Completion gate (pass 6)

| Check                                                                                                                                                                                                | Result                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `python3 -m flake8 app/ tests/ alembic/`                                                                                                                                                             | ✅ 0 violations                                |
| `black --check app/ tests/ alembic/` (26.5.1)                                                                                                                                                        | ✅ 1596 files unchanged                        |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                                                                                                                                                    | ✅ clean                                       |
| `validate_migrations.py --strict`                                                                                                                                                                    | ✅ single head `6ab7d903fae5`, 444 revisions   |
| scoped backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission"`)                                                                                         | ✅ 684 passed, 2 skipped (both pre-existing)   |
| standing guards (`endpoint_auth_coverage`, `org_scoping_ratchet`, `capacity_locking`, `like_escaping`, `mfa_verification_consumes`, `auth_lockout_race`, `auth_gate_remediation_paths`) run directly | ✅ 67 passed                                   |
| backend full unit suite (`pytest tests/ -m "not integration and not slow and not docker"`)                                                                                                           | ✅ 10199 passed, 1 pre-existing skip, 0 failed |
| `cd frontend && npm run typecheck`                                                                                                                                                                   | ✅ 0 errors (aliased 7.0.2 compiler)           |
| `cd frontend && npm run lint`                                                                                                                                                                        | ✅ 0 errors, 0 warnings                        |

No source file changed this pass — every check above is a re-verification of
a byte-identical tree, not a regression check against a fix. Rotation row 01
moves to `✅`.

---

## Pass 5 (2026-09-14)

**0 new findings.** This is the first pass of the rotation's second full lap
(00 through 34) to reach this feature — Feature 00 (Cross-cutting baseline)
ran its own pass 5 immediately before this one and also found 0 new findings.

**Backend:** the same four files pass 4 scoped (`app/api/v1/endpoints/auth.py`,
`app/services/auth_service.py`, `app/services/mfa_service.py`,
`app/services/oauth_service.py`), plus `app/services/consent_service.py`,
`app/api/dependencies.py` (`get_current_user` / `get_current_active_user` /
`get_optional_current_user`), `app/core/security.py` (JWT issue/decode block),
`app/core/suspicious_ip.py`, and `app/schemas/auth.py`
**Frontend:** `stores/authStore.ts`, `services/apiClient.ts`,
`services/authService.ts` — diffed against pass 4's baseline, not modified
**Migrations:** none written this pass; 444 revisions, single head `6ab7d903fae5`

### Scope and method

Unlike pass 4 (which could not diff because of a history squash), this pass
could diff cleanly: PR #2389 merged at `a68d674dd9` is a real, reachable
ancestor of current `main`, so the delta is exact rather than reasoned from a
re-read. `git diff a68d674dd origin/main` across every file in this feature's
scope shows changes in exactly two files:

| File              | Diff    | Source                                                                                                                                |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.py`         | +27/-10 | `feat(onboarding): make the navigation layout a department setting` (`f14370f4a`) — `GET /branding` gains a `navigation_layout` field |
| `auth_service.py` | +45/-4  | `docs(app-review): auth & session lifecycle pass 5 — 1 fix, 1 flagged` (`b61120c73`) — app-review's AUTH-20 lockout-race fix          |

`mfa_service.py`, `oauth_service.py`, `consent_service.py`,
`app/api/dependencies.py`, `app/core/suspicious_ip.py`, `app/core/security.py`,
`app/schemas/auth.py`, and all three frontend files are **byte-identical** to
pass 4's reviewed state (`git diff` against `a68d674dd` is empty for every one
of them). Each was still read in full this pass rather than assumed clean —
Pitfall #10's "when you encounter pre-existing violations, fix them" spirit
applies equally to "when you encounter a file you've already reviewed, still
read it" for a feature this sensitive — but nothing in any of them had reason
to change, and nothing did.

Both changes to the two diffed files were made by other tracks (a feature PR
and this rotation's own app-review track, respectively) before this pass
started, not by this pass. Both are reviewed here under the full seven-
dimension checklist anyway, since neither track's own review is a substitute
for this rotation's — pass 3's own history (AUTH-7) is the standing argument
for why a security-adjacent change should get an independent second look
rather than being taken on the strength of who last touched it.

### Route inventory — unchanged

Still 26 routes (`grep -c '^@router\.'` in `auth.py`), still 14 public / 12
private, still exactly `ALLOWLISTED_PUBLIC`'s 14 `auth.py` entries. No route
was added, removed, or had its auth dependency changed. `navigation_layout`
is a new **field** on an already-public, already-unauthenticated route
(`GET /branding`), not a new route — checklist dimension 1 has nothing new to
enumerate.

### The two changes since pass 4, reviewed

**`GET /branding` gains `navigation_layout` (dimension 5 — data exposure):**
reads `Organization.settings["appearance"]["navigation_layout"]`, validates it
against the literal allowlist `("top", "left")`, and falls back to the schema
default (`AppearanceSettings().navigation_layout`, currently `"left"`) on a
missing, malformed, or absent value — the same fail-safe shape the route's
existing `name`/`logo` fields already used, extended to a third field rather
than a new pattern. Nothing sensitive is exposed: whether a department's
navigation is a sidebar or a top bar is visible to anyone who opens the login
page after authenticating, and carries no PII, no secret, and no cross-tenant
information (still the single oldest-active-org lookup every other pre-auth
route on this file already uses). No new route, so dimension 1 is n/a; no
by-id lookup, so dimension 3 is n/a.

**`authenticate_user`'s failed-password branch now locks the row (app-review
AUTH-20, re-verified here):** the increment of `failed_login_attempts` — read
off the `candidates` query's unlocked object at line 128 — now goes through a
`.with_for_update().execution_options(populate_existing=True)` re-fetch first,
structurally identical to `_verify_and_consume_totp` (AUTH-9) and
`_verify_and_consume_recovery_code` (AUTH-13). Re-verified rather than taken
on trust: read the fix in full (`auth_service.py:217-273`), confirmed the lock
sits _inside_ the failure branch and never around the Argon2 `verify_password`
call above it (holding the row for the ~100-300ms of a hash would serialize
that account's logins into a cheaper DoS than the counter defends against —
`test_the_lock_is_not_taken_around_the_password_verify` pins this), confirmed
the `locked_user is None` branch (row deleted between the candidate read and
the lock) rolls back and returns the same generic message rather than raising,
and ran `test_auth_lockout_race.py` directly — passes, and its own two-real-
session harness is the same shape `test_two_real_sessions_racing_the_same_code`
(AUTH-9) already established, not a new harness invented for this fix. No
gap found in the fix; nothing to add.

### Re-verified: all 19 prior findings' fixes still hold

Checked each at current line numbers, not merely "still present" by grep:

- **AUTH-1** (OAuth org-active check) — `oauth_service.py:57` still filters
  `Organization.active.is_(True)`; empty result still returns
  `(None, "no_account")`. `test_resolve_user_no_active_organization` passes.
- **AUTH-7/9/13** (TOTP/recovery-code verify-and-consume, row-locked) —
  `_verify_and_consume_totp` (`auth.py:802`) and
  `_verify_and_consume_recovery_code` (`auth.py:854`) both still re-fetch with
  `.with_for_update().execution_options(populate_existing=True)` before
  checking/mutating. All four call sites (`mfa_login`, `mfa_verify_setup`,
  `mfa_disable`, `mfa_regenerate_recovery_codes`) still route through them.
- **AUTH-8/10** (brute-force detector wiring) — `login`'s
  `detect_brute_force(success=True)` call is still positioned after the
  `if user.mfa_enabled:` branch (`auth.py:748-761`); `mfa_login` still calls
  it on both its failure (`:976`) and success (`:1003`) paths.
- **AUTH-11** (alert-write savepoint isolation) — not re-read line-by-line
  this pass (`security_monitoring.py` is outside this feature's four-file
  scope and had zero diff against pass 4), re-confirmed only via the standing
  guard test: `TestAddAlertSavepointIsolation` in
  `tests/test_security_monitoring.py` passes.
- **AUTH-12** (`mfa_last_timestep` cleared on secret change) — both
  `mfa_setup` (`auth.py:1056`) and `mfa_disable` (`auth.py:1141`) still clear
  it.
- **AUTH-14** (password-change/MFA-enrollment gate deadlock) — `dependencies.py:83-115`'s
  two suffix tuples still both carry `/auth/change-password`, with the
  comment explaining the coupling still in place.
  `tests/test_auth_gate_remediation_paths.py` passes.
- **AUTH-16** (`verify_totp` has zero callers; consuming helpers have exactly
  one each) — `tests/test_mfa_verification_consumes.py` passes.
- **AUTH-19** (`sessions.refresh_token` indexed) — `models/user.py:856` is
  still `Column(String(512), index=True)`.
- **AUTH-2/5/6/18** (doc-only corrections) — nothing to re-verify against
  code; re-read to confirm they still match, and they do.

**AUTH-15 and AUTH-17 remain open, unchanged, re-confirmed still accurate:**

- **AUTH-15** — `HIPAA_MAXIMUM_PASSWORD_AGE_DAYS` still has the same three
  readers and none of them refuses a request (`auth_service.py:286-298` logs
  and proceeds; `auth.py:178-187` and `auth.py:1418` both still only report
  the flag/number). Still needs an owner decision on rollout before the gate
  can go in `get_current_user`, for the reason recorded at the time (locks
  out every member whose password predates enforcement, on an installation
  that has never enforced this, on the day it deploys). Still in
  `KNOWN_LIMITATIONS.md`.
- **AUTH-17** — still no session reaper; `delete(UserSession)` is still only
  reached from `_revoke_all_user_sessions`, and `scheduled_tasks.py` still has
  no counterpart job. Still needs a retention-window product decision. Still
  in `KNOWN_LIMITATIONS.md`.

**Cross-track note, not a re-verification of this file's own findings:** the
app-review track's AUTH-20 (fixed, see above) and AUTH-21 (a double-fired
`/refresh` can revoke every session a member has — still flagged, unfixed,
in `docs/app-review/auth-session.md` and mirrored in `KNOWN_LIMITATIONS.md`)
share the `AUTH-` prefix with this file's own findings by number collision,
documented at the top of that file's own pass 5 section. Recorded here only
so a reader of _this_ file's numbering does not mistake AUTH-20/21 for
entries this track allocated — this pass did not re-derive or re-fix either.

### Considered and deliberately not raised as findings

- **`reset_password_with_token` has the same unlocked-read-then-write shape
  AUTH-9/13/(app-review AUTH-20) fixed, on the reset-token row.** Two
  concurrent submissions of the same valid reset token could both pass the
  expiry check and both write a password, last-commit-wins, before the token
  is cleared. Structurally similar, but not the same risk: TOTP/recovery-code
  replay let an _attacker_ who merely observed a code in transit open an
  independent session without ever possessing the credential itself. Racing a
  reset token requires already holding that 48-byte token — which alone is
  already enough to fully take over the account through a single, sequential
  use of the same endpoint. The race changes nothing about what an attacker
  who has the token can do; at most it is a same-user double-submit (a retried
  click) landing on two different typed passwords, which is the same
  exactly-once-delivery shape already flagged and left unfixed for
  `/mfa/recovery-codes` (pass 3, "Also raised (Codex)") for the same reason:
  fixing one instance of a generic problem shared by every secret-shown-once
  or token-consumed-once response in this file is not a meaningful security
  improvement in isolation. Not raised as a new numbered finding.
- **`mfa_setup` writes `current_user.mfa_secret` without a row lock.** Same
  shape, same reasoning: two concurrent `/mfa/setup` calls by the legitimate
  user's own already-authenticated session race only against themselves —
  there is no attacker-observable secret to replay, since the secret is
  freshly generated server-side and not yet confirmed by
  `/mfa/verify-setup`. Worst case is the same non-security "second call wins"
  UX race already accepted elsewhere in this file.
- **Re-checked whether the identity-map assumption `_verify_and_consume_totp`
  and `_verify_and_consume_recovery_code` depend on is real, not assumed.**
  Both helpers take `user: User` (already loaded, unlocked) and return a
  fresh `locked_user` from a `.with_for_update()` re-query — but the calling
  routes (`mfa_disable`, `mfa_verify_setup`, `mfa_regenerate_recovery_codes`)
  go on to mutate `current_user` directly afterward (e.g.
  `current_user.mfa_enabled = False`), not the helper's returned
  `locked_user`. This only stays correct because SQLAlchemy's identity map
  returns the _same Python object_ for a second query against a primary key
  already loaded in the session, and `populate_existing=True` refreshes that
  same object in place rather than returning a detached copy — so
  `locked_user is current_user` and the later mutations land on the still-
  locked row inside the same transaction. Confirmed by reading
  `AsyncSession`'s identity-map behavior against the actual query shape used
  (`select(User).where(User.id == user.id)` — same PK, same session) rather
  than assumed; the existing guard tests (`TestVerifyAndConsumeTotpConcurrency`,
  `TestVerifyAndConsumeRecoveryCodeConcurrency`) exercise this same reliance
  and pass. Not a finding — recorded so a future pass does not have to
  re-derive why this is safe when it looks, at a glance, like the caller is
  mutating an object the lock was never taken on.

### Completion gate (pass 5)

| Check                                                                                                                  | Result                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                          | ✅ 0 violations                                                                     |
| `python3 -m black --check app/ tests/ alembic/` (26.5.1, CI's pin)                                                     | ✅ 1592 files unchanged                                                             |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                            | ✅ clean                                                                            |
| `validate_migrations.py --strict`                                                                                      | ✅ single head `6ab7d903fae5`, 444 revisions                                        |
| scoped backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission"`)           | ✅ 674 passed, 2 skipped (both pre-existing: optional `pywebpush`, Docker registry) |
| backend full unit suite (`pytest tests/ -m "not integration and not slow and not docker"`)                             | ✅ **10158 passed, 1 skipped**                                                      |
| standing guards (`endpoint_auth_coverage`, `org_scoping_ratchet`, `capacity_locking`, `like_escaping`)                 | ✅ 47 passed                                                                        |
| `test_mfa_verification_consumes.py`, `test_auth_lockout_race.py`, `test_auth_gate_remediation_paths.py` (run directly) | ✅ 11 passed                                                                        |
| `tsc --noEmit` / `npm run lint`                                                                                        | n/a — no frontend source changed this pass                                          |

No source files were changed this pass — every check above is a
re-verification, not a regression check against a fix, so there is no
behavior-neutrality diff to run. Rotation row 01 stays `✅` per this file's
own convention.

---

## Pass 4 (2026-09-08)

**Backend:** `app/api/v1/endpoints/auth.py` (1673 L, **26 routes** — 14 public
/ 12 private, enumerated below), `app/services/auth_service.py` (978 L),
`app/services/mfa_service.py` (121 L), `app/services/oauth_service.py`
(340 L), `app/services/consent_service.py` (211 L), plus the parts of
`app/api/dependencies.py` (`get_current_user` and the two account-state
gates), `app/core/security.py` (JWT issue/decode, §"JWT Token Management")
and `app/core/suspicious_ip.py` (236 L) this surface depends on
**Frontend:** `stores/authStore.ts`, `services/apiClient.ts`,
`services/authService.ts` — read, not modified
**Migrations:** one written this pass (AUTH-19: index `sessions.refresh_token`);
438 revisions, single head `1603bd9c59e7`

### Scope

Read in full, not skimmed: all four principal backend files, `suspicious_ip.py`,
`dependencies.py`'s `get_current_user` / `get_current_active_user` /
`get_optional_current_user`, `core/security.py`'s token block, and
`schemas/auth.py`. `consent_service.py` was diffed against pass 2's reviewed
state (211 L, byte-identical) rather than re-read line by line — pass 2's
seven-dimension review of it stands.

**`git log` carries no usable history for these files.** The repository's
history is squashed at `2aa66b8e` (2026-09-05), which is the root commit for
every path in this feature, so "what changed since pass 3" could not be
derived from the diff the way pass 2 and pass 3 derived it. This pass
therefore re-read the code rather than reading a diff, and states so instead
of reporting a diff-scoped verdict it could not compute. The observable
delta since pass 3 is `auth.py` 1543 L → 1673 L, route count unchanged at 26.

**Not read:** `users.py`'s admin password-reset / admin-MFA-reset handlers,
beyond the two specific checks recorded under AUTH-18 — those are feature 07.

### Route inventory

26 routes. The public/private split is **14 / 12**, not the 11 / 15 passes 1–3
recorded (see AUTH-18). The 14 public ones are exactly the 14 `auth.py`
entries in `ALLOWLISTED_PUBLIC` in `tests/test_endpoint_auth_coverage.py`, so
this table is machine-checked in both directions rather than transcribed.

| Method | Path                        | Auth dependency               | Permission                                          | Org-scoped | Notes                                                        |
| ------ | --------------------------- | ----------------------------- | --------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| GET    | `/branding`                 | none                          | n/a                                                 | n/a        | public; name + logo of the oldest active org only            |
| GET    | `/captcha-config`           | none                          | n/a                                                 | n/a        | public; site key only, never the secret                      |
| GET    | `/oauth-config`             | none                          | n/a                                                 | n/a        | public; provider-enabled booleans only                       |
| GET    | `/oauth/google`             | none                          | n/a                                                 | n/a        | public; 404 when unconfigured; sets state cookie             |
| GET    | `/oauth/google/callback`    | none                          | n/a                                                 | n/a        | public; `compare_digest` on state vs httpOnly cookie         |
| GET    | `/oauth/microsoft`          | none                          | n/a                                                 | n/a        | public; 404 when unconfigured                                |
| GET    | `/oauth/microsoft/callback` | none                          | n/a                                                 | n/a        | public; `compare_digest` on state; `tid` pinned              |
| POST   | `/register`                 | none                          | n/a                                                 | n/a        | `rate_limit_register()`; 403 unless `REGISTRATION_ENABLED`   |
| POST   | `/login`                    | none                          | n/a                                                 | n/a        | `rate_limit_login()` + `enforce_suspicious_ip`               |
| POST   | `/mfa/login`                | none (pre-auth `mfa_pending`) | n/a                                                 | n/a        | `rate_limit_login()` + `enforce_suspicious_ip`; token-scoped |
| POST   | `/refresh`                  | none (refresh cookie/body)    | n/a                                                 | n/a        | `rate_limit_token_refresh()`; org-active check in service    |
| POST   | `/forgot-password`          | none                          | n/a                                                 | n/a        | `rate_limit_password_reset()` + `require_captcha`            |
| POST   | `/reset-password`           | none                          | n/a                                                 | n/a        | `rate_limit_password_reset()`; SHA-256 token lookup          |
| POST   | `/validate-reset-token`     | none                          | n/a                                                 | n/a        | `rate_limit_password_reset()`; returns `{"valid": true}`     |
| POST   | `/mfa/setup`                | `get_current_active_user`     | self                                                | self       | clears `mfa_last_timestep` with the new secret               |
| POST   | `/mfa/verify-setup`         | `get_current_active_user`     | self                                                | self       | `rate_limit_login()`; consumes the code                      |
| POST   | `/mfa/disable`              | `get_current_active_user`     | self                                                | self       | `rate_limit_login()`; consumes the code                      |
| GET    | `/mfa/status`               | `get_current_active_user`     | self                                                | self       | —                                                            |
| POST   | `/mfa/recovery-codes`       | `get_current_active_user`     | self                                                | self       | `rate_limit_login()`; consumes the code                      |
| GET    | `/mfa/policy`               | `require_permission`          | `settings.manage` OR `organization.update_settings` | org        | reads own org's settings only                                |
| PUT    | `/mfa/policy`               | `require_permission`          | `settings.manage` OR `organization.update_settings` | org        | `copy.deepcopy` before the nested write (Pitfall #12)        |
| POST   | `/logout`                   | `get_current_user`            | self                                                | self       | deletes the session row (access + refresh in one row)        |
| GET    | `/me`                       | `get_current_active_user`     | self                                                | self       | —                                                            |
| GET    | `/session-settings`         | `get_current_user`            | self                                                | self       | timeout + password-age policy, no secrets                    |
| POST   | `/change-password`          | `get_current_active_user`     | self                                                | self       | `rate_limit_password_change()`; revokes all sessions         |
| GET    | `/check`                    | `get_current_user`            | self                                                | self       | cheap probe; no frontend caller today (AUTH-18)              |

Both `/mfa/policy` routes resolve the organization from
`current_user.organization_id`, never from a client-supplied id, so neither is
an XC-3 candidate. Neither OR-gate is broadly seeded: `settings.manage` and
`organization.update_settings` are administrator grants, not baseline member
ones (checklist dimension 2 / Pitfall #23).

### Verified good ✅

Claims with the mechanism named, so pass 5 can re-check cheaply rather than
re-derive:

- **Every one of the 26 routes' gates is as tabled, and the 14 unauthenticated
  ones are on a reviewed allowlist that fails in both directions.** Mechanism:
  `tests/test_endpoint_auth_coverage.py` — it re-derives the unauthenticated
  set from the AST and fails on an unlisted handler _and_ on a stale listing.
  Re-run this pass: passes.
- **Every TOTP and recovery-code check in `app/` now goes through a helper
  that consumes the credential under a row lock.** Mechanism:
  `tests/test_mfa_verification_consumes.py`, new this pass — see AUTH-16.
  Before it, AUTH-7/AUTH-9/AUTH-13 were held only by review discipline.
- **A `must_change_password` member in an MFA-required org has a reachable
  way out.** Mechanism: `tests/test_auth_gate_remediation_paths.py`, new this
  pass, which drives the real `get_current_user` rather than asserting list
  membership — see AUTH-14.
- **No injection surface anywhere in this feature.** Mechanism: grep across
  all five files for `.like(` / `.ilike(` / `text(` / f-string `execute` /
  `csv.writer` returns zero hits, so Pitfalls #15 and #25 are n/a here, and
  `tests/test_like_escaping.py` still passes app-wide.
- **Tokens never leave the server in a JSON body.** Mechanism: `_set_auth_cookies`
  is the single choke point (login, MFA login, register, OAuth, refresh all
  call it), and every one of those handlers builds a body of
  `{token_type, expires_in}` (+ the `user` dict) with no token field.
- **`/auth/` is excluded from the frontend response cache.** Mechanism:
  `UNCACHEABLE_PREFIXES[0]` in `frontend/src/utils/apiCache.ts` is `'/auth/'`,
  matched by `startsWith`, so every sub-path is covered without a per-route
  entry; pinned by `tests/test_api_cache_pii_exclusions.py` since SEC4-3.
- **Refresh rotation still fails closed with no grace window.** Mechanism:
  `auth_service.refresh_access_token` — a refresh token with no matching
  session row calls `_revoke_all_user_sessions` and then **commits**, so the
  revocation survives the 401 the caller turns it into;
  `previous_refresh_token` / `previous_refresh_expires_at` are cleared on
  every rotation and read by nothing.
- **AUTH-1's OAuth org-active fix is still in place.** Mechanism:
  `oauth_service._link_existing_user` still filters
  `Organization.active.is_(True)` and returns `(None, "no_account")` on an
  empty lookup; `test_resolve_user_no_active_organization` still passes.
- **The three MFA management routes still consume the code they verify
  (AUTH-7), and the two consuming helpers still hold `.with_for_update()`
  plus `populate_existing=True` (AUTH-9, AUTH-13).** Mechanism: read at
  `auth.py:787-876`, and now additionally pinned by the new guard above.
- **`mfa_login` cannot be reached by a soft-deleted account.** Mechanism:
  `User.is_active` is a hybrid property whose expression is
  `status == ACTIVE AND deleted_at IS NULL` (`models/user.py:526-534`), so
  `mfa_login`'s `not user.is_active` check covers deletion even though the
  query itself omits a `deleted_at` filter. Worth recording because the query
  reads as if it were missing one.
- **An admin MFA reset cannot strand a stale replay baseline.** Mechanism:
  `users.py`'s `admin_reset_mfa` nulls `mfa_secret` without touching
  `mfa_last_timestep`, but the only route that can install a replacement
  secret — `mfa_setup` — clears the timestep itself (AUTH-12's fix), so the
  stale value is gone before any code is checked against the new secret. See
  AUTH-18 for the correction to AUTH-12's own write-up that this check found.

**Considered and deliberately not raised as findings**, recorded so pass 5
does not re-derive them:

- **`mfa_login` does not re-check that the organization is still active.** The
  `mfa_pending` token lives 5 minutes and is only issued after
  `authenticate_user` (or `_link_existing_user`) already enforced
  `Organization.active`. Five minutes is strictly shorter than the
  access-token window an already-signed-in member of the same org keeps, so
  closing it would not change when a deactivated org actually loses access.
- **The `mfa_pending` token is replayable within its own 5 minutes.** It
  authorizes only _attempting_ the second factor, and the second factor
  itself is single-use and lockout-counted, so a second `mfa_pending` costs
  an attacker nothing they could not get by calling `/login` again.
- **`ConsentService.roster()` is still unpaginated** — unchanged since pass 2,
  and AUTH-4's reasoning (255+ identically-shaped call sites app-wide; a
  `LIMIT` on this one is arbitrary, not a security improvement) still holds.
- **`enforce_suspicious_ip` guards only `/login` and `/mfa/login`.** The other
  credential-bearing public routes carry their own rate limiters and present
  no guessable secret: reset tokens are 48 random bytes, and `/refresh`
  requires a signed JWT that also matches a stored session row.

### Findings

#### AUTH-14 — MED — `must_change_password` + an MFA-required org is a permanent lockout with no remediation route — ✅ FIXED

**What:** `get_current_user` runs two account-state refusals in sequence
against the same request, each with its own allowlist of path suffixes:

| Gate                             | Allowlist                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `must_change_password`           | `/auth/change-password`, `/auth/logout`, `/auth/me`, `/auth/refresh`, `/auth/session-settings`                                         |
| org `mfa_required` + un-enrolled | `/auth/mfa/setup`, `/auth/mfa/verify-setup`, `/auth/mfa/status`, `/auth/me`, `/auth/logout`, `/auth/refresh`, `/auth/session-settings` |

A member in **both** states can only reach the intersection — and the
intersection was `{me, logout, refresh, session-settings}`, which contains no
remediation route at all. Gate 1 refuses every `/auth/mfa/*` enrollment path;
gate 2 refuses the one path gate 1 allows.

**Where:** `backend/app/api/dependencies.py:81-101` (the two tuples, pre-fix)
and `:193-219` (the two gates that consume them).

**Failure scenario:** an administrator turns on the org-wide MFA requirement
(`PUT /auth/mfa/policy`). Every member currently flagged
`must_change_password` is now permanently locked out of the application: they
can sign in, refresh, and read `/auth/me`, and nothing else, forever. That is
not a narrow set — `users.py:355` (admin creates a member),
`onboarding.py:1092` (bulk member import) and
`membership_pipeline_service.py:2661` (prospect converted to member) all set
`must_change_password=True`, so it is every account an administrator has
created and every account that has ever been issued a temporary password. The
member's own recovery paths are both closed, and so is the administrator's:
`admin_reset_password` sets the flag again, and `admin_reset_mfa` only clears
enrollment the member never had. The only escape is turning the org MFA policy
back off.

Reproduced by driving the real dependency across the four relevant state
combinations, not reasoned from the lists:

```
must_change_password=True, mfa_enabled=False, org mfa_required=True
  /api/v1/auth/change-password  -> 403 MFA enrollment required before continuing.
  /api/v1/auth/mfa/setup        -> 403 Password change required before continuing.
  /api/v1/auth/mfa/verify-setup -> 403 Password change required before continuing.
  /api/v1/auth/me               -> ALLOWED
```

**Impact:** availability, self-inflicted, no attacker required — but total for
the affected members, and the trigger (switching on an advertised security
policy) is exactly the action a department is encouraged to take. Not a
confidentiality or integrity defect: nothing is exposed and nothing is
writable that was not before.

**Fix:** added `/auth/change-password` to `_MFA_ENROLL_ALLOWED_SUFFIXES`, so
the intersection now contains the one route that clears state 1; the member
changes their password, the flag drops, and the `/auth/mfa/*` routes gate 2
already allows become reachable. Password-first is also the correct ordering
rather than merely the smaller change: binding an authenticator to an account
still holding the temporary password an administrator chose is worse than the
reverse. A comment on the tuple records why the entry appears on both lists,
so the next person to prune it sees the coupling.

**Guard test:** `tests/test_auth_gate_remediation_paths.py` — three tests
driving the real `get_current_user` (a mocked `get_user_from_token` plus a
stand-in for the single org-settings query the MFA gate issues), because
asserting membership in the two tuples would pass trivially and prove nothing
about their interaction. `test_password_change_is_reachable_when_both_gates_apply`
confirmed to fail against the pre-fix code with the exact 403 above;
`test_enrollment_is_reachable_once_the_password_is_changed` proves the
sequence terminates; and `test_ordinary_routes_stay_closed_while_either_gate_applies`
is the counterweight that keeps a future "just allow a bit more" from becoming
a bypass.

#### AUTH-15 — MED — The HIPAA maximum-password-age control is enforced only in the browser — ✅ FIXED (2026-10-04)

**What:** `HIPAA_MAXIMUM_PASSWORD_AGE_DAYS` (`core/config.py:176`, default
**90**) has exactly three readers, and none of them refuses a request:

| Reader                                   | What it does                                                 |
| ---------------------------------------- | ------------------------------------------------------------ |
| `auth_service.authenticate_user:249-261` | `logger.warning(...)` and returns the user anyway            |
| `auth._build_current_user_dict:179-187`  | sets `password_expired` on the `/auth/me` and login response |
| `auth.get_session_settings:1403`         | reports the number to the client                             |

The only thing that acts on it is
`frontend/src/components/ProtectedRoute.tsx:166`
(`user?.must_change_password || user?.password_expired`), which routes the
browser to the change-password screen.

Its sibling control is enforced properly and says so: the
`must_change_password` gate in `get_current_user` carries the comment "the
frontend honors the same flag, **but the API must not rely on that**". The
same sentence is true of `password_expired` and there is no matching gate.

**Where:** `backend/app/api/dependencies.py:189-201` (where the sibling gate
is, and where this one is not); `backend/app/services/auth_service.py:248-261`.

**Failure scenario:** a member whose password is 400 days old signs in with
`curl` (or any script, any mobile client, anything that is not this SPA) and
gets a full session with every permission they hold. The browser is the only
thing that has ever enforced the 90-day maximum. An attacker holding a
credential harvested from an old breach is in the same position: password age
is precisely the control meant to have retired that credential, and it
retires nothing. It is also an asymmetry a reader of the code would not
expect, because the adjacent flag _is_ enforced.

**Impact:** a documented HIPAA §164.308(a)(5)(ii)(D) control is advisory only.
No cross-tenant exposure and no privilege gain — the member reaches exactly
their own permissions — but the compliance claim the setting represents is
not backed by the server.

**Why FLAGGED and not fixed:** the fix is a behaviour change that locks people
out on the day it deploys. Adding `password_expired` to the gate would, on
first boot after the upgrade, refuse every member whose `password_changed_at`
is more than 90 days old — on an installation that has never enforced this,
that is potentially the whole department at once, including whoever would have
to fix it. It needs an owner decision on the rollout (a grace period, a
staged threshold, a per-org opt-in, or simply accepting the cutover), which
is exactly the class this rotation flags rather than implements. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

**Resolution (2026-10-04): FIXED with a grace period**, the rollout the owner
chose. `get_current_user` now refuses an expired password with the same 403,
error code and `X-Password-Change-Required` header as the `must_change_password`
gate, and on the same allow-list, so the change itself stays reachable. It
does so only `HIPAA_PASSWORD_EXPIRY_GRACE_DAYS` (default 14) after
`users.password_expiry_notified_at`, which the daily `notify_expired_passwords`
task sets when it tells the member (in-app and email), or the member's first
authenticated request after expiry sets if that comes sooner. The column
starts NULL, so no member is refused on the day this deploys; every password
change clears it. The browser still sends an expired member to the change
screen at once. Arithmetic in `app/utils/password_expiry.py`; tests in
`backend/tests/test_password_expiry_gate.py`.

#### AUTH-16 — LOW — Nothing enforced "a verified second factor is always consumed"; the non-consuming verifier survived as a landmine — ✅ FIXED

**What:** AUTH-7, AUTH-9 and AUTH-13 established one invariant across three
rounds of review: every TOTP and recovery-code check must verify **and**
consume, under a row lock, through one of two helpers in `auth.py`. Nothing
checked it. `mfa_service.verify_totp` — the boolean, state-free verifier that
AUTH-7 had to remove from three routes — is still exported with **zero
callers anywhere in `app/`**, under the most obvious name in the module.

This is the shape AUTH-6 already named in this file: "an unused method whose
behavior contradicts a documented, load-bearing invariant is a landmine, not
neutral dead code." It is also the shape that produced AUTH-7 in the first
place — pass 3's original write-up _reasoned_ the three management routes were
safe without consumption, and the reasoning was wrong. A fourth round of the
same reasoning is what a machine check exists to prevent.

**Where:** `backend/app/services/mfa_service.py:32-39`; the two helpers it
should never displace are `auth.py:787` (`_verify_and_consume_totp`) and
`auth.py:839` (`_verify_and_consume_recovery_code`).

**Failure scenario:** not live today — the finding is the absence of a guard,
not a present defect. The scenario it prevents is AUTH-7's, verbatim: a route
added or edited later calls `mfa_service.verify_totp(secret, code)`, the code
is never marked spent, and a code observed in use there replays at
`POST /auth/mfa/login` inside its remaining ~30–90s window to open an
independent attacker-controlled session.

**Fix:** two parts, neither behavioural.

1. `verify_totp`'s docstring now says it is not for application code, names
   the helper to use instead, names AUTH-7, and points at the guard.
2. `tests/test_mfa_verification_consumes.py` — an AST sweep of the whole
   `app/` tree asserting three things: (a) `verify_totp` has **zero** call
   sites; (b) `verify_totp_get_timestep` and `find_matching_recovery_code`
   each have **exactly one** caller, named — the two consuming helpers, so a
   second place that can spend a code is a deliberate edit to this file
   rather than a silent one; (c) `pyotp` is imported only by
   `mfa_service.py`, which catches a hand-rolled `pyotp.TOTP(...).verify(...)`
   that would bypass both helpers without naming either.

Deleting `verify_totp` outright was considered and rejected: it would remove
the primitive `test_mfa_service.py` exercises, and it would not catch (c) —
the guard covers strictly more than removal would.

**Guard test:** the file above. Confirmed red, not assumed: reverting
`mfa_disable` to the pre-AUTH-7 `mfa_service.verify_totp(current_user.mfa_secret,
data.code)` produced `Offending call sites: app/api/v1/endpoints/auth.py:1113
in mfa_disable()`; adding a second `find_matching_recovery_code` call site
produced the exactly-one-caller failure naming both. Both reverted after.

#### AUTH-17 — LOW — Session rows are never reaped, so expired sessions keep a member's IP and user-agent indefinitely — 🚩 FLAGGED

**What:** `sessions` rows are deleted on exactly four events — logout, an idle
timeout actually being _hit_ by a request, a password change/reset, and
refresh-replay revocation. A session that simply expires quietly (the member
closes the tab; the access token lapses; the 7-day refresh token lapses) is
never touched again. There is no cleanup task: `delete(UserSession)` appears
only in `auth_service._revoke_all_user_sessions`, and
`services/scheduled_tasks.py` has no session job — it _does_ have retention
jobs for the two neighbouring tables (`archive_expired_logs` for audit rows,
`expire_ip_exceptions` for IP rules), which is what makes the absence look
like an oversight rather than a decision.

**Where:** `backend/app/models/user.py:840-874` (the table),
`backend/app/services/auth_service.py:419-444` (the only deleter),
`backend/app/services/scheduled_tasks.py` (no counterpart job).

**Failure scenario:** two, both slow. (1) Data retention: every row carries
`ip_address` and `user_agent` — where a member signed in from and on what
device — and there is no expiry on that, in an application that sets a 7-year
retention window on its audit log precisely because retention is a decision
it takes deliberately elsewhere. (2) Growth: the table accumulates one row per
sign-in per device forever, each holding two full JWTs in `String(512)`
columns. Neither is exploitable, and this pass's first draft claimed neither
degrades a lookup because "both token columns are indexed" — that claim was
wrong (see **AUTH-19**, fixed below) at the time it was written, and is only
true now because of that fix.

**Why FLAGGED and not fixed:** a reaper needs a retention window, and picking
one is a product decision — sessions are the data behind any future
"where am I signed in" screen, and deleting a row is also deleting that
history. It also needs a new scheduled task, which is a behaviour change, and
`scheduled_tasks.py` is feature 31's surface. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

#### AUTH-18 — NIT — Three claims in this feature's own record had drifted from the code — ✅ FIXED (docs only)

**What:** re-verifying prior passes turned up three statements that no longer
match, or never matched, the code. None is a security defect; all three would
mislead pass 5.

1. **The route split.** Passes 1–3 record "26 routes, 11 public / 15 private".
   The real split is **14 public / 12 private** — the public set is exactly
   the 14 `auth.py` entries in `ALLOWLISTED_PUBLIC`, and pass 1's own table
   already listed 14 rows with no auth dependency while its prose said 11.
   Corrected in this pass's inventory above.
2. **AUTH-12's "only place" claim.** AUTH-12 states it checked "whether a
   secret can be replaced anywhere else: `mfa_setup` is the only place that
   writes `mfa_secret` outside `mfa_disable`". That grep missed
   `users.py:2113` (`admin_reset_mfa`), which also nulls it. **The fix is
   still sufficient** — see the "Verified good" entry above — but the reason
   is `mfa_setup` clearing the timestep, not the absence of a third writer,
   and pass 5 should not re-derive a wrong premise.
3. **Pass 1's "no dead endpoints" claim.** It named `/check` among five routes
   with frontend callers. `authService.checkAuth` (the sole wrapper) now has
   zero call sites in `frontend/src` outside its own declaration and its test.
   The route is harmless (`get_current_user`, returns id + username), but it
   is not currently reachable from the app.

**Where:** this file, passes 1–3; `docs/app-review/auth-session.md`'s pass-3
section, which repeats the route-count correction and is corrected again
there.

**Fix:** the pass-4 sections above state the current facts, and
`docs/app-review/auth-session.md` gains a pass-4 note pointing here.

#### AUTH-19 — LOW — `sessions.refresh_token`, the column the hot refresh path filters on, had no index — ✅ FIXED

**What:** Codex review on PR #2389 caught this pass's own AUTH-17 write-up
asserting "both token columns are indexed" as a reason growth couldn't
degrade a lookup. It's false for one of the two: `token` (the access-token
column) is `unique=True, index=True`; `previous_refresh_token` (the
rotation-grace fallback, used only inside a short window right after a
refresh) is indexed by
`20260727_0001_add_session_refresh_grace.py`. `refresh_token` itself —
the column `AuthService.refresh_access_token` filters on for **every**
refresh request, the busiest query this table sees — was a plain
`Column(String(512))` with no index at all, since the initial schema
migration.

**Failure scenario:** combined with AUTH-17's own finding (no reaper, so
`sessions` grows without bound), every token refresh — issued on essentially
every authenticated page load once the short-lived access token expires —
degrades from an index seek to a full-table scan as the table grows. Not
exploitable by itself, but it meant AUTH-17's stated reasoning for staying
LOW ("neither is exploitable and neither degrades a lookup") rested on a
false premise for the column that matters most.

**Where:** `backend/app/models/user.py:856` (the column),
`backend/app/services/auth_service.py:344-347` (the filtering query).

**Fix:** `refresh_token = Column(String(512), index=True)`, plus
`alembic/versions/20260908_0223_1603bd9c59e7_index_sessions_refresh_token_for_the_.py`
adding `ix_sessions_refresh_token`. Purely additive — no data change, no
behavior change. Verified by running `alembic upgrade head` against the real
database, confirming the index appears in `SHOW INDEX`, then `alembic
downgrade -1` / `upgrade head` again to confirm both directions are real.
This does not replace AUTH-17's reaper — an indexed scan of an unbounded
table is still an unbounded scan, just a cheaper one — so AUTH-17 stays
flagged for the retention-window product decision.

### Schema & migration notes

One migration was written this pass — `1603bd9c59e7`, indexing
`sessions.refresh_token` (AUTH-19) — the first to touch this feature's tables
since pass 2's `20260825_1900_c4a91b7e2f08_grant_users_view_consents.py`. The
three tables this feature owns were re-checked against their models:

- `sessions` — `user_id` FK `ondelete="CASCADE"`, `nullable=False`; `token`
  unique + indexed; `refresh_token` now indexed (AUTH-19);
  `previous_refresh_token` indexed; `expires_at` indexed. Not a `SET NULL`
  case, so Pitfall #2 is n/a. No retention policy — AUTH-17.
- `password_history` — `user_id` FK `ondelete="CASCADE"`, `nullable=False`.
  Bounded on read by `HIPAA_PASSWORD_HISTORY_COUNT`, unbounded on write; rows
  hold only Argon2 hashes, so this is not the same exposure as AUTH-17.
- `user_consents` — unchanged since pass 1; both FKs `CASCADE` +
  `nullable=False`, unique index on `(user_id, consent_type)` matching the
  migration.

Alembic chain: 438 revisions, single head `1603bd9c59e7`, no duplicate ids.

### Guard tests added

| Test file                                   | Invariant it freezes                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/test_auth_gate_remediation_paths.py` | The two account-state gates in `get_current_user` always leave a member a route that clears the state, and never open an ordinary application route |
| `tests/test_mfa_verification_consumes.py`   | Every TOTP / recovery-code check in `app/` goes through a consuming, row-locked helper; `pyotp` stays confined to `mfa_service.py`                  |

Both were confirmed red against the defect they describe and green after —
the specific reversions are recorded in each finding above.

### Completion gate (pass 4)

| Check                                                                                                  | Result                                                                              |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                          | ✅ 0 violations                                                                     |
| `black --check app/ tests/ alembic/` (26.5.1, CI's pin)                                                | ✅ 1529 files unchanged (1 new test file reformatted before commit)                 |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                            | ✅ clean                                                                            |
| `validate_migrations.py --strict`                                                                      | ✅ single head `1603bd9c59e7`, 438 revisions                                        |
| `alembic upgrade head` / `downgrade -1` / `upgrade head` on the real database                          | ✅ `ix_sessions_refresh_token` created, dropped, recreated                          |
| `pytest tests/test_alembic_migrations.py tests/test_migration_create_all_tables.py`                    | ✅ 80 passed                                                                        |
| backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip or dependencies or permission"`)  | ✅ 600 passed, 2 skipped (both pre-existing: optional `pywebpush`, Docker registry) |
| standing guards (`endpoint_auth_coverage`, `org_scoping_ratchet`, `capacity_locking`, `like_escaping`) | ✅ 44 passed                                                                        |
| `scripts/check_docs_links.py`                                                                          | ✅ 351 files, 0 broken links                                                        |
| `tsc --noEmit` / `eslint .`                                                                            | n/a — no frontend source changed this pass                                          |

`black` was 26.3.1 on PATH via `/root/.local/bin`; CI pins 26.5.1, which was
already installed under `/usr/local`, so the gate above was run as
`python3 -m black` to use CI's version rather than the shadowing one.

---

## Pass 3 (2026-09-01)

**Diff since pass 2's baseline (`9a58e352`):** `auth.py` (+11/-4),
`consent_service.py` (+104/-4, all `roster()` — already reviewed and fixed in
pass 2, unchanged since), `models/user.py` (+124, all member-classification
work unrelated to auth — see the file's own `_reconcile_membership` docstring;
out of this feature's scope). `mfa_service.py` and `oauth_service.py` are
byte-identical to pass 2. Three frontend files touched since pass 2
(`authStore.ts`, `apiClient.ts`, `utils/createApiClient.ts`) — all three
diffs are already-landed fixes from other work (a `decodeURIComponent` on the
CSRF cookie reader, adding `/auth/mfa/login` to the refresh-skip allowlist so
an invalid MFA code doesn't trigger a refresh attempt, and a JSON-blob-decode
fix for file-download error responses); read and confirmed correct, not new
findings.

**Re-verified both prior fixes and the one flagged item, all still current:**

- **AUTH-1** (OAuth login skipped the organization-active check) — the fix is
  still in place: `oauth_service.py:50-60`'s `_link_existing_user` still
  filters `Organization.active.is_(True)` and fails closed with
  `(None, "no_account")` on an empty result. `test_resolve_user_no_active_organization`
  still passes.
- **AUTH-3** (stale photo-consent roster response could overwrite a newer one)
  — the `cancelled` guard is still present in
  `PhotoUseConsentPage.tsx:68-84`.
- **AUTH-4** (unbounded roster query, informational) — still accurate;
  `ConsentService.roster()` remains unpaginated for the same reason recorded
  in pass 2 (one of 255+ identically-shaped call sites app-wide; not a
  meaningful fix in isolation).

**Full re-read of all four in-scope backend files** (`auth.py` 1543 L / 26
routes — route count unchanged from pass 1, the +11 lines are one new import
and one line in `_build_current_user_dict` expanding legacy permission
aliases into the `/auth/me` and login-response permission list, unrelated to
this feature's own security surface and already correctly implemented in
`app/core/permissions.py`; `auth_service.py` 978 L; `mfa_service.py` 121 L;
`oauth_service.py` 340 L) against all seven checklist dimensions.

### Correction (Codex review on PR #2133)

Pass 3's original "Verified good" section (below, as first published) was
wrong on both of its two claims. Codex caught both; re-verified against the
real code before acting on either, per this rotation's own rule that a wrong
fix in an auth path is worse than an honest finding.

> ~~**TOTP replay handling is intentionally asymmetric between login and
> already-authenticated MFA management, and the asymmetry is not a gap.**~~
> ~~... none of the three management routes let a replay do anything a single
> legitimate call could not already do.~~
>
> ~~**`security_monitor.detect_brute_force`/suspicious-IP wiring from the auth
> endpoints matches `SEC-00`'s documented brute-force model exactly** ...~~

Struck through rather than deleted, so the record shows what was actually
claimed and reviewed, not a cleaned-up version of it.

### AUTH-7 — P1 — A TOTP code verified at an MFA management route was never recorded as consumed, letting it replay at `/mfa/login` — ✅ FIXED

**What:** `mfa_login` verifies a live TOTP code through
`verify_totp_get_timestep(secret, code, last_timestep=user.mfa_last_timestep)`
and, on success, records the matched step in `user.mfa_last_timestep` — a
code whose step is `<=` that value is rejected as a replay
(`mfa_service.py:42-75`). `mfa_verify_setup`, `mfa_disable`, and
`mfa_regenerate_recovery_codes` (the `/mfa/recovery-codes` handler) instead
called bare `mfa_service.verify_totp(secret, code)`, which returns a
boolean and touches no state at all. None of the three ever wrote
`mfa_last_timestep`.

The original "Verified good" writeup reasoned that this was harmless because
all three routes require an authenticated session and are each
self-blocking against a _second call to that same route_ with the same code
(`mfa_verify_setup`/`mfa_disable` flip `mfa_enabled` so a repeat hits the
router's own 400 first; regenerating recovery codes twice was called
"idempotent-equivalent in risk"). That reasoning only checked replay _at the
same endpoint_. It never checked replay _at a different endpoint_ — and
`/mfa/login` is exactly that: a route that accepts a bare TOTP `code` from
anyone holding a fresh `mfa_pending` token, with no session of its own.

**Where:** `app/api/v1/endpoints/auth.py` — `mfa_verify_setup` (former line
940), `mfa_disable` (former line 989), `mfa_regenerate_recovery_codes`
(former line 1050); all three called `mfa_service.verify_totp` directly,
pre-fix.

**Failure scenario:** an attacker already holds the account's password (a
breach, reuse, phishing — a prerequisite either way, and the same
prerequisite the "Attack Protection" table in CLAUDE.md already assumes for
every MFA-bypass discussion). That alone gets them a valid `mfa_pending`
token for free from `POST /login` — the password step succeeds regardless
of MFA. If the attacker then _observes_ a TOTP code the legitimate user is
using _right now_ at `/mfa/recovery-codes` (or `/mfa/disable`, or
`/mfa/verify-setup` during enrollment) — shoulder-surfing, a compromised
endpoint or extension, a phishing-relay page that captures and immediately
forwards the code — nothing recorded that time-step as spent. The attacker
submits the same code to `/mfa/login` within its remaining ~30–60s validity
window (pyotp's default `valid_window=1` both `verify_totp` and
`verify_totp_get_timestep` use accepts the step before and after "now," so
the practical window is up to ~90s from when the legitimate user's code was
generated) and completes a fully independent login of their own — a second,
attacker-controlled session, indistinguishable from the legitimate one at
the protocol level. `user.mfa_last_timestep` was `None` or older than the
current step regardless of how many times the code had already been used
elsewhere, so `mfa_login`'s replay check had nothing to reject.

Confirmed empirically, not just reasoned: reverting the fix and driving
`mfa_regenerate_recovery_codes` then `mfa_login` with the same code through
the real handlers produces a completed session
(`Created session for user: ...`, `mfa_login` returns 200) — see the
`git log` message on this fix's commit for the reproduction. The design gap
predates this pass (`mfa_last_timestep`'s own column comment says "Highest
TOTP time-step ... already accepted **at login**" — the mechanism was scoped
to the login path from when it was written, not extended when the three
management routes were added), so this is not a regression introduced by
pass 3's diff; pass 3's error was mischaracterizing it as verified-safe.

**Fix:** introduced `_verify_and_consume_totp(user, code) -> bool` in
`auth.py` — the single "verify AND consume" primitive every code-verifying
route must go through. It calls `verify_totp_get_timestep` and, on a match,
sets `user.mfa_last_timestep` before returning `True`. All four call sites
(`mfa_login`, `mfa_verify_setup`, `mfa_disable`,
`mfa_regenerate_recovery_codes`) now call it instead of calling
`verify_totp`/`verify_totp_get_timestep` directly; each route's existing
`db.commit()` persists the recorded step exactly as it already persisted
every other field the route sets in the same request. No behavior change to
any route's success/failure semantics — only that a verified code is now
always recorded as spent, everywhere.

**Also raised (Codex): `/mfa/recovery-codes` is not idempotent** — a retried
request (network retry, double-click) regenerates an entirely new code set
and overwrites the stored hashes, so a client that never saw the first
response is left with codes that don't match what was displayed. **FLAGGED,
not fixed** — see `docs/KNOWN_LIMITATIONS.md`. This fix incidentally
narrows it (a retry using the _same_ TOTP code now fails cleanly with
"Invalid verification code" instead of silently generating a second set,
because the code was already consumed by the first call), but does not
close it: a retry that lands after the server committed but the response
was lost in transit still leaves the user without the codes they were
shown. That is a generic exactly-once-delivery problem shared by every
secret-shown-once response in this file (`mfa_verify_setup`'s recovery codes
have the identical exposure), not specific to TOTP replay, and the right
fix (an idempotency-key mechanism, or a "re-show last-issued codes" path) is
a product decision this pass is not making unilaterally in an auth path.

**Follow-up (2026-10-04): FIXED with an idempotency key**, the option the
owner chose. `verify-setup` and `recovery-codes` accept `Idempotency-Key`; a
retry with the same key and code from the same member within ten minutes is
answered with the set already issued, before the spent code is checked. The
replay is bound to the member, the endpoint and a hash of the code (a
different code under the same key is a 422), the stored response is
encrypted with the application key, and a set replaced since or MFA turned
off since is never replayed. Requests without the header behave as before.
See `app/core/issued_secrets.py` and
`backend/tests/test_mfa_recovery_code_replay.py`.

**Guard test:** `TestTotpConsumedAcrossMfaRoutes` in
`backend/tests/test_auth_mfa_endpoints.py` —
`test_code_used_at_recovery_codes_route_cannot_replay_at_login` drives the
real `mfa_regenerate_recovery_codes` handler with a valid code, then submits
the same code to the real `mfa_login` handler and asserts a 401. Confirmed
to fail pre-fix: reverting `auth.py` to the pre-fix revision and re-running
the exact same two calls (via a standalone script, since the pre-fix module
doesn't even export `_verify_and_consume_totp`) shows `mfa_login` completing
successfully with the replayed code — `user.mfa_last_timestep` stayed `None`
after the recovery-codes call, and `mfa_login` proceeded straight to session
creation. Two supporting unit tests
(`test_verify_and_consume_totp_rejects_its_own_replay`,
`test_fresh_code_after_consumption_still_verifies`) cover the shared
primitive directly.

### AUTH-8 — P2 — `mfa_login` never fed `detect_brute_force`, and the doc's "matches SEC-00's model" claim was wrong — ✅ FIXED

**What:** `login`'s password-failure branch calls
`security_monitor.detect_brute_force(db, ip=login_ip, user_id=None,
success=False)` and its password-success branch calls it again with
`success=True` — but that success call runs _before_ the `if
user.mfa_enabled:` branch (`auth.py`, former lines 682–727), i.e. on
password-correct alone, not on full authentication. `mfa_login` — the
second-factor completion step — never called `detect_brute_force` at all,
in either its failure or success path. The original writeup asserted this
"matches `SEC-00`'s documented brute-force model exactly" and specifically
that `clear_auth_failures` (a _different_ function, the suspicious-IP
throttle) is "called only after full authentication succeeds — after the
MFA branch on `login`, not on password-correct alone." That description of
`clear_auth_failures` is correct — but the claim was about
`detect_brute_force`'s wiring being equivalent, and `detect_brute_force`'s
own success call sits _before_ the MFA branch, the opposite of the
invariant being cited to justify it. And `mfa_login` calling it not at all
means guessing the second factor generates zero `detect_brute_force`
alerting history for the whole MFA step.

**Where:** `app/api/v1/endpoints/auth.py` — `login`'s
`detect_brute_force(..., success=True)` call at former line 713 (still
runs, and is correctly positioned relative to _its own_ purpose — see
"What's still covered" below); `mfa_login` had no `detect_brute_force` call
anywhere, pre-fix.

**What's still covered, so the write-up is precise about scope:**
`detect_brute_force` is purely an alerting/audit mechanism — it stages a
HIGH-severity `SecurityAlert` row and an audit-log entry past a threshold; it
enforces nothing itself. Two _enforcing_ controls already covered MFA-code
guessing before this fix and still do: the per-account lockout
(`user.failed_login_attempts`/`locked_until`, mirroring the password step's
own lockout logic) and the suspicious-IP throttle
(`record_auth_failure`/`clear_auth_failures`, gated on the next request by
`enforce_suspicious_ip`). Guessing the second factor was already throttled
and eventually locked the account; what was missing was purely this one
detector's alert firing and its short-window per-IP/per-user tally.

**Fix:** `mfa_login`'s failure branch now calls
`security_monitor.detect_brute_force(db, ip=get_client_ip(request),
user_id=str(user.id), success=False)` alongside the existing
`failed_login_attempts` increment, before the branch's existing
`db.commit()` (which now also persists any alert row `detect_brute_force`
staged — no new commit needed). The success branch calls it with
`success=True` alongside the existing `clear_auth_failures` call, resetting
the account's short-window tally once the _full_ login (password + second
factor) has completed. Both calls are best-effort, wrapped in
`try/except Exception: logger.debug(...)`, matching `login`'s own pattern
exactly — a detector failure must never break the login response. `login`'s
own `success=True` ordering (before the MFA branch) is unchanged by this
fix; it is a separate, lower-severity inaccuracy (a purely-alerting
detector's history resets on password-correct rather than on full auth) that
this pass is not re-ordering, since `login`'s call is scoped to the password
step specifically and doing so was not part of Codex's finding.

**Guard test:** `TestMfaLoginBruteForceWiring` in
`backend/tests/test_auth_mfa_endpoints.py` — asserts a failed MFA code calls
`detect_brute_force(db, ip="unknown", user_id=user.id, success=False)` and a
successful one calls it with `success=True`, against the real `mfa_login`
handler.

### AUTH-9 — P1 — A real concurrency race in the AUTH-7 fix itself: `_verify_and_consume_totp` had no row lock — ✅ FIXED

**What:** Codex reviewed the AUTH-7/AUTH-8 fix commit (`2640733a`) and found
that `_verify_and_consume_totp` — the very primitive AUTH-7 introduced to
make TOTP consumption atomic across routes — was not atomic across
_concurrent requests_. It read `user.mfa_last_timestep` off whatever ORM
object the caller had already loaded (via a plain, unlocked attribute
access) and wrote the consumed step back onto that same in-memory object, with
persistence deferred entirely to the caller's later `db.commit()`. Nothing
between the read and the write locked the row or re-checked the DB's current
value — a plain read-then-later-write, not a compare-and-set.

**Where:** `app/api/v1/endpoints/auth.py` — `_verify_and_consume_totp`
(former lines 778–799, pre-fix), called from all four TOTP-verifying routes
(`mfa_login`, `mfa_verify_setup`, `mfa_disable`,
`mfa_regenerate_recovery_codes`).

**Failure scenario (Codex):** a phishing relay captures a valid TOTP code
from a victim and races the SAME code against two requests simultaneously —
the attacker's own `POST /mfa/login` and the victim's legitimate request to
any of the other three management routes. Each request loads its own `User`
row (each endpoint either queries fresh or receives `current_user` from
`get_current_active_user`, both unlocked reads) before either commits. Both
see the same, not-yet-consumed `mfa_last_timestep`, both pass
`verify_totp_get_timestep`'s "newer than last consumed" check, and both
commit — the attacker's session and the victim's own legitimate session both
complete, defeating the exact single-use guarantee `_verify_and_consume_totp`'s
own docstring claims to provide. This is not hypothetical: reproduced with two
REAL, independently-committing `AsyncSession`s racing the identical code
against a real row in the test database (see Guard test below) — against the
pre-fix code, both concurrent calls returned `True`.

**Fix:** `_verify_and_consume_totp` now re-fetches the user row with
`.with_for_update().execution_options(populate_existing=True)` before
checking or consuming the code — the same locking-read pattern this codebase
already uses for every other read-then-write capacity/consistency check
(`quorum_service.calculate_quorum`, `users.py`'s profile lock,
`membership_pipeline_service.py`, `inventory_service.py`; CLAUDE.md Pitfall
#27). The lock serializes the two requests: the second blocks on the SELECT
until the first's transaction commits, then — critically —
`populate_existing=True` forces the already-in-the-session's-identity-map
`User` object to be refreshed from that fresh read rather than silently
keeping the stale value `expire_on_commit=False` (`app/core/database.py`)
would otherwise leave cached. Without `populate_existing`, the lock alone
would be acquired correctly but bought nothing: the second request would
still evaluate the replay check against the pre-lock in-memory value. The
helper became `async` (it now issues its own `db.execute`); all four call
sites updated to `await _verify_and_consume_totp(db, user, code)`.

**Guard test:** `TestVerifyAndConsumeTotpConcurrency` in
`backend/tests/test_auth_mfa_endpoints.py` —
`test_two_real_sessions_racing_the_same_code_only_one_consumes` opens two
independent connections from the app's real engine against a real row in the
test database, uses `asyncio.Event` to hold call A's transaction open (and
its row lock with it) until call B's own locking read has genuinely
suspended waiting on that lock (polled, not a fixed sleep — the test fails
loudly if B's read completes before A releases, meaning the run could not
have distinguished the fix from the race), then releases A and asserts A
returns `True` and B returns `False`. A mocked single `db` cannot exercise
this — the fix depends on a real InnoDB row lock actually blocking a second
session, which no mock reproduces. Confirmed to fail against the pre-fix
code: temporarily reverting the helper's query to a plain unlocked SELECT
(same signature, so the test needed no changes) made the guard assertion
trip with `result_b == True` — both concurrent calls consumed the code.
Three existing unit tests in `TestTotpConsumedAcrossMfaRoutes` needed a
matching `db` stand-in for the helper's new locking re-SELECT
(`_locking_db_for`, added) and an `await`, but their assertions are
unchanged.

### AUTH-10 — P2 — `login`'s brute-force-reset call fired on password-correct alone, silently defeating AUTH-8's own fix — ✅ FIXED

**What:** AUTH-8 wired `mfa_login`'s failure path to
`detect_brute_force(success=False)` so that guessing the second factor would
accumulate toward this detector's per-user HIGH alert threshold
(`failed_logins_per_user`, default 5). It deliberately left `login`'s own
pre-existing `detect_brute_force(success=True)` call unchanged, reasoning it
was a separate, lower-severity, out-of-scope inaccuracy. Codex's point: that
call fires immediately on a correct password, **before** the
`if user.mfa_enabled:` branch — including for MFA-enabled accounts, where a
correct password is not full authentication. An attacker who already knows
the password (a prerequisite for reaching the MFA step at all) can call
`POST /login` again before every MFA guess — ordinary behavior for a client
that re-establishes its `mfa_pending` token per attempt, not exotic — and
each such call resets the very tally `mfa_login`'s `success=False` call was
just wired to accumulate. The two calls fight each other: one MFA-guess
failure accumulates one entry, then the next `/login` call zeroes it before
the next guess. The alert threshold set by AUTH-8's own fix was therefore
still unreachable in practice — AUTH-8 fixed the missing call, but not the
adjacent call that kept erasing its effect.

**Where:** `app/api/v1/endpoints/auth.py` — `login`, former lines 711–717
(the `detect_brute_force(..., success=True)` call, positioned before the
`if user.mfa_enabled:` branch at former line 721).

**Failure scenario:** identical shape to the one CLAUDE.md's Attack
Protection table already documents for the separate `clear_auth_failures`
counter ("an attacker holding one leaked password for an MFA-protected
account could zero the tally at will") — except this was the
`detect_brute_force` detector, and AUTH-8 had just wired MFA failures into
it specifically to close this class of gap. Reproduced empirically: a test
driving five real `login()` + wrong-code `mfa_login()` cycles against a
fresh `SecurityMonitoringService` instance shows the per-user tally stuck at
`1` after every cycle, pre-fix — never reaching the threshold no matter how
many wrong codes are guessed, so long as the attacker's script calls
`/login` before each guess.

**Fix:** moved the `success=True` call below the `if user.mfa_enabled:`
branch, so it is only reached on the branch where a correct password _is_
full authentication (MFA disabled) — mirroring the invariant
`clear_auth_failures` immediately below it already enforced. No behavior
change to the MFA-enabled response itself (still returns `mfa_required`); the
detector's tally for an MFA-enabled account is now reset only by
`mfa_login`'s own `success=True` call, once the second factor actually
succeeds.

**Guard test:** `TestLoginBruteForceResetGating` in
`backend/tests/test_auth_mfa_endpoints.py` —
`test_login_plus_wrong_mfa_code_cycling_still_accumulates` patches a fresh,
unshared `SecurityMonitoringService` into `auth.py` (so the assertion isn't
polluted by the module singleton's cross-test state), drives 5 real
`login()` + wrong-code `mfa_login()` cycles, and asserts the per-user tally
increases by exactly 1 on every cycle (`1, 2, 3, 4, 5`) rather than being
reset back to `1` each time. Confirmed to fail against the pre-fix ordering:
reverting just the call's position reproduces the exact "stuck at 1" failure
the test's own message describes.

### AUTH-11 — P2 — An alert-write failure inside `_add_alert` could poison the caller's own commit — ✅ FIXED

**What:** `SecurityMonitoringService._add_alert` (`security_monitoring.py`)
persists a `SecurityAlertRecord` and wraps the write in
`try/except Exception: logger.warning(...)` — a failure there was already
swallowed and never raised to the caller. Codex's point was narrower and
correct: catching the exception does not undo its effect on the **session**.
Once a real `flush()` fails against the database, SQLAlchemy marks that
`AsyncSession`'s transaction as needing a rollback, and refuses every further
operation on it — including `commit()` — until one happens
(`sqlalchemy.exc.PendingRollbackError`). Both callers of `detect_brute_force`
(`login`, `mfa_login`) unconditionally `db.commit()` shortly afterward to
persist `failed_login_attempts`/lockout state on the **same** session. So a
transient alert-write failure — caught right here, exactly as designed —
still surfaced as an unhandled 500 on the caller's own later commit instead
of the endpoint's intended 401, and lost every side effect
(`failed_login_attempts`, suspicious-IP recording) the caller had already
staged in the same request.

**Where:** `app/services/security_monitoring.py` — `_add_alert` (former
lines 290–340, pre-fix): the `db.add(record); await db.flush()` sequence ran
directly against the caller's session, with no isolation.

**Checked before assuming a fix was needed, per this rotation's own rule:**
confirmed `_add_alert` had no savepoint/isolation handling despite the
extensive PR #2132 rework of this same file — that work fixed several
async-interleaving and read-after-evict races in the in-memory trackers, but
never touched `_add_alert`'s DB-write path.

**Fix:** wrapped the write in `db.begin_nested()` (a SAVEPOINT) — the exact
pattern already established in `AuditLogger.create_log_entry`
(`app/core/audit.py:190`, referenced in the #2132 work) for the identical
problem (an audit-log write failure must not break the caller's own
transaction). A failure now rolls back only the savepoint; the outer
session/transaction, and everything the caller already staged on it, is
untouched and `commit()`s normally afterward.

**Guard test:** `TestAddAlertSavepointIsolation` in
`backend/tests/test_security_monitoring.py` —
`test_alert_write_failure_does_not_poison_the_callers_commit` uses the real
`db_session` fixture (a real `AsyncSession` against the test MySQL database,
not a mock — a mocked `flush()` raising a plain exception never touches the
DBAPI transaction and cannot reproduce the "session needs rollback" state
this bug depends on) and a **real** NOT NULL constraint violation
(`SecurityAlert.description=None` — the in-memory dataclass has no runtime
type check, so it reaches `flush()` and fails there as a genuine
`IntegrityError`). After `_add_alert` swallows that failure, the test adds an
unrelated row and commits — standing in for the caller's own
`failed_login_attempts` write — and asserts that commit succeeds, plus that
the alert row was not partially persisted. Confirmed to fail against the
pre-fix code: reverting just the `begin_nested()` wrapper reproduces
`sqlalchemy.exc.PendingRollbackError` on that second commit, verbatim.

### AUTH-12 — P2 — MFA re-enrollment could spuriously fail with a false "replay" rejection — ✅ FIXED

**What:** `mfa_disable` clears `mfa_secret`/`mfa_enabled`/`mfa_backup_codes`
but, pre-fix, left `mfa_last_timestep` untouched. TOTP timesteps are
unix-time-derived (`unix_time // 30`), not secret-derived — `mfa_setup`
likewise left it untouched when installing a fresh secret. A user who
disables MFA and immediately re-enrolls with a new secret could hit
`/mfa/verify-setup` with a legitimate first code for the **new** secret that
happens to land in the same 30s wall-clock window as whatever raw timestep
number was last recorded against the **old** secret.
`verify_totp_get_timestep` rejects any code whose step is `<=
last_timestep` purely by comparing raw step numbers — it has no way to know
the two codes verify against completely different secrets.

**Where:** `app/api/v1/endpoints/auth.py` — `mfa_disable` (clearing the
secret) and `mfa_setup` (installing a fresh secret); both leave
`mfa_last_timestep` at whatever it was, pre-fix. (Checked whether a secret
can be replaced anywhere else: `mfa_setup` is the only place that writes
`mfa_secret` outside `mfa_disable`, and it can be called a second time on an
still-unconfirmed enrollment — an abandoned first attempt overwritten by a
second `/mfa/setup` call — which carries the identical exposure, so it needed
the same fix.)

**Failure scenario:** a real, if narrow, availability bug — not a security
gap. Disable-then-immediately-re-enroll is a normal recovery flow (e.g. a
user resetting MFA after losing their old authenticator app registration but
keeping the same one installed), and a spurious rejection forces a wait for
the next 30s window, worse under any clock skew. Reproduced end-to-end: a
test disables MFA with a code for an OLD secret, re-enrolls with a NEW
secret, and submits the NEW secret's current code in the same wall-clock
timestep — pre-fix, `mfa_verify_setup` rejects it as a replay of the OLD
code purely because the raw step number matches, even though the two codes
share no secret in common.

**Fix:** both `mfa_disable` and `mfa_setup` now set
`current_user.mfa_last_timestep = None` alongside the secret change, so a
freshly issued secret always starts with a clean replay-check baseline.

**Guard test:** `TestMfaLastTimestepClearedOnSecretChange` in
`backend/tests/test_auth_mfa_endpoints.py` — three tests: field-clearing
on `mfa_disable` and on `mfa_setup` individually, plus
`test_disable_then_reenroll_same_timestep_code_is_not_rejected`, the
end-to-end reproduction described above. All three confirmed to fail
against the pre-fix code (the two `mfa_last_timestep = None` lines removed):
the field-clearing tests assert a stale value directly, and the end-to-end
test reproduces the exact false-replay rejection.

### AUTH-13 — P1 — Found in the adversarial re-read: the identical unlocked read-then-write race, one field over, in the recovery-code path — ✅ FIXED

**What:** not a Codex finding — surfaced by this round's own required final
adversarial pass ("look hard for anything else the same shape" as AUTH-9)
before considering the round done. `mfa_login`'s recovery-code branch had
the exact same shape as AUTH-9's TOTP race, just on `mfa_backup_codes`
instead of `mfa_last_timestep`: it read `user.mfa_backup_codes` off the
caller's already-loaded, unlocked object, found a match, and wrote the
filtered list back with no row lock and no re-check against the database's
current value.

**Where:** `app/api/v1/endpoints/auth.py` — `mfa_login`'s recovery-code
branch (former lines 938–944, immediately below the `_verify_and_consume_totp`
call AUTH-9 had just fixed — the fix for one field sat directly above an
identical bug in the next one).

**Failure scenario:** if anything, a more attractive target than the TOTP
race AUTH-9 fixed: a recovery code has no ~30–90s expiry to outrun, so an
observed or phished recovery code stays exploitable indefinitely, not just
within a narrow window. Two concurrent `/mfa/login` requests presenting the
SAME recovery code could each load their own stale copy of
`mfa_backup_codes`, each find the code present, each filter it out of their
own in-memory copy, and each commit — both completing independent sessions
with a code that is supposed to work exactly once. Reproduced with the same
rigor as AUTH-9: two real, independently-loading sessions each performing an
unlocked read-then-write on the same recovery code both returned success
(verified via a throwaway reproduction script mirroring `mfa_login`'s actual
per-request load pattern, then deleted — not left in the tree).

**Fix:** extracted `_verify_and_consume_recovery_code(db, user, code) ->
bool`, structurally identical to AUTH-9's `_verify_and_consume_totp` fix — a
`.with_for_update().execution_options(populate_existing=True)` locking
re-read before checking/filtering the stored codes. `mfa_login`'s
recovery-code branch now calls it instead of inlining the read-check-write.

**Guard test:** `TestVerifyAndConsumeRecoveryCodeConcurrency` in
`backend/tests/test_auth_mfa_endpoints.py` —
`test_two_real_sessions_racing_the_same_recovery_code_only_one_consumes`,
same two-real-session, `asyncio.Event`-controlled-interleaving shape as
AUTH-9's guard test (including the same "B's read must actually block on
A's held lock" self-check), racing an identical recovery code instead of a
TOTP code. Confirmed to fail against the pre-fix shape: a throwaway
pytest-based reproduction using two full per-session `User` loads (matching
what the removed inline code actually did — the fixed helper's own minimal
`SimpleNamespace(id=...)` stub doesn't carry the attributes the unlocked
code path needs, so the checked-in guard test's exact harness isn't reusable
unmodified against the pre-fix shape, same as AUTH-9) printed
`result_a=True result_b=True` — both concurrent requests consumed the same
code — before being deleted.

### AUTH-5 — NIT — `validate-reset-token` docstring claimed the endpoint returns the email — ✅ FIXED (doc only)

**What:** `auth.py`'s `validate_reset_token` docstring said "Returns whether
the token is valid and the associated email," but the handler deliberately
returns only `{"valid": True}` — the inline comment directly above the
`return` even says why ("omit email to prevent user enumeration"). The
docstring and the code next to it disagreed.

**Where:** `app/api/v1/endpoints/auth.py` (the `validate_reset_token`
docstring, pre-fix).

**Failure scenario:** n/a — documentation accuracy only. Left as-is, a future
reader trusting the docstring over the code could add an email field to the
response believing one was already being returned and removed, reintroducing
the exact enumeration vector the comment next to `return` exists to prevent.

**Fix:** Docstring now states what the code does: validity only, email
intentionally omitted.

### AUTH-6 — INFORMATIONAL — Dead code in the suspicious-IP in-memory fallback contradicted its own invariant — ✅ FIXED

**What:** `_InMemoryFailureTracker.clear(ip)` in `app/core/suspicious_ip.py`
cleared **both** `self.failures` and `self.blocks` for an IP. It was never
called — `clear_auth_failures()` (the only place that resets a counter on
successful auth) calls `_memory_tracker.failures.pop(ip, None)` directly, not
`.clear()`. The module's own docstring and `clear_auth_failures`'s docstring
both state the invariant this class exists to enforce: "clearing never lifts
an active block" (mirrored in CLAUDE.md's Attack Protection table). The dead
`clear()` method did the opposite of that invariant.

**Where:** `app/core/suspicious_ip.py:117-119` (pre-fix).

**Why this matters even though it was never called:** an unused method whose
behavior contradicts a documented, load-bearing invariant is a landmine, not
neutral dead code — a future edit that "simplifies" `clear_auth_failures()` by
calling the conveniently-named `.clear()` instead of the two-line direct pop
would silently reintroduce exactly the bypass CLAUDE.md's Attack Protection
section calls out by name: "an attacker holding one leaked password... could
zero the tally at will." The Redis-backed path (`clear_auth_failures`'s
primary branch) never had an equivalent method to begin with — only `delete`
on the fail key, never touching the block key — so the in-memory fallback was
the only place this landmine existed.

**Fix:** Removed the unused method. `grep`-confirmed no caller anywhere in
`app/` or `tests/` (the one test file exercising this tracker,
`test_suspicious_ip_throttle.py`, resets state directly via
`_memory_tracker.failures.clear()` / `.blocks.clear()` — plain `dict.clear()`,
not the removed class method — so it required no change).

**Completion gate (pass 3, initial — before the AUTH-7/AUTH-8 correction):**

| Check                                                                   | Result                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                           | ✅ 0 violations                                                       |
| `black --check app/ tests/ alembic/`                                    | ✅ unchanged (1351 files)                                             |
| `isort --check-only app/ tests/ alembic/`                               | ✅ clean                                                              |
| `validate_migrations.py --strict`                                       | ✅ single head, 399 revisions                                         |
| backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip"`) | ✅ 216 passed, 1 skipped (pre-existing, missing optional `pywebpush`) |
| `npm run typecheck` (native compiler wrapper)                           | ✅ 0 errors                                                           |
| `npx eslint .`                                                          | ✅ 0 errors/warnings (no frontend files touched this pass)            |

**Completion gate (AUTH-7/AUTH-8 correction, this PR):**

| Check                                                                   | Result                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                           | ✅ 0 violations                                                      |
| `black --check app/ tests/ alembic/`                                    | ✅ clean (1 file reformatted before commit — new test file)          |
| `isort --check-only app/ tests/ alembic/`                               | ✅ clean                                                             |
| `validate_migrations.py --strict`                                       | ✅ single head, 399 revisions                                        |
| backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip"`) | ✅ 221 passed (5 new), 1 skipped (pre-existing, missing `pywebpush`) |
| `npm run typecheck` (native compiler wrapper)                           | ✅ 0 errors                                                          |
| `npx eslint .`                                                          | ✅ 0 errors/warnings (no frontend files changed this correction)     |

**Completion gate (AUTH-9 through AUTH-13, Codex round 2 on `2640733a` plus
AUTH-13 from this round's own adversarial re-read):**

| Check                                                                                                                                                                   | Result                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                           | ✅ 0 violations                                                            |
| `black --check app/ tests/ alembic/`                                                                                                                                    | ✅ clean (1 file reformatted before commit — `test_auth_mfa_endpoints.py`) |
| `isort --check-only app/ tests/ alembic/`                                                                                                                               | ✅ clean                                                                   |
| `validate_migrations.py --strict`                                                                                                                                       | ✅ single head, 399 revisions (no migrations touched this round)           |
| backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip"`)                                                                                                 | ✅ 227 passed, 1 skipped (pre-existing, missing `pywebpush`)               |
| `backend/tests/test_security_monitoring.py` (full file, run directly — the keyword filter above does not match this file's name/test IDs, and AUTH-11's fix lives here) | ✅ 28 passed (1 new)                                                       |
| `npm run typecheck` (native compiler wrapper)                                                                                                                           | ✅ 0 errors                                                                |
| `npm run lint`                                                                                                                                                          | ✅ 0 errors/warnings (no frontend files changed this round)                |

7 new regression tests total (1 `TestVerifyAndConsumeTotpConcurrency`, 1
`TestLoginBruteForceResetGating`, 3 `TestMfaLastTimestepClearedOnSecretChange`,
1 `TestAddAlertSavepointIsolation`, 1
`TestVerifyAndConsumeRecoveryCodeConcurrency`), each individually confirmed
to fail against `2640733a` (or, for AUTH-13, against the equivalent pre-fix
shape — see its own Guard test note) and pass after its fix.

---

## Pass 2 (2026-08-27)

`git diff` between PR #1804's merge commit (`9a58e352`) and current `main`
shows **zero changes** to `auth.py`, `auth_service.py`, `mfa_service.py`, or
`oauth_service.py` — byte-identical. AUTH-1's fix
(`Organization.active.is_(True)` + fail-closed `(None, "no_account")` in
`oauth_service.py:57-77`) is confirmed still present, and its guard test
(`test_resolve_user_no_active_organization`) still passes. The route count is
unchanged at 26.

`consent_service.py` is the one file in this feature's scope that grew
(84 L → 211 L) since pass 1, entirely from a new "Photo Use Consent" feature
(commits `4b68b3da`, `d5bb37ce`, `fd3c797f` — a new `roster()` method, a new
`GET /users/consents/photo-use` endpoint in `users.py`, a new
`users.view_consents` permission, and a frontend `PhotoUseConsentPage.tsx`).
Read in full against all seven checklist dimensions, since none of it existed
at pass 1:

- **Tenant isolation (dim. 3):** `roster()` takes `organization_id` as a
  parameter and filters `User.organization_id` directly, plus a belt-and-
  suspenders `UserConsent.organization_id == organization_id` on the outer
  join condition (commented as "redundant against the org filter on User,
  kept so the join can never pull a row from another tenant"). Correct.
- **Authorization fit (dim. 2):** the endpoint's `require_permission` list
  (`users.view_consents`, `notifications.manage`, `members.manage`,
  `users.edit`) was deliberately built to avoid the XC-2 pattern this
  checklist watches for — the code comment explains why `users.view` (held by
  25 of 30 default positions) was rejected as too broad for a whole-department
  consent roster, and why the new narrow permission exists instead of
  widening an existing broad one. This is the checklist's own dimension-2
  concern, already reasoned through by the author.
- **Data exposure (dim. 5):** `roster()`'s docstring and code both explicitly
  exclude contact fields ("Returns no contact fields... a second list carrying
  it unconditionally would quietly undo [the member directory's
  contact-visibility gate]") — returns only name/rank/station/membership
  number/photo_url, which is what identifies someone on a photo call sheet.
  Caching: `/users` (no trailing slash) is already in `UNCACHEABLE_PREFIXES`
  and matches every consent sub-path via `startsWith` — no separate entry
  needed, verified by grep rather than assumed.
- **Fan-out helper `granted_user_ids`** (used by
  `notification_channels.resolve_sms_recipients`) does not itself filter
  `organization_id`, but its only caller passes an already org-scoped `users`
  list and the function can only _narrow_ that set (intersect with consent),
  never add ids beyond what the caller supplied — resolves through an
  already-org-scoped parent, not a gap.
- **Schema & migration integrity (dim. 7):** `ConsentType.PHOTO_USE` already
  existed at pass 1 (no model/column change needed); the new
  `20260825_1900_c4a91b7e2f08_grant_users_view_consents.py` migration is a
  seeded-grant backfill and does everything Pitfall #23 + #26 require: scoped
  to `is_system = True`, rewrites a row only when its stored permissions still
  exactly equal a frozen `_PRIOR_DEFAULTS` snapshot (so a department that
  already customized the position is left alone), guards on the `positions`
  table's existence before reflecting it (`create_all`-only table, Pitfall
  #26), and ships both `upgrade()` and a symmetric `downgrade()`.
- No `window.confirm`/`alert`/`prompt`, no direct `fetch`/raw `axios` in
  `PhotoUseConsentPage.tsx` (grep-confirmed — it goes through the shared
  service layer feature 34 already reviewed).

**Correction (Codex review on PR #1929):** the "no findings" conclusion above
was wrong on two counts, both raised by Codex against `PhotoUseConsentPage.tsx`
and `consent_service.py`.

### AUTH-3 — LOW — Stale roster response could overwrite a newer one — ✅ FIXED

**What:** `PhotoUseConsentPage.tsx`'s `loadRoster` fired a new
`getPhotoUseConsentRoster(includeInactive)` request on every change to the
`includeInactive` toggle with no cancellation or staleness check. Toggling the
checkbox twice in quick succession (check, then uncheck before the first
request resolves) let the two requests resolve out of order; whichever
response landed last overwrote `roster` via `setRoster`, regardless of whether
it still matched the toggle's current value.

**Where:** `frontend/src/modules/communications/pages/PhotoUseConsentPage.tsx`
(the `useEffect`/`loadRoster` pair).

**Failure scenario:** a PIO toggles "Include inactive members" on and then
immediately back off while choosing photos. If the first (checked) request is
slow and resolves after the second (unchecked) one, the roster silently
reverts to including inactive members — with the checkbox itself showing
unchecked, a display state inconsistent with what's on screen. Each member's
own `granted`/`declined` value is unaffected (the race is only over which
members appear, not their consent state), but the page is documented as "the
operational enforcement point" for photo consent, so a PIO trusting the
checkbox to reflect what's listed is a real, if narrow, correctness bug.

**Fix:** moved the fetch into the `useEffect` body with the codebase's
existing `let cancelled = false` / cleanup-sets-`cancelled=true` idiom (same
pattern as `PipelineDetailPage.tsx`), so a response belonging to a superseded
effect run is never applied to state.

**Guard test:** `ignores a stale response that resolves after a newer request
for a different toggle state` in `PhotoUseConsentPage.test.tsx` — two requests
in flight, the older one resolved last; asserts the newer request's roster
wins. Verified to fail against the pre-fix component (confirmed by stashing
the fix and re-running) and pass against it.

### AUTH-4 — INFORMATIONAL — Unbounded roster query, flagged not fixed

**What:** `ConsentService.roster()` has no `LIMIT`/pagination and materializes
every matching member with `result.all()`; `GET /users/consents/photo-use`
passes that straight through. Checklist dimension 6 names "no `all()` over an
org-wide table" as a pattern to catch.

**Where:** `backend/app/services/consent_service.py:118-143`.

**Why flagged, not fixed:** this is not a defect unique to the new code —
grepping `select(User` across `app/` finds **255+ other call sites** with the
identical unbounded shape (`/officers`, the base `/users` list, and most other
whole-department rosters). The application's own scale assumption throughout
is a single fire department's membership (tens to a few hundred rows), not an
org-wide table that grows without bound the way `audit_logs` or
`message_history` do — dimension 6's concern is real for those, and this
codebase already bounds or paginates them. Adding a `LIMIT` to this one new
endpoint while its 255 siblings stay unbounded would be an arbitrary,
inconsistent fix, not a security improvement. Recorded here for awareness
rather than actioned as a drive-by; a genuine fix would be an app-wide
pagination pass, out of scope for this iteration.

**Completion gate (pass 2, after AUTH-3):** flake8/black/isort clean on `app/
tests/ alembic/`; `validate_migrations.py --strict` passed (381 revisions,
single head); scoped backend tests (`-k "oauth or auth_service or mfa or
consent"`) 70 passed, 1 skipped (pre-existing, missing optional dependency);
`tsc --noEmit` 0 errors; `eslint .` 0 errors (1 file, 0 warnings);
`PhotoUseConsentPage.test.tsx` 7/7 passed (1 new).

---

## Pass 1 (2026-08-25)

**Backend:** `app/api/v1/endpoints/auth.py` (1405 L, 26 endpoints),
`app/services/auth_service.py` (970 L), `app/services/mfa_service.py` (121 L),
`app/services/oauth_service.py` (327 L), `app/services/consent_service.py`
(84 L), `app/models/consent.py`
**Frontend:** `stores/authStore.ts`, `services/apiClient.ts`,
`utils/createApiClient.ts`, login/MFA pages
**Migrations:** `20260801_0019_add_user_consents.py` (consent table)

---

## Scope

This feature already carries two prior application-review passes
(`docs/app-review/auth-session.md`, 2026-08-05 and 2026-08-08) that did a
six-lens sweep and a full 25/26-endpoint auth-dependency enumeration. This
iteration does **not** re-derive that work. It re-verifies a sample of the
prior claims against current code (auth-dependency spot-check across 5 routes,
both public and private) and applies full weight to the checklist dimensions
those passes covered lightly: tenant isolation, injection/untrusted output,
data exposure, abuse resistance, and schema/migration integrity. All 5 backend
files and the frontend auth surfaces were read in full or by targeted grep;
nothing was sampled without a stated reason.

`git log` for these files could not be trusted to date changes since
2026-08-08 (history for this path appears to have been squashed/rewritten —
the earliest dateable commit touching these files is 2026-08-21). `CHANGELOG.md`
was used as the dating source of record instead and cross-checked against the
current code for every claim below.

## Route inventory

Full enumeration (26 routes, not the 25 the prior pass recorded —
`GET /captcha-config` was omitted from that count; see AUTH-2).

| Method | Path                        | Auth dependency                 | Permission       | Org-scoped | Notes                                                  |
| ------ | --------------------------- | ------------------------------- | ---------------- | ---------- | ------------------------------------------------------ |
| GET    | `/branding`                 | none                            | n/a              | n/a        | public, no secrets exposed                             |
| GET    | `/captcha-config`           | none                            | n/a              | n/a        | public, site key only (not the secret)                 |
| GET    | `/oauth-config`             | none                            | n/a              | n/a        | public, provider-enabled flags only                    |
| GET    | `/oauth/google`             | none                            | n/a              | n/a        | public, initiates redirect                             |
| GET    | `/oauth/google/callback`    | none                            | n/a              | n/a        | public, state verified via `compare_digest`            |
| GET    | `/oauth/microsoft`          | none                            | n/a              | n/a        | public, initiates redirect                             |
| GET    | `/oauth/microsoft/callback` | none                            | n/a              | n/a        | public, state verified via `compare_digest`            |
| POST   | `/register`                 | none                            | n/a              | n/a        | rate-limited; 403 unless `REGISTRATION_ENABLED`        |
| POST   | `/login`                    | none                            | n/a              | n/a        | rate-limited + `enforce_suspicious_ip`                 |
| POST   | `/mfa/login`                | none (pre-auth MFA token)       | n/a              | n/a        | rate-limited; token-scoped                             |
| POST   | `/mfa/setup`                | `get_current_active_user`       | self             | self       | —                                                      |
| POST   | `/mfa/verify-setup`         | `get_current_active_user`       | self             | self       | rate-limited                                           |
| POST   | `/mfa/disable`              | `get_current_active_user`       | self             | self       | rate-limited                                           |
| GET    | `/mfa/status`               | `get_current_active_user`       | self             | self       | —                                                      |
| POST   | `/mfa/recovery-codes`       | `get_current_active_user`       | self             | self       | rate-limited                                           |
| GET    | `/mfa/policy`               | `get_current_active_user`       | self             | org        | —                                                      |
| PUT    | `/mfa/policy`               | `get_current_active_user`       | admin permission | org        | —                                                      |
| POST   | `/refresh`                  | none (refresh token via cookie) | n/a              | n/a        | rate-limited; org-active check (`auth_service.py:382`) |
| POST   | `/logout`                   | `get_current_user`              | self             | self       | —                                                      |
| GET    | `/me`                       | `get_current_active_user`       | self             | self       | —                                                      |
| GET    | `/session-settings`         | `get_current_user`              | self             | self       | —                                                      |
| POST   | `/change-password`          | `get_current_active_user`       | self             | self       | rate-limited                                           |
| GET    | `/check`                    | none (cheap probe)              | n/a              | n/a        | intentionally minimal, no full permission build        |
| POST   | `/forgot-password`          | none                            | n/a              | n/a        | rate-limited; enumeration-safe                         |
| POST   | `/reset-password`           | none                            | n/a              | n/a        | rate-limited; SHA-256 token lookup                     |
| GET    | `/validate-reset-token`     | none                            | n/a              | n/a        | rate-limited; returns `{"valid": bool}` only           |

11 public / 15 private. Every private route carries `get_current_user` or
`get_current_active_user`; both admin-scoped routes (`/mfa/policy` PUT, and
admin MFA reset / consent listing which live in `users.py`, out of this
feature's file scope) additionally org-scope the target by id.

## Verified good ✅

- **Auth-dependency spot-check (5 routes sampled, public and private) still
  matches the prior enumeration.** `/branding` and `/login` remain
  unauthenticated by design; `/me`, `/change-password`, `/session-settings`
  all carry `get_current_user`/`get_current_active_user`. No drift.
- **Tenant isolation on consent data.** `UserConsent` (`models/consent.py:41`)
  has `organization_id` and `user_id` both `NOT NULL` with `ondelete="CASCADE"`
  — matches its migration exactly, no drift. The admin-facing consent listing
  and admin MFA reset (in `users.py`, adjacent to this feature) org-scope the
  by-id target before acting, and MFA reset enforces a privilege ceiling and
  blocks self-reset. (Read as supporting context; full review of `users.py`
  itself is feature 07 in the rotation, not re-litigated here.)
- **No injection surface.** Zero raw SQL and zero `.like()`/`.ilike()` calls in
  any of the 5 in-scope files (grep-confirmed) — Pitfall #25 does not apply to
  this feature. OAuth state and TOTP/recovery-code comparisons use
  `secrets.compare_digest`; redirect targets are server config, never
  client-supplied — no open-redirect vector. `reason` codes passed through
  `_oauth_fail_redirect` are a fixed short enum, never raw user input.
- **No unbounded in-memory caches** in these 5 files (Pitfall #9 n/a here —
  the actual rate-limit/suspicious-IP trackers live in `security_middleware.py`
  / `suspicious_ip.py`, out of this feature's scope and already audited via the
  `get_client_ip` sweep in the prior pass).
- **Data exposure remains clean.** `validate_reset_token` returns
  `{"valid": bool}` only; tokens are never placed in JSON bodies (httpOnly
  cookies only, per `_set_auth_cookies`); the reset link uses a URL fragment,
  not a query param, to keep the token out of Referer headers and access logs.
  Frontend `authStore.ts` writes only a `has_session` boolean flag to
  `localStorage` — grep confirms no token writes, and the only reads of the
  legacy token keys are one-time cleanup code that removes them. No
  `window.confirm`/`alert`/`prompt` anywhere in the auth frontend surfaces.
- **Rate limiting still covers every credential-guessing path**: login, MFA
  login, MFA verify-setup/disable/recovery-codes, refresh, change-password,
  register, and all three reset routes each carry a `rate_limit_*` dependency.
- **Schema/migration integrity.** `consent.py`'s FKs are `ondelete="CASCADE"`
  with `nullable=False` — not a `SET NULL` case, so Pitfall #2 doesn't apply;
  the migration matches the model column-for-column, including the
  `(user_id, consent_type)` unique index. No drift.

## Findings

### AUTH-1 — MED — OAuth login skipped the organization-active check — ✅ FIXED

**What:** `oauth_service._link_existing_user` scoped its org lookup to the
earliest-created organization with no `active` filter, and — when that lookup
came back empty — dropped the org filter from the user query entirely instead
of failing closed.

**Where:** `app/services/oauth_service.py:50` (pre-fix).

**Failure scenario:** The 2026-08-12 hardening pass added
`Organization.active.is_(True)` to the password-login path
(`auth_service.authenticate_user`), specifically so members of a deactivated
organization can no longer sign in with a password. The OAuth path was never
given the same filter — tracked as an open MED item in
`docs/KNOWN_LIMITATIONS.md` since that date. A member of a deactivated
organization whose account is Google- or Microsoft-linked could still sign in
via OAuth, bypassing the exact control password login now enforces. Worse: had
the org lookup ever come back empty for any reason (not just deactivation —
e.g. an empty `organizations` table in a fresh/test environment), the code
dropped the `organization_id` filter from the user query altogether, so the
email-match query would have matched a user in **any** organization — a
tenant-isolation gap (dimension 3), not just an availability one.

**Impact:** Deactivating an organization is expected to lock out all of its
members; OAuth-linked members retained access. In the empty-org-table edge
case, the missing filter could also have crossed a tenant boundary.

**Fix:** The org lookup now carries `.where(Organization.active.is_(True))`,
and an empty result returns `(None, "no_account")` immediately — the same
indistinguishable error password login's candidate-empty case produces,
preserving the enumeration-avoidance convention this file already follows
elsewhere. This removes both the deactivated-org bypass and the fail-open path
on an empty lookup. Mirrors `auth_service.authenticate_user`'s existing,
already-tested pattern exactly, rather than inventing a new one.

**Guard test:** `test_resolve_user_no_active_organization` in
`backend/tests/test_oauth_service.py` — asserts the org query text contains
`organizations.active IS true`, and that a missing active org returns
`(None, "no_account")` without ever issuing the user-lookup query (so a
regression back to the fail-open path fails this test rather than merely
returning a wrong-but-harmless result).

### AUTH-2 — NIT — Prior review's route count and M2 claim had drifted from current code — ✅ FIXED (docs only)

**What:** `docs/app-review/auth-session.md` (2026-08-08 pass) stated 25
endpoints (10 public / 15 private) and listed the 2026-08-08 refresh-grace-
window fix as still intact. Neither matches current code: there are 26 routes
(`GET /captcha-config` was omitted from the original count — it is correctly
public, exposing only a CAPTCHA site key, so this was a documentation gap, not
a security bug), and the refresh grace window was intentionally removed on
2026-08-12 (CHANGELOG, same date) because it was itself a replay-window
vulnerability — a stale token now revokes the whole session immediately, with
no grace fallback.

**Where:** `docs/app-review/auth-session.md`.

**Failure scenario:** n/a — documentation accuracy only. Left uncorrected, a
future reviewer re-verifying "M2 fix intact" against current code would either
report a false claim as re-confirmed, or waste time reconciling a described
mechanism that no longer exists.

**Fix:** Added a "Pass 3" correction section to `auth-session.md` recording
both drifts and pointing to this file for AUTH-1.

## Schema & migration notes

`consent.py` / `20260801_0019_add_user_consents.py` — no drift, both FKs
`ondelete="CASCADE"` + `nullable=False` (not a `SET NULL` case), unique index
matches. No other migration touches this feature's tables since the last pass.

## Guard tests added

- `test_resolve_user_no_active_organization` (`test_oauth_service.py`) — fails
  if the OAuth org lookup ever drops the `active` filter or stops failing
  closed on an empty result.

## Completion gate

| Check                                         | Result                                  |
| --------------------------------------------- | --------------------------------------- |
| `flake8 app/ tests/ alembic/`                 | ✅ 0 violations                         |
| `black --check app/ tests/ alembic/`          | ✅ unchanged                            |
| `isort --check-only app/ tests/ alembic/`     | ✅ clean                                |
| `validate_migrations.py --strict`             | ✅ single head                          |
| backend tests (scoped: oauth/auth/active-org) | ✅ 22 passed                            |
| `tsc --noEmit`                                | ✅ 0 errors (no frontend files touched) |
| `eslint .`                                    | n/a — no frontend files touched         |
