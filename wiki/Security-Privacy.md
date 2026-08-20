# Privacy & Data Subject Rights

_(Added 2026-07-31)_

The Logbook holds personal data and, where the Medical Screening module is
enabled, protected health information. Confidentiality is covered by
[Encryption](Security-Encryption) and [Authentication](Security-Authentication);
this page covers the **rights members have over their own data** and the
**retention rules** governing how long records are kept.

Aligned with ISO/IEC 27701 and the HIPAA right of access. The full control
inventory lives in [`docs/COMPLIANCE.md`](../docs/COMPLIANCE.md).

---

## Overview

| Right                    | How it works                                                       | Who initiates                       |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------- |
| **Access / portability** | Download a complete personal-data export as JSON                   | The member, self-service            |
| **Erasure**              | Anonymization of a departed member, preserving operational history | An administrator (`members.manage`) |
| **Consent**              | Opt in/out of optional processing (photo use, roster listing, SMS) | The member, self-service            |
| **Transparency**         | Public privacy notice and terms, department-configurable           | Published by the department         |
| **Retention limits**     | Per-department schedules with safety floors, enforced daily        | Configured by an administrator      |

---

## Personal Data Export

**Settings → Security → Your Data → Download my data**
(`GET /api/v1/users/me/data-export`)

Returns everything the system stores about the calling member as a single JSON
file: profile and emergency contacts, training and certifications, shift/event/
meeting attendance, admin hours, leaves of absence, medical screening records,
skill tests, dues, equipment custody, consents, and shift evaluation reports
written _about_ them.

Guarantees:

- **Self-scoped by construction.** The endpoint reads the authenticated
  identity — there is no route through it to another member's data.
- **Rate limited** to 3 requests/hour (assembling an export touches every
  module's tables) and **audited** as a `user_data_export` event.
- **Security material is never exported** — password hashes, MFA secrets and
  backup codes, password-reset tokens, the calendar-feed token, and the OAuth
  subject are excluded regardless of which model they live on.
- **Audit history is summarized** (count + first/last timestamp) rather than
  dumped, because audit rows are security records rather than subject data.
- Reviewer-internal notes on shift evaluations are excluded; the evaluation
  content about the member is included.

> **Adding a model?** The export is table-driven (`_EXPORT_SECTIONS` in
> `backend/app/services/data_export_service.py`). A new model holding member
> personal data is a one-line addition there — and should also be added to the
> anonymization service.

---

## Anonymization (Right to Erasure)

`POST /api/v1/users/{id}/anonymize` — requires `members.manage`, refused for
active members and for your own account. **Irreversible by design.**

Departments must keep operational history long after a member departs, but
nothing requires keeping the _person_ attached to it. Anonymization separates
the two.

| Scrubbed                                                                                                                                | Retained                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Names, username, email (replaced with per-member tokens), phone, mobile, address, date of birth, photo                                  | Training completions, certifications, instructor qualifications |
| Emergency contacts, notification preferences, referral/interest free text                                                               | Attendance counts, service hours, shift assignments             |
| Credentials, MFA secret and backup codes, OAuth linkage, password-reset and calendar-feed tokens                                        | Property custody, checkouts, departure clearance                |
| Sessions and password history (rows deleted)                                                                                            | Dues and financial records                                      |
| Body measurements / size preferences (rows deleted)                                                                                     | Screening status and dates, as compliance proof                 |
| Medical screening content — results, notes, provider name                                                                               | Leave types and date ranges (compliance denominators)           |
| Free-text reasons on leaves, training waivers, shift time-off, meeting waivers                                                          | Meeting attendance (present/excused)                            |
| RSVP dietary restrictions, accessibility needs, notes                                                                                   | RSVP attendance and check-in times                              |
| Duplicated identity copies in external-provider mappings; candidate photos                                                              | Candidate names on ballots (official election records)          |
| The applicant-era prospect record: full PII block, notes, interview assessments, uploaded documents; its public status token is rotated | Pipeline stage history                                          |

**Never touched:**

- **Audit logs** — append-only and hash-chained. Rewriting them would be
  tampering and would break integrity verification. The anonymization event
  itself deliberately records only the user id, never the name, so it does not
  reintroduce the identity into an immutable table.
- **Votes and ballots** — election integrity signatures must not change.

Preconditions: the member must already be departed (soft-deleted, or in a
dropped/archived status). Deactivate or archive first.

> Because the org-scoped unique indexes on username, email, and membership
> number forbid a constant placeholder, each anonymized member receives a
> distinct `anon-<token>` identity. `users.anonymized_at` records when it
> happened.

---

## Consent

**Settings → Security → Privacy Choices** (`GET/PUT /api/v1/users/me/consents`)

Consent gates _optional_ processing only — the things a department may do with
permission, as distinct from the processing membership itself requires.

| Consent                 | Covers                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| `photo_use`             | Using the member's photo in publications, social media, public material         |
| `public_roster_listing` | Showing name and rank on the public website roster                              |
| `sms_notifications`     | Sending SMS notifications (US TCPA requires express consent for text messaging) |

How it is recorded:

- `user_consents` holds **current state** per (member, consent type).
- Every change is also written to the tamper-evident audit log as
  `consent_updated` — that append-only trail is the **consent ledger** a
  privacy audit asks for, since it cannot be rewritten.
- **Never-asked fails closed.** A member with no record is treated exactly
  like one who refused. The UI shows "(not answered)" so an unanswered choice
  is distinguishable from a deliberate no, but consumers must call
  `ConsentService.has_consent()` and get `False` either way.

---

## Public Privacy Notice & Terms

`/privacy` and `/terms` are public, unauthenticated pages. They ship with
substantive fire-service defaults covering data categories (including PHI and
emergency contacts), role-based access, retention, member rights, and
essential-cookies-only.

**Department control is stated on both pages** _(2026-08-17)_. Each opens with
a callout saying the department holds full control of the application and of
the records in it, and that **access is a function of the reader's status
within the department** — granted, narrowed, suspended, or ended by the
department under its own bylaws, SOPs, and membership policies and applicable
state and local law, with a change of status (probation, leave, rank change,
suspension, separation) changing access without prior notice. The Logbook is
named as the software, never as the party deciding access. This is not
decoration: it is what makes an access removal defensible, and it is the point
a departing member is most likely to dispute.

The defaults also carry the sections a reviewer looks for and their absence is
what fails an assessment: sources of information, public-records and legal
disclosure, monitoring / no expectation of privacy, breach notification,
members under 18 (junior and cadet programs), an explicit no-sale / no-ads /
no-automated-decisions statement, a data-location statement, and a "changes to
this notice" section. The terms add confidentiality of other members'
information, department ownership of records created in the system, personal
device duties, notification channels, an explicit **not-for-emergencies**
disclaimer, enforcement, and an order-of-precedence clause putting department
policy, agreements, and law above the terms themselves.

Both pages show a **Last updated** date. The built-in date lives in
`DEFAULT_LEGAL_LAST_UPDATED` in `LegalPage.tsx` and must be bumped whenever the
default text changes; a department publishing its own wording supplies its own
date via `legal.last_updated`, and no date is shown if it does not — the
built-in date describes the built-in text and would misdate custom wording.

Departments replace the wording via organization settings
(`legal.privacy_policy` / `legal.terms_of_service`), served by
`GET /api/public/v1/legal`. Custom text renders as **plain paragraphs, never
HTML**, so an administrator cannot inject markup into a public page. Custom
text replaces a document wholesale — a department's counsel-reviewed notice is
not merged with the defaults, so a replacement must restate the control and
access language itself. Values are read defensively (`settings["legal"]` is
unvalidated JSON): a non-string or non-dict degrades to the defaults rather
than 500-ing a page anonymous visitors reach, and text is capped at 100,000
characters. On a multi-organization install the endpoint returns defaults
only — with no authenticated org context, one tenant's text is never shown to
another's visitors.

---

## Records Retention

Statutory retention for fire-service records varies by state, so schedules are
**configured per department** rather than hardcoded (ISO 15489).

`GET/PUT /api/v1/organizations/retention-policy` (`settings.manage`, audited as
`retention_policy_updated`), enforced daily by the `retention_enforcement`
task.

| Record class                              | Default                                      | Floor   |
| ----------------------------------------- | -------------------------------------------- | ------- |
| `message_history`                         | 90 days                                      | 30 days |
| `notification_logs`                       | Keep forever                                 | 30 days |
| `form_submissions`                        | Keep forever                                 | 90 days |
| Blocked-access telemetry (platform-level) | 365 days (`RETENTION_BLOCKED_ATTEMPTS_DAYS`) | 30 days |

- **Floors** exist so a typo cannot wipe recent records, and are re-applied at
  enforcement time — settings edited outside the API cannot bypass them.
- **Keep-forever defaults** mean nothing is deleted until a department
  deliberately opts in.
- **Documents and meeting minutes are deliberately excluded** from automatic
  deletion. Destroying official records on a timer is a department decision
  belonging in its own retention schedule, executed by a person.
- **Audit records** follow their own 7-year rule — see
  [Audit Logging → Retention Policy](Security-Audit-Logging#retention-policy).

---

## Need-to-Know Enforcement _(updated 2026-08-02)_

Endpoints that returned more than the caller was entitled to. All are fixed;
they are worth knowing about because they shaped what "visibility settings"
actually meant.

**The contact-visibility setting was bypassable.** `GET /users` filtered
contact details against the organization's setting, but the two
`with-roles` endpoints returned every column on the member record. All require
only `users.view`, so a member refused an email address on one screen could
read it on another, along with home address and personal email, which the
roster never exposes at any setting.

Fixed in two passes, and the second is the instructive one: the roster
endpoint was corrected first, leaving the **individual profile** endpoint
still unredacted _(closed 2026-08-02)_. A partial fix here is barely a fix —
anything withheld on the roster remained one request away. All member-record
endpoints now redact through the same shared code so the two cannot drift
apart again, and the redaction fails closed: if the settings row cannot be
read, contact details are hidden rather than shown. Members always see their
own record in full, which matters because the settings page loads a member's
own profile through that endpoint and writes the fields back — redacting for
self would have blanked a member's own address on their next save.

**Date of birth and emergency contacts are leadership-only** _(2026-08-02)_.
Restricted to `members.manage` holders and the member themselves, with **no
setting that can publish them** — `contact_info_visibility` deliberately has no
flag for either.

Emergency contacts are treated this way because they are not solely the
member's data: they name a spouse, parent or neighbor who is not in the
department, never consented to appear in its systems, and holds no account
with which to remove themselves. Date of birth is restricted because, paired
with a name, it is the field most useful for impersonation.

Disclosure is recorded on the `user_viewed` audit event, so the trail
distinguishes _who saw the restricted fields_ from who merely opened a
profile.

**Directory profiles no longer disclose account-security metadata**
_(2026-08-16)_. `members.view` lets a member find and open a colleague's
directory entry; it does not entitle them to the colleague's account state.
A caller relying only on `members.view` now receives the profile with
`email_verified`, `mfa_enabled`, `last_login_at`, `created_at`,
`updated_at`, and notification preferences cleared, and with the permission
lists stripped from the colleague's roles (role _names_ remain, because the
profile displays them). The redaction matters because MFA status plus last
login is a target-selection map — it tells an attacker which accounts are
soft. `users.view` holders, members-managers, and the member themselves see
the full record.

**Profile edits cannot move a member's hire date** _(2026-08-16)_.
`hire_date` joined rank, station, platoon, and membership number in the
restricted-field set on profile updates: it drives automatic membership-tier
advancement, so changing it with only `users.edit` amounted to
self-service seniority. It now requires leadership, the secretary, or the
membership coordinator.

**Shared-device logout purges every draft namespace** _(2026-08-16, red-team
RT-08)_. The logout purge on shared/station computers removed shift-report
drafts and the offline queues, but equipment-check drafts
(`equipment-check-draft-*` in `localStorage`) survived, leaving the previous
member's apparatus results and narrative notes readable by the next person
at the browser. The purge now sweeps both draft namespaces, including
orphaned keys, and leaves unrelated browser preferences intact. See
[`docs/security/RED_TEAM_REVIEW_2026-08-16.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/security/RED_TEAM_REVIEW_2026-08-16.md).

**Organization settings leaked infrastructure.** `GET /organization/settings`
is open to every authenticated member — the page needs branding, module
enablement and visibility flags. It redacted credentials, but not the
identifiers those credentials authenticate _to_: mail server hostname and
username, S3 bucket, region and endpoint, SharePoint site URL, the SSO issuer
URL, and every OAuth tenant and client ID. Together those map a department's
infrastructure for anyone who can log in — including a member who left last
week, or a compromised volunteer account. Callers without `settings.manage`
now get those fields blanked; the response keeps its shape, so the settings
page renders "not configured" rather than breaking.

That strip initially missed the **IT team block** _(closed 2026-08-02)_ — the
names, direct email and phone of whoever administers the deployment, plus
`backup_access`, a free-text field holding whatever an admin wrote about
break-glass procedures. It is now emptied for callers without
`settings.manage` alongside the rest.

---

## What Departments Still Own

The software implements controls; it cannot adopt policy on your behalf:

- Publishing your own privacy notice text and keeping it accurate
- Deciding when a departed member's record is anonymized, and recording that
  decision
- Setting retention values that match your state's records schedule
- Breach notification, which has **statutory deadlines** under HIPAA (60 days)
  — see [Security Overview → Incident Response](Security-Overview#incident-response)

Policy skeletons for all of this, pre-filled with what the platform enforces,
are in [`docs/policies/`](../docs/policies/).

---

**See also:** [Security Overview](Security-Overview) | [Audit Logging](Security-Audit-Logging) | [Encryption](Security-Encryption) | [HIPAA Security Features](Security-HIPAA)
