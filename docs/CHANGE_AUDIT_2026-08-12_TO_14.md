# Three-day change and connection audit — 2026-08-12 through 2026-08-14

**Audit window:** 2026-08-12 00:00 UTC through 2026-08-14 (inclusive)  
**Baseline:** `b55d39c14bd244b360c358f87107e2526783a662` (last reachable commit before the window)  
**Audited head:** `4ae6f3ffb4a654f5c9d0901c17f6ab8110ff20a2`

This is the cross-functional release handoff for the three-day window. It records
user-visible pages, API and service connection points, persisted data, Alembic
routes, sharing boundaries, security rules, documentation/media work, and edge
cases. The exact **net** file set is retained in
[`change-audit/2026-08-12-through-14-files.txt`](./change-audit/2026-08-12-through-14-files.txt).
The manifest is authoritative when a reviewer needs to prove whether a file was
in scope; this narrative groups the 879 paths into usable release information.
Merge-only commits and intermediate revisions are not counted twice.

## Release map

| Area                                      | Pages and operator touchpoints                                                                                                                                            | Backend connection points                                                                                | Data points and paths                                                                                                                                         | Sharing, permission, and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Elections                                 | Elections list/detail, addressable detail tabs, Ballot Builder, saved-template picker, runoff chain, manual ballot count                                                  | `/api/v1/elections/*`; new list/create/delete `/templates/saved-ballots`; election service               | `SavedBallotTemplate`; template structure plus quorum, voting method, victory rules, voter types, attendance settings; `manual_batch_ballots_cast`            | `elections.manage`, organization scope; templates never copy candidates, rosters, votes, tokens, attendance, or result state. Names collide case-insensitively. Applied items get new IDs. Count quorum may exceed 100; percentage may not. Legacy rows, duplicate item IDs, invalid voting methods, mixed `all` voter types, runoff clone state, concurrent votes, approval turnout, and attested paper-count bounds now fail safely.                                                                        |
| Membership pipeline / forms / events      | Prospect board/detail and progress rail; event Settings outreach-form picker; early-ended attendance                                                                      | `/api/v1/prospective-members/*`, `/api/v1/forms`, `/api/v1/event-requests/forms`, `/api/v1/events/*`; skip-step action               | Active-prospect normalized email key; stage approvals/interviews; event mandatory membership tiers; related public outreach form metadata                     | Active email uniqueness is per organization and active rows only. Reconciliation preserves one canonical active record and releases inactive duplicates. Multi-approval signers must authenticate; final/gated stages cannot be skipped into invalid state. Outreach-form discovery is limited to event administrators and public outreach form type. Deleted interviewers remain readable historically. Attendance finalization supports early-ended events and reporting includes reviewed attendance only. |
| Scheduling / apparatus / equipment checks | Shift settings, calendar context, templates, crew seats, member checklist reports, apparatus QR directory                                                                 | `/api/v1/scheduling/shift-settings` GET/PUT/DELETE; scheduling, equipment-check and apparatus services                | Per-org `SchedulingModuleConfig`; shift-template vehicle fields; apparatus crew positions/rank IDs; checklist findings and completion reports                 | Settings cache/state is keyed by org. Crew seats use configured ranks, preserve legacy names, and reject incompatible edits. Member completion/report flows remain allowed after tighter template permissions. Shift completion resolves apparatus labels in batches.                                                                                                                                                                                                                                         |
| Training / skills / compliance            | Training session edit, program breadcrumbs, member program cards, skill-test runner/results, compliance profile admin-hours editor                                        | `/api/v1/training/sessions/by-event/{event_id}` and linkage PATCH; training/program/skills/compliance endpoints | Session links to requirement/course/program; skill-test `resume_count`; scoring points; result-visibility setting; requirement ownership                      | Officer-only checklist/sign-off fields are not exposed to members. A failed step may deduct points without forcing whole-test failure. Official-test policy fields are server guarded. Resume retries are scoped to the test and 409 is guarded. Undated records cannot satisfy recency. Deleting a program cannot delete a requirement it does not own.                                                                                                                                                      |
| Inventory                                 | Items/detail, issue/return, stock lots, CSV import, barcode/label flows, live inventory updates                                                                          | `/api/v1/inventory/*`; inventory and label services; inventory WebSocket                                | Computed overdue state; temporary-issue return date; available/issued/deployed stock; barcode/asset-tag identifier fallback; CSV upload bytes                 | Overdue is calculated from the current return deadline rather than stale stored state. Temporary issues preserve their return date. Availability excludes stock already issued/deployed. Barcode labels fall back only through the documented identifier order. CSV limits apply to bytes as well as row shape, and WebSocket origins must pass the configured allowlist. |
| Storefront                                | Member storefront/payment method; admin dashboard counts; order status/activity cards and filters; configurable open banner                                               | `/api/v1/store/*`, including `/api/v1/store/orders/mine/{order_id}/payment-method` PATCH; storefront and notification services             | `show_store_open_banner`; activity/status counts; order filters; canonical product locks; member payment method                                               | Member can change only their own payment method. Email/notice sends do not disclose recipient lists. Product locks canonicalize variants/options. Dashboard counts and filtered order lists use the same org-scoped source.                                                                                                                                                                                                                                                                                   |
| Facilities / locations / QR               | Facility detail extended sections; facilities dashboard counts; Room QR Codes directory, print signs, search, PNG download, inline room QR; apparatus check-in QR entries | facility counts endpoint; location display-code regeneration; facility/location APIs                     | Facility sensitive sections; rotating display code; facility/room/apparatus targets encoded as app routes                                                     | `facilities.view_sensitive` is read-only and must be explicitly granted; editing still requires edit/manage. Bulk QR directory is restricted, codes are tenant-bound, and regeneration invalidates the previous code. Captain-like labels alone do not grant sensitive access.                                                                                                                                                                                                                                |
| Admin hours / dashboard                   | Station-board dashboard; admin-hours summary charts and category editor                                                                                                   | admin-hours/report services; dashboard stat/card data                                                    | Calendar-year totals, category totals, requirement thresholds and reporting periods                                                                           | Calendar-year reporting is distinct from rolling periods. Category visualization separates configured categories correctly. Mobile cards/breadcrumbs/buttons retain 44px targets. Conditional dashboard panels should not be documented as always present.                                                                                                                                                                                                                                                    |
| Messaging / notifications                 | Pending/persistent dashboard message card; inbox; notification page                                                                                                       | `/api/v1/messages/*`, notification service, scheduled task cleanup                                              | Read/ack state, persistent/pinned flags, audience lists, related entity/action IDs                                                                            | Every targeted department message is emailed best-effort at every priority; urgent adds eligible SMS. Dashboard excludes handled messages on the next load but preserves persistent notices. Invalid/empty audiences and irrelevant audience fields are rejected/cleared. Read/ack writes fail closed for inactive, expired, deleted, or future messages. Completing event/scheduling actions archives related notifications, with filtering performed in the database.                                       |
| Integrations                              | Integrations page, Salesforce readiness/preview/sync                                                                                                                      | `/api/v1/integrations/*`; Salesforce, Slack, Teams, Discord services                                            | Encrypted client secret, external IDs, retry/backoff state, pagination cursor, redacted webhook diagnostics                                                   | Secrets are not returned or logged. Salesforce retries transient failures, preserves pagination, scopes sync to org, and rejects unsafe/missing configuration. Webhook logs redact tokens and sensitive payload fields.                                                                                                                                                                                                                                                                                       |
| Auth, audit, errors, privacy              | Login/OAuth/MFA, error reference page, audit/error logs                                                                                                                   | auth refresh/OAuth; `/api/v1/errors/codes`; audit shipping                                                  | Rotating refresh token family; OAuth MFA state; `AUDIT_LOG_LEGACY_MAX_ID`; `LB-*` support code and UTC diagnostic timestamp; guest/applicant retention fields | Refresh replay revocation commits before 401 and inactive organizations cannot refresh. Account reset cannot affect a more privileged account. OAuth cannot bypass MFA. API errors expose stable support codes but not sensitive internals. Audit ship destinations are validated before dispatch and legacy hash exceptions are bounded by operator config. Transfers/anonymization scrub applicant data and malformed retention settings fail conservatively.                                               |
| Deployment / backup / public portal       | Docker/Unraid installation and recovery runbooks                                                                                                                          | compose, nginx, install/backup scripts; public display/portal API                                        | TLS flags, backup artifact/key separation, API-key hashes, public timestamp normalization                                                                     | Production transport TLS fails closed unless explicitly overridden. Backup scripts preserve pipeline exit failures and safe extraction. Public portal API keys fail closed; timestamps are timezone-aware. WebSocket/external URL and upload/MIME validation reject unsafe origins, schemes, sizes, or spoofed content.                                                                                                                                                                                       |
| Shared frontend / accessibility           | Navigation, command palette, forms, mobile layouts, labels                                                                                                                | API client and service adapters                                                                          | Organization-keyed rank/settings caches; route query/tab state; normalized API error payload                                                                  | Admin navigation uses centralized permissions. Redundant mobile menus were removed; hamburger/dashboard controls preserve touch targets. Skip link/live announcements and skill-test state are truthful. Form fields retain dependent-value validation and readable contrast.                                                                                                                                                                                                                                 |

## Alembic route (upgrade data path)

Run migrations in the repository's single-head order; never select them by
filename alone. The window adds or materially changes these revisions:

1. `20260805_0004_public_portal_timestamps_to_datetime` — normalizes public
   portal timestamps (an older revision changed in this window).
2. `20260812_0001_add_saved_ballot_templates` — saved ballot structure table.
3. `20260812_0002_add_skill_test_resume_count` — initial resume counter.
4. `20260812_0003_restore_active_prospect_uniqueness` — restores the active
   prospect uniqueness constraint without mutating released history further.
5. `20260812_0004_fail_closed_public_portal_api_keys` — secure API-key state.
6. `20260813_0001_add_shift_template_vehicle_fields` and
   `20260813_0002_add_apparatus_crew_positions` — apparatus/shift linkage.
7. `20260813_0006_backfill_training_config_result_visibility` and
   `20260813_0007_reconcile_skill_test_resume_count` — safe training defaults
   and reconciliation for installations that saw an earlier branch revision.
8. `20260813_0008_backfill_facilities_view_sensitive` — explicit sensitive
   facility read permission.
9. `20260813_0009_add_manual_batch_ballots_cast` — physical ballot turnout.
10. `20260813_0010_add_scheduling_module_configs` — per-org shift settings.
11. `20260813_0011_add_event_mandatory_membership_types` — configured event
    eligibility tiers.
12. `20260814_0001_add_store_open_banner_setting` — banner visibility.
13. `20260814_0002_saved_ballot_election_settings` — completes template
    snapshots with election settings while preserving its published identity.
14. `20260814_0003_reconcile_active_prospect_emails` — moves destructive
    reconciliation out of the previously released uniqueness revision while
    preserving its published identity.
15. `20260814_0004_revoke_captain_facilities_view_sensitive` — removes the
    unintended system Captain grant and joins the event-reminder branch with
    the published saved-ballot/reconciliation chain, leaving one head.

**Required duplicate preflight before `alembic upgrade head`:** revision
`20260812_0003` creates the active-email unique index before the later
reconciliation revision can run. First identify collisions using the same
normalized key that reconciliation uses:

```sql
SELECT organization_id, LOWER(TRIM(email)) AS normalized_email, COUNT(*) AS active_rows
FROM prospective_members
WHERE status = 'active' AND email IS NOT NULL
GROUP BY organization_id, LOWER(TRIM(email))
HAVING COUNT(*) > 1;
```

If this returns rows, stop the upgrade. For each organization/email group,
select the canonical record with the earliest `created_at` (then lowest `id`),
review linked application data, and set every other row to `inactive`. Re-run
the query and require zero rows before upgrading. Do not delete prospects or
assume `20260814_0003` can repair the collision after the index creation has
already failed.

**Upgrade edges:** take a database backup; run `alembic heads` and require one
head; run `alembic upgrade head`; do not downgrade to “repair” a fork. The
reconciliation migration can merge active duplicate-email state, so operators
should review its log before and after rollout. Saved templates created between
the two template migrations receive safe defaults. Permission backfills grant
only the intended read capability and do not imply edit rights.

## End-to-end data paths and sharing boundaries

- **Saved ballot:** manager UI → election service API → strict schema →
  organization-owned template row → template picker → fresh ballot item IDs.
  No vote-bearing object crosses the boundary.
- **Outreach form:** event settings → administrator-scoped discovery endpoint →
  public-outreach forms only → event request link → public submission path.
  Public users never receive the administrative form catalog.
- **Training linkage:** event/session editor → session linkage PATCH → owned
  requirement/course/program IDs → member progress/compliance calculations.
  Cross-org and mismatched-program links are rejected.
- **Shift/apparatus:** org scheduling settings + rank catalog → template crew
  position → apparatus assignment/check-in → completion report. Rank IDs are
  canonical; display names are presentation data and legacy fallback only.
- **Store order:** member storefront → product/variant lock → order → selected
  external payment method → administrator status/activity aggregates. The app
  records payment state but does not become the payment processor.
- **Related notification:** originating event/request action → notification with
  entity/action identifiers → completion endpoint → database-scoped archive.
  Unrelated notifications and other organizations are untouched.
- **Salesforce:** org integration settings → decrypted secret in process only →
  readiness/preview → paginated sync with external IDs → local member/prospect
  records. Logs and API responses carry redacted diagnostics, not credentials.
- **Support error:** exception → public `LB-*` code + request metadata → Error
  Monitoring/code reference → operator troubleshooting. Private exception and
  PII remain server-side.

## Documentation and media disposition

Training guides changed throughout this window. Any new training paragraph must
use an explicit marker until a verified capture exists:

> **[SCREENSHOT NEEDED — describe the exact state/control and required demo data]**

The immediate capture queue is: the saved-ballot picker’s visible name/count/warning/actions plus a separate before/apply/after settings sequence;
manual-paper ballot count; station-board dashboard; admin-hours summary and
category editor; store dashboard counts/order filters/open-banner toggle; inventory temporary-issue deadlines, stock arithmetic, and import failure; Room
QR directory plus regenerated-code warning; apparatus rank-backed crew seats;
event outreach-form picker; training-session requirement/program linkage; and
a related notification before/after auto-archive. Mobile variants are required
where the header, dashboard card, breadcrumb, or primary action appears.

Existing images containing the old dashboard, old admin-hours summary, old
store admin, Ballot Builder without saved settings, apparatus free-text crew
positions, old event-settings form picker, or pre-directory QR navigation are
**REPLACE** candidates. Do not overwrite an image until it has been opened and
checked against its caption; preserve its identifier so guide links remain
stable. The detailed queue lives in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).

YouTube scripts requiring edits before recording are: **01/03** (production TLS
and upgrade path), **04/06** (station-board/dashboard visuals and conditional
cards), **07** (notification auto-archive and message delivery wording), **12**
(saved ballot settings/manual paper count/validation), **13** (store dashboard,
filters, member payment method, banner), **14/15/16** (session linkage, scoring,
resume/result rules), and **08** (QR rotation/download short). See
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

## Verification checklist

- Compare the exact manifest to the release branch; a later merge requires a
  new audit rather than silently extending this window.
- Validate a single Alembic head and upgrade a copy of pre-window data.
- Exercise each new endpoint with same-org, cross-org, missing-permission,
  legacy-row, and concurrent-write cases.
- Verify desktop and 375px layouts, keyboard focus, 44px touch targets, empty
  states, loading states, and API failures.
- Re-capture every **REPLACE** image and clear every **SCREENSHOT NEEDED** marker
  only after visual/caption review.
- Update script timings after inserting new chapters; timestamp drift is an
  editorial defect even when narration is correct.
