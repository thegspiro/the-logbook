# Workflow Review — W04 My Account

**Driven:** 2026-09-28 · **As:** `member`, with `member2` as the other member · **Viewports:** 1280×900, 390×844
**Commit:** `33b1ce5` plus this run's fixes (each re-driven) · **Database:** continued from W03; no reset

---

## What was driven

1. As `member`, from `/account`: edited the profile on the Account tab (name, phone, mobile), including clearing fields and entering a phone that isn't a number. Reloaded to check what was stored.
2. Password tab: the checklist before typing, a wrong current password, the same password again, a change inside the one-day minimum age, then a real change. Then signing in with the new password. The minimum age was moved back in the review database to reach the last two steps.
3. Security tab: enrolled in two-factor authentication with a TOTP generated from the shown secret, read the recovery codes, then pressed Done.
4. Signed out and back in: a wrong code, then a real code, then (in a clean browser) a recovery code. Read `failed_login_attempts` in the database throughout.
5. Regenerated the recovery codes, then turned MFA off with a wrong code and then a real one. The harness signs `member` in with a password alone, so MFA stays off.
6. Notifications tab: turned a reminder off, saved, reloaded; switched urgent texts on and off with no mobile number on file.
7. Emergency Contacts: saved an empty contact, one with a bad phone and email, one with only the fields marked required, then a full one. Added a second, removed it, and reloaded after each step.
8. As `member2`: read and tried to change `member`'s profile through the API.
9. All eight tabs at 390×844: horizontal overflow, controls under 44px, unnamed controls.

Not driven: Web Push on the Notifications tab. It's hidden unless push is configured, and it isn't here. The `App` tab's refresh controls were only looked at.

## Held up ✅

- **Password change** refuses a wrong current password, the current password reused, and a change inside the minimum age, each with a plain message. After a change, the old password gets `401` and the new one signs in.
- **MFA enrolment** needs a valid code before it turns on. The shown secret, entered by hand, produced codes the server accepted.
- **MFA sign-in**: a wrong code gets "Invalid verification code". A real code lands on `/dashboard`. The field is labelled, with `autocomplete=one-time-code` and a numeric keypad.
- **The replay guard works.** A code from the time step already used to confirm enrolment was refused at sign-in (`mfa_last_timestep`). That was my test's mistake, not a defect.
- **Recovery codes** sign in once each, typed in upper or lower case, and the count went from 10 to 9. Regenerating shows ten new codes and replaces the old set (read from code: `mfa_backup_codes` is overwritten). Turning MFA off needs a current code, and a wrong one is refused with a visible message.
- **Notification preferences** survive a reload. The urgent-text switch saves the moment it's switched, and the other toggles are left alone.
- **Emergency contacts are private.** As `member2`, `GET /users/{member}/with-roles` returns `emergency_contacts: []` and `phone: null`, and `PATCH …/profile` returns `403`.
- **No sideways scroll** on any of the eight tabs at 390px.

## Findings

### W04-1 — MED — After a password change the member landed on sign-in with no message — ✅ FIXED

**Did:** changed the password on the Password tab as `member`.
**Saw:** a success toast, then the sign-in screen with nothing on it. The server ends every session on a password change (`auth_service.change_password`), so the page's own `loadUser()` got `401`, and the refresh interceptor redirected to `/login` and dropped any state.
**Where:** `UserSettingsPage.tsx` (`handlePasswordChange`).
**Fix:** a new `authStore.endSessionLocally()` does the sign-out clean-up without calling `POST /auth/logout`. The server has already ended the session, and that call would 401 into the interceptor's hard redirect. `logout()` now uses it too. The page then goes to `/login` with `reason: 'password_changed'`, and the sign-in screen says "Your password was changed, and you have been signed out everywhere." Tests: `UserSettingsPage.test.tsx`, `LoginPage.test.tsx`, `authStore.test.ts`.

### W04-2 — HIGH — The recovery codes were never shown — ✅ FIXED

**Did:** enrolled in MFA and waited on the confirmation.
**Saw:** the codes screen for a moment, then the card back in its "on" state. The codes are shown once and are otherwise lost; the stored copies are hashed. `confirmEnroll` called the parent's `onChange`, the account page reloaded the user, and the page remounted the card and dropped its state.
**Where:** `MfaSettingsCard.tsx`.
**Fix:** `onChange` is deferred until the member presses Done. Re-driven: the codes stay up until Done, then the card reads "10 recovery codes left". Test: `MfaSettingsCard.test.tsx`.

### W04-3 — HIGH — A correct password cleared the count of wrong MFA codes, so the lockout never tripped — ✅ FIXED

**Did:** against the API, signed in with `member`'s password, sent three wrong codes, then signed in with the password again, reading `failed_login_attempts` after each step.
**Saw:** 3 after the wrong codes, **0** after the correct password. `mfa_login` adds each wrong code to the counter the lockout is measured on, but `authenticate_user` reset it on any correct password. Anyone who has the password can guess four codes, sign in again and guess four more, with only the per-IP rate limit in the way. CLAUDE.md already holds the same rule for the suspicious-IP throttle: never clear on a correct password alone.
**Where:** `backend/app/services/auth_service.py` (`authenticate_user`, the reset after a successful password check).
**Fix:** for an MFA account the password step leaves the counter and the lock alone. `mfa_login` already clears both once the second factor succeeds. Password-only accounts behave as before. Re-driven: 3 → 3 after the password, and 0 after a real code. Test: `tests/test_auth_mfa_lockout_reset.py` (integration); it failed before the fix.

### W04-4 — MED — An emergency contact with the fields marked required was refused in schema language — ✅ FIXED

**Did:** added a contact with a name and phone, the two fields marked `*`.
**Saw:** `422` and "emergency_contacts.1.relationship: Value is too short. emergency_contacts.1.email: value is not a valid email address…". The server requires a relationship (`EmergencyContact.relationship`, `min_length=1`) and refuses an empty-string email (`EmailStr`). The form marked relationship optional and sent `email: ''` (pitfall #1). An existing test asserted exactly that refused payload.
**Where:** `UserSettingsPage.tsx` (`handleSaveEmergencyContacts` and the contact form).
**Fix:** Relationship is marked required and checked before saving ("Each emergency contact needs a name, relationship and phone number."). Values are trimmed and a blank email is left out. The error box is `role="alert"`, so the message is announced. The existing test now asserts the valid payload, and a new one covers the missing relationship. Re-driven: the message shows, and adding a relationship saves and survives a reload.

### W04-5 — LOW — The password rules appeared only after typing started — ✅ FIXED

**Saw:** an empty New Password field with no rules under it, on both the change page and the reset page.
**Fix:** the checklist (W03-4's shared list) shows from the start on both pages. Test: `UserSettingsPage.test.tsx`.

### W04-6 — LOW — The recovery-code placeholder showed half a code — ✅ FIXED

**Saw:** the placeholder `xxxxx-xxxxx`. The codes are four groups of five (`mfa_service.generate_recovery_codes`, 10 bytes). Copying from the placeholder's shape, I entered half a code and got `401`.
**Where:** `LoginPage.tsx`.
**Fix:** the placeholder is `xxxxx-xxxxx-xxxxx-xxxxx`. Test: `LoginPage.test.tsx`.

### W04-7 — LOW — Phone and mobile are free text, and any text counts as a number on file — FLAGGED

**Saw:** "call me maybe" saved as the phone and shown back after a reload.
**Why not fixed:** which formats to accept, and what to do with rows that already exist, is a product decision. Read from code, the Notifications tab's `hasMobileOnFile` counts any text as somewhere to send a text. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W04-8 — LOW — Three notification switches had no accessible name — ✅ FIXED

**Saw:** Email Notifications, Event Reminders and Training Reminders exposed as unnamed `switch`es. Each label's `htmlFor` pointed at an id its button didn't have.
**Fix:** the buttons carry those ids. Test: `UserSettingsPage.test.tsx`.

### W04-9 — NIT — Small things, fixed as found — ✅ FIXED

- "Remove contact" was 24px tall at 390px, and "Add Another Contact" 42px; both now 44px (`touch-target-phone`).
- The enrolment QR code had no accessible name. It is now `role="img"` with a title (test: `MfaSettingsCard.test.tsx`).
- The Security tab's subtitle said "Two-factor authentication and sessions", but the tab shows no sessions. It now says "Two-factor authentication".

Seen and left: urgent texts can be switched on with no mobile number on file. The switch says there's nowhere to text yet, and recording consent first is reasonable, so this is not a defect.

## Checklist

| Section                 | Result                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ |
| 1. The job gets done    | ✅ after W04-2 (codes) and W04-4 (contacts)                                    |
| 2. The right people     | ✅ another member sees contacts redacted, `403` on edit; W04-3 fixed           |
| 3. Wrong input, failure | ✅ password and MFA refusals are clear; W04-4 fixed; W04-7 flagged             |
| 4. Browser signals      | ✅ only the expected `400`/`401`s; the `422` is gone                           |
| 5. Coming back to it    | ✅ preferences and contacts survive a reload; W04-1 explains the sign-out      |
| 6. On a phone           | ✅ no overflow on eight tabs; W04-9 touch targets                              |
| 7. Everyone can use it  | ✅ after W04-8 and W04-9                                                       |
| 8. What happens around  | ✅ a password change ends sessions; MFA changes send email (logged, email off) |

## Completion gate

| Check                    | Result                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                       |
| npm run lint             | ✅ clean                                                                                                       |
| flake8 (changed files)   | ✅ `auth_service.py`, `test_auth_mfa_lockout_reset.py`                                                         |
| black --check            | ✅ (and isort)                                                                                                 |
| frontend tests (touched) | ✅ full suite: 602 files, 8185 tests; each new case failed before its fix                                      |
| backend tests (touched)  | ✅ `-k "auth or login or mfa or lockout"`: 354 passed, 1 skipped (optional `py_vapid`); new test failed before |
