# Prospective Members Module

> The full engineering reference is [docs/PROSPECTIVE_MEMBERS_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/PROSPECTIVE_MEMBERS_MODULE.md).

An applicant-tracking pipeline: someone expresses interest, moves through the
stages the department defines — forms, documents, interviews, meetings, a
membership vote, a physical — and is converted into a member account at the
end. The membership coordinator works the pipeline; officers sign off where a
stage names them; the applicant can follow their own progress on a public
status page.

**On by default** (a standard module).

---

## Enabling it

**Administration → Organization Settings → Organization → Modules**
(`/settings`, needs `settings.manage`). Prospective Members is under
**Standard Modules**, described as "Applicant-to-member pipeline with
configurable stages".

Turning it off hides the screens and refuses every
`/api/v1/prospective-members` request; no data is deleted.

| Screen             | Route                                         | Menu                                             |
| ------------------ | --------------------------------------------- | ------------------------------------------------ |
| Pipeline           | `/prospective-members`                        | Administration → Members → Prospective           |
| Pipeline Settings  | `/prospective-members/settings`               | Administration → Members → Pipeline Settings     |
| Interview view     | `/prospective-members/:applicantId/interview` | From an applicant's detail                       |
| Print labels       | `/prospective-members/print-labels`           | **Print Badges** on the pipeline's selection bar |
| Sign-offs          | `/prospective-members/sign-offs`              | **Review** on the dashboard's "Needs you" list   |
| Application status | `/application-status/:token`                  | Public — the link emailed to the applicant       |

## Permissions

| Permission                   | Grants                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prospective_members.manage` | The pipeline and Pipeline Settings screens; adding, editing, advancing, holding, rejecting, converting and purging applicants; building pipelines |
| `prospective_members.view`   | Read access only: applicant lists and details through the API, the print-labels page, and the applicants list on an event's detail page           |
| _(none — signed-in member)_  | The Sign-offs page, for a Multi-Signer Approval stage that names a position the member holds                                                      |

**`view` alone does not open the pipeline screens** — both require `manage`.
At the API, most write actions also accept `members.manage`, and adding an
applicant accepts `members.create`; the screens themselves still gate on
`prospective_members.manage`.

Seeded positions (from `backend/app/core/permissions.py`):

| Position                                                 | Receives                  |
| -------------------------------------------------------- | ------------------------- |
| IT Manager                                               | Everything (`*` wildcard) |
| Chief, Deputy Chief, Assistant Chief, Captain            | `view` and `manage`       |
| Lieutenant                                               | `view`                    |
| President, Vice President, Secretary                     | `manage`                  |
| Membership Coordinator, Assistant Membership Coordinator | `manage`                  |

**Sign-offs need no module permission.** The officers a Multi-Signer Approval
stage names rarely hold `prospective_members.*`. The Sign-offs page lists only
stages asking for a position the signer holds, shows the applicant's name and
stage — never the record — and the last required signature completes the
stage.

---

## Setting up a pipeline

**Pipeline Settings → Create Pipeline**, or **Use Template** to start from the
template gallery. A pipeline can be cloned, set as the default (star), saved
as a template or deleted from its header. **Add Applicant** on the pipeline
page stays disabled ("Set up a pipeline first") until one exists.

### Stage types

Add stages under **Pipeline Stages**, drag to reorder, and click a stage to
configure it. The picker offers quick presets (Application Form, Background
Check Docs, Chief Interview, Membership Vote, Welcome Email, Physical Exam and
others) that fill in a starting configuration.

| Type                  | What it waits for                                                                   | Auto-advance option                                   |
| --------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Form Submission       | A form from the Forms module                                                        | Auto-advance when form is submitted                   |
| Document Upload       | The listed document types (optionally via Documenso e-signature)                    | Auto-advance when documents are uploaded              |
| Meeting               | A **settled** check-in at an event of the stage's type (optionally Cal.com booking) | Auto-advance when the event's attendance is finalized |
| Election / Vote       | A membership vote, through an election package                                      | —                                                     |
| Manual Approval       | A coordinator's approval                                                            | —                                                     |
| Enable Status Page    | Nothing — turns the applicant's public status page on (or off) on arrival           | Completes itself                                      |
| Automated Email       | Nothing — sends the configured email on arrival                                     | Completes itself once the email is sent               |
| Reference Check       | The configured references, verified                                                 | Auto-advance when all references are verified         |
| Checklist             | Every item ticked in the applicant's drawer                                         | Auto-advance when checklist is completed              |
| Interview Requirement | The required number of recorded interviews                                          | Auto-advance when interview requirement is met        |
| Multi-Signer Approval | A sign-off from each required position                                              | The last signature advances                           |
| Medical Screening     | A Passed or Completed record for each **Required Screening Type**                   | Auto-advance when all screenings pass                 |

Every stage also has:

- **This stage is required (cannot be skipped)** — on by default. A required
  stage cannot be skipped, and conversion is refused until every required
  stage is complete.
- **Notify prospect when this stage is completed** — emails the applicant when
  they move past it.
- **Use a custom timeout for this stage** — overrides the pipeline's inactivity
  period for slow stages such as background checks.
- **Public visibility** — whether the stage appears on the status page.

**Stages check their evidence.** Completing a stage — by any route, including a
coordinator's click — is refused when the stage's own evidence is missing:
documents not uploaded, checklist not ticked, interviews or approvals not
recorded, screenings not passed. Two are worth knowing in detail:

- **Meeting stages** that name an event type advance only on a check-in at a
  matching event that is _settled_ — the event's attendance has been finalized,
  or it ended more than `PIPELINE_ATTENDANCE_SETTLE_DAYS` (default 7) ago. A
  nightly task (`prospect_attendance_advance`) catches events nobody finalized,
  and records a missed meeting. A meeting stage that names no event matches no
  event: it takes the coordinator's word and cannot auto-advance.
- **Election / Vote stages** cannot be passed while the applicant's election
  package reads _Added to Ballot_ or _Not Elected_ — the vote is the
  department's decision — nor when there is no package at all.

### Inactivity and purging

Under **Inactivity Timeout** set the **Default Inactivity Period** (default
3 months) and **Warning Threshold** (default 80%), then **Save Inactivity
Settings**. Applicants approaching the timeout show amber, then red, on the
board; past it, the daily `membership_inactivity_warnings` task marks them
**Inactive**. A warning is recorded in the applicant's activity log, at most
once a week per applicant. With **Notify coordinator** on (the default) the
membership coordinators are emailed the **Prospect Inactivity Warning**; with
**Notify applicant** on, the applicant is emailed **Application Going
Inactive**, which gives the date the application will be marked inactive.

**Auto-purge** (off by default) permanently deletes applications that have
been inactive longer than the purge period (default 365 days, clamped to
30–1095). The daily `membership_auto_purge` task emails the coordinators a list
of applications due for deletion within 7 days before it purges, and an
application with no recorded inactive date is never purged. Purging removes
the applicant's uploaded documents as well and cannot be undone.

### Status page and conversion settings

- **Public Application Status Page** — "Let applicants check their
  application status through a public link". An Enable Status Page stage
  overrides this per applicant. **Show upcoming stages**, when off, shows the
  applicant only the stages they have completed — not the current one, and not
  how many remain.
- **Automatic Transfer to Membership** — "Make applicants members
  automatically when they complete the final stage". A recorded vote or
  sign-off on the final stage then creates the member; skipping the final stage
  never converts anyone.
- **When an Applicant Becomes a Member** — what each track becomes. An
  applicant who chose **Administrative** is on the administrative track;
  everyone else is operational. Defaults: operational → probationary
  operational member; administrative → regular administrative member.

---

## Working the pipeline

### Bringing applicants in

- **Add Applicant** on `/prospective-members`.
- **A Membership Interest form** — in the Forms module, give a form the
  _Membership Interest_ integration; each submission creates an application.
  An email address that already has an **active** application does not get a
  second one — the applicant is sent a duplicate-application notice instead.
  An inactive or withdrawn application is not reactivated by a new submission;
  a coordinator reactivates it. A "Membership Type" question maps to the
  applicant's desired membership type.

### Day to day

The page has **Active Pipeline**, **Inactive Applications**, **Rejected**,
**Withdrawn** and **Converted** tabs, with a board or table view on the
active tab. Click an applicant to open their detail, where you can:

- **Advance** (on the last stage the button reads **Convert**), move back to
  the previous stage, **Skip** a non-required stage, hold, reject or withdraw.
  Each action is recorded in the applicant's activity log.
- Tick a Checklist stage's items — dragging a card on the board sends no
  ticks, so advance a checklist stage from the detail.
- Change the desired membership type, set a target position, link events,
  upload documents, record interviews, and build the election package (**Create
  Package**, then **Ready for Ballot** for the secretary to add it to an
  election).

Select several applicants for the bar's **Print Badges**, **Advance
Selected**, **Hold Selected** and **Reject Selected** (with an optional
reason). One failure does not stop the rest; the result names who was skipped
and why. On **Inactive Applications**, **Reactivate** returns an applicant to
where they were, and **Purge Selected** deletes them permanently.

### Converting

**Convert** opens two steps — **Review Applicant**, then **Set Up Account**.
Member class and starting status are pre-filled from the pipeline's
conversion rule, the target position from the application. **How will they get
their password?** offers a temporary password by email (withdrawn when email
cannot send), setting one now, or setting it later with Reset Password.
Conversion is refused while any required stage is incomplete. The applicant
moves to **Converted**, linked to the new member.

### What the applicant sees

The emailed link opens `/application-status/:token`. It shows the stages the
pipeline makes public, a **Your next step** card naming their next meeting
(with **Add to calendar** and **Get directions**), and **Withdraw
Application** while the application is open. A self-withdrawal emails the
Membership Coordinator and Assistant Membership Coordinator (or, if nobody
holds either, everyone with `prospective_members.manage`) and sends the
applicant a confirmation using the **Application Withdrawn** email template.
A coordinator can reactivate it like any other withdrawal.

---

## Rules and gotchas

- **Inactivity notification checkboxes do not send anything yet.** The two
  "Notify…" boxes under Inactivity Timeout are saved but no code reads them;
  the warning goes to the applicant's activity log only.
- **Medical screening records stay on the applicant record after conversion.**
  See [Medical Screening](Module-Medical-Screening#rules-and-gotchas).
- **Automated Email stages need working email.** With no SMTP configured, or a
  failed send, the applicant stays on the stage — the sign to fix email. Links
  in those emails are built from `FRONTEND_URL`, which must be the public
  address (see the [upgrade notes](https://github.com/thegspiro/the-logbook/blob/main/docs/UPGRADING.md)).
- **Advancing an applicant with nowhere to go returns an error** rather than a
  false "Advanced".
- More symptoms and fixes:
  [Troubleshooting](Troubleshooting#prospective-members-module-issues).

## For developers

- **API:** `/api/v1/prospective-members` (gated on the `prospective_members`
  module) — `pipelines` (and `/{id}/steps`, `/kanban`, `/stats`,
  `/purge-inactive`, `/duplicate`), `prospects` (and `/{id}/advance`,
  `/regress`, `/skip-step`, `/assign-stage`, `/status`, `/transfer`,
  `/documents`, `/events`, `/interviews`, `/election-package`),
  `prospects/bulk-advance`, `prospects/bulk-status`, `my-sign-offs`,
  `prospects/{id}/approve-step`, `election-packages`.
- **Public:** `/api/public/v1/application-status/{token}` (plus `/withdraw` and
  `/next-meeting.ics`); Cal.com and Documenso webhooks advance integration
  stages.
- **Models:** `app/models/membership_pipeline.py` — `membership_pipelines`,
  `membership_pipeline_steps`, `prospective_members`, `prospect_step_progress`,
  `prospect_activity_log`, `prospect_documents`, `prospect_election_packages`,
  `prospect_interviews`, `prospect_event_links`, `prospect_form_requests`
  (follow-up form links, drafts and reminders). A converted applicant is
  stored as `transferred`; the frontend shows `converted`.
- **Scheduled tasks:** `membership_inactivity_warnings`,
  `membership_auto_purge`, `prospect_attendance_advance`,
  `prospect_follow_up_reminders` (hourly; follow-up form reminders every seven
  days, up to three).
- **Notable migrations:** `77d4aa7798dd` (target position, lifecycle stamps),
  `1b52ea3a079e` (`public_show_future_stages`), `941e1251ad74` (Application
  Withdrawn template), `601fdb28ab8c` (`conversion_config`), `99b16109d44c`
  (resets stale in-progress stage rows), `feecd81eef2d` (`inactive_since`, the
  auto-purge clock — set to the upgrade time for applications already inactive,
  so nothing is purged until a full period after upgrading).

## Related

- [Medical Screening](Module-Medical-Screening)
- [Elections](Module-Elections)
- [Events](Module-Events)
- [Integration-Calcom](Integration-Calcom)
- [Integration-Documenso](Integration-Documenso)
- [Role System](Role-System)
- [Configuration-Modules](Configuration-Modules)
