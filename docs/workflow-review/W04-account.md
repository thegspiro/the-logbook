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
**Owner decision (2026-10-05) — fixed:** lenient validation on new writes only; existing rows untouched. `app/utils/phone_numbers.py` accepts digits, spaces, dashes, dots, brackets, a leading `+` and an extension, with 7–15 digits. Member creates refuse anything else (`422`); the contact-info and profile updates refuse a _changed_ value that fails (`400`, naming the field) and pass a value sent back unchanged, so a legacy entry never blocks saving the rest of a profile. Stored values were not rewritten, so `hasMobileOnFile` can still count a legacy non-number until it is edited.

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

---

## Second pass — My Account after the November work (2026-11-08)

**Driven:** 2026-11-08 · **As:** `member` · **Viewports:** 1280×900, 390×844
**Commit:** `e4ea171` plus this pass's fixes (each re-driven) · **Database:** continued from the W03 second pass; no reset

The owner asked to continue with W04. Since the first pass, member phone
numbers gained a format rule (W04-7, owner decision 2026-10-05), and the
profile learned to save around a blank legal name (forms review F-1, owner
decision 2026-11-05).

### What was driven

1. Account tab: blanked the first name and saved, then a phone of "call me maybe", then valid phone, mobile and city values. Reloaded.
2. Password tab: a wrong current password, the same password again, then a real change, then signed in with the new one.
3. Security tab: enrolled the authenticator app from the shown key with a code typed `123 456`, read the recovery codes, generated new ones, then turned MFA off with a wrong code and then a real one.
4. Notifications tab: turned Shift notices off and saved, switched urgent texts on, reloaded, then restored both.
5. Emergency Contacts: saved a contact with "nope" as the phone, then with a valid phone, and reloaded.
6. All eight tabs at 390×844: overflow, targets under 44px, unnamed controls.

Not driven: adding a passkey (the headless browser has no authenticator), and Web Push (not configured here).

### Held up ✅

- **A blank legal name (F-1):** the save goes through and keeps the stored name: "Profile saved. A name can't be blank, so your saved first name was kept."
- **A member's phone (W04-7):** "call me maybe" is refused, naming the field and the accepted formats. `(555) 010-2233` and `555.010.4455` are stored and survive a reload.
- **The department fields:** Membership Number, Rank and Station are disabled and read-only, with a line saying who can change them.
- **Password change:**
  - a wrong or reused current password is refused in plain words;
  - a real change signs the member out with "Your password was changed, and you have been signed out everywhere" (W04-1);
  - the new password signs in.
- **MFA enrolment:** a valid code is required. After it, the ten recovery codes are shown once, with Copy and Done (W04-2), and the status reads "Authenticator app is on · 10 recovery codes left".
- **New recovery codes and turning MFA off:** both ask for a current code. A wrong code gets "Invalid verification code".
- **Notifications:**
  - a switch saved with Save Preferences survives a reload, and the others are untouched;
  - urgent texts save the moment they are switched ("Text messages turned on");
  - every switch is named (W04-8).
- **Phone:** no sideways scroll on any tab. Radio and checkbox labels on Privacy and Emergency Contacts are 44px targets. No unnamed controls.

### W04-10 — MED — A code typed as the authenticator app shows it was refused everywhere but sign-in — ✅ FIXED

**Did:** on the Security tab, entered the current code as `123 456` to confirm enrolment.
**Saw:** `422`, shown as "code: Value is too long. (Error code: LB-VAL-001)".
**Where:** `MFAVerify`, `StepUpRequest` and `MFALogin` (`backend/app/schemas/auth.py`) take exactly six characters. W02-10 dropped the space on the sign-in screen only, so these all still refused a grouped code:

- enrolment;
- the "confirm it's you" step-up in front of sensitive actions;
- new recovery codes;
- turning MFA off.

**Fix:** the three schemas drop whitespace before the length check, so every path reads a code the same way. A code of the wrong length is still refused. The sign-in screen's own clean-up stays; it is now redundant but harmless.
**Re-driven:** `123 456`-style codes enrolled, generated new recovery codes and turned MFA off. Test: `tests/test_mfa_code_grouping.py`, whose six grouped-code cases failed before the fix.

### W04-11 — LOW — The member's own name, phone and address fields had no autocomplete hint — ✅ FIXED

**Did:** read the Account tab's inputs.
**Saw:** no `autocomplete` on First, Middle, Last or Preferred Name, Phone, Mobile, or the four address fields. A browser or assistive tool could not fill them. WCAG 2.2 SC 1.3.5 (Identify Input Purpose, AA) asks for it on fields that collect the user's own details.
**Fix:**

| Field          | `autocomplete`    |
| -------------- | ----------------- |
| First name     | `given-name`      |
| Middle name    | `additional-name` |
| Last name      | `family-name`     |
| Preferred name | `nickname`        |
| Phone, Mobile  | `tel`             |
| Street address | `street-address`  |
| City           | `address-level2`  |
| State          | `address-level1`  |
| ZIP code       | `postal-code`     |

Emergency contacts describe someone else, so they are outside the rule and left alone. Re-driven: each field carries its token. Test: `UserSettingsPage.test.tsx`, "names the purpose of each of the member's own fields", which failed before the fix.

### W04-12 — MED — An emergency contact's phone has no format check — FLAGGED

**Did:** saved an emergency contact with "nope" as the phone.
**Saw:** "Emergency contacts saved". The server stored it.
**Where:** `EmergencyContact.phone` (`backend/app/schemas/user.py`) is any string up to 20 characters. The W04-7 rule (`app/utils/phone_numbers.py`) covers a member's own phone and mobile only.
**Why it matters:** this is the number the department calls when something has happened to the member.
**Why not fixed:** the 2026-10-05 decision chose a format rule for the member's own numbers and named those paths. Whether it extends to emergency contacts, and what to do with contacts already stored (they are encrypted, so a sweep means decrypting each), is the owner's call. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### Also seen

- **A bad member phone still refuses the whole save (F-3).** The Account tab refuses everything typed with it, shows only a toast, and doesn't flag the field (`aria-invalid` unset). The 2026-11-05 decision says a single-save form should save the rest, keep the stored value and flag the field. Only the name fields have been brought into line, and the rest is tracked as F-3 in `docs/FORMS_REVIEW_2026-11-05.md`, so this is recorded there rather than patched here. Doing it here would mean copying the server's phone rule into the page (CLAUDE.md pitfall 29).
- **NIT:** under "Authenticator app", the button reads "Enable two-factor authentication", although a passkey on the same tab also counts as two-factor. "Set up authenticator app" would say what it does.
- **NIT:** an unknown `?tab=` (for example `?tab=emergency-contacts`) quietly opens the Account tab.

### Harness

The password change set `member` to `Tanker-Ridge-58!x`. It is recorded in
`.workflow-review/accounts.json` (not committed). MFA was turned back off, so
`wr.as("member")` still signs in with a password. The notification settings
were restored. The emergency contact and the profile's phone, mobile and city
were left in place for later runs.

### Checklist

| Section                 | Result                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ profile, password, MFA, notifications, contacts; W04-10 fixed           |
| 2. The right people     | ✅ department fields read-only; MFA changes need a current code            |
| 3. Wrong input, failure | ✅ wrong or reused password, wrong code, bad phone refused; W04-12 flagged |
| 4. Browser signals      | ✅ only the expected 400s and the 422 that W04-10 fixed                    |
| 5. Coming back to it    | ✅ every save checked after a reload                                       |
| 6. On a phone           | ✅ no overflow, nothing under 44px, nothing unnamed                        |
| 7. Everyone can use it  | ✅ after W04-11: own-detail fields name their purpose                      |
| 8. What happens around  | ✅ a password change signs out everywhere and says so                      |

### Completion gate

| Check                  | Result                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm run typecheck      | ✅ clean                                                                                                                                               |
| npm run lint           | ✅ clean (8 GB heap, per the W77 tooling lead)                                                                                                         |
| flake8 / black / isort | ✅ `app/schemas/auth.py`, `tests/test_mfa_code_grouping.py`                                                                                            |
| backend tests          | ✅ 125 passed: the new test and the MFA endpoint, step-up, MFA policy, sign-in audit and per-account limit suites; the new cases failed before the fix |
| frontend tests         | ✅ `vitest related` on `UserSettingsPage`: 11 files, 108 tests; the new case failed before the fix                                                     |
