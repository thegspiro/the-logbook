# Recent changes: August 12–14, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is available in the source repository at
[`docs/CHANGE_AUDIT_2026-08-12_TO_14.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-12_TO_14.md).

## Pages and connection points

| Area                        | Pages                                                           | API/data connection                                                                                                                     | Boundary and important edge cases                                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Elections                   | Ballot Builder, saved templates, results/runoffs                | `/api/v1/elections/templates/saved-ballots`; `SavedBallotTemplate`; manual paper count                                                  | `elections.manage`, per organization. Templates copy settings/structure but never candidates, voters, tokens, votes, attendance, or results; applying creates new item IDs. Names are case-insensitively unique. Invalid methods/items and paper counts above the roster fail. |
| Dashboard/admin hours       | Station board and Summary                                       | dashboard/report services; calendar-year and category totals                                                                            | Pending/persistent messages replace arbitrary recent history. Conditional cards are not always present. Calendar year is not rolling 365 days.                                                                                                                                 |
| Storefront                  | Store Admin, order filters, member order                        | `/api/v1/store/*`; `show_store_open_banner`; status/activity counts; payment-method PATCH                                               | Counts, filters, locks, and orders are organization-scoped. Members edit only their order. Payment reporting is not payment processing. Recipient lists stay private.                                                                                                          |
| Inventory                   | Item detail, issue/return, stock, import, barcode/labels        | `/api/v1/inventory/*`; computed overdue/availability; barcode fallback; CSV/WebSocket validation                                        | Return dates survive temporary-issue edits. Available excludes issued/deployed stock. CSV is byte-limited and live connections require an allowed origin.                                                                                                                      |
| Facilities/QR/apparatus     | Room QR directory, room/facility pages, apparatus crew editor   | facility counts, location display-code regeneration, rank-backed crew positions                                                         | Bulk directory is restricted. Rotation invalidates old signs. `facilities.view_sensitive` does not grant edit. Rank IDs are canonical; legacy names are display fallback.                                                                                                      |
| Events/forms/prospects      | Event Settings outreach picker and prospect progress            | `/api/v1/event-requests/forms`; normalized active-prospect email; skip/advance/approval services                                        | Only event admins discover public-outreach forms. Active email uniqueness is organization + active rows. Signers authenticate; gated/final stages reject unsafe skips; deleted interviewers remain historical.                                                                 |
| Training/skills             | Session editor, program pages, skill runner/results             | `/api/v1/training/sessions/by-event/{event_id}` and linkage PATCH; requirement/course/program IDs; `resume_count` and result visibility | Linked records must belong together and to the organization. Undated records cannot satisfy recency. Officer-only state stays private. A failed step may deduct points without forcing overall failure.                                                                        |
| Scheduling/equipment checks | Shift settings, calendar, checklist reports                     | `/api/v1/scheduling/shift-settings` GET/PUT/DELETE; `SchedulingModuleConfig`; related notifications                                     | Settings/cache keys include organization. Authorized member completion remains available despite tighter template administration. Matching action completion archives only its related notification.                                                                           |
| Integrations                | Salesforce readiness, preview, sync                             | encrypted secret, external IDs, retry/backoff and pagination cursor                                                                     | Secret exists decrypted only in process and is absent from logs/responses. Retries cover transient failures, not bad credentials. Webhook diagnostics are redacted.                                                                                                            |
| Authentication/operations   | OAuth/MFA, Error Code Reference, audit/error logs, installation | rotating refresh family, `LB-*`, `AUDIT_LOG_LEGACY_MAX_ID`, production TLS                                                              | OAuth cannot bypass MFA; replay revocation commits before 401; reset authority has a privilege ceiling. Production TLS fails closed unless explicitly overridden. Public errors expose support codes, not internals.                                                           |

## Database upgrade route

Back up database and encryption keys separately, require one result from
`alembic heads`, then run `alembic upgrade head`. The window contains saved
ballot templates/settings, skill resume reconciliation, active-prospect
uniqueness/reconciliation, public portal key/timestamp hardening, shift vehicle
and crew data, training-result visibility, sensitive-facility permission,
manual paper-ballot counts, scheduling settings, mandatory membership types,
and the store-open banner. Active-email reconciliation is in
`20260814_0003`. **Before upgrading**, query active prospects grouped by
organization plus `LOWER(TRIM(email))`. If any group has more than one row, stop,
review linked applications, keep the earliest `created_at` (then lowest `id`),
mark the others inactive, and require a zero-row recheck. Otherwise the earlier
unique-index revision fails before reconciliation can run. Inspect migration
logs before and after rollout; never downgrade just to repair a migration fork.

## Documentation and media actions

Screenshots are still needed for saved ballot settings/paper count, the station
board and admin-hours categories, store counts/filters/banner/payment method,
Room QR download/print/rotation, rank-backed crew seats, event outreach forms,
training-session linkage/skill scoring, notification auto-archive, and redacted
Salesforce readiness. Replace older images showing the prior versions of those
screens, and re-check changed mobile headers/cards/actions at 375px.

Before recording, update YouTube scripts **01/03** (TLS/migrations/security),
**04/06** (dashboard), **07** (messages/notification cleanup), **08** (Room QR),
**12** (elections), **13** (store), and **14/15/16** (training/skills). Recalculate
all later timestamps after inserting a chapter.
