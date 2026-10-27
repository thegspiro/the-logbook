# Skills Testing

> The full reference is [docs/training/09-skills-testing.md](https://github.com/thegspiro/the-logbook/blob/main/docs/training/09-skills-testing.md) (user guide) and [docs/SKILLS_TESTING_FEATURE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/SKILLS_TESTING_FEATURE.md) (specification).

Skills Testing replaces paper skill sheets for hands-on evaluations — NREMT
psychomotor stations, NFPA evolutions, or the department's own checks. An
examiner scores each step on a phone, tablet or computer; The Logbook keeps the
clock, flags critical steps and works out the pass or fail. Every result keeps
the examiner, the candidate, the marks and the time.

It is part of the [Training module](Module-Training#skills-testing), so it is
available whenever Training is enabled for the department.

---

## One of two practical-skills systems

A department records practical skills **either** as Skills Testing (the
default) **or** as sign-offs on shift completion reports. The choice is made
under **Training Admin → Settings & Data → Practical Skills**.

- Under **Shift report sign-offs**, the Skills Testing screens are hidden from
  Training Administration, the navigation and My Training, and the server
  refuses to open a new test. A test already under way can still be finished.
- Switching deletes nothing. Members keep their past results on My Training,
  and switching back shows them again.

## Where to find it

| Who                 | Where                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Every member        | **Training → Skills Testing** (`/training/skills-testing`): **Available Tests** and **My Results**                       |
| Every member        | **My Training → Skills Tests**, each result opening read-only at `/training/my-skill-tests/:testId`                      |
| Training officers   | **Training Admin → Evaluations → Skills Test Templates** (the skill sheets plus the summary cards)                       |
| Training officers   | **Training Admin → Evaluations → Skills Test Records** (every official test, the validation queue and the export)        |
| Visibility settings | **My Training → Member Visibility Settings → Skills-Test Results** (department default for what members see of a result) |

Training Admin is `/training/admin`, which requires `training.manage`.

## Permissions

"Officer" below means a member whose position holds `training.manage`.

| Action                                                      | Who                                                                         |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Create, edit, publish, duplicate or archive a template      | `training.manage`                                                           |
| Browse and import the built-in skill sheet library          | `training.manage`                                                           |
| Start, score and complete a test — **official or practice** | Any signed-in member (they become the examiner)                             |
| Look up a candidate by name                                 | `training.view` **or** `training.manage`                                    |
| Validate (accept), send back, void or release a result      | `training.manage`                                                           |
| Add or remove a named viewer on a test                      | `training.manage`                                                           |
| Email results, export test records to CSV                   | `training.manage`                                                           |
| Cancel an unfinished test                                   | `training.manage`, or the test's examiner until an officer has validated it |
| Delete a **practice** run                                   | The candidate, the examiner or an officer                                   |
| Delete an **official** result                               | Nobody — it is voided instead                                               |
| Set the department's disclosure defaults                    | `training.manage` or `training.configure`                                   |

A member who opens a test they are not party to gets **"not found"**, not
"forbidden": telling someone a record exists that they may not read is itself
a disclosure.

---

## Building a skill sheet

**Training Admin → Evaluations → Skills Test Templates → New Template** (or
**Add from library** to copy a ready-made starter sheet).

1. **Template settings** — name, category, visibility (**All Members**,
   **Officers Only** or **Assigned Members Only**), description, optional
   **Global Time Limit (minutes)**, **Passing Percentage (%)**, optional
   **Valid for (months)** (1–120), tags, and two scoring switches:
   - **Require all critical criteria to pass** — any failed critical step fails
     the test whatever the score.
   - **Count Pass/Fail steps toward the overall percentage** — off on a new
     template; when on, each Pass / Fail step is worth points (1 unless set).
2. **Sections and steps** — **Add Section**, then **Add Criterion** inside it.
   Each step has a type: **Pass / Fail**, **Numeric Score** (needs **Max
   Points**; this is how you weight a step), **Timed Task** (its own time
   limit), **Checklist**, or **Statement** (text read aloud, never scored).
3. **If this step is failed** (Pass / Fail, Checklist, Timed Task) — _Recorded
   only_, _Worth points — earned by passing_, or _Deducts points — taken off if
   failed_. This decides what a failure **costs**; **Critical** decides whether
   it **ends the test**. A step can cost points without being critical.
4. **Critical** — tick for steps that must pass. A critical Numeric Score step
   also gets **Passing Points**, which cannot exceed Max Points.
5. **Linked Training Requirement (optional)** — a training-program requirement
   that passing this sheet completes.
6. **Save Draft**, then **Publish**. Publishing needs at least one section with
   at least one step.

**Editing a published template** is allowed and raises its version on every
save. Every test keeps a frozen copy of the sheet it was created against, so an
edit never moves a recorded mark or turns a recorded pass into a fail.
**Archive** stops a sheet being offered for new tests without deleting it;
archived templates cannot be edited. **Duplicate** makes a draft copy.

## Running a test

1. Start from **Training → Skills Testing → Available Tests** (tap a sheet), or
   from **Skills Test Records → Start Test**.
2. Choose the sheet and the **Test Mode** — **Official Evaluation** or
   **Practice Run**. Officers start on Official; other members start on
   Practice.
3. **Select Candidates** by typing at least two characters of a name. The
   lookup returns names only, at most 15 matches, active members only. Several
   candidates create one test each.
4. Officers can point an official test at a different requirement under
   **Counts Toward Requirement**.
5. **Begin Evaluation** opens the scoring screen with you as examiner.

While a test is in progress:

- **It saves itself.** If someone else saved the same test after you opened
  it, your save is refused and autosave stops rather than overwrite them —
  choose **Reload current results**.
- **It works without signal** for a test opened on the device while it had
  signal. Scoring is kept on the device and sent on reconnect; a refused
  submission stays on the device until you choose to discard it. **Sign Out**
  warns before deleting unsent evaluations; an idle-timeout sign-out cannot ask.
- **The clock records what the examiner measured**, starting on the first real
  action. A resumed test is marked **Timing not verified** on its scorecard.

### Separation of duties

The examiner and the candidate on an **official** test must be different
people, and nobody — officers included — can score, complete, validate, void
or send back an official test in which they are the candidate. Practice runs
are exempt.

## Pass or fail

On **Finish & Review**, every step needs a result; a non-critical step can be
recorded **Not observed** with a reason. **Submit Test** locks the marks.

The candidate **passes** when both hold:

1. The percentage (points earned ÷ points available) is at or above the
   **Passing Percentage**.
2. If **Require all critical criteria to pass** is ticked, every critical step
   passed.

If nothing on the sheet carries points, the test has no percentage and the
result rests on the critical steps alone. That is also why a candidate can
**fail at 100%**: full marks on every scored step, but a missed critical Pass /
Fail step. The scorecard names the step that decided it.

## Officer validation

Because any member can examine, an official result from a member without
`training.manage` is a **submission, not a record** until an officer validates
it. Until then it completes no requirement, spends no attempt, is left out of
the pass rate and average score, and shows the candidate **Awaiting
validation** with the outcome withheld. A test an officer completes is
validated in the same step.

To work the queue: **Skills Test Records**, status filter **Needs Validation**
(or the **Needs Validation** card on Skills Test Templates). On a result,
**Officer actions** offers:

- **Accept result** — the result counts. Several rows can be accepted together.
- **Send back to examiner** — reopens an unvalidated submission with every mark
  intact (reason of at least 10 characters). The candidate is not told.
- **Void result** — the rejection path (see below).

## Practice mode

A practice run never touches records, compliance or statistics, never uses an
attempt and never needs validation. Any member may run one on themselves or a
peer; the candidate sees it on My Training and can discard it. Practice runs
are deleted automatically after **one year** by default (the
`practice_skill_tests` retention class). A sheet marked **Officers Only** stays
officers-only in practice too.

## Who sees a result

Three separate questions, resolved test → template → department default:

| Question             | Choices                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| What the member sees | **Full results** (default), **Scores only** (no written notes), or **Nothing**                  |
| When they see it     | **As soon as the examiner submits** (default), or **Only after an officer releases the result** |
| Who else can see it  | Named viewers on one official test (a preceptor or FTO), or positions ticked on the template    |

- The department default is set under **My Training → Member Visibility
  Settings → Skills-Test Results**; a template's **Result Disclosure** group
  overrides it (each dropdown starts on **Inherit**, and names what it inherits).
- A viewer never sees more than the candidate does.
- A withheld result is **absent** from the member's list rather than shown as
  forbidden, so an empty list does not prove no test was taken.
- Release a held result with the release icon in Skills Test Records, or
  **Release to candidate** on the result once it is accepted.
- Emailing and printing a result follow the same rules for the reader.

## Void, cancel, delete

| Action                    | For                                          | Effect                                                                                                               |
| ------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Void result**           | A completed **official** result              | Kept, with the reason (10+ characters) and officer; leaves the totals; gives back any requirement the pass completed |
| **Cancel**                | A test abandoned part-way, never scored      | Closed out with partial marks kept; no result, no attempt used; reason optional                                      |
| **Delete** / **Discard**  | A **practice** run                           | Removed                                                                                                              |
| **Send back to examiner** | An unvalidated submission needing correction | Reopened for the examiner                                                                                            |

## Attempt limits

If the linked requirement sets a maximum number of attempts, it is checked when
a test is created **and** when the result is accepted. An attempt is spent at
**validation**: voided results, practice runs, unvalidated submissions and
unfinished tests never use one. A requirement already completed, verified or
waived has no limit, so recertification testing is unaffected.

## Printing

- **Blank skill sheet** — the print icon on a template's row: the sheet as a
  paper form with marking boxes, for places with no signal.
- **Completed scorecard** — **Print** on a finished result. It is trimmed to
  the reader's disclosure level before it leaves the server; a result awaiting
  validation cannot be printed. Practice runs print marked **Practice attempt —
  not an official record**.

Both open in a new tab, so a pop-up blocker can stop them silently.

## How it connects to compliance

- An **official, validated pass** from a linked sheet completes that
  requirement on the candidate's **active program enrollment**.
- **Valid for (months)** puts the skill on the member's **Upcoming Expirations
  & Due Dates** list on My Training about six months before it lapses.
- A skills test **does not create a training record or add hours**. Department
  requirements graded in the Compliance Matrix read training records, so a
  pass does not on its own satisfy one — see
  [Training Compliance Calculations](Training-Compliance-Calculations).

## Gotchas

- **"Template must be published before it can be used for testing"** — publish
  it first.
- **A member ran a test and nothing shows on the candidate's record** —
  expected until an officer validates it.
- **Pass Rate / Avg Score show "—"** — no validated official test yet; both
  count validated results only and lag a review queue.
- **Export is greyed out** — it needs a date range of a year or less (366 days).
- **Passing Points disappeared** — it only shows on critical Numeric Score
  steps; unticking Critical keeps the stored value.
- **A test started offline** is refused on reconnect if the sheet was edited in
  the meantime; the scoring stays on the device.

More: [Troubleshooting](Troubleshooting#skills-testing-module-issues).

---

## For developers

- **API prefix:** `/api/v1/training/skills-testing`, gated on the `training`
  module. Templates: `/templates` (CRUD; `DELETE` archives), `/templates/{id}/publish`,
  `/templates/{id}/duplicate`, `/library`, `/library/{slug}/import`. Tests:
  `/tests`, `/tests/{id}`, `/complete`, `/validate`, `/tests/bulk-validate`,
  `/release`, `/return`, `/void`, `/cancel`, `/discard`, `/viewers`,
  `/email-results`, `/tests/export/csv`. Also `/candidates` and `/summary`.
- **Models:** `SkillTemplate`, `SkillTest`, `SkillTestViewer` and the
  `ResultDisclosure` / `ResultRelease` enums in `app/models/skills_testing.py`.
- **Service:** `app/services/skills_testing_service.py` (`calculate_test_result`
  is the pure scoring function). The practical-skills method is read by
  `get_practical_skills_method` in `training_module_config_service.py`.
- **Frontend:** routes in `frontend/src/modules/training/routes.tsx` behind
  `SkillsTestingRoute`; the offline queue is `frontend/src/utils/skillsTestOffline.ts`.

## Related

- [Training](Module-Training) — the parent module, including its skills-testing permission matrix
- [Training Compliance Calculations](Training-Compliance-Calculations)
- [Compliance](Module-Compliance)
- [Role System](Role-System)
- [Troubleshooting](Troubleshooting#skills-testing-module-issues)
