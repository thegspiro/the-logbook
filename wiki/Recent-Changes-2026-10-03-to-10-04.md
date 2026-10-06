# Recent changes: October 3 – 4, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-10-03_TO_10-04.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10-03_TO_10-04.md).
Predecessor: [September 15 – 23](Recent-Changes-2026-09-15-to-09-23). **The
September 23 – October 3 window has no handoff page yet** — this one covers the
last 25 hours only.

**The headline:** a department can finally **raise a training standard without
failing its whole roster**, **probationary members can sign in**, and a long
tablet and phone layout pass made controls visible and tappable that were not.
Nothing moved address.

## Read this first

**If you administer a department:**

- **Probationary accounts can now sign in and be scheduled.** They used to be
  refused as _"Account is inactive"_. If you kept a probationary account out on
  purpose, set it to Inactive or Suspended; to stop shift self-signup only,
  exclude the membership type in Scheduling settings.
- **Training requirements can exempt existing members.** The requirement form has
  an **Existing Members** section — _Apply to everyone_, _Exempt existing
  members_, or _Give a catch-up deadline_ — and editing a requirement asks
  whether the change reaches **Everyone** or **New members only** (the original
  stays for members who joined before the date; a copy carries the change).
  Nothing changes until you set a cutoff.
- **Percentages may move once.** Dashboard, Compliance Matrix and member status
  now honour role-scoped requirements, and exports print **N/A** where a
  requirement does not apply.
- **Duplicate scheduled reminders stop** on multi-worker deployments (CRON-40).

**If you train or schedule people:**

- Adding a requirement to a training program asks whether **members already
  enrolled** are held to it or recorded as **waived**.
- Shifting a course cohort across a daylight-saving change keeps the class at
  its local time (19:00 stayed 19:00); a shift that includes a finalized class is
  refused before anything moves.

**If you are a crew member or officer:**

- A **Fail** or **Out of service** on an equipment check now needs a note, and
  Overall Notes no longer covers a third of a phone screen.
- On an iPad, the edit, delete and download buttons are **visible** (they were
  hidden until hover). Event roster buttons are 44px on a phone.

## What changed

| Area             | Change                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Training         | Existing-member exemption / catch-up / new-members-only split; program waiver for enrolled members; status **Due** for catch-up (blue on the scheduling report); audited                                                                 |
| Membership       | Probationary counts as active for sign-in, shifts, rosters, targeted messages                                                                                                                                                            |
| Equipment checks | Failed item needs a note; one submit confirmation; Fleet Readiness agrees with My Checklists; builder lists real vehicle types, names which vehicles it reaches, and warns when it unpublishes a live checklist; failure-log total fixed |
| Courses          | Cohort shift is DST-safe and refuses a finalized class up front                                                                                                                                                                          |
| Locations        | `GET /locations/{id}/display` redacts the event description like its public sibling                                                                                                                                                      |
| Platform         | Scheduler claim renewed only while held; `organizations.active` has a server default                                                                                                                                                     |
| Layout           | Settings screens full-width on phones; Training Setup and compliance rules fit 320px; tablet hover-only actions visible; selected toggles red; one bordered card everywhere                                                              |
| Accessibility    | Contrast fixes on Import History and compliance status words; hub headline-metrics switch has an accessible name; heading levels no longer skip                                                                                          |

## Screenshots to create or replace

See `docs/training/SCREENSHOT_CURRENCY.md` in the repository. New: the
**Existing Members** section, the **who does this change reach** dialog, the
program **Members already enrolled** choice, the template builder's readiness
panel and unpublished banner, the failed-item note prompt. Replace: every phone
and tablet shot of settings screens, Training Setup, the event roster, and any
screen that used a blue selected tab.

## Known and open

- **Course cohorts, CC-7:** shifting from a sequence reaches classes that already
  happened; whether an officer may move a delivered class is a product decision
  (see `KNOWN_LIMITATIONS.md`).
- **Scheduled tasks, CRON-40** is closed by this window's fix; the broader
  scheduler findings stay on the security-review tracker.
