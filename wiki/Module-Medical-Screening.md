# Medical Screening Module

> The full engineering reference is [docs/MEDICAL_SCREENING_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/MEDICAL_SCREENING_MODULE.md).

Physicals, medical clearances, drug screens, vision and hearing tests, fitness
assessments and psychological evaluations — what the department requires, who
has had them, and whose are about to lapse. Records can be filed against a
current member or against an applicant still in the
[Prospective Members](Module-Prospective-Members) pipeline.

**This module holds protected health information (PHI).** Who can see it, how
it is stored and how every look at it is recorded is covered in
[Who can see what](#who-can-see-what) and
[HIPAA-relevant behaviour](#hipaa-relevant-behaviour) below; read those before
granting anyone access. **Off by default.**

---

## Enabling it

**Administration → Organization Settings → Organization → Modules**
(`/settings`, needs `settings.manage`). Medical Screening is listed under
**Additional Modules** (opt-in), described as "Member physicals, clearances, and
expiration tracking".

While it is off, the menu entry is hidden, the page refuses to open, and every
`/api/v1/medical-screening` endpoint refuses the request. Turning it off later
deletes nothing.

Once it is on, the page is at **Administration → Members → Medical Screening**
(`/medical-screening`).

## Who can see what

| Permission                 | Grants                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `medical_screening.view`   | The page; the requirements; every member's and applicant's records, including results and notes; the compliance roster; expiring lists |
| `medical_screening.manage` | Create, edit and delete requirements and records; the member/applicant picker on **Add Record**                                        |

- **No built-in position carries either permission** except IT Manager, whose
  `*` wildcard grants everything. Not the Chief, not the Safety Officer, not
  the Membership Coordinator. A department decides who handles medical records
  and grants it deliberately under **Administration → Organization Settings →
  Role Management** — see [Role System](Role-System).
- **`view` is not a summary permission.** It opens the records themselves —
  provider, result summary, structured results and notes — for every member
  and applicant in the department. Grant it only to people whose job needs the
  results, not merely the status.
- **Either permission makes the holder "privileged" for two-factor
  authentication.** Whatever the department's own MFA setting, a member holding
  `medical_screening.view` or `.manage` must enrol in MFA. They are emailed
  once and have `MFA_GRACE_DAYS` (default 14) to do it; after that they can
  reach only the MFA setup screens. See
  [Security-Authentication](Security-Authentication).
- **Every member sees their own counts — and only counts — on the dashboard**,
  with no permission at all, while the module is on. The dashboard card says
  how many requirements are met, how many are not, how many expire soon and
  how many days until the next one lapses. It never names the screening, its
  type, date or result, because the dashboard is often left open on a station
  tablet.
- **The Members Administration hub** (`/members/admin`, a `members.manage`
  screen) adds a **Screenings current** metric (share of active members with
  an unexpired screening) and lapsed-screening attention items only for a
  viewer who also holds `medical_screening.view`, and only while the module is
  on.

## HIPAA-relevant behaviour

| Safeguard                  | What the module does                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Encryption at rest**     | Provider name, result summary, structured results and notes are AES-256-GCM encrypted. Dates, status and the links to the member are not — they are what the compliance views sort and filter on, and the sensitive content is the result, not the fact a screening is on file. See [Security-Encryption](Security-Encryption#what-is-encrypted) |
| **Reads are audited**      | Opening the records list, a single record, the compliance roster, one person's compliance or the expiring list writes an audit event naming who looked and whose records came back (one event per request, not per row), committed before the response is sent. The member's own dashboard counts are not audited                                |
| **Writes are audited**     | Creating, updating and deleting requirements and records are audit events; deletes are logged at warning severity                                                                                                                                                                                                                                |
| **No caching**             | `/medical-screening/` is excluded from the browser's API cache, and the service worker never caches `/api/` responses                                                                                                                                                                                                                            |
| **Department isolation**   | A record cannot be filed against a member, applicant or requirement from another department (refused with "Invalid member", "Invalid prospect" or "Invalid screening requirement"); a compliance lookup for an id outside the department is a 404                                                                                                |
| **Right of access**        | A member's own data export (`GET /api/v1/users/me/data-export`) includes their screening records                                                                                                                                                                                                                                                 |
| **Anonymisation**          | Anonymising a member or an applicant scrubs the medical content (results, notes, provider) from their screening records                                                                                                                                                                                                                          |
| **Assistant (MCP) access** | Off unless the department turns on **Share medical screening status** and the key holder has `medical_screening.view`; even then it returns compliant-or-not and lapse dates, never a result, provider, note or status. See [Integration-Claude-MCP](Integration-Claude-MCP)                                                                     |

The department-wide picture — access control, audit chain, BAAs — is on
[Security-HIPAA](Security-HIPAA) and [Security-Audit-Logging](Security-Audit-Logging).

---

## The page

`/medical-screening` has three tabs, and the tab is in the address
(`?tab=requirements`, `?tab=records`, `?tab=compliance`) so a link can open
the right one. It opens on **Requirements**.

A banner across the top counts screenings expiring in the next 30 days.

### 1. Set up requirements

**Requirements → Add Requirement.**

| Field                                  | What it does                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name, Screening Type, Description      | Type is one of Physical Exam, Medical Clearance, Drug Screening, Vision & Hearing, Fitness Assessment, Psychological Evaluation                                                                      |
| One-time requirement (not recurring)   | Ticked: a screening on file satisfies it indefinitely                                                                                                                                                |
| Frequency (months)                     | For a recurring requirement. A record saved without an expiration date falls due this many calendar months after it was completed                                                                    |
| Applies to Positions (comma-separated) | Position names or slugs, case and spacing ignored. Blank: every member. Listed: only members holding one of them. **Applicants are always graded on every requirement** — they hold no positions yet |
| Grace Period (days past expiration)    | **Saved but not enforced.** A screening is non-compliant the day after it expires, whatever this says; the form says so                                                                              |
| Active                                 | Only active requirements are graded                                                                                                                                                                  |

**Deleting a requirement keeps its records.** They are unlinked from it and stay
in each person's history.

### 2. Record a screening

**Records → Add Record.**

1. Choose **Member** or **Prospect**, then the person. The member list is
   everyone still on the roster — including members on leave or suspended,
   since a return-to-duty physical is exactly what they need. The prospect list
   is applicants still open in the pipeline.
2. Optionally pick a **Linked Requirement**; it fills in the screening type,
   and once you enter a completed date it suggests an expiration date from the
   requirement's frequency ("Filled in from the requirement's N-month
   frequency"). Change it if the provider gave a different date.
3. Set the status, dates, provider, result summary and notes. Save.

Statuses: Scheduled, Completed, Passed, Failed, Pending Review, Waived, Expired.

- **Passed, Completed and Waived satisfy a requirement.** A waiver counts as
  cover until its own expiration date; a lapsing waiver appears in the
  expiring list marked **Waived**, since renewing it is different work from
  booking a screening.
- **Editing a record to Passed, Failed or Waived records you as the
  reviewer**, with the time.
- **Renew by adding a new record**, not by editing the old one. Grading uses the
  person's most recent satisfying record of each type, so history stays intact.
- **Self-recorded.** A record whose status was last set by the person it is
  about carries a **Self-recorded** badge. It still counts; it tells you nobody
  else has saved its result. Anyone else saving the record with its status
  clears the badge.
- **For an applicant, a Passed or Completed record can move them on.** If the
  applicant is sitting on a Medical Screening stage whose **Auto-advance when
  all screenings pass** box is ticked, saving the record re-checks the stage,
  and once every screening type the stage requires has a Passed or Completed
  record the applicant advances (see
  [Prospective Members](Module-Prospective-Members#stage-types)). An applicant
  on hold, rejected or withdrawn is never moved this way.

### 3. Check compliance

**Compliance** shows a roster of every member and open applicant, graded
against the requirements that apply to them, with totals (Requirements,
Compliant, Not compliant, Expiring soon) and a filter:

| Filter                             | Means                                                    |
| ---------------------------------- | -------------------------------------------------------- |
| Not compliant (overdue or missing) | At least one applicable requirement expired or never met |
| Expiring within 30 days            | Met today, lapsing within 30 days (today included)       |
| Compliant                          | Every applicable requirement met                         |

A member to whom no requirement applies reads **Not applicable**, never
compliant. Open a row to see that person's requirement-by-requirement detail.
Below the roster, **Screenings Expiring Within 60 Days** lists each lapsing
screening with days left — "(by frequency)" when the date was derived from the
requirement rather than entered.

---

## Rules and gotchas

- **There is no expiry email.** Nothing in the scheduler sends screening
  reminders; the expiring list, the banner, the admin hub and the member's
  dashboard card are how lapses surface.
- **Medical screening does not feed the Training/[Compliance](Module-Compliance)
  module's figures.** It is graded on its own.
- **When an applicant becomes a member, their screening records stay filed
  against the applicant**; conversion does not move them, and a record's
  subject cannot be changed by editing it. Record anything the member needs
  going forward against the new member.
- **A record with neither an expiration date nor a frequency to derive one
  never lapses.**
- **The Add Requirement / Add Record buttons show for view-only holders**, but
  the server refuses the save without `medical_screening.manage`.

## For developers

- **API:** `/api/v1/medical-screening` — `requirements`, `records`, `subjects`
  (picker), `compliance` (roster, `?standing=`), `compliance/me` (the
  caller's counts, any signed-in member), `compliance/{user_id}`,
  `compliance/prospect/{prospect_id}`, `expiring?days=` (1–365, default 30).
  The router is gated on the `medical_screening` module. Responses are
  snake_case.
- **Models:** `app/models/medical_screening.py` — `screening_requirements`,
  `screening_records` (exactly one of `user_id` / `prospect_id` on create;
  `requirement_id` is `SET NULL`; `self_recorded` flag).
- **Grading:** `_grade` in `app/services/medical_screening_service.py` is the
  one definition of compliant used by the roster, per-person summary, dashboard
  counts and expiring list.
- **Frontend:** `frontend/src/modules/medical-screening/`; the dashboard reads
  `medicalScreeningService.getMyCompliance()`.
- **Migrations:** `20260313_0101` creates the tables; `20260707_0001`
  lowercases the enums; `20260810_0001` encrypts the PHI columns (legacy
  plaintext stays readable — `backend/scripts/reencrypt_to_aesgcm.py`
  re-encrypts it); `9c1445489666` adds `self_recorded`.

## Related

- [Prospective Members](Module-Prospective-Members)
- [Security-HIPAA](Security-HIPAA)
- [Security-Encryption](Security-Encryption)
- [Security-Audit-Logging](Security-Audit-Logging)
- [Role System](Role-System)
- [Configuration-Modules](Configuration-Modules)
