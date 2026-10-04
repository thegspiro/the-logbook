# Workflow Review — W60 Forms: Build, Publish a Public Form, Submit It, Read Submissions

**Driven:** 2026-10-02 · **As:** `admin`, a signed-out visitor, then `member` · **Viewports:** 1280×900, 390×844
**Commit:** `9a3114d` plus this run's changes · **Database:** fresh (`start.sh` on a new session; the seed onboarded a new department)

The run focused on what the request asked for: branching ("conditional
visibility") questions, required questions, and how the two interact — above
all that a required question inside a branch cannot hold a form up once that
branch is closed.

---

## What was driven

1. As `admin`, from the dashboard: More → Admin → **Forms**. Create Form
   "Volunteer Intake (W60)", public.
2. Edit Fields, through the field editor:
   - "Do you hold a medical certification?" — radio Yes/No, required;
   - "Which certifications?" — checkbox EMT / AEMT / Paramedic, required,
     shown when the first **equals** Yes;
   - "EMT card number" — text, required, shown when the checkboxes
     **contain** EMT;
   - "Full name" — text, required;
   - "Years of service" — number, min 0 / max 60, shown on Yes.
3. Preview & Submit:
   - Yes → ticked **AEMT** only;
   - Yes → EMT → then switched the top answer to **No**, filled Full name,
     Submit;
   - a valid response (Yes, EMT, card, name, years), then the Submissions tab.
4. Publish Form; Share → "Allow submissions without signing in". As a
   signed-out visitor on `/f/<slug>`: the same Yes → EMT → No sequence, and the
   same answer sets sent straight to `POST /api/public/v1/forms/<slug>/submit`.
5. Builder edits:
   - reopened "Years of service"; removed its condition and cleared its
     placeholder; saved; read it back through the API;
   - gave the top question a rule depending on its own grandchild;
   - Duplicate on "EMT card number";
   - Delete on a question with a follow-up.
6. As `member`: `/forms`, `GET /forms`, a field `PATCH`, the submissions list.
7. After the fixes, steps 3–5 again, then the public form and the field editor
   at 390×844.

Not driven: integrations (W16 / W22 cover the membership and event-request
consumers), the Results tab's charts, CSV export, file and signature fields.

## Held up ✅

- **Way in:** Forms is reachable from the navigation (More → Admin → Forms).
- **Happy path:** a valid response saved and was listed on Submissions as
  "Riley Owner · Oct 2, 5:27 PM". The server time was 22:27Z, so the time is
  shown in the department's timezone (America/Chicago). The `events` list was
  empty.
- **Required:** a required question that _is_ shown was still enforced, both in
  the browser and by the server. "EMT" ticked with no card number got a 400,
  before the fixes and after.
- **Permissions:** `member` got Access Denied on `/forms`, and 403 on a field
  `PATCH` and on the submissions list. `GET /forms` answers 200 to a member by
  design: `forms.view` is a baseline grant, so other modules can list published
  forms.
- **Anonymous submission:** the Share dialog says plainly that submitting needs
  a sign-in until "Allow submissions without signing in" is ticked. The API
  refused the anonymous POST with 401 until it was.
- **Phone, after the fixes:** no sideways overflow on the public form or the
  builder (scroll width 15px under the viewport). The field editor's title
  (y=59) and Update button (bottom 785) were both on an 844px screen.

## Findings

### W60-1 — HIGH — A required follow-up of a closed branch stayed on screen and required — ✅ FIXED

**Did:** as `admin` in Preview & Submit, answered Yes → ticked EMT → then
changed the top answer to No, filled Full name, pressed Submit. The same steps
were repeated as a signed-out visitor on the public link, and the same answers
were sent to the API.
**Saw:** "Which certifications?" disappeared, but its follow-up "EMT card
number*" stayed on screen. Submit gave "Fix the errors below. EMT card number is
required". The public page blocked the form through the browser's own
`required` check, with no message at all. The API returned
`400 Required field 'EMT card number' is missing`. So a person who said they
hold no certification could not send the form without inventing a card number.
**Expected:** a question that branches from a hidden question is hidden too,
and is not required.
**Where:** visibility was judged one level deep in three copies of the rule:
`FormRenderer.tsx` `isFieldVisible`, `PublicFormPage.tsx` `isFieldVisible`, and
`FormsService._is_field_visible`. A hidden question's leftover answer still
opened its follow-ups.
**Fix:**

- One frontend definition, `utils/formVisibility.ts` `getVisibleFieldIds`,
  used by both renderers. Its backend twin is
  `FormsService._visible_field_ids`. A field shows only when its own rule
  passes **and** the question it branches from is shown.
- Both submit paths and `_sanitize_submission_data` use it.
- Both renderers leave hidden questions' answers out of the payload. They stay
  in state, so switching back restores them.
- The in-app renderer no longer lists errors for questions that have since been
  hidden.
- `_is_field_visible` is kept as the single-rule check: the cleanup script
  `clear_hidden_form_answers.py` decides deletions with it, and those decisions
  must not move.
- Tests: `formVisibility.test.ts`, `FormRenderer.branching.test.tsx`,
  `PublicFormPage.test.tsx` (branching block) and `test_form_branching.py`.
  They fail on the old code.

### W60-2 — MED — "Contains" on a checkbox matched part of an option — ✅ FIXED

**Did:** Yes → ticked **AEMT** only.
**Saw:** "EMT card number*" appeared, required, because "AEMT" contains "EMT".
**Expected:** the rule's value is picked from the parent's option list, so
"contains EMT" means "EMT is one of the ticked options".
**Where:** the `contains` branch of the visibility rule, on the frontend and in
`forms_service.py`.
**Fix:** when the parent is a checkbox or multi-select, "contains" compares
whole comma-separated options, ignoring case. Free-text parents still match
substrings. Tested on both sides.

### W60-3 — MED — Removing a condition, or clearing a setting, reported success and changed nothing — ✅ FIXED

**Did:** edited "Years of service", set the condition to "No condition (always
show)", emptied Placeholder, pressed Update Field, and read the field back.
**Saw:** the save gave no error. The stored field still had
`condition_field_id`, `equals` and `yes`, the row still said "Conditional", and
the placeholder was still "e.g. 5".
**Expected:** the clear is saved. This is CLAUDE.md pitfall 1: the editor left
blank settings out of the payload, and `PATCH /forms/{id}/fields/{id}` is
`exclude_unset`.
**Where:** `FieldEditor.tsx` `handleSave`; `FormBuilder.tsx` `handleSaveField`.
**Fix:**

- `FormBuilder` turns the editor's output into a `FormFieldUpdate`. Every
  blank setting the editor owns is sent as `null`.
- The offline (unconnected) builder clears the same keys.
- The service clears the operator and value when the controlling question is
  cleared.
- `FormFieldUpdate.condition_operator` now has the same pattern validation as
  create.
- Re-driven: all three condition columns and the placeholder came back `null`.

### W60-4 — MED — The builder allowed a cycle, which hid a whole branch from everyone — ✅ FIXED

**Did:** edited the top question and made it depend on "EMT card number" (its
own grandchild) being answered.
**Saw:** it saved. The preview then showed only "Full name". The first three
questions, all required, were gone for every submitter.
**Expected:** a question cannot branch from itself or from anything that
branches from it.
**Where:** `FieldEditor.tsx` (`conditionTargets` excluded only the field
itself); `FormsService.add_field` / `update_field` (no check).
**Fix:**

- The editor no longer offers the field or its descendants.
  `getDescendantFieldIds` is the helper; re-driven, the top question was offered
  only "Full name" and "Years of service".
- The API refuses a cycle with 400 "A field cannot depend on itself or on a
  question that depends on it".
- The API also refuses a parent that is a section header, or a question not on
  this form (CLAUDE.md pitfall 14c).

### W60-5 — MED — Duplicating a follow-up dropped its condition — ✅ FIXED

**Did:** Duplicate on "EMT card number".
**Saw:** the required copy had no condition, so it was shown to, and demanded
of, every submitter.
**Where:** `FormBuilder.tsx` `handleDuplicateField`. It also dropped min/max
values.
**Fix:** the copy keeps the condition and the numeric limits. Re-driven, the
copy carried `contains EMT` on the same parent.

### W60-6 — MED — Deleting a question took one tap and orphaned its follow-ups — ✅ FIXED

**Did:** tapped the trash icon on a question with a follow-up ("License plate",
required, shown on Yes).
**Saw:** it was deleted at once, with no confirmation, on a published form.
Its follow-up kept a rule pointing at a question that no longer existed. Such a
rule reads an empty answer forever: "equals yes" hides it from everyone, and
"is empty" shows it to everyone. The builder still badged it "Conditional".
(The same unconfirmed tap also deleted "License plate" itself during the drive,
because the next trash icon sat where a confirmation would have been.)
**Fix:**

- Delete asks first through `useConfirm`. The dialog names the follow-ups and
  says they will be shown to everyone.
- `FormsService.delete_field` clears those follow-ups' rules in the same
  transaction.
- The editor drops a stale rule left by an earlier deletion instead of saving a
  reference the API now refuses.
- Re-driven: the dialog read "…One question branches from it ("License plate");
  it will be shown to everyone instead.", and the follow-up's rule came back
  `null`.

### W60-7 — LOW — Reopening a number field showed its limits as blank — ✅ FIXED

**Did:** set min 0 / max 60 on "Years of service", then reopened it.
**Saw:** both boxes were empty, although the API had 0 and 60. With W60-3's fix
in place, the next save would have cleared them.
**Where:** `FormBuilder.tsx` `handleEditField` did not pass
`min_value` / `max_value`.
**Fix:** they are passed. `min_value` / `max_value` are typed
`number | undefined` like their siblings. Re-driven: 0 and 60.

### W60-8 — MED — The in-app form renderer named none of its fields — ✅ FIXED

**Did:** `getByLabel("Full name")` in Preview & Submit.
**Saw:** nothing was found. Every `<label>` in `FieldRenderer` lacked
`htmlFor`. Checkbox and multi-select groups had no group name, and the error
summary's "jump to field" link had no element to focus for them. This renderer
also draws prospective-member applications.
**Fix:**

- Single-control types get `htmlFor="field-<id>"`. The member-lookup input
  now carries that id too.
- Checkbox and multi-select groups are a `role="group"` labelled by the field
  label, with the id the error summary links to.
- Test: "names text inputs and checkbox groups by their labels".

### W60-9 — LOW — The editor accepted a rule with no value, and kept a value from the previous parent — ✅ FIXED

**Saw (read from code, then driven):** "equals" with an empty value saved, and
behaved like "is empty". Choosing a different controlling question kept the
value picked for the old one. The operator list's blank entry read "Always show
(no condition)" even after a question was chosen.
**Fix:**

- The editor refuses "Choose when this field should show" (no operator) and
  "Enter the answer this condition compares against".
- Changing the controlling question resets the value.
- The blank operator entry now reads "Choose a condition…".
- Tested in `FormBuilder.branching.test.tsx`.

### W60-10 — LOW — The field-type picker was a radio group of plain buttons — ✅ FIXED

**Saw:** `role="radiogroup"` held buttons with no `role="radio"` or checked
state, so a screen reader could not tell which type was selected.
**Fix:** `role="radio"` with `aria-checked`. Asserted in the builder test.

### W60-11 — MED — The public page lets a visitor fill in the whole form before saying they must sign in — ✅ FIXED (2026-10-03)

**Saw (API driven; page read from code):** a new form defaults to
`require_authentication = true`. The public link opens to anyone. Before the
Share toggle, the anonymous submit got
`401 Authentication is required to submit this form`. `PublicFormPage` showed
that only after Submit, with no sign-in link, so the visitor's answers were
wasted.
**Decision:** the owner chose the notice over changing the default, so who may
submit is unchanged.
**Fix:**

- `PublicFormPage` resolves the session the way `ProtectedRoute` does
  (`loadUser`, which calls the server only when `has_session` is set).
- When the form needs a signed-in member (`require_authentication`, or one
  response per person) and the visitor is not one, a notice above the
  questions says so. Its Sign in button returns to `/f/<slug>` after sign-in.
- The notice also appears if the server still refuses a submission with 401,
  for example after a stale session.
- Tests: the "sign-in notice" block in `PublicFormPage.test.tsx`; three of its
  five tests fail without the change.
- **Driven:** a signed-out visitor saw the notice and followed Sign in. After
  signing in as `member` they landed back on the form, with no notice, and
  submitted. The submission is recorded under that member. At 390×844 the
  button is 44px tall and nothing overflows. With anonymous submission
  re-enabled, no notice appears.

## Behaviour changes to know about

- A form whose rules were written against the old one-level evaluation may now
  hide a question it used to show: a follow-up of a hidden question. That is
  the point of W60-1, but it applies to existing forms too.
- "Contains" on a checkbox or multi-select parent now needs a whole option.
  A rule that relied on matching part of an option (for example
  "contains para" against "paramedic") no longer matches, and must use the full
  option value.
- The field API now refuses a rule naming a question from another form, a
  section header, or a cycle, with a 400 naming the reason.

## Checklist

| Section                 | Result                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Held: built, published, submitted, read back. Fixed W60-1 to W60-7.                                         |
| 2. The right people     | Held: `member` refused the page and the mutations.                                                          |
| 3. Wrong input, failure | Held: shown required questions enforced; invalid rules now refused (W60-4, W60-9).                          |
| 4. Browser signals      | Clean: no console or page errors. The only 4xx were the deliberate refusals listed above.                   |
| 5. Coming back to it    | Held: a reload of `/forms` and the editor kept the stored fields; edits read back through the API.          |
| 6. On a phone           | Held at 390×844 after the fixes.                                                                            |
| 7. Everyone can use it  | Fixed W60-8 and W60-10.                                                                                     |
| 8. What happens around  | Held: the submission time is in the department's timezone. Email is off here; nothing claimed one was sent. |

## Completion gate

| Check                    | Result                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| npm run typecheck        | clean                                                                                                                    |
| npm run lint             | clean (0 errors, 0 warnings in touched files)                                                                            |
| flake8 (changed files)   | clean                                                                                                                    |
| black --check            | clean (isort clean too)                                                                                                  |
| frontend tests (touched) | 29 passed: `src/components/forms`, `formVisibility.test.ts`, `PublicFormPage.test.tsx`, FormsPage tests, `modules/forms` |
| frontend tests (full)    | 692 files, 8907 tests passed                                                                                             |
| backend tests (touched)  | 369 passed: every test file touching the forms service or `/forms`, unit and integration                                 |
