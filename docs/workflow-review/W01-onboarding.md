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

### W01-11 — HIGH — Authentik is offered but not implemented, and choosing it turns off password reset — RESOLVED (seen 2026-10-31, third pass)

**Did:** chose Authentik SSO on the Sign-In Method step and finished setup. Then, signed out, opened sign-in and forgot-password.
**Saw:** no Authentik settings were asked for, and `settings.auth.provider` became `authentik`. The sign-in page still showed only the password form. `POST /auth/forgot-password` answered "This organization uses your SSO provider… reset your password through your SSO provider", while the screen said "Check Your Email".
**Where:** `AuthenticationChoice.tsx` and `AuthSettingsSection.tsx` offer it. `oauth_service.py` implements only Google and Microsoft. `auth.py` forgot-password refuses a reset for any non-local provider.
**Why not fixed:** implementing Authentik OIDC and withdrawing the option are both product decisions, and an organization already storing `authentik` needs a chosen fallback. Mirrored to `docs/KNOWN_LIMITATIONS.md`. The forgot-password screen ignoring the server's message is a W03 lead.

### W01-12 — LOW — A backup recovery email identical to the administrator's is accepted — FIXED (2026-10-31)

The IT contacts step says "Use a different email than the primary admin account" but accepted `review_admin@example.org` as the backup for `review_admin@example.org`. Recovery through the same mailbox recovers nothing. `ITTeamBackupAccess.tsx` validation. Left open: whether to refuse or only warn is a product choice.

**Fixed (2026-10-31, owner decision: refuse it):** Continue now refuses a backup address equal to the administrator's, ignoring case and surrounding spaces, with "Use a different email than the administrator account". `ITTeamBackupAccess.backupEmail.test.tsx`; re-driven on a fresh install. The check is in the browser only: the API still stores whatever it is sent.

### W01-13 — LOW — Tap targets under 44px on three steps at phone width — FIXED (2026-10-31)

At 390×844: Modules' "Later / Skip For Now / Ignore" card buttons, the Ranks & Positions row controls (move, edit, delete, the permission checkboxes and radios), and the Apparatus "+ position" chips. `touch-target-phone` exists for this. Left for the W79 phone pass rather than restyling three pages here.

**Fixed (2026-10-31):** measured again on a fresh install at 390×844 before changing anything, since the steps had moved on. Under 44px were: Modules' Later and Skip (36px), the optional modules' Enable and Skip (36 and 32px) and Continue (40px); Ranks & Positions' Remove buttons and View / Manage toggles (24px), "Show all modules" (16px), Continue and Create Custom Position (40px); Apparatus' "+ position" chips (26px) and a seat's remove button (12px). The same drive found four more on other steps: the administrator step's two show-password toggles (20px), IT Contacts' Add Member (36px), the setup-complete page's eight next steps (20px), and Reset Progress (42px) on every step. All take `touch-target-phone`, so desktop density is unchanged. Re-driven: every onboarding step now measures clean at 390px. Pinned by the touch-target tests in the steps' own test files.

### W01-14 — NIT — The Create button's accessible name does not contain its visible text — FIXED (2026-10-31)

The button reads "Create Account & Continue" but is named "Create System Owner account and continue setup" (`aria-label`). A voice-control user saying the visible words gets no match (WCAG 2.5.3).

**Fixed (2026-10-31):** the `aria-label` is gone, so the button is named by its words. Reset Progress had the same fault (named "Reset onboarding progress") and is fixed the same way. `AdminUserCreation.test.tsx` now finds the button by its visible text, and `seed.mjs` follows.

### W01-15 — LOW — A failed Continue on Organization Setup does not move focus — FIXED (2026-10-31)

Errors are listed in a toast and a summary, but focus stays on the button, so a keyboard or screen-reader user must hunt for the first invalid field.

**Fixed (2026-10-31):** a failed Continue moves focus to the first invalid field, once its section has expanded. `OrganizationSetup.validation.test.tsx`; re-driven: focus lands on Organization Name, and on Street Address once the name is filled.

### W01-16 — LOW — Stations has no Back button — FIXED (2026-10-31)

Its predecessor, Ranks & Positions, can be revisited, but Stations shows the "Organization details are already saved" note in place of Back. That is the note for the steps next to Organization Setup, and it reads oddly here.

**Fixed (2026-10-31):** Stations has Back to the previous step, in place of the note. Its drafts are already in the onboarding store, so going back loses nothing. `StationSetup.back.test.tsx`; re-driven: Back lands on Ranks & Positions.

## Third pass — the options and their wording, as an IT manager (2026-10-31)

**Driven:** 2026-10-31 · **As:** anonymous visitor → system owner (`jreyes`, "IT Manager") · **Viewport:** 1280×900
**Database:** two fresh installs (`start.sh --reset`): one to find, one to re-drive the fixes.

The first two passes covered validation, navigation, the phone layout and accessibility, and left out the configuration forms, the logo upload, and whether each option does what it says. This pass covered those: every choice on every step, read the way an IT manager reads it, and checked against what the app did afterwards (the stored row, the next sign-in, the navigation), never against the toast.

### What was driven

1. Welcome → Before you begin, read in full.
2. **Organization Setup** with a logo upload (PNG), all three identifier types, member numbers on with prefix `RVF-` from 100. Checked the stored organization row: logo, FDID, prefix, start number.
3. **Administrator Account** with the membership number left blank. Stored: `RVF-0100`, next number 101.
4. **Modules:** Skip on Events and on Documents, Enable on Training, Inventory, Scheduling and Apparatus, Skip on Reports. Then the stored `settings.modules`, the navigation, and Settings → Modules.
5. **Stations** (a second station with a number), **Apparatus** (Engine 1, four seats), checked in the database.
6. **IT & Backup Contacts:** the administrator as primary contact (the step pre-fills it) plus a second contact. Checked the users table afterwards.
7. **Email:** every platform card; SMTP with three provider presets; a connection test against a port with nothing listening; Continue after the failed test; on the re-drive, Skip for Now.
8. **File Storage:** every card; OneDrive's configuration page; Local Storage's.
9. **Sign-In Method:** Google, on a server with no Google client configured. Then signed out: the sign-in page, `/auth/oauth-config`, and forgot-password.
10. **Navigation Layout:** Top. Then the completion page, the dashboard, Members Administration and Add Member, reading the failed requests behind each.

### Held up ✅

- The organization row stores what was entered, logo included; member numbering starts where it was told to, and the owner gets the first number.
- Listing the administrator as an IT contact does not create a second account; a new contact gets an account numbered next in the sequence (`RVF-0101`) with a forced password change.
- The apparatus seat list is stored one entry per seat (pitfall 20).
- The SMTP connection test gives a clear, actionable error ("Could not reach an SMTP server with these settings. Check the server address, the port … and the encryption type…"), and the provider presets fill sensible server details with good per-provider guidance.
- **W01-11 is resolved since the first pass.** Choosing Google on a server with no Google client leaves the password form on the sign-in page (`/auth/oauth-config` reports every provider off) and forgot-password still answers "Check Your Email". The guard is `sso_provider_is_live` in `auth.py`; Authentik is now implemented (`AuthentikOAuthService`). Driven with Google; the Authentik half is read from code.
- The Members → Settings → Membership IDs / Operational Ranks / Membership Tiers pointers the steps give all lead where they say.

### W01-17 — LOW — Before you begin said "the first two steps are required" beside three, and promised options setup does not have — ✅ FIXED

**Saw:** "Only the first two steps are required", then "Organization Setup and Administrator Account and Encryption Key — the only required steps", then "9 of the 12 steps are optional". It also listed "Keys for S3, Google Drive, OneDrive or Azure" (no Azure option exists, and OneDrive is not connected: W01-29), and told the operator to have a sign-in provider's client ID and secret ready, which setup never asks for: they go in the server's `.env`.
**Where:** `SetupPrerequisites.tsx`. **Fix:** the count and the list come from `ONBOARDING_STEPS` and read "A, B and C"; storage names what works; the sign-in line says where the credentials go and that passwords work until then. Test: `SetupPrerequisites.test.tsx`.

### W01-18 — LOW — A blank membership number on the administrator step was unexplained — ✅ FIXED

**Saw:** "Membership Number (Optional)", one step after "Start numbering at … The number your account will be given". Left blank, the account got `RVF-0100`; nothing said blank meant that rather than "no number".
**Where:** `AdminUserCreation.tsx`. **Fix:** a hint tied to the field by `aria-describedby`. The numbering choice is not in the wizard's store, so the hint is written to be true whether numbering is on or off. Test: `onboardingWording.test.tsx`.

### W01-19 — MED — On the Modules step, every card looked the same whether its module was on or off — ✅ FIXED

**Saw:** every essential and recommended card carried the same red or blue **Enable** button, enabled or not. The only difference was a 16px icon beside the card's own icon, hidden from screen readers. The page's instruction, "Only modules marked Enable are turned on", described every card. (The optional cards already read "Enabled", with `aria-pressed`.)
**Where:** `ModuleOverview.tsx`. **Fix:** every card's button reads **Enabled** with a check and `aria-pressed` once it is, and each card is a group named by its module. Test: `ModuleOverview.choices.test.tsx`.

### W01-20 — MED — Skip on Members, Events and Documents did nothing — ✅ FIXED

**Did:** Skip on Events & RSVP and on Documents & Files. **Saw:** the completion page left both out of "Modules enabled", and both were in the navigation on first sign-in. Settings → Modules says "Members, Events and Documents are core and always active", and `ModuleSettings.get_enabled_modules` adds them whatever is stored.
**Where:** `ModuleOverview.tsx`, `moduleRegistry.ts`. **Fix:** those three cards read **Always on** with no buttons (`ALWAYS_ON_MODULE_IDS`, kept in step with the backend list), and a stored "skipped" from an earlier session is put back to enabled so the summary agrees with the app. Custom Forms, which the server can turn off, keeps its Skip. Test: `ModuleOverview.choices.test.tsx`.

### W01-21 — LOW — Later and Skip did the same thing — ✅ FIXED

Both left the module off; only the enabled list is sent (`saveModuleConfig`), and nothing read the difference. The page never said how they differed, because they did not. **Fix:** Later is removed from the essential and recommended cards, which now match the optional ones (Enable / Skip). Removing it changes no stored data. `ModuleOverview.enable.test.tsx`'s touch-target list dropped the Later buttons in the same commit, for that reason.

### W01-22 — MED — "Email Notifications" did not control email — ✅ FIXED

**Saw:** the module was described as "Automated email notifications for events, reminders, and important updates". Skipped at setup, it removed the notification bell from the navigation, while nothing on the sending side reads it (`grep` for `notifications` module checks in the senders: none). It gates `/notifications`: the in-app inbox and bell, web push, and the notification rules screen. A department skipping it to hold off on email would lose the bell and keep every email. Members also have their own "Email Notifications" preference, which really does stop reminder emails, so the two shared a name.
**Fix:** renamed **In-App Notifications** and described as what it gates, in onboarding and in Settings → Modules (and the backend field description). Test: `ModuleOverview.choices.test.tsx`.

### W01-23 — MED — "Mobile App Access" is a switch nothing reads — ✅ FIXED (owner decision 2026-11-01: remove it)

Offered on the Modules step and in Settings → Modules ("Progressive web app for mobile access…"). No frontend or backend code reads `modules.mobile`; the app is installable and works on phones whatever it says. CLAUDE.md pitfall 19.

**Fixed (2026-11-01, owner decision: remove it from onboarding and Settings).** Gone from the Modules step (`moduleRegistry.ts`), from Settings → Modules (`SettingsPage.tsx`), from the unused module catalogue (`types/modules.ts`), and from the Communications Officer's specialties. On the backend it moves from the offered list to `ONBOARDING_RETIRED_MODULES`. The `ModuleSettings.mobile` field stays, so stored settings and the modules API are unchanged, and the id stays accepted so a setup session saved before the change still validates. A stored value remains inert, as it always was. Tests: `test_onboarding_module_parity.py` (neither screen offers a retired module), `ModuleOverview.choices.test.tsx`. `test_module_checkbox_grants.py` found its no-permission example by scanning the registry, where Mobile App Access was the only one; it now names `mobile` directly.

### W01-24 — LOW — Onboarding turns Public Information off without asking — FLAGGED

The Modules step never offers Public Information, but saving the step writes every configurable module, so it is stored `false`, while Settings → Modules lists it under Standard Modules, "Enabled by default for all organizations". Whether onboarding should offer it, or leave it at its default, is a product decision. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W01-25 — LOW — The email platform cards advertised features of other modules, and a price — ✅ FIXED

Gmail offered "Calendar sync available" and Microsoft 365 "Teams integration": both are separate integrations under the Integrations module, available or not whatever sends the email. Cloudflare quoted "$0.35 per 1,000 emails", which goes stale without anything noticing. Microsoft's setup line asked for "an App Password" with MFA, while its configuration page recommends an app registration and warns App Passwords are being retired. **Fix:** each card says what that choice does. Test: `onboardingWording.test.tsx`.

### W01-26 — MED — No field on the email configuration page had a label tied to it, and the provider box misreported its choice — ✅ FIXED

**Saw:** From Email Address, From Name, SMTP Host, Port, Encryption, Username, Password and every Gmail, Microsoft and Cloudflare secret had a visible label with no `htmlFor` and a control with no `id`: fourteen fields across the four forms, announced by placeholder or not at all. Separately, after choosing iCloud in "Fill in settings for a known provider", the box snapped back to "My own mail server, or a provider not listed…" above iCloud's host and iCloud's hint.
**Where:** `EmailConfiguration.tsx`. **Fix:** `id` / `htmlFor` pairs; the Microsoft method buttons are a group named "Authentication"; the box shows the provider filled in, and choosing "my own server" removes the hint. Test: `EmailConfiguration.labels.test.tsx`.

### W01-27 — LOW — Continue saves email settings that just failed their test — ✅ FIXED (owner decision 2026-11-01: warn, but allow saving)

After "Could not reach an SMTP server…", Continue answered "Email settings saved" and the summary reported "SMTP". Saving settings for a mail server not reachable yet is reasonable; saying nothing about it is not. Whether to warn, confirm or refuse is a product choice. The test result also lives only in a toast that disappears after a few seconds (NIT).

**Fixed (2026-11-01, owner decision: warn when the test fails, but allow saving).** A failed test now leaves a warning on the page (`role="alert"`) with the server's reason and "You can still save these settings and fix them later in Settings → Email, but no email will be sent until the connection works". It clears when the settings change or a later test passes. Continue then asks **Save anyway** / **Fix the settings** before saving; settings that were never tested save as before, since the decision covers a failed test. Re-driven on a fresh install against a port with nothing listening: the warning stayed, Fix the settings kept the page, Save anyway saved and moved on to File Storage. Test: `EmailConfiguration.failedTest.test.tsx`. The three existing email-page tests now render inside `ConfirmProvider`, as the app root does.

### W01-28 — LOW — Skip for Now on the email settings page left the provider as the answer — ✅ FIXED

**Did (re-drive):** chose SMTP, then Skip for Now on its settings page. **Saw:** nothing saved to the server, and the completion page reported "Email platform: SMTP" for a department with no email set up.
**Where:** `EmailConfiguration.tsx`. **Fix:** Skip for Now records "set up later" (`platform: 'other'`) as the platform page's own Skip card does. Test: `EmailConfiguration.skip.test.tsx`.

### W01-29 — HIGH — The storage step said files would go to OneDrive / SharePoint; they stay on the server — ✅ FIXED (wording; the limitation stands)

**Saw:** the OneDrive card sold "5 GB free storage", "Deep integration with Office 365"; its settings page said "The Logbook uses these to store documents, photos, and attachments in your OneDrive / SharePoint account." Nothing reads the OneDrive choice (`docs/KNOWN_LIMITATIONS.md`, "File Storage — The Onboarding Platform Choice Has No Reader", owner decision 2026-10-08: build later). Settings → Storage already says where files go; onboarding did not. An IT manager who believed it would leave the server's upload folder out of the backups.
**Fix:** the card and its page say OneDrive is not connected yet, that every file stays in the server's upload folder, and to back that folder up. The option itself stays, per the owner's decision. Test: `FileStorageConfiguration.copy.test.tsx`.

### W01-30 — MED — Local Storage asked for a path the server ignores — ✅ FIXED (wording)

"Choose where on the server documents, photos, and attachments are kept", with a Storage Path field. `local_storage_path` is stored and never read (same limitation entry); uploads go to the server's upload folder. The page also showed "Secrets are encrypted with AES-256…" with no secret on it. **Fix:** the field reads "Storage Path (not used yet)" with a note saying the server always uses its upload folder and how to move it (mount the volume); the secrets note shows only where there is a secret. Test: `FileStorageConfiguration.copy.test.tsx`.

### W01-31 — LOW — Choosing Google reported "Google" while everyone signs in with passwords — ✅ FIXED

**Saw:** Authentik's card said where its settings go and that members use passwords until then; Google's and Microsoft's did neither, and the completion page reported "Sign-in method: Google" on a server where nobody could sign in with Google. "Microsoft Azure AD" is Entra ID now.
**Where:** `AuthenticationChoice.tsx`, `SetupComplete.tsx`. **Fix:** the Google and Microsoft cards name their `.env` settings and the password fallback; the summary asks `/auth/oauth-config` (as the sign-in page does) and reads "Google — passwords until the server is configured" until the server can. Tests: `onboardingWording.test.tsx`, `SetupComplete.signin.test.tsx`.

### W01-32 — MED — IT contacts were told they get an account, not how to use it — ✅ FIXED (wording)

"Anyone without an account gets one when setup finishes." Read from code (`create_it_team_users`): the account is given a random temporary password that is never shown or sent, and only the baseline Member position. So the contact can get in only through Forgot password, which needs email working, and has no administrative access. **Fix:** the step says both. Sending an invitation instead is a product change and is not made here. Test: `onboardingWording.test.tsx`.

### W01-33 — LOW — A fresh install's dashboard and member screens asked a module it had left off — ✅ FIXED

Resolves the lead from the W01 follow-up. With Integrations off, the dashboard requested `/integrations/weather/active-alerts` and Members Administration `/integrations/connected`, both refused `403 LB-ORG-002`. `useConnectedIntegrations` had twelve callers that did not pass the module switch; only the two navigation bars did. **Fix:** the hook checks the Integrations module itself, and waits for the answer before asking; the weather banner does the same. Re-driven: no failed request on the dashboard, Members Administration or Add Member. `RoomQRCodesPage.test.tsx`'s NFC block had Integrations off while reporting an integration connected, a state the server refuses; its fixture now enables the module. Tests: `useConnectedIntegrations.test.ts`, `WeatherAlertBanner.test.tsx`.

### NITs, not changed

- Country is free text ("USA") while State is a US-only list and ZIP is checked as a US code.
- Headquarters is stored with facility number "Station 1" and named after the department; an added station stores the number as typed ("2").
- The Stations step says stations are ready for "apparatus assignment", and the Apparatus step has no station picker.
- The administrator step calls one account "Administrator Account", "System Owner" and "IT Manager" (it explains them).

## Harness

The seed read a step's button list while the previous page was still on screen, then clicked that list's index on the new page. On one run that pressed "Remove Quartermaster position", so the seed failed for want of a quartermaster. `seed.mjs` now waits for the step heading to change before reading buttons. This was not a product defect: driven by hand, marking modules "Later" and continuing leaves every position in place.

## Checklist

| Section                 | Result                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ after W01-5 and W01-10; completion data checked in the database, not the toast                                                                                         |
| 2. The right people     | ✅ the server refuses a second owner, and a reset requires the owner's session (read from code, `_require_owner_authority`); only an anonymous visitor precedes the owner |
| 3. Wrong input, failure | ✅ after W01-1, W01-2 and W01-12                                                                                                                                          |
| 4. Browser signals      | ✅ after W01-10; the dashboard's 403s on disabled modules remain (W07 lead)                                                                                               |
| 5. Coming back to it    | ✅ after W01-5; reload on the account step clears the form (acceptable: nothing is saved client-side, passwords included)                                                 |
| 6. On a phone           | ✅ after W01-8 and W01-13                                                                                                                                                 |
| 7. Everyone can use it  | ✅ after W01-1, W01-7, W01-14 and W01-15                                                                                                                                  |
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
