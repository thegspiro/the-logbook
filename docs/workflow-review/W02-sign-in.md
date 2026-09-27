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

### W02-5 — LOW — The sign-in screen's links are too small to tap on a phone — OPEN

At 390px, "Forgot your password?" is 16px tall, and Privacy and Terms are 14px. The inputs are 42px, just under the 44px minimum. Left for the W79 phone pass.

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
| 6. On a phone           | ✅ no overflow; W02-5 open                                           |
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
