# Workflow Review — W22 A Public Event Request and Its Status Link

**Driven:** 2026-09-29 · **As:** anonymous, `secretary`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `29e3d551f` plus this run's changes · **Database:** continued from W21

---

## What was driven

1. As `secretary`, Events → Administration → Settings → Forms: generated the
   public request form, published it from Forms, and read its public URL
   (`/f/e8130cfaba41`).
2. Anonymous, at 390×844 and 1280×900, on `/f/e8130cfaba41`: filled every
   field (contact, outreach type, date flexibility, timeframe, venue, special
   requests) and submitted by double-clicking Submit.
3. As `secretary`, Events → Administration: the hub's "1 public event request
   awaiting a reply", then Requests: opened the request, ticked Review
   Request, pressed Start Working, and used Copy Link to read the status link.
4. Anonymous, at 390×844 and 1280×900, on `/event-request/status/<token>`:
   read progress (1/6) and status; then "Need to cancel this request?" → "Yes,
   Cancel Request", and reloaded.
5. As `secretary`: the request reads Cancelled in the list ("Cancelled (1)"),
   and its activity log reads `cancelled_by_requester` / "Cancelled by
   requester".
6. As `member`: `GET /event-requests` and `/events/admin?tab=requests`.
7. As `secretary`, Settings → Pipeline: the Default Coordinator list.

Not driven: the email the requester and the coordinator receive. The
harness does not deliver mail, so what the acknowledgement says is read
from code (`event_request_service.send_request_notification` and the
default templates in `email_template_service.py`).

## Held up ✅

- The anonymous submission created **one** request despite the double-click,
  and it appeared for `secretary` after a reload with the contact, organization,
  outreach type and timeframe that were typed. `events` was clean.
- Ticking a pipeline task on the secretary's side showed on the anonymous
  status page as "Planning Progress (1/6)" with Review Request ticked; Start
  Working moved both views to In Progress.
- The requester's cancel asked first, took effect on the first tap, survived
  a reload, and reached the coordinator: status `cancelled` and a
  `cancelled_by_requester` entry in the activity log.
- `member` was refused: `GET /event-requests` returned **403**, and the
  Requests tab rendered Access Denied.
- The form and the status page fit 390×844 with no horizontal scroll.
- The status page's "9/29/2026" is the harness's UTC browser clock, which is
  also the date in the department's zone at that hour — not a defect.

## Findings

### W22-1 — MED — The public request form's fields had no accessible names — ✅ FIXED

**Did:** anonymous, on `/f/e8130cfaba41`, listed each control and its label.
**Saw:** every `<label>` was a bare sibling of its control — no `htmlFor`, no
`id` on the input — so a screen reader announced "edit text" for Contact
Name, Email, Phone and the rest, and the checkbox group had no group name. A
member of the public using assistive technology could not tell which box was
which on the one form the department publishes to strangers.
**Expected:** each control named by its label.
**Where:** `frontend/src/pages/PublicFormPage.tsx:18`, `:136`, `:240`, `:260`.
**Fix:** each control gets `id={fieldInputId(field.id)}` and its label
`htmlFor`; the time and date-time pickers take the label as their name; a
checkbox group is a `<fieldset>` with its label as the `<legend>`. Radio and
checkbox fields keep their per-option labels. Covered by the new
`PublicFormPage.test.tsx`, which finds each field type by its label and
failed against the old page. Re-driven: every labelled control resolves and
none is left unnamed.

### W22-2 — LOW — A pipeline task's done state was shown only by an icon — ✅ FIXED

**Did:** `secretary`, Requests → the request → Pipeline Tasks.
**Saw:** each task is a toggle button whose state is a checkbox icon and a
strikethrough; nothing exposed it, so "Review Request" read the same done or
not.
**Where:** `frontend/src/pages/EventRequestsTab.tsx:864`.
**Fix:** `aria-pressed={isCompleted}`. Covered by the new
`EventRequestsTab.test.tsx` (fails without it) — the first test to render
this tab.

### W22-3 — LOW — The coordinator lists showed rank codes ("fire_chief") — ✅ FIXED

**Did:** `secretary`, Settings → Pipeline → Default Coordinator, and a
request's Assign.
**Saw:** options read "Sam Ortiz — fire_chief".
**Where:** `frontend/src/pages/events-settings/PipelineSection.tsx:51`,
`frontend/src/pages/EventRequestsTab.tsx:774`.
**Fix:** both use `useRanks(false).formatRank`, including inactive ranks so a
retired rank still reads by name. Covered by `EventRequestsTab.test.tsx`
(fails with the raw code). Re-driven: "Jordan Avery — Firefighter".

### W22-4 — MED — The requester is never given their status link — FLAGGED

**Did:** anonymous, submitted the form.
**Saw:** "Thank you for your submission!" and nothing else — no link, no
reference, no mention of an email. Read from code: neither the
acknowledgement nor the status-change email carries the link (no template
variable exposes `status_token`; `grep` finds the status URL built only in
`EventRequestsTab.tsx:477`, behind Copy Link). The status page itself
promises "You will receive email updates when your request status changes"
— and still says so after the request is cancelled — though those emails
depend on the department having enabled the triggers.
**Expected:** a requester can reach the page that shows their progress and
lets them cancel without a coordinator copying the link to them by hand.
**Where:** `backend/app/api/public/forms.py:213`,
`backend/app/services/event_request_service.py:529`,
`frontend/src/pages/EventRequestStatusPage.tsx:364`.
**Not fixed because:** the options change what a public endpoint returns or
what the department emails a stranger — show the link on the confirmation
screen (the form endpoint returns a generic message for every integration),
add a `{{status_link}}` to the default acknowledgement (a department's
customised template would not carry it), or both. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

### W22-5 — NIT — "Go to Forms to edit and publish" is plain text — OPEN

**Where:** `frontend/src/pages/events-settings/FormSection.tsx:151`.
The section's own "View all forms" link below does the job, so this is left.

## Checklist

| Section                 | Result                                                                |
| ----------------------- | --------------------------------------------------------------------- |
| 1. The job gets done    | ✅ submit, triage, progress, cancel all round-trip                    |
| 2. The right people     | ✅ `member` 403 on the API and Access Denied on the tab               |
| 3. Wrong input, failure | ✅ double submit made one request                                     |
| 4. Browser signals      | ✅ clean `events` on every step                                       |
| 5. Coming back to it    | ✅ status and cancellation survive reload, both sides                 |
| 6. On a phone           | ✅ form and status page at 390×844                                    |
| 7. Everyone can use it  | Fixed W22-1, W22-2                                                    |
| 8. What happens around  | Flagged W22-4 — the link never reaches the requester; mail not driven |

## Completion gate

| Check                    | Result                                                            |
| ------------------------ | ----------------------------------------------------------------- |
| npm run typecheck        | clean                                                             |
| npm run lint             | clean                                                             |
| flake8 (changed files)   | no Python changed                                                 |
| black --check            | no Python changed                                                 |
| frontend tests (touched) | `PublicFormPage.test.tsx`, `EventRequestsTab.test.tsx` — 3 passed |
| backend tests (touched)  | none touched                                                      |
