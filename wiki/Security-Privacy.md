# Privacy & Data Subject Rights

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

**My Account → Privacy → Privacy Choices** (`GET /api/v1/users/me/consents`;
one choice at a time with `PUT /api/v1/users/me/consents/{consent_type}`)

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
- **The column itself defaults to a refusal.** `user_consents.granted`
  defaults to `false` in the model and the database: the only safe value to
  record for a consent nobody gave is "no" — and for SMS a default grant would
  breach the TCPA express-consent requirement.

---

## Public Privacy Notice & Terms

`/privacy` and `/terms` are public, unauthenticated pages. They ship with
substantive fire-service defaults covering data categories (including PHI and
emergency contacts), role-based access, retention, member rights, and
essential-cookies-only.

**Department control is stated on both pages.** Each opens with
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

### Editing the wording: Governance -> Legal Documents

`/governance/legal` is where a department changes what those pages say, instead
of hand-editing a JSON settings column. It shows the live text for each
document, the open proposals, and the published history.

**Proposing is separate from publishing, on purpose.** `legal.propose` reaches
the screen and writes drafts; `legal.publish` is what changes the public page.
The two are backfilled from `settings.view` and `settings.manage` respectively
(migration `06adc68a8b84`), so by default the secretary, chiefs, captains,
lieutenants, president, VP, treasurer, board, quartermaster, membership
coordinator, and assistant secretary can propose, while the Fire Chief,
President, and IT Manager can publish. Regular members and firefighters hold
neither and never see the screen. Both are assignable like any other permission
if a department wants a different split.

A new proposal is seeded with the text currently published — or, when the
platform default is live, with a plain-text rendering of that default from the
same source `LegalPage` renders (`pages/legal/legalContent.ts`). That shared
source is the point: a department adapting the notice starts from what members
are actually reading, and cannot silently drop the department-control and
status-based-access language by retyping around it.

Every revision carries a **required** change note naming the bylaw, SOP,
statute, or counsel advice behind it. Publishing archives the previous
published revision rather than deleting it, and audits as
`legal.document_published`; reverting to the built-in default archives the
department's version and clears the settings key. The result is that the
question a records request asks — what did this page say on that date, and who
decided — has an answer.

Only drafts are editable. A proposer may change their own draft; a publisher
may change anyone's. Published and archived revisions are immutable.

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

`GET /api/v1/organization/retention-policy` lists every record class with its
default, floor and effective setting; `PUT
/api/v1/organization/retention-policy/{record_class}?days=<n>` sets one class
(omit `days` to keep forever). Both require `settings.manage` or
`organization.update_settings`; a change is audited as
`retention_policy_updated`. The `retention_enforcement` task applies the
schedule daily.

| Record class                              | Default                                      | Floor   |
| ----------------------------------------- | -------------------------------------------- | ------- |
| `message_history`                         | 90 days                                      | 30 days |
| `notification_logs`                       | Keep forever                                 | 30 days |
| `error_logs`                              | 180 days                                     | 30 days |
| `form_submissions`                        | Keep forever                                 | 90 days |
| `guest_check_ins`                         | Keep forever                                 | 90 days |
| `practice_skill_tests`                    | 365 days                                     | 30 days |
| Blocked-access telemetry (platform-level) | 365 days (`RETENTION_BLOCKED_ATTEMPTS_DAYS`) | 30 days |

`guest_check_ins` covers external (non-member) event attendees — guest
check-in and public outreach sign-in rows; a prospective-member record opened
from one lives in the recruitment pipeline and is never swept.
`practice_skill_tests` sweeps only practice attempts; official skills-test
results share the table and are never deleted by retention.

- **Floors** exist so a typo cannot wipe recent records, and are re-applied at
  enforcement time — settings edited outside the API cannot bypass them.
- **Keep-forever defaults** mean nothing is deleted until a department
  deliberately opts in.
- **Documents and meeting minutes are deliberately excluded** from automatic
  deletion. Destroying official records on a timer is a department decision
  belonging in its own retention schedule, executed by a person.
- **Self-reported training certificates** are kept indefinitely unless the
  department sets a period in the self-report settings
  (`self_report_configs.attachment_retention_days`, 90-day floor), enforced
  daily by the `self_report_attachment_retention` task. It deletes the files
  only; the submission and training record rows stay. They can also be
  **malware-scanned on upload** with ClamAV (`CLAMAV_ENABLED`, on by default,
  and failing closed: while clamd is unreachable the upload is refused) — an
  infected file is never stored, and the audit event carries the
  signature name and a hash, never the file or its name. See
  [Security Configuration → Malware scanning](Configuration-Security#malware-scanning-of-uploads).
- **Public-portal access logs** (each request to the public API, including
  refused authentications, with the requester's IP address) are kept **90
  days**, a fixed platform-wide period, and deleted daily by the
  `prune_public_portal_access_log` task. It is not configurable
  per department.
- **Audit records** follow their own 7-year rule — see
  [Audit Logging → Retention Policy](Security-Audit-Logging#retention-policy).

---

## Need-to-Know Enforcement

What each endpoint returns is limited to what the caller is entitled to see,
and the rules below are what "visibility settings" actually mean.

**Contact visibility is enforced on every member-record endpoint.** `GET
/users`, the `with-roles` endpoints and the individual profile all redact
through the same shared code, so a field withheld on the roster is not one
request away on another screen. Home address and personal email are never on
the roster at any setting. The redaction fails closed: if the settings row
cannot be read, contact details are hidden rather than shown. Members always
see their own record in full — the settings page loads a member's own profile
through that endpoint and writes the fields back, so redacting for self would
blank a member's own address on their next save.

**Date of birth and emergency contacts are leadership-only.** They are
restricted to `members.manage` holders and the member themselves, with **no
setting that can publish them** — `contact_info_visibility` deliberately has
no flag for either. Emergency contacts are not solely the member's data: they
name a spouse, parent or neighbor who is not in the department, never
consented to appear in its systems, and holds no account with which to remove
themselves. Date of birth is restricted because, paired with a name, it is the
field most useful for impersonation. Disclosure is recorded on the
`user_viewed` audit event, so the trail distinguishes _who saw the restricted
fields_ from who merely opened a profile.

**Directory profiles do not disclose account-security metadata.**
`members.view` lets a member find and open a colleague's directory entry; it
does not entitle them to the colleague's account state. A caller relying only
on `members.view` receives the profile with `email_verified`, `mfa_enabled`,
`last_login_at`, `created_at`, `updated_at`, and notification preferences
cleared, and with the permission lists stripped from the colleague's roles
(role _names_ remain, because the profile displays them). MFA status plus last
login is a target-selection map — it tells an attacker which accounts are
soft. `users.view` holders, members-managers, and the member themselves see
the full record.

**Editing a colleague's profile needs `members.manage`.** `PATCH
/users/{id}/profile` and `/contact-info` accept only the member themselves and
`members.manage` holders, and every profile route passes its response through
one `_redact_profile_for_viewer`, so a write never returns more than a read
would. The profile page does not offer edit forms on a redacted record: the
forms are seeded from what is on screen and an update sends blanks as `null`,
so a save would erase every field the editor was never shown.

**Profile edits cannot move a member's hire date.** `hire_date` sits with
rank, station, platoon, and membership number in the restricted-field set on
profile updates: it drives automatic membership-tier advancement, so it
requires leadership, the secretary, or the membership coordinator rather than
`users.edit` alone.

**Shared-device logout purges every draft namespace.** The logout purge on
shared/station computers removes shift-report drafts, the offline queues and
equipment-check drafts (`equipment-check-draft-*` in `localStorage`),
including orphaned keys, and leaves unrelated browser preferences intact. See
[`docs/security/RED_TEAM_REVIEW_2026-08-16.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/security/RED_TEAM_REVIEW_2026-08-16.md)
(RT-08).

**Organization settings do not leak infrastructure.** `GET
/organization/settings` is open to every authenticated member — the page needs
branding, module enablement and visibility flags. Callers without
`settings.manage` get credentials **and** the identifiers they authenticate
_to_ blanked: mail server hostname and username, S3 bucket, region and
endpoint, SharePoint site URL, the SSO issuer URL, every OAuth tenant and
client ID, and the IT team block (names, direct email and phone of whoever
administers the deployment, plus the free-text `backup_access` field). The
response keeps its shape, so the settings page renders "not configured" rather
than breaking.

**A colleague's ID card is not directory information.** The ID Card page,
with its scannable QR code and barcode, opens for your own card, or anyone's
with `members.manage` or `members.manage_id_cards`. The underlying profile
data is still served to `members.view`; what is withheld is the assembled
credential. See [Member ID Cards](Member-ID-Cards#viewing-a-members-id-card-2026-09-30).

**An applicant's status token stays out of staff hands.** The token is the
applicant's only credential for the public status page, which can also
**withdraw** the application. Applicant labels and badges carry a short id,
never the token. Badges printed by earlier versions still encode the token and
should be destroyed.

**Applicant data minimization.** **Purge Selected** on the Inactive
Applications tab deletes the selected inactive applications and their uploaded
files from disk, audited by count and id. A pipeline with **Auto-Purge**
enabled has the same deletion run daily by the `membership_auto_purge` task —
see `docs/KNOWN_LIMITATIONS.md` ("Prospective Members — Purge Scope and
Auto-Purge") for its rules.

**Former members in the directory.** A member without `members.manage` is
served the directory from `GET /users/directory`, which leaves archived
(departed) members out. Coordinators keep the whole roster from `GET /users`,
so archived members still appear in member pickers that read it.

---

## What Departments Still Own

The software implements controls; it cannot adopt policy on your behalf:

- Publishing your own privacy notice text and keeping it accurate
- Deciding when a departed member's record is anonymized, and recording that
  decision
- Setting retention values that match your state's records schedule
- Whether to keep ClamAV scanning on — it costs a container and 1.5-3 GB of
  RAM, and while it is enabled and down, members cannot upload files; turning
  it off accepts uploads unscanned
- Breach notification, which has **statutory deadlines** under HIPAA (60 days)
  — see [Security Overview → Incident Response](Security-Overview#incident-response)

Policy skeletons for all of this, pre-filled with what the platform enforces,
are in [`docs/policies/`](../docs/policies/).

---

**See also:** [Security Overview](Security-Overview) | [Audit Logging](Security-Audit-Logging) | [Encryption](Security-Encryption) | [HIPAA Security Features](Security-HIPAA)
