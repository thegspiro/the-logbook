# Workflow Review — W16 Prospective Member from Application to Converted Member

**Driven:** 2026-09-28 · **As:** `membership_coordinator`, with `chief` as a required signer and `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `d935d9e` plus this run's fixes (re-driven) · **Database:** continued from W15; no reset

---

## What was driven

1. As `membership_coordinator`, opened Prospective Members on an install with no pipeline, and tried **Add Applicant**.
2. Pipeline Settings:
   - **Use Template**;
   - **Create Pipeline** ("Volunteer Applicants");
   - two stages from the presets: **Coordinator Approval** (Manual Approval, Required) and **Officer Sign-Off** (Multi-Signer Approval, Required: "Require Chief and President to both approve").
3. Added Pat Applicant through the fixed form.
4. Opened Pat. Tried **Skip** on the required first stage, then **Advance**.
5. At Officer Sign-Off:
   - read what the drawer offers the coordinator;
   - as `chief`, one of the two required signers, read the same drawer.
6. As `membership_coordinator`, **Convert** → Set it later → **Convert to Member**.
7. As `member2`, opened the page and sent `GET /prospective-members/pipelines` and `POST /prospective-members/prospects`.
8. The pipeline page and Pipeline Settings at 390×844.

## Held up ✅

- **Creating a pipeline** is labelled and confirmed ("Pipeline created").
- **The stage dialog** is fully labelled, with presets that fill the name, type and description.
- **A Required stage cannot be skipped.** Skip is disabled, and its tooltip says why and what to do.
- **Advance** moved Pat from Coordinator Approval to Officer Sign-Off, and the stage history recorded both times.
- **The conversion wizard:**
  - it is honest about email being off ("Unavailable: email isn't set up for this department");
  - it offers set-now or set-later;
  - after converting it says the member has no password they know yet.
- **The new member** was created active on the probationary tier.
- **`member2` is refused** the page ("Access Denied") and both APIs (`403`).
- **At 390px:** no sideways scroll.

## Findings

### W16-1 — HIGH — A required multi-signer stage is not enforced: a coordinator converted an applicant no officer had signed — ✅ FIXED (owner decision)

**Did:** with Pat at **Officer Sign-Off**, a Required Multi-Signer Approval stage configured as "Require Chief and President to both approve", clicked **Convert** as `membership_coordinator` and finished the wizard.
**Saw:**

- "Pat Applicant converted to regular member" while the drawer read "1 of 2 stages completed" and "Approval Status — No approval data recorded yet".
- Pat is now an active member.
- As `chief`, a required signer, the same drawer offered no way to sign off, only the coordinator's own buttons.

**Why (read from code):**

- `POST /prospects/{id}/transfer` checks the prospect's status, the password and the rank and role grant ceilings. It never checks that the pipeline's required stages are complete.
- The backend can record a multi-signer approval: `complete_step` authenticates each signer against their own positions (`_authorized_multi_approval_result`). But the page's `completeStep` sends notes only, so no signer can record one.
- So a Multi-Signer Approval stage is decoration. The department configures "the Chief and the President must both approve", and the membership coordinator admits the member alone.

**Why flagged, and why the rotation stops here:** closing it means deciding who may admit a member, and when:

- Should conversion be refused until every required stage is complete?
- What should happen to applicants already sitting at such a stage?
- Should signers get a sign-off control, and where?

That is an authorization and product decision, which is this rotation's stop condition. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

**Decided by the owner:** "Block conversion until required stages complete, and add signer sign-off."

**Fix:**

- **Conversion waits for every Required stage** (`membership_pipeline_service.py`, `_do_transfer` and `complete_step`):
  - A Required stage must be COMPLETED; a skipped one does not count. Optional stages never hold conversion.
  - A manual **Convert** grades the applicant's current stage as if completing it, so an unsigned Multi-Signer Approval stage is refused with "Approval still needed from: …". A Required stage still ahead of the applicant is refused by name.
  - The automatic transfer after a final stage refuses the same way, so an applicant placed straight onto the final stage cannot skip the ones before it.
  - The Election Vote gate's own message still comes first.
- **Signers can find and sign their sign-offs:**
  - `GET /prospective-members/my-sign-offs` lists applicants at a Multi-Signer Approval stage that still need a role the caller holds. It returns the name and stage only: holding an approval role is not a grant to read the applicant's file.
  - A **Sign-offs** page (`/prospective-members/sign-offs`) shows who has signed and offers "Sign as {role}", with an optional note, through the existing `approve-step`.
  - The dashboard's Needs-you list carries "{Name} is waiting on your sign-off".
  - The office catalog's slugs now count as the role, so a member holding the `fire_chief` position signs as `chief`.
- **The coordinator's drawer shows who has signed.** Its Approval Status read the required signers off the last history entry, where they are never stored, so it said "No approval data recorded yet" after both had signed. It now reads the stage's configuration and that stage's own progress row (`ApplicantDetailDrawer.tsx`).

**Re-driven:**

- As `membership_coordinator`, **Convert** on an unsigned applicant: refused, naming the Chief and the President.
- As `chief`: the dashboard row → Sign-offs → **Sign as Chief** → "still needs other signatures".
- As the president: signed → "Officer Sign-Off is complete".
- As `member2`: "Nothing is waiting on you".
- As `membership_coordinator`: **Convert** succeeded.
- A second applicant signed by the Chief only: the coordinator's drawer reads "Chief — Approved, President — Pending".
- Sign-offs at 390px: no sideways scroll.

**Tests:**

- `backend/tests/test_prospect_conversion_gate.py` (integration, 8 cases): 6 failed against the old service.
- `SignOffsPage.test.tsx`, the two new `Dashboard.test.tsx` cases, and the new `ApplicantDetailDrawer.test.tsx` case, which failed against the old drawer.
- `test_election_vote_stage_gate.py` marks its trailing Onboarding stage optional, so that test stays on the election gate.

### W16-2 — LOW — With no pipeline, Add Applicant took the whole form and then did nothing — ✅ FIXED

**Did:** on the fresh install, opened **Add Applicant**. It opened the full form with no pipeline to add to.
**Read from code:** `handleCreateApplicant` began with `if (!currentPipeline) return;`. So **Add to Pipeline** sends nothing, says nothing, and leaves the dialog open. The unlabelled fields (W16-3) stopped the harness filling the form here, so this path was not submitted in the browser.
**Where:** `ProspectiveMembersPage.tsx`.
**Fix:**

- **Add Applicant** is disabled until a pipeline exists, with "Set up a pipeline first".
- The handler says so, in case it is ever reached.
- The empty state below already offers **Configure Pipeline**.

**Test:** `ProspectiveMembersPage.test.tsx`.

### W16-3 — LOW — The Add Applicant dialog was not a dialog, and its fields had no labels — ✅ FIXED

**Saw:**

- The panel carried no `role`.
- First Name, Last Name, Email, Phone and Membership Type had no programmatic label.
- The close ✕ had no name.

**Fix:**

- `role="dialog"`, named by its heading.
- Every field is labelled.
- The close button is named "Close", and is 44px (`btn-icon`).

**Re-driven:** filled entirely by label.
**Test:** `ProspectiveMembersPage.test.tsx`. It failed before the fix.

### W16-4 — NIT — Tap targets at 390px — ✅ FIXED

On Pipeline Settings, these were 28–36px and are now 44px on phones:

- the back arrow;
- "Browse templates";
- "Create pipeline".

Seen and left:

- **On a fresh install, "Use Template" opens an empty gallery** ("No templates available. Save a pipeline as a template to see it here."). It is offered as a first step beside Create Pipeline.
- **After a reload, Pipeline Settings shows "Select a pipeline"** even when there is only one.

## Checklist

| Section                 | Result                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ pipeline → stages → applicant → advance → convert; W16-2 fixed                             |
| 2. The right people     | ✅ after W16-1: conversion waits for required sign-offs; `member2` correctly refused          |
| 3. Wrong input, failure | ✅ Required stage cannot be skipped; W16-2                                                    |
| 4. Browser signals      | ✅ none                                                                                       |
| 5. Coming back to it    | ✅ stage history and conversion read back                                                     |
| 6. On a phone           | ✅ after W16-4                                                                                |
| 7. Everyone can use it  | ✅ after W16-3                                                                                |
| 8. What happens around  | ✅ the new member is told to have a password set; Pat Applicant remains a probationary member |

## Completion gate

Initial run (W16-2 to W16-4):

| Check                    | Result                                                                            |
| ------------------------ | --------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                          |
| npm run lint             | ✅ clean                                                                          |
| flake8 (changed files)   | n/a — no Python changed                                                           |
| black --check            | n/a                                                                               |
| frontend tests (touched) | ✅ full suite: 607 files, 8,258 tests. Both new cases failed against the old page |
| backend tests (touched)  | n/a                                                                               |

W16-1 fix:

| Check                            | Result                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| npm run typecheck                | ✅ clean                                                                                    |
| npm run lint                     | ✅ clean                                                                                    |
| flake8 / black / isort (changed) | ✅ clean                                                                                    |
| frontend tests                   | ✅ full suite: 609 files, 8,265 tests                                                       |
| backend tests                    | ✅ 2,260 pipeline, prospect, membership, election, endpoint, route and permission tests     |
| new DB tests are `integration`   | ✅ none collected by the unit job's marker filter                                           |
| route registries (pitfall 30a)   | ✅ `check_route_permissions.py --strict` clean; testing registry and mobile inventory added |
