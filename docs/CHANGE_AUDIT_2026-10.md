# Change audit: October 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's file, and a new month starts a
new file. The plain-language handoff for each pass is in
[`wiki/Recent-Changes-2026-10.md`](../wiki/Recent-Changes-2026-10.md).

## Change audit: October 30 – 31, 2026

Merged to `main` after `6bf6ba32` (2026-10-30 12:40 UTC) through `f9220b3`
(2026-10-31 00:40 UTC). Security-review passes (locations-kiosk, core-infra,
frontend-shared, cross-cutting-baseline with SEC14-1 fixed, auth-session) are in
`docs/security-review/PROGRESS.md`. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                               | Guide | Disposition                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------- |
| Card and list rows (87 of them) use the new `split-row` utilities: the buttons wrap under the title instead of squeezing it a word per line when the sidebar is open (#3864)         | none  | Visual only; screenshots of such rows between 768 and ~1100px wide may differ, see the queue |
| Member profile **Voting eligibility** card stacks its fields in one column (#3864)                                                                                                   | 14    | The card's screenshot is already queued; capture it after this change                        |
| Update and chunk recovery: an unreachable page chunk no longer reloads forever, double taps on **Reload now** join one attempt, and Firefox's chunk-load error is recognised (#3863) | none  | No guide described the reload loop                                                           |
| pypdf 6.21.4 (CVE-2026-119203 to -205), follow-redirects 1.16.2 (GHSA-mrwp-f3q8-3g9p); SEC14-1: an import error no longer carries a raw exception message (#3869, #3870)             | none  | Dependency and backend only                                                                  |
| Refusal-message sweep test follows objects returned from calls (#3864)                                                                                                               | none  | Test only                                                                                    |

**Screenshots to create:** none new. **Re-check:** the member profile
**Voting eligibility** card (single column), and any shot of a card or list row
with buttons at the right on a mid-width screen. See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 29 – 30, 2026

Merged to `main` since `2aac367a` (2026-10-29 11:29 UTC) through `6bf6ba32`
(2026-10-30 12:40 UTC), 35 merges. Security-review passes (inventory,
facilities, apparatus-nfc, equipment-check-shifts, scheduling, events-requests,
training-core, training-extended, skills-testing, compliance, admin-hours,
grants-fundraising, medical-supplies, meetings-minutes, messaging-notifications,
forms, integrations, security-audit-ip, reports-analytics, onboarding) are in
`docs/security-review/PROGRESS.md`; none fixed code, and several corrected
their own records. The October 29 pass (#3822) and its top-up (#3831) merged in
this window. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                                                          | Guide                                                  | Disposition                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Members: **Member class** and **Membership status** replace the single Membership Type; offices, committees and seat qualifications are separate facts; four committees seeded; a tier's **Counts as** (#3833)                                  | 01, 03, glossary (with the change); 02, 04, 11, 08, 14 | Remaining "membership type" wording corrected in 02, 04, 11, 14; 01's edit-page field, status sync and auto-advance rules corrected; 08 lists **Counts as**. `UPGRADING` written with the change |
| Election Settings → **Voter Eligibility**: rules every voter must meet (attendance, waiting period), check-in, who votes on a new item or per position, separate annual-meeting rules; a member's **Voting eligibility** card (#3828)           | 14                                                     | Added; also corrected the section count, the department-made tier row, and two "no screen sets a quorum" sentences (#3829 added one). `UPGRADING` written with the change                        |
| Follow-up forms, part two: reminders (every 7 days, at most 3, 09:00–20:00), a coordinator notice on submission, answers on the Interview page and optionally in the election package, a **Complete your form** card on the status page (#3827) | 15, 08                                                 | Added, with two new templates                                                                                                                                                                    |
| Compliance profiles scoped by position: **Applies to Members Holding a Position** (#3825)                                                                                                                                                       | 02, 08                                                 | Added; 08's profile form now says **Profile Name**                                                                                                                                               |
| Known limitations closed with code: weather alerts, generic webhooks, required trainee reports, cancelled-shift email, full calendar range (#3838); election defaults, assign controls, officer-alert bell copies (#3829)                       | 03, 05, 14, 16                                         | Written with the changes                                                                                                                                                                         |
| Layout: a shared page header, stat tiles sized to their space, compact bars in phone landscape, contrast fixes (#3839, #3834)                                                                                                                   | none                                                   | Visual only                                                                                                                                                                                      |
| Embedded forms no longer offer to install the app on the host site (#3830); Code 128 bars a whole number of printer dots wide (#3824); refusal messages that list names stay within the length limit (#3826, #3836)                             | none                                                   | No guide change                                                                                                                                                                                  |

**Not fixed here, raised with the owner:** the training-exemption and
attendance-dashboard tier lookups still read the legacy `membership_type`, so an
administrative or social member on a tier such as Life does not get that tier's
exemption or voting rule; and the compliance profile **junior** chip matches
nobody, because a junior member's derived type is probationary.

**Screenshots to create:** Election Settings → **Voter Eligibility**, the
member **Voting eligibility** card, the Interview page's **Follow-up Forms**
panel, the Election Vote stage's **Include follow-up form answers**, the status
page's **Open the form** card, and the profile form with **Applies to Members
Holding a Position**. **Replace:** `17-05-dropped-member-anonymize` (the
profile now shows class and status). See `docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 29, 2026

Merged to `main` since `7ac356b4` (2026-10-29 03:12 UTC) through `2aac367a`
(2026-10-29 11:29 UTC), 8 merges. The documents-legal security-review pass
(#3816) is in `docs/security-review/PROGRESS.md`; the October 28 – 29
documentation pass (#3814) merged in this window. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                                                                                                         | Guide          | Disposition                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Follow-up Form** pipeline stage: a personal link to a form pre-filled from the applicant record, drafts, write-back, a **Contact details changed** flag, **Send now / Resend**; two new templates that are always sent; **Pre-fill from applicant (follow-up forms)** on form fields (#3820) | 15, 07, 08, 01 | Added. Corrected "twelve stage types" (15, 01), "five emails cannot be switched off" (08, now seven), and 15's claim that Application Status Link can be switched off; 15's card description now names the flag. Developer docs written with the change |
| **Shift remaining** on a cohort moves classes at most 14 days either way (#3819)                                                                                                                                                                                                               | 02             | Added; `KNOWN_LIMITATIONS` written with the change                                                                                                                                                                                                      |
| Label print page: the preview sits under the controls instead of a screen below (#3817)                                                                                                                                                                                                        | none           | Guide 05 did not describe the position                                                                                                                                                                                                                  |
| Pages no longer jump while they load (#3821)                                                                                                                                                                                                                                                   | none           | Visual only                                                                                                                                                                                                                                             |
| Refusals that list names (an event request's roles, inactive budget lines, org-chart seats on a rank) keep as many as fit and add "and _N_ more", instead of growing past the length limit and reaching the user as no message at all (#3815); medical-supplies tests across midnight (#3818)  | none           | Backend and tests                                                                                                                                                                                                                                       |
| `alert-error` replaced by `alert-danger` on twelve screens, so their error boxes show the danger styling (#3820)                                                                                                                                                                               | none           | Visual only                                                                                                                                                                                                                                             |

**Screenshots to create:** the Follow-up Form stage settings, the applicant
drawer's **Follow-up Forms** section, the applicant's form page with **Save and
finish later**, and a card with **Contact details changed**. **Replace:**
`01-27-stage-type-picker` (a thirteenth tile). **Re-check:**
`05-69-label-print-page` and `05-33-label-printing` (the preview now sits under
the controls), the cohort **Shift remaining** dialog, and any shot showing a red
error box on one of the twelve screens. See
`docs/training/SCREENSHOT_CURRENCY.md`. The second pass over this window (#3831)
merged into this section: it added the guide 05 preview note and a guide 02
row for a refused shift.

## Change audit: October 28 – 29, 2026

Merged to `main` since `7c0162c0` (2026-10-28 12:02 UTC) through `7ac356b4`
(2026-10-29 03:12 UTC), 9 merges. Security-review passes (finance-approvals,
elections-ballots, users-organizations with USR-13 fixed, membership-pipeline,
medical-screening) are in `docs/security-review/PROGRESS.md`. Two documentation
passes (#3798, and the October 28 top-up #3808) merged in this window. `CHANGELOG.md`
stays closed.

| Change                                                                                                                                                  | Guide                         | Disposition                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| Dues: a payment above what is owed asks **Record the extra as a donation?**; confirming records the rest as a donation in Fundraising (#3806)           | 11                            | Written with the change; screenshot queued                            |
| Integrations: PayPal, Documenso, Cal.com and Salesforce refuse to connect without their keys ("_name_ needs: …") (#3806)                                | 16                            | Added                                                                 |
| Public portal: stations, calls this year and volunteer hours this year now carry figures instead of empty values; Data Control describes each (#3806)   | 08, `PUBLIC_PORTAL_MODULE.md` | Added to 08's Data Control bullet; module doc written with the change |
| USR-13: changing sign-in or file-storage settings through the general settings route now asks for the same re-verification as their own screens (#3810) | none                          | Backend; the screens already used the gated routes                    |
| Date fields no longer overlap the next field on an iPad (#3812)                                                                                         | none                          | Visual only                                                           |

**Screenshots to create:** the dues **Record the extra as a donation?** dialog.
**Re-check:** `08-94-portal-data-control` (stats field descriptions). See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 28, 2026

A top-up of the October 26 – 27 section below, which merged first and covers
`main` through `4a4eb2fd`. This pass started at `5c520451`, so the changes the
two windows share are recorded once, below; what this pass adds to them is the
first table here. New merges are those after `4a4eb2fd` (2026-10-28 02:10
UTC) through `7c0162c0` (2026-10-28 12:02 UTC). Security-review passes (frontend-shared,
cross-cutting-baseline, auth-session, permissions-roles,
public-surface-webhooks, storefront-payments) are in
`docs/security-review/PROGRESS.md`; the security, audit and IP app review (B23)
is in `docs/app-review/PROGRESS.md`. `CHANGELOG.md` stays closed.

**Added to changes already recorded below**

| Change                                                                                                                                                                          | Guide              | Disposition                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------- |
| #3781: five emails cannot be switched off; Cert Expiration, Post-Event/Post-Shift Validation, Member Archived and Prospect Inactivity are now sent                              | 08, `UPGRADING.md` | Added; list screenshot queued                               |
| #3781: stale applications email their coordinators from the inactivity sweep, and applicants through the new **Application Going Inactive** template (migration `0d9897752425`) | 15, 08             | 15 already described it; `PROSPECTIVE_MEMBERS_MODULE` fixed |
| #3771: the printout names the chosen class in its subtitle, and with **All** on a roster of several classes prints Operational, Administrative, Social, then Unclassified       | 02                 | Added                                                       |
| #3770: **Before you print** also runs on the shared label page (apparatus, facility, member and storage-area labels)                                                            | 05                 | Added                                                       |

**New in this window**

| Change                                                                                                                                                                                      | Guide                    | Disposition                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| Member Dropped email sends the template's attachments (#3797)                                                                                                                               | 08, `DROP_NOTIFICATIONS` | Added                                                      |
| Guest check-in QR code hidden until check-in opens (#3795)                                                                                                                                  | 04                       | Added; screenshot queued                                   |
| Shift report edited after review returns to **Pending review** (EC-17, #3772)                                                                                                               | 03                       | Added                                                      |
| Department store cart kept in the browser, per member and window (#3772)                                                                                                                    | 18                       | Added                                                      |
| Labels: Print re-enables after changing **Copies per item** (#3799)                                                                                                                         | 05                       | Added                                                      |
| Inventory dashboard queue renamed **Waiting for action** (#3772)                                                                                                                            | 05                       | Already written; 05-97 and 05-132 images show the old name |
| Leave and training-waiver reasons encrypted at rest (migration `b74bcce55c11`, #3794)                                                                                                       | 17, `UPGRADING.md`       | Added; operators back up first                             |
| Getting Started lesson teaches passkeys beside the authenticator app (#3792)                                                                                                                | Learning Center          | In-app lesson; no guide change                             |
| Every written-out refusal goes through `safe_error_detail`, and list-joining refusals are capped (#3793); first load halved (714 KB to 366 KB gzipped), footer stays below the fold (#3801) | none                     | Backend and performance; no screen change                  |

**Screenshots to create:** Email Templates list filtered to **Off** with the
disabled switch on an always-sent template; event QR page before check-in
opens. **Replace:** `05-97` and `05-132` (heading now **Waiting for action**).
The class switch, per-class printout, **Operational members** and label
screenshots are queued in the section below. See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 26 – 27, 2026

Merged to `main` since `14f1e4b2` (2026-10-26 13:24 UTC) through `4a4eb2fd`
(2026-10-28 02:10 UTC), 46 merges. Security-review passes (scheduling,
events-requests, training-core, training-extended, skills-testing, compliance,
admin-hours, grants-fundraising, medical-supplies, meetings-minutes,
messaging-notifications with MSG-17 fixed, forms, integrations,
security-audit-ip, reports-analytics, onboarding, scheduled-tasks,
locations-kiosk with LOC10-1 to LOC10-3, core-infrastructure) are in
`docs/security-review/PROGRESS.md`; the compliance and skills app review (B22)
is in `docs/app-review/PROGRESS.md`. Two documentation passes (#3730, #3746)
merged in this window. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                                                                                          | Guide                             | Disposition                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Passkeys** as a second factor: add up to three, **Use your passkey** at sign-in and step-up, **Allow passkeys** policy switch, remove one from **Reset MFA** (#3726; backend needs `webauthn`)                                                                                | 00, 08, glossary                  | Added; SSO, step-up and glossary sentences that named only a 6-digit code corrected; `UPGRADING` written with the change                      |
| **Email addresses encrypted at rest** (migration `b8236e29ec44`): searching by part of an address no longer matches in the applicant list, donors, store orders, form picker or message history (#3743)                                                                         | 12, 15                            | Donor and applicant search sentences corrected; the member list filters in the browser and still matches; `UPGRADING` written with the change |
| Forms: **Sensitive** fields, encrypted answers readable with `forms.manage` plus `sensitive_answers.view`, never in **Export CSV** or integrations (#3733)                                                                                                                      | 07                                | Added; Export CSV sentence corrected; `KNOWN_LIMITATIONS` written with the change                                                             |
| Gmail **Service account** sending method on Settings → Email (#3731, #3755)                                                                                                                                                                                                     | 08                                | Written with the change; `UPGRADING`, `KNOWN_LIMITATIONS`                                                                                     |
| Pipeline applicant emails are editable templates in a **Prospective Members** group; stage switch **Notify prospect when this stage is completed** (#3756)                                                                                                                      | 15, 08                            | Added; 08's Email Templates category list was out of date and the Application Withdrawn template's category in 15 was wrong, both corrected   |
| A template switched **Off** now stops its email (#3781)                                                                                                                                                                                                                         | 15                                | Written with the change; `UPGRADING`                                                                                                          |
| An event's organizer and alternate run its attendance; `training.manage` holders run Training events (edit, end, finalize, record times, reopen) (#3773)                                                                                                                        | 04, 02                            | Added; 04's Training Credit step named an **Add Attendee** button that does not exist, now **Check In**                                       |
| Compliance matrix and its printout filtered by **member class**; one table per class when printing **All** (#3771)                                                                                                                                                              | 02                                | Added; "every active requirement as a column" corrected                                                                                       |
| **Operational members** shortcut on the requirement form (#3779)                                                                                                                                                                                                                | 02                                | Added                                                                                                                                         |
| Labels: **Before you print** checklist naming the paper size, two-line names, sans-serif text; barcodes no longer print as black boxes (#3770, #3762)                                                                                                                           | 05                                | Added; barcode fix needs no guide change                                                                                                      |
| Fundraising: a business, foundation or agency donor recorded by organization name alone (migration `e03f96c98452`)                                                                                                                                                              | 12                                | Added                                                                                                                                         |
| Events edit form keeps a draft a draft and loads the server's lead-time default                                                                                                                                                                                                 | 04                                | Added                                                                                                                                         |
| A budget request cannot be decided by its submitter or line owner; an IP exception cannot be approved by its member or filer                                                                                                                                                    | 11, 08, `COMPLIANCE.md`           | Added; no screen change                                                                                                                       |
| `KNOWN_LIMITATIONS`: event edit gaps, organization donors, two separation-of-duties guards (#3757)                                                                                                                                                                              | `KNOWN_LIMITATIONS`, `COMPLIANCE` | Written with the change                                                                                                                       |
| Wiki: 11 module and operator pages, dead repo links fixed; `status_token` rotated with the encryption key (#3758)                                                                                                                                                               | wiki                              | Written with the change                                                                                                                       |
| Backend only: a Gmail service-account key whose `token_uri` is not Google's own token endpoint is refused (MSG-17, #3768), a skill template refuses a null visibility or **require_all_critical** (B22, #3747), donor-privacy comment (#3765), encryption-registry test (#3790) | none                              | No screen change                                                                                                                              |
| Housekeeping: dependency bumps including `@hookform/resolvers` 6.0.0 (#3749, #3750, #3751, #3753, #3776, #3777); WebKit install timeout, reduced-motion dialog audit, 45-minute integration budget (#3763, #3769, #3778)                                                        | none                              | No guide change                                                                                                                               |

**Screenshots to create:** the Passkeys card and **Use your passkey** at sign-in,
**Allow passkeys** in MFA Policy, a **Sensitive** field and the Restricted note,
the compliance matrix class switch and a per-class printout, **Operational
members** on the requirement form, the **Before you print** checklist, the
stage's **Notify prospect** switch, Add Donor with **Organization Name**, and
Settings → Email with **Service account**. **Re-check:** the Email Templates
sidebar (new **Prospective Members** group) and 00-23 (the second-factor step
now offers a passkey). See `docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 25 – 26, 2026

Merged to `main` since `a083c82a` (2026-10-25 13:18 UTC) through `14f1e4b2`
(2026-10-26 13:24 UTC). Security-review passes (medical-screening,
membership-pipeline, finance-approvals, elections-ballots, users-organizations,
documents-legal, inventory, facilities, apparatus-nfc, equipment-check-shifts
with EC-17 flagged) are in `docs/security-review/PROGRESS.md`. `CHANGELOG.md`
stays closed.

| Change                                                                                                                                                                                                   | Guide                                           | Disposition                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| Event **guest check-in QR code** for events with no kiosk room (`/event-guest/:token`, migration `b7e4c2a91d35`); reset revokes printed copies                                                           | 04                                              | Added; screenshot queued                                      |
| Staff **Add guest** / **Sign in** on the event Guests card; walk-ins open an application at pipeline events                                                                                              | 04                                              | Added                                                         |
| Recruitment-event kiosk signs in by **email**, recognising active applicants                                                                                                                             | 04, 15                                          | Already in 04; confirmed                                      |
| Public forms **embeddable** on a department site (`forms.allow_embed`, allowed websites under Organization Settings → Forms, nginx `auth_request`)                                                       | 07                                              | Written with the change; operators: see frontend `nginx.conf` |
| Pipeline stage **Email Template** picker; stage email falls back to the next event; applicant status page shows the **next meeting** with Add to calendar                                                | 15                                              | Added                                                         |
| Events, Members and Department Store admin use the shared area-card navigation (`AdminHubAreaNav`)                                                                                                       | 01, 04, 18                                      | Written with the change; full-page shots queued               |
| Scheduling settings: second section nav removed, **Platoon Rosters** card                                                                                                                                | 03                                              | Written with the change                                       |
| Grants: **edit and retire** opportunities, **Show retired**                                                                                                                                              | 12                                              | Added; screenshot queued                                      |
| Notification rules: **Edit** and **Delete** with warning                                                                                                                                                 | 07                                              | Added; screenshot queued                                      |
| Privacy choices: **Yes / No** for photo use and roster listing                                                                                                                                           | 17                                              | Added; 17-01 to replace                                       |
| Medical screening: record with no expiration falls due by **frequency**; superseded records off the expiring list; waivers listed; unknown subject is 404                                                | 13                                              | Added; `KNOWN_LIMITATIONS`                                    |
| Inventory **Print Labels** menu beside Export; Print Selected renamed                                                                                                                                    | 05                                              | Written with the change                                       |
| QR check-in analytics now recorded on the server (scans once per member, outcomes with a reason)                                                                                                         | wiki                                            | Dashboard no longer reads zero                                |
| Phone numbers and home addresses encrypted at rest (migration `5510d5ff49eb`; needs `ENCRYPTION_KEY`; older backups hold plaintext)                                                                      | `UPGRADING`, wiki Security-Encryption           | Written with the change                                       |
| Google Drive storage deletes by trashing (30 days); `migrate_uploads_to_remote.py` replaces the S3-only name (alias kept)                                                                                | `UPGRADING`, `BACKUP`, `FILE_STORAGE_HARDENING` | Written with the change                                       |
| Email: Gmail sending notes on both setup screens; SMTP batches stop at Gmail and Exchange Online daily quota, retry on 421/451/452/432                                                                   | 08                                              | Setup notes written; batch behaviour backend only             |
| Scheduled compliance report email retried for 7 days; Generate Report toast says when the email was not sent                                                                                             | 08                                              | Backend / toast wording                                       |
| Dotted usernames (`john.doe`) can sign in; password-change gate no longer fires refused requests                                                                                                         | 00, 01                                          | Backend / no wording change                                   |
| Refused: deleting an apparatus that records name, a repeat dues waiver, waiving a paid order; merged write-in votes survive a candidate delete; deleted program phase no longer blocks a credit reversal | 06, 11, 14, 02                                  | Backend refusals; no screen change                            |
| Hours grading tolerates float drift; reminder lead times capped at 30 days; 30 request fields bounded                                                                                                    | `KNOWN_LIMITATIONS`                             | Backend                                                       |
| Accessibility: input borders 3:1, hub tab names, keyboard CSV drop zone; toolbar buttons match field height on desktop; iPad-landscape grids; phone landscape side nav                                   | none                                            | Visual only; shots queued                                     |
| Housekeeping: four npm packages patched (0 vulnerabilities), three Alembic heads joined by `1ad0b594f3fb`, Mobile Safari E2E job, permissionless-route ratchet                                           | none                                            | No guide change                                               |

**Screenshots to create:** guest QR on the event QR page, Grants edit form and
Show retired, notification-rule delete warning, Print Labels menu, applicant
status page next-meeting card, Pipeline stage Email Template picker. **Replace:**
17-01 (Yes / No pairs). **Re-check:** Events, Members and Store admin hub
shots (area cards), any shot of the old flat tab row. See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 25, 2026

Merged to `main` since `4f27e679` (2026-10-25 11:14 UTC) through `3783a25f`
(2026-10-25 21:27 UTC). Security-review passes (finance-approvals,
elections-ballots, users-organizations, membership-pipeline; one new open
decision, USR-11, in `KNOWN_LIMITATIONS.md`) are in
`docs/security-review/PROGRESS.md`; the finance app review (B20) is in
`docs/app-review/PROGRESS.md`. Two earlier documentation passes (#3690, #3661)
and the Learning Center re-shoot (#3710) merged in this window; CI gained a
Mobile Safari E2E job (#3663) and a ratchet on routes gated only by sign-in
(#3709). `CHANGELOG.md` stays closed.

The October 25 – 26 pass above overlaps this window from 13:18 UTC and covers
several of the same changes. Where both passes wrote the same guide text, it
was merged into one place: notification-rule edit and delete (07), grant
edit and retire (12), the applicant's next meeting (15) and the no-expiration
rule (13). This section's screenshot and script queues list only what that
pass's do not.

| Change                                                                                                                                                                                                                        | Guide                                                                                                    | Disposition                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Recruitment-event guests sign in by email; an active applicant confirms first name and last initial; members pointed to the member QR code; everyone else to staff; typed form refuses pipeline events (`LB-EVT-006`) (#3693) | 04; wiki `Module-Events`; `PUBLIC_API_DOCUMENTATION.md`; `ERROR_CODES.md`                                | Written with the change; screenshot queued                                                   |
| Staff **Add guest** and per-row **Sign in** on the event's Guests card; a staff check-in at a pipeline event opens the walk-in's application (#3700)                                                                          | 04; wiki `Module-Events`; `KNOWN_LIMITATIONS.md`                                                         | Written with the change; screenshot queued                                                   |
| Public forms embeddable on a department's own website (`/embed/f/<slug>`): per-form **Allow embedding**, **Settings → Forms** website list, nginx `auth_request`; migration `0a8d11fcada1` (#3705)                            | 07; `UPGRADING.md`; `PUBLIC_API_DOCUMENTATION.md`; wiki `Configuration-Security`; `deployment/unraid.md` | Written with the change; screenshot queued                                                   |
| Applicant status page shows **Your next step** with Add to calendar and Get directions; a missed meeting rolls to the next (#3706)                                                                                            | 15; `PROSPECTIVE_MEMBERS_MODULE.md`                                                                      | Added to 15 (The next meeting to attend); module doc written with the change                 |
| A refused **Advance** on a meeting stage shows its reason instead of a generic error (#3704)                                                                                                                                  | 15; `PROSPECTIVE_MEMBERS_MODULE.md`; `UPGRADING.md`                                                      | Added (older-version note; 300-character limit); `UPGRADING` written with the change         |
| Automated-email stage's Next Meeting falls back to the next event when the saved one has passed; the editor's preview says which (#3692)                                                                                      | 15; `PROSPECTIVE_MEMBERS_MODULE.md`                                                                      | Added                                                                                        |
| Notification rules: **Edit** and **Delete** from the Rules tab, with a warning when either switches a notification on or off (#3699)                                                                                          | 07                                                                                                       | Added (Changing or deleting a rule)                                                          |
| Grants: edit, retire, **Show retired** and **Reinstate** opportunities in the library (#3699)                                                                                                                                 | 12; wiki `Module-Grants-Fundraising`; `GRANTS_FUNDRAISING_MODULE.md`                                     | Added (Editing or Retiring an Opportunity)                                                   |
| Facilities maintenance and inspections searched, filtered and paged on the server, 50 a page (#3699)                                                                                                                          | 06                                                                                                       | Added                                                                                        |
| Medical screening: a record with no expiration date falls due by its requirement's frequency; lapsing waivers listed with a **Waived** badge (#3699, #3694)                                                                   | 13; `MEDICAL_SCREENING_MODULE.md`; `UPGRADING.md`                                                        | Added; six guide sentences the change made untrue corrected; upgrade note added by this pass |
| Finance: a second waiver of already-waived dues is refused (#3707)                                                                                                                                                            | 11; `FINANCE_MODULE.md`                                                                                  | Added                                                                                        |
| Storefront: waiving a fully paid order is refused ("Refund it instead"); settlement locked on the move to PAID (#3694)                                                                                                        | 18; `STOREFRONT_MODULE.md`                                                                               | Added                                                                                        |
| Email: Gmail sending notes on Settings → Email and onboarding; ballot batches keep rate-limited messages and stop at Gmail's or Exchange Online's daily limit (#3698, #3713)                                                  | 08, 14                                                                                                   | Gmail notes written with the change; daily-limit paragraphs added to 08 and 14               |
| Compliance **Generate Report** says when the report was saved but not emailed, and shows the server's reason on failure (#3708)                                                                                               | 08                                                                                                       | Added                                                                                        |
| Events Administration uses the area-card navigation (#3697); Scheduling settings drop their second section list (#3701)                                                                                                       | 04, 03; wiki `Module-Scheduling-Developer`                                                               | Written with the change; screenshots queued by the PRs                                       |
| Inventory: **Print Labels** menu on the Items list; the selection bar's button is now **Print Selected** (#3703)                                                                                                              | 05                                                                                                       | Written with the change; screenshot queued by the PR                                         |
| Phone and tablet layout: schedule day panel below the calendar under 1280px; landscape side menu scrolls; touch targets (#3679)                                                                                               | 03, 10                                                                                                   | Added (03 sentence corrected, 10 note)                                                       |
| Hours requirements met at exactly the required total no longer read a fraction short (#3715); minutes find-or-create serialized (#3694)                                                                                       | —                                                                                                        | no screen changed                                                                            |

**Screenshots to create:** the email-first guest sign-in pages, the Guests card
with **Add guest**, the Share dialog's embedding block, **Settings → Forms**,
an embedded form, the applicant **Your next step** card, the automated-email
stage preview, the Edit Notification Rule dialog, the grants library with
**Show retired**. **Re-check:** forms sharing, notification rules, grants
library, medical-screening requirement form and expiring list, facilities
maintenance and inspections, the schedule board under 1280px. See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 24 – 25, 2026

Merged to `main` since `adf1d463` (2026-10-24 13:15 UTC) through `4f27e679`
(2026-10-25 11:14 UTC). Security-review passes (locations-kiosk, scheduled-tasks,
frontend-shared, core-infrastructure, cross-cutting-baseline, auth-session,
permissions-roles, onboarding recovery ONB6-30-1/2/3, public-surface-webhooks,
storefront-payments) are in `docs/security-review/PROGRESS.md`. `CHANGELOG.md`
stays closed.

| Change                                                                                                                                                                                                                                    | Guide                                   | Disposition                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| Member ID Cards admin page (Cards, Coverage, Tap log, Settings); bulk status; tap retention; leavers' cards suspended and restored; `nfc_card_taps` table                                                                                 | 01                                      | Added (new section); screenshot queued          |
| Card Readers page, event **Card taps** section, **Events → Card Check-ins** tab; Room QR Codes opens with Facilities off                                                                                                                  | 06, 04                                  | Added; screenshot queued                        |
| Inventory **NFC Tag Register**; checklist managers see compartment tags; quartermaster now manages compartment tags                                                                                                                       | 05                                      | Added (new section); screenshot queued          |
| Date of birth and emergency contacts encrypted at rest (migration converts columns to TEXT and encrypts rows; needs `ENCRYPTION_KEY`); key-rotation scripts now cover them and `screening_records`                                        | `UPGRADING`, wiki Security-Encryption   | Written with the change                         |
| MySQL and Redis TLS: `tls-setup.sh`, `DB_REQUIRE_TLS`, `REDIS_REQUIRE_TLS`, `tls-enforce.sh`, certificate-expiry warning; `REDIS_SSL=true` now connects                                                                                   | `TLS`, `UPGRADING`, wiki Security pages | Written with the change                         |
| Scheduling Administration and Inventory Administration use the area-card header (seven areas each)                                                                                                                                        | 03, 05                                  | Written with the change; full-page shots queued |
| Scheduling: pause/resume patterns, reactivate templates, per-side day/night templates, seat checks and **not seated** warnings on generate, DST-correct overnight shifts, calendar-day dates, open-to-all seats                           | 03                                      | Added                                           |
| Shifts: seat changes, attendance and calls checked under the shift lock (no duplicate attendance; finalized/cancelled shifts refuse edits); shift report status moves only through review; trainee view no longer blanks stored narrative | `KNOWN_LIMITATIONS`, 03                 | Backend; no screen change                       |
| Training Admin **Programs** tab lists existing programs; registry import moved to **Requirements**; tabs fit 320px                                                                                                                        | 02                                      | Added                                           |
| Saved and compliance report email: retry-safe, failed sends recorded, specific error in the dialog                                                                                                                                        | 08                                      | Added                                           |
| Status words (not stored codes) on nine more screens; member picker error text AA contrast; tablet form-grid and 16px field fixes                                                                                                         | 02, 04, 05                              | No wording change; tablet shots queued          |
| Getting Started lesson says two-factor is required for privileged roles; 05-139 re-shot without the grace banner                                                                                                                          | 00, Learning Center                     | Written with the change                         |
| Fixes: first checklist item add under MySQL (500), medical-supply lot recalls (`3d67883cd461`)                                                                                                                                            | `MEDICAL_SUPPLIES_MODULE`               | Written with the change                         |

**Screenshots to create:** Member ID Cards (four tabs), Card Readers, Events
Card Check-ins, NFC Tag Register, paused pattern with Resume and the not-seated
message, Training Admin Programs tab. **Re-check:** Scheduling and Inventory
Administration hub shots (new header), any form shot taken on a tablet. See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 24, 2026 (afternoon)

Merged to `main` since `c1fc4894` (2026-10-24 12:33 UTC) through `c9054d67`
(2026-10-24 20:32 UTC): 13 feature merges plus security-review passes
(meetings-minutes, messaging-notifications, forms, integrations,
security-audit-ip, reports-analytics; all 0 fixed, one folded-in watchdog
finding RPT6-29-3), recorded in `docs/security-review/PROGRESS.md`. The pass
also checked every merge back to 2026-10-17 against this file. The gaps it
found are in the second table. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                                                              | Guide                            | Disposition                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| **Member ID Cards page** (`/members/admin/id-cards`, `members.manage_id_cards`): bulk status, coverage, tap log (`nfc_card_taps`, CSV, `EXPORT_ENDPOINTS`), retention 3–84 months (purged nightly); leavers' cards auto-suspend and restore (#3621) | 01, 16, wiki Member-ID-Cards     | Added; `UPGRADING` written with the change                                               |
| **Card Readers** page, event **Card taps** section, Events **Card Check-ins** tab (`/nfc-activity`, uncached) (#3639)                                                                                                                               | 04, wiki Member-ID-Cards         | Added                                                                                    |
| **NFC Tag Register** (`/inventory/admin/nfc/tags`); `inventory.manage` gains compartment tags; `inventory.check_manage` sees compartments only (#3643)                                                                                              | 05, wiki Inventory-NFC-Tags      | Added; **permission behaviour change** called out in the guide                           |
| Check-In QR Codes no longer gated on Facilities (#3642)                                                                                                                                                                                             | 06                               | Added                                                                                    |
| Medical supplies: lot recalls, migration `3d67883cd461` (#3627)                                                                                                                                                                                     | 05, wiki Module-Medical-Supplies | Added; `MEDICAL_SUPPLIES_MODULE` written with the change                                 |
| Shift reports: trainee view no longer erases narrative and reviewer notes (#3646)                                                                                                                                                                   | wiki Module-Scheduling           | Recorded (data-loss fix; no guide wording needed)                                        |
| Shift reports: status only through review, one sign-off per report, deleted officer's draft, department-day date check (#3650)                                                                                                                      | 02, wiki Module-Scheduling       | Added                                                                                    |
| Attendance and calls locked on finalized/cancelled shifts; no duplicate attendance (#3648)                                                                                                                                                          | 03, wiki Module-Scheduling       | Added                                                                                    |
| Shift numbers: pre-shift toggle, catch-up deadline, call counts, coverage, member hours, leap-day window, history import (#3649)                                                                                                                    | wiki Module-Scheduling           | Recorded (each a figure now matching the backend)                                        |
| Templates reactivate, patterns pause/resume, duplicate guard per template, DST end, candidate check on generated seats (#3651)                                                                                                                      | 03, wiki Module-Scheduling       | Added; **corrected** guide 03's "any shift at the same time" row, false since this merge |
| Board refresh, department's day, calendar dates as written; Position Names marked not in effect; Event Resource Defaults now read (#3653)                                                                                                           | 03                               | Added; **corrected** the Position Names settings row                                     |
| Full candidate check on every seat-placing path; open-to-all unseated shifts; trade picker (#3654)                                                                                                                                                  | 03, wiki Module-Scheduling       | Added                                                                                    |
| Shifts-module review's open items (#3652)                                                                                                                                                                                                           | `KNOWN_LIMITATIONS`              | Written with the change                                                                  |

**Earlier October changes no pass had recorded** (found by checking every
merge since 2026-10-17):

| Change                                                                                                                                                                                                                                                                                                                                                                               | Guide              | Disposition                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------- |
| Add Member can create a Google/Microsoft account; every new member linked to an existing directory account (#3471)                                                                                                                                                                                                                                                                   | 16                 | Guide already carried it; recorded here                 |
| Duplicate active applicant warns / 409 instead of a false success (#3466)                                                                                                                                                                                                                                                                                                            | 15                 | Added                                                   |
| Recurring series: per-occurrence RSVP deadline; zero issuance allowance; exercise with no organization (#3466)                                                                                                                                                                                                                                                                       | 04                 | RSVP rule already in 04; recorded here                  |
| Library-course session credits the course's duration; wizard review in local time (#3507)                                                                                                                                                                                                                                                                                            | 02                 | Added                                                   |
| Inventory validation: blank names, identifier clashes, tracking-type lock, own-parent category (#3462)                                                                                                                                                                                                                                                                               | 05                 | Added to Item Creation & Updates                        |
| Medical supplies: Not yet counted tab, Next expiry sort, export columns, 30/60/90-day look-ahead (#3595, #3606)                                                                                                                                                                                                                                                                      | 05                 | Added (the Oct 23–24 row named only part of it)         |
| Target Solutions mapping dialog keeps its tab bar, unmapped first (#3545); metrics dashboard survives a bad error reason (#3552); Monthly Status headers aligned (#3498); seven tablet routes stop scrolling sideways (#3470); MCP `list_open_shifts` drops ended shifts (#3481); admin-hours mapping null → 422 (#3477); Purge Inactive spares the caller's own application (#3594) | 16, 08, 02, 10, 15 | Recorded; layout or bug fixes, no guide wording changed |
| `/onboarding/test/email` refused after onboarding; Sentry BAA warning in env/compose files (#3463, #3465)                                                                                                                                                                                                                                                                            | operator docs      | Written with the change                                 |

**Screenshots to create:** the Member ID Cards tabs, Card Readers, the event
**Card taps** section, the Events **Card Check-ins** tab, the NFC Tag Register,
the Recall this lot dialog and **Recalled lots** panel, the Medical Supplies
**Not yet counted** tab, and a template's **Reactivate** and a pattern's
**Pause/Paused**. See `docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 23 – 24, 2026

Merged to `main` since `b92a4add` (2026-10-23 12:31 UTC) through `c1fc4894`
(2026-10-24). Security-review passes (scheduling, equipment-check, events-requests,
training-core, training-extended, skills-testing, compliance, admin-hours,
grants-fundraising, medical-supplies; all "0 fixed") are in
`docs/security-review/PROGRESS.md`. pypdf 6.21.2 (three CVEs) landed on every open
branch. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                                                                                                                | Guide                                               | Disposition                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| **Mark pipeline complete** (reason required, audited, stored as `completion_reason`, officer-only); progress dialog officer actions need `training.manage`; migration `a0195b397bf3`                                                                                                                  | 02                                                  | Added (new section)                       |
| Pipelines: empty required set completes nobody (**No active requirements**), inactive requirements/prerequisites ignored and recalculated, inactive items carry no due date, deactivating from the edit form withdraws members, probationary auto-enrollment checks prerequisites and emails officers | 02                                                  | Added (new section)                       |
| Training waiver may have no end date on upgraded databases (migration `f938324f8081`); 99 columns made NOT NULL in the models                                                                                                                                                                         | `UPGRADING`, `KNOWN_LIMITATIONS`                    | Written with the change                   |
| Finance: reimburse a purchase by check; correct or withdraw a draft; cancel a report or check request; approver shown before submit; charges refused under an inactive category or ancestor                                                                                                           | 11, `FINANCE_MODULE`                                | Written with the change                   |
| Shift patterns stop generating from an inactive template                                                                                                                                                                                                                                              | 03                                                  | Written with the change                   |
| Renaming a variant product carries onto every size                                                                                                                                                                                                                                                    | 05                                                  | Added                                     |
| Medical supplies: truck positions in the Supplies to Replace email, lot export and uncounted count                                                                                                                                                                                                    | `MEDICAL_SUPPLIES_MODULE`, 05                       | Written with the change                   |
| Google/Microsoft accounts: suspend on retirement (opt-in), removal from groups, name changes, 90-day stale list, client secret expiry warning, live-tenant checklist                                                                                                                                  | 16, wiki Integration pages                          | Added to 16; wiki written with the change |
| Storage: one interface for remote platforms; a department's Google Shared Drive (steps 1 and 2)                                                                                                                                                                                                       | `FILE_STORAGE_HARDENING`, `KNOWN_LIMITATIONS`       | Written with the change                   |
| Backups encrypt to an offline certificate and a server drill key                                                                                                                                                                                                                                      | `BACKUP`, `UPGRADING`, wiki Security-Encryption     | Written with the change                   |
| Built-in rank codes locked                                                                                                                                                                                                                                                                            | 08                                                  | Written with the change                   |
| Training, Events and Scheduling pages use the shared section header; badges out of the training heading; event name stays on one line beside its actions                                                                                                                                              | 02, 03, 04, 09                                      | No wording change; screenshots queued     |
| Crew-view phone preview in the equipment-check builder: one shared phone frame, count rows stack by width, expand to full size                                                                                                                                                                        | 05                                                  | Screenshot queued                         |
| Expense report **Add line** icon beside its label; Finance route preview no longer crashes the form on a bad answer                                                                                                                                                                                   | 11                                                  | Layout/bug fix; screenshot re-check       |
| Membership pipeline routes without `{prospect_id}` guarded; caller's own application hidden from the duplicate-email check (MP-34); `200` with `null` for an event with no training approval or session                                                                                               | `KNOWN_LIMITATIONS`, wiki Module-Training-Developer | Written with the change                   |
| Log text sinks escape line breaks; `CLAUDE.md` rules 33–37                                                                                                                                                                                                                                            | developer rules                                     | Written with the change                   |

**Screenshots to create:** the **Mark pipeline complete** reason prompt and the
"Completed by hand" line (02), **No active requirements** in a progress view (02),
the variant **Rename** action (05). **Re-check:** Training, Events and Scheduling
full-page shots (section header), the Event detail title row, the equipment-check
builder phone previews, and the expense report Add line button. See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 22 – 23, 2026

Merged to `main` since `68c22b0f` (2026-10-22 12:53 UTC) through `b92a4add`
(2026-10-23 12:31 UTC). Security-review passes (facilities, inventory,
documents-legal, medical-screening, membership-pipeline, users-organizations,
elections; all "0 fixed" except DOC-31, LOW, flagged) are in
`docs/security-review/PROGRESS.md`. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                         | Guide                     | Disposition                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------- |
| Privileged members must use MFA (14-day grace, banner, email); step-up code before sensitive actions; `403 LB-AUTH-013`; migration `f7535f478280`                              | 00, 08, YouTube 03 and 06 | Added to the guides; UPGRADING and the Security-Authentication wiki already carried it |
| Gear low-stock email links to `/inventory/admin/items?low_stock=true`, with a dismissible notice                                                                               | 05                        | Added                                                                                  |
| Checklist overdue at shift end, not midnight                                                                                                                                   | 03                        | Written with the change                                                                |
| Historical import refuses undated rows; required columns bold, not red                                                                                                         | 02                        | Written with the change; styling note added                                            |
| Election and Minutes settings use the shared section header                                                                                                                    | 04, 14                    | Screenshot re-check queued                                                             |
| Event page check-in/out controls in the Learning Center                                                                                                                        | Learning Center           | Written with the change                                                                |
| Storage: own bucket (step 2) and moving files into it (step 3)                                                                                                                 | operator docs             | Written with the change (`BACKUP`, `KEY_ROTATION`, `UPGRADING`)                        |
| iCal `include_shifts` removed                                                                                                                                                  | KNOWN_LIMITATIONS         | Written with the change                                                                |
| Medical Supplies **Low stock** tab, station kiosk week-long session, grants/fundraising money bounds and donor-contact permission, null on required event fields no longer 500 | various                   | Already covered by the Oct 21 – 22 pass or written with the change                     |

**Screenshots to create:** the MFA grace banner, the step-up box (code and
password variants), and the filtered Inventory Items list. Re-check My Checklists,
Election/Minutes settings and the Historical Import page. See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 23, 2026 (screenshot pass)

Screenshot pass only; no guide wording changed beyond removing placeholders.

- **Placeholders filled.** 34 of the remaining 40 training-guide screenshot
  placeholders were captured and applied (guides 00, 02, 03, 04, 05, 06, 07,
  08, 11, 14). Four were stale duplicates of images already in the guide
  (Compliance suggestion box, Member Emails required switch, Treasurer approvals
  table, Chief sign-offs) and were removed rather than re-shot. The status
  report now reads 810 captured, 2 remaining.
- **Nothing left open.** The two Android NFC captures in guide 05 (Tap NFC armed in the
  Distribute scanner, and "Or tap their ID card" in Scan Member ID) are now
  manifest entries, `05-138` and `05-139`. They were written off as manual-only
  because Web NFC does not exist in the harness, but `04-55` had already shown
  the way: stub `NDEFReader` for the one shot. The status report reads 815
  captured, 0 remaining. The weekly-pattern list with its sun and moon
  glyphs, the Short row in the Supplies to Replace email and the shelf/truck
  split on the Medical Supplies tiles were the other three; the seeder now
  produces each (a split Weekend Duty Rotation, Gauze counted 18 of 24, and a
  tourniquet on Rescue 7 dated three weeks out) and the pictures are in.
- **Pictures that use a stand-in for state the seeder cannot make.** The
  Items Not Seen report (two rows given a 212- and 301-day history), the empty
  fleet and fresh-department guides (the summary answered as a new department's),
  a vehicle with the Deficiency flag, the ranked-choice paper-ballot dialog,
  the pre-meeting package send states and the not-applicable member in the
  compliance matrix, and the NFC radio in `05-138`/`05-139` (a stubbed tag whose
  item is resolved for real). Each is commented in `scripts/screenshots/manifest.mjs`
  where the response is replaced; the screen, wording and controls are real.
- **Bug found while seeding.** `POST /inventory/clearances` answered 500 after
  saving the clearance, because its response listed line items that were never
  loaded. Fixed in `DepartureClearanceService.initiate_clearance` with a test. A second one
  turned up seeding the tourniquet: `PUT /equipment-checks/items/{id}` with an
  `expiration_date` saved the position and then failed writing its change log,
  because the logged changes held a `date`. The log now takes the JSON form.
- **Capture tooling.** `seed_demo_data.py` gains a published and signed July
  minutes record, a meeting whose agenda moved on after its minutes, a
  legacy-form station and room for the Locations page, an overdue facility
  maintenance record and a departure clearance. New `wizard-extra.mjs`,
  `render_supply_email.py` and `email-shots.mjs`.

## Change audit: October 21 – 22, 2026

Merged to `main` since the [October 20 – 21 pass](#change-audit-october-20--21-2026)
(written against `c41d7b47`), up to `68c22b0f` (2026-10-22 12:53 UTC). About 50
non-merge commits besides the security-review passes (all "0 fixed, 0 new
findings", recorded in `docs/security-review/PROGRESS.md`). Several changes brought
their own docs (Elections report recipients and announcement delivery, skills tests
under shift-report sign-offs, library course name, expiry alert switch, My
Checklists overdue week, property return letter deadline, positions that mirror a
rank, file storage, KNOWN_LIMITATIONS and UPGRADING); this pass covered what no
guide yet said and corrected one statement that had become false. `CHANGELOG.md`
stays closed.

| Change                                                                                                                                                                    | Guide          | Disposition                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| Gear-kit lines name a product and default to **Member's size**; issuing opens a review of resolved sizes (`issue-plan`, optional `selections`)                            | 05             | "Kit does not pick sizes" note was false; rewritten                               |
| Delete deactivates in-use records: training requirements, pipelines, budget categories, shift templates, basic apparatus; forms with submissions are archived             | 02, 03, 07, 11 | Added; finance "destructive delete" row and "no way to switch off" text rewritten |
| **Reactivate** and **Show inactive** for basic apparatus and training pipelines                                                                                           | 02, 03         | Added                                                                             |
| Delete "this and future events in this series"; first occurrence deleted promotes the next; approved meeting cannot be deleted                                            | 04             | Added; "no delete future" warning rewritten                                       |
| Permanent member delete keeps others' records (examiner and officer show **Former member**), returns held gear, itemizes the preview; deactivation releases future shifts | 01             | Added under Deleting Members                                                      |
| Membership type drives account status between Active and Probationary                                                                                                     | 01             | Added to Changing a Member's Status (already in UPGRADING)                        |
| Roster names link to profiles; row actions named; Change Status is a real dialog                                                                                          | 01             | Added; screenshot re-check                                                        |
| Renaming a rank code moves every stored reference                                                                                                                         | 08             | Added                                                                             |
| Mapping a Target Solutions user imports their pending records; **Import matching pending records**                                                                        | 02             | Added; wiki developer page already had it                                         |
| Governance pages share the Operations-style section header; Skills test templates reflow to cards on a phone; Checklist settings phone layout; `rwd-table-lead` fixed     | 04, 09, 05     | Layout only; no text quotes them; screenshots to re-check                         |
| Numeric request fields bounded; storage interface; pypdf 6.21.1; Alembic merge heads; TypeScript 7 editor settings; a11y and layout sweep                                 | —              | No guide impact; KNOWN_LIMITATIONS, UPGRADING and CLAUDE.md carry them            |

Screenshots: the training-guide shots were recaptured by `aa87bbfb` before this
pass; this pass captured nothing. The gap list is the top section of
[`SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md#queued-by-the-october-21--22-documentation-pass).
YouTube rows are in [`SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

## Change audit: October 20 – 21, 2026

Merged to `main` since the [October 19 – 20 pass](#change-audit-october-19--20-2026)
(written against `4f346dab`), up to `c41d7b47` (2026-10-21 12:12 UTC). About 90
non-merge commits, most of them the same Pillow 13.0.0, follow-redirects 1.16.1 and
session-limit test fixes landed on many branches. Several changes brought their own
docs (Medical Supplies, Minutes, UPGRADING, KNOWN_LIMITATIONS, the Google / Microsoft
wiki pages, the scheduling checklist text, roster and Minutes screenshots); this pass
covered what no guide yet said. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                   | Guide             | Disposition                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------- |
| Event detail: **Check In** and "You're checked in"; **View QR Code** only for managers/organizers; attendee list asked only when shared                                                  | 04                | Added; screenshot placeholder                                   |
| My Training "Awaiting approval" group renamed **No completion date**                                                                                                                     | 02                | Both mentions rewritten; YouTube 06 cue updated                 |
| Member delete, status change and archive refused above the caller's privileges                                                                                                           | 01                | Added under When Deletion Is Refused                            |
| Ranked-choice paper ballots counted individually; entered ballot by ballot                                                                                                               | 14                | Added; screenshot placeholder                                   |
| Multi-signer approvers labelled by office                                                                                                                                                | 15                | Added                                                           |
| Shift feed disconnect revokes the link for all subscribers                                                                                                                               | 03                | Added                                                           |
| Weeks start on Sunday; ballot print layout; operations header on 16 sub-pages; checklist report phone layout                                                                             | 03, 14, 05        | No text quotes them; screenshots to re-check                    |
| Create Training Session apparatus picker removed                                                                                                                                         | 02                | Nothing named it                                                |
| Delete fixes (operations, governance, finance, people, training, events); public API key audit and immediate revocation; `/health/detailed` development only; session lifetime hardening | 08, wiki Security | Operator-facing; session lifetime already in UPGRADING and wiki |
| Dependency bumps (Pillow 13.0.0, follow-redirects 1.16.1); UTC normalization sweep; probationary counted as current member                                                               | —                 | No guide impact; UTC and probationary are in UPGRADING          |

Screenshots: nothing captured. The gap list is the top section of
[`SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md#queued-by-the-october-20--21-documentation-pass).
YouTube rows are in [`SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

## Change audit: October 19 – 20, 2026

A check of the training guides (`docs/training/`) against the application as of
`4f346dab`. The guides were audited through the
[October 18 – 19 pass](#change-audit-october-18--19-2026); six non-merge commits
changed the application after it, and one of them left a guide describing a
screen that no longer exists. Cross-checks over all 19 module guides: 0 broken
links across 452 Markdown files, every route written in a guide exists in the
frontend, and the image audit flags nothing.

| Change                                                                                                                                   | Guide  | Disposition                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| Minutes: Reminders, Roll listing, Publishing and Signers dialogs replaced by **Minutes → Settings** (`/minutes/settings`, four sections) | 04, 21 | Rewritten: the roll, publishing, signing and reminder text now names the Settings sections and their real labels |
| Minutes: archive search over the words inside minutes                                                                                    | 04     | Added                                                                                                            |
| Minutes: prepared motions, accepting the previous minutes (as submitted / as revised), pre-filled adoption                               | 04     | Added; the module spec already had it                                                                            |
| Minutes: reminder email timing settings                                                                                                  | 04     | Added next to the in-app reminder text                                                                           |
| Medical screening: **Applies to Positions** enforced                                                                                     | 13     | Already updated in the commit; `13-05-add-requirement` is stale (see the currency file)                          |
| Dashboard overdue-dues count follows the dues screen                                                                                     | 11     | No guide text quotes it; nothing to change                                                                       |
| QuickBooks chart-of-accounts upload                                                                                                      | 11     | Already covered                                                                                                  |

**Follow-up audit of the Training guides.** The Training & Certification guide
(02) and the Skills Testing guide (09) were then read against the code in full
by four parallel read-only reviews, and every finding was checked and applied.
About 40 corrections, the larger ones being: the My Training "Required Training"
tile is an average of progress; submissions send in-app notices only and a plain
approval sends none; the cohort wizard and course library behave differently from
the text; historical import falls back to the default training type instead of
failing a row; the compliance forecast models expiries only; the annual report has
no waiver summary or year-over-year comparison and exports CSV only; the printed
member and program records list different content; EVOC mismatches block by
default; a skills requirement is completed by an officer's Mark complete, not by a
sign-off count; and approving a submission credits a program requirement only when
the reviewer applies it. In 09: a published template's version rises on every
save, practice runs are not listed in Skills Test Records, and a sheet with no
point-carrying steps has no percentage. Certification alert delivery is worded as
"if your department has alerts turned on" because no screen that sets that option
was found; confirm it.

Screenshots: nothing captured. The gap report is the top section of
[`SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md#queued-by-the-october-19--20-documentation-pass).

### Upgrade-visible behaviour in this window

Added by the second pass of the same day, after the training audit above.

- **Screening requirements now honour Applies to Positions.** The field was
  stored and read by nothing, so every active requirement graded every member. A
  requirement that lists positions now grades only members holding one; blank still
  means everyone; prospects are graded on all. A member left with nothing that
  applies reads **Not applicable**. A department that typed a list into the field
  while it did nothing will see rosters change. No migration. Recorded in
  `KNOWN_LIMITATIONS.md`.
- **Dashboard overdue dues** follows `dues_overdue_clause`: part-paid records are
  Partial and no longer counted. `training/11-finance.md` now says so (this
  corrects the disposition in the table above, which found nothing to change).
- **Layout:** date and time `form-input` fields are pinned inside their grid
  column so iOS WebKit cannot overflow them (Edit Member Date of Birth).
- **Security review:** meetings-minutes pass 8 fixed MM-18 (a stale prepared
  motion could still appear in a PUT response; the cause of a flaky test) and
  flagged MM-19/MM-20 (lock-free find-or-create races); admin-hours flagged AH-18;
  grants-fundraising GF-9 extended. Other passes found nothing new.
- **Screenshots:** besides the queue in `SCREENSHOT_CURRENCY.md`, replace
  `04-14-meeting-minutes.png` (one Settings button; action buttons wrap under
  the title) and the Edit Member shot showing Date of Birth.
- **Scripts:** `docs/youtube-scripts/SCRIPT_CURRENCY.md` queues script 07
  (Settings page, search) and one-line edits for screening and finance narration.

## Change audit: October 18 – 19, 2026

Net changes merged to `main` from the close of the
[October 16 – 18 pass](#change-audit-october-16--18-2026) (written against
`7cb167e3`, 2026-10-18 13:19 UTC) to 2026-10-19 ~11:30 UTC, written against
`764c733e`. About 40 non-merge commits outside the security-review ledgers and the
regenerated schema doc. Themes: **Meeting Minutes publishing**, **finance form
and routing fixes**, **equipment-check Present / Absent and ungrouped items**,
**administrative-member views**, **election email delivery**, and the
**workflow-review W55–W73** fixes. `CHANGELOG.md` is closed; this section and its
wiki handoff are the record.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-18--19-2026).

**Migration route.** Eight revisions, all additive or data-correcting and
guarded: `89723c04ae94` (`minutes_public_copies`), `6dc58d6997df`
(`meeting_minutes.attendance_listing`), `7e5d6cf3292c` (drops the duplicate
`shift_equipment_checks` index), `e99f068be43e` (`check_template_compartments.is_inline`),
`d80493f28236` (the same column from a parallel branch, re-pointed and now a
guarded no-op), `da76465bc3d2` (finance timestamps to UTC), and two merge
revisions (`2315d544d60a`, `4e18470473d6`). The two heads that #3422 and #3425 left on `main` were rejoined by `7ce50d36b948` (#3437, merged 2026-10-19 14:03 UTC); #3423 then added `01cdde60c919`, and `alembic heads` reports that single head.

### Read this first

1. **Finance timestamps are corrected once, on upgrade.** `created_at` /
   `updated_at` on 19 finance tables were stamped in the MySQL server's own zone
   (compose files set `America/New_York`) while the app reads every DATETIME as
   UTC, so a request's Created read hours before its Approved. New connections now
   pin the session to UTC and `da76465bc3d2` converts older rows row by row
   (daylight saving included), up to a cutoff; it does nothing on a UTC server and
   refuses rather than write NULLs if the zone cannot be resolved. Recorded in
   `UPGRADING.md`.
2. **Public minutes are off by default.** Three settings (public posting,
   executive library, executive public) read fail-closed; nothing is exposed
   until an officer turns it on. Roll listing unset reads as "everyone", so no
   printed or published copy changes.
3. **Expense reports and check requests no longer fall into purchase chains.** A
   chain is chosen only when its type matches the request. A department that
   relied on the leak now has requests waiting in Pending Approval until it adds a
   chain for the type.
4. **Administrative members lose two crew Operations rows** (My Checklists,
   Apparatus Inventory) and the "Clear to respond" verdict unless a position grants
   them on purpose.

### User-visible changes, by area

| Area             | Change                                                                                                                                                                                                                                          | Where documented                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Minutes          | Publish adopted minutes to the library and an optional public `/public/minutes` page; republish replaces in place; withdraw; **under correction** on reopen; executive minutes to a leadership-only folder                                      | training 04; `MEETING_MINUTES_MODULE.md`                                                   |
| Minutes          | **Roll listing**: department default and per-minutes override for which statuses a reader sees                                                                                                                                                  | training 04; `MEETING_MINUTES_MODULE.md`                                                   |
| Elections        | Pre-meeting package and nominations notice go one message per member; package send is a queued job; unreached addresses listed                                                                                                                  | training 14; wiki `Module-Elections`, `Module-Elections-Developer`; `KNOWN_LIMITATIONS.md` |
| Equipment checks | **Present / Absent** line type; Date lines always expire; crew can date a replacement; headingless **Items** groups                                                                                                                             | training 03; `UPGRADING.md`                                                                |
| Finance          | Purchase request saves as a draft as it is typed; amounts above $9,999,999,999.99 refused; approval chain min/max validated and boundary settled; budget picker hides remaining amount; chains match their own type; dues past due read Overdue | training 11, 12; `FINANCE_MODULE.md`                                                       |
| Scheduling       | Empty week offers **Go to the next shift**; own sign-up saved confirmed; ended shifts leave Open Shifts; training session times stored as UTC                                                                                                   | training 03                                                                                |
| Dashboard        | **Take a Shift** decided by per-shift eligibility; readiness verdict hidden from administrative members                                                                                                                                         | training 00, 13                                                                            |
| Operations       | Crew rows held back from administrative members                                                                                                                                                                                                 | training 05                                                                                |
| Messages         | Probationary and Retired audiences match membership status too                                                                                                                                                                                  | training 08                                                                                |
| Account          | Privacy switch label agrees with the switch position                                                                                                                                                                                            | training 01                                                                                |
| Grants           | Eight update endpoints no longer answer 500 and lose the change                                                                                                                                                                                 | training 12                                                                                |
| Forms            | Doubled "(optional)" on prompts removed; clearer purchase-request save error                                                                                                                                                                    | no screen changed                                                                          |

**Workflow review W55–W73** (messages, notifications, email templates,
suggestions, photo consent, budgets, approval chains, purchase and expense
requests, check requests, dues, store, grants, fundraising, admin hours, medical
screening, reports, integrations) fixed roughly 70 findings and flagged about 15
leads; per-workflow detail is in `docs/workflow-review/PROGRESS.md`. Notable:
fundraising edits were all 500s (W69-1), grant budget/compliance writes failed
(W68), Reports offered reports `/available` hides (W72-1), the Admin Hours report
dated evening entries by UTC (W72-2), and Integrations Disconnect acted on one tap
(W73-1).

Security-review passes (scheduling 9 with SCH-19 still open, equipment-check
shifts 10, apparatus NFC 17, facilities 10, inventory 10, documents-legal 10,
medical screening 10, membership pipeline 11, users and organizations 10,
events-requests 9) found 0 new fixes; see `docs/security-review/PROGRESS.md`.

### Documentation changes in this pass

| File                                                                              | Change                                                                            |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `docs/training/03-scheduling.md`                                                  | Go to the next shift; confirmed sign-up; ended shifts; template sets vehicle type |
| `docs/training/04-events-meetings.md`                                             | Roll listing; publishing adopted minutes                                          |
| `docs/training/05-inventory.md`                                                   | Crew Operations rows for administrative members                                   |
| `docs/training/08-admin-reports.md`                                               | Probationary / Retired audiences                                                  |
| `docs/training/11-finance.md`                                                     | Remaining amount visibility; chains by type; UTC                                  |
| `docs/training/13-medical-screening.md`                                           | Verdict hidden for administrative members                                         |
| `docs/training/14-elections.md`                                                   | One message per member; queued package send                                       |
| `docs/training/21-october-2026-release-changes.md`                                | Index for this window                                                             |
| `docs/training/SCREENSHOT_CURRENCY.md`, `docs/youtube-scripts/SCRIPT_CURRENCY.md` | Queues                                                                            |
| `wiki/Recent-Changes-2026-10.md`                                                  | Wiki handoff                                                                      |

### Screenshots

Nothing was captured. New screens and replacements are queued in
`docs/training/SCREENSHOT_CURRENCY.md` under _Queued by the October 18 – 19
documentation pass_ (minutes publishing and roll listing, package send, empty
week, equipment-check Present / Absent and Items, purchase request draft line).
`01-41` and the finance form shots should be replaced.

### Scripts

`docs/youtube-scripts/SCRIPT_CURRENCY.md` has a new queue. Re-record 07, 12, 04
and 06 / 05; the rest are spoken-line edits.

### Open items found while writing this pass

- **Two Alembic heads on `main`** appeared for a few hours on 2026-10-19 and were
  rejoined by #3437 (see above). Run `alembic heads` after any merge that brings
  in migrations.
- Open leads from the workflow review (W73-5 iCalendar switch with no reader,
  W71-1 grading half) remain in its progress ledger.
- Not covered: #3430 (minutes motions, accept previous minutes), still open, and
  #3423 (QuickBooks account names), merged after this pass was written.

## Change audit: October 16 – 18, 2026

Net changes merged to `main` from the close of the
[October 15 – 16 pass](#change-audit-october-15--16-2026) to 2026-10-18 ~12:10 UTC,
written against `8bb9a74d`. That pass was written against `cef8a679` (2026-10-16
07:45 UTC); about fourteen commits merged between 09:00 and 13:00 UTC that day
were not in it and are covered here. About 90 non-merge commits outside the
security-review ledgers, the screenshot pipeline and the regenerated schema
doc. Themes: **Elections** (background ballot sends, printed ballots, nominee
notices), **Meeting Minutes** (agenda items become the outline, signing),
**calendar and directory integrations** (Google Calendar and Outlook connect,
department ICS feed, Microsoft 365 accounts), **Medical Supplies** on the
apparatus, **equipment-check counts**, a **weekly security report**, a shared
**Operations header** and phone layouts, and a run of **create/edit-form fixes**.
`CHANGELOG.md` is closed; this section and its wiki handoff are the record.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-16--18-2026).

**Migration route.** Twelve revisions, all additive and guarded, each with a real
downgrade: `f236c56b1b49` (minutes signatures table), `0bbf263a5ff0`
(`inventory_items.apparatus_only`), `c869ec90a41b` (`calendar_sync_mappings`),
`64bf75298e89` (`suspension_requested_at` on Google accounts), `12e20092c1a8`
(count unit and par snapshot on check items), `38a57d984653`
(`meetings.agenda_items`), `c87efd81c5aa` (`ballot_send_jobs`), `73594b326e68`
(`directory_account_provisions`), `244b0fd07205` (`ballot_send_jobs.kind`),
`d3bb8f81ed07` (`license_pending`, `managed_on_premises`) and two merge revisions
(`fccdac60063f`, `1117b642643b`, no schema change). `alembic heads` should report
the single head `1117b642643b`. A forked-head repair also shipped in the
reports-analytics security pass.

### Read this first

1. **A weekly security report now goes to the IT Manager by default.** Counts only
   (alerts, errors, audit-chain verification), Monday 07:00 on the department's
   clock, to the IT Manager position or, failing that, full administrators. It
   needs the scheduler, and a required email cannot be switched off by the
   recipient. Change or disable it under \*\*Organization Settings > Authentication
   > Security Report\*\*. Recorded in `UPGRADING.md`.
2. **Equipment-check count lines change verdicts.** **Min to Pass** (or **Critical
   Min** when it is blank) fails a line; **par** only drives restock, swaps and
   the supply worklist, and never fails anything. A par-only line that used to
   fail for being one short now passes with a restock. Filed results keep their
   verdicts. Recorded in `UPGRADING.md`.
3. **Ballot and reminder emails send in the background.** A send returns at once
   and is polled; only one send per election runs at a time (a second is refused
   with 409). The job runs in the web process, not a worker, so a restart
   mid-send is reported as interrupted after 30 minutes. Ballot links are now
   committed before any mail goes out. See `KNOWN_LIMITATIONS.md` (Elections —
   Background Ballot Sends Live in the Web Process).
4. **Calendar publishing is off by default.** `CALENDAR_SYNC_ENABLED` (passed
   through the Compose files) must be set before **Connect with Google** or
   **Connect with Microsoft** works; rows an older release left "connected" read
   _coming soon_. The connect flows request only app-created-calendar scope and
   create a dedicated `<Organization> Events` calendar. The department
   iCalendar feed (`/api/public/v1/calendar/org/{token}.ics`) is issued when the
   iCalendar integration connects; it carries titles, times, location name and a
   link only.
5. **A department connects Google Workspace or Microsoft 365, not both.** Microsoft
   365 provisioning has not run against a live tenant (`KNOWN_LIMITATIONS.md`);
   accounts synced from on-premises Active Directory are flagged, never changed.
6. **Event cancellations, changes and organizer notices are now emailed** under a
   new optional member email kind, **Event changes and cancellations** (on by
   default, a department can require it). Grant compliance tasks and pledges get
   daily email reminders under **Fundraising duties** (officers, on by default).
   Neither needs a migration.
7. **A finance approval chain or step that requests have used can no longer be
   deleted.** The admin is told to turn the chain off instead; chain and step
   edits are now audited.
8. **Password changes are audited and the member is told** by a bell notice and an
   email (refusals are recorded with the control that refused, never a password).

### User-visible changes, by area

| Area             | Change                                                                                                                                                                                            | Where documented                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Elections        | Ballot and reminder emails send in the background with progress; tokens saved first; only one send at a time                                                                                      | training 14; wiki `Module-Elections`, `Module-Elections-Developer`            |
| Elections        | Printed ballot: logo, real mark boxes, each contest under its own voting method; certified results and pre-meeting PDFs share the letterhead; **Print Blank Ballots** works for item-only ballots | training 14                                                                   |
| Elections        | Nominee gets a bell notice; linking a meeting sets the voting window; position suggestions include department positions; no write-in on Approve/Deny                                              | training 14                                                                   |
| Minutes          | Agenda items (presenter, notes, prepared motion, linked documents) become the minutes outline; **Sync from agenda**; **Not taken up**                                                             | training 04; `MEETING_MINUTES_MODULE.md`                                      |
| Minutes          | Adopted minutes are signed in the app (**Minutes > Signers**; name plus password)                                                                                                                 | training 04; `MEETING_MINUTES_MODULE.md`                                      |
| Integrations     | Google Calendar and Outlook connect by sign-in; department ICS feed; calendar sync every 5 minutes                                                                                                | training 16; wiki `Configuration-Environment`                                 |
| Integrations     | Microsoft 365 account provisioning for converted members; Google attention list and admin email                                                                                                   | training 16; wiki `Integration-Microsoft-365`, `Integration-Google-Workspace` |
| Training         | **Sync History** tab on the external-training page; **Import History** renamed **Import Past Training**                                                                                           | training 02, 16; wiki `Module-Training-Developer`                             |
| Medical Supplies | Ready stock is shelf plus trucks; **Kept on apparatus only**; Next expiry and CSV include trucks                                                                                                  | training 05; `MEDICAL_SUPPLIES_MODULE.md`; wiki `Module-Medical-Supplies`     |
| Equipment checks | Min to Pass fails a count; par sets the restock; count units; builder labels and warnings                                                                                                         | training 03; `UPGRADING.md`                                                   |
| Operations       | One page header and section strip across eight pages; phone layouts for one apparatus and the supply worklist                                                                                     | training 05                                                                   |
| Dashboard        | Standby shows the member's own hours; Take a Shift and Standby hidden from members who cannot hold a seat                                                                                         | training 00                                                                   |
| Store            | Offline notice, drafts explained, one countdown                                                                                                                                                   | training 18                                                                   |
| Facilities       | Photos and documents upload in one step                                                                                                                                                           | training 06; `UPGRADING.md`                                                   |
| Admin            | Weekly security report card; one department's task failure no longer stops the rest                                                                                                               | training 08; `UPGRADING.md`                                                   |
| Events           | Cancellation, change and organizer-notice emails; post-event validation goes to organizers                                                                                                        | training 04, 07                                                               |
| Grants           | Daily compliance and pledge reminders; **Amount Awarded** on the application                                                                                                                      | training 12                                                                   |
| Finance          | Used approval chains and steps cannot be deleted                                                                                                                                                  | training 11                                                                   |
| Account          | Password change notice and audit; privacy choices path corrected                                                                                                                                  | training 00                                                                   |
| Forms            | Cleared fields save and failed creates keep their input across API keys, saved reports, IP exceptions, grants, events, locations, patterns, products, vendors                                     | no screen changed                                                             |

Security-review passes (scheduled tasks 7, locations and kiosk 7, onboarding 7,
reports and analytics 9 with RPT2-29-2 resolved, security audit and IP, core
infrastructure 7, frontend shared with an `apiCache` exclusion for `/maintenance`
routes, cross-cutting baseline 10, auth and session with a fix that HTML-escapes
the security-notice email, permissions and roles, public webhooks, storefront
payments) are recorded in `docs/security-review/PROGRESS.md`.

### Documentation changes in this pass

| File                                                                              | Change                                                                              |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `docs/training/00-getting-started.md`                                             | Standby row and Take a Shift; password-change notice                                |
| `docs/training/04-events-meetings.md`                                             | Agenda items, Sync from agenda, Not taken up; signing adopted minutes               |
| `docs/training/05-inventory.md`                                                   | Operations header; phone layouts; stock on the apparatus and Kept on apparatus only |
| `docs/training/08-admin-reports.md`                                               | Weekly security report; scheduled-task isolation                                    |
| `docs/training/14-elections.md`                                                   | Background sends, nominee notice, meeting window, printed ballots, write-in rule    |
| `docs/training/18-storefront.md`                                                  | Store offline wording                                                               |
| `docs/training/21-october-2026-release-changes.md`                                | Index for this window                                                               |
| `docs/MEDICAL_SUPPLIES_MODULE.md`, `wiki/Module-Medical-Supplies.md`              | Stock on the apparatus; closes the earlier storage gap                              |
| `docs/training/SCREENSHOT_CURRENCY.md`, `docs/youtube-scripts/SCRIPT_CURRENCY.md` | Queues                                                                              |
| `wiki/Recent-Changes-2026-10.md`, `wiki/Home.md`                                  | Wiki handoff                                                                        |

Already updated by the feature commits and checked: training 02, 03, 06, 07, 11,
12, 16, `KNOWN_LIMITATIONS.md`, `UPGRADING.md`, `COMMUNICATIONS_MODULE.md`,
`FINANCE_MODULE.md`, `GRANTS_FUNDRAISING_MODULE.md`, wiki `Module-Events`,
`Module-Grants-Fundraising`, `Security-Audit-Logging`, `Integration-Microsoft-365`.

### Screenshots

A screenshot-pipeline run on 2026-10-17 re-shot or added images for guides 00 to
08, 10, 11, 13 to 17 and marked those rows **CURRENT** in place. This pass
queues what that run could not cover (new screens from commits merged
after it, and changes it predates). See
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md#queued-by-the-october-16--18-documentation-pass).
Nothing was captured by this pass.

### Scripts

Flagged in [`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
Nothing was re-recorded.

### Open items found while writing this pass

- `docs/training/SCREENSHOT_STATUS.md` is generated and was not regenerated.
- The `Module-Elections` wiki page covers the background send; the printed-ballot
  per-contest wording is only in training 14.
- Microsoft 365 provisioning is unproven against a live tenant, and SCH-18
  (unbounded `member_call_counts`) still awaits an owner-picked cap
  (`KNOWN_LIMITATIONS.md`).

## Change audit: October 15 – 16, 2026

Net changes merged to `main` from the close of the
[October 14 – 15 pass](#change-audit-october-14--15-2026) (2026-10-15 ~11:00 UTC)
to 2026-10-16 ~13:00 UTC, written against `cef8a679`. About 30 non-merge commits
outside the security-review ledgers. Themes: **Medical Supplies** usability and
storage, **Catalog Links** auto-linking, **Google Workspace** account safety,
checklist fixes, and a **security hardening** commit. `CHANGELOG.md` is closed;
this section and its wiki handoff are the record.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-15--16-2026).

**Migration route.** `58522b08f6a7` (files medical supplies under a matching
storage area; additive, downgrade unlinks), `dc3c105464c1` and `361a40316340`
(merge revisions only, no schema change). `alembic heads` should report one head.

### Read this first

1. **Unraid and minimal compose files now require secrets.** MySQL, Redis and app
   secrets are required variables instead of placeholder defaults; a stack that
   relied on the defaults will not start until they are set. Recorded in
   `UPGRADING.md` by the commit.
2. **Sentry no longer sends local variables** (`include_local_variables=False`),
   so decrypted values in stack frames stay out of error reports.
3. **Reads of leave records, service history and the audit log are now audited**
   (HIPAA 164.312(b)); events carry ids and counts, never reason text.
4. **Departed members' Google accounts are suspended from one hook** that watches
   every status change, replacing five hand-wired call sites; a 15-minute task
   retries failures. See wiki `Integration-Google-Workspace`.
5. **A weekly email now reaches full administrators** while administrator-only
   document folders exist (see Documents below). Recorded in `UPGRADING.md`.

### User-visible changes, by area

| Area             | Change                                                                                                                      | Where documented                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Medical Supplies | Where a supply is kept (room, storage area, apparatus and compartment path), location filter, "Where it is" dialog          | training 05; `MEDICAL_SUPPLIES_MODULE.md`        |
| Medical Supplies | Sort, bulk retire, Lots dialog, clickable summary tiles, Size, Next expiry, unset reorder point is a dash, phone Select all | training 05; `MEDICAL_SUPPLIES_MODULE.md`        |
| Equipment checks | Catalog Links **Link matches automatically** with Undo; ties skipped                                                        | training 05                                      |
| Equipment checks | Critical means strictly below the minimum, never at par; builder warns only when the minimum is above par                   | training 03                                      |
| Equipment checks | My Checklists phone layout: rows by day, overdue marker, ⋯ menu, filter removed                                             | training 03                                      |
| Google Workspace | Created accounts tagged with the member id; **Link existing members**; central suspension hook                              | training 16; wiki `Integration-Google-Workspace` |
| Membership       | Undo-drop window counts from the drop's effective date, not the day it was entered                                          | training 01; `KNOWN_LIMITATIONS.md`              |
| Documents        | Weekly administrator-only folder email (`DOCUMENT_DUTIES`)                                                                  | training 07                                      |
| Security         | PHI read auditing, Sentry locals, compose secrets, incident-response policy, medical exports under export monitoring        | `SECURITY.md`; `docs/policies/`                  |

Security-review passes (equipment check pass 9, scheduling pass 8 with SCH-17
fixed and SCH-18 flagged, events-requests, training core and extended, apparatus
NFC) are recorded in `docs/security-review/PROGRESS.md`.

### Documentation changes in this pass

| File                                                                              | Change                                                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `docs/training/03-scheduling.md`                                                  | Critical minimum rule; My Checklists on a phone                               |
| `docs/training/05-inventory.md`                                                   | Medical supply finding, tidying and storage; Catalog Links auto-link and Undo |
| `docs/training/07-documents-forms.md`                                             | Weekly administrator-only folder email                                        |
| `docs/training/21-october-2026-release-changes.md`                                | Index for this window                                                         |
| `docs/MEDICAL_SUPPLIES_MODULE.md`                                                 | List, sort, bulk and storage routes                                           |
| `docs/training/SCREENSHOT_CURRENCY.md`, `docs/youtube-scripts/SCRIPT_CURRENCY.md` | Queues                                                                        |
| `wiki/Recent-Changes-2026-10.md`, `wiki/Home.md`                                  | Wiki handoff                                                                  |

Already updated by the feature commits and checked: training 01 and 16,
`KNOWN_LIMITATIONS.md`, `UPGRADING.md`, `FILE_STORAGE_HARDENING.md`, wiki
`Integration-Google-Workspace`.

### Screenshots

Re-captured by the feature commits: the prospective-members guide (`15-01` to
`15-15`, `15-02-board-truncated`, `15-09-bulk-action-result`, `20-07`, `20-12` to
`20-14`). The rest is queued in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md#queued-by-the-october-15--16-documentation-pass).
Nothing was captured by this pass.

### Scripts

Flagged in [`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
Nothing was re-recorded.

### Open items found while writing this pass

- `docs/training/SCREENSHOT_STATUS.md` is generated and was not regenerated.
- The wiki `Module-Medical-Supplies` page does not yet describe storage or bulk
  retire; it points to the module doc.
- SCH-18 (unbounded `member_call_counts`) awaits an owner-picked cap
  (`KNOWN_LIMITATIONS.md`).

## Change audit: October 14 – 15, 2026

Net changes merged to `main` from the close of the
[October 13 – 14 pass](#change-audit-october-13--14-2026) (2026-10-14 ~13:00 UTC)
to 2026-10-15 ~11:00 UTC, written against `a9ff56a2`. About 80 non-merge
commits (about 30 outside the security-review ledgers, mypy clean-ups and the
plain-language guide rewrites). Three themes: a large **Meeting Minutes** build
(review and adoption, record keeping, outlines, rich text), **inventory item
matching** ("Also called" names, near-match search, medical category delete),
and a **plain-language rewrite of most training guides** with reference-doc
corrections against the code. `CHANGELOG.md` is closed to new entries; this
section and its wiki handoff are the record.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-14--15-2026).

**Migration route.** Three new revisions: `8efc77d4c0c3` (minutes record
keeping: attendance backfill, carry-forward columns, election-result, attachment
and revision tables), `f2c5e55e7dda` (adoption columns, motion ballot link,
addendum flag, closed-session and suggestion tables) and `1d65720bce34`
(`inventory_items.also_called`). All are additive and idempotent; downgrades drop
the new tables and columns. `alembic heads` reports the single head
`1d65720bce34`.

### Read this first

1. **Rebuild the backend image.** Rich-text minutes sanitize with `nh3`, pinned in
   `backend/requirements.txt` and imported at schema load; a backend started
   without it never serves a request. From source, run
   `pip install -r backend/requirements.txt`. Recorded in `UPGRADING.md`.
2. **Minutes are circulated and adopted, and members can read circulated ones.**
   The API statuses are unchanged (`submitted`, `approved`); the screens now say
   **Circulated for review** and **Adopted**. A member can read circulated minutes
   (before: approved only), is emailed when they circulate (on by default, a member
   can turn it off), and can suggest changes. Drafts and executive sessions stay
   hidden. A department that does not want members to see unadopted minutes has
   no switch for it; this is a visible change on upgrade.
3. **Every stored attendee entry was rewritten** to one shape with six statuses.
   A previously present entry stays present, so a recorded quorum does not change.
4. **Startup repair no longer leaves NOT NULL columns empty.** A column the model
   declares NOT NULL with a server default is now added with that default. Before,
   existing rows were NULL and `GET /medical-supplies/categories` answered 500
   (`LB-SYS-001`) on an upgraded installation.
5. **`backup.sh` now includes uploads on a Docker install.** It used to archive a
   host folder that does not exist there and warn "skipping"; every earlier
   manual Docker backup went out without uploaded files. Check any such backup
   before relying on it.
6. **Claude (MCP) member sign-in worked for no tool call.** Fixed; see below.
7. **Single-member training enrollment now enforces prerequisite programs**, as
   cohort roster sync already did.

### User-visible changes, by area

#### Meeting Minutes

| Change                                                                                                                                                                                         | Where documented                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Circulate, suggest, recall, adopt**: members read and annotate circulated minutes; the secretary accepts or declines, recalls to draft, adopts as presented or as amended at a named meeting | training 04 (this pass); `MEETING_MINUTES_MODULE.md` |
| **Circulation email** to active members (`EmailKind.MINUTES_CIRCULATED`); assignees emailed on adoption (`MINUTES_ACTION_ITEMS`)                                                               | training 04 (this pass); `MEETING_MINUTES_MODULE.md` |
| **Roll call** with six statuses and a suggested roll from event check-ins; quorum derived from it                                                                                              | training 04 (this pass); `MEETING_MINUTES_MODULE.md` |
| **Closed sessions**, **motion-to-ballot links**, **election results** frozen into the minutes (late results filed as addenda outside the adopted hash), **attachments** and a **signed copy**  | training 04 (this pass); `MEETING_MINUTES_MODULE.md` |
| **Approved versions** with SHA-256 and a verify check; **printable PDF** with signature lines; **carry-forward** of open action items                                                          | training 04 (this pass); `MEETING_MINUTES_MODULE.md` |
| **Outlines** page (`/minutes/outlines`): standard order of business per meeting type, required sections enforced before circulating, default outline, **Apply outline**                        | training 04 (this pass); `MEETING_MINUTES_MODULE.md` |
| **Rich-text sections** (bold, italic, underline, two headings, lists, quotes, links); existing sections stay plain text until edited                                                           | training 04 (this pass); `MEETING_MINUTES_MODULE.md` |
| Detail page folds record panels; **Suggest a change** sits on each section                                                                                                                     | training 04 (this pass)                              |

#### Inventory and medical supplies

| Change                                                                                                                                               | Where documented                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Also called** names (up to 10) on gear and medical items; fuzzy catalog search for checklist pickers; only identical-word matches are pre-selected | training 05 (this pass); `MEDICAL_SUPPLIES_MODULE.md`; wiki `Module-Inventory` |
| Inventory CSV import **Also Called** column; sample file adds common medical supplies (no medications)                                               | training 05 (this pass); `MEDICAL_SUPPLIES_MODULE.md`                          |
| **Delete a medical supply category**; supplies, retired ones included, move to a chosen category first                                               | training 05 (this pass); `MEDICAL_SUPPLIES_MODULE.md`                          |
| Equipment-check templates refuse a cleared NOT NULL template or compartment column; the builder stops sending one                                    | `docs/app-review/PROGRESS.md`                                                  |

#### Finance, training, integrations

- **Start from last year** skips lines whose own category is retired and counts
  them as "retired" in the message and audit event (training 11, this pass).
- **Single-member enrollment enforces prerequisites** (`TRAINING_PROGRAMS.md`).
- **Claude (MCP) member sign-in:** the registry wrapper passed the department
  switch no permissions, so every tool call over a member's connection was
  refused, and a plain read tool then hit a missing message key and showed only
  "Error executing tool". Fixed (training 16, this pass).

#### Appearance and accessibility

- Floating result lists in the checklist item pickers, the medical-supply picker
  and the storefront category badge were translucent in dark mode and now use the
  opaque surface; a test extends the opaque-surface guard to floating elements and
  card utilities.
- Each control's visible text is now part of its accessible name (WCAG 2.5.3).
- The accessibility sweep's CI budget rose to 48 minutes (job cap 51), and axe
  4.14's "has no value" contrast abstention is accepted.

#### Operations

`backup.sh` uploads (above); `docs/BACKUP.md`, wiki `Deployment-Production` and
`Quick-Reference` updated by the commit. KNOWN_LIMITATIONS notes that images run
newer runtimes than the test suites.

#### Engineering (no workflow change)

mypy baseline 156 to 122 in this window; security-review passes recorded in
`docs/security-review/PROGRESS.md` (membership pipeline, users and organizations,
elections and ballots, finance, storefront payments, public webhooks, medical
screening, documents and legal: all zero code fixes except the doc-mirror
corrections noted there); app-review passes B7 (equipment check, one fix) and B8
(documents, two unused surfaces removed).

### Documentation changes in this pass

| File                                                                              | Change                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `docs/training/04-events-meetings.md`                                             | Circulating and adopting minutes; renamed buttons and member visibility |
| `docs/training/05-inventory.md`                                                   | Also called and near-match search; CSV column; medical category delete  |
| `docs/training/11-finance.md`                                                     | Start from last year skips retired categories                           |
| `docs/training/16-integrations.md`                                                | MCP member sign-in fix                                                  |
| `docs/training/21-october-2026-release-changes.md`                                | Index for this window                                                   |
| `docs/training/SCREENSHOT_CURRENCY.md`, `docs/youtube-scripts/SCRIPT_CURRENCY.md` | Queue of new and stale screenshots; beats to rewrite                    |
| `wiki/Recent-Changes-2026-10.md`, `wiki/Home.md`                                  | Wiki handoff                                                            |

Already updated by the feature commits themselves and checked, not rewritten:
`MEETING_MINUTES_MODULE.md`, `MEDICAL_SUPPLIES_MODULE.md`, `UPGRADING.md`,
`BACKUP.md`, `TRAINING_PROGRAMS.md`, `DATABASE_SCHEMA.md`, wiki
`Module-Inventory`, `Module-Medical-Supplies`.

### Screenshots

Queued in [`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md#queued-by-the-october-14--15-documentation-pass).
Nothing was captured by this pass.

### Scripts

Flagged in [`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md);
script 07's minutes beat is the largest rewrite. Nothing was re-recorded.

### Open items found while writing this pass

- No wiki page covers Meeting Minutes for operators; the module doc is the only
  reference beyond training 04. Worth a `Module-Minutes` wiki page.
- `docs/training/SCREENSHOT_STATUS.md` is generated and was not regenerated.
- There is no setting to keep unadopted minutes from members; owner decision if
  a department needs one.

## Change audit: October 13 – 14, 2026

Net changes merged to `main` from the close of the
[October 12 – 13 pass](#change-audit-october-12--13-2026) (2026-10-13 ~12:00 UTC)
to 2026-10-14 12:00 UTC, written against `eee8be13`. About 64 non-merge commits
(about 45 outside the security-review ledgers and mypy clean-ups). Four themes:
**finance** (cash advances, who may charge a budget sub-line, dues and
sub-category exports to QuickBooks, restricted funds on the request forms),
**My Training** (a current-needs tab, a History tab, rolling-hours windows and
skills-test expiry), **installation and operations** (SSL script, Python 3.13
check, backup setting) and a **button layout fix** that reached 32 screens. The
feature pull requests updated their own guides for cash advances, QuickBooks,
My Training and the training prerequisites; this pass records them, fills the
gaps that remained (budget charge access, the admin-only folder confirmation,
facility dialogs, apparatus inventory on phones, suggestion-box editor order,
history-import wording, installer settings) and queues screenshots and script
beats.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-13--14-2026).

**Migration route.** Six new revisions: `0d32069fea4d` (dues payments to
QuickBooks), `a17a47c5a871` (skill-test `valid_for_months`), `252c7517d80a`
(budget category charge access), `a39a1999776f` (cash advances), and two merge
revisions that each join two heads, `05ec84735fcf` and `70070d86ff27`. Run
`alembic heads`; it must report a single head. The four feature revisions are
additive and reversible; downgrades drop the new columns.

### Read this first

1. **Cash advances exist.** A member can ask for an advance on the check request
   form (**This is a cash advance to me**), account for it on an expense report
   and hand back unspent cash; the IRS 60/120-day accountable-plan clock is
   tracked, and **Finance > Reports > Cash advances** lists what is still open.
   A QuickBooks export that contains an advance is refused until the **Advances
   account** and **Paid from and returned to** are set. Nothing changes for a
   department that never uses them.
2. **A budget category can restrict who may charge its lines.** Restricted lines
   vanish from other members' request pickers and the server refuses them
   (`finance.manage` exempt). Nothing is restricted on upgrade. Budget owners
   set the rule for their own categories from My Budgets.
3. **Dues payments go to QuickBooks once a dues account is set.** Before that,
   exports leave dues out. After, the first export covering a period carries
   every dues payment in it, because none is marked as sent: a department that
   keyed dues by hand should export only later periods.
4. **A budget subcategory exports through its parent's accounts** instead of
   refusing the export; the download is named
   `quickbooks-journal_<from>_<to>.csv`.
5. **Rolling hours requirements now count whole calendar months** and carry no
   due date (12 months on 2026-10-13 starts 2025-11-01). A member's "due"
   status on such a requirement changes; the monthly breakdown shows why.
6. **My Training has two tabs.** The old page listed only the newest 100
   records; the new History tab reads them all.
7. **A folder only administrators could open is confirmed first**
   (`LB-DOC-001` unless `confirm_admin_only` is sent).
8. **Cohort roster sync honours prerequisite programs**: a member is added to the
   roster but not enrolled in the pipeline, with a warning naming the missing
   program.
9. **Operators:** `BACKUP_ENABLED` and `BACKUP_SCHEDULE` never did anything (use
   `BACKUP_TIME`); `install.sh --traditional` needs Python 3.13+; `setup-ssl.sh`
   was rewritten and should be re-run on a server it left half-configured.
   See `UPGRADING.md`.

### User-visible changes, by area

#### Finance

| Change                                                                                                                                                                                                                          | Where documented                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Cash advances**: request, account for, return, overdue report, QuickBooks accounts                                                                                                                                            | training 11; `FINANCE_MODULE.md`; `UPGRADING.md` |
| **Who can charge a category's lines** (open / restricted with named positions); parent picker and tree in category settings; sub-lines grouped with a subtotal on Budgets; owners set it from My Budgets; picker labels by path | training 11 (this pass); `FINANCE_MODULE.md`     |
| **Run the QuickBooks export from its own page**; subcategories inherit accounts; dues payments exported and marked sent; dues accounts on the page and the schedule dialog                                                      | training 11; `FINANCE_MODULE.md`                 |
| Restricted funds on the purchase, check and expense forms, approvals and reports                                                                                                                                                | training 11                                      |
| Compliance doc counts the cash-advance return guard in separation-of-duties coverage                                                                                                                                            | `COMPLIANCE.md`                                  |

#### Training and My Training

| Change                                                                                                                                                                   | Where documented                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| **My Training tab split**: year-to-date tiles, **Upcoming Expirations & Due Dates** (six months), requirements, five recent records; **History** tab by year, searchable | training 02                         |
| Rolling hours: whole calendar months, no due date, **Show monthly hours**, "N hrs to go" row                                                                             | training 02                         |
| A class taken last winter reads as met until the next window **Opens**                                                                                                   | training 02                         |
| Skills tests **Valid for (months)**; the member's list shows "Skills test expires"                                                                                       | training 02, 09                     |
| Cohort roster sync honours prerequisite programs                                                                                                                         | training 02; `TRAINING_PROGRAMS.md` |
| Evaluations card on Training Administration follows the practical-skills method (this pass)                                                                              | training 02                         |
| Shift history import review wording (percent article, department seat labels, multi-day end, singular counts) (this pass)                                                | training 03                         |

#### Documents, facilities, inventory, communications

| Change                                                                                                                                                    | Where documented              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Folder create / access change / move asks first when only full administrators could open it (this pass)                                                   | training 07; `ERROR_CODES.md` |
| Facility **New Record** and **New Inspection** dialogs centred; **Maintenance Type** required; maintenance rows say Overdue / Due / Completed (this pass) | training 06                   |
| Apparatus Inventory on phones: stacked rows, filter chips, pinned location headings, a saved-status line instead of a Save button (this pass)             | training 03                   |
| Suggestion-box editor: **Questions** directly after Name and Description (this pass)                                                                      | training 07                   |

#### Layout and errors (all screens)

- Thirty-two filled buttons that pair an icon with a label now lay out on one
  line at desktop widths (the icon used to sit above the label with a mouse);
  `buttonIconLayoutIntegrity.test.ts` guards the pattern.
- A deliberate 503 (for example the malware scanner refusing an upload,
  `LB-UPLD-005`) is shown at once instead of being retried for about five
  minutes; only a database or proxy outage 503 is retried.
- The Integrations mappings dialog's title was invisible on the light panel; fixed.

#### Operations and installation

- `setup-ssl.sh` detects Docker or traditional installs and gets the certificate
  before writing the HTTPS block; `install.sh --traditional` requires Python
  3.13+; `BACKUP_TIME` replaces two unread backup keys; ClamAV starts with the
  stack (no profile); the Unraid installer stops on a failed update; the Unraid
  Community Applications template is marked a draft; Compose Manager stacks have
  their own section.
- Wiki: `API-Reference` rewritten by topic with module endpoint detail moved onto
  the Developer pages; encrypt-uploads manifests print their own finalize and
  rollback commands.

#### Engineering (no workflow change)

mypy baseline 489 to 312; finance, API-layer, inventory, equipment-check and
property-return type fixes; the training enrollment lookup skipped when no
prerequisite resolves; the dues-accounts route added to export monitoring.
Security-review passes recorded in `docs/security-review/PROGRESS.md`:
equipment-check (1 fix), cross-cutting baseline, apparatus-nfc (1 fix),
auth-session, permissions-roles (1 documentation correction).

### Documentation changes in this pass

| File                                                                              | Change                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `docs/training/11-finance.md`, `docs/FINANCE_MODULE.md`                           | Charge access section, nesting note, My Budgets card         |
| `docs/training/07-documents-forms.md`                                             | Admin-only folder confirmation; Questions-first editor       |
| `docs/training/06-apparatus-facilities.md`                                        | Facility record dialogs and due dates                        |
| `docs/training/03-scheduling.md`                                                  | Apparatus Inventory on phones; history-import review wording |
| `docs/training/02-training.md`                                                    | Evaluations card wording                                     |
| `docs/UPGRADING.md`                                                               | Charge-access and installer / backup entries                 |
| `docs/training/SCREENSHOT_CURRENCY.md`, `docs/youtube-scripts/SCRIPT_CURRENCY.md` | Queue of new and stale screenshots; beats to rewrite         |
| `wiki/Recent-Changes-2026-10.md`, `wiki/Home.md`                                  | Wiki handoff                                                 |

### Screenshots

Queued in [`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md#queued-by-the-october-13--14-documentation-pass).
Nothing was captured by this pass. The two applicant-dialog images
(`01-35-applicant-drawer-final-stage.png`, `20-13-applicant-drawer-not-elected.png`)
were recaptured on 2026-10-14 by a feature commit and are current.

### Scripts

Flagged in [`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
Nothing was re-recorded.

### Open items found while writing this pass

- `docs/training/SCREENSHOT_STATUS.md` is generated and was not regenerated.
- `docs/KNOWN_LIMITATIONS.md` gained the Unraid template decision (combined image
  versus two templates) and the cash-advance notes; both await the owner.

## Change audit: October 12 – 13, 2026

Net changes merged to `main` from the close of the
[October 11 – 12 pass](#change-audit-october-11--12-2026) to 2026-10-13 12:00 UTC,
written against `22965b47`. About 145 non-merge commits (about 125 outside the
security- and app-review ledgers). Three themes: a **finance pass** (two-person
approval, accountable-plan deadline, expense classes, board reports), an
**accessibility pass** over every dialog, menu and tab list, and a run of
**owner-decision builds** from the security and app reviews. The feature pull
requests updated their own guides; this pass records what they changed, fills the
guide gaps that remained (practical skills, weekly shift patterns, Catalog Links,
Department pulse, suggestion-box steps, shift-report settings), and queues
screenshots and script beats.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-12--13-2026).

**Migration route.** Fourteen new revisions: `3c9c5025a380` (first approver on a
held request), `43b88e6ec431` (RSVP history), `9e8b0b6f3fe8` (Quartermaster gets
`locations.create`), `32a58e65eb63` (waitlist promotion email), `e6d21e605d99`
(portal access-log org/config nullable), `65128d5ccd50` (facility folders: refile
and restamp), `bcd688674099` (audit chain sealed apart from writes),
`bde76b481a16` (practical-skills method), `a51a4e1d2443` (per-member Department
pulse), `4d8807bdd737` (document "Being corrected"), `5372d41aaf3e` (requirement
due dates and completion stamp), `7a849409c1d0` (merges the last two heads),
`afaca8c1f812` (expense substantiation) and `390fa30d0200` (functional expense
class). Run `alembic heads`; it must report a single head. Two of them move or
reclassify data (`65128d5ccd50`, `bde76b481a16`): read their
[`UPGRADING.md`](./UPGRADING.md) entries before upgrading.

### Read this first

1. **A department now runs one practical-skills system.** Under **Training
   Administration > Settings & Data > Practical Skills** a department picks
   **Skills Testing** (station sheets, validated by an officer) or **Shift report
   sign-offs** (skills ticked on the shift report). The other is hidden and
   records nothing new; nothing is deleted. Existing departments start on Skills
   Testing, except those with sign-offs and no skill test ever run, which start on
   sign-offs. Changing it needs `training.manage`. The shift-report settings now
   label the skill lists that are not in effect under Skills Testing.
2. **Facility folders open to any facilities access.** Photos, Maintenance Records
   and Inspection Reports now open to anyone holding a `facilities.*` permission;
   Blueprints & Permits, Insurance & Leases, Capital Projects and a new **Facility
   Documents** sub-folder stay restricted. The migration refiles loose files.
   Review who holds `facilities.view`.
3. **Large finance requests can need two approvers.** With
   `finance.dual_approval_threshold` set (off by default; `settings.manage`), a
   purchase request, check request or expense report at or above it is approved
   only once two different people have approved. The first approval holds it.
4. **Editing a colleague's profile or contact details needs `members.manage`**
   (the API used to accept `users.edit` too). A custom position holding
   `users.edit` without `members.manage` loses that write; no seeded position does.
5. **Setup's Encryption Key step loaded with a 403** on a fresh installation
   (its read demanded a CSRF token the screen does not send). Fixed; new
   installations can finish setup again.
6. **A setup wizard open longer than 24 hours must refresh** to continue
   (sessions no longer slide forever). Setup also refuses unknown permission
   modules and custom positions that reuse a built-in id, and clamps priority.
7. **Compliance emails are live.** The saved Compliance Notifications settings
   (reminder days, non-compliance notice) are now read by a daily task. A
   department whose saved configuration holds `[30, 14, 7]` starts emailing
   members on the first run.
8. **Public-portal access logs are pruned at 90 days** and now record every failed
   API-key authentication (rows that cannot be attributed to a department are
   platform-only). The Access Logs tab and all-time usage figures cover 90 days.
9. **Recording a payment against your own dues is refused** (another
   `finance.manage` holder must do it).
10. **Grant applications follow a lifecycle.** A status change outside the allowed
    next steps is refused with a 400; overspend warns but never blocks.
11. **Audit hash chain is sealed by a separate task** (every minute). Rows appear
    as "pending seal" for a moment after the write; integrity checks report them
    separately rather than as tampering.

### User-visible changes, by area

#### Finance

| Change                                                                                                                                                                                                                                                                                                                                | Where documented                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Two-person approval** above a dollar threshold; Approvals page lists requests awaiting a second approver; threshold edited on the approval-chains settings page                                                                                                                                                                     | training 11; `FINANCE_MODULE.md` |
| **Accountable-plan deadline** for claiming expenses (`finance.substantiation_mode` off / warn / block, `finance.substantiation_days` 1–60): the expense form warns on an old date, the report marks late lines, approving a report with late lines asks for acknowledgement; Finance > Reports gains **Outside the accountable plan** | training 11; `FINANCE_MODULE.md` |
| **Functional expense classes** (program, management & general, fundraising) on budget categories with a per-purchase override; Finance > Reports gains **Functional expenses** (IRS Form 990 Part IX shape)                                                                                                                           | training 11; `FINANCE_MODULE.md` |
| **Board reports** at `/finance/reports`: budget vs actual through a date, amendment log, payments register; each on screen, as CSV and as a print layout                                                                                                                                                                              | training 11; `FINANCE_MODULE.md` |
| Payment on your own dues refused (FIN-4)                                                                                                                                                                                                                                                                                              | training 11                      |
| A receipt's download name used the day before the expense in US time zones; emailed-approval page lost focus on each keystroke (both fixed)                                                                                                                                                                                           | `FINANCE_MODULE.md`              |

#### Training and compliance

| Change                                                                                                                                                                                                     | Where documented                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Practical Skills** setting (see Read this first)                                                                                                                                                         | training 02, 09; `UPGRADING.md`     |
| **Prerequisite programs** and **Allow members to be enrolled in other programs at the same time** on the create wizard and Edit pipeline details                                                           | training 02; `TRAINING_PROGRAMS.md` |
| **Per-requirement due dates** (days after the member's cycle start), member-facing wording and completion messages are now read: reminders on the program's own ramp, one overdue notice, completion email | training 02; `TRAINING_PROGRAMS.md` |
| Cleared fields now persist on the program, phase, milestone, skill-template, record and manual-shift-entry editors, the requirement form (year, period end, dates) and the shift-report draft editor       | training 02, 09                     |
| Calls requirement's call types survive the wizard's build                                                                                                                                                  | training 02                         |
| **Compliance emails to members**: deadline reminders and non-compliance notices                                                                                                                            | training 02; `COMPLIANCE_CONFIG.md` |
| Program-progress reports relabelled **Program Requirement Progress** and **Training & Program Progress Summary**; grandfathered members graded correctly                                                   | training 08                         |
| Program-requirement edit scoped to the program in the URL (a wrong program id no longer saves then errors)                                                                                                 | `TRAINING_PROGRAMS.md`              |

#### Scheduling and shift reports

| Change                                                                                                                                                                                                                                                     | Where documented                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Weekend Only** pattern preset; manual weekly patterns can pick **Separate day and night shifts** per weekday; the pattern list shows sun/moon glyphs and the per-weekday shifts. Day and night templates are required for whichever shift types are used | training 03                      |
| Pattern start date hint now says what it does per pattern type (rotations count from it; others only bound automatic generation)                                                                                                                           | training 03                      |
| Shift-report crew form: skills wrap as one group with a score list underneath                                                                                                                                                                              | training 03                      |
| Shift-report settings label skill lists not in effect under Skills Testing                                                                                                                                                                                 | training 02, 03                  |
| Shift templates and patterns ask for confirmation before deleting                                                                                                                                                                                          | training 03                      |
| Shift History Import guide gained a sample CSV and ten screenshots                                                                                                                                                                                         | wiki `Scheduling-History-Import` |

#### Inventory

| Change                                                                                                                                                                                                                           | Where documented                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Catalog Links** page (`/inventory/admin/checklists/catalog-links`, `inventory.check_manage`): unlinked checklist lines across every template, grouped by name; lines someone else linked meanwhile are listed, not overwritten | training 05; wiki API reference |
| **Inspect** a return notice that was received another way                                                                                                                                                                        | training 05                     |
| **Record inspection** closes the item's scheduled inspection; a failed one quarantines the item                                                                                                                                  | training 05                     |
| Reorder requests link to an inventory item at create and at receipt                                                                                                                                                              | training 05                     |
| Issued count agrees with the Members page; serial or asset tag under each item name; "Unassigned" location filter renamed **No location**                                                                                        | training 05                     |
| A chosen Fail / Out of service needs a note on the server too, including for checks queued offline                                                                                                                               | training 05, 06; `UPGRADING.md` |
| Phone item editor pairs short fields; Required is a switch                                                                                                                                                                       | training 05                     |

#### Events, documents and minutes

| Change                                                                                                                     | Where documented                         |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Attendance requests show **Withdrawn and sent again once / twice**; reviewers are told when the event is already finalized | training 04                              |
| Published minutes show **Being corrected** while reopened                                                                  | training 04; `MEETING_MINUTES_MODULE.md` |
| **Folder access by position and permission** in Create Folder and Manage folder                                            | training 07                              |
| Suggestion boxes with questions ask them on a first step, then title and details on a second                               | training 07                              |
| Each document's file lives in its own directory                                                                            | `FILE_STORAGE_HARDENING.md`              |
| Legal documents page drafts and history load 10 at a time (**Load more**); at most 10 open drafts per member per type      | training 08                              |
| Anonymous donors hidden from `fundraising.view` holders                                                                    | training 12                              |

#### Grants, reports, integrations and dashboard

| Change                                                                                                                                     | Where documented                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Grant lifecycle, overspend warnings, paged applications list and dashboard cards that open the matching group                              | training 12                                |
| **Saved reports** screen (`/reports/saved`) and scheduled delivery email (summary only, PII-gated)                                         | training 08                                |
| **Customize** on the dashboard's **Department pulse**: a department default and a per-member layout (cards, order, titles, opening period) | training 08                                |
| Claude (MCP) card **Settings** button; claude.ai connection walkthrough                                                                    | training 16; wiki `Integration-Claude-MCP` |
| Salesforce **Switch to Client Credentials** button                                                                                         | training 16                                |
| Import Queue and All Mappings tabs on External Training Integrations now list real content                                                 | training 02                                |
| API key rate limit actually saved and shown                                                                                                | wiki API reference                         |

#### Accessibility and layout (all screens)

- Every `DialogPanel` dialog has a role, `aria-modal` and a name; focus starts on
  the first control, returns to the opener (also under StrictMode), and Escape
  closes tooltips, menus and the More menu with focus returning to the trigger.
- 22 tab lists gained arrow / Home / End keys; the collapsed sidebar rail opens
  its group on press; one skip link moves focus on every page; pagination keeps
  focus on a disabled edge button.
- Dialog action buttons are pinned in the footer on 19 more forms; nested double
  scrollbars removed from 31 dialogs; the applicant detail view is a centred
  dialog (not a drawer).
- Check-In Station cards padded; store and cart steppers announce values.

#### Operations and installation

- `universal-install.sh` now writes `ALLOWED_ORIGINS` from `--public-url`, probes
  backend health with the image's own check, and the Unraid script reads answers
  from the terminal under `curl | bash`; `backend/scripts` ships in the production
  image.
- Wiki: Installation split into one page per platform; Training, Inventory,
  Scheduling, Events and Elections module pages split into user and Developer
  pages with dated notes dropped; change logs filed by month.
- CI: a mypy error-count ratchet (`mypy-baseline.txt`) and a Backend Type Check job.

### Screenshots

Queued in [`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md#queued-by-the-october-12--13-documentation-pass).
Nothing was captured by this pass.

### Scripts

Flagged in [`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
Nothing was re-recorded.

### Open items found while writing this pass

- `docs/training/SCREENSHOT_STATUS.md` is generated and was not regenerated.
- Security-review passes recorded in this window (documents-legal, medical-screening
  MS-15 flagged, membership-pipeline, users-organizations, elections-ballots,
  finance-approvals FIN8-05-1 flagged, storefront-payments, public-webhooks,
  permissions-roles) live in `docs/security-review/PROGRESS.md`; flagged items
  await the owner.

## Change audit: October 11 – 12, 2026

Net changes merged to `main` from 2026-10-11 ~12:00 UTC (the tail of the
[October 8 – 11 pass](#change-audit-october-8--11-2026)) to 2026-10-12 13:00
UTC, written against `89ea4d6a`. About 90 non-merge commits, most of them
"owner decision" builds that turned documented click-paths into real screens.
The feature pull requests updated their own training guides and module docs; this
pass records what they changed, fills the gaps that remained (two training notes),
and queues screenshots and script beats.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-11--12-2026).

**Migration route.** Six new revisions: `2cfc5a75105e` (meeting types),
`edb445ae5806` (voting tokens carry the voter), `7adc810c57f9` (candidate accepted
on behalf), `b834afdaffdf` (message-delivery retries), `e1a5bfe7a2ed` (place
stranded prospects) and `dcb8a46ac50c` (file unfiled documents into General
Documents, which also joins heads `3f3bd6f3c7e4` and `990e288940bc`). Run
`alembic heads`; it must report a single head.

### Read this first

1. **No document is org-wide and unfiled any more.** An upload with no folder goes
   to **General Documents**; the migration files existing unfiled documents there
   (reversible, recorded in `document_unfiled_backfill`). Previously such a
   document was readable by every `documents.view` holder outside every folder's
   rights. Review who can open General Documents.
2. **Forms: one submission per person is enforced on both paths** (builder
   control added). A form set to refuse repeats now refuses a member's second
   in-app submission too ("You have already submitted this form").
3. **Election results change shape.** Results are graded per ballot item;
   `overall_results` holds only candidates no contest claims. API consumers that
   read it must read `results_by_position`.
4. **Five settings were retired** (`RATE_LIMIT_PER_MINUTE`, `MAX_FILE_SIZE`,
   `STORAGE_TYPE`, `UPLOAD_DIR`, `DB_POOL_MIN`). A `.env` that names one still
   boots with a warning; they were never read.
5. **Customised email templates now carry the department footer** even when their
   body omits `{{footer_html}}`.
6. **Prospect Auto-Purge warns first**: coordinators are emailed seven days before
   an application is deleted.
7. **A duplicate Alembic revision is refused in production** instead of silently
   falling back.

### User-visible changes, by area

#### Finance and grants

| Change                                                                                                                                                | Where documented                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Dues page: New/Edit schedule, Generate dues (confirmed), Record payment, for `finance.manage`                                                         | training 11; `FINANCE_MODULE.md`            |
| Export history beside the QuickBooks mappings                                                                                                         | training 11                                 |
| **Add Opportunity** screen (`/grants/opportunities/new`, `fundraising.manage`); previously bounced to the dashboard                                   | training 12                                 |
| **Record Donation** form; **Pledges** (`/grants/pledges`) and **Fundraising Events** (`/grants/events`) pages; Outstanding Pledges tile link restored | training 12; `GRANTS_FUNDRAISING_MODULE.md` |

#### Inventory and equipment checks

| Change                                                                                                                                                                                 | Where documented |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Assign and Distribute ask **Permanent** or **Temporary** with a return date                                                                                                            | training 05      |
| Departure clearance record screen: resolve lines, Complete, or Close incomplete                                                                                                        | training 05      |
| Low stock sums lots for lot-stocked items; dashboard excludes medical; a colleague's allowance and sizes need `inventory.manage`                                                       | training 05      |
| A short count on an equipment check raises a restock report; a lot swap files a reorder request at the reorder point                                                                   | training 05/06   |
| Check reports attribute to the shift's unit (basic apparatus appear); a check filed before the shift date reaches the fleet board; compliance report counts expected and missed checks | training 06      |

#### Medical screening

Per-member and per-prospect compliance view (**Show compliance for**), and a
department roster with a **Not compliant (overdue)** filter; roster and report
races settled, and no one reads compliant by default. Training 13,
`MEDICAL_SCREENING_MODULE.md`.

#### Meetings, minutes and events

Meeting **Attendance** dashboard (`/minutes/attendance`, `meetings.manage`);
executive, trustee and annual meetings recorded again; action items assigned to
an active member who can update their own status; guests listed on the event page
apart from member attendance. Training 04.

#### Forms, documents and communications

Publish warning for public forms that would file nothing (new, added to training
07 in this pass); one submission per person with a builder control; **Manage
folder** on the Documents screen (rename, access, move, delete; system folders
protected); failed or throttled department-message deliveries retry five times
(5/10/20/40/80 minutes) then show as failed; the chosen email footer is appended
when a body omits it; web push is always pinned to public addresses. Training 07
and 08.

#### Elections

Proxy ballots allowed on anonymous elections with an acknowledgement; voided
votes walked in the integrity chain; no default Abstain and Submit waits for every
item; named-election link votes record the voter; manager acceptance labelled and
the slate frozen at close; ballot links retired when the ballot changes, with a
resend prompt; non-managers see no recipients or live counts while open; auto-open
sends ballots and alerts managers if it cannot; results graded per item. Training
14 and wiki Module-Elections.

#### Prospective members and settings

Referral source, referrer and interest reason in the drawer; Convert decided from
the final-stage flag; pipeline-less applicants placed on a board (stranded ones
backfilled); pipeline widget counted in SQL; **Department Email** section in
Organization settings; Auto-Purge seven-day warning. Training 01, 15,
`PROSPECTIVE_MEMBERS_MODULE.md`.

#### Scheduling and reports

**Give everyone all _N_ calls** on the close-out confirm step (new, training 03);
three saved-but-inert settings labelled "not in effect"; start-of-shift reminder
email reads as on; an unstarted check points at **Complete Checklists**; reports
read date ranges on the department's calendar and warn about a range predating
the tracking mode. Audit-log **Apply** is disabled until the search changes.

#### Security and engineering (no workflow change)

Single encrypted, confined storage service for uploads; org-scoped duplicate-check
lock for forms; security rotation passes on core infrastructure, frontend-shared,
cross-cutting baseline and auth/session recorded under `docs/security-review/`;
mypy and test-fixture clean-ups; reminder CC buttons raised to AAA contrast and a
44px target.

### Documentation changes in this pass

| File                                                 | Change                             |
| ---------------------------------------------------- | ---------------------------------- |
| `docs/training/03-scheduling.md`                     | Give everyone all calls            |
| `docs/training/07-documents-forms.md`                | Publish warning                    |
| `docs/training/21-october-2026-release-changes.md`   | Fifth-window index                 |
| `docs/training/SCREENSHOT_CURRENCY.md`               | Queue of new and stale screenshots |
| `docs/youtube-scripts/SCRIPT_CURRENCY.md`            | Beats to rewrite or re-record      |
| `wiki/Recent-Changes-2026-10.md`, `Home`, `_Sidebar` | Wiki handoff                       |

`CHANGELOG.md` is closed to new entries; the pull requests are the record.

### Gaps left open

- No screenshot was captured; every row in `SCREENSHOT_CURRENCY.md` is queued.
- No YouTube script was rewritten; beats are queued in `SCRIPT_CURRENCY.md`.
- Feature guides were written by their own pull requests; this pass spot-checked
  coverage by keyword, not line by line against the UI.
- `docs/UPGRADING.md` was not re-audited here; confirm it names the document
  filing, one-submission and retired-settings changes.

## Change audit: October 8 – 11, 2026

Net changes merged to `main` from 2026-10-08 13:13 UTC (the end of the
[October 7 – 8 pass](#change-audit-october-7--8-2026)) to 2026-10-11 11:40
UTC, written against `56e88f49` (PR #3070). About 130 non-merge commits.
This pass also covers the gap between the last two passes: the October 9 work
was largely documented by the commits that shipped it, so this audit records
what they changed and names the guides that gained text here.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-8--11-2026).

**Migration route.** Twenty new revisions in this window. Run `alembic heads`; it
must report a single head. The newest are `46c55e6a3330` (pre-shift work),
`778c3de73086` (suggestion intake questions) and `4b7e1f0c9a2d` (Compliance box
question). The last 25 hours added only those three.

### Read this first

1. **Pre-shift work is on by default** (`scheduling.pre_shift_work_enabled`).
   Members scanning a vehicle before check-in opens are offered "Doing pre-shift
   work?". Nothing counts until an officer approves it, and it adds hours, never
   shifts. Switch it off under Shift Settings → **Allow pre-shift work**.
2. **Stored files are encrypted at rest and setup asks for key custody** (from
   October 9). Existing files stay plaintext until the operator runs
   `scripts/encrypt_uploads.py`; settings holders see a notice until they confirm
   `ENCRYPTION_KEY` and `ENCRYPTION_SALT` are kept apart from the server and its
   backups. Detail in `docs/UPGRADING.md` and `docs/FILE_STORAGE_HARDENING.md`.
3. **Budgets are governed by confirmation and stages** (October 8 – 9). Amendments
   wait for a second officer; once a budget goes before the board a line's amount
   changes only by confirmed amendment; adopting, starting and closing a fiscal
   year are separate Treasurer steps. `docs/UPGRADING.md` carries each.
4. **Prospective-member Auto-Purge now deletes** (October 9), counting from the
   upgrade. See its UPGRADING entry.
5. **Document folders open to module rights** (October 9); read who now sees what.

### User-visible changes, by area

#### Scheduling

| Change                                                                                                                                        | Where documented                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Pre-shift work from the vehicle scan, officer approval, hours-not-shifts                                                                      | training 03; `SCHEDULING_MODULE.md` (Pre-Shift Work); wiki Module-Scheduling |
| Shift History Import: draft, members/units/positions/shifts review, joined entries (Split apart / Rejoin), remembered decisions, final commit | training 03 (new this pass); APPLICATION_PAGES.md                            |
| A shift can be put on a rig from the Apparatus module (`/scheduling/apparatus-options`)                                                       | training 06 (new this pass)                                                  |
| Scheduling reports stat cards shrink at 320px                                                                                                 | layout only                                                                  |

#### Administration hubs

Described cards for Events, Members and Store; Training's seven areas with
described destinations; a scrolling chip row with an edge cue on phones; phone
metric slots (two); Inventory and Scheduling cards with **Headline Metrics**;
hub sections in the command palette; stale back links, repeated titles and the
duplicate **Add Member** button removed; four new **Needs attention** queues
(skills tests awaiting validation, shift reports, department-wide attendance
requests, open order windows). Documented in training 08 and 10. Tab URLs
(`?page=`, `?tab=`) are unchanged.

#### Communications

Suggestion boxes ask branching intake questions and can route a submission to
another box; the Compliance box is seeded with a required concern-type question
(training 07, `COMMUNICATIONS_MODULE.md`, wiki Module-Communications).

#### Events

"I was there" requests can be withdrawn (two per event, then final), and
organizers get a cross-event list at `/events/attendance-requests` with a
**My events / All events** toggle for `events.manage`. Already in training 04 and
wiki Module-Events.

#### Finance

Budget owner positions and stations; amendments, reversals and second-officer
confirmation; next-year requests with leadership and board review; adoption,
start, year-end close and lock; **My Budgets**; receipts on requests and expense
lines (filed as documents); QuickBooks journal-entry export held to Intuit's
rules. Already in training 11 and `FINANCE_MODULE.md`.

#### Apparatus and facilities

Deficiency explanation and Failures link; required **Reason** for statuses that
need one; photos and documents filed as real documents; equipment-check template
builder restacked for phones; facility compliance checklist creation fixed.
Training 06 and 10.

#### Members and training admin

Admin-hours entry methods read **QR Scan**, **ID Card Station**, **Manual**,
**Event Attendance** (training 01). Training requirement edits persist clearing
categories and widening a type. The Members guide was rewritten in plain
language on October 11.

#### Security and storage

- Every stored file is encrypted (AES-256-GCM, per-file key); downloads stream
  plaintext; emailed attachments are decrypted first. Uploads are organization-
  first, scanned and confined to their organization.
- **XC-1 closed** (October 8 – 11): client-supplied foreign keys are checked in
  the caller's organization across members, elections, minutes, forms, training,
  scheduling, events, inventory and apparatus; the coverage check then found and
  fixed `required_skills` and `target_roles` on training requirements and
  programs. A program imported from another department keeps only this
  department's own positions rather than being refused. Recorded in
  `docs/security-review/` and `ORG_SCOPING_SWEEP.md`.
- The audit-history page no longer writes a "profile viewed" entry on itself;
  the export readiness route is monitored for data exfiltration.

#### Engineering (no workflow change)

SQLAlchemy models typed with `Mapped`; mypy errors cleared across `app/`; frontend
tests now type-check (`typecheck:tests`); screenshot placeholders hidden from
readers (`docs/training` placeholders stay for the capture tools).

### Late additions (merged 2026-10-11 10:50 – 12:01 UTC)

- **Suggestion intake answer types:** rating, time, pick a member, pick a vehicle,
  and "at least / at most" follow-up rules (shared with Forms number fields). No
  schema change. `GET /suggestions/pick-options` returns whole lists, never a
  search, so typed names stay out of the access log. Training 07.
- **Equipment-check builder links to medical supplies** and **Clone checklist**
  asks for the target apparatus (it never worked before). Training 05.
- **Shift history import creates former members as archived**, not inactive
  (migration `990e288940bc`, touches only rows the import wrote). The roster opens
  on **All Current**; the Total Members card excludes archived members. Training 03.
- **QuickBooks export sends each payment once** and reverses a check voided after
  export (migration `3f3bd6f3c7e4`; `includeExported` re-sends a period). Already
  in training 11 and `docs/UPGRADING.md`.
- The Scheduling guide (03) was rewritten in plain language the same day; the new
  section here was re-applied on top of it. Its inline screenshot notes moved to
  `SCREENSHOT_CURRENCY.md`.
- Migration head moved past the three listed above: `3f3bd6f3c7e4` and
  `990e288940bc` are also new. Run `alembic heads`.

### Documentation changes in this pass

| File                                                                                               | Change                                            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `docs/training/03-scheduling.md`                                                                   | New: Pre-Shift Work and Importing Shift History   |
| `docs/training/06-apparatus-facilities.md`                                                         | New: Deficiency, status reason, shifts on a rig   |
| `docs/training/07-documents-forms.md`                                                              | New: suggestion-box intake questions and routing  |
| `docs/training/08-admin-reports.md`                                                                | New: Administration hubs section                  |
| `docs/training/10-mobile-pwa.md`                                                                   | New: hubs and checklist builder on a phone        |
| `docs/training/21-october-2026-release-changes.md`                                                 | Fourth-window index                               |
| `docs/training/SCREENSHOT_CURRENCY.md`                                                             | Queue of new and stale screenshots                |
| `docs/youtube-scripts/SCRIPT_CURRENCY.md`                                                          | Beats to rewrite or re-record                     |
| `docs/UPGRADING.md`                                                                                | Pre-shift work, history import, suggestion intake |
| `wiki/Recent-Changes-2026-10.md`, `Home`, `_Sidebar`, `Module-Scheduling`, `Module-Communications` | Wiki handoff                                      |

`CHANGELOG.md` is closed to new entries; the pull requests are the record.

### Gaps left open

- No screenshot was captured; every row is queued, not done.
- No YouTube script was rewritten; the beats are queued in `SCRIPT_CURRENCY.md`.
- The history import's CSV column names are not listed in the guide because the
  in-app template is the source; confirm the guide's wording against it.
- Compliance's "not watched around the clock" help text is worth a human read
  against department policy.

## Change audit: October 7 – 8, 2026

Net changes merged to `main` in the 25 hours ending 2026-10-08 ~09:00 ET,
written against `832609f7` (PR #2995). It picks up where the
[October 6 – 7 audit](#change-audit-october-6--7-2026) stopped, at
`021fecc6` (PR #2980). Sixteen pull requests merged (#2981 – #2996). Six
carry user-visible work: **#2985** and **#2987** (training-provider imports and
training records), **#2989** (Add Member fix), **#2991** (finance requests),
**#2992** and **#2993** and **#2995** (dark-mode menus, apparatus guidance,
member visibility layout). Eight are security-review records (#2981, #2983,
#2984, #2986, #2988, #2990, #2994, #2996), two of which also fixed code (#2994,
#2996). #2982 was the previous documentation pass.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-7--8-2026).

**Migration head.** Five new revisions follow the previous window's head
`8c4f2a6e1d93` as one chain (see _Migration route_). Run `alembic heads`: it must
report a single head, `7db20aa49329`.

### Read this first

1. **Every member can now raise their own finance requests** (#2991, new
   permission `finance.request`). Migration `7db20aa49329` grants it to each
   department's seeded **Member** position, so on upgrade **every member** can
   create, edit, submit and (for a draft purchase request) withdraw their own
   purchase requests, expense reports and check requests, and sees only their own.
   Another member's record is a 404. Approval chains still apply and nobody can
   approve or pay their own. To withdraw it, remove `finance.request` from the
   Member position. `docs/UPGRADING.md` (2026-10-07) carries the detail.
2. **Target Solutions syncs and uploads now credit members automatically**
   (owner decision). Matched completions become training records at sync or
   upload time; unmatched ones wait under **Imports**. Vector Solutions, Lexipol,
   iAmResponding and Custom API **keep the officer's review step** until each is
   reviewed (`AUTO_CREDIT_PROVIDERS` in `external_training_service.py` is the list
   a provider joins). The same import path now serves sync, upload and the
   **Import** / **Bulk Import** buttons, which used to ignore the category and
   credit hours the officer chose.
3. **Officers can void or edit a member's training record, and the member is
   told** (#2987). A void needs a reason, which the member sees on Training History
   and My Training and receives by bell and email. A void is final (it cannot be
   edited back into credit) and it now also removes a qualification the record
   granted. See _Training records_.
4. **Three requirement templates changed type.** HIPAA, Bloodborne Pathogens and
   Hazmat now create **Courses** requirements; the old "hours filtered by type"
   form let any CAPCE hour of that type satisfy a HIPAA refresher. **Existing
   requirements are not rewritten**; a warning appears on the card of an hours
   requirement carrying one of those codes with no category or course scope.
   Training officers should open **Training Admin › Requirements** and fix them.
5. **A migration marks duplicate staged imports.** `9bb4af123ebc` makes
   `(provider_id, external_record_id)` unique. Existing duplicates are settled
   first and nothing is deleted: the kept row is the imported one, else the
   earliest; others get `#dup:<id>` appended and (if never imported) status
   `duplicate`, leaving the Imports queue.

### What changed, by area

#### Training provider imports (Target Solutions first)

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Where it shows                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **Upload Report** — a Target Solutions provider card takes the completions-report CSV with no key or secret (`POST /training/external/providers/{id}/upload-report`, `training.manage`, 25 MB, `.csv`). Same parser as sync; recorded in sync history as "upload". Sync and upload take turns on the provider row, so a completion is never recorded twice.                                                                                                                                                                                | **Integrations › Training providers**, provider card           |
| **Live report accepted.** The report opens with a title block above the header row; the parser now finds the header row instead of rejecting every real report. A failed report request says what Target Solutions actually returned.                                                                                                                                                                                                                                                                                                      | Sync result and error                                          |
| **Members matched by Employee ID** when email finds nobody (Target Solutions only; membership number, same department, live members, one candidate only).                                                                                                                                                                                                                                                                                                                                                                                  | Unmatched count on Imports                                     |
| **Credit hours come from Duration (hours)**, not Time Spent In Course. All import paths store `credit_hours`.                                                                                                                                                                                                                                                                                                                                                                                                                              | Training records                                               |
| **Admin items are policy acknowledgments.** New training type `policy_acknowledgment` for Target Solutions "Admin" assignments (migration `6cf89b44dc08` widens the type ENUM on five tables). A second acknowledgment of one item by one member on one day is staged as a duplicate.                                                                                                                                                                                                                                                      | Requirement, Course Library and Historical Import type pickers |
| **Course mappings.** Provider course ids map to library courses (`external_course_mappings`, migration `95dbdfb6591d`), so a requirement linked to the library course is met by any mapped version. A **Courses** tab under Mappings lists each course with its completion count and a suggested library match (one-click **Map**, never applied unasked). Mapping back-fills records already imported; unmapping reverses it; both are audit-logged. Training officers get one **New Course Version to Map** email per resembling course. | **Integrations › Training providers › Mappings › Courses**     |
| **Category order** for an imported record: the officer's choice, provider category mapping, the mapped course's first active category, the bulk default, then the provider default.                                                                                                                                                                                                                                                                                                                                                        | Training records                                               |
| **Provider credentials redacted from failure tracebacks** (query-string auth).                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Logs and Sentry only                                           |

#### Training records

- **Void and Edit** on the member's Training History page (`training.manage`).
  Void requires a reason, stored as `void_reason` with `voided_at` / `voided_by`
  (migration `26ca07c56d0f`, three nullable columns). An edit that changes a value
  the member sees sends a bell notice and email listing each change. The email is
  a new **required** kind, _Changes to your training record_, with two editable
  templates (_Training Record Voided_, _Training Record Updated_).
- A void withdraws a qualification the record granted (the removal was previously
  flushed but never committed). A provider-imported record keeps its provider id,
  so a later sync links to the voided record instead of crediting it again.
- **Requirement guidance.** The training guide now warns against Hours
  requirements for a required topic, with a type-by-rule table and a fix-up
  checklist; the integrations and programs guides point to it.

#### Finance

- Member request pages (#2991): list and detail routes open to `finance.request`,
  `finance.view` or `finance.manage`; New/Edit to `finance.request` or
  `finance.manage`. A member's lists read **My Purchase Requests / My Expense
  Reports / My Check Requests**. Order, receive, pay, issue and void stay with
  `finance.manage`; Void is offered only on an issued check.
- Forms read fiscal years and budget lines from new `GET /finance/budgets/options`
  and `GET /finance/fiscal-years/options` (label plus amount remaining), so a
  member picks "Training — $1,250.00 remaining" without budget access.
- A **Finance** navigation group (side and top bar), each entry gated by its route.
- Expense-report org-wide view stays manage-only (FIN-5).

#### Apparatus (#2993, frontend only)

- The row wrench opens the **Maintenance** tab (it was a second "View"); the row
  **Archive** button is gone, because archiving needs the disposal form on the
  apparatus page.
- An empty fleet reads **No apparatus yet** with a sentence on what a record is
  for; a search or filter with no match still reads **No Apparatus Found**.
- Add form: "Only the fields marked \* are needed to start." The NFPA checkbox says
  tracking is per vehicle and off by default, even when the department switch is
  on. Fuel type reads **CNG**, not "Cng".
- Equipment tab explains that crew shift checks come from a separately built
  checklist and links to **Build equipment checklists** for `inventory.check_manage`.
- Maintenance form: states which date to use and that the **Next Due** fields stay
  on the record and do **not** add to Maintenance Due.
- **Badge contrast.** Status and type colours tint the badge and icon; the text
  uses the theme's primary colour. (Seeded green "In Service" measured 1.95:1 and
  the red "Engine" badge 3.98:1, below 4.5:1.)

#### Other UI

- **Member Visibility Settings** (My Training, officers) is laid out as bordered
  group cards in two columns, with matching headings. While a change is unsaved, a
  bar pinned to the bottom of the viewport shows the count and the Save button
  (#2995).
- **Floating menus are opaque in dark mode**: Training Admin **More** and the
  equipment-check builder's row and Tools menus used the translucent surface, so
  page content showed through (#2992).
- **Add Member no longer fails with a server error when a membership number is
  entered** (#2989). A function-local import made the name local to the whole
  function, so the availability check raised `UnboundLocalError`. A sweep test now
  covers the whole backend for a name used before a local import of it.

#### Security and operations

- **Onboarding (#2996, ONB4-30-1, HIGH).** Two concurrent, unauthenticated calls to
  create the organization both passed the "no organization yet" check. The
  `onboarding_status` singleton row is now locked and the check is a locking read;
  verified 8/8 races → exactly one success. **ONB4-30-2 (LOW):** a failure logging
  `reset_completed` after a reset had committed no longer records a false
  "reset_failed" or returns a 500.
- **Pipeline Overview report (#2994, RPT6-29).** The report did not exclude the
  caller's own prospective-membership record, so an officer who had once applied
  saw their own name, email and stage and had it folded into the aggregates. It now
  applies the same hidden-prospect rule as every sibling route.

### Behaviour changes at a glance

| Change                                                         | Visible effect                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `finance.request` on the Member position                       | Every member can raise and track their own requests                 |
| Target Solutions auto-credit                                   | Matched completions become records without an officer step          |
| HIPAA / Bloodborne / Hazmat templates are Courses requirements | Officer must link the course before saving; old ones show a warning |
| Void requires a reason and tells the member                    | Bell notice and required email                                      |
| Unique staged import per provider record                       | Duplicates marked `duplicate`; none deleted                         |
| Apparatus row Archive removed; wrench opens Maintenance        | Archive from the apparatus page                                     |
| Fuel type label                                                | CNG                                                                 |

### Review passes in the window

Records live in `docs/security-review/`.

| Pass                                             | Result                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| MSUP-23 medical supplies, pass 13 (#2981)        | 0 fixed, 0 new                                                                                                                  |
| MM-24 meetings & minutes, pass 6 (#2983)         | 0 fixed, 0 new; 2 flagged items re-confirmed **open**                                                                           |
| MSG-25 messaging & notifications, pass 6 (#2984) | 0 fixed, 0 new                                                                                                                  |
| FORM-26 forms, pass 6 (#2986)                    | 0 fixed, 0 new                                                                                                                  |
| INT-27 integrations, pass 6 (#2988)              | 0 fixed, 0 new                                                                                                                  |
| SEC2-28 security audit & IP, pass 6 (#2990)      | 0 fixed, 0 new; two prior findings resolved; SEC2-28-6 and -10 remain open; one dangling `KNOWN_LIMITATIONS.md` reference fixed |
| RPT6-29 reports & analytics, pass 8 (#2994)      | **1 fixed** (pipeline overview self-exposure)                                                                                   |
| ONB4-30 onboarding, pass 6 (#2996)               | **1 HIGH fixed** (single-org race), **1 LOW fixed** (false reset_failed)                                                        |

### CI and test infrastructure (no user-visible change)

- The member ID card test now waits for the barcode draw (a passive effect that
  could land after the assertion on a loaded runner) (#2995).
- `HTTP_413_CONTENT_TOO_LARGE` replaces the deprecated status name in the upload
  endpoint.
- New regression tests: finance member requests and the grant migration, void and
  edit notices, course mapping, report upload, credit hours, Target Solutions
  keying and log redaction, onboarding race and reset logging, pipeline-overview
  privacy, requirement config warning, Add Member membership number.

### Migration route

| Revision       | What it does                                                                                                      | Downgrade                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `9bb4af123ebc` | Unique `(provider_id, external_record_id)` on staged imports; settles existing duplicates first                   | Restores renamed rows' original ids and statuses exactly                             |
| `6cf89b44dc08` | Adds `policy_acknowledgment` to the training-type ENUM on five tables, keeping nullability and defaults           | Turns such rows back into `continuing_education`, narrows the ENUM                   |
| `95dbdfb6591d` | `external_course_mappings` (seeded with unmapped rows from staged course ids); `external_course_match` email type | Drops the table, **losing mappings** (records keep their course link)                |
| `26ca07c56d0f` | `training_records.voided_at / voided_by / void_reason`; two new email template types                              | Drops the columns, **losing structured void reasons** (the note in `notes` survives) |
| `7db20aa49329` | Grants `finance.request` to existing seeded Member positions                                                      | Removes it from them                                                                 |

`DATABASE_SCHEMA.md` was regenerated by the feature PRs.

### Still open (owner decisions, recorded in `KNOWN_LIMITATIONS.md`)

Everything listed in the previous audit still applies, plus: automatic crediting
for Vector Solutions, Lexipol, iAmResponding and Custom API awaits a per-provider
review; the two flagged meeting-minutes items (MM-24); SEC2-28-6 and SEC2-28-10.
The "a requirement cannot name one policy acknowledgment" limitation is resolved
by course mapping.

### Documentation and media disposition

**Updated in this pass:** this audit; the wiki handoff and sidebar/Home links;
`docs/training/06-apparatus-facilities.md` (first-run guidance, Maintenance
dates); `docs/training/02-training.md` (Member Visibility Settings layout);
`docs/training/21-october-2026-release-changes.md` (October 7 – 8 index);
`docs/UPGRADING.md` (Target Solutions auto-credit and duplicate settlement);
`wiki/Module-Apparatus.md`. The feature PRs already updated the finance,
integrations and training guides, `FINANCE_MODULE.md`, `TRAINING_PROGRAMS.md`
and `Module-Training.md`.

**Screenshots to create or replace** are in
`training/SCREENSHOT_CURRENCY.md` (section _Queued by the October 7 – 8
documentation pass_). **Script beats to fix or re-record** are in
`youtube-scripts/SCRIPT_CURRENCY.md` (section _Oct 7 – 8_). Nothing was
re-captured or re-recorded: the capture stack does not run in this environment.

**Not edited, deliberately.** `CHANGELOG.md` has been closed to per-change
entries since 2026-09-08 (see `CLAUDE.md`), so nothing was appended to it or to
`docs/changelog/`; this audit, the pull-request descriptions and `UPGRADING.md`
carry the narrative. The finance request routes were registered in all three
registries by #2991; no other route was added or retired.

## Change audit: October 6 – 7, 2026

Net changes merged to `main` in the 25 hours ending 2026-10-07 ~09:00 ET,
written against `021fecc6` (PR #2980). It picks up where the
[October 5 – 6 audit](#change-audit-october-5--6-2026) stopped, at
`09f24912` (PR #2964). Ten pull requests merged (#2965, #2967, #2973 – #2980).
One of them, **#2965, is the whole story**: 82 commits, 457 files, eleven
migrations, and the owner-decision docket for medical screening, deployment,
scheduling, compliance, training, members and elections. The rest are a
desktop-density follow-up (#2967), the previous documentation pass (#2974),
one test fix (#2979) and six security-review records (#2973, #2975 – #2978,
#2980). **No code outside #2965, #2967 and #2979 changed.**

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-6--7-2026).

**Migration head.** Eleven new revisions follow the previous window's merge head
`15802f3df5c4` as one chain (see _Migration route_). Run `alembic heads`: it must
report a single head.

### Read this first

1. **Every backend setting in `.env` now reaches the container.** The backend's
   `environment:` block in all three shipped compose files was an allowlist and
   `.env` is never mounted, so 137 of 170 settings (SMTP, OAuth, Twilio, CAPTCHA,
   push, Sentry, password policy, …) silently did nothing. They are now all passed
   through, each defaulting to the app's own default. **A line in `.env` that has
   been doing nothing starts doing something on the first restart, and a typo
   (`EMAIL_ENABLED=ture`) or a production-check violation (`RATE_LIMIT_ENABLED=false`)
   now stops the backend booting.** `docs/UPGRADING.md` (2026-10-06) lists the
   groups to review and the preflight to run first. Compose files an operator
   maintains themselves (for example Unraid Compose Manager) keep their old
   allowlist. The Unraid template gains a required, masked **`ENCRYPTION_SALT`**
   field (production refuses to boot without it).
2. **Audit rows and ballots record which key signed them** (migration
   `01f36743137a`, `signing_key_id`). A signing key that was in `.env` but never
   reached the container signed nothing; old rows are signed with `SECRET_KEY`.
   Old rows keep verifying (a row with no fingerprint is tried against the dedicated
   key, then `SECRET_KEY`), but `SECRET_KEY` is accepted only for rows written
   **before the first row signed with the dedicated key**. **Keep `SECRET_KEY`
   unchanged** as long as pre-upgrade rows matter. An off-host collector verifying
   `AUDIT_SHIP_*` batches must be given the dedicated key. The cut-over boundary
   lives in the database; that residual is open for the owner
   (`KNOWN_LIMITATIONS.md`).
3. **Compliance figures move again, on purpose** (CLAUDE.md pitfall 29):
   - A **"shifts completed" requirement counts shift attendance everywhere**:
     attendance on the department's own _finalized_ shifts plus counted external
     shifts, over the requirement's own window, in the matrix, dashboard, Department
     Compliance card, rosters, profile card, annual and monthly reports, My Training,
     requirement progress (and its MCP tool), the training report, competency
     matrix, CSV/PDF exports and the forecast. Wherever a department has an active
     SHIFTS requirement, a member's count is now shifts worked, **not** completed
     training records. The Shift Compliance report's SHIFTS rows stop counting
     unfinalized shifts, and a zero target is no longer "compliant". A SHIFTS
     requirement not marked **Shift Credit** stays on training records and off
     that report.
   - **A program's linked department requirement reads the live compliance
     figure** (W26-1). It used to start at zero at enrollment. Officers can no
     longer set its value or mark it complete (400 with the reason); waiving it for
     the program still works. Requirements a program created for itself keep the
     ledger. `RequirementProgressResponse.reads_compliance` is new.
4. **Open swaps are first-come, first-served** (W33-4, breaking). An open swap is
   offered to every member cleared for the seat; the first to pick it up takes it
   (on the Requests tab; guide 03 has the exact labels). A pickup runs the same checks as an
   exchange approval and has no override. **Officers can no longer approve an open
   swap; they can still deny one.** Open swaps are not announced by email or push.
5. **A department's own crew seats can be filled** (SCHED-CUSTOM-SEAT, breaking).
   `shift_assignments.position` and `standing_shift_claims.position` are now
   `VARCHAR(100)` (migration `56c91e7d9e10`; the downgrade **refuses** while any
   custom seat is stored). One rule decides a seat everywhere: the shift's own
   seats are the authority, matched case-insensitively and kept in the shift's
   spelling; anything else is **422 `LB-SCHED-003`** on signup, assignment,
   swap/offer acceptance, exchange, open-swap pickup and standing shifts.
   Eligibility is grant-only: a custom seat comes from a rank's eligible positions,
   the Open Positions list, an open-to-all shift or the administrative-member flag.
6. **Elections: one ballot model for in-app and emailed ballots** (breaking for
   in-app voting). See _Elections_ below. A closed election's results are now
   released to every member who can view elections (the publish switch is gone);
   Send Ballot Emails works for positions-only elections.
7. **Member rules tightened** (behaviour changes): a position name another
   position already uses is refused (409, W05-5); the base **Member** position
   cannot be removed from a non-archived member (400, W11-9); phone numbers are
   validated on new writes (422 on create, 400 on profile and contact updates, only
   on a changed value, W04-7). Stored values are not rewritten.

### What changed, by area

#### Training and members

| Change                                                                                                                                                                                                                                                                                                                                                                                                                 | Where it shows                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Online knowledge tests** (new tables `knowledge_tests`, `knowledge_test_questions`, `knowledge_test_attempts`, migration `7c2e9a41b6d3`). Question bank, delivery, auto-grading. Answers never reach the member before submitting; each attempt grades a frozen copy; a multiple-answer question needs the exact set; a pass records requirement progress; online and officer-entered attempts share `max_attempts`. | New member routes `/training/knowledge-tests`, `/training/knowledge-tests/attempts/:attemptId`; Training Admin knowledge-test tab |
| **Skill evaluation CRUD** (`/training/skill-evaluations`). Evaluators are the default, chosen positions or named members. Writing needs `training.manage`, reading `training.manage` or `training.configure`; two active skills cannot share a name; delete returns 409 once a skill has history.                                                                                                                      | **Training Admin › Setup › Skill Evaluations**                                                                                    |
| **Offline skills testing.** An examiner can score from a cached sheet with no signal; a device queue replays create → save (`expected_version`) → complete in order; a refused step is kept with the server's reason. Only the signed-in member's own entries are sent. Sign Out tries to send first and warns before deleting unsent evaluations.                                                                     | Skills-testing test screen, Sign Out                                                                                              |
| **Cohort rooms (CC-2).** The wizard picks the cohort's room on the Schedule step; each class can move to another room on Preview. The "Location already booked" warning can now fire. The syllabus builder's edit form sends explicit nulls for emptied fields.                                                                                                                                                        | Cohort wizard, syllabus builder                                                                                                   |
| **Qualifications entered directly (QUAL-1)** and imported by CSV (dry run by default; matches by membership number or email inside the department; rejected rows reported by spreadsheet line). Writes go to `member_qualifications`, the table shift eligibility reads.                                                                                                                                               | Qualifications card on the member profile; **Members admin › Import Qualifications**                                              |
| **Department Readiness heat-map** (`GET /training/competency/department`, `training.manage`) with station, rank and category filters; reads through the per-member query, so a cell equals that member's own view. Levels only, no comparison to a required level.                                                                                                                                                     | **Training Admin › Advanced › Competency**                                                                                        |
| **Training program import preview** — nothing is created until the preview is accepted.                                                                                                                                                                                                                                                                                                                                | Program import                                                                                                                    |
| **Add Member can set the starting status** (W08-1: active, inactive or leave).                                                                                                                                                                                                                                                                                                                                         | Add Member                                                                                                                        |
| **Undo a mistaken drop within 7 days** (W15-3). Restores the member and reopens the service stint the drop closed; audited; never restores to Suspended.                                                                                                                                                                                                                                                               | Profile of a dropped member                                                                                                       |
| **Leave editing and Overdue Property Returns** now have screens (Edit on each active leave in Waiver Management; panel in Inventory Member Equipment and Members admin).                                                                                                                                                                                                                                               | Waiver Management, Member Equipment                                                                                               |
| **Member directory for non-managers** (`GET /users/directory`, USR-8) returns only names, number, photo, status, rank and visible contact fields; archived members are left out (W15-4) and a non-manager opens on **Active**. ORU-7c: Role Management asks before changing the baseline Member position's permissions. USR-5: the leave widget counts in SQL.                                                         | Members page, Role Management                                                                                                     |
| **Admin hours (AH-21).** `admin_hours.allow_self_approval` (off unless literal `true`; `settings.manage` writes it) lets a sole-officer department approve its own entries. A reopened event's resync that grows an approved entry by more than `admin_hours.resync_requeue_growth_percent` (default 25%) into a length its category would not auto-approve returns it to Pending Review.                              | **Review Rules** tab on `/admin-hours/manage`                                                                                     |
| Self-reported certificate **ClamAV scanning** (opt-in, `CLAMAV_ENABLED=false`, compose profile `with-clamav`): infected file → 400 `LB-UPLD-004`, scanner down → 503 `LB-UPLD-005` (fail closed). An upgrade adds no container.                                                                                                                                                                                        | Review Submissions upload                                                                                                         |

#### Scheduling

- **Shared calls (SCHED-10).** Step 2 of the close-out wizard lets an officer tick
  a call another unit already logged, so the department counts the incident once and
  both units get the run (`attachable_calls`, matched on overlapping shift times).
  `record_shift_calls` now **rejects** a type breakdown larger than the shift's own
  calls instead of truncating it; the count-only call-volume report says _Total
  Calls_ (`counts_unit_responses: false`).
- **Open swaps and custom seats:** see _Read this first_ 4 and 5. Rosters and
  notifications still show the seat token, not the Position Names label.
- **Separation of duties (TRX7-1).** Crediting a missed cohort class now refuses an
  officer crediting themselves (`assert_different_person`, same as FIN-4, CS-8,
  AH-4, TR-5). Found and fixed by the security review below.

#### Elections

- **One ballot model.** The in-app **Cast Vote** tab and the emailed ballot are the
  same ballot: each plain position no ballot item claims is served as a ballot item
  (`position-<hash>`), stored and tallied under the position name as before. New
  `GET/POST /elections/{id}/ballot` casts every contest atomically (one refusal
  records nothing; an abstained item stays open). The token ballot accepts positions
  too.
- **Proxy mode.** `?proxy_authorization_id` loads the delegating member's ballot;
  `GET …/ballot/proxies` lists the caller's proxies. A proxy ballot is **refused on
  an anonymous election** until the owner decides ELEC-43. The ballot email names
  both members on a proxied ballot (W50-23; migration `24f56e4fc320` moves
  _untouched_ stored templates onto the new bodies — an edited template is not
  touched).
- **Seats per race (W50-11).** `elections.seats_per_position` (default 1; migration
  `8c4f2a6e1d93`) declares up to that many winners; a tie on the last seat goes to
  the tie policy. Ranked choice, or a per-race cap below the seat count, is refused
  (422). Multi-seat percentages are of ballots cast, so a race sums to up to seats ×
  100% by design.
- **Corrections after close are marked (W50-9).** A void, paper-batch void or
  write-in merge on a closed election appends to `elections.results_revisions`
  (migration `5b1e7d3c9a42`); the certified PDF and Results tab print **Results
  revised <when> by <who>**. A rollback clears it. Late arrivals vote by secretary
  override.
- **Also:** Approve/Deny rows are created at open so a paper motion can be keyed
  (W50-8); a voter override extends a restricted voter list (W50-13); a test ballot
  can preview a draft (W50-19); Open warns only when an election has neither ballot
  items nor positions; receipts verify with **`POST /elections/{id}/verify-receipt`**
  (the `GET` still works, deprecated with `Deprecation: true`); saved ballot
  templates are capped at 200 per organization (the 201st is 409) and refuse unknown
  keys and an alias that names another item.

#### Security, integrations and operations

- **Security alerts are actionable (SEC2-28).** New **`/admin/security-alerts`**
  (`audit.view`) lists alerts by state; `audit.export` holders acknowledge and
  resolve them (attributed, audited, 409 instead of overwriting; resolution note
  column `security_alerts.resolution_note`). The exfiltration check sizes an export
  from the bytes sent and matches parameterized routes; every completed export
  writes a `data_export` audit row listed by `GET /security/download-activity`. A
  brute-force alert against a real account reaches that account's department.
- **Integration health.** Integrations gain `last_success_at`, `last_error`,
  `last_error_at`, `consecutive_error_count` and the `integration_sync_logs` table
  (newest 50 runs, errors scrubbed of URLs, emails and secrets). New detail page
  **`/integrations/:integrationId`**, `GET …/sync-history`, `POST …/retry-sync`. A
  failed run does not flip `status` to `error`; a separate `health` field reports it.
- **Claude (MCP) member sign-in — an OAuth 2.1 authorization server, opt-in.**
  Needs `MCP_OAUTH_ENABLED=true`, an `https://` `MCP_OAUTH_ISSUER_URL` and the
  department switch `oauth_enabled`; the unauthenticated endpoints return 404 while
  it is off. Codes last 60 seconds and are single use; access tokens 15 minutes,
  bound to `/api/mcp`; refresh tokens rotate and a replay revokes the connection;
  connections end after 90 days. A token can never do more than the member can, and
  every MCP tool must now declare `permissions=`. Screens: consent
  **`/claude/authorize`**, a member's **`/claude/connections`**, and an admin client
  panel on the Integrations page. No dynamic client registration. Threat model:
  `docs/security-review/MCPO-27-mcp-oauth-server.md`.
- **Medical screening.** Add Record has a Member/Prospect picker
  (`GET /medical-screening/subjects`); `POST /records` returns 422 unless exactly one
  of `user_id` / `prospect_id` is sent (MS-13). Every route that returns screening
  PHI writes one audit event per request (MS-12). A record a member entered about
  themselves shows a **Self-recorded** badge and `self_recorded_count` (MS-7).
- **Public portal and storefront.** Portal rate limits are shared across workers
  through Redis; the applicant status token is stored as a SHA-256 hash plus an
  encrypted copy (links already sent keep working; needs the existing
  `ENCRYPTION_KEY`). A daily `paypal_capture_backfill` task confirms the last 7 days
  of PayPal captures and records any the webhook missed (needs PayPal Transaction
  Search; otherwise it logs a clear error to Error Monitoring).
- **Managed RDS / ElastiCache.** New opt-in `docker-compose.external-services.yml`
  override (`DB_HOST`, `DB_PORT`, `REDIS_HOST`, `REDIS_PORT` required; bundled
  mysql/redis and the backup sidecar move to a profile that is never activated, so
  **back up the `uploads` and `audit_archives` volumes yourself**). Migration
  engines now use the app engine's TLS arguments, so `DB_SSL_CA` is verified.
  `docs/deployment/aws.md` is rewritten around it.
- **Desktop density (#2967).** `btn-icon` is 36px and `toggle-track` a 24px pill
  **with a mouse**; both stay 44px on a phone or touch screen. Event card titles
  clamp at two lines (three from `md`); the store catalog price moves to the badge
  row; cohort and shift-pattern status badges wrap below long names; EventForm Start
  and End sit side by side only from `lg`; the shift-template dialog stacks them at
  every width. This also fixed Create Event scrolling the Events admin page sideways
  on a tablet.

### Behaviour changes at a glance

| Change                                                           | Visible effect                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `.env` pass-through                                              | Previously ignored settings take effect; typos can stop boot             |
| Signing-key fingerprint                                          | Integrity check logs one WARNING with the count verified by `SECRET_KEY` |
| SHIFTS requirements count shift attendance                       | Compliance numbers move                                                  |
| Linked program requirement reads compliance                      | Enrollment starts at the live figure; officers cannot set/complete it    |
| Open swaps first-come                                            | Officers cannot approve one, only deny                                   |
| Custom seats accepted                                            | `LB-SCHED-003` replaces generic 422s for unknown seats                   |
| `record_shift_calls` rejects an oversized breakdown              | A 400/422 where it used to truncate                                      |
| Position name uniqueness; base Member position; phone validation | New 409 / 400 / 422 refusals                                             |
| Directory hides archived members for non-managers                | Non-managers open on Active                                              |
| `POST /medical-screening/records` needs exactly one subject      | 422 for neither or both                                                  |
| Closed election results released to all who can view elections   | Publish switch removed                                                   |
| Ranked choice with seats > 1                                     | Refused (422)                                                            |

### Review passes in the window

Records live in `docs/security-review/`.

| Pass                                       | Result                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TR-17 training core, pass 7 (#2973)        | 0 fixes, **1 flagged (MEDIUM, TR7-1)**: `POST /training/enrollments` duplicates by hand the enrollment logic `enroll_member` runs under an organization lock, and reproduces the duplicate-active-enrollment race plus a missing progress/phase/recert/notification gap. **Open.** |
| TRX-18 training extended, pass 7 (#2975)   | **1 fixed (MEDIUM, TRX7-1)**: an officer could credit themselves for a missed cohort class; now refused.                                                                                                                                                                           |
| SKT-19 skills testing, pass 7 (#2976)      | 0 fixes; five standing flags closed (already fixed by feature work); the client-minted test id was reviewed and is a data-safe design. **Flagged:** `knowledge_tests.py` (1,147 lines, three new tables) sat under no feature's declared scope and had no security pass.           |
| CMP-20 compliance, pass 7 (#2977)          | 0 fixes; three standing flags closed; one new finding already fixed (CS-8-b: attestations).                                                                                                                                                                                        |
| AH-21 admin hours, pass 7 (#2978)          | 0 fixed, 0 flagged.                                                                                                                                                                                                                                                                |
| GF-22 grants & fundraising, pass 7 (#2980) | 0 fixed, 0 flagged.                                                                                                                                                                                                                                                                |

### CI and test infrastructure (no user-visible change)

- #2979: the `report_local_times` row-date tests no longer collide with the real
  "today" (a date-dependent test failure).
- `AddMember` and the system-owner onboarding form are filled by paste in tests,
  and `AdminUserCreation` has a 20 s timeout, after load-related timeouts.
- ClamAV fake-server teardown cancels handlers first (Python 3.12.1+ `wait_closed`
  hang). The equipment-check builder's "Saved" fade timer is cleared on unmount.
- The PayPal backfill loop read org ids up front after a rollback expired the
  remaining integrations (`MissingGreenlet` aborted the task for every later
  department).
- Knowledge-test question and owner lookups now filter `organization_id` directly
  (the org-scoping ratchet flagged both; neither was reachable cross-tenant).
- The separation-of-duties coverage doc lists TRX7-1's new call site.

### Migration route

| Revision       | What it does                                                                                       | Downgrade                                                     |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `9c1445489666` | `screening_records.self_recorded` (guarded; the table is `create_all`-only)                        | Drops the column                                              |
| `f7c09cfec5b0` | Prospect status token hashed at rest plus encrypted copy; converts rows in place                   | Real downgrade                                                |
| `9a4c2e7b5d18` | `security_alerts.resolution_note`                                                                  | Drops the column                                              |
| `4e8b1c6d2a90` | Integration health columns and `integration_sync_logs`                                             | Drops them, **losing sync history**                           |
| `01f36743137a` | `signing_key_id` on `audit_logs` and `votes`                                                       | Drops the columns                                             |
| `2d4304107b77` | MCP OAuth tables                                                                                   | Drops them, **ending every Claude connection**                |
| `56c91e7d9e10` | Shift position columns to `VARCHAR(100)`                                                           | **Refuses** (changes nothing) while any custom seat is stored |
| `7c2e9a41b6d3` | Knowledge-test tables                                                                              | Drops them, **losing every question, test and attempt**       |
| `24f56e4fc320` | Moves untouched stored ballot-notification templates onto proxy-aware bodies (guarded, idempotent) | Real downgrade                                                |
| `5b1e7d3c9a42` | `elections.results_revisions`                                                                      | Drops the column, **losing revision marks**                   |
| `8c4f2a6e1d93` | `elections.seats_per_position` (default 1)                                                         | Drops the column, **multi-seat races tally with one winner**  |

`DATABASE_SCHEMA.md` was regenerated in #2965. New error codes: `LB-SCHED-003`,
`LB-UPLD-004`, `LB-UPLD-005` (see `ERROR_CODES.md`).

### Still open (owner decisions, recorded in `KNOWN_LIMITATIONS.md`)

Signing-key cut-over boundary; Unraid build-from-source `SECURITY_REQUIRE_TLS`;
backups with the external-services override; Proxmox/Synology recipes; MCP OAuth
dynamic client registration, localhost redirects and a refresh-retry grace window;
open swaps not announced; custom-seat grants and labels; shift-count residuals;
offline skills evaluations cleared by an idle timeout or expired session without
asking; ELEC-43 (proxy vote on an anonymous election); TR7-1; the unreviewed
`knowledge_tests.py`; anonymous brute-force alerts on a multi-organization install
have no viewer.

### Documentation and media disposition

**Screenshots to create or replace** are listed in
`training/SCREENSHOT_CURRENCY.md` (section _Queued by the October 6 – 7
documentation pass_). **Script beats to fix or re-record** are in
`youtube-scripts/SCRIPT_CURRENCY.md` (section _Oct 6 – 7_). Nothing was
re-captured or re-recorded: the capture stack does not run in this environment.

**Not edited, deliberately.** `CHANGELOG.md` has been closed to per-change
entries since 2026-09-08 (see `CLAUDE.md`), so nothing was appended to it or to
`docs/changelog/`; this audit, the pull-request descriptions and `UPGRADING.md`
carry the narrative. No route was added or retired by this pass; the new routes
(`/admin/security-alerts`, `/integrations/:integrationId`, `/claude/authorize`,
`/claude/connections`, `/training/knowledge-tests[/attempts/:attemptId]`) were
registered in all three registries by #2965.

## Change audit: October 5 – 6, 2026

Net changes merged to `main` in the 25 hours ending 2026-10-06 08:10 ET, written
against `09f24912` (PR #2964). It picks up where the
[October 4 – 5 audit](#change-audit-october-4--5-2026) stopped, at
`01b1bc26` (PR #2940). **About 90 non-merge commits in roughly 30 pull requests**
(#2941 – #2972), a third of them security- and app-review records. **Seven
migrations plus one merge revision** land in the window (the head is now
`15802f3df5c4`), one new endpoint family (`/member-badges`), one new
scheduled task, two new error codes and one operator-visible nginx change. No
route was added or retired.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-5--6-2026).

Review passes in the window (records live in `docs/security-review/`,
`docs/app-review/`): security reviews of finance-approvals (1 fix), users-
organizations, elections-ballots, membership-pipeline (MP-32 fix),
medical-screening (0 fixes, MS-14 flagged), documents-legal, inventory,
facilities, apparatus-nfc (pass 14), equipment-check-shifts, scheduling and
events-requests (all 0 fixes, standing findings re-confirmed); app review
**A7 dashboard** pass 3 (7 fixes, 4 flagged), **A8 locations & kiosk** pass 3
(6 fixes, 3 flagged), **B1 medical screening** pass 5 (2 fixes, 1 flagged) and
**B2 apparatus** pass 5 (2 fixes, 1 flagged, 4 doc corrections).

### Read this first

1. **Member badges now carry a server-issued code** (`0549b7e0`). A badge used to
   encode the membership number or a short form of the member id, and the digital
   card's QR held the member id built in the browser — all readable by any member
   from the directory, so anyone could print a badge that scanned as a colleague,
   and the inventory scanner handed an unmatched QR's member id straight back to
   its caller. New `users.badge_code` (e.g. `MB-7KQ2W9HXRT`, unique per
   organization, migration `ad3b979746f1` backfills every member). It is served only
   by `GET /member-badges/{id}` (the member, or `members.manage` /
   `members.manage_id_cards`), never in roster or profile responses, exports or
   anonymized records. `POST /member-badges/{id}/reissue` cancels a lost badge.
   Labels, CR80 cards and the digital card all encode it, and both scanners send what
   they read to the rate-limited `POST /member-badges/resolve`, which answers only
   within the caller's organization. **Old badges keep resolving** (membership
   number, short id, old QR) until an officer turns off **Accept old badges**; absent
   means accepted, so nothing stops working on upgrade.
2. **CR80 ID-card printing** (`5273c49a`). **Members → select → Print ID Cards**
   renders a PDF whose page is exactly one card side (3.375 × 2.125 in) for any
   plastic-card printer with an OS driver (Zebra, Fargo, Evolis, Magicard, Entrust):
   landscape or portrait, front only or front-and-back, Code 128 or QR, from a saved
   department layout (`organization.settings["id_card_print"]`). Black-only so
   mono and colour ribbons print the same. `/member-id-cards/{layout,pdf}`, audited.
   Member **badge** labels moved from `members.view` (every position) to
   `members.manage` or `members.manage_id_cards`; `/member-id-cards` is recorded as an
   ungated essential-module API root (`dd9a3071`).
3. **Finance approval steps enforce their named approver** (`fbab5716`, `cfa518ca`,
   #2963). A step named an approver (`approver_type` / `approver_value`) that
   `approve_step` / `deny_step` never read: any `finance.approve` holder could act on
   any step and the pending list was org-wide. Now
   `finance_approver_matching.py` is the one authority (position, permission,
   specific user, email, or NULL = any `finance.approve` holder; inactive and
   other-org users never match). A non-match is a 403 (`ApproverMismatchError`)
   unless the caller holds `finance.configure_approvals` and sends an **override
   reason** (≤ 2000 characters), which is audited at warning. Separation of duties
   still blocks approving your own request. Token approve/deny refuse once the
   step is not an email step. New `GET /finance/approval-chains/approver-coverage`
   reports steps nobody can act on. **Screens:** Approvals reads _Requests waiting
   on you_, has a **Waiting on** column and a _Not assigned to you_ badge with an
   admin override dialog; request detail shows _Waiting on <name>_; Approval Chains
   settings flags a step nobody can act on with a warning chip and the count of
   requests stuck behind it. `UPGRADING.md` has an entry.
4. **A finalized event can be edited from the edit form** (`da31be81`, `16391621`,
   `690c9675`, `4ccd5daa`, #2953, #2959). Finalizing locks the fields credited hours
   come from, but the lock refused any save that _mentioned_ one and the form resends
   them all, so a typo in a closed event's title could not be fixed. The lock now
   refuses a **changed value**, compared by instant for times, string value for
   enums, and the default window for a NULL check-in rule; a refusal names only the
   fields that would change. The form shows a notice, disables the locked controls
   (type, category, schedule, check-in rules) with the reason announced, and keeps
   guest sign-in editable. A series save ("This and all future events") decides per
   finalized occurrence and no longer copies the edited occurrence's lifecycle markers
   (`attendance_finalized`, `reminders_sent`) onto the others. The refusal now reads
   "(2 of 3 finalized occurrences would change)". Review fixes: a title fix on an
   event spanning the clocks-fall-back hour is no longer refused; a stored category
   shows even when the department lists none; the unlisted mandatory member-type
   row has a 44px target.
5. **Compliance numbers moved, on purpose — five changes to one definition**
   (CLAUDE.md pitfall 29). **Read before upgrading: reported figures change.**
   - **A member nothing grades is _Not applicable_, not compliant** (`21bf76f2`,
     TR4-4). Such members leave the denominator of every compliance percentage; the
     matrix, member roster, profile card, annual report, email and CSV show **N/A**;
     a department where requirements exist but apply to nobody has no percentage.
   - **The dashboard's Department Compliance card grades like the matrix**
     (`39049cf8`, TR4-3): compliance profiles, the department thresholds and the
     at-risk tier. `ComplianceGrading` is now the one resolution of what grades a
     member.
   - **The annual and monthly compliance reports grade through compliance profiles**
     (`b1181a59`, CMP4-3). Departments without a profile see no change; stored
     reports keep the figures they were generated with.
   - **`required_roles` matches the member's rank** (`6aa066ac`, CMP4-5). It held
     rank slugs everywhere but was compared with position ids, so a requirement
     scoped only by role applied to nobody. It now grades the members of those
     ranks on every training screen and the annual report. The Shift Compliance
     report also begins honouring membership types.
   - **A certification no longer matches by course name** (`87efdf03`, migration
     `60aaf273de27`). "CPR Refresher" used to satisfy a "CPR" requirement. Every
     requirement that exists when the migration runs gets `name_match_until` = the
     day it ran (name credit kept for records on or before that day, so published
     standings do not jump); later requirements and fresh installs match only by
     linked course, training type or registry code.
     Also: **an attestation records the server's figure** (`bd7833a7`, CS-8) — the
     typed _Compliance %_ box is gone, replaced by the quarter picker the form lacked
     (without it every quarterly attestation was refused); and **Shift Compliance
     grades only shift-credited requirements** (`0392fc6d`, W37-2, migration
     `f16b004db34e`): SHIFTS requirements are credited by default, an HOURS
     requirement only when an officer ticks the new **Shift Credit** box, so an
     existing HOURS requirement **drops off that report until it is ticked**. The
     summary cards are now _Requirement Checks_, _Checks Met_, _Checks Not Met_ (they
     counted member-requirement pairs, not members; numbers unchanged, `de85965d`).
6. **Certificate files from self-reported training can expire** (`090d62f9`,
   migration `cdb725bb1d12`). New `self_report_configs.attachment_retention_days`
   (days after approval or rejection; NULL = keep, 90-day floor) under **Review
   Submissions → Settings → Certificate Files**. NULL is the default and nothing is
   backfilled, so **an upgrade deletes nothing until a department opts in**. A daily
   `self_report_attachment_retention` task unlinks files for decided submissions
   only, only inside that organization's own upload directory, then clears the
   references from the submission and every copied training record; rows are kept;
   each sweep is audited.
7. **Shift exchange needs both members qualified** (`37721521`, #2951). Each member
   works the other's seat afterwards, so each must pass the signup eligibility rule
   for it. Refused at submission when the target holds no seat, involves a training
   seat or fails either direction; `GET /scheduling/shifts/{id}/exchange-candidates`
   feeds an **Exchange With a Member** picker on My Shifts; re-checked at approval,
   where a lapsed pair is refused with the new **`LB-SCHED-002`** and the Requests tab
   offers **Approve anyway** (waives the position check only, noted on the request and
   audited). One-way offers and moves are unchanged. The dashboard's _Next 30 Days_
   list now says **Not eligible** up front instead of offering Sign Up (`65422ea6`).
8. **Cohorts: late joiners and all-or-nothing shifts** (`a8882f6f`, `ff78de73`,
   migration `d4d0a483cdd5`). The Roster tab gains **Add member**, and for each
   member who missed classes "N classes held before they joined — decide": **credit
   as completed** (writes a completed record, applied to the pipeline requirement
   keyed on the record so re-finalizing cannot double it) or **schedule a make-up**
   (copies the class, RSVPs that member alone; cancelling it reopens the decision).
   New table `course_cohort_missed_classes`, new `makeup_for_class_id`. Cohort
   _shift remaining_ and _cancel_ now pre-check the attendance lock, apply deferred,
   commit once and roll back on any failure, instead of leaving earlier classes
   moved when a later one refused.
9. **Offline and sign-out safety on shared station computers**
   (`b574c324`, `9a8af58c`, `9296a0d6`). Offline queue entries record their
   `ownerId` and are sent **only under the member who queued them**; entries queued
   before the upgrade are held, and a notice in the app shell offers **Send as me**
   or **Discard**, each behind a confirmation. A sign-out is retried three times and,
   if the server never confirms, a full-screen notice blocks the app until
   **Try signing out again** succeeds (persisted across reloads). A refresh that
   loses a rotation race returns **409 `LB-AUTH-012`** and revokes nothing; before,
   two tabs refreshing together treated the loser's next refresh as token theft and
   revoked every session.
10. **Proxy rate limits sized for a department** (`43582b39`, #2950). Both bundled
    proxies allowed 10 concurrent and 10 requests/second per address; under HTTP/2 a
    single dashboard load lost 15 of 25 requests to 503, and eight members behind one
    station address lost 190 of 200. Now `limit_conn 400` and the API zone 50/s with
    `burst=600 delay=100` (queued, not refused). Sign-in limits are unchanged and
    remain an open decision in `KNOWN_LIMITATIONS.md` (the sixth member to sign in at
    one address within a minute is refused). Operators with a customized nginx config
    should compare.

### Behaviour and layout changes

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Reference                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Four alert emails say what they contain.** Low stock: "at or below reorder point". Certification expiring: subject "Expires Today" / "Expires Tomorrow" instead of "Expiring in 0 Days", same wording in-app. NFPA retirement: "approaching or past" with the past-due count. The weekly supply alert is retitled **Supplies to Replace**, its subject counts expiring and to-restock separately, and the table's _Expires_ column is **Status** ("Restock reported", "Short — 2 of 4 aboard"). | `b2226d61`, `bd95f4e7`             |
| **Five more emails fit a phone** — property return and member-dropped notice (Item / Value, details as grey lines), election results (Candidate / Votes / Result), low stock, NFPA retirement.                                                                                                                                                                                                                                                                                                    | `9c783e53`                         |
| **End-of-shift summary is retried** until its email actually sent; a member who cannot be emailed is stamped once the in-app notice is written. Repeated in-app notice on retry is the accepted cost.                                                                                                                                                                                                                                                                                             | `6e59402a`                         |
| **Scheduled-task failures reach Error Monitoring**, labelled _Scheduled task_, per organization (they reached only logs and Sentry).                                                                                                                                                                                                                                                                                                                                                              | `c951388c`                         |
| **Training records are paged** — `GET /training/records` takes `skip`/`limit` (≤ 500) and reports `X-Total-Count`; the client walks the pages. **Skills-testing** `GET /tests` returns `{items, total}` with `limit`/`offset`, server-side search and dates; the CSV export **requires a date range of ≤ 366 days** (the Test Records tab defaults to the last twelve months); `GET /templates` takes `limit`/`offset`.                                                                           | `e2ee5137`, `2b00fdbe`             |
| **My Training keeps pending records** in history (they have no completion date and fell out of the 12-month range and the 100-row limit).                                                                                                                                                                                                                                                                                                                                                         | `58760756`                         |
| **Import validates enum fields per row** with "Row N: Invalid <field> 'x'. Valid values: …" and a savepoint per row, so one bad row no longer fails every row after it.                                                                                                                                                                                                                                                                                                                           | `77420cac`                         |
| **Effectiveness tab: Submit Evaluation** — member picker, then a form for the chosen Kirkpatrick level only.                                                                                                                                                                                                                                                                                                                                                                                      | `dfb5d93a`                         |
| **Skills Testing Templates tab** always shows **Needs Validation** to `training.manage` holders, zero included, beside Pass Rate.                                                                                                                                                                                                                                                                                                                                                                 | `521c710d`                         |
| **Prospective members:** checklist-stage items are ticked in the applicant drawer and sent with **Advance**; Pipeline Settings gets **Automatic Transfer to Membership**; migration `99b16109d44c` resets stage rows left _in progress_ ahead of an applicant's current stage.                                                                                                                                                                                                                    | `fac8959a`, `a61a6ad6`, `959610c0` |
| **Edit Times pre-fills the credited check-in**, not the raw tap, so saving it unchanged no longer turns an early tap into a credited override.                                                                                                                                                                                                                                                                                                                                                    | `44b7b6a7`                         |
| **Event Requests** show the server's reason on a refused schedule or postpone.                                                                                                                                                                                                                                                                                                                                                                                                                    | `93ffd7b6`                         |
| **Shift Reports Flagged view** stays while flagged reports exist even if review is switched off.                                                                                                                                                                                                                                                                                                                                                                                                  | `5d570bc0`                         |
| **Rank resolution:** a deleted seed rank (e.g. `firefighter`) is no longer accepted once the department has a rank ladder; Assigning such a code fresh needs the rung added first.                                                                                                                                                                                                                                                                                                                | `da7d3ffe` (ONBOARD-3)             |
| **Elections** (on-screen re-drive of the W50 round): the in-app vote receipt now survives the refetch, the help popover sizes to its content, the election list dates an early close to its real close, a ballot link retired by a zero-vote rollback says the election was closed and reopened, focus after a nomination stays in the panel.                                                                                                                                                     | `92468ec2`, `5b4c798b`             |
| **Members admin and Inventory admin on phones** — no doubled padding on eight inventory pages, Items filters behind a **Filters** toggle under 640px, wrapped hub tile labels, audit-history spinner fixed, waivers tab strip scrolls, AAA link colours; Members admin routes join the mobile ratchet.                                                                                                                                                                                            | `61e21fe7`, `0cb937b0`             |
| **Medical supplies:** five writes re-check the medical domain under the lock; completing maintenance as _Retired_ is refused (use Retire).                                                                                                                                                                                                                                                                                                                                                        | `57e81e4d` (MSUP-25)               |
| **Integrations:** every sender is DNS-pinned to its validated address (SSRF rebinding); Google Calendar responses are capped at 10 MB with socket timeouts.                                                                                                                                                                                                                                                                                                                                       | `fb96e82c`, `21b2f7b8`             |
| **Performance (no visible change):** compliance grading loads only each requirement's window; document folder access uses one recursive query; facility reference and folder locking reads use new indexes (migration `c56303befb2c` adds `document_id` columns and backfills).                                                                                                                                                                                                                   | `9109d6d1`, `870ea19b`, `17bdf779` |

### CI and test infrastructure (no user-visible change)

- The scan-success timer no longer outlives an unmounted field (an intermittent
  vitest "window is not defined" failure), `cb6b6c94`.
- A raw `INSERT` in the exchange test fixture quoted the reserved word `rank` for
  MySQL 8, `26e55755`; two compound assertions were split for flake8 PT018, `b52621fc`.
- Dependabot: stripe 15.6.1 → 16.0.0, the python-minor-patch and npm-minor-patch
  groups, anchore/sbom-action 0.24.3 (#2943 – #2946).

### Migration route

| Revision       | Parent                         | What it does                                                                                                                   | Downgrade                                                                          |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `99b16109d44c` | `b3e8d5a1c947`                 | Resets prospect stage rows left `in_progress` ahead of the current stage                                                       | No-op (the old value was the defect)                                               |
| `d4d0a483cdd5` | `99b16109d44c`                 | `course_cohort_missed_classes`, `course_cohort_classes.makeup_for_class_id`; guarded                                           | Drops both                                                                         |
| `f16b004db34e` | `d4d0a483cdd5`                 | `training_requirements.shift_credited`, backfilled true for SHIFTS requirements                                                | Drops the column                                                                   |
| `ad3b979746f1` | `34d3d56d1479`                 | `users.badge_code`, unique per organization, backfilled for every member                                                       | Drops the column, **discarding issued badge codes** — printed badges stop scanning |
| `60aaf273de27` | `f16b004db34e`                 | `training_requirements.name_match_until`, set to the migration date on existing rows                                           | Drops the column                                                                   |
| `c56303befb2c` | `60aaf273de27`                 | `facility_documents.document_id`, `facility_photos.document_id`, indexes, backfill; indexes on `document_folders` slug lookups | Drops indexes and columns                                                          |
| `cdb725bb1d12` | `c56303befb2c`                 | `self_report_configs.attachment_retention_days` (NULL = keep)                                                                  | Drops the column                                                                   |
| `15802f3df5c4` | `ad3b979746f1`, `cdb725bb1d12` | Merge — **the head**                                                                                                           | n/a                                                                                |

The two branches (preferred-name → badge code; stale-stage → … → retention) are joined by the merge. Run `alembic heads`: it must report the single head `15802f3df5c4`.
`DATABASE_SCHEMA.md` was regenerated in `cbaa7143`; if the Backend Unit Tests job
reports drift, run `cd backend && python scripts/generate_schema_docs.py`.

### Documentation and media disposition

See the files below for what this pass changed. **Screenshots to create or
replace** are listed in `training/SCREENSHOT_CURRENCY.md` (section for
2026-10-06) and **script beats to fix or re-record** in
`youtube-scripts/SCRIPT_CURRENCY.md`. Nothing was re-captured or re-recorded.

**Not edited, deliberately.** `CHANGELOG.md` has been closed to per-change
entries since 2026-09-08 (see `CLAUDE.md`), so nothing was appended to it or to
`docs/changelog/`; this audit, the PR descriptions and `UPGRADING.md` carry the
narrative. `APPLICATION_PAGES.md`, `testingRegistry.ts` and
`mobile-route-inventory.ts` needed no new route (the Members admin routes joined
the mobile ratchet in `61e21fe7`).

## Change audit: October 4 – 5, 2026

Net changes merged to `main` in the 25 hours ending 2026-10-05, written against
`01b1bc26` (PR #2940). It picks up where the
[September 24 – October 4 audit](./CHANGE_AUDIT_2026-09.md#change-audit-september-24--october-4-2026) and the
[October 3 – 4 audit](#change-audit-october-3--4-2026) stopped, at the
documentation commits of 2026-10-04 evening (`d2348fa8`). **About 50 non-merge
commits, roughly 25 pull requests** (#2904 – #2940), most of them following that
documentation pass. **Three migrations** land in the window (the head is now
`34d3d56d1479`), one new permission (`training.view_analytics`), and one
operator-run repair script. No route was added or retired.

Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-4--5-2026).

Roughly a third of the commits are review passes whose records live in
`docs/security-review/`, `docs/app-review/` and `docs/workflow-review/`:
security reviews of auth-session, cross-cutting, frontend-shared,
permissions-roles, public-webhooks and storefront-payments (all **0 fixes**,
standing findings re-confirmed); app review **A6 member lifecycle** (2 fixes,
1 flagged) and **A9 platform ops** pass 3 (4 fixes, 2 flagged); workflow review
**W52 Action items** (5 fixed, 2 flagged), **W53 Documents** (4 fixed, 1 flagged)
and **W54 org chart and legal documents** (2 fixed, 3 flagged).

### Read this first

1. **Members can go by a preferred name** (#2920, `f92fbd92`). New nullable `users.preferred_name`, migration `34d3d56d1479`
   (idempotent; NULL means "goes by first name", so nothing is backfilled).
   `User.display_name` is the preferred name else first + last and is what
   everyday screens read; `User.full_name` stays the **legal** name and no longer
   spells a missing part as "None". Reports, exports, training records,
   certificates, ballots, legal documents, signed forms, property custody and the
   audit log keep the legal name. Meeting-minute attendees, the photo-use consent
   roster, medical screening records and the member ID card were moved to the
   preferred name afterwards, and the label API's member badge follows the
   ID-card rule. Anonymizing a member now clears `preferred_name`
   (LIFE-6) — before that fix an anonymized member still appeared as
   "Terry Member-1a2b3c4d" on every everyday surface. The external-training
   **Map User** lookup, which selected the `full_name` property as a column and
   raised for any linked member, was fixed in the same window.
2. **Shift reports: five behaviour changes**, one migration and one permission (#2904).
   - **`training.view_analytics`** (migration `84819ea78a79`). The _Written by me_
     panel was titled "Your reporting summary" but summed every officer's
     reports and was served to anyone holding `training.manage`. The
     `officer-analytics` endpoint now takes `?scope=mine|department`; **`mine`
     is the default** (it used to be department-wide) and `department` needs the
     new permission, seeded to the Chief, Deputy Chief and Assistant Chief ranks
     and the President and Training Officer positions. Captains and lieutenants
     do not get it.
   - A member **cannot write a report about themselves**; the form lists only
     shifts the viewer led as Shift Officer.
   - **File Shift Report is the Shift Officer's alone** on the shift panel, and
     the assigned Shift Officer may file and complete their own shift's reports
     without `training.manage`. Leadership files from _Shift Reports → New
     report_.
   - New department setting `settings.shift_reports.authorship = 'shift_officer'`
     (**Reports are filed by the officer on the rig**, under _Shift Reports →
     Filing & Validation_, renamed from _Post-Shift Validation_). Absent or any
     other value keeps the old rule, so existing departments are unchanged.
   - Per-member **Calls Responded**, derived from the close-out.
3. **One call-type list per department** (#2904, migration `edf608b5a8ea`). A department
   had three unrelated vocabularies — the editable list in Scheduling settings, a
   free-text list in Shift Reports settings, and whatever text a training
   requirement held — and requirements matched by exact lowercase string, so a
   requirement naming `mva` credited nothing from a report listing _Motor
   Vehicle Accident_. The free-text entries are folded into the department list;
   requirements and pipelines get a **Call types that count** picker; the call
   log's incident type is a picker over the same list. Matching goes through
   `app/utils/call_type_matching.py` (slug, label or legacy text).
4. **Category credit was silently not written for multi-category
   requirements** (`5169e76b`, `9432ab8e`, `d1713f04`).
   `category_ids.contains([id])` fell back to a `LIKE` on the serialized JSON, and
   MySQL renders a stored array as `["a", "b"]`, so only a sole-element array
   matched. A requirement tagged with two or more categories never advanced from a
   finalized session or an imported external record. The query is fixed
   (`app/utils/json_ids.json_array_contains`); **already-missed credit is repaired
   by an operator-run script**, `backend/scripts/backfill_category_requirement_credit.py`
   (dry run by default, idempotent, rollback file, no notifications). The same fix
   closed `GET /training/requirements?position=%` returning every requirement
   because the caller's term was a `LIKE` pattern. Entry in `UPGRADING.md`.
5. **Editing a role that holds a wildcard works** (#2935, `8bdeaebe`). Saving any
   permission change to a role carrying `*` (IT Manager) or a `<module>.*` grant
   the setup wizard's **Manage** checkbox writes failed with 400 "Failed to update
   role" — the validator knew only the bare permission catalog, and the long
   rejection list was swapped for the generic message so the screen never said
   which grant was refused. `invalid_permission_grants()` now accepts what
   `permission_matches` resolves, on create, system-role update and custom-role
   update alike, and the rejection names at most five grants. Accepting a wildcard
   is not granting one: the grant and edit ceilings still apply.
6. **Printing a member's badge needs `members.manage` or
   `members.manage_id_cards`** in the label API too (#2860 gated only the
   screens). `POST /labels/preview`, `/generate`, `/print` for the membership
   module and `/members/print-labels` still accepted `members.view`, which every
   seeded position holds. A script calling the label API for membership as a
   plain member now gets 403. Entry in `UPGRADING.md`.

### Behaviour and layout changes

| Change                                                                                                                                                                                                                                                                                                                                                       | Reference                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **Admin hubs stopped doubling the page gutter.** `AdminHubFrame`, six hub bodies and the hub-only tabs each added `px-4 sm:px-6 lg:px-8` inside `AppLayout`'s own gutter, so hub headers sat 32px (phone) / 64px (desktop) from the edge against 16 / 32 elsewhere. Max widths unchanged.                                                                    | #2939, `5e911e39`                                |
| **Four Inventory admin pages and 16 hub tabs no longer take the screen down on a malformed response** — Pool Items, Member Equipment, Charges and the member picker read a list off an unchecked body. Guards moved into `inventoryService` (`expectArray`); Member Equipment no longer prints "No members with inventory assignments" under its load error. | #2934, #2914, `4cf2fb68`, `e6141317`             |
| **Light-theme alert text raised to AAA.** Info blue-700 → blue-900 (9.52:1), success green-700 → green-900 (8.70:1; was 4.79:1, the worst of the five), purple and danger likewise; warning unchanged.                                                                                                                                                       | `f9211ea3`                                       |
| **Primary actions that were blue are the primary red** — 42 buttons in 27 files, the Suggestion Board vote/filter pills and the IP Security tabs. Blue kept deliberately for ConfirmDialog's info variant, Start Skill Test's practice mode and two analytics chart series.                                                                                  | `786515e0`, `fd59486f`                           |
| **Touch targets are sized by pointer, not width** (`touch:` variant, `touch-target-phone`); card-grid pages fit mouse desktops (`max-w-7xl` cap, 22rem floors on Events, Past Events and Course Library); Apparatus actions moved onto the badge row; Integrations badges wrap below the title.                                                              | #2913, #2923, `89f8854e`, `6db345ab`, `bd2bbbb1` |
| **Second Playwright visual sweep.** The date/time picker no longer cuts the date to "mm/c" on a phone; stat-tile labels wrap instead of truncating ("Total B…"); Skills Testing toolbar and filter; Review Submissions and Shift Report layouts.                                                                                                             | `03403d36`                                       |
| **Training Administration tabs fit a phone** — compliance matrix, expiring certs, past events, review submissions, waivers, officer dashboard.                                                                                                                                                                                                               | #2916, `533ed718`                                |
| **Close-out wizard: type hours** for a member who forgot to check in or out. Typed hours become an end time from the check-in (or the shift's scheduled start), computed through UTC so a DST night credits what was typed; entries outside 0–48 hours hold **Next**.                                                                                        | #2904, `915075b1`                                |
| **Event detail**: the left accent is reserved for the urgency meaning it already has; the icons are lucide, not inline SVG.                                                                                                                                                                                                                                  | #2912, #2905                                     |
| **Expiring-supplies email fits a phone** — three columns (Item, Expires, Ready stock / Qty), apparatus and compartment or lot as a second line, days left under the date. The "&mdash;" fallback was HTML-escaped and printed literally.                                                                                                                     | `24fb9788`                                       |
| **Public Portal → Configuration**: the default rate limit is a controlled text field; Save refuses anything that is not a whole number from 1 to 100,000 with an inline message instead of sending NaN to a 422.                                                                                                                                             | `9a0aa84c`                                       |
| **Email Templates banner** no longer tells admins to press Reset on a template that is already current.                                                                                                                                                                                                                                                      | `54e163ff`                                       |
| **Elections** frontend follow-ups from the W50 workflow review: ballot, results, nominations, extend-election and merge-write-ins dialogs; new receipt verification and close stamp.                                                                                                                                                                         | `06c3d560`                                       |

### CI and test infrastructure (no user-visible change)

- The Playwright E2E job is split **by weight, not by test count**, and the sweep
  budgets are set from measured runs and derived into the cap (`ci.yml`; see
  `docs/` CI notes quoting the slower of two, then three, measured runs).
- A SQLAlchemy `SADeprecationWarning`, `SAWarning` or
  `SAPendingDeprecationWarning` now **fails the run**. That is how the
  `.contains` and `like_op` JSON findings above were found.
- Backend reference docs and `CLAUDE.md` say SQLAlchemy 2.1, matching the pin.

### Migration route

| Revision       | Parent         | What it does                                                                                      | Downgrade                                                      |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `84819ea78a79` | `d058b5e7c1f4` | Grants `training.view_analytics` to seeded leadership positions that still hold `training.manage` | Removes the grant                                              |
| `edf608b5a8ea` | `84819ea78a79` | Folds `shift_review_call_types` into the department call-type list; guarded on the table existing | Removes only entries it added (marker `folded_report_types`)   |
| `34d3d56d1479` | `edf608b5a8ea` | Adds nullable `users.preferred_name`; idempotent against `repair_schema`                          | **Drops the column**, discarding preferred names entered since |

`DATABASE_SCHEMA.md` already lists `preferred_name`; if the Backend Unit Tests
job reports drift, run `cd backend && python scripts/generate_schema_docs.py`.

### Documentation and media disposition

**Corrected in this pass**

| Document                                                   | Change                                                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `UPGRADING.md`                                             | Four entries (preferred name, department shift-report totals, call-type fold, category-credit repair); revision list extended |
| `training/08-admin-reports.md`                             | Editing a role that holds a wildcard; `training.view_analytics` in the permission notes                                       |
| `training/10-mobile-pwa.md`                                | Administration hub gutter, alert contrast, red primary actions, date/time picker, expiring-supplies email                     |
| `training/02-training.md`                                  | Multi-category requirements repair                                                                                            |
| `wiki/Recent-Changes-2026-10.md`, `Home.md`, `_Sidebar.md` | New handoff page and links                                                                                                    |
| `wiki/Role-System.md`                                      | `training.view_analytics` and wildcard editing                                                                                |
| `training/SCREENSHOT_CURRENCY.md`                          | Shots to create and replace                                                                                                   |
| `youtube-scripts/SCRIPT_CURRENCY.md`                       | Beats now incomplete or stale                                                                                                 |

**Already current before this pass** (written by the commits themselves):
`training/01-membership.md` (preferred names), `training/02-training.md` and
`03-scheduling.md` (shift-report authorship, Calls Responded, call types,
close-out hours), `TRAINING_PROGRAMS.md`, `SCHEDULING_MODULE.md`,
`LABEL_PRINTING_MODULE.md`, `wiki/Member-ID-Cards.md`, `KEY_ROTATION.md` and
`BACKUP.md` (NFC tags and ID cards named among what a changed `ENCRYPTION_SALT`
breaks).

**Not edited, deliberately.** `CHANGELOG.md` has been closed to per-change
entries since 2026-09-08 (see `CLAUDE.md`), so nothing was appended to it or to
`docs/changelog/`. `APPLICATION_PAGES.md`, `testingRegistry.ts` and
`mobile-route-inventory.ts` need nothing: no route was added or retired.

**Not done.** No screenshot was re-shot and no script was rewritten — the lists in
`training/SCREENSHOT_CURRENCY.md` and `youtube-scripts/SCRIPT_CURRENCY.md` are
the work order.

## Change audit: October 3 – 4, 2026

Net changes merged to `main` in the 25 hours ending 2026-10-04, written against
`9a1198e7` (PR #2903). **30 non-merge commits, about 20 pull requests**
(#2878 – #2903). One migration in the window, `d058b5e7c1f4` (three nullable
date columns).

> **Gap:** the previous audit stops at 2026-09-23. Commits from 2026-09-24 to
> 2026-10-02 have no audit page, wiki handoff or currency note. This page does
> not cover them. _(Closed 2026-10-04: the
> [September 24 – October 4 audit](./CHANGE_AUDIT_2026-09.md#change-audit-september-24--october-4-2026),
> written in parallel, covers the whole window including these two days.)_

Roughly half the commits are security-review and app-review passes (forms,
messaging, integrations, reports, onboarding, security-audit IP, scheduled
tasks, locations, course cohorts) whose records live in
`docs/security-review/` and `docs/app-review/`. Wiki handoff:
[`Recent-Changes-2026-10`](../wiki/Recent-Changes-2026-10.md#recent-changes-october-3--4-2026).

### Read this first

1. **Probationary accounts can sign in and be scheduled** (#2886).
   `User.is_active` meant `status == ACTIVE`; it now covers `(ACTIVE,
PROBATIONARY)` in Python and SQL, shift eligibility, three scheduling rosters
   and the targeted-message recipient filter. An account kept out by being
   probationary can now sign in. Entry in `UPGRADING.md`.
2. **Training requirements can exempt existing members** (#2878). Cutoff date,
   catch-up deadline, "new members only" edits that split a requirement into the
   preserved original plus a copy, and a waive-for-enrolled choice on programs.
   Every grading screen now passes the member's join date and role ids to one
   helper; a sweep test fails on omission. Exports and forecast print N/A where a
   requirement does not apply. Entry in `UPGRADING.md`.
3. **Scheduler claim renewal (CRON-40)** (#2901). Renewal was an unconditional
   `SET`, so a worker that had lost its claim took it back and a second runner
   stayed for the life of the process; four workers meant duplicate reminders.
   Renewal is now an atomic Lua compare-and-extend in `core/background_claim.py`;
   shutdown deletes only a key it still owns. Entry in `UPGRADING.md`.
4. **Course cohort shift** (#2902). CC-5: DST-safe local-time arithmetic; CC-6: a
   finalized class refuses the whole shift before any class moves; CC-7 flagged
   (`KNOWN_LIMITATIONS.md`).
5. **Locations (#2900).** `GET /locations/{id}/display` now redacts
   `event_description` like its public sibling, because it gained a real caller.

### Behaviour and layout changes

| PR                  | Change                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #2882               | Equipment checklists: note on a chosen failure, Overall Notes unpinned, one submit toast, Fleet Readiness and My Checklists share a rule, real vehicle types in the builder, unpublish banner, failure-log total fixed, `Organization.active` server default |
| #2880, #2893, #2903 | `card-grid` utility; tablet audit fixes (hover-only actions gated on `pointer-fine:`, `btn-*` inline-flex at every width, Reports date inputs, Kits/Variant Groups, wrapped names); last ten card containers moved to `card`                                 |
| #2890               | Event roster controls 44px on phones; two fills moved onto `btn-info`/`btn-success`                                                                                                                                                                          |
| #2887 – #2889       | Selected toggles use red-800; Training Setup and compliance config fit 320px, contrast and heading fixes, malformed config response handled                                                                                                                  |
| #2891, #2894        | Settings screens regain phone width (`SettingsLayout` `inHub` prop)                                                                                                                                                                                          |
| #2895               | CI: E2E job timeout headroom                                                                                                                                                                                                                                 |

### Documentation and media disposition

**Corrected in this pass**

| Document                                                                 | Change                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `training/02-training.md`                                                | New "Existing Members" section; two cohort edge-case rows                        |
| `training/01-membership.md`, `training/03-scheduling.md`                 | Probationary counts as active                                                    |
| `training/05-inventory.md`                                               | Checklist changes of 2026-10-03                                                  |
| `training/10-mobile-pwa.md`                                              | Phone and tablet layout pass                                                     |
| `UPGRADING.md`                                                           | Three entries: probationary sign-in, requirement exemption, scheduler duplicates |
| `wiki/Module-Training.md`, `Module-Scheduling.md`, `Module-Inventory.md` | Engineering notes                                                                |
| `wiki/Recent-Changes-2026-10.md`, `Home.md`, `_Sidebar.md`               | New handoff page and links                                                       |
| `training/SCREENSHOT_CURRENCY.md`                                        | Shots to create and replace                                                      |
| `youtube-scripts/SCRIPT_CURRENCY.md`                                     | Beats now incomplete or stale (scripts 03, 05, 06, 07, 08, 14, 16)               |

**Not edited, deliberately.** `CHANGELOG.md` has been closed to per-change
entries since 2026-09-08 (see `CLAUDE.md`). `DATABASE_SCHEMA.md` was already
regenerated in #2882. Nothing in `APPLICATION_PAGES.md`: no route was added or
retired.

**Not done.** No screenshot was re-shot and no script was rewritten — the lists
above are the work order. The guide 20 index and `docs/training/README.md` were
not extended; the topics went into the module guides directly.
