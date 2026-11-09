# Forms Review — 2026-11-05

A sweep of every form in the application, driven in a real browser with
Playwright against a freshly onboarded department (the
`scripts/workflow-review/` harness, database `logbook_workflow_review`). This is
a findings report: **the review itself changed nothing in the application.** F-1
was fixed afterwards, in the same pull request (see its status line).
Each finding says what was driven, as whom, and what happened, so the owner can
decide what to fix and in what order.

## How it was run

| Pass                    | Role                        | Viewport | Scope                                                                         |
| ----------------------- | --------------------------- | -------- | ----------------------------------------------------------------------------- |
| Automated sweep (1st ½) | `admin` (IT Manager)        | 1366×900 | Every static route in `e2e/mobile-route-inventory.ts`, `/` → `/ip-security/…` |
| Automated sweep (2nd ½) | `chief`                     | 1366×900 | `/learning` → `/training/…`                                                   |
| Phone sweep             | `training_officer`          | 390×844  | The 68 routes the desktop sweep found carrying four or more controls          |
| Hands-on probes         | `member`, `secretary`, etc. | both     | Twelve high-traffic forms, driven field by field (see each finding)           |
| Signed-out probes       | none                        | 1366×900 | `/login`, `/forgot-password`                                                  |

For every route the sweep audited each visible `input`/`select`/`textarea` on
the page, then clicked up to five "Add / New / Create / Record / Log / Request /
Invite / Import / Upload / Schedule / Propose" buttons, audited the dialog or
page each one opened, and — in a dialog — pressed the primary button with every
field empty to see how the form refused. Each surface was also run through
axe-core's form rules (`label`, `select-name`, `autocomplete-valid`,
`aria-input-field-name`, `form-field-multiple-labels`, `label-title-only`,
`color-contrast`, `target-size`, `nested-interactive`, and others). Identical
dialogs reached from several pages (Scheduling's "Create Shift" sits on every
Scheduling page) were counted once.

**Coverage:** 208 routes, **166 distinct form surfaces, 1,786 controls**, and 70
empty-submit probes. Parameterized routes (`/members/:id/edit` and the like)
were not swept; their create-side twins were.

## What held up

These were checked and are clean, so they need no work:

- **No console errors, page errors or failed API calls** on any of the 208
  routes or the dialogs opened from them, as either role.
- **A stray click outside a dialog keeps it open with its input intact**
  (Pitfall #31) — checked on Inventory › Add Item with a half-typed name.
- **Double submit creates one record** — a fast double-click on Events › Create
  Event and on Training › Submit Training each produced exactly one row.
- **Clearing a field on update persists the clear** (Pitfall #1) — Middle Name,
  Mobile and City on `/account` were set, saved, cleared, saved, reloaded: all
  three came back empty.
- **Phone width is clean.** No input under 16px (no iOS focus-zoom), no control
  under 36px tall, and no axe `target-size` or `color-contrast` failure on any
  of the 41 form surfaces the phone sweep reached. The `touch:` / `form-input`
  utilities are doing their job.
- **Sign-in and password reset are model forms:** correct `autocomplete`
  (`username`, `current-password`, `email`), `type="email"`, native required
  validation, and a plain "Incorrect username or password" on a bad attempt.
- **Server-side phone validation reads well:** typing "call me maybe" into
  Mobile is refused with "Enter a phone number using digits, spaces, dashes or
  parentheses…, for example 703-555-0101 ext 4."

## Findings

Severity follows the workflow review's scale — scored by what happens to the
department, not by the size of the fix.

### F-1 — HIGH — A member can save a blank first or last name

**Status: fixed**, under the owner's rule of 2026-11-05 (save with an error,
resolve it before submitting; see `docs/KNOWN_LIMITATIONS.md`). `UserUpdate`
strips both names and refuses a blank one or an explicit `null`, so no request
can wipe a name. `/account` and the officer's edit-member page leave a blank
name out of the request, so the rest of the form still saves and the stored
name is kept; a name that was never recorded stays flagged on its field, with
a message, until it is entered. Tests:
`tests/test_member_name_required_on_update.py`, `UserSettingsPage.test.tsx`
and `MemberAdminEditPage.test.tsx`.

**Driven:** as `member` on `/account`, emptied First Name and pressed Save
Profile. The toast said **"Profile saved"**; after a reload the field was empty
and the database held `first_name = ''`. Through the API, `last_name: ""` and
`last_name: "   "` each returned **200**.

**Why:** `UserUpdate` (`backend/app/schemas/user.py`, used by
`PATCH /users/{id}/profile`) declares `first_name` / `last_name` as
`Optional[str] = Field(None, max_length=100)` — no minimum length and no
whitespace strip — and the `/account` inputs are not marked required. The same
schema serves an officer editing a colleague (`members.manage`).

**Effect:** a member with no name on the roster, in reports and on legal
records (the schema's own comment says reports and legal records keep
`first_name`), from one accidental clear.

**Suggested fix:** strip and require a non-empty value when the key is present
(`min_length=1` after strip, rejecting an explicit `null` — `RefusesNull` is
already on the class), mark both inputs `required` with the asterisk, and add a
pytest that a blank and a whitespace-only name are refused. No migration is
needed for the rule; any rows already blanked would need a data check.

### F-2 — MED — Over-long input is caught only by the server, and the error names the API field

**Driven:** a 300-character First Name on `/account` (as `member`) and a
400-character Station Name in Locations › Add Station (as `chief`). Neither
field stopped the typing. The server answered 422, shown as
**"first_name: Value is too long."** and **"name: Value is too long."** — the
backend's snake_case key, no limit stated, and no field highlighted.

**Scale:** **350 text inputs and textareas on 112 surfaces carry no
`maxLength`**, though every one is bounded by a `String(n)` column. `maxLength` appears in
145 `.tsx` files; 563 render form controls.

**Suggested fix:** two parts, either useful alone.

1. Put `maxLength` on inputs from the schema's `max_length` (a counter where the
   limit is low enough to reach — names, titles).
2. Map a 422's `detail[].field` onto the matching input: `aria-invalid`, the
   message under the field, and the field's own label in place of the API key.
   The error envelope already carries `field`; nothing reads it.

### F-3 — MED — Seventy create dialogs refuse an empty submit four different ways

**Status: in progress.** The shared pattern is built (`FormField`,
`ErrorSummary`, `useFieldErrors`) and Scheduling's Create Shift is on it: the
button stays enabled, a missing value is named on its field, and a 422 lands on
the field it names. Since followed by the shift template and pattern dialogs,
which had relied on the browser's `required` bubble. The other dialogs move
over module by module.

Every dialog in the table's first row — a button disabled until valid, with no
message — has now moved: Create Shift with the shared pieces, New Pattern and
New Template in the next batch, and the rest in the one after (Add Station and
Add Room, Add Facility, the facility type / status / maintenance type dialog,
New Folder, Create Form, Add supply, Add several items, Request Equipment, the
suggestion box form and Apparatus (basic)). Each keeps its button enabled,
names what is missing on its field, and puts a 422 on the field it names.

Pressing the primary button of an empty create dialog was probed 70 times
(about 40 distinct dialogs). The outcomes:

| How it refused                                      | Probes | Examples                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Button disabled until valid — no message at all** | 34     | Scheduling › Create Shift (on every Scheduling page), New Pattern, New Template; Add Station; Add Facility; Facility settings (type/status/maintenance); New Folder; Create Form; Add supply; Inventory › Add Several; Request Equipment; Suggestion box; Apparatus (basic) |
| Native browser bubble (`required`)                  | 21     | Create Election, Event Templates, Inventory › Add Item/Kit/Category/Group/Vendor/Storage Area, Reorder, Notifications › Add Rule, Create Custom Role, Create Pipeline                                                                                                       |
| Inline message only, no `aria-invalid`              | 10     | Finance › New Fiscal Year / Category, New Inspection, Org Chart position, Propose a revision, New Allowance, New outline                                                                                                                                                    |
| Inline message **and** `aria-invalid`               | 5      | Finance › Add budget line, New dues schedule, QuickBooks mapping; Grants › Add Event, Record Pledge                                                                                                                                                                         |

The disabled-button pattern is the one to retire: a member who cannot see why
"Create Shift" is greyed out has nothing to act on, and a disabled button is
skipped by keyboard focus, so a screen-reader user may not find it at all. The
native bubble is serviceable but disappears after a few seconds and is styled by
the browser, not the app.

**Suggested fix:** pick one pattern and make it the shared default — submit
always enabled, validate on submit, message under each failing field with
`aria-invalid` + `aria-describedby`, focus the first failing field. The five
Finance/Grants dialogs in the last row already do exactly this and are the
template.

### F-4 — MED — Error messages are visible but not connected to their fields

**Status: in progress.** Submit Training now shows a message under each missing
field, tied by `aria-describedby`, plus a summary at the top linking to each
one; `/account` and Create Shift tie theirs the same way. Add Member now ties
each message to its field and moves focus to a summary at the top on a refused
save.

**Add Member** (`/members/admin?tab=add`, as `membership_coordinator`): an empty
Save Member shows a toast and a red message under every required field — good —
but **no field gets `aria-invalid` or `aria-describedby`**, and **focus stays on
the button at the bottom of a 30-field form**. The first errors (name, member
number, address) are a long scroll above the viewport; a screen-reader user
hears only the toast.

**Training › Submit Training** (as `member`): an empty submit sets
`aria-invalid` and focuses Course Name — good — but **shows no error text**: the
only signal is a red outline and "2 fields left" in the sticky bar. Colour alone
does not meet WCAG 1.4.1 / 3.3.1.

**Scale:** `aria-invalid` appears in 62 of the 563 `.tsx` files that render form
controls.

**Suggested fix:** a shared field wrapper (label + required marker + hint +
error, ids generated and wired) would close F-3, F-4 and F-5 in one place. There
is no such component today: every form hand-assembles its own label and error
markup, and only the three Finance request forms use react-hook-form + zod
(already a dependency).

### F-5 — MED — The asterisk and the `required` state disagree

- **79 controls on 26 surfaces show `*` but carry neither `required` nor
  `aria-required`**, so assistive technology announces them as optional. Largest:
  Add Member (16 fields), Finance expense items (6), Skills-test template builder
  (9), Log Shift, Purchase / Check Request, Apparatus (4 each).
- **17 controls on 9 surfaces are required but show no `*`**: IP Security › New
  Request (all 4 fields), Waivers › Create Waiver, Evaluations › New review
  period and New evaluation, Create Custom Role, Facility type, Suggestion box.
- **Within one dialog:** Locations › Add Station stars both Station Name and
  Street Address, but only Street Address is `required`.

### F-6 — MED (owner decision) — Leaving a half-filled form discards it without a word

**Driven:** as `member`, typed a course name and a paragraph of notes into
Training › Submit Training, then tapped Dashboard in the navigation. The app
left immediately; **Back returned an empty form**. As `quartermaster`, typed a
name into Inventory › Add Item and pressed **Escape**: the dialog closed with no
prompt, and reopening it showed an empty field.

`hooks/useUnsavedChanges.ts` covers tab close and refresh only — its header
explains that `useBlocker` needs a data router and the app mounts
`<BrowserRouter>` — and four pages use it. Finance's purchase request keeps a
server-side draft (`useDraftAutosave`); nothing else does.

This needs a decision rather than a patch, because the options differ in cost:

1. **Move to a data router** (`createBrowserRouter`), which makes `useBlocker`
   available app-wide. Broad change to `App.tsx` and every module's
   `get{Module}Routes()`.
2. **Local drafts** for the long, member-facing forms (training submission,
   shift report, expense report, Add Member) — `sessionStorage`, keyed by user
   and form, restored on return. Note the HIPAA rule: anything holding PHI
   (medical screening, emergency contacts) must not be drafted client-side.
3. **Escape asks first** in a dialog with changed fields (Pitfall #31 keeps
   Escape as the WAI-ARIA exit; a confirm on a dirty form keeps that exit while
   preventing the loss).

### F-7 — LOW — 69 form surfaces are not `<form>` elements, so Enter does nothing

**385 controls on 69 surfaces** sit outside any `<form>`: pressing Enter in a
field neither submits nor validates. Verified on `/account` (typed a Middle
Name, pressed Enter, reloaded — not saved). Largest surfaces: History settings
and its Add a step dialog, Skills-test template builder, Training › Create
Session, Scheduling settings, `/account`, New Inspection, Add Facility, New
Maintenance Record, Record Minutes, Add Station, Apparatus (basic), Org Chart
position, New approval chain.

Wrapping each in `<form onSubmit>` with a `type="submit"` button (or
`form="…"` on a footer button, as `ItemFormModal` already does) also gives the
native `required` checks somewhere to run.

### F-8 — LOW — Unlabelled and placeholder-labelled controls

- **No accessible name (5):** the CSV file inputs on Members › Import CSV,
  Scheduling › History import and Integrations › Historical import, and both
  file inputs on the inventory checklist template builder. Each has visible
  "Drop a CSV here…" text that is not tied to the input.
- **Placeholder as the only label (4):** Scheduling settings › Notifications
  email (`email@example.com`), Inventory › Add Kit "Custom item name", Reorder ›
  "Search inventory to link…", Skills Testing "Search available tests…". The
  label vanishes as soon as the member types.

### F-9 — LOW — Input types and autofill hints

- **`/account` has no `autocomplete` tokens** on the member's own name, phone
  and address. `given-name`, `family-name`, `tel`, `street-address`,
  `address-level2`, `address-level1` and `postal-code` let a phone fill them in
  one tap. (Forms about _someone else_ — Add Member, Add Donor, vendors — are
  the opposite case: there, the browser offering the officer's own details is
  wrong, and `autocomplete="off"` is the better hint.)
- **Phone numbers typed as plain text (3):** Vendors › Fax, Org Chart › Contact
  phone, Reorder › Vendor Contact — no `type="tel"`, so a phone shows the full
  keyboard.

### F-10 — LOW — A must-change-password sign-in renders the dashboard first

**Driven:** four accounts with `must_change_password = 1` signed in. Each went
`/login → /dashboard → /account`: the dashboard mounts and fires its requests,
then the redirect lands once the user record loads. The change is enforced —
nothing is reachable after it — but the detour is visible, and it made
`scripts/workflow-review/seed.mjs` fail intermittently: its first-sign-in check
read the path during the detour and stopped at `review_scheduling_officer`
("expected the forced password change, landed on /dashboard"). Deciding the
landing from the login response's `must_change_password` would remove both.

### F-11 — NIT

- **Add Member's example placeholders read as filled values.** "Bob Doe",
  "bob.doe@example.com" and "(555) 987-6543" in the optional secondary-contact
  block are dark enough at a glance to look entered.
- **A failed sign-in leaves focus nowhere** — the wrong password stays in the
  field and focus is not returned to it.
- **`/training/requirements`** — axe `nested-interactive` and `target-size` on
  six rows: an external link sits inside a clickable row.

## Suggested order

1. **F-1** — small, backend-led, stops a data-integrity hole.
2. **A shared field component + 422 field mapping** — closes most of F-2, F-3,
   F-4 and F-5 together. Adopt it on the forms members use most first (Submit
   Training, `/account`, Add Member, Create Shift, Create Event), then sweep the
   rest module by module.
3. **`maxLength` from the schema** (F-2 part 1) — mechanical, can ride along
   with step 2 per form.
4. **`<form>` wrappers** (F-7) and the F-8 / F-9 attributes — mechanical.
5. **F-6** once the owner picks an option.

## Reproducing

The sweep scripts were kept out of the repository (they are review tooling,
not product code). Re-running needs the workflow-review harness
(`scripts/workflow-review/start.sh --reset`, then `seed.mjs`), after which a
Playwright script with a role's saved session from `.workflow-review/` can
visit each route as above. Ask for the scripts if a follow-up sweep is wanted
after fixes land.
