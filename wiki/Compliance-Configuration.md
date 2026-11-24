# Compliance Configuration

How a department decides what "compliant" means: the thresholds that turn a
member's met/total tally into a standing, the profiles that grade different
groups differently, the member emails, and the scheduled compliance reports.

> The full reference is [docs/COMPLIANCE_CONFIG.md](https://github.com/thegspiro/the-logbook/blob/main/docs/COMPLIANCE_CONFIG.md).

What the standings mean, how each requirement type is counted, waivers and
grandfathering are on [Compliance](Module-Compliance). This page is only the
settings screen behind them.

---

## Where it lives

`/training/compliance-config` — the **Configure** button on the Compliance
Officer dashboard opens it. The Training module must be enabled.

| To                                                        | You need                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| Open the screen and read the settings                     | `compliance.manage`, or `settings.manage` plus `training.manage` |
| Save thresholds, notifications, profiles and the schedule | `compliance.manage` or `settings.manage`                         |
| Generate a report on demand, open a stored report         | `training.manage`                                                |
| List stored reports                                       | `training.manage` or `reports.view`                              |
| Delete a stored report                                    | `settings.manage` or `reports.manage`                            |

`compliance.manage` is deliberately enough on its own: compliance officers and
elected officers own the member-requirement rules but rarely hold
`settings.manage`.

The screen has four tabs, each addressable with `?tab=`:

| Tab            | `?tab=`      | Holds                                                              |
| -------------- | ------------ | ------------------------------------------------------------------ |
| Thresholds     | `thresholds` | Threshold type and values, evaluation period, member notifications |
| Profiles       | `profiles`   | Per-group requirement lists and threshold overrides                |
| Auto Reports   | `schedule`   | Frequency, day of month and recipients                             |
| Report History | `reports`    | Generate a report now; stored reports                              |

### A department that has never saved anything

Until the Thresholds tab is saved once, there is no configuration row and every
screen grades with the built-in defaults: percentage-based, compliant at 100%,
at risk from 75%, current month counted, no profiles, no member emails, no
scheduled reports. **Profiles cannot be created until the thresholds have been
saved** — the Profiles tab says so.

---

## Thresholds

| Setting           | Default    | Range    | Effect                                                                      |
| ----------------- | ---------- | -------- | --------------------------------------------------------------------------- |
| Threshold Type    | Percentage | —        | Percentage Based, or All Requirements Must Be Met                           |
| Compliant         | 100        | 0–100    | At or above this percentage of graded requirements: **compliant**           |
| At-Risk           | 75         | 0–100    | At or above this, below Compliant: **at risk**; below it: **non-compliant** |
| Evaluation Period | Counted    | on / off | Whether the in-progress month counts — see below                            |

**At-Risk may not be higher than Compliant.** The save is refused with the
server's reason — "at_risk_threshold must be less than or equal to
compliant_threshold" — rather than a generic failure.

**All Requirements Must Be Met** makes a member compliant only when every
requirement that grades them is met. The screen then hides the two percentage
boxes and its preview reads "Non-Compliant: < 100%", but the server still
applies the stored At-Risk value below 100%: a member at 80% with At-Risk at 75
reads **at risk**, not non-compliant. Set At-Risk under the Percentage type
first if you want a different floor.

A member nothing grades — no requirement applies, a profile selects none, or
every one is still in its catch-up period — is **not applicable**: shown as
N/A and left out of every department percentage, never counted as 100%.

### Grace Period — not in effect

The **Grace Period (days)** box is saved but no compliance calculation reads
it, and the screen labels it "Not in effect yet". Setting it does not extend
any deadline.

### Evaluation Period

Departments that drill late in the month would otherwise see members flagged
mid-month for a drill that has not happened yet.

| Checkbox "Count the current (in-progress) month…" | Compliance is judged as of          |
| ------------------------------------------------- | ----------------------------------- |
| On (default)                                      | Today, in the department's timezone |
| Off                                               | The last day of the previous month  |

This is the department default. Each requirement can override it in the
requirement editor (Training Admin requirements page, or the Requirements tab
on `/training/programs`): **Use department default**, include, or exclude.
Registry-imported requirements are read-only there.

The **"expiring soon"** warning for certifications ignores this setting and
always looks ahead from the department's actual date, so turning the current
month off never hides a card that is about to lapse.

### Notifications

Both are emailed by the daily `compliance_member_notices` task, judged exactly
as the Training dashboard judges the member (profiles, thresholds, waivers and
catch-up periods included). Neither sends a text message.

| Setting                                       | Default     | What the member receives                                                                                                                                                          |
| --------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notify members when they become non-compliant | Off         | One email listing what is unmet. Not repeated while the same items stay unmet; sent again if a further requirement, or a new period, falls short. At-risk members are not sent it |
| Reminder Days Before Deadline                 | `30, 14, 7` | A reminder that many days before an unmet requirement's deadline. Each value 0–30; empty sends no reminders                                                                       |

A **rolling** requirement ("72 hours in any 12 months") has no deadline: it is
met or short on every day. It gets no reminder (a catch-up deadline aside), and
the non-compliance notice lists it once, not again each day while it stays
short (fixed 2026-11-21; it used to send both emails daily). Since 2026-11-23
it is listed **once per lapse**: the daily task remembers the last date the
member met it, so a member who catches up and later falls short again is
notified again. Those dates start with the first run after the upgrade; a
member already told before then is not re-emailed until they have met it and
lapsed once more.

A member who has turned training reminders off in their own email settings is
not sent either, unless the department made that email kind required.

---

## Profiles

A profile grades one group of members differently from the rest of the
department.

| Field                                  | Effect                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Profile Name, Description              | Labels only (name up to 100 characters)                                                                                          |
| Priority                               | **Higher number wins** when a member matches more than one profile; on a tie the older profile wins, and the editor warns        |
| Applies to Membership Types            | `active`, `probationary`, `administrative`, `life`, `retired`, `honorary`, `associate`, `junior`; none ticked matches every type |
| Compliant / At-Risk Threshold Override | Replaces the department value for this group; empty uses the department default                                                  |
| Required Training Requirements         | The requirements that grade this group — **only these**                                                                          |
| Optional Requirements                  | Listed on the member's training page, marked Optional; never graded, reminded or counted                                         |
| Required Admin Hours                   | Approved [Admin Hours](Module-Admin-Hours) per category and period (annual, biannual or quarterly)                               |
| Active                                 | Inactive profiles are skipped                                                                                                    |

### How a member's profile is chosen

1. Active profiles are tried from the **highest Priority down**; the first that
   matches is used, and the rest are ignored. Two profiles at the same Priority
   are tried **oldest first**, then by id (owner decision 2026-11-21), so
   adding a profile never re-grades members an existing one already covers.
   The profile list is shown in this order, and a tied profile's card says so.
2. A profile matches when the member's membership type is among its types (or
   it lists none) **and** the member holds one of its positions (or it lists
   none). Both are set on the profile form.
3. A member no profile matches is graded against every active requirement that
   applies to them, at the department thresholds.

Then each requirement still has to apply to the member on its own terms — join
date, rank and membership type — before it counts.

**Admin-hours targets come from the same profile** _(owner decision
2026-11-23)_. A member's **Required Admin Hours** are those of the profile
chosen above, when it sets any. When it sets none, they come from the
highest-priority matching profile that does. Before, admin hours chose a
profile with matching rules of their own that ignored the **junior** option,
so a junior member graded under a Junior profile could take the admin-hours
targets of the profile matching their stored membership type (often
Probationary) — one member under two profiles.

> **A profile saved with no Required Training Requirements ticked grades its
> members against nothing**, so every one of them reads N/A and drops out of the
> department percentage. Tick at least one requirement for any group you want
> measured. A profile created through the API with no required list at all is
> different: it grades every requirement except its optional ones, its card
> reads **Required: all except optional**, and since 2026-11-21 saving it from
> the screen keeps it that way (an unrelated save used to send an empty list
> and switch it to grading nothing).

The same resolution feeds the dashboard percentage, the compliance matrix, the
Department Compliance card, the member profile's compliance card, My
Training, the monthly and annual reports and — since 2026-11-20 — the member
status roster, compliance exports, forecast and
Scheduling's Shift Compliance report, so all of them agree. Stored reports
keep the figures they were generated with.

---

## Reports

### Generate one now

**Report History → Generate Report** (needs `training.manage`): choose Monthly
(with a month) or Yearly, and the year. Tick **Email report** to send it to
the configured recipients, plus any **Additional Recipients**. Each stored report records
its status (`pending`, `generating`, `completed`, `failed` with the error),
who it was emailed to and when, and how long it took. A failed report can
simply be generated again.

### Scheduled reports

Set on the **Auto Reports** tab and run by the daily `compliance_auto_reports`
task, using the department's date rather than UTC.

| Frequency | What is generated                                                                       |
| --------- | --------------------------------------------------------------------------------------- |
| Disabled  | Nothing (the default)                                                                   |
| Monthly   | The **previous month's** report, every month on the chosen day                          |
| Quarterly | The previous month's report, on the chosen day of January, April, July and October only |
| Yearly    | The **previous year's** annual report, on the chosen day of January                     |

**Day of Month to Generate** is 1–28. **Email Recipients** is a
comma-separated list.

**Delivery is retried.** A report is stored before it is emailed, so a mail
outage leaves it stored and unsent. Every daily run first re-sends scheduled
reports from the last 7 days that were never emailed, then generates the day's
report. A failed send appears in the Error Monitor as "Compliance auto-report
email" and is tried again the next day. Reports an officer generated by hand
are never re-sent automatically, and nothing is retried when no recipients are
set. A rerun never produces a second report for the same period.

---

## Edge cases

| Situation                                             | Behavior                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| No configuration saved                                | Built-in defaults; current month counted                                     |
| Member matches two profiles                           | The higher Priority wins; at equal Priority, the older profile               |
| Profile threshold override left empty                 | The department value applies                                                 |
| Evaluation period off, mid-month                      | Graded as of the end of last month; this month does not count against anyone |
| Requirement set to "Use department default"           | Follows the Thresholds tab checkbox                                          |
| Certificate expires within 90 days, current month off | Still shown as expiring soon                                                 |
| Reminder day list emptied                             | No reminders sent                                                            |
| Department deactivated                                | Its scheduled reports stop                                                   |
| Save refused                                          | The server's reason is shown, not "Failed to save configuration"             |

---

## Related

- [Compliance](Module-Compliance) — standings, calculations, waivers, grandfathering
- [Training](Module-Training)
- [Admin Hours](Module-Admin-Hours)
- [Role System](Role-System)
- [Compliance Hub](Compliance-Hub) — regulatory frameworks, a different meaning of "compliance"
