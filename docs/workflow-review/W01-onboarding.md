# Workflow Review — W01 Fresh-Install Onboarding

**Driven:** 2026-09-27 · **As:** anonymous visitor → system owner (`review_admin`) · **Viewports:** 1280×900, 390×844
**Commit:** `1c18de215` plus this run's fixes (re-driven after each) · **Database:** three fresh installs (`start.sh --reset`); onboarding can only be driven on an empty database, so this run resets, and ends by re-seeding for W02

---

## What was driven

1. Signed out, on a fresh install: `/`, then `/dashboard` and `/login` typed directly. Get Started → Before you begin → Start setup.
2. **Organization Setup:** Continue with every field empty; then a four-digit ZIP and `not-an-email`; then valid values, with Continue pressed twice quickly.
3. **Administrator Account:** Back; a username with a dot, a short mismatched password and a malformed email; then `Abcdef123!xyz`, which meets every rule the page listed; a reload mid-form; then a valid account.
4. **Modules:** enabled Training, Scheduling and Inventory, continued, went Back from Ranks & Positions and checked the choice was kept. Then opened `/onboarding/system-owner` again after the account existed and submitted a second owner.
5. **Ranks & Positions** → **Stations:** Continue with an empty added row; Back, then a row with an address but no name; then a real second station; Back and Continue again to check for duplicates.
6. **Apparatus:** Engine 1 with an officer, a driver, two firefighters and an EMT, then removed one firefighter.
7. **IT & Backup Contacts:** checked every field for a label; Continue empty; then a contact, with a backup email identical to the administrator's.
8. **Email** (Skip for now), **File Storage** (Configure Later), **Sign-In Method** (Authentik, to see what that choice does), **Navigation Layout** (Left Sidebar), and the completion page.
9. Signed out, checked the sign-in page and forgot-password under Authentik; signed back in and confirmed the sidebar layout.
10. **Phone (390×844)** on a second fresh install: every step from Welcome through Apparatus, measuring page overflow and tap-target size.
11. **Reset Progress** partway through (after the account existed), then started setup again from the organization step.

Not driven: the Email and File Storage configuration forms with real credentials (there are no working credentials in the review install), Google and Microsoft sign-in, and a keyboard-only pass beyond the admin form. Uploading a logo was not driven.

## Held up ✅

- Every protected URL on a fresh install (`/dashboard`, `/login`) sends the visitor to `/onboarding/prepare`.
- The organization step marks required fields, names each one in a summary, and a double-clicked Continue created exactly one organization.
- The server refuses a second system owner (`400 A system owner has already been created`), whatever the page shows.
- Module choices survive going Back from Ranks & Positions.
- Stations: a completely empty added row is dropped; a row with details but no name is blocked with a message beside the name and a toast. Returning to the step shows the saved station, and continuing again did not duplicate it.
- The stored apparatus seat list is one entry per seat, with `required: true`, as CLAUDE.md pitfall 20 requires.
- Continue on the positions step submits every pre-selected position unchanged (31).
- The Left Sidebar choice applies on the first sign-in.
- Reset Progress asks first, names what it deletes, and deletes it: no organizations, users, locations or onboarding status afterwards.

## Findings

### W01-1 — LOW — ZIP Code never showed its error beside the field, and no error was tied to its field — ✅ FIXED

**Did:** pressed Continue on an empty organization step, then with a four-digit ZIP.
**Saw:** Organization Name, Street Address, City and State each showed a message beneath the field; ZIP Code did not, although the summary listed "ZIP/Postal code is required". The inputs were `aria-invalid` but carried no `aria-describedby`, so a screen reader announced "invalid" without the reason.
**Where:** `OrganizationSetup.tsx` — the validator stored `mailingZip` / `physicalZip`, while `AddressForm.getFieldError('zipCode')` reads `mailingZipCode`.
**Fix:** the keys are now `mailingZipCode` / `physicalZipCode`, and `InputField` / `SelectField` give the message an id and point `aria-describedby` at it. Test: `OrganizationSetup.validation.test.tsx`.

### W01-2 — MED — The administrator password checklist omitted two rules the server enforces — ✅ FIXED

**Did:** entered `Abcdef123!xyz`, which ticked all five listed rules, and pressed Create.
**Saw:** `400 Password cannot contain sequential characters`, shown as an error that says "Check the password requirements above" — which listed no such rule — with both password fields cleared.
**Where:** `AdminUserCreation.tsx` carried its own five-rule checker; the backend (`validate_password_strength`) also refuses ascending runs and triple repeats.
**Fix:** `utils/passwordValidation.ts` now exports `hasSequentialCharacters` and `hasRepeatedCharacters` (and `validatePassword` uses them), and the step checks and lists both. Create stays disabled with the reason under the field. Tests: `AdminUserCreation.test.tsx`, `passwordValidation.test.ts`.

### W01-3 — LOW — The Modules step's button said "Complete Setup & Go to Dashboard" and went to step 4 of 11 — ✅ FIXED

**Where:** `ModuleOverview.tsx`. **Fix:** `Continue to ${nextStepName('modules')}` ("Continue to Ranks & Positions"), as the other steps label themselves. `stepLabelIntegrity.test.ts` now also fails any step page other than the completion screen that claims to finish setup.

### W01-4 — LOW — The administrator step reported "Step 7 of 10 / 70%" and "continue with IT team setup" — ✅ FIXED

**Where:** `AdminUserCreation.tsx`, a hand-written progress bar from before the steps were reordered. It is step 2 of 11, and Modules follows it.
**Fix:** it uses the shared `ProgressIndicator`, and the hint uses `nextStepName`. Test: `AdminUserCreation.test.tsx`.

### W01-5 — MED — Going Back from Modules led to a dead end — ✅ FIXED

**Did:** after creating the account, went Back from Modules to the account step.
**Saw:** an empty account form. Its only button returned "A system owner has already been created", and its Back went to Organization Setup, which is one-time and moved straight back. The only way forward was the address bar.
**Where:** `AdminUserCreation.tsx` had no check for an existing account (Organization Setup has one for its own step), and both it and `ModuleOverview.tsx` offered Back to a step that cannot be revisited.
**Fix:** the account step asks `/onboarding/status` on arrival and moves on when `admin_user` is complete. Both steps replace the Back button with the note Stations already uses ("…already saved. You can update them from Settings after setup."). Test: `AdminUserCreation.test.tsx`.

### W01-6 — MED — An apparatus could not ride the same position twice — ✅ FIXED

**Did:** added an officer, a driver and a firefighter to Engine 1, then tried a second firefighter.
**Saw:** each position's button disappeared once used, so an ordinary four-person engine could not be entered. Removing a position removed it by name, which would have taken off every seat with that name. The EMT button read "+ Emt" (CSS `capitalize`).
**Where:** `ApparatusSetup.tsx`. The backend keeps duplicates, and pitfall 20 defines the stored list as one entry per seat.
**Fix:** positions can be added repeatedly, are removed by seat index (labelled "Remove firefighter (seat 4)"), and EMT is written as an abbreviation. Re-driven: the saved row holds five seats including two firefighters. Test: `ApparatusSetup.seats.test.tsx`.

### W01-7 — LOW — Seven of eight IT-contact fields had no label, and the rank hint pointed at the wrong step — ✅ FIXED

**Where:** `ITTeamBackupAccess.tsx`. The labels had no `htmlFor` and the inputs no `id`, so fields were announced by placeholder ("John Doe"). "You can edit the ladder itself on the next step" dates from before the reorder: ranks were step 4, and the next step is Email.
**Fix:** `id` / `htmlFor` pairs on all seven. The hint and the ranks-failed message now point to Members → Settings → Operational Ranks. Test: `ITTeamBackupAccess.labels.test.tsx`.

### W01-8 — MED — Every onboarding step scrolled sideways on a phone, by about 1,450px — ✅ FIXED

**Did:** Organization Setup at 390×844.
**Saw:** `scrollWidth − innerWidth` of 1,458–1,469px on every step carrying the progress bar.
**Where:** `ProgressIndicatorEnhanced.tsx`. The step strip scrolls inside an `overflow-x-auto` box, but each optional step's `sr-only` ", optional" label is absolutely positioned. With no positioned ancestor inside the scroller, those labels escaped its clipping and widened the page. The `data-mobile-scroll-region` marker told the mobile presentation pass to ignore the strip, so nothing flagged it.
**Fix:** the scroller is `relative`. Measured after: no overflow on any step. Test: `ProgressIndicatorEnhanced.test.tsx`, which pins the mechanism (jsdom cannot measure layout).

### W01-9 — LOW — The completion page reported a skipped email and storage step as "Other" — ✅ FIXED

**Where:** `SetupComplete.tsx`. `other` is the id of Email's "Skip for now" and File Storage's "Configure Later", not a provider.
**Fix:** they read "Not set up yet" and "Local storage (set up later)". Test: `SetupComplete.test.tsx`.

### W01-10 — HIGH — Reset Progress made setup impossible to restart, and hammered the server — ✅ FIXED

**Did:** Reset Progress after the account existed, then waited on the organization step.
**Saw:** `POST /onboarding/start` fired about 75 times a second, indefinitely: five `401`s, then `429`s once the rate limit tripped, with no message on screen. The form could not be submitted.
**Where:** two defects together.

- **Backend (`onboarding.py`, reset):** the reset deletes every user, but the caller's auth cookies stayed in the browser. They now named a deleted user, and `/onboarding/start` refuses invalid credentials rather than treating them as anonymous.
- **Frontend (`OrganizationSetup.tsx`):** the effect retried whenever `sessionLoading` went false, which a failed attempt does. `initializeSession` returns `false` rather than throwing, so its error toast never fired either.

**Fix:** the reset response now clears the auth cookies (`_clear_auth_cookies`, the partner of the `_set_auth_cookies` onboarding already uses). The page tries once on arrival, says so when that fails, and Continue retries.
**Re-driven:** after a reset, 2 start requests instead of a stream; no cookies left; a new organization created. Tests: `tests/test_onboarding_reset_cookies.py`, `OrganizationSetup.session.test.tsx`.

### W01-11 — HIGH — Authentik is offered but not implemented, and choosing it turns off password reset — FLAGGED

**Did:** chose Authentik SSO on the Sign-In Method step and finished setup. Then, signed out, opened sign-in and forgot-password.
**Saw:** no Authentik settings were asked for, and `settings.auth.provider` became `authentik`. The sign-in page still showed only the password form. `POST /auth/forgot-password` answered "This organization uses your SSO provider… reset your password through your SSO provider", while the screen said "Check Your Email".
**Where:** `AuthenticationChoice.tsx` and `AuthSettingsSection.tsx` offer it. `oauth_service.py` implements only Google and Microsoft. `auth.py` forgot-password refuses a reset for any non-local provider.
**Why not fixed:** implementing Authentik OIDC and withdrawing the option are both product decisions, and an organization already storing `authentik` needs a chosen fallback. Mirrored to `docs/KNOWN_LIMITATIONS.md`. The forgot-password screen ignoring the server's message is a W03 lead.

### W01-12 — LOW — A backup recovery email identical to the administrator's is accepted — OPEN

The IT contacts step says "Use a different email than the primary admin account" but accepted `review_admin@example.org` as the backup for `review_admin@example.org`. Recovery through the same mailbox recovers nothing. `ITTeamBackupAccess.tsx` validation. Left open: whether to refuse or only warn is a product choice.

### W01-13 — LOW — Tap targets under 44px on three steps at phone width — OPEN

At 390×844: Modules' "Later / Skip For Now / Ignore" card buttons, the Ranks & Positions row controls (move, edit, delete, the permission checkboxes and radios), and the Apparatus "+ position" chips. `touch-target-phone` exists for this. Left for the W79 phone pass rather than restyling three pages here.

### W01-14 — NIT — The Create button's accessible name does not contain its visible text — OPEN

The button reads "Create Account & Continue" but is named "Create System Owner account and continue setup" (`aria-label`). A voice-control user saying the visible words gets no match (WCAG 2.5.3).

### W01-15 — LOW — A failed Continue on Organization Setup does not move focus — OPEN

Errors are listed in a toast and a summary, but focus stays on the button, so a keyboard or screen-reader user must hunt for the first invalid field.

### W01-16 — LOW — Stations has no Back button — OPEN

Its predecessor, Ranks & Positions, can be revisited, but Stations shows the "Organization details are already saved" note in place of Back. That is the note for the steps next to Organization Setup, and it reads oddly here.

## Harness

The seed read a step's button list while the previous page was still on screen, then clicked that list's index on the new page. On one run that pressed "Remove Quartermaster position", so the seed failed for want of a quartermaster. `seed.mjs` now waits for the step heading to change before reading buttons. This was not a product defect: driven by hand, marking modules "Later" and continuing leaves every position in place.

## Checklist

| Section                 | Result                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ after W01-5 and W01-10; completion data checked in the database, not the toast                                                                                         |
| 2. The right people     | ✅ the server refuses a second owner, and a reset requires the owner's session (read from code, `_require_owner_authority`); only an anonymous visitor precedes the owner |
| 3. Wrong input, failure | ✅ after W01-1 and W01-2; W01-12 open                                                                                                                                     |
| 4. Browser signals      | ✅ after W01-10; the dashboard's 403s on disabled modules remain (W07 lead)                                                                                               |
| 5. Coming back to it    | ✅ after W01-5; reload on the account step clears the form (acceptable: nothing is saved client-side, passwords included)                                                 |
| 6. On a phone           | ✅ after W01-8; W01-13 open                                                                                                                                               |
| 7. Everyone can use it  | ✅ after W01-1 and W01-7; W01-14 and W01-15 open                                                                                                                          |
| 8. What happens around  | W01-11 flagged; reset is audited (`onboarding.reset_initiated` / `_completed`, read from code)                                                                            |

## Completion gate

| Check                    | Result                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                         |
| npm run lint             | ✅ clean                                                                                                         |
| flake8 (changed files)   | ✅ clean (`app/api/v1/onboarding.py`, `tests/test_onboarding_reset_cookies.py`)                                  |
| black --check            | ✅ clean                                                                                                         |
| frontend tests (touched) | ✅ `src/modules/onboarding` + `src/utils/passwordValidation` — every new test failed before its fix              |
| backend tests (touched)  | ✅ `test_onboarding_reset_cookies.py`, `test_onboarding_session_resume.py`, `test_onboarding_reset_authority.py` |
