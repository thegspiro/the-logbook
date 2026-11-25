# Training Compliance Calculations

> The full reference is [docs/training-compliance-calculations.md](https://github.com/thegspiro/the-logbook/blob/main/docs/training-compliance-calculations.md).

This page explains, in plain language, how The Logbook decides whether a member
is **Compliant**, **At Risk** or **Non-Compliant**, and where the percentage
beside their name comes from. It is for training officers and compliance
officers who need to explain a number to a member, or work out why two screens
seem to disagree.

What the screens show, and the history of changes to them, is on
[Compliance](Module-Compliance). How requirements are created is on
[Training](Module-Training#training-requirements). This page goes one level
deeper into the arithmetic.

---

## The calculation in six steps

For every member, every time a compliance screen loads:

1. **Is this member graded at all?** Only current members (account status
   **Active** or **Probationary**) who are not marked **Exempt from
   Compliance**.
2. **Which requirements grade them?** Their compliance profile (if one
   matches), then each requirement's own targeting and grandfathering dates.
3. **What period is each requirement measured over?** The requirement's
   frequency window, ending on an "as-of" date.
4. **Is each requirement met?** Counted per requirement type, with the target
   reduced for any waived months.
5. **Tally:** requirements met ÷ requirements that grade them.
6. **Classify** the percentage against the department's thresholds.

The department percentage on the dashboard is then **compliant members ÷
graded members**.

**"Today" is the department's date**, in the organization's timezone — not the
server's UTC date. Every compliance view uses the same day.

---

## Step 1 — Who is graded

| Member                            | Graded?                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| Active or Probationary account    | Yes                                                                    |
| Any other account status          | No — since 2026-11-23 the profile card reads **Not a Current Member**  |
| **Exempt from Compliance** ticked | No — the profile card reads **Exempt** and they leave every percentage |
| No requirement applies to them    | Shown as **Not applicable (N/A)** and left out of every percentage     |

The exemption is set on the member's admin edit page
(`/members/admin/edit/:userId`, **Exempt from Compliance**), which needs
`members.manage`.

## Step 2 — Which requirements grade a member

### Compliance profiles come first

Profiles are set under **Training Admin → Compliance Reporting → Configure →
Profiles** (`/training/compliance-config?tab=profiles`, needs `settings.manage`
or `compliance.manage`).

- Profiles are tried **highest Priority first**; the first one that matches
  the member is used and the rest are ignored. At equal Priority the older
  profile is tried first.
- A profile matches on **Applies to Membership Types**. A profile with no
  membership types selected **matches every member**.
- **Required Training Requirements** replaces the department's list for those
  members. If you save a profile with **none** ticked, the members it matches
  are graded against nothing and read **N/A**.
- **Optional Requirements** are listed on the member's My Training page and
  the officer's view of the member, marked Optional, and are not graded. A
  requirement ticked as both is required. A profile created through the API
  with no required list grades every requirement except its optional ones.
- **Compliant / At-Risk Threshold Override** replace the department thresholds
  for those members.
- A member no profile matches is graded against every active requirement, at
  the department thresholds.

### Then each requirement's own targeting

A requirement applies to a member when, in this order:

1. **Applies to all members** is on — it applies, whatever else is set.
2. Otherwise, if it names membership types, it applies exactly when the
   member's type is one of them.
3. Otherwise, it applies when the member's **rank** is one of its required
   roles **or** they hold one of its required positions.
4. A requirement that names none of these applies to nobody.

### Then grandfathering

Before any of that, the requirement's existing-member dates are checked
against the member's **join date** (hire date, or the account's creation date
when no hire date is recorded):

- Joined before the cutoff, no deadline → **not graded** by this requirement.
- Joined before the cutoff, with a deadline still ahead → if unmet, the
  requirement is **catch-up**: it counts neither for nor against them until the
  deadline passes. If met, it counts as met.
- Joined on or after a requirement's **applies to joined before** date → the
  newer copy of the requirement grades them, not this one.

Detail and the form fields: [Training](Module-Training#existing-member-exemption-and-catch-up).

## Step 3 — The period each requirement is measured over

### The as-of date

The window ends on the **as-of date**, which is either today or the last day of
last month:

- Department default: **Count the current (in-progress) month in compliance
  calculations** on the **Thresholds** tab of `/training/compliance-config`.
  On by default.
- Per requirement: **Evaluation Period** on the requirement form — **Use
  department default**, **Count the current (in-progress) month**, or **Stop at
  the end of the previous month**.

Turning it off suits departments that drill late in the month: on the 15th,
members are measured as they stood on the last day of last month, so nobody
reads short for a drill that has not happened yet. The trade-off is that
training done this month does not count until the month closes. The
certificate **"expiring soon" look-ahead always uses the real date**.

### The window

| Frequency (form label)                              | Window                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Annual**                                          | 1 Jan – 31 Dec of the requirement's year (or this year), unless a custom period start/end month is set         |
| **Every 2 Years**                                   | 1 Jan of the year before through 31 Dec of the requirement's year (or this year)                               |
| **Quarterly**                                       | The current calendar quarter                                                                                   |
| **Monthly**                                         | The current calendar month                                                                                     |
| **One Time**                                        | No window — any completion ever counts                                                                         |
| Due date type **Rolling** with a rolling period set | The last N **whole calendar months**, including the current one. 12 months on 13 Oct 2026 is 1 Nov 2025 onward |

- **Custom annual periods** can cross the new year (for example November to
  January). Between cycles, the last window stays open, so a member who took it
  early reads as complete for the year.
- **Freshness window** ("taken within the last N days") narrows the window
  further for every type, so it can only remove records.
- **Certification** requirements ignore the frequency window: the latest
  matching certificate is judged on its expiry date (the freshness window still
  applies).
- Only **completed** training records count. Each "today" above means the
  as-of date.

## Step 4 — Is the requirement met?

| Type                                             | Counts                                                                                                                                        | Met when                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Hours**                                        | Hours on records in the window. Each criterion the requirement sets — training type, categories, linked courses — narrows which records count | Hours ≥ target (after waivers)               |
| **Shifts** (shift-credited, the default)         | Shifts worked in the window: finalized attendance on the department's shifts, plus counted external shifts                                    | Shifts ≥ target (after waivers)              |
| **Shifts** (not shift-credited) and **Calls**    | Records in the window (of the requirement's training type, if set)                                                                            | Count ≥ target (after waivers)               |
| **Courses**                                      | Which of the linked courses have a record in the window                                                                                       | Every linked course done                     |
| **Certification**                                | The latest matching record, from any date                                                                                                     | Its expiry date is not before the as-of date |
| **Skills evaluation, checklist, knowledge test** | A record in the window of the requirement's training type, or else a legacy record with the requirement's name (by match key, see below)      | A matching record exists and has not expired |

A certification record matches when its course is linked on the requirement,
its training type matches, or its certificate number begins with the
requirement's registry code. Matching on the course **name** applies only to
legacy records (on or before the requirement's `name_match_until`) — see
[Compliance](Module-Compliance#one-definition-of-who-is-graded-and-how-2026-10-05)
— for certifications and, since 2026-11-04, for skills evaluation, checklist
and knowledge test too.

Names and codes are compared by **match key**, not as text: the record stores
its course name and certificate number with case, spacing and punctuation
removed (`match_key`, `certification_key`), and the requirement's name or code
is reduced the same way. "c.p.r." matches "CPR"; "CPR Refresher" does not.

**Every-2-years hours and courses** have one more rule: if, among the records
the requirement counts in its window, the one with the latest expiry date has
expired, the requirement reads **expired** whatever the hours or courses. A
lapsed certificate on a record outside the window does not count. Since
2026-11-21 My Training and the requirement-progress check apply this exact
rule (`lapsed_biannual_certificate`); before, My Training read every record
of the training type for hours and had no check for courses, so it could
disagree with the matrix in either direction.

**What an hours requirement shows** _(2026-11-20)_. My Training and the
matrix detail lead with the member's monthly average against the monthly
pace ("6.9/6 hrs/mo avg") and put the total underneath. The average is the
member's pace while active: a wholly excused month and its hours are left out,
and since 2026-11-23 a partly excused month counts for the share not excused,
with all of its hours (half excused is half a month). The pace is the
unadjusted target over the window's months. It is display only: the table
above, on the total, decides whether the requirement is met.

**Optional requirements** on a member's profile are not in this table at all:
they are listed, never graded _(2026-11-21)_.

Each requirement ends up in one status:

| Status          | Counts as met?                               |
| --------------- | -------------------------------------------- |
| **Completed**   | Yes                                          |
| **In progress** | No                                           |
| **Not started** | No                                           |
| **Expired**     | No                                           |
| **Catch-up**    | Left out of both the met count and the total |

Two traps:

- **A target of zero is never met.** A requirement with no hours, shifts or
  calls target, or a courses requirement with no course linked, cannot read
  Completed — it is not a free pass.
- **A certificate valid today is met today**, even if it expires next week. The
  orange "due soon" marking is a renewal warning, not a failure.
- **A flagged double credit counts twice** _(2026-11-23)_. When a finalized
  Training event's record pairs with a self-report or hand-entered record of
  the same class on the same day, both stay completed and both count until an
  officer voids one under **Records → Possible Double Credit**. **Keep both**
  keeps both counted on purpose.

**Every screen takes this answer** _(2026-11-21)_. My Training, the officer's
view of a member, requirement progress and the member training report used to
grade with their own copies of these rules and could disagree with the
matrix; a certification never held, for example, read "Expired — Renew ASAP"
on My Training. They now take the status from this grader. On the matrix
screen a requirement graded met stays met even when the expiry date shown
beside it has passed: on an hours or courses requirement that date belongs to
the latest record counted and does not lapse the requirement.

**The forecast is this calculation run on a later day** _(2026-11-21)_. The
Compliance Forecast's 30, 60 and 90-day figures grade each member as of today
plus that many days, on the records already logged. Anything that changes
with the date counts: a certificate a requirement reads lapsing, hours leaving
a rolling window, a catch-up deadline passing, a new calendar period starting
with nothing in it yet. A certificate no requirement reads does not.

## Waivers and leave

A training waiver or a leave of absence **reduces the target** of Hours,
Shifts and Calls requirements in proportion to the months excused. Courses and
Certification requirements are not adjusted.

1. How much of a partly covered month is waived is the department's
   **Months on leave** setting (since 2026-11-02): by default **any** day of
   leave excuses the whole month; the alternatives excuse the share of days
   covered, or half the month at 15 or more days. A month covered entirely is
   always waived in full. (The older fixed 15-day rule is no longer offered.)
2. Overlapping waivers are counted once per day.
3. A waiver can be **blanket** (every requirement) or **targeted** at chosen
   requirements.
4. The adjusted target is:

```
adjusted target = target × (active months ÷ months in the window)
active months   = months in the window − waived share (never less than 1)
```

For a rolling requirement, "months in the window" is the calendar months the
window spans. Hours targets keep two decimals; shift and call targets are
rounded down to whole units.

**Example.** A 36-hour annual requirement; the member was on leave 10 March to
25 July. Under the default rule every month the leave touches is excused, so
March to July is 5 waived months:

```
36 × (12 − 5) ÷ 12 = 21.0 hours
```

Under the 15-day rule ("half"), March (22 days) and July (25 days) each count
as half a month, so 4 months are waived (April–June in full plus two halves)
and the target is 24.0 hours.

Where they are managed: **Training Admin → Overview → Training Waivers**
(`training.manage`), and leaves of absence under `/members/admin/waivers`
(`members.manage`). Creating a leave also creates a linked training waiver for
the same dates unless the leave is set not to apply to training.

A leave and the training waiver it creates are read as one leave, not as
months both on leave and waived. Since 2026-11-13 a leave set not to apply to
training (**Applies To** without **Training Requirements**) excuses no
training month; before, it still reduced targets.

## Steps 5 and 6 — From requirements to a standing

```
percentage = requirements met ÷ requirements that grade the member × 100
```

Thresholds are set on the **Thresholds** tab of `/training/compliance-config`
(defaults: **Compliant 100%**, **At-Risk 75%**; the at-risk threshold cannot
exceed the compliant one):

| Threshold Type                   | Compliant                        | At Risk                                         | Non-Compliant                      |
| -------------------------------- | -------------------------------- | ----------------------------------------------- | ---------------------------------- |
| **Percentage Based**             | percentage ≥ compliant threshold | below that, but ≥ at-risk threshold             | below the at-risk threshold        |
| **All Requirements Must Be Met** | every requirement met            | not all met, but ≥ the stored at-risk threshold | below the stored at-risk threshold |

Under **All Requirements Must Be Met** the screen hides the at-risk field, but
the stored value is still used to separate At Risk from Non-Compliant.

**Example**, with the defaults and four requirements:

| Met    | Percentage | Standing          |
| ------ | ---------- | ----------------- |
| 4 of 4 | 100%       | **Compliant**     |
| 3 of 4 | 75%        | **At Risk**       |
| 2 of 4 | 50%        | **Non-Compliant** |
| 0 of 0 | —          | **N/A**           |

The **department percentage** is the share of graded members who are
Compliant. N/A members are in neither side of it, and if nobody is graded it is
blank. A department with no active requirements shows **Not set up**, not 100%.

This one standing is shared by the Compliance Matrix, the dashboard
percentage, the Department Compliance card, the member profile's Compliance
Summary card, the monthly status roster and the compliance reports.

### The member profile's Compliance Summary shows the same standing

Since 2026-11-20 the **Compliance Summary** card on a member's profile (and on
My Crew and the printed training record) shows the member's matrix standing:
**Compliant** green, **At Risk** yellow, **Non-Compliant** red, plus
**Not Applicable** and **Exempt**. It uses the member's profile and the
thresholds above, so it cannot disagree with the matrix. Since 2026-11-23 a
person who is not a current member (any account status but Active or
Probationary, or a deleted account) reads **Not a Current Member** in grey,
checked before **Exempt**, instead of being graded against requirements the
matrix never held them to; the officer's view of the member says the same in
place of its requirement list.

Its certificate figures are for information only. They count every completed
record with a certificate number — including an older record a renewal has
since replaced — and do not set the colour. An expired certificate lowers the
standing only when a requirement grades it. With the current month left out of
compliance, a certificate that lapsed this month counts as met until the month
ends, while the card's figure already shows it as expired.

## Settings that do not change the calculation

- **Grace Period (days)** on the Thresholds tab is saved but **not read** by
  any compliance calculation; the screen says so.
- **Optional Requirements** on a profile are listed but not graded — except
  that a profile with no required list set (API only) leaves them out of what
  it grades.

## Programs that link a department requirement

When a training program links an existing department requirement, the
program's progress row **is** the compliance result above — same window,
waivers and as-of date — not a separate count from the enrollment date. A
member with 4 of 6 annual hours reads 4 of 6 (67%) in the program and on My
Training alike.

---

## For developers

- **Grading:** `app/services/training_compliance.py` —
  `evaluate_member_requirement_detail` (per requirement, including catch-up),
  `get_requirement_date_window` / `rolling_window` / `biannual_window`,
  `certification_record_matches`, `requirement_applies_to_user`,
  `ComplianceGrading.for_member` (profiles), `tally_standing`,
  `classify_standing`, `compute_org_compliance_tally`, `grade_members` (the
  loop the matrix, member notices, exports and forecast share),
  `lapsed_biannual_certificate`, `monthly_pace`. Profile order (priority, then
  oldest): `app/utils/compliance_profiles.py`.
- **As-of date:** `app/services/training_period.py`
  (`resolve_as_of_date`, `effective_include_current_month`).
- **Waivers:** `app/services/training_waiver_service.py` (`adjust_required`,
  `waived_month_keys`, `fetch_user_waivers`, `fetch_org_waivers`).
- **Department date:** `resolve_org_today` in `app/utils/org_timezone.py`.
- **Profile card:** `GET /api/v1/training/compliance-summary/{user_id}` in
  `app/api/v1/endpoints/training.py`.
- **Matrix:** `GET /api/v1/training/compliance-matrix` (`training.manage`),
  which also returns per-cell progress and the `as_of` date.
- **Configuration:** `ComplianceConfig` and `ComplianceProfile` in
  `app/models/compliance_config.py`; API under `/api/v1/compliance/config`.

## Related

- [Compliance](Module-Compliance) — the compliance screens and recent changes
- [Training](Module-Training) — requirements, records and waivers
- [Skills Testing](Module-Skills-Testing)
- [Module Scheduling](Module-Scheduling) — shifts worked, which shift-credited requirements count
- [Troubleshooting](Troubleshooting#compliance-summary-card-shows-wrong-status-added-2026-02-23)
