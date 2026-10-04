# Change audit: September 24 – October 4, 2026

Net changes merged to `main` in the window ending 2026-10-04. It picks up where
the [September 15 – 23 audit](./CHANGE_AUDIT_2026-09-15_TO_09-23.md) stopped,
at `da7d28479` (PR #2650), and was written against `9a1198e79` (PR #2903,
2026-10-04 17:23 UTC).

**250 pull requests (#2651 – #2903).** 247 merged into `main` and three into
another PR's branch (#2656, #2657, #2732). That is at least 473 non-merge
commits; 48 of the PRs sit behind the working clone's shallow graft and were
recovered from GitHub.

- **62 Alembic revisions, 17 of them merges.** The head is `d058b5e7c1f4`.
- **14 routes added, none retired.**
- **4 new permissions and 2 new seeded positions.**

| Class                                       | PRs | Notes                                                                                            |
| ------------------------------------------- | --: | ------------------------------------------------------------------------------------------------ |
| Behaviour changes                           | 141 | Includes the fixes shipped inside review PRs                                                     |
| Plain-language copy passes                  |  31 | #2777, #2779 – #2787, #2789 – #2809: one per module, rewording labels, headings and empty states |
| Workflow review                             |  19 | A new rotation; see [Review rotations](#review-rotations)                                        |
| Security review                             |  18 | 15 passes, plus three PRs that only record a merge                                               |
| Alembic merge-only                          |  13 | See [Alembic route](#alembic-route-upgrade-data-path)                                            |
| Docs, screenshots and seeders               |  19 |                                                                                                  |
| Deployment, dependencies, CI and app review |   9 |                                                                                                  |

**The window's theme is driving every workflow end to end.** On 2026-09-27 the
project started a [workflow review](./workflow-review/README.md). Each run
drives one activity in a real browser, against a real database, as each role
that performs it, then fixes what it finds. Fifty-two of 79 activities ran in
eight days. That review is where most of the window's fixes came from:

- members who could not sign in;
- applicants converted past steps they had not finished;
- an election that locked out a member whose ballot was voided;
- MFA recovery codes that were never shown.

Alongside it, a plain-language pass rewrote the wording of every module, so
**button and heading names changed across the app**. That is why this pass
queues 122 screenshots. Training guides and scripts quote labels, and many of
those labels are now different.

Companion operator lesson: the **September 24 – October 4** section of
[`training/20-september-2026-release-changes.md`](./training/20-september-2026-release-changes.md),
which indexes where each topic now lives in the module guides. Wiki handoff:
[`Recent-Changes-2026-09-24-to-10-04`](../wiki/Recent-Changes-2026-09-24-to-10-04.md).
Screenshots to create and replace are listed in
[Documentation and media disposition](#documentation-and-media-disposition).

## Read this first

Eight changes alter what somebody sees or may do without anyone asking for it.
Every one has a dated entry in [`UPGRADING.md`](./UPGRADING.md) under _Changes
you will notice after an upgrade_. Nineteen of those entries were added by this
pass, because the PRs did not write them.

1. **Every email template was reset to the new design, including edited
   ones** ([#2754](https://github.com/thegspiro/the-logbook/pull/2754),
   migration `15c5bc7700aa`).
   - A department's own wording is kept in `email_template_backups`. It comes
     back from the template's **Previous version (before the redesign)** panel
     ([#2757](https://github.com/thegspiro/the-logbook/pull/2757)).
   - The Email Templates tab still shows an older banner telling admins to
     press **Reset** to adopt the design. That advice now only discards
     wording. It is recorded in `KNOWN_LIMITATIONS.md` as open.
   - Replies now go to the department's own address
     ([#2710](https://github.com/thegspiro/the-logbook/pull/2710)), and the
     seeded "do not reply" line is gone (`3f3b315165ed`).
2. **The Email Notifications switch now covers every optional email**
   ([#2772](https://github.com/thegspiro/the-logbook/pull/2772),
   [#2774](https://github.com/thegspiro/the-logbook/pull/2774)).
   - A member who switched it off stops getting shift, inventory, store,
     election and suggestion-box emails that used to arrive regardless.
   - Members now have a switch for each optional email. A department can make
     an email required on the new **Member Emails & Texts** page.
3. **Probationary and junior members can sign in and be scheduled**
   ([#2886](https://github.com/thegspiro/the-logbook/pull/2886)).
   - Before, they were refused with "Account is inactive".
   - They now appear on rosters and can sign themselves up for shifts.
   - About forty hand-written `status == ACTIVE` checks elsewhere still leave
     them out. That is recorded as an open decision.
4. **Every department gains two positions held by nobody, and an open
   Compliance suggestion box.**
   - The new positions are **Assistant Membership Coordinator** and
     **Compliance Officer** (`43e9df281412`, `3c918c06466d`).
   - The box is switched on (`7d2b4e8a1c35`), so **reports wait unread until a
     Compliance Officer is appointed.**
   - The seeded "Fire Chief" now reads **"Chief"** (`d4e1a7c93b58`). Only the
     label changes.
5. **Five seeded positions gain grants written to their stored rows.**
   - The Quartermaster gains `inventory.check_manage` (`f73b449bdb8b`).
   - Leadership, the Apparatus Officer and the Facilities Manager gain the two
     new NFC tag-writer grants (`5bed4c485d2f`).
   - The Assistant Membership Coordinator gains `members.manage_id_cards`.
   - Each grant is gated on evidence that the row is still the department's
     seeded position.
6. **Conversion is held until an applicant has finished every required stage**
   ([#2771](https://github.com/thegspiro/the-logbook/pull/2771)).
   - An Election Vote stage now needs an election package before the
     applicant can advance
     ([#2851](https://github.com/thegspiro/the-logbook/pull/2851)).
   - A target role chosen before the upgrade is no longer applied by
     automatic conversion (MP-31,
     [#2829](https://github.com/thegspiro/the-logbook/pull/2829)).
   - Applicants already parked on either kind of stage need a coordinator.
7. **Production refuses to start without a public `FRONTEND_URL`**
   ([#2700](https://github.com/thegspiro/the-logbook/pull/2700),
   [#2716](https://github.com/thegspiro/the-logbook/pull/2716)).
   - If `FRONTEND_URL` is unset or loopback, the first public `ALLOWED_ORIGINS`
     entry is used.
   - The compose `production` nginx needs a certificate in
     `infrastructure/nginx/ssl/`
     ([#2844](https://github.com/thegspiro/the-logbook/pull/2844)).
   - Both are under _Changes that can stop an existing deployment from
     starting_.
8. **Property-return reminders are sent for the first time**
   ([#2683](https://github.com/thegspiro/the-logbook/pull/2683)). The first
   run after the upgrade emails every dropped member who still holds property
   and has passed a threshold, one reminder each.

## Release map

| Theme                          | What changed                                                                                                                                                                                                                                                                                                                                                          | Where it is documented                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Department timezone**        | "Today" is the department's date everywhere: compliance, alerts, reports, scheduling, expiry. Emails, PDFs and CSV exports print the department's time. A ratchet test (`test_server_date_ratchet.py`) refuses any new `date.today()` (#2735, #2738, #2742, #2744, #2746)                                                                                             | [`training/08`](./training/08-admin-reports.md), [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md)                                                                  |
| **Email**                      | Centred masthead (#2708), replaced two days later by the solid-tab shell for every email (#2754). Previous-version panel (#2757). Hosted logo (#2709). Reply-To the department (#2710). Date tile, per-item footer switches, realistic test sends and logo validation (#2760). Email link address card and override (#2733, #2741). Station-only link warning (#2770) | [`training/08`](./training/08-admin-reports.md), [`EMAIL_DELIVERABILITY.md`](./EMAIL_DELIVERABILITY.md), [`DROP_NOTIFICATIONS.md`](./DROP_NOTIFICATIONS.md)        |
| **Notifications**              | One required/optional list for every member email (#2772). Per-email switches and department-required emails (#2774). Same-category stacks (#2775). **Equipment Request Update** rule (#2767). Training-review notices (#2776)                                                                                                                                        | [`training/07`](./training/07-documents-forms.md), [`COMMUNICATIONS_MODULE.md`](./COMMUNICATIONS_MODULE.md)                                                        |
| **Suggestion boxes**           | In-app/push notices and **Also notify** (#2720). Status history, responses to submitters and an opt-in idea board (#2730). Deleting a box (#2734). The Compliance box (#2673, #2678). Anonymous submissions are not logged anywhere (#2830)                                                                                                                           | [`training/07`](./training/07-documents-forms.md), [`COMMUNICATIONS_MODULE.md`](./COMMUNICATIONS_MODULE.md)                                                        |
| **Membership**                 | Archived filter and Reactivate (#2669). Service across a break (#2674). Anonymize (#2701). Member-number patterns, never reissued (#2819, #2823). Directory Rank column (#2857). No account without a known password (#2751). Profile write redaction (#2858). ID card limited to badge officers (#2860)                                                              | [`training/01`](./training/01-membership.md), [`wiki/Member-ID-Cards.md`](../wiki/Member-ID-Cards.md)                                                              |
| **Prospective members**        | Target role stored and applied, with a ceiling (#2652, #2656, #2829). Self-withdrawal (#2659, #2664). Email stages complete themselves (#2655). Conversion held on required stages, and Sign-offs (#2771). Server-created election packages (#2851). Purge that purges (#2835). Per-pipeline conversion (#2836)                                                       | [`training/15`](./training/15-prospective-members.md), [`PROSPECTIVE_MEMBERS_MODULE.md`](./PROSPECTIVE_MEMBERS_MODULE.md)                                          |
| **Training**                   | Exempting members who joined before a requirement (#2878). Finalized events write training records, and approval needs `training.manage` (#2820). Target Solutions via its Training Records API: hourly, plus a daily 30-day review (#2815, #2818, #2822). Cohort DST fix (#2902)                                                                                     | [`training/02`](./training/02-training.md), [`training/16`](./training/16-integrations.md), [`TRAINING_PROGRAMS.md`](./TRAINING_PROGRAMS.md)                       |
| **Scheduling and admin hours** | Shifts with other departments and Outside Apparatus (#2749, #2826). Re-sign-up after declining (#2745). Withdrawing swaps with the seat, and officer-approved targeted offers (#2832). Shift Reports tab (#2756, #2762, #2763). Members edit or withdraw their own hours (#2748)                                                                                      | [`training/03`](./training/03-scheduling.md), [`SCHEDULING_MODULE.md`](./SCHEDULING_MODULE.md), [`wiki/Module-Admin-Hours.md`](../wiki/Module-Admin-Hours.md)      |
| **Events, elections, minutes** | Recurring series keep local time (#2773). RSVP hidden once closed (#2828). "I was there" requests (#2855). Organizer, alternate and Transfer Event (#2870). Attendance-lock refusals answer 409 (#2842). Election W50 fixes (#2848, #2856). Minutes W51 fixes (#2887)                                                                                                 | [`training/04`](./training/04-events-meetings.md), [`training/14`](./training/14-elections.md), [`MEETING_MINUTES_MODULE.md`](./MEETING_MINUTES_MODULE.md)         |
| **Inventory, NFC and labels**  | NFC tag tracking phases 1 – 4d: item and shelf tags, put-away, shelf audits, a self-service kiosk, compartment tags, offline use (#2662, #2668, #2686, #2696, #2702, #2707, #2714). Network label printing, shared setups and print history (#2651, #2663). Room door tags and room kiosk badge check-in (#2868)                                                      | [`training/05`](./training/05-inventory.md), [`training/06`](./training/06-apparatus-facilities.md), [`wiki/Inventory-NFC-Tags.md`](../wiki/Inventory-NFC-Tags.md) |
| **Finance**                    | Approvals screen (#2843). Approval-chain step editor (#2839). Deciding requests no chain applies to (#2838). camelCase bodies accepted (#2854)                                                                                                                                                                                                                        | [`training/11`](./training/11-finance.md), [`FINANCE_MODULE.md`](./FINANCE_MODULE.md)                                                                              |
| **Navigation and layout**      | Top-bar overflow into More (#2737). Drawer scroll cue (#2824, #2852). Member-chosen phone bottom-bar tabs; Settings opens My Account (#2864). `card-grid` and tablet fixes (#2880, #2893, #2903). Red selected toggles (#2891). Settings use the full width on phones (#2894)                                                                                         | [`training/10`](./training/10-mobile-pwa.md), [`training/00`](./training/00-getting-started.md)                                                                    |
| **Deployment**                 | `FRONTEND_URL` fallback and refusal (#2700, #2716). Installers write it (#2675, #2677). 60 MB uploads, a startable compose nginx, and an opt-in proxy-only override (#2844). starlette 1.7 (#2694)                                                                                                                                                                    | [`UPGRADING.md`](./UPGRADING.md), [`DEPLOYMENT.md`](./DEPLOYMENT.md), [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)                                                 |

## New URLs

| Route                                          | Page                         | Gate                                                                        | PR    |
| ---------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- | ----- |
| `/inventory/storage-areas/print-labels`        | Storage area labels          | `inventory.manage`                                                          | #2651 |
| `/inventory/admin/nfc`                         | NFC tag settings             | `settings.manage` or `organization.update_settings`                         | #2662 |
| `/inventory/tag/:code`                         | Tag landing (a tapped tag)   | `inventory.view`                                                            | #2662 |
| `/inventory/put-away`                          | Put away                     | `inventory.manage`                                                          | #2668 |
| `/inventory/shelf-audit`                       | Shelf audit                  | `inventory.manage`                                                          | #2686 |
| `/inventory/admin/nfc/enroll`                  | Bulk tag enrolment           | `inventory.manage`                                                          | #2686 |
| `/inventory/admin/not-seen`                    | Items not seen               | `inventory.manage`                                                          | #2686 |
| `/inventory/kiosk`                             | Self-service checkout kiosk  | `inventory.kiosk`                                                           | #2702 |
| `/scheduling/admin/settings/outside-apparatus` | Outside Apparatus settings   | `scheduling.manage`                                                         | #2749 |
| `/prospective-members/sign-offs`               | Sign-offs                    | Signed in (lists only stages waiting on a role the viewer holds)            | #2771 |
| `/communications/member-emails`                | Member Emails & Texts        | `settings.manage`, `organization.update_settings` or `notifications.manage` | #2772 |
| `/training/approve/:token`                     | Training-credit approval     | `training.manage`                                                           | #2820 |
| `/finance/approvals`                           | Approvals                    | `finance.approve`                                                           | #2843 |
| `/locations/:locationId/check-in`              | Room check-in (NFC door tag) | Signed in                                                                   | #2868 |

Gates widened on existing routes:

- `/locations/qr-codes` also admits `locations.manage_nfc_tags` and
  `apparatus.manage_nfc_tags`.
- `/prospective-members/print-labels` also admits
  `prospective_members.manage` (W17-4).

New public endpoints:

- `GET /api/public/v1/branding/email-logo`
- `POST /api/public/v1/display/{display_code}/badge-tap`
- `POST /api/public/v1/application-status/{token}/withdraw`

`/api/public/v1/events/public` stopped returning 500 (#2665).

All fourteen routes are in the three registries (pitfall #30a). **Nothing was
retired**, and no bookmark breaks.

## Alembic route (upgrade data path)

Head `d058b5e7c1f4`, a single head across 509 migrations; `validate_migrations.py`
passes. Of the 62 new revisions, 17 are pure merges. Two published revisions
had only their downgrades edited:

- `e7c4a913b8d2` (#2708).
- `b8f2c05d7a91` (#2747). It now drops a foreign key by its real name; the old
  downgrade failed with MySQL 1091 on tables built by `create_all`.

**Data-touching and seeding revisions:**

| Revision       | PR           | What it does                                                                                              | Reversible                                                              |
| -------------- | ------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `77d4aa7798dd` | #2652, #2656 | Six prospect columns (target role, lifecycle stamps), backfilled from `prospect_activity_log`             | Yes                                                                     |
| `43e9df281412` | #2659        | Seeds **Assistant Membership Coordinator** on every onboarded department                                  | Removes it only if nobody holds it                                      |
| `3c918c06466d` | #2673        | Seeds **Compliance Officer** and a **Compliance** suggestion box (inactive)                               | Removes the box only if unedited and empty; the position only if unheld |
| `7d2b4e8a1c35` | #2678        | Switches on seeded Compliance boxes still exactly as seeded (owner decision, 2026-09-24)                  | Yes                                                                     |
| `d4e1a7c93b58` | #2703        | "Fire Chief" → "Chief" on seeded rows still carrying that wording; the code stays `fire_chief`            | Yes, including a row a department renamed to "Chief" by hand            |
| `f0d76814a9ab` | #2708        | Untouched email templates → centred masthead                                                              | Yes                                                                     |
| `3f3b315165ed` | #2731        | Removes "Please do not reply to this email." from saved footer libraries                                  | Yes                                                                     |
| `b795d1b3401b` | #2736        | Untouched templates → the then-current default, matched by SHA-256                                        | **No** — downgrade is a no-op                                           |
| `15c5bc7700aa` | #2754        | **Resets every shipped-type template, edited ones included**; old values kept in `email_template_backups` | Restores from the backup table                                          |
| `ba5c348d7045` | #2760        | Event-reminder date tile, untouched rows only                                                             | Yes                                                                     |
| `81537606ee07` | #2663        | Label print history, seeded from each item's latest print stamp                                           | Yes                                                                     |
| `0010291816fd` | #2730        | Suggestion status events, backfilled                                                                      | Lossy — drops status history and responses                              |
| `e79309de6735` | #2730        | Idea board columns and `suggestion_votes`                                                                 | Lossy — drops publishing and votes                                      |
| `f73b449bdb8b` | #2848        | Quartermaster `inventory.check_manage`, evidence-gated                                                    | Revokes                                                                 |
| `5bed4c485d2f` | #2868        | NFC tag-writer grants and the Assistant Membership Coordinator's ID-card grant, evidence-gated            | Revokes                                                                 |
| `6394fbf42581` | #2856        | Clears the duplicate-vote hash on voided votes so the member can vote again                               | **No — irreversible by design**                                         |
| `d9f3a6c2e8b1` | #2856        | Paper-ballot batch void trail, backfilled                                                                 | Yes                                                                     |
| `c8266855a348` | #2856        | Untouched election templates → W50 wording                                                                | Yes                                                                     |
| `90070d4a2f6f` | #2870        | Event organizer, backfilled from the creator                                                              | Yes                                                                     |

**The other 26 content revisions are additive** (new columns or tables):

- `1b52ea3a079e`, `941e1251ad74`, `ced0061dedc8`, `500a63596f66`, `b4014469fd76`
- `b1eb0458782a`, `2000f4561f52`, `31e8ad77527b`, `1ae1ffbc445e`, `8c47e8945f69`
- `f03c9f236904`, `fb7da5b05833`, `2b15c5a8ba82`, `31027aabca12`, `601fdb28ab8c`
- `0ff2dfd2e9a2`, `8464e9962f76`, `040ae44ad286`, `ac06a2998013`, `b7d2e41c9f03`
- `c4e8a1f7d2b6`, `d058b5e7c1f4`
- **Lossy on downgrade:** `b713c2e8ee26` (storage-area tags and every recorded
  scan), `7ad83f52735c` (shelf audits) and `45b36bae9098` (compartment tags).

UPGRADING now has a single entry, _Steps in this release that do not reverse_,
listing every irreversible and lossy step.

**Why the grant migrations may add.** Both follow
[`docs/rules/migrations.md`](./rules/migrations.md): an addition needs positive
evidence that the row is an unedited seed.

- For the two NFC grants, absence is that evidence. The permissions did not
  exist before, so no department could have removed them.
- For the existing grants, the migration checks a sibling permission that
  defines the role: the Quartermaster must still hold `inventory.manage`, and
  the Assistant Membership Coordinator must still hold
  `prospective_members.manage`.
- Neither migration compares a row's whole stored list, because that snapshot
  is pinned to one build.

**Heads kept forking.** Thirteen PRs did nothing but join heads, and several
raced:

- #2711 and #2712 merged the same pair.
- #2722 and #2724 landed twelve seconds apart, so #2727 joined them.
- #2751, #2752 and #2663 forked within forty seconds, so #2753 is a
  three-parent merge.

No process change landed. The cost is a merge-only PR each time two feature
branches with migrations land together.

`DATABASE_SCHEMA.md` was regenerated by 35 of the 38 model-touching PRs. The
other three changed no schema (#2703, #2810, #2886), and the `--check` run
reports no drift.

## Permission and enforcement movements

### New permissions

- **`inventory.kiosk`** — operates the self-service checkout kiosk. No
  position holds it by default.
- **`system.manage_link_domain`** — changes the email link address from
  Settings → Email. Only the `*` wildcard holds it by default.
- **`apparatus.manage_nfc_tags`** and **`locations.manage_nfc_tags`** — decide
  who the app offers the tag writer to.

### Seeded positions

- **Assistant Membership Coordinator.** Pipeline management. Receives
  applicant-withdrawal notices. Gains `members.manage_id_cards` from
  `5bed4c485d2f`.
- **Compliance Officer.** `training.manage`, `training.configure`,
  `compliance.*`, `reports.manage` and `documents.manage`.
  - Becomes the copy recipient of certification-expiry alerts, which had
    resolved to nobody.
  - Reviews the seeded Compliance box.

### Tightened

- **MP-31 (HIGH, #2829).** An applicant's target role is now held to the
  permission ceiling of whoever chose it.
  - Before, a `prospective_members.manage` holder could store the
    administrator position on an applicant whose email they controlled, then
    convert them.
  - The ceiling is checked when the role is set and when it is applied.
  - Automatic conversion applies the role only while its recorded chooser can
    still grant it.
- **Public-portal admin API (#2831).** All 13 handlers now require
  `settings.manage`. Before, any signed-in member could list and create API
  keys and edit the published-fields whitelist.
- **Another member's ID card (#2860).** Now requires `members.manage` or
  `members.manage_id_cards`. This is a frontend gate:
  `/members/print-labels` with `members.view` still prints colleagues' badges
  (recorded in `KNOWN_LIMITATIONS.md`).
- **Applicant labels (#2773, W17-3).** They no longer encode the applicant's
  status token. Badges printed earlier should be destroyed.
- **Anonymous suggestions (#2830).** Their submissions and follow-ups are
  excluded from the nginx, uvicorn and IP-logging access logs, and from error
  reporting.
- **Room display endpoint (#2900, LOC5-32-1).** Redacts the event description.

### Widened

- **Probationary and junior accounts are active (#2886).** The rule is
  `ACTIVE_ACCOUNT_STATUSES = (ACTIVE, PROBATIONARY)`.
- **Requests no approval chain applies to (#2838).** A `finance.approve`
  holder other than the requester can decide them.
- **Public form submissions (#2811).** A form manager can allow them without
  signing in. The default is unchanged.
- **Targeted swap offers (#2832).** Officers can approve them.
- **Admin hours (#2748).** Members can edit, withdraw and resubmit their own
  pending or rejected entries.

## Deployment and configuration

**No new environment variable names.**

**`FRONTEND_URL` is now required in production, with a fallback.**

- Compose passes it to the backend. Before, the compose whitelist silently
  dropped it.
- When it is empty or a loopback address, links use the first public
  `ALLOWED_ORIGINS` entry.
- With neither, production refuses to start.
- All three installers ask for the address.

**Proxies (#2844).**

- 60 MB uploads on every bundled proxy. The frontend container's nginx was
  refusing anything over 1 MB.
- The compose `production` profile mounts its own `docker.conf` and reads its
  certificate from `infrastructure/nginx/ssl/`.
- New opt-in `docker-compose.proxy.yml` makes nginx the only way in.
- Proxies an operator runs themselves keep their own limit; UPGRADING says so.

**Scheduled tasks** (the registry grew from 45 to 47):

- `property_return_reminders`, daily at 07:45 (#2683).
- `inventory_audit_digest` (#2696).
- Target Solutions syncs hourly, with a daily 30-day review.

**CRON-40 (#2901).** Renewing the worker claim is now a compare-and-extend
script. Before, two or more workers could run every scheduled task each minute,
indefinitely.

**starlette 1.7.0 (#2694).** A request with a missing or malformed `Host`
header now gets 400 wherever the host allowlist is active.

## Review rotations

**Workflow review (new, [#2755](https://github.com/thegspiro/the-logbook/pull/2755)).**

- Each run takes one activity and drives it in a real browser, against a real
  database, as each role that does it.
- It runs in its own database (`logbook_workflow_review`) and Redis db 3, from
  `scripts/workflow-review/`.
- Progress: 52 of 79 activities in eight days (W01 – W51 and W60). The next is
  W52.
- About 250 fixes and 70 flagged items, by a minimum count from the log.

The fixes worth knowing:

- **W04-2 and W04-3 (HIGH):** MFA recovery codes were never shown, and the MFA
  lockout never tripped.
- **W01-10 (HIGH):** a setup reset left the auth cookies in place and caused a
  retry storm.
- **W16-1 (HIGH):** an applicant could be converted past an unsigned
  multi-signer stage.
- **W50-6:** a voided ballot locked the member out of voting again.
- **W17-3:** applicant labels carried the status token.

Each flagged item that is the owner's to decide is in `KNOWN_LIMITATIONS.md`.

**Security review.** It covered Features 18 – 32, one pass each, from 10-02 to
10-04: one fix (LOC5-32-1) and no new flags.

- RPT5-29-5 strengthens RPT5-29-1.
- CMP4-4 was closed by W29-4, and BXC-1 by W60.
- CRON-40 was re-verified open and fixed the same day.
- The docs-only "record the merge" PRs returned (#2876, #2879, #2883), although
  #2644 had meant to retire them.

**App review.** A5 pass 3
([#2902](https://github.com/thegspiro/the-logbook/pull/2902)):

- **CC-5 (MED) fixed:** shifting a cohort across a daylight-saving change moved
  every class by an hour.
- A locked batch is now refused before it moves.
- **CC-7 flagged.**

The membership review produced MP-31, MED-10 (cleared fields not persisting,
#2849) and MED-11 (election packages, #2851).

## Dependencies and CI

- **npm group (#2768).** vitest, `@vitest/ui` and `@vitest/coverage-v8` 5.0.2;
  vite 8.3.1; prettier 3.9.9; dompurify 3.4.16; lucide-react 1.48;
  typescript-eslint 8.70.1.
- **Python group (#2769).** **SQLAlchemy 2.0.54 → 2.1.1**; uvicorn 0.54;
  pyjwt 2.15; sentry-sdk 2.70; flake8 7.4.1; pylint 4.0.9.
- **starlette 1.7.0 (#2694).** Comes with a new edge-middleware test.
- **Holds unchanged.** PyMySQL 1.2.0 and jsdom 30.0.1. typescript-eslint still
  caps `typescript` below 6.1, so the two-TypeScript arrangement stands.
- **CI.** The E2E job's timeout rose from 30 to 45 minutes (#2895); sharding is
  named as the durable fix. The contrast audit now emulates reduced motion
  (#2660).
- **New guard tests:**
  - `test_server_date_ratchet.py`
  - `test_nginx_config_consistency.py`
  - `test_public_portal_admin_permissions.py`
  - `test_prospect_target_role_ceiling.py`
  - `test_probationary_account_access.py`
  - `test_kiosk_badge_tap.py`
  - `mapperFieldIntegrity.test.ts`
  - `hoverRevealIntegrity.test.ts`

## Documentation and media disposition

### What the window's own PRs already documented

Most feature PRs carried their own notes, and the ones this pass checked were
accurate:

- six UPGRADING entries and the "Back up first" section;
- sixteen KNOWN_LIMITATIONS entries;
- the five NFC-phase PRs' guide sections, whose labels were verified against
  the source;
- the workflow-review records under `docs/workflow-review/`.

**What none of them did** was carry the copy passes' renamed labels into the
guides, wiki and scripts that quote them. Nor did they write UPGRADING
entries for most of the grants, seeded positions and permission changes.

### Corrected in this pass

One hundred and one documentation files changed, fourteen of them YouTube scripts and their currency record. Each module guide was checked against
the current source by area, and **describes the application as it is today**,
with dated notes where someone who learned the old behaviour needs telling.

**Errors that predate the window were fixed wherever they were found.** The
largest:

- **`wiki/Module-Admin-Hours.md`.** Its pages, API paths, permissions and data
  model were almost entirely wrong. Rewritten from the code.
- **`MEETING_MINUTES_MODULE.md`.**
  - It described a `review` status that does not exist.
  - The API path is `/api/v1/minutes-records`, not `/api/v1/minutes`.
  - It named `meetings.*` permissions where the code uses `minutes.*` and
    `documents.*`.
- **`training/03-scheduling.md`.** Its tab table listed tabs that moved out on
  2026-09-05. It said an officer approves Open Shifts sign-ups; none does.
- **`training/08-admin-reports.md`.**
  - The Public Portal section described custom-domain and branding settings
    that never existed.
  - It listed five reports.
  - It said welcome emails are on by default in the import.
- **`training/11-finance.md`.**
  - It described a chain Preview tool and Save as Draft / Submit buttons that
    do not exist.
  - It said a request no chain applies to is auto-approved. It waits.
- **`training/05-inventory.md`** and **`MEDICAL_SUPPLIES_MODULE.md`.**
  - Both described SMS low-stock alerts, which are banned by pitfall #18.
  - 05 called the inventory print page's direct-print button "Send to
    Printer".
- **`training/07-documents-forms.md`.**
  - It described a folder tree, Move/Rename and a parent-folder selector,
    none of which exist.
  - It listed four notification triggers the UI no longer offers.
  - It described a dashboard **Clear All** that was retired on 2026-08-16.
- **`wiki/Member-ID-Cards.md`.** It said cards ship blank, so the serial is
  always the credential. That has been wrong since 2026-08-23.
- **`wiki/Module-Scheduling.md`.** The withdraw and time-off API paths were
  wrong.
- **`wiki/Module-Events.md`.** It listed two recurring-series endpoints that do
  not exist, and claimed attachment uploads.
- **`BALLOT_FORENSICS_GUIDE.md`.** Receipt verification returns
  `verified`/`counted`/`voided`, not `valid`.
- **`training/13-medical-screening.md`.** It said **Applies to Roles** is
  enforced; nothing reads it.

**`UPGRADING.md`.** Nineteen new entries, plus a superseded note on the
2026-09-23 suggestion-box entry ("Nothing is live until someone creates a box"
is no longer true). The new entries:

- steps that do not reverse;
- probationary sign-in;
- the seeded grants;
- colleague ID cards;
- election packages;
- training-event credit;
- Target Solutions credentials;
- pre-upgrade target roles;
- the public-portal API;
- the 409 refusals;
- applicant badges;
- equipment-request notices;
- the Email Notifications switch;
- `POST /users` without a password;
- Reply-To;
- the seeded positions, Compliance box and "Chief";
- property-return reminders;
- self-run proxy upload limits;
- the Host header.

**`KNOWN_LIMITATIONS.md`.**

- New: _Found by the September 24 – October 4 Documentation Pass_, with five
  items:
  - the dead **Map User** button on External Training;
  - the stale Reset banner on Email Templates;
  - NFC hashes depending on `ENCRYPTION_SALT`;
  - the probationary checks left for an owner decision;
  - the API-side gap in the ID-card gate.
- Updated: W46-13 is marked resolved by #2882, and the Finance "Add Approval
  Step form — Not built" row is marked built by #2839.

**`CHANGELOG.md` was not edited.** It has been closed to new entries since
2026-09-08 (see `CLAUDE.md`). This audit, the PRs and `UPGRADING.md` carry the
record instead.

### Screenshots

The full queue is in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md), under
_Queued by the September 24 – October 4 documentation pass_. Every row there is
the text of a marker placed in the guide beside the image. Counts were
regenerated into
[`training/SCREENSHOT_STATUS.md`](./training/SCREENSHOT_STATUS.md), which now
reads **569 of 608 placeholders filled**: the 38 queued below, plus the one
carried phone shot.

| Guide                     | REPLACE |    NEW | Main reasons                                                                         |
| ------------------------- | ------: | -----: | ------------------------------------------------------------------------------------ |
| 00 Getting started        |       2 |      0 | "My Account"; seven password rules                                                   |
| 01 Membership             |       6 |      1 | Rank column, Add Member, waiver Applies To, Selected buttons; member-number patterns |
| 02 Training               |       3 |      5 | Existing-members dialog, submission notices, setup guide, Target Solutions           |
| 03 Scheduling             |       9 |     10 | Page subtitle, Open Shifts, settings sections; outside shifts, Shift Reports         |
| 04 Events & meetings      |       9 |      7 | Organizer and Transfer, copy pass, minutes; "I was there", room tags                 |
| 05 Inventory              |       6 |      0 | Request states, item form, assign-scan, storage areas                                |
| 06 Apparatus & facilities |       4 |      1 | Copy pass; room check-in page                                                        |
| 07 Documents & forms      |       8 |      4 | Forms and sharing, rule triggers, messages; stacks, Member Emails & Texts            |
| 08 Admin & reports        |      11 |      2 | Every email preview (solid-tab shell), Reports, Public Portal; Previous version      |
| 10 Mobile & PWA           |       0 |      2 | Phone navigation bar; drawer scroll cue                                              |
| 11 Finance                |       8 |      3 | Approve/Deny panels, chain editor; Approvals screen                                  |
| 12 Grants & fundraising   |       4 |      0 | Copy pass                                                                            |
| 13 Medical screening      |       3 |      0 | Copy pass; Applies to Roles note                                                     |
| 14 Elections              |       3 |      0 | Voting Method and **Winner** row; Defaults removed                                   |
| 15 Prospective members    |       4 |      2 | Convert dialog, pipeline settings, Selected buttons; Sign-offs, withdraw             |
| 16 Integrations           |       0 |      1 | Target Solutions provider                                                            |
| 17 Privacy                |       1 |      0 | No ID Card button on a colleague's profile                                           |
| 18 Storefront             |       3 |      0 | Copy pass                                                                            |
| **Total**                 |  **84** | **38** |                                                                                      |

**About fifty further frames are listed as CHECK** — open the image and re-shoot
only if the named detail is in frame. These include:

- every desktop `/scheduling` frame, which carries the old page subtitle;
- any tablet-width capture, after the card-grid and toggle-colour changes.

**None of the 122 has been captured.** The seeder needs new demo data for most
of the NEW shots; `SCREENSHOT_CURRENCY.md` lists what. The room kiosk's
badge tap needs an NFC reader, so that row asks for the reachable chooser
screen instead.

### YouTube script beats

Each discrepancy the area reviews reported was checked against the source
before the script was changed. Unverifiable claims were dropped rather than
written. The full table is in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md),
under _Flagged by the 2026-10-04 currency pass_. That section also lists the
chapters that need new footage or re-timing.

The scripts with the most **Wrong** beats:

- **03 IT Manager.** A request with no approval chain does not "go through".
  The scheduling settings it names (swap rules, blackout dates) do not exist.
- **04 Fire Chief.** The ID-card check-in reads NFC, not the QR code.
- **06 Member.** An open swap cannot be claimed by any member.
- **07 Secretary.** The email-design beat is wrong, the "do not reply" footer
  is gone, and the minutes workflow ("New Minutes", publish immediately) is
  wrong.
- **08 Shorts.** The bottom-bar, swap, Add Member and NFC shorts.
- **12 Elections.** The voter override steps, and "results visible
  immediately", which is now **Publish Results**.

## Verification

```bash
cd backend && python scripts/validate_migrations.py   # head = d058b5e7c1f4
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage (rewrites SCREENSHOT_STATUS.md)
cd backend && python scripts/generate_schema_docs.py --check
```

Results against `9a1198e79` plus this pass's documentation:

- **Migrations:** 509 migrations, a single head (`d058b5e7c1f4`).
- **Routes:** 244, with 0 errors and 0 warnings.
- **Endpoints:** 1,584 documented handlers, with 0 errors and 0 warnings.
- **Schema docs:** `--check` reports no drift.
- **Screenshots:** 569 of 608 filled.
- **Links:** 424 Markdown files, 0 broken.
