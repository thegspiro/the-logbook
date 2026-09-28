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
