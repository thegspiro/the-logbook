# Change audit: September 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's file, and a new month starts a
new file. The plain-language handoff for each pass is in
[`wiki/Recent-Changes-2026-09.md`](../wiki/Recent-Changes-2026-09.md).

## Change audit: September 24 – October 4, 2026

Net changes merged to `main` in the window ending 2026-10-04. It picks up where
the [September 15 – 23 audit](#change-audit-september-15--23-2026) stopped,
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

A narrower [October 3 – 4 audit](./CHANGE_AUDIT_2026-10.md#change-audit-october-3--4-2026) was
written in parallel and covers the window's last day in more detail; the two
agree, and where both added an `UPGRADING.md` entry for the same change
(probationary sign-in) the entries were merged into one.

Companion operator lesson: the **September 24 – October 4** section of
[`training/20-september-2026-release-changes.md`](./training/20-september-2026-release-changes.md),
which indexes where each topic now lives in the module guides. Wiki handoff:
[`Recent-Changes-2026-09`](../wiki/Recent-Changes-2026-09.md#recent-changes-september-24--october-4-2026).
Screenshots to create and replace are listed in
[Documentation and media disposition](#documentation-and-media-disposition).

### Read this first

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
   - The Email Templates tab carried an older banner telling admins to press
     **Reset** to adopt the design, which after the reset only discarded
     wording. Found by this pass and corrected on 2026-10-04 in the same pull
     request: the banner now says there is nothing to adopt and points to
     **Previous version**.
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

### Release map

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

### New URLs

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

### Alembic route (upgrade data path)

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

### Permission and enforcement movements

#### New permissions

- **`inventory.kiosk`** — operates the self-service checkout kiosk. No
  position holds it by default.
- **`system.manage_link_domain`** — changes the email link address from
  Settings → Email. Only the `*` wildcard holds it by default.
- **`apparatus.manage_nfc_tags`** and **`locations.manage_nfc_tags`** — decide
  who the app offers the tag writer to.

#### Seeded positions

- **Assistant Membership Coordinator.** Pipeline management. Receives
  applicant-withdrawal notices. Gains `members.manage_id_cards` from
  `5bed4c485d2f`.
- **Compliance Officer.** `training.manage`, `training.configure`,
  `compliance.*`, `reports.manage` and `documents.manage`.
  - Becomes the copy recipient of certification-expiry alerts, which had
    resolved to nobody.
  - Reviews the seeded Compliance box.

#### Tightened

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
  `members.manage_id_cards`. #2860 gated only the screens, which left
  `/members/print-labels` and the label API printing colleagues' badges for
  `members.view`; this pull request closes that, so badge printing follows
  the same rule.
- **Applicant labels (#2773, W17-3).** They no longer encode the applicant's
  status token. Badges printed earlier should be destroyed.
- **Anonymous suggestions (#2830).** Their submissions and follow-ups are
  excluded from the nginx, uvicorn and IP-logging access logs, and from error
  reporting.
- **Room display endpoint (#2900, LOC5-32-1).** Redacts the event description.

#### Widened

- **Probationary and junior accounts are active (#2886).** The rule is
  `ACTIVE_ACCOUNT_STATUSES = (ACTIVE, PROBATIONARY)`.
- **Requests no approval chain applies to (#2838).** A `finance.approve`
  holder other than the requester can decide them.
- **Public form submissions (#2811).** A form manager can allow them without
  signing in. The default is unchanged.
- **Targeted swap offers (#2832).** Officers can approve them.
- **Admin hours (#2748).** Members can edit, withdraw and resubmit their own
  pending or rejected entries.

### Deployment and configuration

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

### Review rotations

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

### Dependencies and CI

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

### Documentation and media disposition

#### What the window's own PRs already documented

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

#### Corrected in this pass

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
  - the dead **Map User** button on External Training (since fixed in this
    pull request, with the two endpoint defects it hid);
  - the stale Reset banner on Email Templates (since fixed in this pull
    request);
  - NFC hashes depending on `ENCRYPTION_SALT` (kept by owner decision; the
    key-rotation, backup and deployment docs now name it);
  - the probationary checks left for an owner decision;
  - the API-side gap in the ID-card gate (since fixed in this pull request).
- Updated: W46-13 is marked resolved by #2882, and the Finance "Add Approval
  Step form — Not built" row is marked built by #2839.

**`CHANGELOG.md` was not edited.** It has been closed to new entries since
2026-09-08 (see `CLAUDE.md`). This audit, the PRs and `UPGRADING.md` carry the
record instead.

#### Screenshots

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

#### YouTube script beats

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

### Verification

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

## Change audit: September 15 – 23, 2026

Net changes merged to `main` in the window ending 2026-09-23, picking up where
the [September 12 – 15 audit](#change-audit-september-12--15-2026) stopped at
`4c291192d` (2026-09-15 22:30 UTC, PR #2594). Written against `da7d28479`
(PR #2650, 2026-09-24 01:26 UTC).

**40 pull requests (#2595 – #2650), 51 non-merge commits.** Four schema
migrations, head `5a70c5dcd138`. **Two routes added, none retired** — the first
new addresses since the August 31 – September 6 window.

Of the 40, **nine change behaviour**, four are dependency updates, one repairs
the screenshot seeder, and the rest are documentation: the previous audit's own
three PRs, eleven security-review passes and the tracker records that followed
them. Twenty-six of the 51 commits are security-review work.

The window's theme is **records that say what really happened**. An applicant
leaves a meeting stage when the department has settled who attended, not when
they tapped a kiosk; an inventory item knows whether it has a label; a form
stops storing an answer to a question the submitter could not see; and the
pipeline header counts the applicants the table is showing. The one new
feature — **suggestion boxes** — is built on the same instinct: anonymity is
something the database does not store, rather than something the screen hides.

Companion operator lesson: the **September 15–23** section of
[`training/20-september-2026-release-changes.md`](./training/20-september-2026-release-changes.md#september-1523-2026-changes).
Wiki handoff:
[`Recent-Changes-2026-09`](../wiki/Recent-Changes-2026-09.md#recent-changes-september-15--23-2026).
Media disposition — which screenshots must be created, which replaced — is in
[Documentation and media disposition](#documentation-and-media-disposition)
below.

### Read this first

Five changes alter what somebody sees or may do without anyone asking for it.

1. **A meeting stage that names its event now binds the coordinator's own
   Advance, and waits for the event to be finalized.** Three PRs in two days
   moved this gate, and the last one is the rule:
   - [#2595](https://github.com/thegspiro/the-logbook/pull/2595) held **Bulk
     Advance** to the attendance gate, leaving a single **Advance** exempt.
   - [#2613](https://github.com/thegspiro/the-logbook/pull/2613) (first commit)
     replaced "who is advancing" with "what the stage asks for": a stage that
     names its event (Auto-Link Event Type or a pinned event) refuses
     **every** path — Advance, drag, bulk, automatic — until attendance exists;
     a stage naming none takes the coordinator's word on every path. It also
     stopped attendance from **before the application was opened** counting,
     which closed the case where the kiosk sign-in that created a prospect
     satisfied a later "attend a business meeting" stage.
   - [#2613](https://github.com/thegspiro/the-logbook/pull/2613) (second
     commit) moved the trigger from **check-in** to **finalize**. The applicant
     advances when the organizer runs End Event, records an actual end time or
     presses Finalize Attendance; an event nobody finalizes settles after
     `PIPELINE_ATTENDANCE_SETTLE_DAYS` (default 7), picked up by a new nightly
     `prospect_attendance_advance` task at 05:30.

   **Operators should tell event organizers to finalize** — it is now what
   moves applicants along — and look at who is parked on an event-naming
   meeting stage having attended unrecorded, because those applicants will now
   be refused on Advance. Both UPGRADING entries from the window are in place
   and cross-reference each other as superseded.

2. **Every member gets a new sidebar item, and five seeded positions a new
   permission.** Suggestion boxes ([#2649](https://github.com/thegspiro/the-logbook/pull/2649))
   add **Suggestions** for everyone and **Suggestion Boxes** under
   Administration → Forms & Comms. Migration `394600cbfae2` writes
   `suggestions.manage` onto the system Fire Chief, Deputy Chief, Assistant
   Chief, President and Communications Officer rows. **That grant configures
   boxes and reads nothing** — only a box's named reviewers read it — so it
   discloses no submission. It does make the Administration section visible to
   its holder, which for those five changes nothing.

3. **Every inventory item reads "Needs a label" on the first load after
   upgrading** ([#2650](https://github.com/thegspiro/the-logbook/pull/2650)).
   The new `label_printed_at` column has no backfill because no history
   existed. A department whose stock is already labelled can catch the records
   up without printing; the recipe is in [`UPGRADING.md`](./UPGRADING.md).

4. **A form with a conditional required question can be submitted again**
   ([#2647](https://github.com/thegspiro/the-logbook/pull/2647)). The server
   enforced **required** on fields the renderer had hidden, so "Previous EMT
   experience" (shown only for EMT) made the form unsubmittable for everyone
   else, surfacing as **LB-API-400**. Hidden answers are now also discarded at
   submission. Older submissions may hold such answers; an optional,
   dry-run-by-default script clears them
   ([#2648](https://github.com/thegspiro/the-logbook/pull/2648)).

5. **The installed app's icon is the department's logo**
   ([#2636](https://github.com/thegspiro/the-logbook/pull/2636)), rendered by
   the server into every manifest and iOS geometry. **Already-installed apps
   keep the old icon** — neither platform revisits it — and an installation
   whose reverse proxy serves the frontend's built files off disk keeps serving
   the stock icon, because the branded ones do not exist on disk.

### Release map

| Theme                   | What changed                                                                                                                                                                                                                   | Where it is documented                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Membership pipeline** | Meeting gate decided by the stage, not the caller; attendance must be settled (finalized, or 7 days old); pre-application attendance ignored; stats header counts through the list's filters and refreshes with every mutation | [`UPGRADING.md`](./UPGRADING.md), [`PROSPECTIVE_MEMBERS_MODULE.md`](./PROSPECTIVE_MEMBERS_MODULE.md), [`training/15-prospective-members.md`](./training/15-prospective-members.md)     |
| **Communications**      | Suggestion boxes: per-box reviewers, three anonymity modes, follow-up threads with an anonymous key, single-suggestion forwarding                                                                                              | [`COMMUNICATIONS_MODULE.md`](./COMMUNICATIONS_MODULE.md#suggestion-boxes-2026-09-23), [`training/07-documents-forms.md`](./training/07-documents-forms.md#suggestion-boxes-2026-09-23) |
| **Inventory**           | Select all matching (≤500) and print by filter; a scope picker on the bare print page; label-printed tracking that clears itself when the printed value changes                                                                | [`training/05-inventory.md`](./training/05-inventory.md#knowing-which-items-still-need-a-label), [`LABEL_PRINTING_MODULE.md`](./LABEL_PRINTING_MODULE.md)                              |
| **Forms**               | Conditional visibility enforced server-side: hidden fields are not required and their answers are not stored; a cleanup script for older rows                                                                                  | [`FORMS_MODULE.md`](./FORMS_MODULE.md), [`backend/scripts/README.md`](../backend/scripts/README.md#clear_hidden_form_answerspy)                                                        |
| **PWA**                 | Department logo rendered into the app icons and iOS launch images; maskable icon split out; `?v=2` cache-busting                                                                                                               | [`UPGRADING.md`](./UPGRADING.md), [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md), [`training/10-mobile-pwa.md`](./training/10-mobile-pwa.md)                                         |
| **Medical screening**   | The Add Record dialog now states that its records attach to nobody (MS-13, flagged; interim notice only)                                                                                                                       | [`security-review/MS-09-medical-screening.md`](./security-review/MS-09-medical-screening.md), [`training/13-medical-screening.md`](./training/13-medical-screening.md)                 |
| **Dependencies**        | vitest and `@vitest/coverage-v8` to 5.0.1 together; npm and Python minor/patch groups; **PyMySQL held at 1.2.0** and **jsdom held at 30.0.1**, each with a Dependabot ignore                                                   | [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md#dependencies)                                                                                                                          |
| **Security review**     | Pass 6 covered Features 07 – 17 (eleven features); one finding (MS-13), zero fixes elsewhere. The rotation stopped opening a docs-only PR per merge                                                                            | [`security-review/PROGRESS.md`](./security-review/PROGRESS.md)                                                                                                                         |
| **Screenshot tooling**  | The seeder now carries an applicant through a **losing** membership vote, unblocking the Not Elected shot                                                                                                                      | [`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md)                                                                                                                 |

### New URLs

| Route                              | Page                      | Gate                 | Registered in                                                             |
| ---------------------------------- | ------------------------- | -------------------- | ------------------------------------------------------------------------- |
| `/suggestions`                     | Suggestions               | Signed in            | `APPLICATION_PAGES.md`, `testingRegistry.ts`, `mobile-route-inventory.ts` |
| `/communications/suggestion-boxes` | Suggestion Box Management | `suggestions.manage` | same three                                                                |

**`/suggestions` shows a Review tab only to reviewers**, which the backend
decides per box (`GET /suggestions/review/summary`) rather than a permission.
The page reads `?tab=` and `?id=`, which is what the notification emails link
to. `/inventory/print-labels` is not new, but it now accepts `?all=1` plus the
items-list filters as well as `?ids=`, and renders a picker when given neither.

**Nothing was retired.** No bookmark breaks.

### Alembic route (upgrade data path)

| Revision       | What it does                                                                                                                                             | Reversible                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `80e2004cd691` | `suggestion_boxes`, `suggestion_box_reviewers`, `suggestions`, `suggestion_attachments`, `suggestion_messages`; each guarded on absence                  | Yes — **destructively**: drops every suggestion, attachment record and message. Files under `uploads/suggestions` stay on disk |
| `394600cbfae2` | Adds `suggestions.manage` to `is_system` positions `fire_chief`, `deputy_chief`, `assistant_chief`, `president`, `communications_officer` where absent   | Yes — removes it from the same rows, including a grant a department added by hand after upgrading                              |
| `9cb132ad83dc` | `suggestion_forwards`                                                                                                                                    | Yes — drops every forward; suggestions intact                                                                                  |
| `5a70c5dcd138` | `inventory_items.label_printed_at` (tz-aware), `label_printed_by` (FK `users.id` ON DELETE SET NULL, nullable) and `ix_inventory_items_label_printed_at` | Yes — loses only the print history                                                                                             |

**Why the grant migration may run unconditionally.**
[`docs/rules/migrations.md`](./rules/migrations.md) requires positive evidence
before _adding_ a grant to a stored position, because an unconditional add
overrides a department that removed it on purpose. That cannot apply here: the
permission did not exist before this revision, so no position editor could ever
have offered it and its absence says nothing about any department's choice. The
migration still touches only `is_system` rows and freezes its slug list rather
than importing the registry (pitfall #23).

**Why the grant migration was a separate child revision, and the forwards table
too.** Both follow the rule that a published revision is frozen: the forwarding
feature landed as a second commit on the same PR, and adding its table to the
already-written `80e2004cd691` would have edited a revision a reviewer had
already read.

**No backfill for `label_printed_at`**, deliberately: nothing recorded which
items were labelled, and inferring it would mark items as done that are not.

`DATABASE_SCHEMA.md` was regenerated in both PRs that change models.

### Permission and enforcement movements

#### Granted

- **`suggestions.manage`** (new category `suggestions`) — to the three chief
  ranks and President and Communications Officer, seeded and back-filled.
  Added to `ADMIN_NAVIGATION_PERMISSIONS`, so its holder sees the
  Administration section.

#### Enforcement moved onto more paths

- **Meeting-stage attendance gate** — from "automated advances only" (09-13) to
  "automated and bulk" (09-15, #2595) to "every path, when the stage names an
  event" (09-16, #2613). The only exemption left is a stage that names no
  event, which can never be graded.
- **Conditional visibility** — from renderer-only to renderer **and** server
  (`FormsService._is_field_visible`, mirroring `isFieldVisible` in
  `PublicFormPage.tsx` and `FormRenderer.tsx`). This _relaxes_ the required
  check for hidden fields and _tightens_ what is stored. An unrecognised
  operator counts as visible, so a malformed rule fails closed.

#### Deliberately not gated

- **The suggestions router ignores the `communications` module flag.**
  `communications` defaults off and none of its screens honour the flag, so
  gating only this would hide suggestion boxes on almost every installation.
  Recorded in `DELIBERATELY_UNGATED` in `tests/test_module_api_gating.py`.
- **Reading a suggestion is not a permission.** It is decided per box and per
  forward in `SuggestionService`, at request time, so a reviewer position that
  changes hands changes who can read immediately.

#### Tenancy notes (pitfall #14)

- `GET /pipelines/{id}/stats` gained a client-supplied `event_id`, confirmed
  in-org through `_require_org_event` before it is counted through — the same
  check `GET /prospects` makes.
- `POST /inventory/labels/mark-printed` resolves ids org-scoped and silently
  skips ids from other organizations and items with no printable value.
- Every suggestion by-id read resolves through the caller's organization and
  then through reviewer, forward or authorship membership; the admin endpoints
  take `suggestions.manage` **and** org-scope the box.

### Data-integrity notes

- **Anonymity is structural, and has accepted limits.** An anonymous
  submission stores no author, writes no audit entry, pins its timestamps (and
  the attachment file's mtime) to noon UTC of the day, and re-encodes
  screenshots to WebP, which drops EXIF; the follow-up key is stored only as a
  SHA-256 digest. What it does **not** defeat — timing correlation by someone
  with server access (access log, the reviewer email's send time, session
  activity), an unrecoverable lost key, visible screenshot content, and exact
  file `ctime` — is recorded as **Accepted** in
  [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) under "Suggestion Boxes —
  What Anonymity Does and Does Not Cover".
- **The label mark clears itself.** A `before_update` listener on
  `InventoryItem` nulls both columns when the printed value changes — barcode,
  else asset tag, else serial, via the shared `printable_label_value` — which
  covers the edit form, CSV import, variant generation and the PDF's barcode
  auto-fill. Raw Core `update()` statements bypass it; none writes these
  columns today.
- **Hidden-answer cleanup errs toward keeping data.** The script removes an
  answer only when the rule hides it **and** neither the field nor its
  controller was edited after the submission; there is no rule history, so
  anything newer is listed for a person. `--apply` requires a backup file
  written owner-only and never overwritten; `--restore` will not overwrite an
  answer re-added since; audit entries name questions, never answers.
- **The pipeline header and list cannot drift.** `refreshPipelineView` is the
  only mutation refresh path (guarded by `pipelineRefreshIntegrity.test.ts`),
  the stats count through the list's `search` and `event_id` via one shared
  predicate builder, and each of the six list fetches carries a sequence number
  so a stale response is dropped whole.

### Security review

Pass 6 advanced from Feature 07 (Users & organizations) to Feature 17 (Training
core) — eleven features. Ten were zero-delta re-verifications with nothing
fixed or flagged. One produced a finding:

- **MS-13 (MED, Feature 09 Medical screening) — flagged, interim notice
  applied.** `ScreeningRecordForm`'s create dialog has no control for `user_id`
  or `prospect_id`, so every record it creates belongs to nobody and counts
  toward nobody's compliance. Wiring a picker is feature work (a new data
  source and an exactly-one-of decision), so the pass added an amber notice to
  the create dialog instead and pinned it with
  `ScreeningRecordForm.linkageNotice.test.tsx`. The underlying gap is the
  existing
  [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md#medical-screening--no-per-member-compliance-screen-2026-08-08)
  entry, filed 2026-08-08 (the Add Record half was resolved 2026-10-05).

**The rotation's bookkeeping changed** ([#2644](https://github.com/thegspiro/the-logbook/pull/2644)).
It had been opening a docs-only PR to record each feature PR's merge — eighteen
in twelve days — and each became an event the next iteration recorded, which is
how #2630 → #2632 → #2634 chained. Step 0 now reads open
`claude/security-review-*` PRs from GitHub and treats the tracker's Open PR row
as narrative, so the record rides along with the next feature PR. The same
collision the changelog freeze exists to avoid had been reproduced in
`PROGRESS.md`.

### Dependencies

- **vitest and `@vitest/coverage-v8` moved to 5.0.1 together**
  ([#2642](https://github.com/thegspiro/the-logbook/pull/2642)). Dependabot
  opened them as separate PRs and each fails alone; `main` was already skewed
  with `@vitest/ui` 5 on vitest 4.
- **PyMySQL held at 1.2.0.** 1.2.1+ replaced `escape_bytes_prefixed` with a
  string sentinel that aiomysql 0.3.2 (latest) still calls, so every BLOB write
  raised. The advisory it fixes (GHSA-x4f8-9hx9-hpp9) needs a CJK connection
  charset; this app uses `utf8mb4`. Owner decision recorded as pending in
  `KNOWN_LIMITATIONS.md`.
- **jsdom held at 30.0.1.** jsdom 30.1 breaks vitest's `URL.createObjectURL`
  shim. Test environment only.
- Dependabot minor/patch groups (#2641, #2645, #2646).

`CLAUDE.md`'s tech-stack versions and the wiki's two stack tables were brought
up to the manifest in this pass: Vitest 5.0, Vite 8.3, React 19.3,
react-router 8.4, Zod 4.6, react-hook-form 7.88, Axios 1.20. All but Vitest
predate the window; they were stale, and were found while checking it.

### Documentation and media disposition

#### What the window's own PRs already documented

Three substantive PRs carried their own operator notes, and they were
accurate: #2595 and #2613 in `UPGRADING.md` (with the older entry marked
superseded), #2613 in `.env.example.full`, #2636 in `UPGRADING.md` and
`KNOWN_LIMITATIONS.md`, #2649 in `APPLICATION_PAGES.md` and
`KNOWN_LIMITATIONS.md`, #2648 in `backend/scripts/README.md`. **Nothing else
was touched by them**, and six reference or training documents described
pre-window behaviour.

#### Corrected in this pass

| Document                                                                                                                                                                                                                                                  | What was stale or wrong                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`training/15-prospective-members.md`](./training/15-prospective-members.md)                                                                                                                                                                              | Said a meeting stage advances "when they are checked in", that **Advance** "is not gated on the attendance record", and to "use Advance" when attendance was unrecorded — **all three false** after #2613. Rewritten; stats-header note added |
| [`PROSPECTIVE_MEMBERS_MODULE.md`](./PROSPECTIVE_MEMBERS_MODULE.md)                                                                                                                                                                                        | Gate table read "meeting — No, automatic advances only". **The stats endpoint path was wrong** (`/prospective-members/stats` does not exist; it is `/pipelines/{id}/stats`) — pre-existing, fixed here                                        |
| [`training/05-inventory.md`](./training/05-inventory.md)                                                                                                                                                                                                  | Label printing described hand-ticked selection only. **Step 5 listed a Send to Printer button the inventory page does not have** — direct printing exists only on the shared label pages. Pre-existing; corrected with a dated note           |
| [`wiki/Module-Inventory.md`](../wiki/Module-Inventory.md)                                                                                                                                                                                                 | `/inventory/print-labels` gated "Authenticated"; it is `inventory.manage`. Pre-existing                                                                                                                                                       |
| [`training/04-events-meetings.md`](./training/04-events-meetings.md)                                                                                                                                                                                      | Finalizing described without its new consequence for applicants                                                                                                                                                                               |
| [`training/10-mobile-pwa.md`](./training/10-mobile-pwa.md)                                                                                                                                                                                                | Claimed "the Logbook icon (or your department's logo)" before the logo was ever used                                                                                                                                                          |
| [`training/07-documents-forms.md`](./training/07-documents-forms.md)                                                                                                                                                                                      | Nothing on suggestion boxes; conditional visibility described as screen-only                                                                                                                                                                  |
| [`training/13-medical-screening.md`](./training/13-medical-screening.md)                                                                                                                                                                                  | No mention of the new notice                                                                                                                                                                                                                  |
| [`training/16-integrations.md`](./training/16-integrations.md)                                                                                                                                                                                            | The legacy `action` + `schedule_meeting` Cal.com fix                                                                                                                                                                                          |
| [`COMMUNICATIONS_MODULE.md`](./COMMUNICATIONS_MODULE.md), [`FORMS_MODULE.md`](./FORMS_MODULE.md), [`LABEL_PRINTING_MODULE.md`](./LABEL_PRINTING_MODULE.md), [`ROLE_SYSTEM_README.md`](../ROLE_SYSTEM_README.md), wiki Communications / Events / Inventory | Engineering sections for each feature                                                                                                                                                                                                         |
| [`UPGRADING.md`](./UPGRADING.md)                                                                                                                                                                                                                          | Three entries added: label tracking, suggestion boxes and the grant, hidden form answers                                                                                                                                                      |

**`CHANGELOG.md` was not edited.** It has been closed to per-change entries
since 2026-09-08 (see `CLAUDE.md`); this audit, the PRs and `UPGRADING.md`
carry the record instead.

#### Screenshots

Full per-image queue in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md);
counts regenerated into
[`training/SCREENSHOT_STATUS.md`](./training/SCREENSHOT_STATUS.md)
(**600 captured, 0 remaining** after the whole backlog was worked on 2026-09-24 — see that file's "Remaining placeholders" section; the Microsoft 365 Test Connection result is simulated and captioned as such. At the close of this window's own pass it stood at 545 captured, 45 remaining — this pass queued eleven, and all eleven were captured on 2026-09-24. The thirteen stale REPLACE images were re-shot the same day, and the carried Meeting stage editor was added as `15-15`. The installed-app icon is an illustration: the icons are the server's real output, and the home screens around them are drawn, because no device or emulator was available).

| Image area                                                    | Disposition | Guide |
| ------------------------------------------------------------- | ----------- | ----- |
| Sidebar **Suggestions** item + **Submit** tab                 | **NEW**     | 20    |
| **New suggestion box** dialog                                 | **NEW**     | 07    |
| **Submit anonymously** with the screenshot warning            | **NEW**     | 07    |
| **Save your follow-up key** receipt (demo key only)           | **NEW**     | 07    |
| **Review** tab with a submission open                         | **NEW**     | 07    |
| Items list **Needs a Label** + **All N matching selected**    | **NEW**     | 05    |
| Label page **Print barcode labels** picker                    | **NEW**     | 05    |
| "Did the labels print correctly?" prompt                      | **NEW**     | 05    |
| Home screen with the department-logo icon                     | **NEW**     | 10    |
| **Add Record** with the MS-13 notice                          | **NEW**     | 13    |
| Applicant drawer on an event-naming Meeting stage             | **NEW**     | 20    |
| `00-15-sidebar-member`, `00-16-sidebar-admin`                 | **REPLACE** | 00    |
| `05-47-items-filter-bar` (and 05-01/02/03 incidentally)       | **REPLACE** | 05    |
| `05-06`, `05-56`, `05-61`, `05-67`, `10-16` (Basic Info card) | **REPLACE** | 05/10 |
| `15-05`, `15-14` (drawer)                                     | **CHECK**   | 15    |
| `15-12-pipeline-stats`                                        | NO CHANGE   | 15    |

**Suggestion boxes are seeded** _(2026-09-24)_: three boxes and four
submissions covering every state the guides describe, reviewed by the
Secretary position (`okittredge`, the manifest's `auth: "secretary"` account).
All five suggestion-box shots are captured (`07-14` – `07-17`, `20-15`); none
of them writes anything, and the follow-up-key receipt shows a route-mocked
`DEMO-KEY-…` rather than a real credential. **The
home-screen icon cannot be produced by the capture harness** — it needs a real
or emulated device install.

#### YouTube script beats

Determinations were made by **reading the script files**. Full disposition in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

- **04 — Fire Chief.** Two **Wrong**: the daily checklist's "the system
  automatically updates participation records" now needs "then finalize", and
  the Convert-gate `[SCREEN]` direction asked for **Convert** beside a Not
  Elected panel, which the 09-22 screenshot capture proved can never share a
  frame. One **Incomplete**: a new meeting-stage beat. Lead any re-record with
  "tell your organizers to finalize".
- **06 — Member.** Mobile Access gains the logo icon and the reinstall
  caveat.
- **07 — Secretary.** Forms beat gains the conditional-required fix.
- **03 — IT Manager.** Addition: the branded icon and the reverse-proxy
  requirement.
- **08 — Shorts.** Three new: 8AR (suggestion box), 8AS (label a storeroom),
  8AT (applicants move at finalize).
- **07 — Secretary** gained **Chapter 7: Suggestion Boxes** (17:35 – 20:35),
  added 2026-09-24 at the owner's request: who can set boxes up (not the
  Secretary by default), the three anonymity modes, the member's view and
  follow-up key, and reviewing and forwarding.

### Verification

```bash
cd backend && python scripts/validate_migrations.py   # head = 5a70c5dcd138
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
cd backend && python scripts/generate_schema_docs.py  # DATABASE_SCHEMA.md must not change
```

Run against `da7d28479` plus this pass's documentation while writing this
audit: migration head `5a70c5dcd138`, single head; 230 routes with 0 errors and
0 warnings (17 redirects skipped); 1,498 documented route handlers with 0 errors
and 0 warnings; 362 Markdown files with 0 broken links, anchors included; 533
screenshots captured with 56 remaining after this pass's eleven placeholders (545 and 45 once all eleven were captured and the carried Meeting stage editor added on 2026-09-24);
`DATABASE_SCHEMA.md` regenerated with no diff; the 141 documentation-tooling
tests under `scripts/` pass.

## Change audit: September 12 – 15, 2026

Net changes merged to `main` in the three days ending 2026-09-15, picking up
where the [September 6 – 12 audit](#change-audit-september-6--12-2026)
stopped at `ae789019d` (2026-09-12 01:47 UTC).

**46 pull requests (#2493 – #2594).** One schema migration, head
`6ab7d903fae5`. **No route was added and none retired** — the second window
running with no bookmark to repair, and this time nothing new to bookmark
either. Ninety-three of the window's 128 commits are security-review passes.

The window has no single theme. It is a **correction window**: twelve of its
seventeen substantive changes fix a rule that was written down somewhere and
enforced nowhere, or enforced on one path out of two. The membership pipeline
accounts for five of them on its own.

**Four changes from the window's first hours are already documented and are not
repeated here.** The previous audit was written against `ae789019d` and the
commits immediately after it carried their own documentation: the skills-test
scorecard guard and the setup-wizard singleton are both in
[`UPGRADING.md`](./UPGRADING.md), and the call-tracking radio group has its own
disposition in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md). This
audit covers what was left.

**Four changes alter what a member or an operator sees without anyone asking
for it**, and they are the ones to read before upgrading: the Open Shifts
board gets shorter, a completed repair stops moving an inspection deadline, an
email configuration that could never send is now refused at the point of
saving, and a click in the gutter around a dialog stops throwing the form
away.

Companion operator lesson: the **September 12–15** section of
[`training/20-september-2026-release-changes.md`](./training/20-september-2026-release-changes.md).
Wiki handoff:
[`Recent-Changes-2026-09`](../wiki/Recent-Changes-2026-09.md#recent-changes-september-12--15-2026).
Media disposition — which screenshots must be created, which replaced — is in
[Documentation and media disposition](#documentation-and-media-disposition)
below.

### Read this first

Four things in this window change what somebody sees or may do, rather than
only what the code does. A fifth — the membership-vote gate reaching the
**Convert** button — extends an entry
[`UPGRADING.md`](./UPGRADING.md#changes-you-will-notice-after-an-upgrade)
already carries, and is described under
[Permission and enforcement movements](#permission-and-enforcement-movements).

1. **The Open Shifts board now lists only shifts with a seat the member is
   cleared for.** Two checks were answering different questions and never
   intersecting them: `filter_shifts_with_open_positions` asks whether the
   _shift_ still has an unfilled required seat, and the eligibility filter asks
   whether the _member_ is cleared for any position on it. A shift with an
   empty driver's seat and a full firefighter seat satisfied both for a
   firefighter, who was then refused at signup with **"Position was filled
   after this request was submitted"** — a message about a race, for a seat
   that had been taken for days. `GET /shifts/open` now serves members
   `get_claimable_shifts`, which intersects the two. **A holder of
   `scheduling.manage` keeps the department-wide staffing-gap view**, because
   that tab is also how a scheduling admin finds gaps.
   `filter_shifts_with_open_positions` itself is untouched — the administration
   hub's short-staffed metric, the MCP tool and outreach sheets all depend on
   its required-only meaning.

2. **A completed maintenance record only moves the inspection clock when it is
   an inspection.** [#2479](https://github.com/thegspiro/the-logbook/pull/2479)
   gated `create_maintenance_record` and stopped there. The commoner route was
   left open: work is usually scheduled and marked complete later, which is a
   `PATCH` through `update_maintenance_record`, and that still wrote
   `item.last_inspection_date` for any completed record. **A coat inspected in
   April and repaired in August had its annual NFPA 1851 deadline slide to the
   following August**, and the department read as compliant four months longer
   than it was. Nothing raised and nothing logged; the only sign was two dates
   on the item page disagreeing. **This is fix-forward** — rows already
   advanced keep the date they hold, so a department that has been completing
   repairs against gear on an inspection interval should spot-check the
   inspection dates on that gear.

3. **An email configuration that is enabled and cannot send is now refused
   when you save it.** `missing_for_enabled` had branches for the two App
   Password presets and for self-hosted SMTP only, so an enabled `cloudflare`
   section with no account or token, and an enabled `other` section with
   nothing in it at all, both saved green. Neither can send. **The hollow
   section was also actively harmful**: `_get_smtp_config` returns early on
   `enabled`, so it shadowed whatever deployment-wide `SMTP_*` settings the
   installation had, and a department that was sending through those stopped.
   Both are now named on the write, and the settings screen says so inline
   rather than leaving Save to explain it.

4. **A click outside a dialog no longer closes it.** `Modal` defaults
   `closeOnClickOutside` to `false`, which covers its 99 call sites, and 27
   hand-rolled overlays lost their backdrop handler. The reported case was the
   inventory Add Item dialog, where a name, category, room, storage area and a
   set of sizes and garment style axes are picked before the backend fans them
   out into one item per combination — a single click in the gutter threw all
   of it away and reopened blank. Escape and the header X still close
   everything; **five surfaces keep click-away** because they hold no user
   input (the command palette, the two equipment-check jump sheets, the
   checklist picker and the publish-blocker sheet), and menus and popovers are
   untouched. Recorded as
   [Pitfall #31](../CLAUDE.md#31-a-dialog-does-not-close-on-a-click-outside-it-2026-09-13)
   with `dialogDismissIntegrity.test.ts` behind it.

### Release map

| Theme                   | What changed                                                                                                                                                                                                                                                          | Where it is documented                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Membership pipeline** | Election Vote stage gates on the ballot on both **Advance** and **Convert**; a Meeting stage naming no event auto-advances on nothing; a form submission advances only the stage it belongs to; Election Vote and Manual Approval are creatable from the stage picker | [`UPGRADING.md`](./UPGRADING.md), [`training/15-prospective-members.md`](./training/15-prospective-members.md) |
| **Scheduling**          | Open Shifts filtered to claimable seats; `scheduling.manage` admitted to the calendar, summary, time-off and swap reads (seven of the fourteen widenings)                                                                                                             | [`SCHEDULING_MODULE.md`](./SCHEDULING_MODULE.md)                                                               |
| **Email**               | Enabled-but-unsendable sections refused on write; Cloudflare batch sending; twelve SMTP quick-fill presets; a null `email_service` section no longer breaks sending                                                                                                   | [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)                                                                   |
| **Inventory**           | Inspection dates moved only by inspections; items-list top-up guards keyed to the filter set                                                                                                                                                                          | [Read this first](#read-this-first)                                                                            |
| **Frontend-wide**       | Dialogs no longer dismiss on an outside click                                                                                                                                                                                                                         | [`CLAUDE.md` pitfall #31](../CLAUDE.md)                                                                        |
| **Permissions**         | The `manage` grant admitted to fourteen reads whose bodies branch on it                                                                                                                                                                                               | [Permission and enforcement movements](#permission-and-enforcement-movements)                                  |
| **First-run setup**     | `onboarding_status` constrained to one row; duplicate rows de-duplicated on upgrade                                                                                                                                                                                   | [Alembic route](#alembic-route-upgrade-data-path)                                                              |
| **Security review**     | 93 commits; pass 5 completed its lap at features 00–22 and the rotation reset; pass 6 has reached Feature 06 (Elections & ballots)                                                                                                                                    | [`security-review/PROGRESS.md`](./security-review/PROGRESS.md)                                                 |
| **Build**               | The redundant root `vite` override dropped, with `scripts/check_npm_overrides.py` guarding the drift it caused                                                                                                                                                        | [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md)                                                               |

### New URLs

**None.** No `<Route>` was added, none retired, and neither
`APPLICATION_PAGES.md`, `testingRegistry.ts` nor `e2e/mobile-route-inventory.ts`
changed. Every behaviour change in this window happens at an address that
already existed.

### Alembic route (upgrade data path)

One migration, and it is the only schema change in the window.

| Revision       | What it does                                                                        | Reversible                                    |
| -------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| `6ab7d903fae5` | Enforces the `onboarding_status` singleton and de-duplicates any rows already there | Yes — the downgrade drops the constraint only |

**What it fixes.** Concurrent first-run requests could each insert an
`onboarding_status` row. Once two existed, `scalar_one_or_none()` raised
`MultipleResultsFound` on every `GET /onboarding/status`, which turned two
harmless rows into a permanent 500 and left setup with no way forward. The
readers were made duplicate-safe in the same change — they take `.first()`,
which answers the only question being asked — so an installation that is
_already_ duplicated recovers on the code upgrade rather than needing the
migration to land first.

**The downgrade does not restore duplicates**, which is correct: it removes the
constraint and leaves one row. There is nothing a second row was carrying that
the first does not.

### Permission and enforcement movements

**Nothing is revoked this window.** Fourteen reads were widened, all the same
shape, and one enforcement gate reached a second path.

#### Fourteen reads now admit the `manage` grant

`permission_matches` is literal: `X.manage` does not imply `X.view`. A route
gated on `X.view` alone whose body then branches on `X.manage` to widen scope
refuses the manage-only holder before the branch can run.

| Route(s)                                                                                                                   | Was gated on               | Reaches a default install?            |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------- |
| `GET /prospects/{id}/events`                                                                                               | `prospective_members.view` | **Yes**                               |
| Elections' candidate list, events' attendee list, finance's expense-report list and detail, member dues, dues payments (6) | `X.view`                   | No — needs a hand-configured position |
| `GET /calendar/week`, `/calendar/month`, `/summary` (3)                                                                    | `scheduling.view`          | No                                    |
| `GET /time-off`, `GET /time-off/{id}` (2)                                                                                  | `scheduling.view`          | No                                    |
| `GET /swap-requests`, `GET /swap-requests/{id}` (2)                                                                        | `scheduling.swap`          | No                                    |

**The one that reaches a default install is `GET /prospects/{id}/events`.**
President, secretary, vice president and membership coordinator are all seeded
`prospective_members.manage` _without_ `.view`. They could link an event to a
prospect — `POST` is gated on `manage` — and not read the links back.
`LinkedEventsSection` catches the rejection into `setLinkedEvents([])`, so the
drawer showed **"no linked events"** rather than an error: an empty set
rendered as a passing one, and the links they added kept vanishing.

**The swap pair sat on a different base grant, and that is the point.** Swaps
are gated on `scheduling.swap`, which every line member holds, rather than on
`scheduling.view`. A position granted `manage` alone held neither, so the defect
is identical while the gate it hides behind is not. **The four swap and time-off
_writes_ stay on `scheduling.swap` alone**, checked rather than assumed: not one
of them branches on `manage`, because proposing and cancelling a request are the
member's own actions. The sweep's test pins that half too, so the widening
cannot spread along the resource by habit.

**The time-off pair is a reversal, in the same window.** `d1070ecc2` left it
narrow on the reasoning that the list carries members' stated reasons and so is
not a projection of anything `manage` already reads. `241bdb3cb` reversed that
five hours later: the reasoning is true of the data and irrelevant to the gate,
because both handlers **already branch on `scheduling.manage`** to hand a
reviewer the department-wide view. A `manage`-only position is exactly who
`/time-off/{id}/review` exists for, and could reach neither the queue that finds
a request to review nor a request it was sent a link to.

**No handler body changed and no read gains a path it did not have.** Each
still scopes on `current_user.organization_id`, and the finance and dues
handlers still narrow to the caller for anyone without `finance.manage`
(pitfall #14).

`tests/test_permission_gate_branch_sweep.py` turns the one-off scan into a
standing check: a gate must admit every grant its own body branches on, and a
`.view` gate must admit the `.manage` grant seeded beside it, computed from
`DEFAULT_POSITIONS` and `OPERATIONAL_RANKS` rather than hardcoded.

#### The membership-vote gate reached the Convert button (MP-30)

The election-vote completion gate added by ordinary feature work ran inside
`complete_step` only. It never ran on `transfer_to_membership` —
`POST /prospects/{id}/transfer` — **which is the documented, primary way a
coordinator finishes a pipeline's final stage.** `skip_current_step`'s own
refusal message says "convert or reject instead", and the frontend's **Convert**
button, shown whenever an applicant is on the last stage, calls transfer
directly and never `complete_step`. So an applicant the department's own
election had rejected could be converted to a full member with the gate never
consulted.

`_election_block_reason` is now checked first thing in `_do_transfer`, returning
the same refusal shape that method already uses for every other business rule.
**This extends the 2026-09-13 `UPGRADING.md` entry**, which describes the gate
as refusing **Advance**: it refuses Convert too.

### Documentation and media disposition

#### Training guides

Three of the window's commits updated
[`training/15-prospective-members.md`](./training/15-prospective-members.md) as
they landed, which is why the pipeline material is in good shape. Nothing else
did, and **five guides described pre-window behaviour**. All five are corrected
in the same pass as this audit:

| Guide                                                               | What was stale                                                                                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`00-getting-started.md`](./training/00-getting-started.md)         | No statement of the dialog convention at all. It is app-wide and affects every member, so it belongs in **Understanding the Interface**, not only in a release lesson                         |
| [`01-membership.md`](./training/01-membership.md)                   | "Moving a ranked member into the administrative class clears the rank" was true of the profile route and **not reachable** on the membership-type route for any department with a tier ladder |
| [`03-scheduling.md`](./training/03-scheduling.md)                   | Open Shifts described as every shift needing coverage; the time-off and swap queues said nothing about who can reach them                                                                     |
| [`05-inventory.md`](./training/05-inventory.md)                     | Maintenance Tracking never mentioned that completing a record moved the inspection clock, so the fix had nothing to correct and the warning nowhere to go                                     |
| [`08-admin-reports.md`](./training/08-admin-reports.md)             | Email configuration carried no account of what an enabled section does to deployment-wide SMTP — the whole reason a half-filled one is dangerous                                              |
| [`15-prospective-members.md`](./training/15-prospective-members.md) | The ballot gate was documented for **Advance** only. MP-30 landed a day after the commit that wrote that paragraph, and did not touch the guide                                               |

**The 15-prospective-members gap is the instructive one.** Its ballot-gate note
was written by the commit that added the gate, and was accurate the day it was
written. A separate commit extended the gate to **Convert** the following day
and updated `UPGRADING.md` but not the guide — so the guide told a coordinator
that the button they are actually instructed to use was ungated. A per-commit
documentation habit does not survive a follow-up commit; that is what the audit
pass is for.

#### Screenshots

Full per-image queue in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md);
coverage counts are regenerated into
[`training/SCREENSHOT_STATUS.md`](./training/SCREENSHOT_STATUS.md) by
`scripts/screenshots/status_report.py` (**533 captured, 45 remaining** — this
pass queued six placeholders and three of them have since been shot).

**This window adds a small queue, and none of it is urgent** — no screen moved
and no control was added to a page that had none. What changed is what a
screen _contains_ under the same address.

| Image area                               | Disposition    | Why                                                                                                                                                                                                    |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scheduling → **Open Shifts** board       | **REPLACE**    | The member's board is now filtered to claimable seats; an old capture over-states what is offered                                                                                                      |
| Shift signup picker → position dropdown  | **REPLACE**    | Offers only seats the server will grant, and says "every seat you are cleared for is filled" instead of "not eligible"                                                                                 |
| Settings → **Email**, provider list      | **REPLACE** ✅ | Twelve SMTP quick-fill presets, and two platform buttons renamed — **Self-Hosted SMTP** → **SMTP (any provider)**, **Other** → **Not configured**. Shot 09-16 as `20-11`; one image serves both guides |
| Settings → **Email**, inline validation  | **NEW**        | The refusal for an enabled-but-empty Cloudflare or Other section is new, and is what an operator will hit after upgrading                                                                              |
| Stage builder → **Meeting** config       | **REPLACE**    | Carries the Auto-Link Event Type warning beside the auto-advance checkbox                                                                                                                              |
| Stage builder → **Election Vote** config | **NEW** ✅     | The type is creatable from the picker for the first time. Shot 09-16 as `20-12`                                                                                                                        |
| Inventory item → maintenance history     | **NO CHANGE**  | The rule changed, the screen did not                                                                                                                                                                   |

**Do not re-shoot for the dialog change.** A dialog that no longer closes on an
outside click looks identical in a still frame. It is a video and prose matter,
not a screenshot one.

**Two rows are shot (✅), and two of the remaining ones cannot be shot from the
seeded department as it stands.** The Open Shifts pair needs two signed-in
sessions and a member whose positions are genuinely narrower than the board; the
Not Elected refusal needs a seeder that carries an applicant through a _failing_
vote, which `seed_demo_data.py` never does — `MEMBERSHIP_VOTE_TALLY` is a pass.
Both are recorded in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).

**The preset list itself is unphotographable**, which the first draft of this
disposition did not know. "Fill in settings for a known provider" is a native
`<select>`; the browser draws its open list outside the page. The shot that
exists shows a preset **applied** instead — the credential line and the filled
host, port and encryption — which is the part prose cannot carry anyway.

#### YouTube script beats

Determinations are made by **reading the script files**, not by inferring from
this change list. Full disposition in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

- **03 — IT Manager / System Admin.** The email beats are the material here:
  an enabled section that cannot send is now refused at save time, the SMTP
  preset list makes Yahoo, Fastmail, Zoho, SES, SendGrid and seven more
  reachable without reasoning about "Self-Hosted" (a button now named **SMTP (any provider)**), and a Cloudflare department
  can send ballot mail for the first time. Say plainly that a half-filled
  section used to shadow deployment-wide SMTP.
- **04 — Fire Chief / Leadership.** Four pipeline changes land on this script
  at once, and it is the script that carries the membership pipeline (fifteen
  mentions; no other script carries more than five). **Lead with the Convert
  button** — it is now gated by the ballot result, and the old take showing a
  coordinator converting an applicant straight off the final stage no longer
  reflects what happens.
- **06 — Member Guide.** The Open Shifts board is what a member notices. Frame
  it as what it is — the board stopped offering shifts the system would have
  refused.
- **08 — Quick Tips & Shorts.** Two shorts available: what the Open Shifts
  board now hides, and the SMTP preset list.
- **The inspection-clock fix has no script that owns it, and none was
  invented.** "Inspection" appears once each in 02, 04 and 07, and none of the
  three walks a maintenance record. 07 — Secretary / Administrative is where a
  gear chapter would go if one is ever added, and the forward-only caveat
  belongs in it then: **inspection dates that already slid keep the wrong
  value.** Recorded in `SCRIPT_CURRENCY.md` rather than forced into a script
  that does not cover the screen.
- **The dialog change needs no script edit, which the change list alone would
  have got wrong.** All seventeen scripts were searched for "click outside",
  "clicking outside", "click away" and "click off". **No script closes a dialog
  that way.** The only hit in the whole documentation set is the inventory
  guide describing an inline number field committing on blur, which is
  unrelated and unchanged.

**Do not script the crew Sweep, do not script qualification entry, and do not
script the equipment-check lap.** All three remain built and unreachable —
carried forward from the last three windows, unchanged.

### Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = 6ab7d903fae5
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
cd backend && python scripts/generate_schema_docs.py  # DATABASE_SCHEMA.md must not change
```

All six were run clean against `4c291192d` while writing this audit: migration
head `6ab7d903fae5`, single head, no branch points, 444 revisions; 228 routes
checked with 0 errors and 0 warnings (17 redirects skipped); 1,489 documented
route handlers with 0 errors and 0 warnings; 358 Markdown files with 0 broken
links; 533 screenshots captured with 45 remaining; `DATABASE_SCHEMA.md`
regenerated to 265 tables and 4,484 columns with no diff.

## Change audit: September 6 – 12, 2026

Net changes merged to `main` in the six days ending 2026-09-12, picking up
where the [August 31 – September 6 audit](./CHANGE_AUDIT_2026-08.md#change-audit-august-31--september-6-2026)
stopped at `14c43813` (2026-09-06 02:26 UTC).

**139 pull requests (#2251 – #2492).** Twelve schema migrations, head
`0533644945cd`. **No module changed address and no URL was retired** — the
opposite of last window, and worth saying first, because the last audit's
headline was fourteen broken addresses. Everything new here is _additive_:
seven new routes, all of them reachable from a hub card or the nav.

The window has one dominant theme and several small ones. The dominant theme
is **first-run setup**: the wizard was reordered, given a screen that says what
it will ask for before it starts asking, and taught three things a department
could previously only answer after setup was over — its rank ladder, its
membership tier ladder, and how it numbers members. The small ones are an
inventory items list that a quartermaster can now shape, a members
administration settings screen that collects five scattered settings, and a
run of ninety security-review commits across thirty-four features.

**Three changes alter what an existing department sees or may do without
anyone asking for it**, and they are the ones to read before upgrading:
the Treasurer gains two finance permissions, property-return reports stop
being readable by the whole department, and departments with a published
event-request form get a flag set to match what that form was already doing.

Companion operator lesson: the **September 6–12** section of
[`training/20-september-2026-release-changes.md`](./training/20-september-2026-release-changes.md).
Wiki handoff:
[`Recent-Changes-2026-09`](../wiki/Recent-Changes-2026-09.md#recent-changes-september-6--12-2026).
Media disposition — which screenshots must be created, which replaced — is in
[Documentation and media disposition](#documentation-and-media-disposition)
below.

### Read this first

Four things in this window change what an operator or an officer must do,
rather than only what they see:

1. **The Treasurer gains `finance.approve` and `finance.configure_approvals`.**
   No seeded position held either, and only `it_manager` could reach them —
   through its `*` wildcard, so the IT administrator rather than a finance
   role. The practical cost was a department that built an approval chain and
   then had every submitted request land in `PENDING_APPROVAL` with nobody
   able to action it. **The grant is gated**, not unconditional: it applies
   only where the position's finance grants are exactly
   `{finance.view, finance.manage}` — the shape the registry seeded. A
   deliberately curated Treasurer holding any other finance shape is left
   alone. Granting approve does **not** enable self-approval;
   `FinanceService.approve_step` still refuses it whoever holds the
   permission. See [Permission and grant
   movements](#permission-and-grant-movements).

2. **Property-return reports were readable by every holder of
   `documents.view`, and are not any more.** They were filed into the
   `Reports` system folder, which carries `organization` visibility, while
   naming a departed member, quoting the reason for the separation —
   involuntary ones included — and printing their home address. They now file
   into a leadership-only `member-separations` folder, and migration
   `b1e7c3a92f45` moves the reports already written and creates the folder for
   organizations whose system folders were already initialised. **The
   downgrade restores the disclosure along with the schema**, so it is for a
   rollback, not a decision to undo.

3. **Departments with a published public event-request form are now marked as
   accepting public event requests.** `accept_public_requests` shipped read by
   only one of the two intake paths: the API endpoint honoured it, the Forms
   path — the one the department's own "Generate Event Request Form" button
   produces — never looked at it. The same change makes the Forms path honour
   the flag, which would have silently stopped community requests arriving at
   every installation with a published form, toggle showing off and no error
   anywhere. Migration `d19b2c2ae9b9` writes down what was already true.
   **It sets the flag unconditionally for those organizations rather than only
   where the key is absent** — a stored `false` cannot have meant "do not take
   requests from my published form", because the toggle never controlled that
   form. Organizations with no such form keep the shipped default of `false`.

4. **Navigation layout is now a department setting and every member gets the
   default on the first load after upgrading.** Setup always asked whether the
   department wanted navigation across the top or down the side; the answer
   reached only the browser that gave it, because the wizard wrote
   `localStorage` and the copy sent to the server was read by nothing. The
   answer is now stored on the organization and applies to everyone. An
   existing installation has no stored layout, so **everyone — including the
   officer whose browser held `top` — gets `left`**. Nothing was migrated
   because the old value was not reachable from the server. Set it once at
   **Settings → General → Profile → Navigation Layout**. This is the one
   item in this window already carried in
   [`UPGRADING.md`](./UPGRADING.md#changes-you-will-notice-after-an-upgrade).

### Release map

| Theme                      | What moved                                                                                                                                                                                         | Where it is documented                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **First-run setup**        | Wizard reordered; `/onboarding/prepare` added; rank ladder, tier ladder and member numbering collected during setup; permission rows filtered to enabled modules; a lapsed session stays resumable | [`ONBOARDING_FLOW.md`](./ONBOARDING_FLOW.md), [`wiki/Onboarding.md`](../wiki/Onboarding.md)                                         |
| **Members administration** | New settings screen at `/members/admin/settings` with five sections, each its own route                                                                                                            | [`training/08-admin-reports.md`](./training/08-admin-reports.md), [`wiki/Administration-Pages.md`](../wiki/Administration-Pages.md) |
| **Inventory items list**   | Per-member pinning, group-by-any-attribute, size variants folded into one expandable row, multi-axis garment style, member fit preference                                                          | [`wiki/Module-Inventory.md`](../wiki/Module-Inventory.md), [`training/05-inventory.md`](./training/05-inventory.md)                 |
| **Scheduling**             | Close-out queue at `/scheduling/admin/closeout`; call entry gated on the department's call-tracking mode                                                                                           | [`SCHEDULING_MODULE.md`](./SCHEDULING_MODULE.md)                                                                                    |
| **Membership pipeline**    | A coordinator can place an applicant on a stage; stage `sort_order` made unique; switching pipelines drops the old pipeline's applicants                                                           | [`PROSPECTIVE_MEMBERS_MODULE.md`](./PROSPECTIVE_MEMBERS_MODULE.md)                                                                  |
| **Events**                 | Public request intake honours `accept_public_requests` on both paths; off-list preference values settled                                                                                           | [migrations](#alembic-route-upgrade-data-path)                                                                                      |
| **Finance**                | Treasurer gains approval permissions                                                                                                                                                               | [Permission movements](#permission-and-grant-movements)                                                                             |
| **Documents**              | Property-return reports filed leadership-only                                                                                                                                                      | [Read this first](#read-this-first)                                                                                                 |
| **Security review**        | 90 commits across 34 features; rotation reached Feature 23 (Medical supplies)                                                                                                                      | [`security-review/PROGRESS.md`](./security-review/PROGRESS.md)                                                                      |
| **Mobile accessibility**   | New `mobile-accessibility.spec.ts` and `mobile-dialogs.spec.ts`; AA contrast asserted at zero findings, AAA-only findings ratcheted per route                                                      | [`MOBILE_ACCESSIBILITY_REVIEW_2026-09-07.md`](./MOBILE_ACCESSIBILITY_REVIEW_2026-09-07.md)                                          |

### New URLs

Seven routes were added. **None replaces an address that stopped working**, so
unlike last window there is no bookmark to repair.

| Route                                | Screen                                                | Permission                                                                                |
| ------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/onboarding/prepare`                | Setup Prerequisites — what setup will ask for         | none (pre-auth, first run only)                                                           |
| `/members/admin/settings`            | Members settings hub (redirects to the first section) | `members.manage`                                                                          |
| `/members/admin/settings/visibility` | Contact Visibility                                    | `settings.manage`, `settings.manage_contact_visibility` or `organization.update_settings` |
| `/members/admin/settings/ids`        | Membership IDs                                        | `settings.edit` or `organization.update_settings`                                         |
| `/members/admin/settings/ranks`      | Operational Ranks                                     | `settings.manage` or `members.manage`                                                     |
| `/members/admin/settings/tiers`      | Membership Tiers                                      | `members.manage`                                                                          |
| `/members/admin/settings/evoc`       | EVOC Levels                                           | `apparatus.manage`                                                                        |
| `/scheduling/admin/closeout`         | Shift close-out queue                                 | `scheduling.manage`                                                                       |

**The per-section permissions are the endpoint's, not the hub's**, and that is
deliberate. Every route under `/members/admin` stands on `members.manage`, but
neither Contact Visibility nor Membership IDs saves through an endpoint that
accepts it. Gating them on the hub's grant would put a members officer on a
page where every toggle 403s. Operational Ranks accepts `members.manage`
because the ladder moved here and its gate moved with it; **EVOC deliberately
did not** — it is served by the apparatus API, and widening that was not part
of the move.

#### Redirected, not retired

`/onboarding/modules/:moduleId/config` no longer renders a configuration
template; it redirects to `/onboarding/modules`. The step it represented
reported success and saved nothing, so nothing is lost. A department that
picks SMTP has not reached a twelfth step — it is still on Email, which is why
the provider-configuration routes deliberately have no entry in
`ONBOARDING_STEPS`.

### The setup wizard was reordered

The order is now declared once, in
`frontend/src/modules/onboarding/config/steps.ts`. It previously lived in three
places that each restated it — the progress indicator, the route table, and a
hardcoded next-step path in all thirteen pages — and they drifted.

**Order now reflects what a department can answer**, rather than what the
system wants to store. Identity comes second so the rest of setup belongs to a
real account; what the department _uses_ comes before the _external
integrations_, which are the steps that send someone off to find credentials
and are all skippable.

| #   | Step                  | Path                            | Optional |
| --- | --------------------- | ------------------------------- | -------- |
| 1   | Organization Setup    | `/onboarding/start`             | no       |
| 2   | Administrator Account | `/onboarding/system-owner`      | no       |
| 3   | Modules               | `/onboarding/modules`           | yes      |
| 4   | Ranks & Positions     | `/onboarding/positions`         | yes      |
| 5   | Stations              | `/onboarding/stations`          | yes      |
| 6   | Apparatus             | `/onboarding/apparatus`         | yes      |
| 7   | IT & Backup Contacts  | `/onboarding/it-team`           | yes      |
| 8   | Email                 | `/onboarding/email-platform`    | yes      |
| 9   | File Storage          | `/onboarding/file-storage`      | yes      |
| 10  | Sign-In Method        | `/onboarding/authentication`    | yes      |
| 11  | Navigation Layout     | `/onboarding/navigation-choice` | yes      |

**Only steps 1 and 2 are genuinely required** — that is the backend's
`required_steps` in `OnboardingService.complete_onboarding`, and
`/onboarding/prepare` derives its two lists from the same `optional` flags, so
a step that changes its flag changes that screen with it.

Three things are now collected during setup that previously could only be
answered afterwards:

- **Member numbering**, in step 1. The counter only numbers members created
  after it is switched on, and the wizard creates the Administrator account in
  step 2 and the IT team in step 7. A department that answered this on a
  members screen afterwards ended up with its first accounts holding no number
  and the roster import starting at the number they should have had — an
  off-by-a-few nobody notices until a badge is printed.
- **The rank ladder**, in step 4, alongside positions. A rank may now confer a
  seat the department invented.
- **The membership tier ladder**, which has a screen in setup _and_ in
  Settings, sharing one editor.

Also in step 4: **permission rows are shown only for the modules in use.** The
checkboxes now grant permissions that exist, unticking a seeded position
removes it, and an unedited Continue no longer deletes most of the roster.

### Alembic route (upgrade data path)

Twelve revisions. Head moves `d7c1b95e2a40` → `0533644945cd`.

| Revision       | What it does                                                       | Reversible                               |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| `b8e3f1a97c24` | `inventory_items.style_attributes` — the full canonical style list | yes (drops the column; `style` survives) |
| `c4f7a2e91b38` | `member_size_preferences.garment_fit`                              | yes                                      |
| `ee7390dcdf47` | Treasurer gains `finance.approve` + `finance.configure_approvals`  | yes                                      |
| `d3f8b6a24c91` | Merge of the garment-style and Treasurer heads                     | n/a                                      |
| `f2a91c7d4e86` | `inventory_item_pins` table                                        | yes (drops the table)                    |
| `b1e7c3a92f45` | Property-return reports → leadership-only folder                   | yes — **and it restores the disclosure** |
| `1603bd9c59e7` | Index `sessions.refresh_token`                                     | yes                                      |
| `a3f61c8d27b4` | Renumber `membership_pipeline_steps.sort_order` to be unique       | see below                                |
| `f1565c64b658` | `facility_emergency_contacts.company_name` nullable                | yes                                      |
| `c7e2a4b9d180` | Unique `(pipeline_id, sort_order)` on pipeline steps               | yes                                      |
| `d19b2c2ae9b9` | Backfill `accept_public_requests`                                  | see below                                |
| `0533644945cd` | Settle off-list event-request preference values                    | no                                       |

#### Reversibility

Three revisions deserve more than a yes/no:

- **`b1e7c3a92f45` is reversible and you probably do not want to reverse it.**
  The downgrade moves the property-return reports back into `Reports` and drops
  the folders it created, restoring the prior state exactly — including the
  disclosure it exists to close. Reverse it for a schema rollback, not as a
  decision.

- **`0533644945cd` is not reversible**, and correctly so: it replaces
  unrecognised `date_flexibility`, `venue_preference` and
  `preferred_time_of_day` values with the canonical vocabulary, and the
  original free-text value is not recoverable. Its scope is deliberately
  narrow — **only values outside the vocabulary are replaced.** A
  `date_flexibility = 'specific_dates'` on a request that names no date is
  left alone, because the value renders correctly and the gate it walks past
  only ever ran at intake. `outreach_type` is deliberately untouched: it is
  per-organization configurable, so a value not in today's list may be a type
  the department genuinely offered and has since retired.

- **`a3f61c8d27b4` and `c7e2a4b9d180` are a pair**, and the order matters. The
  first densifies existing `sort_order` values; the second adds the unique
  constraint that keeps them that way. `sort_order` is not display order
  alone — "the next stage" is an index into the pipeline's steps sorted by it,
  so two steps sharing a value made both the board's column order and the
  destination of an advance depend on how the sort broke the tie, differently
  from one page load to the next. The index swap is written to work on MySQL
  8.0.

### Permission and grant movements

Two movements, and they pull in opposite directions from last window's six
revocations. **Nothing is revoked this window.**

| Movement                                                     | Who                     | Gated?                                                                           | Effect                                                                                        |
| ------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `finance.approve` + `finance.configure_approvals` **added**  | Treasurer               | **yes** — only where finance grants are exactly `{finance.view, finance.manage}` | The approval chain becomes actionable by a finance role rather than only the IT administrator |
| `members.manage` **accepted** by the operational rank ladder | any position holding it | n/a                                                                              | The ladder moved into Members Administration and its gate moved with it                       |

The Treasurer grant follows Pitfall #23's rule for an _addition_: it demands
positive evidence the row is an unrepaired seed, because an unconditional add
overrides a department's own decision. The gate is scoped to the **finance
subset** rather than the whole permission list on purpose — a whole-row
snapshot is pinned to the build that produced it, and adding a module anywhere
else in the registry would move a row across the test.

**What it costs when it is wrong, stated plainly:** an administrator who
deliberately curated the Treasurer to exactly `finance.view` + `finance.manage`
— meaning "no approval powers" — gets the two grants added, because nothing in
the row distinguishes that from the seed it is identical to. The cost of the
opposite choice is a department whose approval chain silently strands every
request.

### Documentation and media disposition

#### Screenshots

Full per-image queue in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md);
coverage counts are regenerated into
[`training/SCREENSHOT_STATUS.md`](./training/SCREENSHOT_STATUS.md) by
`scripts/screenshots/status_report.py` (**518 of 560 filled** as of this
audit).

**The inventory items-list captures are already done.** The 2026-09-07/08
disposition at the top of `SCREENSHOT_CURRENCY.md` covers pinning and grouping
and closed its own queue — five images re-shot, two added, one verified
byte-identical. Nothing below re-opens it.

**One change invalidates captures in bulk:** every capture of a department
running the **top** navigation layout. The setting is now server-side and
defaults to `left` for every existing installation, so a capture showing the
top bar no longer reflects what a member sees unless the department has set it.
Caption the layout on any re-shoot of a full-page frame.

| Image area                                                | Disposition | Why                                                                                  |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `/onboarding/prepare`                                     | **NEW**     | New screen; the two lists are the point — required vs optional                       |
| Onboarding progress indicator, new order                  | **REPLACE** | Any capture showing Stations at step 2 or System Owner at step 9 is wrong, not stale |
| `/onboarding/start` → member-numbering block              | **NEW**     | Never existed in step 1 before                                                       |
| `/onboarding/positions` → rank ladder editor              | **NEW**     | New in setup                                                                         |
| `/onboarding/positions` → module-filtered permission rows | **REPLACE** | The row list is shorter and depends on step 3's answers                              |
| Membership tier ladder (setup **and** Settings)           | **NEW**     | One editor, two hosts; capture both                                                  |
| `/members/admin/settings` hub                             | **NEW**     | New screen                                                                           |
| `/members/admin/settings/ranks`                           | **NEW**     | The ladder's new address                                                             |
| `/members/admin/settings/tiers`                           | **NEW**     | New section                                                                          |
| `/members/admin/settings/evoc`                            | **NEW**     | Never captured; note the `apparatus.manage` gate in the caption                      |
| `/members/admin/settings/visibility` and `/ids`           | **REPLACE** | Same settings, now on the shared settings frame                                      |
| `/scheduling/admin/closeout`                              | **NEW**     | New queue screen                                                                     |
| Shift panel → **Calls** log                               | **REPLACE** | Now hidden unless the department is on a call-tracking mode that has one             |
| Applicant board → place on a stage                        | **NEW**     | New coordinator action                                                               |
| Settings → General → Profile → **Navigation Layout**      | **NEW**     | The control the upgrade note sends operators to                                      |
| Any full-page frame shot with the **top** bar             | **REPLACE** | Default is now `left` for every existing department                                  |

Neither `/onboarding/prepare` nor `/scheduling/admin/closeout` has a
`scripts/screenshots/manifest.mjs` entry yet, and `/members/admin/settings`
has one. **Register the two missing routes before capturing** — a route with no
manifest entry is simply never shot, and unlike a _retired_ route it fails
silently by omission rather than by capturing the dashboard.

#### YouTube script beats

Determinations are made by **reading the script files**, not by inferring from
this change list. Full disposition in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

- **02 — First-Time Setup & Onboarding.** **The most affected script in the
  series this window, and the walkthrough order is now wrong rather than
  stale.** A take that walks Organization → Stations → Apparatus → Navigation
  cannot be followed: the wizard asks for the Administrator account second and
  the layout last. Three new beats are required — the prerequisites screen, the
  member-numbering block in step 1, and the rank/tier ladders in step 4 — and
  the "optional" marking is now shown up front rather than discovered.
- **03 — IT Manager / System Admin.** New head `0533644945cd`, twelve
  revisions. Needs the Treasurer grant, the property-return folder change and
  the event-request backfill. **Say the navigation-layout default explicitly**:
  this script's audience is who gets asked "why does everyone's menu look
  different from mine".
- **04 — Fire Chief / Leadership.** The Treasurer can now action an approval
  chain; that is this script's material, not the IT script's. Also the
  property-return reports, which a chief is the intended reader of.
- **06 — Member Guide.** Light this window. The navigation layout may change
  under a member on upgrade; nothing else member-facing moved.
- **07 — Secretary / Administrative.** Members Administration → Settings is a
  new destination for two settings this script already covers at their old
  address.
- **08 — Quick Tips & Shorts.** Four new shorts available: pin your working set
  on the items list; group the items list by anything; set your rank ladder
  during setup; where the close-out queue lives.

**Do not script the crew Sweep, do not script qualification entry, and do not
script the equipment-check lap.** All three remain built and unreachable —
carried forward from the last two windows, unchanged.

### Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = 0533644945cd
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
```

All five were run clean against `ae78901` while writing this audit: migration
head `0533644945cd`, single head, no branch points, 443 revisions; 228 routes
checked with 0 errors and 0 warnings (17 redirects skipped); 1,489 documented
route handlers with 0 errors and 0 warnings; 352 Markdown files with 0 broken
links; 518 of 560 screenshot placeholders filled.
