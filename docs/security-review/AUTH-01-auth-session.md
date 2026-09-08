# Security Review — Auth & Session Lifecycle

**Prefix:** `AUTH` · **Iteration:** 01 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3), 2026-09-08 (pass 4) · **PR:** #1804 (pass 1), #1929 (pass 2), #2133 (pass 3), #2389 (pass 4)

Passes are recorded in this one file rather than a new `AUTH<n>-01-*.md` per
lap, matching what passes 2 and 3 already did here. Newest pass first.

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

#### AUTH-15 — MED — The HIPAA maximum-password-age control is enforced only in the browser — 🚩 FLAGGED

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
