# Workflow Review — W79 Phone Pass: W08, W19, W24, W33, W39 and W70 Again at 390×844

**Driven:** 2026-10-23 · **As:** anonymous, `admin`, `member`, `training_officer`, `scheduling_officer`, `quartermaster`, a new member · **Viewport:** 390×844
**Commit:** `origin/main` of 2026-10-23 plus this run's changes · **Database:** continued from W78

---

## What was driven

Every page was measured the same way: sideways scroll, and every visible
control under 44px with its name, by a script run through the harness.

1. **The phone leads:**
   - signed out: `/login`, `/forgot-password`, `/privacy`, `/terms`;
   - as `admin`: Legal Documents;
   - the equipment checklist builder (`/inventory/admin/checklists/templates/new`),
     with a section added.
2. **W08** — as `admin`, Add Member: every required field, Save double-clicked;
   then the new member's first sign-in and the required password change.
3. **W19** — an event requiring RSVP; as `member`, RSVP Going (Submit
   double-clicked), then a reload.
4. **W24** — as `member`, submit a two-hour external training record; as
   `training_officer`, open it and Confirm Approval (double-clicked); as
   `member`, My Training.
5. **W33** — a shift with two Firefighter seats:
   - as `member`, take a seat (double-clicked), then My Shifts;
   - open the swap dialog, and file a time-off request (Submit double-clicked);
   - as `scheduling_officer`, the Requests tab, then approve it (double-clicked);
   - as `member`, the result.
6. **W39** — as `quartermaster`, Members → Assign items to Jordan Avery:
   - add the helmet by its serial number, choose Ongoing assignment, Confirm;
   - as `member`, My Equipment → Notify quartermaster of return;
   - as `quartermaster`, the inventory dashboard.
7. **W70** — as `member`: the QR clock-in page, Clock In, then the page again
   and Clock Out (double-clicked); as `admin`, every Admin Hours management
   tab.

Not driven:

- the onboarding steps of W01-13: an installed department cannot replay setup,
  so that lead stays;
- the quartermaster confirming the return (W39 drove it at desktop width);
- a swap actually filed.

## Held up ✅

- **Every flow completes on a phone:**
  - one member, one RSVP, one approval, one seat, one time-off request, one
    issue and one clock-out from each double-click;
  - each result read back after a reload or from the other role.
- **Pages with nothing wide:** the event list, training submit, My Shifts, My
  Equipment, the member list and the dialogs (RSVP, swap, time off,
  distribute, return notice) have no sideways scroll.
- **The first sign-in:** it goes straight to the required password change,
  then signs the member out everywhere with a clear message.

## Findings

### W79-1 — LOW — Sign-in and legal links were 14–36px tall — ✅ FIXED (W02-5, W03, W54-6)

- `/login`: "Forgot your password?" (16px), Privacy and Terms (14px), and
  the two fields (42px).
- `/forgot-password`: Back to sign in (36px).
- `/privacy` and `/terms`: Back to sign in and the cross link (16px).
- Legal Documents: "Open /privacy" and each "Read this version" (20px).

**Fix:** `touch:min-h-11`, or `touch:py-3` on a `<summary>`, where `flex`
would drop the disclosure triangle. Re-audited: none left.

### W79-2 — MED — Admin Hours management was 929px wide on a phone — ✅ FIXED

**Saw:** `/admin-hours/manage` was 929px wide. One category's details row
("Approval: Required · Manual entries: always reviewed · Max 12h/session")
did not wrap, and the list was a single implicit grid column, which sizes to
its content. This is the same mechanism as W77-5.
**Fix:** `grid-cols-1`, a wrapping details row, and the row's buttons kept
`shrink-0` (`CategoriesTab.tsx`). Re-audited: 375px.

### W79-3 — MED — Pending Review pushed Approve and Reject off the screen — ✅ FIXED

**Saw:** 502px wide. Each entry's actions sat beside it in a row that did not
wrap. The rejection form's reason field was a hand-built 33px box, and its
Cancel was 20px.
**Fix:** the header, the entry row and the action rows wrap. The reason field
uses `form-input`, and Cancel gets the touch minimum
(`PendingReviewTab.tsx`). On Summary, "Review now →" and "View source entries
→" (16–20px) do too.

### W79-4 — LOW — Event and RSVP controls under 44px — ✅ FIXED

Back to Events (20px), Add to Calendar (38px), Get Directions (20px) and
Change RSVP (20px) on the event page (`EventDetailPage.tsx`).

### W79-5 — LOW — My Training printed status codes — ✅ FIXED

**Saw:** the approved record read "completed". Its four status badges used
`status.replace('_', ' ')`, which also replaces only the first underscore.
**Fix:** `getTrainingStatusLabel` beside the existing
`getTrainingStatusColor`. Re-driven: "Completed".
`utils/trainingColors.w79.test.ts`.

### W79-6 — LOW — Reviewing a training submission on a phone — ✅ FIXED

Approve, Request Revision and Reject were 32px. "Override values before
approving" was 16px, and the pipeline checkbox was an unstyled 13px box
(`ReviewSubmissionsPage.tsx`). All now meet the touch minimum, and the
checkbox uses `form-checkbox`.

### W79-7 — LOW — Scheduling controls — ✅ FIXED

- **My Shifts:** "Subscribe to my shifts" (20px) and Request Time Off (38px)
  were small, and the swap and time-off dialogs' Cancel and Submit were 40px.
  The notification-history link is only a bell on a phone and was named by a
  `title` alone; it now has an `aria-label`.
- **Requests (officer):** the Swaps and Time Off tabs were 36px, Approve and
  Deny 28px, and "+ Notes" 30px. Every Notes button was named "Review with
  notes"; it now names the member ("Review the time off for Jordan Avery with
  notes").

### W79-8 — LOW — Inventory issue and return — ✅ FIXED

- **Name links:** the member list's names and item names (20px), and My
  Equipment's item links (17px).
- **Confirmation wording:** the Confirm Distribution summary said "permanent
  assignment" for the option labelled "Ongoing assignment". It now repeats
  the label (`InventoryScanModal.tsx`).

### W79-9 — MED — The checklist builder's section heading was 18px wide — ✅ FIXED (W46-18)

**Saw:**

- Add Section produced a heading field 18px wide, too narrow to read or type
  into.
- `min-w-[140px]` on it had no effect on a phone. The deliberate
  `@media (max-width: 767px) input { min-width: 0 }` in `index.css` is
  unlayered, so it beats every utility.
- Around it, the header and chip controls were 24–40px (Back to templates,
  the template name, "2 to fix", the Details / Tools / Save draft menu, the
  check timing and position chips, Section, Location, Import), and the drag
  handle was 20px.

**Fix:**

- The heading field has a 140px flex basis, which that rule does not touch,
  and the row wraps. Re-driven: 207px.
- Every control in the builder sized `min-h-8` to `min-h-10` gets
  `touch:min-h-11`; the back button and drag handles get
  `touch-target-phone`.
- Re-audited: nothing under 44px in the driven states.

### W79-10 — LOW — The inventory dashboard contradicts itself about what needs attention — FLAGGED

**Saw:** as `quartermaster`, after the member's return notice, the headline
tile read "Needs attention 0 · nothing waiting". Directly below it, the queue
read "Needs attention 1 — Pending return, Jordan Avery · W79 Structure
Helmet".
**Where (read from code):**

- The tile is the admin frame's `needs_attention` metric:
  `admin_hub_service._inventory_attention`, which counts exceptions such as
  PPE past service life and stock below par.
- The queue is built in `InventoryAdminHub.tsx` from pending returns,
  requests and clearances.

Two definitions under one name; CLAUDE.md pitfall 29.
**Why flagged:** which items count as "needs attention" is a product decision
for the shared admin frame, and either fix changes a number someone watches.
Mirrored to KNOWN_LIMITATIONS.

### Still open — W08-6

The refused requests before a required password change are now 25, not the
17 recorded in W08. That lead stands as written.

## Checklist

| Section                 | Result                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ all six flows completed on a phone                                               |
| 2. The right people     | ✅ each step as its own role; results read from the other role                      |
| 3. Wrong input, failure | ✅ the unchanged password gate held                                                 |
| 4. Browser signals      | ✅ the known W19 and W18 refusals; W08-6 still open                                 |
| 5. Coming back to it    | ✅ every result after a reload or from the other account                            |
| 6. On a phone           | ❌ → ✅ two pages wider than the screen, an unusable field, dozens of small targets |
| 7. Everyone can use it  | ❌ → ✅ an icon-only link named by `title`, identical Notes buttons                 |
| 8. What happens around  | ❌ the inventory attention count disagrees with its queue (flagged)                 |

## Completion gate

| Check                    | Result                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean (after replacing a `replaceAll` the project's lib does not include)                                                  |
| npm run lint             | ✅ clean, with `NODE_OPTIONS=--max-old-space-size=8192` (see the W77 tooling lead)                                            |
| flake8 / black           | n/a: no backend change                                                                                                        |
| frontend tests (touched) | ✅ 72 files, 1,061 tests across every touched page plus the touch-target and dialog integrity checks; the new test among them |
