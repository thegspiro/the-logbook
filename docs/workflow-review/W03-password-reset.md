# Workflow Review — W03 Forgot Password and Reset by Link

**Driven:** 2026-09-28 · **As:** signed-out visitor, then `member2` · **Viewports:** 1280×900, 390×844
**Commit:** `ae27e2e` plus this run's fixes (each re-driven) · **Database:** continued; no reset

---

## What was driven

1. From the sign-in screen, "Forgot your password?", entering `member`'s address. Read the response, the page, the backend log and the stored token.
2. Reset links without a token and with a bad token.
3. A real link. Tokens are stored only as SHA-256 hashes, and email is off in the review install, so I minted a random token and wrote its hash and a 30-minute expiry to `member2` in the review database. The page and endpoints are the real ones; only the email delivery was bypassed.
4. On that link, a password with an ascending run (`Abcdef123!xyz`), then a valid one; reloading and reopening links along the way.
5. After the reset: signing in with the new password and the old one, and reopening the used link.
6. Both pages at 390×844.

Not driven: email delivery (email is off here; see W03-6) and a CAPTCHA-enabled install. Google or Microsoft sign-in was not configured, so their forgot-password answer was checked by test, not in the browser.

## Held up ✅

- The request page has a labelled email field (`required`, `autocomplete=email`) and explains that it will not reveal whether an account exists.
- The server answers the same way for every address, and records every request in the audit log (`auth.password_reset_requested`).
- **The reset link carries its token in the URL fragment**, so the token never reaches the server in a Referer header or an access log. It is stored only as a hash and expires after 30 minutes (`RESET_TOKEN_EXPIRY_MINUTES`).
- A missing, wrong or already-used token is refused with a clear page.
- **A successful reset**, confirmed in the browser:
  - the new password signs in;
  - the old one gets `401`;
  - the used link is dead;
  - after three seconds the page returns to sign-in.
- **Read from code**, a reset also records password history, clears an account lock, and ends every session the member had (`auth_service.reset_password_with_token`).
- No sideways scroll on either page at 390px.

## Findings

### W03-1 — LOW — The page said the link lasts an hour; it lasts 30 minutes — ✅ FIXED

**Saw:** "The link will expire in 1 hour" on the confirmation page. The stored expiry was 30 minutes after issue, and the email template says 30 minutes.
**Where:** `ForgotPasswordPage.tsx` hard-coded the hour. The constant is `RESET_TOKEN_EXPIRY_MINUTES = 30` (`auth_service.py`).
**Fix:** `POST /auth/forgot-password` returns `expires_in_minutes`. It's the same value for every address, so it reveals nothing about which accounts exist. The page shows it, and says nothing about expiry if an older backend omits it. Tests: `tests/test_forgot_password_expiry.py`, `ForgotPasswordPage.test.tsx`.

### W03-2 — MED — "Check Your Email" covered the server saying no link was sent — ✅ FIXED

**Saw (W01-11):** with the department on an outside sign-in provider, the server answered "This organization uses … Please reset your password through …". The page discarded that answer and showed "Check Your Email".
**Where:** `ForgotPasswordPage.tsx` ignored the response body.
**Fix:** the page keeps the answer. When the server names an `auth_provider`, the page shows "No Reset Link Was Sent" with the server's own message. Test: `ForgotPasswordPage.test.tsx`.

### W03-3 — MED — A rate-limited reset link was reported as invalid — ✅ FIXED

**Did:** opened a good link, reloaded it once.
**Saw:** `429` from `validate-reset-token`, and the page's heading "Invalid Reset Link", which tells the member to discard a link that works. On submit, a 429 showed only "Too many requests. Please try again later."
**Where:** `ResetPasswordPage.tsx` sent every failure to the invalid-link state. The cause of the 429s is W03-7.
**Fix:** a 429 on arrival shows "Please Wait a Few Minutes", with the wait taken from `Retry-After` (W02-2). It doesn't claim the link is still unused, because the page can't know that. A 429 on submit keeps the form and names the wait. Test: `ResetPasswordPage.test.tsx`.

### W03-4 — MED — Both password checklists said "8 characters" and lacked two of the server's rules — ✅ FIXED

**Did:** entered `Abcdef123!xyz` on the reset page.
**Saw:** every listed rule ticked, including "At least 8 characters" although 12 are required. Submitting was refused ("cannot contain sequential characters"), which spent one of the three requests W03-7 allows.
**Where:** `ResetPasswordPage.tsx` and `UserSettingsPage.tsx` each typed their own list. `validatePasswordStrength` (`utils/passwordValidation.ts`) checked five of the server's seven rules. This is the same gap W01-2 closed on the onboarding admin step.
**Fix:** `validatePasswordStrength` checks the no-runs and no-repeats rules too, using the helpers W01 added. A single `PASSWORD_CHECKLIST` labels every rule, with the length taken from the real minimum, and both pages render it. Re-driven: seven rules listed, and the button stays disabled for a password with a run.
**Test changed:** `passwordValidation.test.ts` had a test asserting the checklist _doesn't_ check runs, which is the gap being closed. It now asserts the reverse, and that the common-password list stays with `validatePassword`. New: `ResetPasswordPage.test.tsx`.

### W03-5 — LOW — A second link opened in the same tab kept the first link's error — ✅ FIXED

**Did:** opened a bad link, then a good one, in the same tab.
**Saw:** the password form, under the first link's "invalid or has expired" message.
**Fix:** each validation clears the previous verdict before starting. `ResetPasswordPage.tsx`.

### W03-6 — MED — With email off, the page promises an email that cannot be sent — FLAGGED

**Saw:** the backend logged "Email disabled. Would send … Password Reset", while the page said "Check Your Email… you will receive a password reset link shortly".
**Why not fixed:** what to say, and whether to issue a token that can't be delivered, is the same decision taken for the welcome email on 2026-09-27. It's a department-level fact, so saying so reveals no account. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W03-7 — MED — Request, open and submit share three requests per five minutes — FLAGGED

**Where:** `forgot-password`, `validate-reset-token` and `reset-password` all use `rate_limit_password_reset()`, which allows 3 requests per 300 seconds in one `password_reset` scope. The normal path uses all three. In the development build, React StrictMode validates twice, so the budget runs out even sooner.
**Why not fixed:** it's a security setting. W03-3 and W03-4 remove the misleading page and the most common way to hit the limit. Giving token validation and submission their own scope needs a decision. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W03-8 — NIT — Suppressions in the files touched — ✅ FIXED

- Three `# noqa: E712` (`Organization.active == True`) in `auth.py` are now `.is_(True)`, the form used across the services.
- Three `eslint-disable no-useless-escape` in `passwordValidation.ts` are gone, with the regex written without the useless escapes.

The two documented `# noqa: BLE001` in `auth.py` stay: each gives its reason.

## Checklist

| Section                 | Result                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ link → new password → sign in; W03-6 flagged for installs without email  |
| 2. The right people     | ✅ same answer for every address; token hashed, in the fragment, single-use |
| 3. Wrong input, failure | ✅ after W03-3, W03-4, W03-5; W03-7 flagged                                 |
| 4. Browser signals      | ✅ only the expected 400s and the rate-limit 429s                           |
| 5. Coming back to it    | ✅ a used or expired link says so; reload no longer misreports (W03-3)      |
| 6. On a phone           | ✅ no overflow; "Back to Login" 36px tall (W79 lead)                        |
| 7. Everyone can use it  | ✅ labelled fields, autocomplete hints, errors in text                      |
| 8. What happens around  | ✅ requests audited; reset ends sessions and clears a lock (read from code) |

## Completion gate

| Check                    | Result                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                              |
| npm run lint             | ✅ clean                                                                              |
| flake8 (changed files)   | ✅ `auth.py`, `test_forgot_password_expiry.py`                                        |
| black --check            | ✅                                                                                    |
| frontend tests (touched) | ✅ full suite — see the log entry; the new cases failed before their fixes            |
| backend tests (touched)  | ✅ `test_forgot_password_expiry.py` (failed before), `test_endpoint_auth_coverage.py` |

---

## Second pass — reset as it stands after the October and November work (2026-11-08)

**Driven:** 2026-11-08 · **As:** signed-out visitor, `member2`, `admin` · **Viewports:** 1280×900, 390×844
**Commit:** `51e6e1b` plus this pass's fixes (each re-driven or, where noted, test-proven) · **Database:** continued from the W02 second pass; no reset

The activity after W02, driven again. Since the first pass, W03-6 and W03-7
were resolved, and the address match moved to fingerprints (2026-10-26).
Email is off in the review install, so, as in the first pass, the reset link
was minted directly. A random token was generated, and its SHA-256 hash and a
30-minute expiry were written to `member2`. The pages and endpoints were the
real ones.

### What was driven

1. Sign-in → "Forgot your password?" → `member`'s address, with email off. Read the response, the page and the audit row, then searched the department's audit log as `admin`.
2. Reset links with no token and with a bad token.
3. A minted link, entering:
   - a password with a run (`Abcdef123!xyz`);
   - a mismatched confirmation;
   - a valid password (`Kestrel-Harbor-48!`).

   Read the checklist as text, the way a screen reader gets it.

4. After the reset: the used link, the old password, the new one, and the audit rows.
5. Both pages at 390×844, on the form, invalid-link and rate-limited screens.

Not driven: delivery of a real reset email (email is off), and a CAPTCHA-enabled install.

### Held up ✅

- **Email off (W03-6, resolved):** the server issues no token and answers "Password reset emails are turned off for this department. Ask an administrator to reset your password." The page heads it "No Reset Link Was Sent".
- **Opening and submitting a link have their own budget (W03-7, resolved):** 10 per five minutes in a separate scope, so the three-request request budget is no longer spent by reloading the link.
- **The links themselves:**
  - a missing token gets "This link is incomplete";
  - a bad or used token gets "invalid or has expired", with Request New Reset Link.
- **The checklist:** it lists all seven server rules with the real 12-character minimum. Reset Password stays disabled for a password with a run, and for "Passwords do not match".
- **A reset:** answers `200`, shows "Password Changed", and returns to sign-in. The new password signs in, the old one gets `401`, and the used link is refused.
- **Audit:** `auth.password_reset_completed` appears in the department's audit log, named to the member.
- **Phone:** no sideways scroll on either page. After W03-12, nothing on either page is under 44px.

### W03-9 — MED — Reset requests never reached the department's audit log — ✅ FIXED

**Did:** requested a reset for `member`, then searched the audit log as `admin` for `password_reset`.
**Saw:** `total: 0`. In the database the row existed, with `organization_id` NULL and the department's id only inside `event_data`.
**Where:** `forgot_password` (`backend/app/api/v1/endpoints/auth.py`) has two `log_audit_event` calls, one for email off and one for every other request. Neither passed `organization_id`, and neither knows an acting user. The audit log endpoint (`audit_logs.py`) reads by that column and excludes NULL rows as platform-level. So no administrator could see a reset request, whether a token was issued, email was off, or the address matched nobody.
**Fix:** both calls stamp `organization_id`. A request that matched a member also carries `user_id`. Re-driven: the search returns the request. Test: `tests/test_forgot_password_audit_scope.py`, whose three cases failed before the fix.
**Rows already written:** they keep their NULL column. The department's id is in their `event_data`, but the audit log is hash-chained, so they are left as they are.

### W03-10 — MED — The password checklist's met/unmet state was silent to a screen reader — ✅ FIXED

**Did:** typed `Abcdef123!xyz` on the reset page and read each rule's text.
**Saw:** seven identical lines. Met and unmet differed only by an `aria-hidden` tick icon and colour, so a screen-reader user heard the rules but never which one failed, and faced a disabled Reset Password with no reason. My Account → Password renders its list the same way. The administrator's reset dialog and Add Member print ✓ / ○ in the text, so they were not affected.
**Fix:** each rule now starts with a visually hidden "Met:" or "Not met:", on both pages. Re-driven: the run rule reads "Not met: No runs like 123 or abc". Tests: `ResetPasswordPage.test.tsx` and `UserSettingsPage.test.tsx`, "says which rules are met in text, not only by icon", which failed before the fix.

### W03-11 — LOW — A stale link check could overwrite the current one — ✅ FIXED (test-proven)

**Did:** reopened the used link, with two checks in flight.
**Saw:** "Too Many Attempts", although the last response for that link was `400`, invalid.
**Where:** `ResetPasswordPage`'s validation effect had no cancellation. Whichever answer arrived last set the verdict, and a stale `429` answer won. The dev build's StrictMode always runs the check twice. In production the same race needs a second link opened in the tab before the first check answers, which is the case W03-5 covered for errors.
**Fix:** an effect run that has been superseded ignores its answer. Test: `ResetPasswordPage.test.tsx`, "ignores the answer to a check it has already replaced", which failed before the fix. The exact interleaving is not reproducible on demand in the browser, so this fix rests on the test.

### W03-12 — LOW — "Back to sign in" was 40px tall on the reset page — ✅ FIXED

**Did:** measured the reset page at 390×844.
**Saw:** "Back to sign in" was 40px tall on the invalid-link screen, and the form and rate-limited screens used the same `px-3 py-2`. The forgot-password page already carries `touch:min-h-11`.
**Fix:** `touch:min-h-11` on all three. Re-driven: nothing under 44px on the invalid-link and form screens. Tests: three cases in `ResetPasswordPage.test.tsx`, which failed before the fix.

### W03-13 — MED — Reset requests wrote the typed email address into the audit log — ✅ FIXED (owner decision 2026-11-08)

**Saw:** the request row's `event_data` holds `"email": "review_member@example.org"`, and so does every row for an address that matches nobody. The administrator's audit log shows it.
**Why it matters:** the audit log is hash-chained and kept for good, so the address can never be removed. The 2026-10-26 change ("keep addresses out of new audit entries") took addresses out of the OAuth and onboarding rows, on the grounds that each row already carries `user_id`. The reset request was left as it was.
**Decision:** flagged on the first write-up. The owner chose a keyed fingerprint for unknown addresses (2026-11-08).
**Fix:** `forgot_password` no longer writes the address.

- A request that matched a member is named by `user_id` alone.
- Any other request stores `email_fingerprint`. That is the keyed HMAC the account lookup already uses (`app.core.security.email_fingerprint`, current key), so repeats of one address can be matched but the address can't be read back.
- With email off the server looks nothing up, so those requests always carry the fingerprint.

Re-driven: a request for `nobody.here@example.org` with email off writes `email_fingerprint`, `token_issued: false`, `reason: email_disabled`, and no address. Tests: three cases in `tests/test_forgot_password_audit_scope.py`, which failed before the change.
**Rows already written:** they keep the address. The log is hash-chained, so they can't be edited without breaking verification.
**Limit:** an administrator reading the log sees a hex string. To ask "was this address tried?", the fingerprint has to be computed from the address. No screen does that yet.

### W03-14 — NIT — Two pieces of copy — FLAGGED

- With email off, the forgot-password page still opens with "we'll send you a link to reset your password". The answer after submit is correct (W03-6), but the page's opening promise is not. The public config could say so up front.
- The invalid-link message ends "Please request a new one from the login page", directly above a **Request New Reset Link** button that does exactly that, without the login page.

Left as wording calls.

### Harness

The reset changed `member2`'s password to `Kestrel-Harbor-48!`. It is recorded
in `.workflow-review/accounts.json` (not committed), and `wr.as("member2")`
signs in with it. The pass cleared the reset token it minted, the
rate-limit keys, and `member2`'s failure count.

### Checklist

| Section                 | Result                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ link → new password → sign in; email off says so (W03-6 resolved)                    |
| 2. The right people     | ✅ same answer for every address; token hashed, in the fragment, single-use             |
| 3. Wrong input, failure | ✅ run, mismatch, bad and used links refused; stale verdict fixed (W03-11)              |
| 4. Browser signals      | ✅ only the expected 400s, and 429s from this pass's repeated loads                     |
| 5. Coming back to it    | ✅ a used link says so on a clean load                                                  |
| 6. On a phone           | ✅ no overflow; W03-12 fixed                                                            |
| 7. Everyone can use it  | ✅ after W03-10: the checklist's state is in text                                       |
| 8. What happens around  | ✅ after W03-9 and W03-13: requests and completions in the department log, no addresses |

### Completion gate

| Check                  | Result                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm run typecheck      | ✅ clean                                                                                                                                                     |
| npm run lint           | ✅ clean (8 GB heap, per the W77 tooling lead)                                                                                                               |
| flake8 / black / isort | ✅ `auth.py`, `tests/test_forgot_password_audit_scope.py`                                                                                                    |
| backend tests          | ✅ 24 passed: the new test plus the forgot-password expiry, reset race, sign-in audit and endpoint auth-coverage suites; the new cases failed before the fix |
| frontend tests         | ✅ `vitest related` on the two pages: 12 files, 116 tests; every new case failed before its fix                                                              |
