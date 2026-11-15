# Workflow Review — W02 Sign In, Sign Out, Session Timeout, Lockout

**Driven:** 2026-09-27 · **As:** `member`, `member2`, anonymous visitor · **Viewports:** 1280×900, 390×844
**Commit:** `c199ae4` plus this run's fixes (each re-driven) · **Database:** continued from the W01 re-seed; no reset

---

## What was driven

1. Signed out, opened `/events?view=calendar` and was sent to `/login`. Checked the form's labels and autocomplete hints, then signed in as `member` with Enter.
2. Signed out through the header's Logout and its confirmation. Checked cookies and local storage, pressed Back, and replayed the old access-token cookie against `GET /auth/me`.
3. Pressed Sign in with both fields empty; a wrong password for `member`; an unknown username. Sign-ins were spaced 13 seconds apart to stay under the per-address limit.
4. Idle timeout with Playwright's fake clock: 14 minutes idle, then 70 more seconds; and again with a keypress during the warning.
5. Two browsers signed in as `member`; signed out in one and reloaded the other.
6. Five wrong passwords for `member2`, paced, then the correct one.
7. Six rapid attempts from one address, to trip the per-address limit.
8. `/login` at 390×844: overflow, tap-target sizes, and Tab order from the top of the page.

Not driven: MFA sign-in (W04 enrols MFA first), Google and Microsoft sign-in (not configured in the review install), the in-memory rate limiter used when Redis is down, and the suspicious-IP block (it needs 50 failures an hour).

## Held up ✅

- **Signed-out access:** a visitor to a protected page is sent to `/login`, and after sign-in returns to that page (its query too, after W02-1).
- **Form:** labelled inputs with `username` / `current-password` autocomplete hints. An empty submit is stopped by native `required` validation and sends nothing.
- **Sign-out:**
  - asks for confirmation first;
  - clears every auth cookie;
  - Back stays on the sign-in screen;
  - the old access token is refused by the server (`401`), so the session is revoked, not merely forgotten by the browser.
- **Sign-out is per device:** signing out in one browser left the other signed in (`/auth/me` still `200` after a reload).
- **No account enumeration:** a wrong password and an unknown username get the same message, "Incorrect username or password".
- **Idle timeout (HIPAA §164.312(a)(2)(iii)):**
  - at 14 minutes idle a warning says the session ends in 60 seconds;
  - at 15 minutes the member is signed out, cookies cleared, and the sign-in screen says "Your session has expired due to inactivity";
  - a keypress during the warning keeps the session.
- **Server-side idle limit:** the server independently ends a session after 15 idle minutes (`auth_service.py`, `HIPAA_SESSION_TIMEOUT_MINUTES`). The seeded sessions were dead by the time this run started.
- **Account lockout:** after five failures the correct password is refused and `locked_until` is set 15 minutes out. An admin's Reset Password clears it (read from code, `users.py` `admin_reset_password`).
- **Per-address limit:** the sixth attempt in a minute is refused with `429` and `Retry-After: 60`, which is accurate for the Redis-backed limiter, a 60-second sliding window.
- **Phone:** no sideways scroll at 390px. Tab order runs skip link → username → password → Forgot your password? → Sign in → Privacy → Terms.

## Findings

### W02-1 — LOW — Signing in dropped the query and anchor of the page the member was sent from — ✅ FIXED

**Did:** opened `/events?view=calendar#today` while signed out, then signed in.
**Saw:** landed on `/events`, in its default view.
**Where:** `LoginPage.tsx` built the redirect from `location.state.from.pathname` only, in two places (password sign-in and after MFA). ProtectedRoute saves the whole location.
**Fix:** a single `utils/postLoginRedirect.ts` returns the pathname with its query and anchor, keeping the open-redirect guard: a single leading `/`, never `//host` or a full URL. Re-driven: `/events?view=calendar#today`. Test: `postLoginRedirect.test.ts`.

### W02-2 — MED — The sign-in screen ignored the server's Retry-After — ✅ FIXED

**Did:** six sign-in attempts inside a minute.
**Saw:** the server answered `429` with `Retry-After: 60`, but the screen said "Please wait 4 seconds before trying again". A member who waits four seconds and tries again is refused again. The limiter is a sliding window, so each refused attempt keeps them inside it.
**Where:** `authStore.login` honours `appError.details.retryAfter`, but `toAppError` (`utils/errorHandling.ts`) built `details` from the response body only and never read the header. That branch of the store could never run.
**Fix:** `toAppError` now copies a numeric 429 `Retry-After` into `details.retryAfter`, next to any body details. Re-driven: "Please wait 60 seconds". Tests: `errorHandling.test.ts`, `authStore.test.ts`.

### W02-3 — HIGH — Password sign-in, failure, lockout and sign-out are never audited — FLAGGED

**Did:** dozens of sign-ins, eleven failures and one lockout on the review install, then read `audit_logs`.
**Saw:** only `user_created`, `organization_settings_updated` and the two onboarding events.
**Where:** read from code. `POST /auth/login` and `POST /auth/logout` (`auth.py`) and `auth_service.authenticate_user` call no `log_audit_event`, while OAuth sign-in, MFA changes and reset requests do. Nothing writes `AUDIT_EVENT_LOGIN_FAILED`, which `security_monitoring.get_security_status` counts, so its "failed logins in the last hour" is always 0.
**Why not fixed:** it needs decisions on which organization owns a failure against an unknown username, and on the cost of an audit-chain write per failed attempt under a credential-stuffing burst. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W02-4 — MED — A locked account is indistinguishable from a wrong password, to the member and to the administrator — FLAGGED

**Did:** locked `member2` (five failures), then entered the correct password.
**Saw:** "Incorrect username or password", plus the client's own "Please wait 3 seconds". The lock lasts 15 minutes. No administrator screen shows an account as locked; no schema field or frontend code exposes `locked_until`.
**Where:** `ACCOUNT_LOCKOUT_REVEAL=False` (the default, SEC-14) is deliberate. The seconds-long countdown (`authStore.ts`, `LOGIN_BACKOFF_BASE_MS`) and the missing admin visibility are what turn it into a support call nobody can diagnose.
**Why not fixed:** copy that hints at a possible lock, an admin lock indicator with an Unlock action, or recommending `ACCOUNT_LOCKOUT_REVEAL=True` are product and security calls. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W02-5 — LOW — The sign-in screen's links are too small to tap on a phone — ✅ FIXED (W79-1)

At 390px, "Forgot your password?" is 16px tall, and Privacy and Terms are 14px. The inputs are 42px, just under the 44px minimum. Fixed in the W79 phone pass (W79-1). Measured again on 2026-11-14 at 390px: the fields, Forgot your password?, Privacy and Terms are all 44px.

### W02-6 — NIT — The lockout recovery script documented a 30-minute lock — ✅ FIXED

`backend/scripts/reset_login_lockout.py` said "5 failed attempts -> 30 min". The thresholds are configurable and default to 5 attempts and 15 minutes. The docstring now names the two settings and their defaults.

## Harness

The server ends a session after 15 idle minutes, so every session the seed saved was dead by this run, and the next run will be the same. `wr.as(role)` now tries the saved session, refreshes it if only the access token has lapsed, and otherwise signs in again. The driver spaces its own sign-ins 13 seconds apart. README and command updated, including clearing the Redis rate-limit keys and account lock a test creates on purpose. This run cleared its own, and unlocked `member2`.

## Checklist

| Section                 | Result                                                               |
| ----------------------- | -------------------------------------------------------------------- |
| 1. The job gets done    | ✅ sign in, out, return-to-page (after W02-1)                        |
| 2. The right people     | ✅ revoked token refused; sessions per device; no enumeration        |
| 3. Wrong input, failure | ✅ after W02-2; W02-4 flagged                                        |
| 4. Browser signals      | ✅ only the expected 401s and the deliberate 429                     |
| 5. Coming back to it    | ✅ Back after sign-out stays out; deep links return with their query |
| 6. On a phone           | ✅ no overflow; W02-5 fixed (W79-1)                                  |
| 7. Everyone can use it  | ✅ labels, autocomplete, Tab order, errors in `role=alert`           |
| 8. What happens around  | W02-3 flagged (no audit trail for password sign-in)                  |

## Completion gate

| Check                    | Result                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                        |
| npm run lint             | ✅ clean                                                                                        |
| flake8 (changed files)   | ✅ `scripts/reset_login_lockout.py`                                                             |
| black --check            | ✅                                                                                              |
| frontend tests (touched) | ✅ `postLoginRedirect`, `errorHandling`, `authStore`, `LoginPage` — the new cases failed before |
| backend tests (touched)  | n/a — backend change is a docstring                                                             |

---

## Second pass — sign-in as it stands after the November security work (2026-11-05)

**Driven:** 2026-11-05 · **As:** `member`, `member2`, `admin`, anonymous visitor · **Viewports:** 1280×900, 390×844
**Commit:** `905bd6c` plus this pass's fixes (each re-driven) · **Database:** re-seeded by `seed.mjs` on the W01 third pass's install; no reset

Every activity in the rotation was ✅, so this pass took the activity after
onboarding again. Since the first pass, sign-in gained audit rows (W02-3), an
administrator's Unlock (W02-4), larger touch targets (W02-5, via W79-1) and,
on 2026-11-03, per-account sign-in limits (5 a minute per account at an
address, 30 a minute per address). MFA sign-in, never driven before, was
driven this time.

### What was driven

1. Opened `/events?view=calendar#today` signed out, then signed in with Enter.
2. Signed out through the header's Logout, then checked cookies, local storage, Back, and the old access token against `GET /auth/me`.
3. Submitted an empty form, then a wrong password for `member`, then an unknown username. Read the audit rows each attempt wrote.
4. Locked `member2` with five wrong passwords, then entered the right one. Used the administrator's Unlock under Members, then reloaded. Signed in as `member2` again.
5. Idle timeout with Playwright's fake clock: 14 minutes idle, then 70 more seconds.
6. Enrolled TOTP for `member2` through the API. Signed in with a wrong code, then a right one, then a right one typed `123 456`. Disabled MFA again afterwards.
7. At 390×844: overflow, tap-target sizes and Tab order on `/login`. Signed in, then signed out through the More menu.

Not driven: sign-out on one device leaving another signed in (unchanged
since the first pass), Google and Microsoft sign-in (not configured), and
the suspicious-IP block.

### Held up ✅

- **Deep links survive sign-in,** with their query and anchor (W02-1): landed on `/events?view=calendar#today`. MFA sign-in returned to `/members` the same way.
- **Sign-out:** confirms first, clears every auth cookie, and Back stays on the sign-in screen. The old access token gets `401` from the server.
- **No account enumeration:** a wrong password and an unknown name both get "Incorrect username or password (Error code: LB-AUTH-006)".
- **The audit trail (W02-3, resolved):** each step wrote its row:
  - `login` with `method` `password` or `password+totp`, and `logout`;
  - `login_failed` with a reason: `invalid_password`, `unknown_user`, `account_locked` or `invalid_second_factor`;
  - `account_locked` after the fifth failure, and `account_unlocked` naming the administrator and the member.

  A failure against an unknown name is written with no member and no organization, as designed.

- **A lock an administrator can see and lift (W02-4, resolved):**
  - Members shows "Sign-in locked until 10:20 PM" under the member's status, with an **Unlock** button;
  - Unlock clears the lock, and it stays cleared after a reload;
  - the member still sees only "Incorrect username or password", by design (`ACCOUNT_LOCKOUT_REVEAL` off).
- **The server's limit is per account:** the sixth attempt for one name in a minute got `429`, and the screen counted down "Wait 59s" from `Retry-After`.
- **Idle timeout:** at 14 minutes a toast warns that the session ends in 60 seconds. At 15 the member is signed out with no cookies left, and the sign-in screen says "You were signed out after a period of inactivity. Sign in again."
- **MFA sign-in:** the second step labels its field "Authenticator code" (`one-time-code`, numeric keypad) and offers a recovery code and Back. A wrong code gets "Invalid verification code".
- **Phone `/login` (W02-5, resolved):** no sideways scroll. The fields, Forgot your password?, Sign in, Privacy and Terms are all 44px tall. Tab order is unchanged.

### W02-7 — MED — A wrong password under eight characters was refused as a validation error — ✅ FIXED

**Did:** entered `wrong-1` (seven characters) for `member2`, five times.
**Saw:**

- each attempt answered `422`, shown as "password: Value is too short. (Error code: LB-VAL-001)", where every other wrong password gets "Incorrect username or password";
- the five attempts never reached the password check, so none counted toward the lockout;
- the sixth, with the right password, was refused `429` by the rate limit, which had counted them.

**Where:** `UserLogin.password` (`backend/app/schemas/auth.py`) carried `min_length=8`.

- The message disclosed part of the password policy to anyone guessing.
- A member whose password is shorter than eight characters could not sign in at all. `PASSWORD_MIN_LENGTH` is configurable, and passwords set under a lower policy remain valid.
- `PasswordChange.current_password`, which also verifies a stored password, already had no floor.

**Fix:** `min_length=1`; the 128-character ceiling (the Argon2 cost guard) stays. Re-driven: `wrong-1` now gets `401` "Incorrect username or password" and writes a `login_failed` row. Test: `tests/test_sign_in_short_password.py`, whose three short-password cases failed before the fix.
**Behaviour change:** a short wrong password now counts toward the five-failure lockout, like any other wrong password.

### W02-8 — MED — The sign-in screen's own back-off counts every name tried in the tab — ✅ FIXED (owner decision 2026-11-05)

**Did:** made 11 failed attempts in one tab across `member` and `member2`, then typed `review_member` in the same tab.
**Saw:** the Sign in button read "Wait 60s" and was disabled for `member`, who had made no recent attempt. `sessionStorage.login_lockout` held `{"loginAttempts":11,...}`.
**Where:** `authStore.login` (`frontend/src/stores/authStore.ts`) keeps one counter per tab. From the fifth failure it holds the button for `2s × 2^(n−5)`, capped at five minutes, whatever username is typed. The counter resets only on a successful sign-in.
**Why it matters:** on a station computer, one member's mistyped passwords hold the next member at the sign-in screen for up to five minutes. The owner's 2026-11-01 decision moved the server to per-account limits so that "one station's members don't block each other". The client-side counter still does.
**Decision:** flagged on the first write-up. The owner chose per account (2026-11-05).
**Fix:**

- `authStore` keeps `loginLockouts`, one entry per account. The key is the name as typed, trimmed and lower-cased, the way the server folds it.
- At most 20 accounts are kept per tab.
- A successful sign-in clears only that account.
- The sign-in page shows the wait for the name in the field (`lockedUntilFor`).
- The `sessionStorage` shape is now `{ accounts: { … } }`. The old per-tab value names nobody, so it is dropped on load.

Re-driven: after five failures for `review_member2` the button read "Wait 2s"; changing the name to `review_member` in the same tab gave an enabled Sign in, and `member` signed in.
Tests: `authStore.test.ts` ("does not hold another account for one account's failures", "counts a name the same however it is cased or padded") and `LoginPage.test.tsx` ("holds only the account that failed"); both failed against the per-tab code. The existing lockout tests changed with the state they read (`loginAttempts` / `lockedUntil` became `loginLockouts`).

### W02-9 — LOW — The account and sign-out controls at the foot of the phone menu were 36px tall — ✅ FIXED

**Did:** at 390×844, opened More and measured every control.
**Saw:** Notifications, Evaluations, My Account, My ID Card, Theme, High contrast and Logout were 36px tall. The menu's entries above them were 44px.
**Where:** `TopNavigation.tsx`, the footer group of `#mobile-menu`: `px-3 py-2` with no touch minimum.
**Fix:** `touch:min-h-11` on all seven controls. Re-driven: nothing in the open menu is under 44px. Test: `TopNavigation.test.tsx`, "gives the account and sign-out controls at its foot a touch-size target", which failed before the fix.

### W02-10 — LOW — A correct authenticator code typed as the app shows it was refused — ✅ FIXED

**Did:** at the second step, typed the current code as `123 456`, the way authenticator apps group it.
**Saw:** `422`, shown as "code: Value is too long. (Error code: LB-VAL-001)".
**Where:** `MFALogin.code` takes exactly six characters, and `LoginPage.handleMfaSubmit` sent the field trimmed but with its inner space.
**Fix:** the page drops whitespace from an authenticator code before sending it. Recovery codes are sent as typed, as before. Re-driven: `123 456` signs in. Test: `LoginPage.test.tsx`, "sends an authenticator code typed with a space as six digits", which failed before the fix.

### W02-11 — NIT — "Logout" beside "Sign in" — FLAGGED

The header, the More menu and the confirmation dialog say "Logout" (title "Confirm Logout", button "Logout"). The idle warning says "stay logged in". The sign-in screen, its inactivity notice and the password-change notice in My Updates say "Sign in" and "signed out". Settling on one pair, and "Log out" as a verb rather than the noun "Logout", is a wording call. The label is also a selector in `e2e/auth.spec.ts`, `e2e/mobile-landscape.spec.ts` and this harness, so the rename would go with those. Left as it is.

### W02-12 — LOW — Administrator actions on a member were audited without an IP or browser — ✅ FIXED (2026-11-08)

Read from code after the pass. Of the 19 audit rows `app/api/v1/endpoints/users.py` writes, 15 left `ip_address` and `user_agent` empty: member creation, role assignment and removal, viewing a member, contact and profile edits, deletes, the password, MFA and passkey resets, unlocks, and photo changes. The other four (data export, anonymize, visibility, consent) passed the IP but not the browser.

**Fix:** a `_request_origin(request)` helper returns both, and every audit call in the file spreads it. Eleven handlers that had no `request` parameter gained a keyword-only one, which FastAPI supplies; the HTTP API is unchanged. `test_member_admin_audit_origin.py` sweeps the file so the next audit call carries the origin too, and checks the unlock row's columns against the database. Tests that call these handlers directly pass `tests/fake_request.py`'s request.

### Seen in passing

- **Administrator actions on a member** (`users.py`): `account_unlocked`, like the password, MFA and passkey resets beside it, is audited with no IP address or user agent. Only the data-export, anonymize, visibility and consent rows pass `get_client_ip`. Added to the leads; fixed 2026-11-08 as W02-12 below.
- After an Unlock, the member's own attempts still count in the per-account rate window. A member who tried several times just before calling may wait up to a minute more. Expected, but the Unlock gives no hint of it.

### Harness

This pass cleared the rate-limit and `suspicious_ip:*` keys it created, reset
`failed_login_attempts` and `locked_until` for `member` and `member2`, and
turned `member2`'s MFA back off, so `wr.as("member2")` still signs in with a
password alone.

### Checklist

| Section                 | Result                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ sign in, out, MFA, deep-link return; W02-10 fixed                                     |
| 2. The right people     | ✅ revoked token refused; no enumeration; Unlock gated to `members.manage`               |
| 3. Wrong input, failure | ✅ after W02-7 and W02-8                                                                 |
| 4. Browser signals      | ✅ only the expected 401s, the deliberate 429s, and the 422s that W02-7 and W02-10 fixed |
| 5. Coming back to it    | ✅ Back after sign-out stays out; lock state survives a reload                           |
| 6. On a phone           | ✅ `/login` clean; W02-9 fixed                                                           |
| 7. Everyone can use it  | ✅ labels, autocomplete, numeric keypad for the code, errors in `role=alert`             |
| 8. What happens around  | ✅ every step audited (W02-3 resolved); IP on admin rows fixed later (W02-12)            |

### Completion gate

| Check                  | Result                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm run typecheck      | ✅ clean                                                                                                                                               |
| npm run lint           | ✅ clean (run with an 8 GB heap, per the W77 tooling lead)                                                                                             |
| flake8 / black / isort | ✅ `app/schemas/auth.py`, `tests/test_sign_in_short_password.py`                                                                                       |
| backend tests          | ✅ 188 passed: the new test and the sign-in, audit, per-account limit, MFA and security-alert suites; the new cases failed before the fix              |
| frontend tests         | ✅ 202 passed across 19 files: `LoginPage`, `components/layout/*`, `authStore` and `touchTargetIntegrity`; the two new cases failed before their fixes |
