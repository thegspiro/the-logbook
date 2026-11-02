# Workflow Review — W71b Medical Screening, Deep Dive

**Driven:** 2026-11-02 · **As:** `admin`, `member2` (given a new Medical Officer position), `member` · **Viewports:** 1280×900, 390×844
**Commit:** `8700f3cf` plus this run's changes · **Database:** fresh (`start.sh --reset`, then the seed)

A second pass over W71. It drives what W71 left out (prospects, a prospect
becoming a member, deletion, a non-admin officer recording their own
screening) and then checks the module's answers against the other screens
that describe the same people: the member's dashboard and the Members
administration hub.

---

## What was driven

1. As `admin`, Add Requirement: "Annual Physical (NFPA 1582)", left at the
   form's defaults, then edited to recur every 12 months; "Pre-membership Drug
   Screen", one-time.
2. Records, through the API so dates could be placed (all `201`):
   - Jordan Avery: physical passed 1 Dec 2025, expiring 1 Dec 2026; drug
     screen passed 2024.
   - Alex Brooks: physical passed 15 Sep 2025 **with no expiration date**;
     drug screen passed 2024.
   - Blair Carter: physical passed, valid; **no drug screen**.
   - Cameron Diaz: physical **waived**, valid; drug screen passed.
3. As `admin`, Add Record through the form: Jordan Avery, Annual Physical,
   **Failed**, completed 25 Oct 2026, with a result summary.
4. Compliance tab: the tiles, the roster, and View on Jordan and Alex.
5. Created prospect Rowan Vale and recorded both screenings for them as passed
   through the form, using its Prospect option. Then transferred Rowan to
   membership (`POST /prospective-members/prospects/{id}/transfer`) and read
   the roster and `GET /compliance/{new user id}`.
6. As `admin`, created a **Medical Officer** position holding
   `medical_screening.view` and `.manage` (after the step-up password
   prompt) and assigned it to `member2` (Alex Brooks). As `member2`, recorded
   their own physical through the form and opened their own compliance.
7. Deleted a scheduled vision & hearing record for Devon Ellis through the
   Records tab, then checked it was gone after a reload.
8. As `member` (Jordan Avery): the dashboard readiness line,
   `GET /medical-screening/compliance/me`, and `/medical-screening`.
9. As `admin`: `GET /admin-hub/members/summary` and `/metrics`, which back the
   Members administration page.
10. At 390×844 as `admin`: the Compliance tab, View, and the Add Record dialog.

Not driven: requirement deactivation, position-scoped requirements (both
pinned by pytest), and the MCP tools.

## Held up ✅

- Prospect recording: the Prospect option lists open prospects only, the
  record saves, and Rowan graded "2 of 2 met · Compliant".
- Self-recording by a non-admin officer: `member2` with only the new position
  reached the page, recorded their own physical, and it counted. The roster
  panel, the records list and the expiring list all label it
  **Self-recorded** (MS-7, an owner decision).
- Frequency grading (W71-1): Alex's undated physical, completed 15 Sep 2025,
  graded **not met**: it fell due 15 Sep 2026.
- A waived physical counts toward compliance (Cameron is "2 of 2 met").
- The delete dialog warns the delete is final. The record was gone after a
  reload, and `events` were clean.
- `member` is refused at `/medical-screening` (Access Denied), and
  `compliance/me` returns counts only.
- No request in the run returned a status of 400 or above. The only refusals
  were the designed step-up `403`, a `422` for a slug the API generates
  itself, and a `422` that followed from that failed create.

## Findings

### W71b-1 — HIGH — A failed screening does not count against the member — FLAGGED

**Did:** recorded Jordan Avery's annual physical as **Failed** on 25 Oct 2026,
with "Failed cardiac stress portion; not cleared for interior attack." Jordan
has an older physical, passed 1 Dec 2025.
**Saw:**

- The roster shows "2 of 2 met · 1 expiring soon", **Expiring soon**.
- Jordan's View panel: "Physical Exam · Passed · last Dec 1, 2025 · expires
  Dec 1, 2026". It does not mention the failed result.
- Jordan's own dashboard: "**Clear, with conditions** — a screening expiring
  in 29 days".

All three screens agree with each other. All three call a firefighter who
failed their fitness-for-duty physical a week ago cleared.
**Expected:** a newer failed result should at least be visible wherever the
member's standing is shown. Most likely it should also make the requirement
unmet until a later pass.
**Where:** `backend/app/services/medical_screening_service.py`, `_grade`. It
filters to `_SATISFYING_STATUSES` before it picks the latest record, so a
failure is never considered. `superseded_record_clause` does the same, so the
expiring list keeps showing the older pass as "expiring".
**Why flagged, not fixed:** it changes the standing of records already saved,
and departments may differ. Some treat a failure as "not cleared until
re-tested". Others record a failed sub-test that a later provider overrides.
Options:

- (a) the most recent dated result of the type decides, so a failure makes
  the requirement unmet;
- (b) keep the grade and show "a newer failed result exists" on the panel
  and roster;
- (c) leave it as it is.

Mirrored to KNOWN_LIMITATIONS.

### W71b-2 — HIGH — Converting a prospect to a member leaves their screenings behind — FLAGGED

**Did:** Rowan Vale passed both screenings as a prospect ("2 of 2 met"), then
was transferred to membership.
**Saw:** the new member Rowan Vale is "0 of 2 met · **Not compliant**", and
`GET /records?user_id=<new id>` returns nothing. Both records still carry
only `prospect_id`, and the prospect is now TRANSFERRED, so it is off the
roster. The pre-membership drug screen they passed a week earlier is owed
again, as far as every screen can tell.
**Where:** `MembershipPipelineService._do_transfer`
(`membership_pipeline_service.py`) never touches `screening_records`.
`get_compliance_roster` assumes otherwise: "a converted prospect's records
carry both ids".
**Why flagged:** the fix writes PHI rows. On transfer it would set `user_id`
on the prospect's records and keep `prospect_id`. A data migration would
backfill every prospect already transferred (`transferred_user_id`). That
needs the owner's approval, and a test with rows present (pitfall #35).
Mirrored to KNOWN_LIMITATIONS.

### W71b-3 — MED — The Members administration hub grades screenings its own way — FLAGGED

**Did:** read `GET /admin-hub/members/summary` and `/metrics` with the records
above, beside the Compliance tab.
**Saw:**

- **Screenings current** (an optional tile): "**20%** — 4 of 20 cleared".
  The Compliance tab has 2 members fully compliant and 1 expiring soon. The
  hub counts anyone with one unexpired passed or completed record of any
  type. So:
  - Blair (no drug screen) counts as cleared;
  - Alex counts as cleared, though their undated physical lapsed by
    frequency;
  - requirements, position scoping and waivers are not consulted.
- **Needs attention**: 0, "nothing waiting". Alex's lapsed physical is not
  there, because the expired query reads `expiration_date` only and ignores
  the frequency rule (W71-1). The Compliance tab lists Alex as not compliant.
- The expired-screenings item, when it does fire, says "**blocks duty
  assignment**". Nothing does: no scheduling code reads screening records.
  This is the shape of pitfall #19.

**Where:** `backend/app/services/admin_hub_service.py`:
`_members_screening_current` and the `expired_screenings` block of
`_members_attention`. This is pitfall #29: a second screen re-derives what
`MedicalScreeningService` already decides.
**Why flagged:** the natural fix is to build both from
`get_compliance_roster`. That changes what the tile means ("fully compliant"
rather than "has any screening") and which members it counts. Probationary
counts in both. Leave and suspended count only in the roster. Whether
"blocks duty assignment" should become true is a product decision. Mirrored
to KNOWN_LIMITATIONS.

### W71b-4 — MED — Nothing tells anyone a screening is about to expire — FLAGGED (read from code)

No scheduled task, email or notification reads screening records. A grep of
`app/` finds only the module itself, the admin hub, anonymization and
onboarding. A medical officer learns of a lapse only by opening the
Compliance tab, and a member only from the dashboard line. Every other
expiring credential in the app (certifications, stock lots) sends a
reminder. This would be new behaviour, and under CLAUDE.md pitfall #18 it
would be email-first. Mirrored to KNOWN_LIMITATIONS.

### W71b-5 — LOW — A new requirement defaults to one-time — FLAGGED

**Did:** Add Requirement, typed "Annual Physical (NFPA 1582)", chose Physical
Exam, saved.
**Saw:** "Physical Exam — **One-time**". The One-time box starts ticked for a
new requirement (`useState(!requirement?.frequency_months)`). The hidden
Frequency field is already filled in with 12, which suggests recurring was
the intent. An officer who does not notice the box creates an annual physical
that never falls due.
**Where:** `ScreeningRequirementForm.tsx:32`.
**Why flagged:** it is a one-line change, but it changes what a quick Add
creates. It needs the owner's call.

### W71b-6 — LOW — View opened the member's panel off-screen — ✅ FIXED

**Did:** Compliance → View on Jordan Avery, at 390×844 and at 1280×900.
**Saw:** the button highlighted and nothing else seemed to happen. The panel
renders below the whole roster: about 1,300px below the row on a phone, and
below the fold on a laptop with 21 members.
**Fix:** `SubjectCompliancePanel` scrolls itself into view and moves focus to
its heading whenever the subject changes. A screen reader lands on the name
that was asked for. Re-driven: the heading is in view and focused at both
sizes. Test: `SubjectCompliancePanel.test.tsx` "brings itself into view and
takes focus" fails on the old component.

### W71b-7 — LOW — A failed result was given a one-year expiration — ✅ FIXED

**Did:** Add Record, Annual Physical, completed 25 Oct 2026, status Failed.
**Saw:** Expiration Date filled in as 25 Oct 2027, with "Filled in from the
requirement's 12-month frequency", and saved that way. A failed record with
an expiration a year out reads like a clearance to the next officer.
**Fix:** the form suggests no expiration for a Failed or Expired result. It
withdraws a suggestion when the status changes to one of them and restores it
when the status changes back. A date the officer typed is never touched.
Re-driven: 2027-10-25 cleared to blank on choosing Failed. Tests: three new
cases in `ScreeningRecordForm.expiration.test.tsx`. Two fail on the old form.
The third pins that a typed date is kept.

### W71b-8 — LOW — The delete confirmation did not say whose record — ✅ FIXED

**Saw:** "Delete this Vision & Hearing record? You can't undo this." This is
the same sentence for every member with that screening type, on a permanent
delete.
**Fix:** "Delete Devon Ellis's Vision & Hearing record? You can't undo this."
It names the prospect for a prospect's record and keeps "this" for a record
with no subject. Test: `MedicalScreeningPage.delete.test.tsx` fails on the
old page.

### W71b-9 — LOW — Dialog buttons were 36px on a phone — ✅ FIXED

**Saw:** Cancel and Add Record / Add Requirement measured 36px tall at
390×844. Their class strings were typed by hand, with no touch sizing.
**Fix:** `touch:min-h-11` on both buttons in both forms. Re-measured at 44px.
Test: `ScreeningForms.touchTargets.test.tsx` fails on the old forms.

## Checklist

| Section                 | Result                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | ❌ a failed physical reads as cleared (W71b-1); a converted prospect's screenings are lost (W71b-2) |
| 2. The right people     | ✅ a non-admin Medical Officer works; `member` refused; self-records labelled                       |
| 3. Wrong input, failure | ⚠️ → ✅ failed result no longer given an expiration                                                 |
| 4. Browser signals      | ✅ no unexpected 4xx/5xx                                                                            |
| 5. Coming back to it    | ✅ delete checked after a reload                                                                    |
| 6. On a phone           | ❌ → ✅ panel off-screen and 36px buttons fixed                                                     |
| 7. Everyone can use it  | ✅ focus now moves to the opened panel                                                              |
| 8. What happens around  | ❌ the admin hub disagrees (W71b-3); no expiry reminders (W71b-4)                                   |

## Completion gate

| Check                    | Result                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                                               |
| npm run lint             | ✅ 0 errors, 0 warnings (run with `NODE_OPTIONS=--max-old-space-size=6144`; the default heap ran out while the review servers were up) |
| flake8 / black           | n/a — no Python changed                                                                                                                |
| frontend tests (touched) | ✅ `src/modules/medical-screening` and `dateFormatting.test.ts`: 183 passed; dialog and touch-target integrity tests: 12 passed        |
| backend tests (touched)  | n/a — no Python changed                                                                                                                |
