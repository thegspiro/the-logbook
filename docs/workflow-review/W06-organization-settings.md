# Workflow Review — W06 Organization Settings, Modules, Department Setup

**Driven:** 2026-09-28 · **As:** `admin`, with `member` for what the department sees · **Viewports:** 1280×900, 390×844
**Commit:** `f45b20e` plus this run's fixes (each re-driven) · **Database:** continued from W05; no reset

---

## What was driven

1. As `admin`, from the menu (More → Organization):
   - Renamed the department and reloaded.
   - Emptied the name, then changed the timezone while it was empty, and reloaded.
2. Contact:
   - Set a phone number, and a website of "not a url" then a real one, and reloaded.
   - Cleared the phone and reloaded.
3. Uploaded a logo, checked it in `member`'s header, then removed it (after the fix) and reloaded.
4. Modules: turned Meeting Minutes off. As `member`:
   - checked the menu;
   - opened `/minutes`.

   Then turned it back on and reloaded.

5. As `member`, tried:
   - `/settings` and `/setup` in the browser;
   - `PATCH /organization/modules`, `PATCH /organization/profile` and `POST /organization/setup-checklist/{key}/acknowledge` through the API.
6. Department Setup (`/setup`): opened each of the 20 cards and noted where it landed. Pressed "Mark as reviewed" on Organization Settings and reloaded.
7. At 390×844: Profile, Contact, Addresses, Modules and `/setup`.

Not driven: the Email, Storage, Label Printers and Authentication sections. Each is a platform integration with its own activity later in the rotation, and email is off in the review install.

## Held up ✅

- **Name, timezone, contact and logo changes autosave**, show "All changes saved", and survive a reload. A cleared phone number stays cleared. The new name and logo reached `member`'s header without a reload.
- **Module switches do what they say.** With Minutes off, `member`'s menu dropped it. `/minutes` explained that the module is switched off and who can turn it on, rather than showing a blank or broken page. Turning it back on restored both.
- **Only administrators change anything.** As `member`, both pages show "Access Denied", and every write returned `403`.
- **Setup progress is real:**
  - "Mark as reviewed" moved the count from 4/20 to 5/20.
  - The count survived a reload.
  - The card offers "Mark as not reviewed".
- **18 of 20 setup cards land on the screen where the step is done.**
- **At 390px:** no sideways scroll and no control under 44px on the five screens.

## Findings

### W06-1 — MED — Emptying the department name failed every profile save until it was retyped — ✅ FIXED

**Did:** emptied Department Name.
**Saw:** "Couldn't save — retry", and on the page "name: Value is too short. (Error code: LB-VAL-001)" (`422`). The profile is saved whole, so while the name stayed empty, a timezone or contact change failed with it. "Retry" re-sent the same blank name.
**Where:** `SettingsPage.tsx`, the Department Name input.
**Fix:**

- An empty name is kept as an unsaved draft and never sent.
- The field is marked invalid and says "The department needs a name. It is still saved as '…'".
- Other fields keep saving with the last good name.

Re-driven: the timezone saved while the name was empty. Test: `SettingsPage.profile.test.tsx`.

### W06-2 — MED — Two setup cards opened a screen that cannot do the step — ✅ FIXED

**Saw:**

- "Create Shift Templates" opened `/scheduling`, the week calendar, which cannot create a template.
- "Configure & Verify Email Delivery" opened `/settings` on the Profile section.

A department following the checklist lands somewhere that doesn't mention the task.
**Where:** `backend/app/api/v1/endpoints/organizations.py`, the checklist items' `path`.
**Fix:** `/scheduling/admin/planning/templates` and `/settings?tab=email`. Re-driven: both cards land on the right screen. Test: `tests/test_setup_checklist.py` (fails on the old paths).

### W06-3 — LOW — Contact and address fields had no programmatic label — ✅ FIXED

**Saw:** the four Contact fields had visible labels that weren't tied to their inputs. The ten address fields had only placeholders, which disappear once typed in. A screen reader announced 14 unnamed fields.
**Fix:**

- Contact labels use `htmlFor`/`id`.
- Address fields carry `aria-label`, for example "Mailing address city".

Test: `SettingsPage.profile.test.tsx`.

### W06-4 — LOW — An uploaded logo could be replaced but never removed — ✅ FIXED

**Saw:** only "Upload logo". The profile endpoint already clears the logo when sent `null` (checked through the API).
**Fix:** a "Remove logo" button, shown only when there is a logo. Re-driven: gone after a reload. Test: `SettingsPage.profile.test.tsx`.

Seen and left as they are:

- **The website field accepts any text.** It is used only as escaped plain text in email footers (`email_footers.py`), never as a link, so nothing breaks.
- **Turning a module off asks for no confirmation.** It hides the module and deletes nothing, and turning it back on restores it.

## Checklist

| Section                 | Result                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ profile, modules, checklist; W06-2 fixed                                 |
| 2. The right people     | ✅ member refused on pages and every write                                  |
| 3. Wrong input, failure | ✅ after W06-1; a clear saves the clear                                     |
| 4. Browser signals      | ✅ only the provoked `422`                                                  |
| 5. Coming back to it    | ✅ everything survives a reload; W06-4 adds undo for the logo               |
| 6. On a phone           | ✅ no overflow, no small targets                                            |
| 7. Everyone can use it  | ✅ after W06-3                                                              |
| 8. What happens around  | ✅ name and logo reach every member's header; module state reaches the menu |

## Completion gate

| Check                    | Result                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm run typecheck        | ✅ clean                                                                                                                                         |
| npm run lint             | ✅ clean (after removing two unneeded casts in the new test)                                                                                     |
| flake8 (changed files)   | ✅ `organizations.py`, `test_setup_checklist.py`                                                                                                 |
| black --check            | ✅                                                                                                                                               |
| frontend tests (touched) | ✅ full suite: 604 files, 8193 tests; the new cases failed before the fix                                                                        |
| backend tests (touched)  | ✅ `test_setup_checklist.py`, `test_setup_checklist_counts.py`, `test_endpoint_auth_coverage.py`: 15 passed; the new cases failed before the fix |

---

## Second pass — settings and setup after the November work (2026-11-08)

**Driven:** 2026-11-08 · **As:** `admin`, with `member` for what the department sees · **Viewports:** 1280×900, 390×844
**Commit:** `d0cdaf2` plus this pass's fixes (each re-driven) · **Database:** continued from the W05 second pass; no reset

The owner asked to keep going after W05. Since the first pass:

- Public Information adds a "Set Up the Public Portal" step to the checklist (W01-24);
- the History module was added;
- a step-up bypass on the generic settings `PATCH` was closed (USR-13);
- the admin pages share one header.

### What was driven

1. Profile: renamed the department, then emptied the name and changed the timezone while it was empty. Reloaded, then put both back.
2. Contact: a phone of "call us maybe", a website of "not a url", then real values. Reloaded, cleared the phone, reloaded again.
3. Modules: turned Meeting Minutes off. As `member`: the menu and `/minutes`. Turned it back on.
4. Department Setup: opened each of the 21 cards and noted where it landed. Marked Review Enabled Modules as reviewed, reloaded, then undid it.
5. As `member`: `/settings` and `/setup`, then `PATCH` on `/organization/modules`, `/organization/profile` and `/organization/settings`, and `POST …/setup-checklist/{key}/acknowledge`.
6. Profile, Contact, Addresses, Modules and `/setup` at 390×844.

Not driven: the logo (W06-4's remove), and the Email, Storage, Label Printers, Authentication and Forms sections. Each has its own activity.

### Held up ✅

- **An empty name (W06-1):** it isn't saved, and the field is flagged: "The department needs a name. It is still saved as …". The timezone change made alongside it saves, and both survive a reload.
- **Contact changes** autosave and survive a reload, and a cleared phone stays cleared.
- **Module switches:** each is named ("Disable Meeting Minutes"). With Minutes off, `member`'s menu dropped it, and `/minutes` says the module is switched off and who can turn it on. Turning it on again restored it.
- **Department Setup:**
  - all 21 cards land where the step is done, including the new Set Up the Public Portal → `/admin/public-portal`, and Enable Multi-Factor Authentication → `/account?tab=security`;
  - "Mark as reviewed" moved the count from 4/21 to 5/21, the count survived a reload, and undoing it returned 4/21.
- **Only administrators change anything:** as `member`, both pages show "Access Denied", and every write returns `403`.
- **Phone:** no sideways scroll and no control under 44px on the five screens.

### W06-5 — LOW — Every review step's button was named only "Mark as reviewed" — ✅ FIXED

**Did:** read the setup page's buttons.
**Saw:** two buttons named "Mark as reviewed" (and "Mark as not reviewed" once one is done), with nothing saying which step each confirms. This is the same pattern as W05-10.
**Fix:** `aria-label` "Mark {step} as reviewed" or "… as not reviewed", in `DepartmentSetupPage.tsx`. Re-driven: "Mark Review Organization Settings as reviewed". Test: the new `DepartmentSetupPage.test.tsx`, which failed before the fix.

### W06-6 — MED — The department's contact details are stored however they are typed — FLAGGED

**Did:** entered a phone of "call us maybe" and a website of "not a url" under Settings → Contact, then reloaded.
**Saw:** "All changes saved", and both came back after the reload. The server stored them (`PATCH` → `200`).
**Where:** `OrganizationProfileUpdate` (`backend/app/schemas/organization.py`) bounds the length of `phone` and `website` and checks nothing else. The two writers of these fields disagree:

- onboarding refuses "not a url" with "Enter a valid website address" (`OrganizationSetup.tsx`), and its schema adds `https://` when no scheme is given;
- the member-phone rule (W04-7) is not applied to the department's phone.

The website is printed in email footers (`organization_website`) and returned by the public portal API.
**Why not fixed:** which rules apply is the same call as W04-12. Should the onboarding website check and the W04-7 phone rule apply to Settings? Should a bad value be refused, or saved and flagged under the 2026-11-05 forms decision? And what happens to values already stored? Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W06-7 — NIT — "All changes saved" while the name is flagged as not saved

After the department name is emptied, the status line reads "All changes saved" while the field beside it says the name was not saved. The other changes did save, but the status should say that one didn't, as the profile does on `/account` ("Profile saved. A name can't be blank…"). Left as a wording call.

### Checklist

| Section                 | Result                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| 1. The job gets done    | ✅ profile, contact, modules, setup progress                      |
| 2. The right people     | ✅ member refused on both pages and every write                   |
| 3. Wrong input, failure | ✅ empty name held and flagged; W06-6 flagged (contact unchecked) |
| 4. Browser signals      | ✅ none unexpected                                                |
| 5. Coming back to it    | ✅ every change checked after a reload                            |
| 6. On a phone           | ✅ no overflow, nothing under 44px                                |
| 7. Everyone can use it  | ✅ after W06-5: each review button is named                       |
| 8. What happens around  | ✅ a module switched off is explained where its pages were        |

### Completion gate

| Check             | Result                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| npm run typecheck | ✅ clean                                                                                             |
| npm run lint      | ✅ clean (8 GB heap, per the W77 tooling lead)                                                       |
| frontend tests    | ✅ `vitest related` on `DepartmentSetupPage`: 11 files, 64 tests; the new case failed before the fix |
| backend           | n/a: no backend change                                                                               |
