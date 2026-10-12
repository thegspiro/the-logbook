# Change audit: October 6 – 7, 2026

Net changes merged to `main` in the 25 hours ending 2026-10-07 ~09:00 ET,
written against `021fecc6` (PR #2980). It picks up where the
[October 5 – 6 audit](./CHANGE_AUDIT_2026-10-05_TO_10-06.md) stopped, at
`09f24912` (PR #2964). Ten pull requests merged (#2965, #2967, #2973 – #2980).
One of them, **#2965, is the whole story**: 82 commits, 457 files, eleven
migrations, and the owner-decision docket for medical screening, deployment,
scheduling, compliance, training, members and elections. The rest are a
desktop-density follow-up (#2967), the previous documentation pass (#2974),
one test fix (#2979) and six security-review records (#2973, #2975 – #2978,
#2980). **No code outside #2965, #2967 and #2979 changed.**

Wiki handoff:
[`Recent-Changes-2026-10-06-to-10-07`](../wiki/Recent-Changes-2026-10-06-to-10-07.md).

**Migration head.** Eleven new revisions follow the previous window's merge head
`15802f3df5c4` as one chain (see _Migration route_). Run `alembic heads`: it must
report a single head.

## Read this first

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

## What changed, by area

### Training and members

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

### Scheduling

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

### Elections

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

### Security, integrations and operations

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

## Behaviour changes at a glance

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

## Review passes in the window

Records live in `docs/security-review/`.

| Pass                                       | Result                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TR-17 training core, pass 7 (#2973)        | 0 fixes, **1 flagged (MEDIUM, TR7-1)**: `POST /training/enrollments` duplicates by hand the enrollment logic `enroll_member` runs under an organization lock, and reproduces the duplicate-active-enrollment race plus a missing progress/phase/recert/notification gap. **Open.** |
| TRX-18 training extended, pass 7 (#2975)   | **1 fixed (MEDIUM, TRX7-1)**: an officer could credit themselves for a missed cohort class; now refused.                                                                                                                                                                           |
| SKT-19 skills testing, pass 7 (#2976)      | 0 fixes; five standing flags closed (already fixed by feature work); the client-minted test id was reviewed and is a data-safe design. **Flagged:** `knowledge_tests.py` (1,147 lines, three new tables) sat under no feature's declared scope and had no security pass.           |
| CMP-20 compliance, pass 7 (#2977)          | 0 fixes; three standing flags closed; one new finding already fixed (CS-8-b: attestations).                                                                                                                                                                                        |
| AH-21 admin hours, pass 7 (#2978)          | 0 fixed, 0 flagged.                                                                                                                                                                                                                                                                |
| GF-22 grants & fundraising, pass 7 (#2980) | 0 fixed, 0 flagged.                                                                                                                                                                                                                                                                |

## CI and test infrastructure (no user-visible change)

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

## Migration route

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

## Still open (owner decisions, recorded in `KNOWN_LIMITATIONS.md`)

Signing-key cut-over boundary; Unraid build-from-source `SECURITY_REQUIRE_TLS`;
backups with the external-services override; Proxmox/Synology recipes; MCP OAuth
dynamic client registration, localhost redirects and a refresh-retry grace window;
open swaps not announced; custom-seat grants and labels; shift-count residuals;
offline skills evaluations cleared by an idle timeout or expired session without
asking; ELEC-43 (proxy vote on an anonymous election); TR7-1; the unreviewed
`knowledge_tests.py`; anonymous brute-force alerts on a multi-organization install
have no viewer.

## Documentation and media disposition

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
