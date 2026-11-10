# Member Performance Evaluations

> The full engineering reference is [docs/EVALUATIONS_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/EVALUATIONS_MODULE.md).

Yearly evaluations, and shorter check-ins, of each member against a form the
department builds for that kind of member. The evaluation pulls the member's
figures for the period from the rest of the Logbook (training, meetings,
shifts, calls, certifications and more), goes through the steps the form sets
out, is signed, and ends as a PDF with the department's logo and name. The
member can read it, download it and attach a written response.

An evaluation is a personnel record. Everything kept about a member is
something the member may read: there is no officers-only note, and when an
evaluation is changed or removed, the member is told and the reason is kept.

---

## Where it lives

Every member has one **Evaluations** entry in the navigation, which opens
**My evaluations**. The other sections appear as a strip across the top of the
evaluation pages, and only for a member whose permissions open them. A member
with neither grant sees no strip at all. The strip's links carry counts: on
**My evaluations**, how many of your own evaluations are waiting on you (your
self-evaluation or acknowledgement), and on the conduct list, how many of the
evaluations you can see there are past a due date.

| Section                                         | Path                           | Who sees it                                                                                                                     |
| ----------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **My evaluations**                              | `/reports/evaluations/mine`    | every member: their own evaluations, deleted-evaluation records, and their figures for the current period                       |
| **Evaluations I conduct** / **All evaluations** | `/reports/evaluations/conduct` | `evaluations.conduct`, `view_all` or `manage`: the evaluations to work on (named "All evaluations" for `view_all` and `manage`) |
| **Templates & periods**                         | `/reports/evaluations`         | `evaluations.configure` or `evaluations.manage`: forms and review periods                                                       |
| An evaluation                                   | `/reports/evaluations/<id>`    | the member, the evaluator, approvers at their step, and `view_all` holders                                                      |

## Who can do what

| Permission              | Lets them                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluations.configure` | build and publish the forms                                                                                                           |
| `evaluations.manage`    | open and close review periods, draft for anyone (one at a time or a whole period), choose the evaluator, amend a finalized evaluation |
| `evaluations.conduct`   | be the evaluator; draft an evaluation they will conduct themselves                                                                    |
| `evaluations.view_all`  | read every member's evaluations, and complete calibration                                                                             |
| `evaluations.delete`    | delete an evaluation, with a reason                                                                                                   |

- All five are given to the **Chief** on install and upgrade. Everyone else is
  granted them by position under **Administration → Organization Settings →
  Role Management** — see [Role System](Role-System).
- A member needs **no** permission to see their own evaluations.
- **Nobody** reads, amends or deletes their own evaluation through these
  grants. A Chief being evaluated sees their evaluation as a member.
- `evaluations.manage` runs the process but does not, on its own, let someone
  read what is written in an evaluation. That needs `view_all`, being the
  evaluator, or being an approver at their step.
- **Signing** and **deleting** ask the person to confirm their identity again
  (password, passkey or authenticator), as other sensitive actions do — see
  [Authentication](Security-Authentication).

---

## Setting up

Until evaluations are under way, **Templates & periods** shows a **Getting
started** checklist: publish a form, open a review period, give someone besides
the Chief the Conduct evaluations permission, and draft. Each step is ticked off
from what the department already has, and the checklist goes away once the
first evaluation is drafted. Once a form is published and a period is open, it
also lists the members that drafting the period would leave out, and why — no
form fits them, or they served no full month — so they can be fixed before
drafting rather than during it.

### 1. Build the forms

**Evaluations → Templates & periods → New template.** Choose:

- **Start from** a blank form or a ready-made one. Two are offered: an
  **Annual Member Evaluation** (training, operational performance,
  professionalism and goals, weighted to 100%, with training hours, required
  training and meeting attendance suggesting a rating) and a **Probationary
  Check-in** (training, skills, participation and attitude on a three-level
  scale, with no signatures). A ready-made form publishes as it stands, but its
  wording, weights and especially its score bands are generic — change them to
  your department's expectations first. Neither includes an officer-only
  section, since that needs your own ranks. Choosing one fills in the name, the
  kind and who it applies to; all of them stay editable.

- **Annual evaluation** or **Check-in.** A check-in has only the
  self-evaluation and the evaluator's part, and no signatures.
- **Who it applies to:** a member class and/or member status, or everyone.
  When an evaluation is drafted, the most specific matching form is used; if
  two forms fit a member equally well, the drafter is asked to choose.

A form has **sections** of **items**. Sections can be marked officer-only and
shown only to members of the ranks you list. Each item is answered one way:

- a **labelled scale** (each level with its own words, and optionally the
  behaviour that earns it) or a **numbered scale**;
- **meets / does not meet**;
- a **checklist**;
- **written** text, or **goals**.

For each item you can also choose whether it may be N/A, whether a comment is
optional, required or not offered, whether certain levels need a specific
example, whether the member answers it in their self-evaluation, and its
**weight** in the overall score.

**Figures.** An item can show one of the member's figures beside it, and you
can set score bands so the figure suggests a rating (for example, under 10
training hours suggests level 2). An evaluator who rates differently from the
suggestion must say why. The figures available are training hours, training
requirements met, training session attendance, business meeting attendance,
events attended, shift hours, shifts worked, shift performance rating, calls
responded to, call response rate (hidden when call tracking is off),
administrative hours, skills tests passed, certifications held, and positions
held.

**Overall rating** — one of:

- **Graded by section** (the Annual starter uses this). Each section gets a
  **weight** in the overall, and its items' weights are shares of that
  section; both must add up to 100%. Every rating is placed on a 1–5 scale (a
  3 of 5 is 3.0, the middle of a three-level scale is 3.0, meets / does not
  meet is 5 / 1), so a section's score is the weighted average of its ratings
  and the overall is the weighted average of the sections'. Each score is shown
  to one decimal with its grade — for example "3.6 of 5 — Exceeds
  expectations" — read from the **grade ranges** you set on the form (by
  default: Outstanding from 4.5, Exceeds from 3.5, Meets from 2.5, Needs
  improvement from 1.5, Unsatisfactory below). A section weighted 0, such as
  written goals, is not graded. The evaluator sees the grades update as they
  rate and may give a section, or the overall, a different grade with a
  written reason; the evaluation, its PDF and the member then show both the
  calculated grade and the evaluator's, with the reason. A section the
  evaluator regraded counts in the overall at the grade they gave it.
- **Calculated from item weights** — the older single percentage, where the
  lowest level of each item is 0% and the highest 100%, so "Meets
  expectations" on a five-level scale counts as 50%. Forms built with it keep
  scoring this way.
- **Chosen by the evaluator** from the fixed five-level scale (Unsatisfactory,
  Needs improvement, Meets expectations, Exceeds expectations, Outstanding).
- **None.**

### 2. Set the steps

Each form has its steps, always in this order:

1. **Self-evaluation** — the member rates themselves.
2. **Evaluator** — the assigned evaluator completes the evaluation.
3. **Calibration** (optional) — a `view_all` holder reviews it before it goes
   further.
4. **Approvals** (optional, any number) — signed by whoever holds the
   position you name, such as the Deputy Chief or the Board.
5. **Member acknowledgement** — required on an annual evaluation.

Each step is due a number of days after the review period ends. You also set
how many days before a due date reminders go out (3 by default), whether the
evaluator may go on when the member misses the self-evaluation deadline (yes
by default), and how many days the member has to attach a written response
after the evaluation is final (30 by default).

**Preview** shows the form as it stands, unsaved changes included, as the
evaluator fills it in or as the member's self-evaluation, with figures in it
and the rating each figure suggests. Choose the review period to measure over
(the latest one, or this year so far before any exists). A builder who also
holds `evaluations.view_all` can choose a member and see that member's real
figures; everyone else sees sample figures. Previewing with a member's figures
is recorded in the audit log. Nothing typed into a preview is kept.

**Save draft** keeps your changes without affecting anything in use.
**Publish** freezes that version: an
evaluation already under way keeps the version it started on, so editing a
form never rewrites an evaluation in progress.

### 3. Open a review period

**Evaluations → Templates & periods → New review period**, with a name and dates
(for example, "2026 Annual Review", January 1 to December 31). Closing a
period stops new evaluations being drafted for it.

---

## Drafting evaluations

**Evaluations → New evaluation** drafts one: choose the member, the period
and the kind. A manager may choose the evaluator; left blank, it goes to the
member's supervisor if they may conduct evaluations, otherwise to the manager.
Someone who only holds `conduct` drafts evaluations they will conduct
themselves.

**Evaluations → Draft a review period** (managers) drafts many at once:

1. Choose the period and the kind, then **Preview members**.
2. Every current member is listed with the form and evaluator they would get,
   or why they are left out (already drafted, no form fits, or no full month
   served in the period).
3. Untick anyone you do not want drafted, and choose an evaluator wherever
   none is filled in.
4. **Draft**. Anyone who could not be drafted is listed with the reason.

**Which time counts.** The figures cover the member's time in the period, not
the whole period: they start from the first full month after the member joined
or rejoined, and leaves of absence and gaps in membership are left out. The
evaluation shows what was left out. A member who served no full month of the
period cannot be evaluated for it.

The figures are taken when the evaluation is drafted. The evaluator or a
manager can update them with **Update figures** until the evaluator locks
their part.

---

## Completing an evaluation

- **The member** fills in the self-evaluation and submits it. The evaluator
  never sees it before it is submitted. If the member misses the deadline and
  the form allows it, the evaluator may go on without it; the record shows it
  was not submitted.
- **The evaluator** fills in their part beside the member's figures, saves as
  they go, and submits it.
- **Calibration**, if the form has it: a `view_all` holder opens the
  evaluation, chooses **Mark calibration complete**, and may tick items for
  the evaluator to revisit. Only the ticks are kept; talk through the changes
  in person. The evaluator sees the ticked items marked **Flagged at
  calibration**, and submits again.
- **Approvals:** each approver opens the evaluation and chooses the button
  named for their step (for example **Board approval**), types their name as
  it appears on their account, confirms they intend it as their signature, and
  confirms their identity.
- **The member** can read the evaluation once everything before their step is
  done. They **acknowledge receipt**, or **refuse to sign** and give a reason.
  Either one finalizes the evaluation. Acknowledging is not agreeing, and the
  PDF says so.

## Grading by section

A form with `overall_mode` `sectioned` (2026-11-04) is graded by section instead
of showing one weighted percentage. Each rating is placed on a 1 to 5 scale, a
section is the weighted average of its rated items, and the overall is the
weighted average of the sections. Per-form `grade_bands` turn a score into a
grade (defaults: Outstanding 4.5, Exceeds 3.5, Meets 2.5, Needs improvement 1.5),
read from the score as shown to one decimal. The evaluator may regrade a section
or the overall with a required reason; both grades are reported. The one
definition is `services/evaluation_grading.py`, used by the detail response, the
PDF and the stateless `POST /evaluations/grades` the screen and builder preview
call. `GET /evaluations/attention` feeds the counts on the section strip.

## The PDF

When the evaluation is final, a PDF is made once, with the department's logo
and name, the figures, every answer, the signatures, any amendments and a
fingerprint of the record, and it is kept exactly as signed. Anyone who may
read the evaluation can **Download PDF**; every download is recorded.

## After it is final

- **The member's written response.** For the number of days the form allows
  (30 by default), the member can write a response on the evaluation page.
  A saved draft is theirs alone. **Submit response** makes it final: it is
  added to the record, a second PDF with the response is made, and the signed
  PDF is kept as it was (**Signed PDF, without response**).
- **Amending** (managers). **Amend** reopens a finalized evaluation with a
  reason. The evaluator's part comes back for changes with their earlier
  answers filled in, and calibration, approvals and the member's
  acknowledgement run again, with new due dates counted from the amendment.
  The self-evaluation is kept. The earlier text and PDF are not kept; the
  reason, who amended it and when are shown on the evaluation and printed on
  the next PDF.
- **Deleting** (`evaluations.delete`). **Delete** removes an evaluation, its
  signatures and its PDF for good, with a reason. A record that it was
  deleted, by whom and why stays on the member's history, where the member
  reads it under **Evaluations → My evaluations → Deleted evaluations**.

---

## Emails

Every evaluation email can be reworded under **Communications → Email
Templates → Performance Evaluations**, or switched off there. None of them
contains a rating, a comment, a response or a reason: they name the member,
the period and the step, and link to the evaluation.

| Email                     | Goes to                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| Evaluation Waiting on You | whoever acts on a step when it opens; the evaluator again after calibration |
| Evaluation Step Due Soon  | whoever acts on a step, a few days before it is due (once per step)         |
| Evaluation Step Overdue   | whoever acts on a step, and evaluation managers, the day after it is due    |
| Evaluation Finalized      | the member and the evaluator                                                |
| Evaluation Amended        | the member and everyone who signed                                          |
| Evaluation Response       | the evaluator and evaluation managers                                       |
| Evaluation Deleted        | the member                                                                  |

Members always receive email about their own evaluation. Officers can turn off
the emails they receive because of a role ("Evaluation duties") in their
notification settings. Reminders and overdue notices are sent by a daily task
and never go out twice for the same step.

---

## Questions

**Can an evaluator see the member's self-evaluation before the member
submits it?** No.

**Can a supervisor see their crew's evaluations?** Only as the evaluator, an
approver, or with `evaluations.view_all`. Being someone's supervisor does not,
on its own, open their evaluations.

**Why is a figure "not available"?** The Logbook could not measure it
honestly for that member and period (for example, call tracking is off, or no
meetings were held). It is never shown as zero or 100% instead.

**Can a finalized evaluation be edited?** Only by amending it, which reopens
it from the evaluator onward and records why.

**What does the member see of calibration?** The items that were flagged, once
the evaluation reaches them, and nothing else.

**What does "Positions held" count?** Every office and committee seat the
member held at any time during the period, including one given up partway
through. The dated history began when the 2026-11-08 upgrade ran, so a
position given up before then is not known. See `docs/KNOWN_LIMITATIONS.md`.
