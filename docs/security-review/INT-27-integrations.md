# Security Review — Integrations

**Prefix:** `INT` · **Iteration:** 27 · **Reviewed:** 2026-10-30 (pass 11, this PR), 2026-10-27 (pass 10, PR #3782), 2026-10-24 (pass 9, PR #3641), 2026-10-20 (pass 8, PR #3467), 2026-10-17 (pass 7, rotation pass 7), 2026-10-07 (pass 6, rotation pass 7), 2026-10-04 (pass 5, rotation pass 5), 2026-09-13 (pass 4, rotation pass 4), 2026-09-06 (pass 3, rotation pass 3), 2026-08-31 (pass 2, rotation pass 2) · **PR:** this PR (pass 11); #3782 (pass 10, merged); #3641 (pass 9, merged); #3467 (pass 8, merged); #3375 (pass 7); #2988 (pass 6); #2892 (pass 5); #2508 (pass 4); #2307 (pass 3); #2087 (pass 2, merged); #1910 (pass 1, merged)

---

## Pass 11 (2026-10-30) — watchdog pickup; weather alerts and generic webhooks built out, credential-required connect; 0 fixed, 0 new findings

**Watchdog pickup.** The dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable (confirmed via
`ListAgents` — no reachable agents). PR #3852 (Feature 26, Forms, pass 11)
had already merged (`a41ff44d`); `search_pull_requests`
(`is:pr is:open head:claude/security-review-`) returned zero results both
before starting and again right before this push. Row 27 (Integrations)
confirmed as the first `⬜` row in `PROGRESS.md`'s rotation table on a
freshly fetched `main`.

**Baseline `d9d9d59b`** (pass 10's merge, PR #3782). Diffing every file this
feature has accumulated into scope across passes 1–10 — all ten route files,
every file under `services/integration_services/`, the directory-account and
Google Workspace services, `models/integration.py`,
`schemas/integration.py`, `utils/ssrf_transport.py`, `mcp/keys.py`, and
`frontend/src/pages/IntegrationsPage.tsx` — against `d9d9d59b` finds **four**
in-scope commits (of 253 non-merge commits on `main` since that baseline).
Confirmed byte-identical, not sampled: `salesforce_sync.py`, `calcom_sync.py`,
`mcp_keys.py`, `google_workspace.py`, `google_calendar_oauth.py`,
`outlook_calendar_oauth.py`, `api/public/calendar.py`,
`api/public/integrations_webhook.py`, `api/public/salesforce_webhook.py`,
`mcp/keys.py`, `utils/ssrf_transport.py` (the DNS-rebinding SSRF guard),
`models/directory_account_departure.py`, `services/integration_health.py`,
and `services/paypal_backfill_service.py`.

### What changed in-scope since pass 10 (reviewed, no fix needed)

- **`86d80fe3`** ("PayPal, Documenso, Cal.com and Salesforce need their
  credentials to connect") — INT2-3, an app-review finding, owner decision
  2026-10-27: these four accepted `POST /{id}/connect` with no credential and
  showed connected/enabled until `test-connection` failed. `integrations.py`'s
  `_missing_required_fields` now also checks a per-type
  `_CREDENTIALS_REQUIRED_TO_CONNECT` list, treating a blank string as absent
  (these schemas default each credential to `""` so a partial `PATCH`
  validates against the same schema) and accepting a value already stored
  (so a reconnect that sends nothing still passes). Read the full diff: the
  check only _adds_ names to `missing`, never removes one the schema-level
  check already found, and a reconnect's "already stored" branch reads
  `integration.get_secret(name)` — the encrypted column, not the plaintext
  `config` dict — so it can't be satisfied by a value that was only ever in
  the request body. Covered by
  `tests/test_integration_connect_required_fields.py` (new, 75 lines).
- **`de9aade2`** ("NWS weather alerts are polled and shown as the department
  chose") — a full new sub-feature, owner decision 2026-10-29, closing the
  KNOWN_LIMITATIONS "Do Nothing After Their Test" item's weather half. Read
  in full, not sampled:
  - New table `weather_alerts` (migration `f90b1124e6f4`, corrected in a
    same-window follow-up commit before merging — see below). `create_table`
    guarded by `_has_table`, so a second run is a no-op; `organization_id` is
    `ForeignKey(..., ondelete="CASCADE")` and `nullable=False` (not a `SET
NULL` column, so Pitfall #2 doesn't apply); unique on
    `(organization_id, nws_id)`, which is what makes a second poll of the
    same alert a no-op rather than a repeat notification.
  - `weather_alert_service.poll_zone` commits the new/updated rows **before**
    `announce()` sends anything (CLAUDE.md Pitfall #36, at-most-once): a crash
    between the two loses that alert's notice rather than repeating it to the
    whole department on the next 15-minute poll. An `IntegrityError` on the
    commit (another worker recorded the same alert first) is caught, rolled
    back, and returns no fresh alerts rather than re-raising or double-firing.
  - Every query in the new service filters `organization_id` (`weather_integration`,
    `active_alerts`, `poll_zone`'s `stored` lookup, `_members`) — no by-id
    query takes a client-supplied id at all; the only parameter is the
    caller's own `organization_id` from `current_user`.
  - New route `GET /integrations/weather/active-alerts` is deliberately
    member-readable (`get_current_user` only, no permission gate) — it is NWS's
    own public bulletin, filtered to the caller's org, not member data — and
    is listed in `tests/permissionless_route_baseline.txt:178` with that
    scoping. It is registered **before** `/{integration_id}` in the file
    (line 1008 vs. line 1046 after this change), which is what stops FastAPI
    from matching `"weather"` as a path-parameter `integration_id` on a
    literal-vs-wildcard route — confirmed by reading route registration
    order directly, not assumed.
  - Free text from NWS (`headline`, `area_desc`, `instruction`) is
    `html.escape()`d before going into the alert email's HTML body
    (`_email`); the dashboard banner renders the same fields as JSX text
    content, which React escapes by default. One email per member in the
    recipient loop (never a shared `to` list), and `recipients_for(...,
EmailKind.WEATHER_ALERTS, ...)` respects the member's own notification
    preference the same way every other `EmailKind` does.
  - The bell notice (`add_in_app_copies`) and the email path are each wrapped
    in their own `try/except`, logged and swallowed — a failure in one
    channel cannot take out the alert record or the other channel, and
    `announce()` itself is documented to "never raise".
  - **Follow-up fix in the same window, `0664a29e`** ("name the creation
    stamp `created_at`"): the unpublished migration's timestamp column was
    renamed from `first_seen_at` to `created_at` before this feature's own
    pass 10 merge closed, because `test_timestamp_columns_exist_on_tracked_tables`
    caught the non-standard name. Confirmed the migration file, model and
    service were all updated together (no stale reference to the old name
    anywhere in the current tree).
- **`e392f355`** ("Generic Webhooks are sent the events chat integrations
  get") — the other half of the same KNOWN_LIMITATIONS item, owner decision
  2026-10-29. `dispatch_generic_webhooks` (new, in this feature's own
  `integration_services/notification_dispatch.py`) runs beside the existing
  chat dispatch from `notify_entity_created`. Read in full:
  - Its own `Integration` query filters `organization_id == str(organization_id)`
    — the `organization_id` is the background task's own parameter, passed
    down from the HTTP request that triggered the notification, not a
    client-supplied id on this path.
  - `event_types` is validated against a fixed `WEBHOOK_EVENT_TYPES` map
    (`schemas/integration.py`, `field_validator`, raises `ValueError` → 422 on
    an unknown value, using `list_within_detail_limit` per the repo-wide
    error-message-length sweep) — a client cannot pick an arbitrary string to
    gate deliveries on; an empty list means "all events" so a webhook
    connected before this feature existed starts receiving everything rather
    than silently nothing.
  - The actual delivery still goes through the pre-existing
    `webhook_service.send_webhook`, confirmed byte-identical to pass 10 —
    which still calls `assert_outbound_url_safe(url)` immediately before the
    request (the DNS-rebinding TOCTOU guard, checklist §4) and still HMAC-signs
    the payload. This commit adds a second _caller_ of that function; it does
    not touch the function itself, so the guard this feature already earned
    credit for in prior passes is unweakened.
  - Each delivery attempt — success or failure — is recorded via
    `record_integration_run`, matching the existing pattern for every other
    connector's outbound call in this feature.
  - This file was also read, from the opposite direction, by Feature 25
    (Messaging & notifications)'s own pass 11 — `notification_dispatch.py`
    physically lives under this feature's `integration_services/` directory
    but is also a shared dispatch entry point messaging passes through. Per
    Pitfall #29, this pass did not re-derive Feature 25's conclusion; it
    independently re-read the same diff from this feature's own angle
    (outbound-URL guard, org-scoping, event-type allowlist) and reaches the
    same result.
- **`9af732d9`** ("Use `alert-danger` where `alert-error` was written") — a
  one-line CSS class fix in `IntegrationsPage.tsx` (an undefined Tailwind
  utility rendering with no colour/border/padding). Cosmetic; no security
  surface.

Three other commits in the window (`31f39cf6`, `43c11090`, `b48d63f2`) touch
this feature's files only as a share of a repo-wide sweep, reviewed for this
feature's slice only:

- **`31f39cf6`** ("officer alerts whose email can be turned off also leave a
  bell entry") adds a bell notice to `google_workspace_attention_digest.py`'s
  existing `send_google_workspace_attention_digest`. It reuses the function's
  own already-org-scoped `_administrators(db, org_id)` call — no new query —
  and the bell message is a generic subject/count with a fixed `/integrations`
  action URL; no PII in the notice body.
- **`43c11090`** (the repo-wide email-fingerprint sweep) swaps
  `func.lower(User.email).in_(...)`/`func.lower(User.email) == ...` for
  `User.email_hash.in_(email_fingerprints(...))` in
  `directory_account_service.py` and `salesforce_sync_service.py`. Both call
  sites keep their pre-existing `organization_id` filter in the same
  `where()` clause — the change only narrows how the email half of the match
  is expressed, not the tenant boundary.
- **`b48d63f2`** (the repo-wide email-encryption sweep) touches this
  feature's `models/integration.py` only via the unrelated `WeatherAlert`
  class landing in the same file in the same window (confirmed by `git show
b48d63f2 -- backend/app/models/integration.py` returning empty) — no
  encryption-sweep edit actually lands in this feature's own tables.

### Route inventory re-enumerated by AST — 39 routes (was 38 at pass 10)

A Python `ast` walk (not a text grep) over every `@router.*` decorator in all
ten route files: `integrations.py` 12 (was 11, +1 — the new weather route),
`salesforce_sync.py` 9, `calcom_sync.py` 1, `mcp_keys.py` 4,
`google_workspace.py` 4, `google_calendar_oauth.py` 2,
`outlook_calendar_oauth.py` 2, `api/public/calendar.py` 2,
`api/public/integrations_webhook.py` 2, `api/public/salesforce_webhook.py` 1.
`check_route_permissions.py --strict`: 280 routes, 0 errors/warnings (up
from pass 10's 279 — the one net-new application route).

### Migrations since pass 10

One new migration belongs to this feature: `f90b1124e6f4` (`weather_alerts`,
reviewed above). `validate_migrations.py --strict`: 678 revisions (up from
pass 10's 663), single head, PASSED.

### Standing findings — all re-verified, none changed

- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist,
  `app/utils/url_validator.py`): file confirmed byte-identical to pass 10.
  Still an explicit owner decision. **OPEN.**
- **INT-6** (connector-exception sanitization, `sanitize_connector_error`):
  unaffected — no connector's `test_connection`/`check_readiness` path
  changed this window. **FIXED, unchanged.**
- INT-2, INT-3, INT-4, INT-8, INT-9 and the rest of the standing "Verified
  good" list (SOQL injection defense, instance-URL domain pinning, secret
  handling, webhook replay dedup, module gating, the SSRF transport pin, the
  wall-clock deadline, Google Calendar's response-size cap, Retry Sync's
  lock-then-read ordering, the PayPal backfill's idempotency): every file
  carrying them is either confirmed byte-identical above or, for
  `notification_dispatch.py`'s `send_webhook` call, confirmed to reuse the
  unchanged guard rather than route around it.
- **`docs/KNOWN_LIMITATIONS.md`**: the "Integrations — Weather Alerts and
  Generic Webhooks Do Nothing After Their Test" entry already carries both
  "resolved (2026-10-29)" notices (added by `de9aade2`/`e392f355` themselves)
  describing exactly what pass 11 independently verified; the older prose
  below each notice is kept as the historical record of what the limitation
  was, matching this file's established convention (e.g. the Medical
  Screening MS-13 entry) rather than being stale. No edit needed.

## Guard tests added

None by this pass — every new-feature test (`test_weather_alerts.py`,
`test_generic_webhook_dispatch.py`, `test_integration_connect_required_fields.py`)
was authored by the commits that introduced the behavior, already proven to
fail on the old code per their own commit messages, and re-run as part of
this pass's scoped suite below rather than re-written.

## Completion gate (pass 11)

| Check                                                                                                                                                                                                                                       | Result                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (flake8 7.4.1)                                                                                                                                                                                                | ✅ 0 violations                                                                                             |
| `black --check app/ tests/ alembic/` (black 26.10.1, `python3.13 -m`)                                                                                                                                                                       | ✅ 2743 files unchanged                                                                                     |
| `isort --check-only app/ tests/ alembic/` (isort 9.0.2, `python3.13 -m`)                                                                                                                                                                    | ✅ clean                                                                                                    |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                                                                                                        | ✅ 678 revisions, single head `f90b1124e6f4`, PASSED                                                        |
| `python3.13 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                        | ✅ 280 routes, 0 errors, 0 warnings                                                                         |
| backend tests, scope (`-k "weather or integration or salesforce or calcom or documenso or paypal or webhook or connector or mcp_key or google_calendar or google_workspace or outlook or directory_account or microsoft_365 or directory"`) | ✅ 8989 passed, 22 skipped (environment-only — Docker daemon/registry, opt-in API-contract suite), 0 failed |
| backend tests, `test_weather_alerts.py` + `test_generic_webhook_dispatch.py`                                                                                                                                                                | ✅ 16 passed                                                                                                |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                          | ✅ 0 errors                                                                                                 |
| `cd frontend && npm run lint`                                                                                                                                                                                                               | ✅ exit 0, 0 warnings                                                                                       |
| `npx vitest run` (`WeatherAlertBanner.test.tsx` + `IntegrationsPage.test.tsx` + `Dashboard.test.tsx`)                                                                                                                                       | ✅ 3 files, 215 tests passed                                                                                |

No backend or frontend source file was modified by this pass itself — every
finding this pass reviewed was already fixed by the commits that introduced
it (`86d80fe3`, `de9aade2`, `0664a29e`, `e392f355`), each already carrying
its own guard test. This pass's contribution is independently re-verifying
all four against the current code and re-enumerating the route inventory by
AST.

Next: Feature 28 (Security, audit & IP).

---

## Pass 10 (2026-10-27) — watchdog pickup; true zero backend delta; 0 fixed, 0 new findings

**Watchdog pickup.** The dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable (confirmed via
`ListAgents` — no reachable agents). `search_pull_requests`
(`is:pr is:open head:claude/security-review-`) and `list_pull_requests`
both returned 0 results — PR #3775 (Feature 26, Forms, pass 10) had just
merged, its one CI failure (`Backend Integration Tests (MySQL 8.0)`
cancelled at the ~30-minute job-timeout mark, with every test passed up to
that point and the diff docs-only) resolved by a single `rerun_failed_jobs`
re-run rather than any code change. Row 27 (Integrations) was confirmed the
first `⬜` row in `PROGRESS.md`'s rotation table on a freshly fetched `main`
(head `3665a893`, the merge of #3775).

**Baseline `09b18569`** (pass 9's merge, PR #3641). Per-file `git log
09b18569..HEAD` across every file this feature has accumulated into scope
across passes 1–9 — `integrations.py`, `salesforce_sync.py`,
`calcom_sync.py`, `mcp_keys.py`, `google_workspace.py`,
`google_calendar_oauth.py`, `outlook_calendar_oauth.py`,
`api/public/calendar.py`, `integrations_webhook.py`, `salesforce_webhook.py`,
`models/directory_account.py`, `models/directory_account_departure.py`,
`models/integration.py`, `schemas/integration.py`,
`services/directory_account_service.py`,
`services/google_workspace_attention_digest.py`,
`services/integration_health.py`, `services/paypal_backfill_service.py`,
`utils/ssrf_transport.py`, `mcp/keys.py`,
every file under `services/integration_services/` (28 files — `base.py`,
every connector, `calendar_oauth_common.py`, `directory_common.py`, etc.),
and `frontend/src/pages/IntegrationsPage.tsx` — returns **zero commits** for
every one of them. `git diff --stat 09b18569..HEAD` against the whole
`services/integration_services/` directory is empty. Three days of
genuinely heavy, parallel activity landed elsewhere in the app (503 files,
+29129/-5275 across the full repo diff) and none of it touched this
feature's files.

### The two near-misses, checked and ruled out

- **`scheduled_tasks.py` changed (+100/-27), but not this feature's hooks.**
  `git diff` on the file shows every hunk inside `run_compliance_auto_reports`
  (Feature 20) or `run_prospect_attendance_advance` (Feature 08, prospect
  attendance); `run_directory_account_departure_check` and
  `run_google_workspace_suspension_sync` are byte-identical to pass 9.
- **A new "Gmail — Sending Through a Service Account" `KNOWN_LIMITATIONS.md`
  entry, dated 2026-10-25 — after this pass's baseline — but not this
  feature's.** The code it documents (`app/utils/google_oauth.py`,
  `app/services/gmail_api_sender.py`) is outbound departmental mail sending,
  not a directory/connector/webhook integration this rotation's row covers,
  and it already has its own dedicated review: commit `5c520451`
  (`security(messaging-notifications): add MSG-17 (Gmail token_uri SSRF),
fixed`) shows it was found and fixed under Feature 25's own rotation
  (`docs/security-review/MSG-25-messaging-notifications.md`, MSG-17),
  contemporaneously with this pass's own window — not left unreviewed by
  either rotation. Re-deriving it here would repeat Pitfall #29's mistake;
  it is noted, not re-reviewed.
- Two frontend files touched "calendar" by name but not this feature:
  `components/CalendarView.tsx` and `pages/scheduling/CalendarSubscribeCard.tsx`
  both swap `formatDateCustom` for a new `formatCalendarDate` helper (a
  date-formatting utility change on the Events/Scheduling calendar grids),
  confirmed by direct read to be unrelated to `IntegrationsPage.tsx` or any
  connector's calendar OAuth flow.

### Route surface re-enumerated by AST — unchanged

A Python `ast` walk (not a text grep) over every `@router.*` decorator in
this feature's ten route files finds **38 routes total**, identical to pass
9's count, file by file: `integrations.py` 11, `salesforce_sync.py` 9,
`calcom_sync.py` 1, `mcp_keys.py` 4, `google_workspace.py` 4,
`google_calendar_oauth.py` 2, `outlook_calendar_oauth.py` 2,
`api/public/calendar.py` 2, `integrations_webhook.py` 2,
`salesforce_webhook.py` 1. `check_route_permissions.py --strict`: 279
application routes, 0 errors/warnings (see completion gate).

### Migrations since pass 9 — none belong to this feature

13 new migration files landed in the window (grants/fundraising donor-name
changes, sensitive form fields, event-guest check-in tokens, form embedding,
passkeys, PII encryption, lot recalls, and four merge revisions resolving
parallel branch heads). Grepping all 13 (case-insensitive) for
`integration`/`salesforce`/`directory_account`/`google_workspace`/
`microsoft_365`/`calcom`/`mcp_key`/`calendar_sync`/`ical` (the one apparent
hit, inside the lot-recalls migration's docstring, is the substring `ical`
inside the word "Medical" — a false positive, confirmed by direct read):
zero real matches. No table this feature owns was created, altered, or
backfilled. `validate_migrations.py --strict`: 663 revisions (up from pass
9's 650, matching the 13 new files), single head `c616fa1bd492`, PASSED.

### Standing findings — all re-verified, none changed

- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist,
  `app/utils/url_validator.py`): unchanged, still an explicit owner decision.
  **OPEN.**
- **INT-11** (Salesforce "clear the refresh token" has a reachable UI
  control): confirmed **FIXED** since pass 8, unchanged —
  `IntegrationsPage.tsx`'s `handleSwitchSalesforceToClientCredentials`
  button is untouched by this window's (nil) diff.
- INT-2, INT-3, INT-4, INT-6, INT-8, INT-9: SOQL injection defense,
  instance-URL domain pinning, OAuth `error` URL-encoding, secret handling
  (`SECRET_CONFIG_KEYS`), webhook replay dedup, module gating, the
  DNS-rebinding SSRF transport pin (`SSRFSafeAsyncTransport`), the wall-clock
  deadline (`INTEGRATION_DEADLINE_SECONDS`), Google Calendar's response-size
  cap, Retry Sync's lock-then-read ordering (Pitfall #27), the PayPal
  backfill's idempotency (`_already_recorded`/the unique-constraint key): none
  of the files carrying them changed since pass 9 per the diff above — all
  re-confirmed unregressed, not re-derived.
- **LIKE-pattern usage, CSV export**: none in this feature's scope, same as
  every prior pass.
- **`docs/KNOWN_LIMITATIONS.md`**: the Microsoft 365 and Google Workspace
  sections (all dated 2026-10-23 or earlier) re-read and still match the
  current code exactly — no edit needed. The new Gmail section (2026-10-25)
  is a different feature, as established above.

## Guard tests added

None by this pass — no code changed. Every existing guard test for this
feature's prior fixes was re-run as part of the scoped suite below and
confirmed still passing.

## Completion gate (pass 10)

| Check                                                                                                                                                                                                                                                | Result                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (flake8 7.4.1)                                                                                                                                                                                                         | ✅ 0 violations                                                                                                                                                         |
| `black --check app/ tests/ alembic/` (black 26.10.1)                                                                                                                                                                                                 | ✅ 2696 files unchanged                                                                                                                                                 |
| `isort --check-only app/ tests/ alembic/` (isort 9.0.2)                                                                                                                                                                                              | ✅ clean                                                                                                                                                                |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                    | ✅ 663 revisions, single head `c616fa1bd492`, PASSED                                                                                                                    |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                                    | ✅ 279 routes, 0 errors, 0 warnings                                                                                                                                     |
| backend tests, scope (`-k "integration or salesforce or calcom or documenso or paypal or webhook or connector or mcp_key or google_calendar or google_workspace or ical or calendar or outlook or directory_account or microsoft_365 or directory"`) | ✅ 9300 passed, 22 skipped (environment-only — `pywebpush`, Docker daemon/registry, opt-in API-contract suite, no-timezone-tables), 0 failed                            |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                   | ✅ 0 errors (after `npm ci` from the repo root — sandbox `node_modules` predated the `@simplewebauthn/browser` passkeys dependency; environment gap, not a code defect) |
| `cd frontend && npm run lint`                                                                                                                                                                                                                        | ✅ exit 0, 0 warnings                                                                                                                                                   |

No backend or frontend source file was modified by this pass itself — every
file this feature owns is byte-identical to pass 9's baseline. This pass's
own contribution is re-enumerating the route inventory by AST, confirming
that, and ruling out the two places a careless scan could have mistaken
other features' work for this one's.

Next: Feature 28 (Security, audit & IP).

---

## Pass 9 (2026-10-24) — directory-account rename/retirement/group-removal/long-suspension and the MS 365 secret-expiry warning; 0 fixes, 0 new findings

Watchdog pickup. The dedicated loop session (`session_011T1ZyyLrD5HagusgK9uDw2`)
was not reachable. PR #3640 (Feature 26, Forms, pass 9) was found open, CI
green on its head commit, `mergeable_state: clean`, and with no unresolved
review thread (the two Codex bot comments were the bot's own usage-limit
failure, not findings) — merged by this same watchdog run before starting
this pass. A fresh `search_pull_requests` (`head:claude/security-review-`,
state:open) then returned 0, and row 27 (Integrations) was confirmed the next
`⬜` row in `PROGRESS.md`'s rotation table on a freshly fetched `main`
(`2d000c36`, the merge of #3640).

**Baseline `8fb7eba1` (PR #3467's merge, pass 8).** `git diff 8fb7eba1..HEAD`,
scoped to this feature's actual files (not `git log`, which undercounts —
Pitfall from pass 6), shows five real feature commits landed since then, all
read in full against every `CHECKLIST.md` dimension:

| Commit     | What                                                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ece6c10b` | A per-directory-integration `suspend_on_retirement` switch (off by default): retiring suspends/blocks the account exactly as a drop does, for members who retire while it is on                                               |
| `0d5b81f3` | A departure now also takes an account The Logbook created out of the integration's configured groups (never a Microsoft 365 group that assigns licenses, nor one whose licenses Graph does not report); a return puts it back |
| `7ac97a39` | The daily departure check marks (`long_suspended_since`) an account still in the directory more than 90 days after its suspension; listed on the attention list and named once in the morning email — nothing is auto-removed |
| `88f385a5` | A member's first/last name change reaches an account The Logbook created (`name_pending`, staged in the same transaction, sent after commit, retried by the 15-minute sweep); the address is never changed                    |
| `ff9e1d21` | An administrator records the Microsoft 365 client secret's Entra ID expiry date; the Integrations card and the morning email warn at 30/7/0 days                                                                              |

A sixth commit, `b4b0ea8a`, is a correctness-only fix (the secret-days-left
card now counts from the department's own date via `resolve_org_today`
rather than the server's UTC date) plus an unrelated MFA test-clock fix
(already reviewed/merged on PR #3616/#3640) — no access-control change.
`8b0ba129` (MFA step-up, repo-wide) added `require_stepup` to
`connect_integration`/`disconnect_integration`/`update_integration` — a
hardening addition reviewed below, not a regression. `b2858211` (drops the
dead `ICalConfig.include_shifts` field) is a Pitfall #19 cleanup with no
new surface. No other commit in the window touches this feature's files.

### Read in full

**`backend/app/api/v1/endpoints/integrations.py` (+58 L).** The new
`_credential_days_left`/`_integration_to_dict(..., today=...)` plumbing reads
the Microsoft 365 secret-expiry date (never a secret value) and is computed
from `resolve_org_today(db, integration.organization_id)` — the integration's
own `organization_id`, not request input, at every one of the four call
sites (`list_integrations`, `get_integration`, `connect_integration`,
`update_integration`, `retry_integration_sync`). `require_stepup` (checklist
§1) is now a dependency on connect/disconnect/update, declared _after_
`require_permission("integrations.manage")` in the parameter list — matching
`require_stepup`'s own docstring ("add it after the permission dependency, so
a caller who lacks the permission is told that rather than asked to
re-verify"); FastAPI resolves route dependencies in declared order, so the
permission check still runs first. `require_stepup` itself
(`app/api/dependencies.py:463`) is shared, repo-wide infrastructure (added by
`8b0ba129`), server-side-stamped on the session row, never trusting a
client-supplied header beyond carrying the token to the stamp lookup — spot
checked here as a consumer, not re-reviewed as its own threat model (it has
no dedicated file in this feature's scope).

**`backend/app/models/directory_account.py` / `directory_account_departure.py`
(+22 L / +140 L, net).** `DIRECTORY_INTEGRATION_TYPES`,
`SUSPEND_ON_RETIREMENT_KEY`, `suspends_retired()`,
`_department_suspends_retired()` (org-scoped: filters
`organization_id`/`integration_type.in_(DIRECTORY_INTEGRATION_TYPES)`/`enabled`/
`status == "connected"`), `_stage_rename()` (filters `user_id` **and**
`organization_id`, same as the existing `_stage()`), and the `before_flush`
hook's new first/last-name-change branch and retired-status branch were all
read in full. Every query added here carries the same org filter the
existing suspension-staging code already used — no new unscoped by-id path.

**`backend/app/services/directory_account_service.py` (+469 L / -17 L).**
`_follow_groups`/`_leave_groups` (group removal/rejoin), `sync_name`
(rename), `sync_pending_names`/`retry_group_removals` (the 15-minute sweep's
new retries), `check_departed_suspensions`'s `long_suspended_since` tracking,
and `_attention_issue`'s two new issue types — all read in full. Every
per-record operation goes through the existing `_load(organization_id,
user_id=..., lock=True)`, which filters `organization_id` and takes
`FOR UPDATE` (checklist §3, Pitfall #27); `check_departed_suspensions` and
`attention_items` (the two multi-row queries) both `JOIN`
`DirectoryAccountProvision`↔`User` and filter `organization_id` on **both**
sides of the join. `pending_group_removals` (JSON list column) is always
reassigned whole (`row.pending_group_removals = remaining or None`), never
mutated in place, so Pitfall #12 does not apply. `sync_pending_names()` and
`retry_group_removals()` are unscoped _sweeps_ — by design, like the
pre-existing `sync_pending_suspensions()` they sit beside — iterating every
organization's own rows from a scheduled task, never from a caller-reachable
endpoint.

**Connector methods (`google_workspace_service.py` +35 L,
`microsoft_365_service.py` +75 L).** `update_name`/`remove_from_group` on
both. Google's `update_name` sends `{"name": {...}}` as a JSON body (no
string interpolation into a URL or query). Microsoft 365's `update_name` and
`remove_from_group` both `quote(..., safe='')` every path segment
(`user_key`, `group_id`, `account.id`) before building the Graph REST path —
the same pattern this feature's existing connector code already uses
elsewhere. `remove_from_group`'s "leave a licensing group alone" check reads
`assignedLicenses` from Graph's own group object (added to `GROUP_FIELDS`),
never guessed. `client_secret_days_left`/`client_secret_warning_level`
(`microsoft_365_service.py`) read only the `client_secret_expires_on` config
key (a date, not a secret) and do no I/O.

**`backend/app/services/google_workspace_attention_digest.py` (+163 L,
net).** `_recently_reactivated`/`_newly_long_suspended` both filter
`User.organization_id`/`DirectoryAccountProvision.organization_id` on the
join. Every member name/email/URL interpolated into the HTML email body
(`_secret_section`, `_long_suspended_section`, `_reactivated_section`) goes
through `html.escape()` first — re-verified by direct read, not assumed from
the existing pattern. `_record_digest` still deep-copies
`organization.settings` before mutating the nested dict and reassigns the
column whole (Pitfall #12, unchanged mechanism, now also storing
`secret_expiry_warned`).

**`backend/app/services/scheduled_tasks.py`.** Only the
`run_directory_account_departure_check` (new, routed through the existing
`_for_each_org` per-organization helper) and `run_google_workspace_suspension_sync`
(now also calling `retry_group_removals()`/`sync_pending_names()`) hunks are
this feature's; the much larger diff in this shared file (NFC tap purge,
inventory low-stock alert links, a scheduled-email row-lock fix) belongs to
Features 11/13/31 and is out of this feature's declared scope.

**Frontend (`IntegrationsPage.tsx`, +~70 L net; `IntegrationsPage.test.tsx`,
+128 L).** The two new `suspend_on_retirement` checkboxes and the
`client_secret_expires_on` date input use controlled React state, not
`??`-coerced form values; `credential_days_left`/`credential_expiring` are
rendered as plain JSX text (React-escaped), never through
`dangerouslySetInnerHTML`. No new `window.confirm`/`alert`/`prompt`. New
tests cover the added fields and the expiry badge.

### Schema & migration notes

Three new migrations since pass 8, all guarding the table's existence first
(Pitfall #26) and all previously shipped with their own migration tests
(re-run below): `6c0e79521d14` (`pending_group_removals`, nullable JSON),
`26683fe99719` (`long_suspended_since`, nullable `DateTime(timezone=True)`),
`c561cf7730ce` (`name_pending`, `NOT NULL` with `server_default="0"` —
Pitfall #35 correctly applied). `validate_migrations.py --strict`: 650
revisions, single head `a8c3b50b6d9b`, PASSED.

### Route surface re-enumerated — unchanged

`integrations.py` 11, `salesforce_sync.py` 9, `calcom_sync.py` 1,
`mcp_keys.py` 4, `google_workspace.py` 4, `google_calendar_oauth.py` 2,
`outlook_calendar_oauth.py` 2, `app/api/public/calendar.py` 2,
`integrations_webhook.py` 2, `salesforce_webhook.py` 1 — identical to pass
8's count; no new endpoint added this pass (every new mechanism above is
reached through existing routes, the scheduler, or a session-level hook).
`check_route_permissions.py --strict`: 274 application routes, 0
errors/warnings.

### Re-verified from passes 1–8 (all hold)

- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist): unchanged, still an
  explicit owner decision.
- **INT-11** (Salesforce "clear the refresh token"): confirmed FIXED since
  pass 8, unchanged.
- INT-2, INT-3, INT-4, INT-6, INT-8; SOQL injection defense, instance-URL
  domain pinning, secret handling, webhook replay dedup, module gating, the
  DNS-rebinding transport pin, the wall-clock deadline, Retry Sync's
  lock-then-read ordering, the PayPal backfill's idempotency: none of the
  files carrying them changed since pass 8 per the diff above.
- **LIKE-pattern usage, CSV export**: none in this feature's scope, same as
  every prior pass.
- **`docs/KNOWN_LIMITATIONS.md`**: the Microsoft 365 and Google Workspace
  entries already correctly document every owner decision this pass's
  commits made (`suspend_on_retirement` off-by-default, secret-expiry
  manual entry, long-suspension listing-only, rename scope) — all dated
  2026-10-23, matching the commits; nothing to add or correct.

## Guard tests added

None by this pass — every new mechanism shipped with its own dedicated test
file before this pass started (`test_directory_retirement.py`,
`test_directory_group_removal.py`, `test_directory_long_suspended.py`,
`test_directory_rename.py`, `test_microsoft_365_secret_expiry.py`), all
re-run as part of the scoped suite below and confirmed passing.

## Completion gate (pass 9)

| Check                                                                                                                                                                                                                                                | Result                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                        | ✅ 0 violations                                                                                                                              |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                 | ✅ 2610 files unchanged                                                                                                                      |
| `isort --check-only app/ tests/ alembic/` (CI-pinned 9.0.1)                                                                                                                                                                                          | ✅ clean                                                                                                                                     |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                    | ✅ 650 revisions, single head `a8c3b50b6d9b`, PASSED                                                                                         |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                | ✅ 274 routes, 0 errors/warnings                                                                                                             |
| backend tests, scope (`-k "integration or salesforce or calcom or documenso or paypal or webhook or connector or mcp_key or google_calendar or google_workspace or ical or calendar or outlook or directory_account or microsoft_365 or directory"`) | ✅ 8397 passed, 22 skipped (environment-only — `pywebpush`, Docker daemon/registry, opt-in API-contract suite, no-timezone-tables), 0 failed |
| `npm run typecheck` (frontend)                                                                                                                                                                                                                       | ✅ 0 errors                                                                                                                                  |
| `npm run lint` (frontend)                                                                                                                                                                                                                            | ✅ exit 0, 0 warnings                                                                                                                        |

---

## Pass 8 (2026-10-20) — directory-account engine generalized, Microsoft 365 added, Outlook calendar OAuth connect; 0 fixes, 0 new findings; one stale finding corrected (INT-11 closed)

Step 0: `search_pull_requests` (`is:pr is:open head:claude/security-review-`)
returned 0 results immediately before starting, and again immediately before
branching — PR #3458 (Feature 26, Forms, pass 8) had just merged with nothing
started for Feature 27 since.

**Real delta since pass 7's baseline (`715c4b3f`, PR #3375):** four real
(non-merge-noise) commits touch this feature's scope — a fifth, `381e8ffc`,
is a merge bringing in history already reviewed on a long-lived branch,
confirmed by its reported file sizes matching pass 7's own documented state
exactly, so it is not a real delta:

| Commit                           | What                                                                                                                                                                                                                                                                 | Disposition                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `24061bc6`                       | Outlook calendar publishing via a Microsoft sign-in (OAuth + PKCE), extracting the shared state/nonce/PKCE machinery into a new `calendar_oauth_common.py` and refactoring Google Calendar's OAuth onto the same module                                              | Read in full, clean                                                                       |
| `b1ae3236`                       | Generalizes the Google-only provisioning engine into a provider-neutral `directory_account_service.py` (`google_workspace_provisioning_service.py` → renamed; `models/google_workspace*.py` → `models/directory_account*.py`; `google_user_id` → `external_user_id`) | Read in full, clean                                                                       |
| `d5c8f664`                       | Adds Microsoft 365 as the second directory provider (Microsoft Graph via the client-credentials flow)                                                                                                                                                                | Read in full, clean                                                                       |
| `86387e0e` (workflow-review W73) | `integrations.py` gains `_missing_required_fields`, refusing a connect that leaves a required setting neither sent nor stored (and flags, per W73-5/Pitfall #19, that the separate "iCalendar (ICS)" catalog entry is a switch with no reader)                       | Correctness fix already reviewed by workflow-review; re-verified no access-control change |

### The directory-account engine, generalized — read in full

`directory_account_service.py` (1202 L), `models/directory_account.py` (134
L) and `models/directory_account_departure.py` (233 L, the session-level
`before_flush`/`after_commit` hook, now provider-neutral). Every by-id path
still filters `organization_id` and (`user_id` or `provision_id`) in one
query (`_load`, 14a) — re-verified for `get_for_user`, `provision`, `retry`
and `suspend_detached`. `link_existing_members` takes no client-supplied FK:
it matches the org's own member roster against the directory's own listing,
links one account to at most one member (an address matching two members
links neither — owner decision, 2026-10-17), and a repeated run with
`expected` set refuses rather than linking a roster that changed underneath
it. The departure hook's hard-delete capture (`_capture_before_hard_delete`)
and the Session-level `before_flush`/`after_commit` pair are unchanged in
mechanism from pass 7's review of the Google-only version — generalizing to
a `provider` column changed no query shape.

### Microsoft 365 — new provider, read in full

`microsoft_365_service.py` (593 L). Client-credentials OAuth reuses
`app/utils/microsoft_oauth.py` (shared with Microsoft 365 SMTP, now gaining
an optional scope parameter — SMTP keeps its Exchange default, confirmed by
reading the diff). Every Graph call goes through `create_integration_client`
(the SSRF-pinned, deadline-bounded transport this feature's other connectors
already use — not a second, unreviewed HTTP path). OData `$filter` values are
escaped via `_odata_string` (doubles embedded single quotes) before being
interpolated into a filter string, mirroring this feature's existing SOQL
defense for Salesforce. A paging `@odata.nextLink` is only followed when it
starts with the fixed `GRAPH_BASE + "/"` — a response cannot redirect the
bearer-token-bearing request elsewhere. Error translation (`_translate`)
classifies by HTTP status and Graph's own `error.code`/`error.message` but
never echoes either back to the caller — matching this feature's existing
rule that provider error bodies are not shown or logged verbatim. Accounts
are tagged with `member_id` in `extensionAttribute15` at creation (one
request, so a retry's "already exists" can be told from a stranger's
account at the address without a second call). On-premises-synced accounts
are never blocked or reset through Graph (`Microsoft365ManagedOnPremisesError`).
`Microsoft365Config` (`schemas/integration.py`): `extra="forbid"`;
`client_secret` length/control-character capped and already in
`SECRET_CONFIG_KEYS` (shared key, pre-existing — encrypted at rest, never
echoed back); `tenant_id`/`client_id` validated through the existing
`microsoft_oauth` validators; `domain`/`usage_location`/`license_sku_id`
regex-checked; `groups` deduplicated and capped at 20.
`_require_directory_admin` (renamed from `_require_google_workspace_admin`)
and `_check_directory_ready` (renamed from `_check_google_workspace_ready`)
apply the same `admin.access` gate and domain/credential/single-directory
checks to both providers uniformly — confirmed by direct read, not inferred
from the rename.

### Outlook Calendar OAuth connect — new, read in full

`outlook_calendar_oauth.py` (229 L) mirrors `google_calendar_oauth.py`'s
structure exactly, both now built on the shared `calendar_oauth_common.py`
(422 L). A connect attempt is bound three ways, each checked by
`open_callback`: (1) a signed, 10-minute-TTL JWT `state` (HS256,
`settings.SECRET_KEY`) naming the organization, integration, administrator
and a random nonce, with a per-provider `purpose` claim so one provider's
state cannot complete the other's attempt; (2) the nonce double-submitted
through an httpOnly, `SameSite=Lax`, path-scoped cookie (`secrets.compare_digest`,
constant-time) — `_COOKIE_PATH` ends in a slash per Pitfall #6 and covers
only this router; (3) the same nonce, administrator id and PKCE verifier
stored as a single pending attempt on the integration row, consumed
(removed) and committed _before_ any network call, so a replayed state finds
nothing to use and a lock is never held across the token exchange. Token
exchange (`exchange_code`) binds the redirect_uri to the one used at
`/oauth/start`, requires PKCE's `code_verifier`, goes through
`create_integration_client`, and never echoes Microsoft's error body.
`_account_email` reads the ID token's claims unverified (per OIDC Core
3.1.3.7 — received directly from the token endpoint over TLS) but still
checks `aud` against the client id and `iss` against the Microsoft identity
platform v2 issuer pattern before trusting it, and uses it only as a display
label. `may_still_manage` re-checks the administrator still holds
`integrations.manage` at callback time, not just at `/oauth/start`. The
callback route itself is intentionally unauthenticated (Microsoft redirects
the bare browser back, whose session may have lapsed); every other check
above is the compensating control (checklist §1).

### Checked, no new finding

- **New migrations** (`73594b326e68`, `d3bb8f81ed07`): both guard the
  table's existence first (Pitfall #26); no new `ondelete="SET NULL"` column
  (the one FK, `created_by`, was already `nullable=True` from pass 7).
  `validate_migrations.py --strict`: single head, confirmed below.
- **Route surface re-enumerated programmatically**: `integrations.py` 11
  (unchanged), `salesforce_sync.py` 9, `calcom_sync.py` 1, `mcp_keys.py` 4,
  `google_workspace.py` 4 (unchanged), `google_calendar_oauth.py` 2
  (unchanged — refactored internals only), **`outlook_calendar_oauth.py` 2
  (new)**, `app/api/public/calendar.py` 2, `integrations_webhook.py` 2,
  `salesforce_webhook.py` 1. Net **+2 routes** since pass 7, both the new
  Outlook OAuth pair reviewed above; every other file's count is unchanged.
- **LIKE-pattern usage, CSV export**: none in this feature's scope, same as
  every prior pass.
- **Frontend** (`IntegrationsPage.tsx`, `calendarProviders.ts` — new, 83 L):
  no `window.confirm`/`alert`/`prompt`, no `dangerouslySetInnerHTML`, no bare
  `??` on an optional form value anywhere touched this pass; error codes
  returned from a failed OAuth connect are mapped through a fixed
  `Record<string, string>` (`calendarConnectError`), never interpolated into
  markup.

### Correction to a standing finding — INT-11 is FIXED, not open

**INT-11** ("Salesforce 'clear the refresh token' has no reachable UI
control") was carried forward as **OPEN** through passes 6 and 7, including
pass 7's explicit note that "no clear control added this pass." Checking the
actual commit pass 7 reviewed (`715c4b3f`) directly —
`git show 715c4b3f:frontend/src/pages/IntegrationsPage.tsx` — shows
`handleSwitchSalesforceToClientCredentials` already present at that exact
commit: a confirmed (`useConfirm()`, not `window.confirm`), reachable button
that calls `updateIntegration(id, {refresh_token: ''})`, which the backend
treats as "switch to the client-credentials flow" and discards the stored
tokens. It remains present and wired to a button
(`IntegrationsPage.tsx:2663`) today. This was a review error repeated across
two passes — the control was never actually missing — not a code
regression introduced and later fixed. **INT-11 is now marked ✅ FIXED.**

### Re-verified from passes 1–7 (all hold)

- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist): unchanged, still
  an explicit owner decision.
- INT-2, INT-3, INT-4, INT-6, INT-8; SOQL injection defense, instance-URL
  domain pinning, secret handling, webhook replay dedup, module gating, the
  DNS-rebinding transport pin, the wall-clock deadline, Retry Sync's
  lock-then-read ordering, the PayPal backfill's idempotency: none of the
  files carrying them changed since pass 7 per the diff above; re-confirmed
  by direct read where this pass's own changes touched the same file.
- **W73-5 / `KNOWN_LIMITATIONS.md`** ("Integrations — Connecting iCalendar
  (ICS) Does Nothing"): re-confirmed open, owner-decision item, unchanged —
  and distinct from the working, pass-7-reviewed department iCalendar feed
  (`/org/{token}.ics`), which is unaffected.

**Route surface**: see the enumeration above — net +2 since pass 7.

## Schema & migration notes (pass 8)

Two migrations since pass 7: `73594b326e68` (renames
`google_account_provisions` → `directory_account_provisions`, adds
`provider` `NOT NULL DEFAULT 'google'`), `d3bb8f81ed07` (`license_pending`,
`managed_on_premises`, both `NOT NULL DEFAULT 0`). Both guard the table's
existence before touching it (Pitfall #26); the rename migration also
guards against a `create_all`-built empty table already sitting under the
new name, and its downgrade deletes non-Google rows first since the old
table has no `provider` column to read them back correctly.
`validate_migrations.py --strict`: 631 revisions, single head
`ca0c2111466f`, PASSED.

## Guard tests added

None by this pass — every new mechanism above shipped with its own test
coverage before this pass started (`test_directory_account_provisions_migration.py`,
`test_directory_account_flags_migration.py`, `test_outlook_calendar_connect.py`,
`test_google_workspace_provisioning.py`); re-run as part of the scoped suite
below and confirmed still passing.

## Completion gate (pass 8)

| Check                                                                                                                                                                                                                                   | Result                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                           | ✅ 0 violations                                                                                                                              |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                    | ✅ 2476 files unchanged                                                                                                                      |
| `isort --check-only app/ tests/ alembic/` (CI-pinned 9.0.1)                                                                                                                                                                             | ✅ clean                                                                                                                                     |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                       | ✅ 631 revisions, single head, PASSED                                                                                                        |
| backend tests, scope (`-k "integration or salesforce or calcom or documenso or paypal or webhook or connector or mcp_key or google_calendar or google_workspace or ical or calendar or outlook or directory_account or microsoft_365"`) | ✅ 7573 passed, 22 skipped (environment-only — `pywebpush`, Docker daemon/registry, opt-in API-contract suite, no-timezone-tables), 0 failed |
| `npm run typecheck` (frontend)                                                                                                                                                                                                          | ✅ 0 errors                                                                                                                                  |
| `npm run lint` (frontend)                                                                                                                                                                                                               | ✅ exit 0, 0 warnings                                                                                                                        |

---

## Pass 7 (2026-10-17) — a whole previously-unreviewed sub-feature (Google Workspace account provisioning) read in full; 0 new findings

Step 0: `list_pull_requests` (state=open) returned no PR whose head branch
starts with `claude/security-review-` before this pass began — PR #3374
(Feature 26, Forms, pass 7) had just merged with nothing started for
Feature 27 since.

**Real delta since pass 6's baseline (`7f521f66`, PR #2988):** `git diff
7f521f66..HEAD` against every file this feature owns (plus the files found
below) shows `integrations.py` 1119→1627 L (+2 routes: the department
iCalendar feed's token issue/rotate), `app/api/public/calendar.py` +172 L
(a second, new public feed), `app/services/integration_services/ical_service.py`
+48 L (the new feed's HMAC token digest), three new calendar connector files
(`calendar_common.py`, `google_calendar_oauth_service.py`,
`google_workspace_service.py`), `outlook_calendar_service.py` substantially
rewritten (now OAuth-based, was API-key based), and three new migrations
(`c869ec90a41b` calendar sync mappings, `61dfbcc23cba` Google Workspace
provisioning records, `64bf75298e89` a timestamp column on the latter).

**Read in full, newly, because `grep -rln "GoogleAccountProvision"
backend/app/` turned up a sub-feature no prior pass's file list names and
no dedicated findings doc covers:** `app/api/v1/endpoints/google_workspace.py`
(227 L, 4 routes — entirely new, first commit `90b69e62`),
`app/services/google_workspace_provisioning_service.py` (1052 L — the
account-creation/retry/link-existing/suspension-reconciliation logic),
`app/models/google_workspace_departure.py` (226 L — the session-level
`before_flush`/`after_commit` hook that stages a suspend/unsuspend the
instant any path moves `User.status`/`deleted_at` across the departed
line), and `app/services/google_workspace_attention_digest.py` (182 L — the
daily "needs attention" email). This is the Google Workspace integration's
entire per-member account lifecycle; `GOOGLE_WORKSPACE_INTEGRATION`'s own
connect/disconnect/patch surface on `integrations.py` was already in pass
6's scope and is re-verified below, not re-derived.

**Read in full:** the new/changed files above, plus `app/api/public/calendar.py`
in full (both routes) and `app/services/integration_services/ical_service.py`
in full. **Spot-verified against pass 6's documented state** (file sizes
and `git log --since` confirm no commit touched them between 2026-10-07 and
today): `salesforce_sync.py`, `calcom_sync.py`, `mcp_keys.py`, the three
webhook files, `models/integration.py`, `schemas/integration.py`'s
pre-existing classes, `paypal_backfill_service.py`, `integration_health.py`.
**Out of scope, per pass 6's own established precedent** (dedicated,
contemporaneous review elsewhere): `app/mcp/oauth.py` and the
`registry.py`/`principal.py` wiring
([`MCPO-27-mcp-oauth-server.md`](./MCPO-27-mcp-oauth-server.md)); the MCP
write tools added since pass 6 (`mcp/tools/medical_supplies.py` and the
`meetings.py`/`scheduling.py`/`elections.py`/`training.py`/`inventory.py`/
`documents.py` tool diffs) are each that feature's own write-surface, not
re-derived here (the pass-5 catch-up that temporarily reviewed MCP write
tools from this rotation was a one-time gap-fill, not a standing scope
addition — MCPO-27 and each feature's own pass now cover their own tools).

### Department iCalendar feed (`/org/{token}.ics`) — new, clean

Checklist §1 (intentionally public, token-scoped): the route carries no
auth dependency by design — calendar apps cannot send cookies — and is
compensated by an unguessable 48-byte `secrets.token_urlsafe` token,
checked for a plausible shape (`_plausible_token`, 32–64 chars) **before**
any DB work, then matched against a stored SHA-256 digest with
`hmac.compare_digest` (constant-time) rather than a value lookup. A 429
rate limit (60/min/IP) sits in front of the DB-heavy feed generation.
Checklist §3/§5 (tenant isolation / exposure): the row found by the token
carries its own `organization_id`, and `_org_feed_event` is an explicit
allowlist (title, times, location **name**, type, a link) — no description,
attendees, RSVPs, custom fields or organizer, so the feed cannot leak more
than what an anonymous link is meant to carry even though it is served
with no per-request auth. Checklist §4 (injection): `_escape_ics` folds
every line-break variant to `\n` (an un-escaped bare `\r` is the known
ICS-injection vector — a parser that treats a lone CR as a line end lets a
crafted event title/description inject arbitrary calendar properties) and
the new `URL:` property strips line breaks without comma/semicolon
escaping, correctly: `URL` is a `URI` value type under RFC 5545, not
`TEXT`, so that escaping does not apply to it. The feed is bounded
(`ORG_FEED_MAX_EVENTS = 2000`, a 30-day-past/365-day-future window).
Token issue/rotate (`GET`/`POST .../ical-feed{,/rotate}`) are both gated on
`integrations.manage` and resolve through `_get_org_integration(...,
lock=True)`, filtering `id` and `organization_id` in one query (14a).

### Google Workspace account provisioning — a whole sub-feature, reviewed for the first time

**Endpoints** (`google_workspace.py`, registered at
`/integrations/google-workspace`, module-gated on `integrations`):
`GET /members/{user_id}` and `POST /members/{user_id}/retry` require
`members.manage`; `GET /attention` requires `integrations.manage`;
`POST /link-existing` requires **both** `integrations.manage` and
`admin.access` — correctly, since a linked account is one the department
will later suspend on the member's behalf (same owner-decided bar as
connecting the integration). Retry and link-existing are both
rate-limited (`check_rate_limit`, 10/min and 20/min respectively) ahead of
their Google calls. Every lookup goes through the service's `_load()`
helper, which filters `organization_id` **and** (`user_id` or
`provision_id`) in the same `select()` — 14a satisfied for all four
routes, including the two that take a client-supplied `user_id` straight
from the path. No response schema (`GoogleAccountResponse`) carries a
password or the service-account key; a reset password is only ever
emailed (`send_credentials_email`), never returned in the API response —
confirmed by reading `_to_response()`'s explicit field list. Google
Workspace's own connect/disconnect/patch on `integrations.py` already
carries `_require_google_workspace_admin` (requires `admin.access` in
addition to `integrations.manage`, since the service-account key is
domain-wide) and `_check_google_workspace_ready` (refuses a config that
could never create an account — no key, or the configured domain doesn't
match an enabled department-email domain); both re-verified intact,
unchanged since pass 6 introduced them.

**The departure hook** (`google_workspace_departure.py`) is a
`Session`-level `before_flush`/`after_commit` pair, not a new externally
reachable surface: it watches every flush for a `User` whose
`status`/`deleted_at` crosses the departed line (dropped, archived, or
hard-deleted) from _any_ code path — "status endpoint, undo-drop,
reactivation, auto-archive, soft and hard delete, anonymization… and any
future path" per its own docstring — and stages a suspend/unsuspend
request on that member's `GoogleAccountProvision` row inside the same
transaction, so no caller can forget to do it. Google itself is never
called from inside that transaction; the actual suspend/unsuspend runs
from an `after_commit` background task (same pattern the audit chain's
sealer uses), with the `google_workspace_suspension_sync` scheduled task
as the backstop and `after_soft_rollback` clearing staged work a rolled-back
transaction never committed. A hard delete is handled specially
(`_capture_before_hard_delete`): the account row is `ON DELETE CASCADE`,
so it would be gone before the suspend could read it, and the service
captures the Google-side key (`google_user_id` or `primary_email`) before
the delete commits. No new finding — this is a correctness/invariant
mechanism, not a new attacker-reachable endpoint, and its one externally
visible effect (a suspend eventually happening) is strictly narrower than
what the triggering endpoints (drop/delete/archive) already required.

**The attention digest** (`google_workspace_attention_digest.py`) sends at
most one email per department per day, only to members holding
`admin.access` (`_administrators`, same permission the rest of this
sub-feature uses as its bar), and only for items its own list already
reports overdue — it calls `GoogleWorkspaceProvisioningService.attention_items()`
rather than re-deriving the overdue computation, with its own docstring
citing Pitfall #29 for exactly that reason. Every interpolated value in the
HTML body (`member_name`, `primary_email`, `label`, `detail`, and both
URLs) is `html.escape`d. The "last sent" marker is written back via
`copy.deepcopy(organization.settings or {})` before reassignment — Pitfall
#12's correct pattern for a nested JSON-column mutation, not a shallow
`dict()` copy.

### Checked, no new finding

- **New migrations**: all three guard the table/column's existence before
  touching it (`c869ec90a41b` returns early if `integrations` itself
  doesn't exist yet — a `create_all`-only table, Pitfall #26 — before even
  checking for its own table; `61dfbcc23cba` and `64bf75298e89` guard the
  same way). `61dfbcc23cba`'s one `ondelete="SET NULL"` column
  (`created_by`) is `nullable=True` (Pitfall #2). `64bf75298e89`'s backfill
  only stamps rows already `suspension_settled = 0`, matching its own
  docstring's reasoning for why `updated_at` can't substitute.
  `validate_migrations.py --strict`: single head, confirmed below.
- **New calendar connectors use the hardened transport**: both
  `outlook_calendar_service.py` and `google_calendar_oauth_service.py`
  default their `client_factory` parameter to `create_integration_client`
  (confirmed by direct read of both files' constructors) — the same
  SSRF-pinning, deadline-bounded, response-size-capped transport INT-1/7/9
  closed for this feature's other connectors, not a second, unreviewed
  HTTP path.
- **`GoogleWorkspaceConfig` schema** (`schemas/integration.py`): `extra="forbid"`;
  `service_account_key` is size-capped (`_MAX_SERVICE_ACCOUNT_KEY_BYTES`),
  parsed as JSON, and checked for `type == "service_account"` plus the
  three fields Google's own client library requires, so a malformed or
  non-service-account upload is rejected by the schema, not the connector
  at call time. `service_account_key` is in `SECRET_CONFIG_KEYS`
  (`schemas/integration.py:422`) alongside the existing set, so it is
  encrypted at rest and never echoed back on read, same as every other
  secret this feature stores.
- **Frontend** (`IntegrationsPage.tsx`, +606 L since pass 6): the new
  `service_account_key: gwsServiceAccountKey || undefined` follows the
  `||`-not-`??` form (Pitfall #1); no `dangerouslySetInnerHTML`, no
  `window.confirm`/`alert`/`prompt` introduced.
- **LIKE-pattern usage, CSV export**: none in this feature's scope, same
  as every prior pass.

### Re-verified from passes 1–6 (all hold)

- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist in
  `app/utils/url_validator.py`): unchanged, still an explicit owner
  decision.
- **INT-11** (Salesforce "clear the refresh token" has no reachable UI
  control): **still open, unchanged.** `IntegrationsPage.tsx:708` (moved
  from pass 6's `:593` as the file grew) still builds
  `refresh_token: sfRefreshToken || undefined`; no clear control added
  this pass.
- Every other pass 1–6 finding (INT-2, INT-3, INT-4, INT-6, INT-8; SOQL
  injection defense, instance-URL domain pinning, secret handling, webhook
  replay dedup, module gating, the DNS-rebinding transport pin, the
  wall-clock deadline, Retry Sync's lock-then-read ordering, the PayPal
  backfill's idempotency): none of the files carrying them changed since
  pass 6 per the diff above; re-confirmed by direct read where this pass's
  own changes touched the same file (`integrations.py`), unchanged
  elsewhere.

**Route surface**: `integrations.py` 9→11 (+2: `ical-feed`,
`ical-feed/rotate`, both `integrations.manage` + id-and-org filtered).
`app/api/public/calendar.py` 1→2 (+1: `/org/{token}.ics`, public,
token-scoped — see above). `google_workspace.py`: 0→4, new this pass, all
four gated as described above. `salesforce_sync.py` (9), `calcom_sync.py`
(1), `mcp_keys.py` (4), the three non-calendar public webhook files (4)
unchanged from pass 6's count.

## Schema & migration notes (pass 7)

Three migrations since pass 6: `c869ec90a41b` (`calendar_sync_mappings`),
`61dfbcc23cba` (`google_account_provisions`), `64bf75298e89`
(`google_account_provisions.suspension_requested_at`, backfilled for rows
already `suspension_settled = 0`). `validate_migrations.py --strict`: 612
revisions, single head `c87efd81c5aa`, PASSED.

## Guard tests added

None by this pass — every new mechanism above already shipped with its own
test coverage before this pass started; re-run as part of the scoped suite
below and confirmed still passing.

## Completion gate (pass 7)

| Check                                                                                                                                                                                  | Result                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                                                                                                                          | ✅ 0 violations                                                                                                          |
| `black --check app/ tests/ alembic/`                                                                                                                                                   | ✅ 2400 files unchanged                                                                                                  |
| `isort --check-only app/ tests/ alembic/` (CI-pinned 9.0.1)                                                                                                                            | ✅ clean                                                                                                                 |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                      | ✅ 612 revisions, single head, PASSED                                                                                    |
| backend tests, scope (`-k "integration or salesforce or calcom or documenso or paypal or webhook or connector or mcp_key or google_calendar or google_workspace or ical or calendar"`) | ✅ 6980 passed, 21 skipped (environment-only — `pywebpush`, Docker daemon/registry, opt-in API-contract suite), 0 failed |
| `npm run typecheck` (frontend)                                                                                                                                                         | ✅ 0 errors                                                                                                              |
| `npm run lint` (frontend)                                                                                                                                                              | ✅ exit 0, 0 warnings                                                                                                    |

---

## Pass 6 (2026-10-07) — watchdog pickup; real delta since pass 5, mostly already reviewed elsewhere; 0 new findings this pass

Watchdog pickup: PR #2986 (Feature 26, Forms, pass 6) merged at 18:30:01 UTC —
74 minutes before this iteration started, with nothing new begun for Feature
27 since. Confirmed via `list_pull_requests` (state=open) that no PR whose
head branch starts with `claude/security-review-` existed, both before
starting and again before this PR was opened.

**Scope of growth since pass 5 (`bf0a45a6`, 2026-10-04):** `git log
bf0a45a6..HEAD` against every file this feature owns turns up only two
commits in the squashed-merge log, but a direct `git diff bf0a45a6..HEAD`
(the reliable signal per pass 3/4/5's own prior correction of the same `git
log` artifact) shows a real, substantial delta: `integrations.py` 849→1119 L
(+2 routes), `salesforce_sync.py` 585→680 L, `models/integration.py` +73 L,
`schemas/integration.py` +18 L, `integration_services/base.py` +107 L,
`integration_services/paypal_service.py` +171 L,
`integration_services/google_calendar_service.py` +145 L,
`integration_services/notification_dispatch.py` +40 L,
`integration_services/salesforce_sync_service.py` +27 L,
`mcp/keys.py` refactored (+60/-48, behavior-preserving — see below),
`IntegrationsPage.tsx` +86 L (mostly unrelated mobile-touch-target and
search-box-width fixes), plus two entirely new files not in any prior pass's
file list: `app/services/integration_health.py` (263 L, new) and
`app/services/paypal_backfill_service.py` (215 L, new).

**Read in full, newly:** both new files above, every diffed hunk in the
files listed, the new migration
(`20261005_1830_4e8b1c6d2a90_add_integration_health.py`), and
`app/utils/ssrf_transport.py` (179 L, new since pass 5) — the SSRF-pinning
transport `create_integration_client()` now wraps every connector in.
**Spot-checked against its own documentation rather than re-derived:**
`app/mcp/oauth.py` (1327 L, new) and the `mcp/registry.py`/`mcp/principal.py`
changes that wire it in — these already have their own dedicated,
contemporaneous threat-model review,
[`MCPO-27-mcp-oauth-server.md`](./MCPO-27-mcp-oauth-server.md) (2026-10-06,
owner-decided `L` effort build), outside this rotation's numbering; nothing
in `app/mcp/oauth.py` is in this feature's declared file list (`integrations.py`,
`salesforce_sync.py`) and re-deriving a second review of the same 1327-line
authorization server here would be exactly the Pitfall #29 mistake this
rotation exists to avoid. `mcp/keys.py`'s refactor (extracting
`resolve_department_access`, shared by the service-key and OAuth-token
paths) is confirmed, by direct read, to be a pure extraction — same checks,
same order, same fail-closed messages, same org-scoping — matching
MCPO-27's own claim that this path is "unchanged behaviour."

### The real delta is almost entirely new hardening, not new attack surface

Three features landed since pass 5, none of them opened by this rotation,
all independently well-documented:

1. **Integration health tracking** (`integration_health.py`, new
   `IntegrationSyncLog` table, two new routes on `integrations.py`). Every
   outbound run — a sync, a connection test, a chat delivery — is now
   recorded with a sanitized error message (`sanitize_integration_error`:
   strips URLs, emails, bearer tokens, long token-shaped strings, caps at
   300 chars) and an integer-only `summary` (`summarize_counts` drops
   anything that isn't an int, so no member name or contact detail can land
   in the history). History is pruned to the last 50 runs per integration
   on every write (Pitfall #9 — bounded, no unbounded growth). Both new
   routes (`GET /{id}/sync-history`, `POST /{id}/retry-sync`) require
   `integrations.manage` and resolve their target through
   `_get_org_integration(db, id, organization_id)` — id+org filtered in the
   same query (checklist 14a). `/integrations` is already in
   `UNCACHEABLE_PREFIXES` as a prefix, so both new routes inherit the
   no-cache exclusion without a frontend change.

   **Retry Sync's concurrency control matches Pitfall #27 exactly, in the
   order that avoids its own warning.** `_get_org_integration(..., lock=True)`
   issues `SELECT ... FOR UPDATE` on the integration row as the _first_
   query in the transaction — a locking read, which in MySQL's REPEATABLE
   READ does not itself establish the transaction's consistent-read
   snapshot. The cooldown check that follows (`SELECT
IntegrationSyncLog.started_at ... ORDER BY started_at DESC LIMIT 1`) is
   therefore the first _plain_ read, and its snapshot is taken only once
   the row lock is held — not before, which is the specific failure Pitfall
   #27 describes (a snapshot predating the lock). A concurrent retry blocks
   on the row lock, and once the first commits, the second's own first-plain-read
   snapshot is taken after that commit, so it correctly sees the fresh
   "running"/"retry" log row and is refused with 429. The lock window is
   short by design — released at the `db.commit()` immediately after the
   cooldown check and the `start_integration_run` insert, _before_ the
   provider is ever called — so a slow Salesforce sync does not hold the
   row lock for its duration. A caller-IP rate limit (`check_rate_limit`,
   10/min, 300s lockout) sits in front of the lock as a second, independent
   layer. Verified by direct read, not merely by the docstring's own claim.

2. **SSRF connection pinning, closing the DNS-rebinding TOCTOU gap this
   file has carried as "narrowed, not closed" since INT-1 (pass 1)** —
   `app/utils/ssrf_transport.py`'s `SSRFSafeAsyncTransport`, wrapped into
   `create_integration_client()` (`base.py`). This is **not new to this
   pass**: it shipped 2026-10-05 under SCH-10 (Scheduling's own rotation
   pass, `docs/security-review/SCH-15-scheduling.md`), is already recorded
   as resolved in `docs/KNOWN_LIMITATIONS.md`'s "Outbound Integration
   Requests" entry, and that entry already correctly attributes the count
   and the Documenso-specific piece to this file's own pass 4. Re-verified
   directly against the current code for this feature's own six connectors
   (`salesforce`, `salesforce_oauth`, `paypal`, `calcom`, `documenso`,
   `webhook`) rather than trusting the citation: `create_integration_client()`
   wraps `SSRFSafeAsyncTransport(transport=httpx.AsyncHTTPTransport(...),
allow_private=allow_private_destinations)`, which resolves the request's
   host exactly once (off the event loop, via `asyncio.to_thread`), refuses
   a non-global/multicast answer, and connects to the validated address
   while keeping the original hostname for the `Host` header and TLS
   SNI — so there is no second, independent resolution for a DNS-rebinding
   attacker to win. The known residual (an egress-proxied deployment, where
   the proxy — not this transport — resolves the destination) is
   unchanged and already documented. No new finding; re-verification only.
3. **A wall-clock deadline on every `httpx`-based integration call**
   (`INTEGRATION_DEADLINE_SECONDS = 60.0`, `_DeadlineAsyncClient.send()`
   wrapped in `asyncio.timeout()`) — closes the slow-drip gap INT-7's own
   "Timeout semantics corrected" note (pass 3) flagged as still open
   (`httpx.Timeout`'s per-read budget resets on every chunk, so a server
   trickling one byte every few seconds could hold a connection open
   indefinitely even though `MAX_RESPONSE_SIZE` bounds memory). Also not
   new to this pass — already reflected in `base.py`'s own comment, which
   this pass re-read and confirmed matches the code.
4. **Google Calendar's connector gains the same response-size cap and
   socket timeouts every other connector gets from `create_integration_client()`**
   (`_BoundedHttp`/`_CappedHTTPResponse`/`_BoundedHTTPSConnection` wrapping
   `httplib2`, since this connector reaches Google via `googleapiclient` →
   `httplib2`, never `httpx`, so it never passed through that factory). This
   closes the size-cap and timeout halves of **INT-9**, open since pass 2.
   `docs/KNOWN_LIMITATIONS.md`'s INT-9 entry already correctly states this
   as "resolved 2026-10-05" and separately lists what remains open for this
   connector specifically (no wall-clock deadline — `httplib2` calls are
   synchronous, so `asyncio.timeout()` cannot wrap them; redirects follow
   `httplib2`'s own default; the library isn't pinned in `requirements.txt`).
   Re-verified by direct read of `_build_service()`'s `AuthorizedHttp(creds,
http=_BoundedHttp())` wiring and the capped-read logic; matches the
   documented mechanism exactly. No new finding.
5. **A PayPal reconciliation backfill** (`paypal_backfill_service.py`, new,
   invoked from `scheduled_tasks.py`, not from any endpoint) for captures
   the webhook missed when PayPal's verify API was briefly unreachable.
   Read in full: every PayPal call uses that integration's own credentials
   (`credentials_from_integration(integration)`), so an account can only
   discover its own transactions; every DB read/write is filtered on or
   stamped with `organization_id`; `fetch_completed_capture` URL-encodes
   the PayPal-supplied capture id before it reaches the request path
   (`quote(capture_id, safe='')`) even though that id originates from
   PayPal's own Transaction Search response, not end-user input; and
   idempotency with the webhook is structural rather than assumed — both
   paths call the same `StorefrontService.record_external_payment` entry
   point, which keys a payment on `(organization_id, provider,
external_id)`'s unique constraint, so a capture the webhook already
   recorded is dropped at the pre-filter step (`_already_recorded`) and one
   the webhook records _while_ the backfill is mid-run loses the race and
   is detected (`event.raw_payload != raw_payload`) rather than double-applied.
   `auto_apply_payments`'s semantics (only a literal `False` disables
   auto-settlement; a stray non-bool does not silently disable it) are
   centralized in the new `paypal_auto_apply()` helper and read identically
   by the webhook and the backfill — one definition, not two copies that
   could drift (Pitfall #29's shape, avoided here by construction). No
   endpoint exposes this path to a caller; it runs only from the scheduler
   against the org's own stored integration row.

### Re-verified from passes 1–5 (all hold)

- **INT-2** (OAuth `error` URL-encoded): intact, `salesforce_sync.py`.
- **INT-3** (list/get gated on `integrations.manage`; `/connected`
  status-only on bare auth, registered first): intact.
- **INT-4** (`exclude_unset` partial-PATCH merge): intact.
- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist): unchanged, still
  an explicit owner decision.
- **INT-6** (connector exception sanitization via `sanitize_connector_error`):
  intact; the new `sanitize_integration_error` (integration_health.py) is a
  distinct, stricter sanitizer for the health-history use case (also strips
  URLs/emails/bearer tokens, not just the exception-type allowlisting
  `sanitize_connector_error` does) and both are used at their own call
  sites, not in place of each other.
- **INT-8** (`http1`/`http2`/`cert` kwargs reaching the wrapped transport):
  intact.
- **INT-11** (Salesforce "clear the refresh token" has no reachable UI
  control): **still open, unchanged.** `IntegrationsPage.tsx:593` still
  builds `refresh_token: sfRefreshToken || undefined`; no new control added
  this pass. Still the product decision pass 4 named.
- **SOQL injection defense, instance-URL domain pinning, secret handling,
  frontend cache exclusion, webhook replay dedup, module gating**: all
  re-confirmed against current code, no change since pass 5.

### Checked, no new finding

- **New JSON column** (`IntegrationSyncLog.summary`): always written as a
  fresh dict from `summarize_counts()`, never read back and mutated in
  place — Pitfall #12 n/a.
- **New migration** (`4e8b1c6d2a90`): guards `integrations` not existing
  (create_all-only table, Pitfall #26) before touching it or creating
  `integration_sync_logs`; idempotent column/index adds; `triggered_by` FK
  is `ondelete="SET NULL"` and correctly `nullable=True` (Pitfall #2).
  `validate_migrations.py --strict`: single head, confirmed below.
- **LIKE-pattern usage, CSV export**: none in this feature's scope, same as
  every prior pass.
- **Route inventory**: `integrations.py` now 9 routes (+2:
  `GET /{id}/sync-history`, `POST /{id}/retry-sync`), both
  `integrations.manage` + id-and-org filtered. `salesforce_sync.py` (9),
  `calcom_sync.py` (1), `mcp_keys.py` (4), the three public webhook files
  (4) all unchanged from pass 5's count. `check_route_permissions.py
--strict`: 251 application routes, 0 errors/warnings.

## Schema & migration notes

One migration this pass (landed before this pass started, re-verified
here): `20261005_1830_4e8b1c6d2a90` adds `integrations.last_success_at`,
`last_error`, `last_error_at`, `consecutive_error_count` and the
`integration_sync_logs` table. `validate_migrations.py --strict`: 541
revisions, single head `95dbdfb6591d`, PASSED.

## Guard tests added

None by this pass — the hardening above shipped with its own guard tests
before this pass started (`test_integration_dns_pinning.py`,
`test_google_calendar_http_bounds.py`), re-run as part of the scoped suite
below and confirmed still passing.

## Completion gate (pass 6)

| Check                                                                                                                                          | Result                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                  | ✅ 0 violations                                               |
| `black --check app/ tests/ alembic/`                                                                                                           | ✅ 2034 files unchanged                                       |
| `isort --check-only app/ tests/ alembic/`                                                                                                      | ✅ clean                                                      |
| `python3 scripts/validate_migrations.py --strict`                                                                                              | ✅ 541 revisions, single head, PASSED                         |
| `python3 scripts/check_route_permissions.py --strict`                                                                                          | ✅ 251 routes, 0 errors/warnings                              |
| backend tests, scope (`-k "integration or salesforce or calcom or documenso or paypal or webhook or connector or mcp_key or google_calendar"`) | ✅ 4285 passed, 21 skipped (env-only — `pywebpush`), 0 failed |
| `npm run typecheck` (frontend)                                                                                                                 | ✅ 0 errors                                                   |
| `npm run lint` (frontend)                                                                                                                      | ✅ exit 0, 0 warnings                                         |

---

## Pass 5 (2026-10-04) — watchdog pickup; 0 fixes, 0 new findings; MCP write-tool surface reviewed per Feature 23's cross-reference

Watchdog pickup: confirmed via `list_pull_requests` (state=open) that no PR
whose head branch starts with `claude/security-review-` existed before
starting, and the two most recent rotation PRs (#2885 Feature 26 Forms pass
5, #2886 an unrelated fix) were already merged.

**Backend, read in full:** `app/api/v1/endpoints/integrations.py` (849 L, 7
routes), `salesforce_sync.py` (585 L, 9 routes), `calcom_sync.py` (73 L, 1
route), `mcp_keys.py` (244 L, 4 routes), `app/api/public/integrations_webhook.py`
(258 L), `salesforce_webhook.py` (246 L), `paypal_webhook.py` (153 L),
`models/integration.py`, `schemas/integration.py` (now 331 L — the +28 lines
since pass 4 are comments/docstrings only, confirmed by direct read, not a
functional change). **Spot-verified against pass 4's documented state rather
than re-read line-by-line** (file sizes and `git log --since` confirmed no
commit touched them between 2026-09-13 and today): every
`integration_services/*` file, `app/mcp/registry.py`, `app/mcp/principal.py`,
`app/mcp/keys.py`. **Read for the first time this pass, per the MCP
write-surface scope Feature 23 (pass 12, 2026-10-03) deferred here:**
`app/mcp/tools/writes.py` (all three write tools) and the service methods
each one calls into (`InventoryService.create_reorder_request` +
`_assert_reorder_fks_in_org`, `MeetingsService.create_action_item`,
`EventService.create_event`), `app/mcp/registry.py`'s gating/audit wrapper in
full.
**Frontend:** `pages/IntegrationsPage.tsx` (2082 L — re-read the Salesforce
config branch and the two commits that touched this file since pass 4;
both are copy-only, confirmed by diff), `hooks/useConnectedIntegrations.ts`
(re-read; the one change since pass 4, W07-1's module-disabled guard, is a
client-side UX fix with no data-exposure effect), `components/integrations/McpServiceKeyPanel.tsx`
(read in full for the first time this pass — no prior pass's file list named
it explicitly, though pass 4's frontend read covered the page that renders
it).
**Migrations:** none this pass (509 revisions, single head, unchanged).

### Scope

Three weeks have passed since pass 4 (2026-09-13). `git log --since
2026-09-13` against every file this feature owns turned up only three
commits: two frontend copy/styling changes to `IntegrationsPage.tsx`
(toast wording, a shared `card-grid` utility — read both diffs in full,
neither touches a config field, a permission, or a validator) and one
merge commit whose diff stat against `integration_services/*` is the same
"unrelated `git log` artifact of this environment's squashed history" pass
4 already documented for `integrations.py` (confirmed by re-reading every
file the stat listed; content identical to pass 4's). So this pass's
contribution is (a) re-verifying every standing finding directly against
current code rather than trusting the diff-based "nothing changed" signal,
and (b) the MCP write-tool surface Feature 23's pass 12 note pointed here.

**MCP write-tool surface (new to this file).** `app/mcp/tools/writes.py`
registers exactly three tools behind `gate="write"`: `create_event_draft`,
`create_meeting_action_item`, `create_reorder_request`. All three are
reachable only from a connection the department set to read/write
(`principal.can_write`, enforced in `registry.gate_allows`), and every
write commits as an unpublished draft, an unassigned action item, or a
pending reorder — nothing here publishes, approves, assigns, or sends.
Checked each against the same org-scoping/domain-pinning rigor the rest of
this feature is held to:

- **`principal.organization_id` is never client-supplied.** `McpKeyService.authenticate`
  (`app/mcp/keys.py:271-360`) resolves the principal from a hash lookup of
  the bearer value the connection presented (`select(McpServiceKey).where(
McpServiceKey.key_hash == hash_key(presented))`) and takes
  `organization_id` from the matched row — there is no argument on any
  tool call that could substitute a different org. `create_event_draft`
  passes `org_uuid(principal)` straight to `EventService.create_event`;
  no client-supplied FK to validate.
- **`create_meeting_action_item`'s `meeting_id` resolves through an
  org-scoped parent** — `MeetingsService.create_action_item`
  (`app/services/meetings_service.py:372-400`) calls `get_meeting_by_id(
meeting_id, organization_id)` before writing, the checklist-14a parent-
  resolution shape. The tool itself never sets `assigned_to`, so the
  service's own `assert_in_org` check on that field (MM-4) is `allow_none`
  on every call from this surface.
- **`create_reorder_request`'s client-supplied `item_id`/`category_id`
  are validated in-org independently of the medical-domain check.**
  `writes.py` calls `InventoryService.item_in_domain`/`category_in_domain`
  to refuse a request that names a medical item — correctly scoped to
  `(id, organization_id, item_types)`, so a cross-org id simply isn't
  found and isn't flagged "medical." That looked, on first read, like it
  might let a cross-org id slip past the medical check and reach storage
  unvalidated. It does not: `InventoryService.create_reorder_request` separately
  calls `_assert_reorder_fks_in_org` (`inventory_service.py:8431-8463`),
  which runs `assert_in_org` (`app/utils/org_scoping.py`) against
  `item_id`/`category_id`/`vendor_id` before the row is ever constructed,
  fails closed with a generic "not found"-shaped `ValueError` (no
  cross-tenant existence oracle per that helper's own docstring), and that
  `ValueError`'s message is re-raised by `writes.py` as the tool's error —
  safe, since `assert_in_org`'s message names only the field, never the
  other org's data. No XC-1 gap: two independent checks happen to cover
  the same input for different reasons, and both fail closed.
- **The write gate itself cannot be bypassed from a read-only connection.**
  `gate_allows()` (`app/mcp/registry.py:75-94`) returns `principal.can_write`
  for `gate == "write"`, checked inside `logbook_tool`'s wrapper before the
  handler runs at all, and a refusal is itself audited
  (`_audit_apart(..., "refused", exc)`) — so a read-only key's attempt is
  recorded, not merely declined silently.
- **A write is audited as "attempted" before the service runs, not only
  on success.** `logbook_tool`'s wrapper (`registry.py:143-155`) calls
  `_audit_apart(..., "attempted", None)` and raises if that audit write
  itself fails (`503`, no mutation attempted) — matching the
  `require_audit_entry` pattern `integrations.py`/`mcp_keys.py` already use
  for connect/disconnect/key-issue, now confirmed to extend to this surface
  too.
- **Error messages reaching the MCP client are sanitized the same way as
  the HTTP API.** `registry.py:167-175` routes a `ValueError` (service
  validation) through `safe_error_detail()` before it becomes a `ToolError`,
  and any other exception gets the same treatment after being logged
  server-side — no raw exception text reaches an AI client any more than it
  reaches a browser.

No new finding from this review. Recorded in full so a future pass does not
re-derive it from scratch, per Feature 23 pass 12's own note that a full
review of this surface belonged here.

### Re-verified from passes 1–4 (all hold, re-checked directly against code)

- **INT-1** (send-time SSRF re-validation): `assert_outbound_url_safe` /
  `_assert_base_url_safe` calls confirmed present, by direct grep and read,
  in `calcom_service.py`, `slack_service.py`, `discord_service.py`,
  `teams_service.py`, `webhook_service.py`, and `documenso_service.py`
  (INT-10's fix, pass 4) — six of seven sites in
  `KNOWN_LIMITATIONS.md`'s "Outbound Integration Requests" entry that this
  feature owns; the seventh (`audit_ship_service.py`) belongs to a
  different feature and was not re-read here.
- **INT-2** (OAuth `error` URL-encoded): intact, `salesforce_sync.py:419`.
- **INT-3** (list/get gated on `integrations.manage`; `/connected`
  status-only on bare auth, registered first): intact,
  `integrations.py:464-517`.
- **INT-4** (`exclude_unset` partial-PATCH merge): intact, `integrations.py:345`.
- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist): unchanged, still
  an explicit owner decision, `app/utils/url_validator.py`.
- **INT-6** (connector exception sanitization via `sanitize_connector_error`):
  intact at `integrations.py:848`, `salesforce_sync_service.py`, and the
  three non-interpolating re-raises in `google_calendar_service.py`,
  `outlook_calendar_service.py`, `weather_service.py`.
- **INT-7** (`_SizeLimitedTransport` response-size cap): intact,
  `base.py` — `MAX_RESPONSE_SIZE`, `_SizeLimitedTransport`, and its wiring
  into every transport `create_integration_client()` builds, confirmed by
  grep and read.
- **INT-8** (`http1`/`http2`/`cert` kwargs reaching the wrapped transport):
  intact.
- **INT-9** (Google Calendar bypasses the shared HTTP hardening): still
  open, still correctly scoped — `google_calendar_service.py` has no
  reference to `http=`, `create_integration_client`, or any transport
  class; confirmed by grep. `KNOWN_LIMITATIONS.md`'s entry is current.
- **INT-10** (Documenso send-time SSRF re-check): intact, see INT-1 above.
- **INT-11** (Salesforce "clear the refresh token" has no reachable UI
  control): **re-verified still open, unchanged.** `IntegrationsPage.tsx:585`
  still builds `refresh_token: sfRefreshToken || undefined` — a blank field
  still becomes `undefined`, still dropped from the JSON payload, never the
  explicit `""` the backend's special case
  (`integrations.py:568-572`/`:720-724`) looks for. The 2026-09-29 copy
  commit (`7f3c7ecec`) reworded the help text around this field (and the
  disconnect/connect toasts) but added no "switch to client credentials"
  control; confirmed by reading the full diff. Still a product decision
  between the two options pass 4 named, not re-litigated here.
- **SOQL injection defense, instance-URL domain pinning, secret handling,
  frontend cache exclusion, webhook replay dedup**: all re-confirmed
  against current code, no change since pass 4.

### Checked, no new finding

- **LIKE-pattern usage**: zero hits in this feature's own files (`grep -rn
"\.like(\|\.ilike("` across every backend file in scope). The one hit
  found in the wider `app/mcp/` tree (`tools/members.py:89-90`, a read-only
  member search) already passes `escape=LIKE_ESCAPE_CHAR` — correct, and
  outside this feature's declared scope (members, not integrations), noted
  rather than claimed as this feature's own finding.
- **CSV export**: none in this feature's scope; `grep -rn "csv.writer\|csv\.DictWriter"`
  across every file in scope: zero hits.
- **JSON-column mutation** (`integration.config`): every write remains a
  flat top-level merge (`{**stored, **new}`); no nested-mutation-on-shared-
  reference shape found, consistent with pass 4.
- **Module gating**: `/integrations`, `/integrations/salesforce`,
  `/integrations/calcom`, `/integrations/claude-mcp` are each registered
  with `dependencies=module_gate("integrations", "Integrations")`
  (`app/api/v1/api.py`) — confirmed unchanged. The 2026-10-03 `useConnectedIntegrations`
  fix (W07-1) is a client-side symptom fix for the same backend 403 this
  gate has always returned when the module is off; no backend change,
  re-verified the gate itself was never the bug.

## Schema & migration notes

None — no model or migration change this pass. `validate_migrations.py
--strict`: 509 revisions, single head, unchanged from before this pass.

## Guard tests added

None — no code changed this pass; nothing new to guard. The pass 4 guard
tests (`test_integration_services.py::TestDocumensoPayload::test_connection_blocks_unsafe_base_url`
and `::test_create_document_blocks_unsafe_base_url`) were re-run as part of
the scoped suite below and still pass.

## Completion gate (pass 5)

| Check                                                                                                                                     | Result                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                             | ✅ 0 violations                                 |
| `black --check app/ tests/ alembic/`                                                                                                      | ✅ 1853 files unchanged                         |
| `isort --check-only app/ tests/ alembic/`                                                                                                 | ✅ clean (isort 9.0.1, CI's pinned version)     |
| `python3 scripts/validate_migrations.py --strict`                                                                                         | ✅ 509 revisions, single head, PASSED           |
| repo-tenancy guards (`test_endpoint_auth_coverage`, `test_require_permission_registry`, `test_like_escaping`, `test_org_scoping_ratchet`) | ✅ 17 passed                                    |
| MCP tool tests (`test_mcp_transport.py`, `test_mcp_keys.py`, `test_mcp_tools.py`, `test_mcp_key_endpoints.py`, `test_mcp_redaction.py`)   | ✅ 276 passed                                   |
| backend tests, scope (`-k "integration or salesforce or calcom or documenso or paypal or webhook or connector or mcp_key"`)               | ✅ 3548 passed, 21 skipped (env-only), 0 failed |
| `tsc --noEmit` (frontend, aliased 7.0.2 compiler)                                                                                         | ✅ 0 errors                                     |
| `eslint --max-warnings 10` (frontend)                                                                                                     | ✅ exit 0                                       |

---

## Pass 4 (2026-09-13) — one fix (a known, tracked gap closed), one new flagged finding, everything else re-verified

**Backend:** `app/api/v1/endpoints/integrations.py` (849 L, 7 routes),
`app/api/v1/endpoints/salesforce_sync.py` (586 L, 9 routes),
`app/api/v1/endpoints/calcom_sync.py` (73 L, 1 route),
`app/api/v1/endpoints/mcp_keys.py` (244 L, 4 routes — mounted at
`/integrations/claude-mcp` under the same `module_gate("integrations", ...)`
as the other three files; reviewed at the route/permission level per this
pass's scope, deeper MCP internals left to the existing out-of-scope carve-out
below), `app/api/public/integrations_webhook.py` (258 L, 2 public routes),
`app/api/public/salesforce_webhook.py` (246 L, 1 public route),
`app/api/public/paypal_webhook.py` (153 L, 1 public route),
`app/services/integration_services/*` (base.py, calcom_service.py,
slack/discord/teams/webhook_service.py, documenso_service.py,
paypal_service.py, salesforce_service.py, salesforce_oauth_service.py,
salesforce_sync_service.py, google_calendar_service.py,
outlook_calendar_service.py, weather_service.py, notification_dispatch.py,
`__init__.py` dispatcher — all read in full this pass), `models/integration.py`,
`schemas/integration.py`.
**Frontend:** `pages/IntegrationsPage.tsx` (2081 L), `hooks/useConnectedIntegrations.ts`,
`components/integrations/McpServiceKeyPanel.tsx`, `modules/integrations/*` —
read in full. Prior passes explicitly scoped the frontend out ("not reviewed
this pass — backend only"); this is the first pass in this file's history to
read it, and it is what surfaced INT-11 below.
**Migrations:** none this pass (443 revisions, single head, unchanged).

### Scope

Re-verified every standing finding (INT-1 through INT-9) against current code
rather than assuming pass 3's verdicts still hold, then did a fresh full read
of every backend file this feature owns (all byte-for-byte close to pass 3's
sizes — `integrations.py` 841→849 L from an unrelated `git log` artifact of
this environment's squashed history, not a real content diff; content
confirmed identical to pass 3's documented state by direct read) plus, for the
first time in this file, the frontend module. Also read `mcp_keys.py` at the
route/permission/org-scoping level, since it is mounted under
`/integrations/claude-mcp` behind the same `module_gate` as the rest of this
feature's routes — narrower than a full MCP-internals review, which stays
out of scope per pass 3's own precedent (the wider `app/mcp/*` package has its
own `KNOWN_LIMITATIONS.md` entry, outside this rotation).

### Route inventory (re-verified, +4 routes since pass 3 — `mcp_keys.py` now enumerated)

| Method | Path                                       | Auth dependency           | Permission                                       | Org-scoped                                  | Notes                                               |
| ------ | ------------------------------------------ | ------------------------- | ------------------------------------------------ | ------------------------------------------- | --------------------------------------------------- |
| GET    | `/integrations`                            | `require_permission`      | `integrations.manage`                            | yes (query filter)                          | INT-3                                               |
| GET    | `/integrations/connected`                  | `get_current_user` (bare) | none                                             | yes (query filter)                          | INT-3 carve-out, deliberate                         |
| GET    | `/integrations/{id}`                       | `require_permission`      | `integrations.manage`                            | yes (id+org)                                |                                                     |
| POST   | `/integrations/{id}/connect`               | `require_permission`      | `integrations.manage`                            | yes (id+org)                                |                                                     |
| POST   | `/integrations/{id}/disconnect`            | `require_permission`      | `integrations.manage`                            | yes (id+org)                                | revokes MCP keys, `require_audit_entry`-gated       |
| PATCH  | `/integrations/{id}`                       | `require_permission`      | `integrations.manage`                            | yes (id+org)                                |                                                     |
| POST   | `/integrations/{id}/test-connection`       | `require_permission`      | `integrations.manage`                            | yes (id+org)                                |                                                     |
| GET    | `/integrations/salesforce/status`          | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| POST   | `/integrations/salesforce/push/members`    | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| POST   | `/integrations/salesforce/push/training`   | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| POST   | `/integrations/salesforce/push/events`     | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| POST   | `/integrations/salesforce/pull/contacts`   | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| GET    | `/integrations/salesforce/readiness`       | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| POST   | `/integrations/salesforce/preview/members` | `require_permission`      | `integrations.manage`                            | yes                                         | read-only                                           |
| GET    | `/integrations/salesforce/oauth/authorize` | `require_permission`      | `integrations.manage`                            | yes                                         | 302 to Salesforce                                   |
| GET    | `/integrations/salesforce/oauth/callback`  | **none**                  | n/a                                              | yes (id+org from signed state)              | public by design, JWT state + nonce cookie          |
| GET    | `/integrations/calcom/bookings`            | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| GET    | `/integrations/claude-mcp/status`          | `require_permission`      | `integrations.manage` OR `integrations.mcp_keys` | yes                                         |                                                     |
| GET    | `/integrations/claude-mcp/keys`            | `require_permission`      | `integrations.manage` OR `integrations.mcp_keys` | yes                                         |                                                     |
| POST   | `/integrations/claude-mcp/keys`            | `require_permission`      | `integrations.mcp_keys`                          | yes                                         | tighter than read; `require_audit_entry`-gated      |
| DELETE | `/integrations/claude-mcp/keys/{key_id}`   | `require_permission`      | `integrations.mcp_keys`                          | yes (`get_key(org_id, key_id)`)             | `require_audit_entry`-gated                         |
| POST   | `/public/v1/webhooks/documenso/{id}`       | none                      | n/a                                              | yes (resolved via id-matched `Integration`) | public, HMAC/shared-secret, replay-protected        |
| POST   | `/public/v1/webhooks/calcom/{id}`          | none                      | n/a                                              | yes                                         | public, HMAC, replay-protected                      |
| POST   | `/public/v1/webhooks/salesforce/{id}`      | none                      | n/a                                              | yes                                         | public, HMAC, replay-protected, 500-record cap      |
| POST   | `/public/v1/webhooks/paypal/{id}`          | none                      | n/a                                              | yes                                         | public, PayPal-verified signature, replay-protected |

25 routes, all enumerated (21 authenticated/permission-gated + 4 intentionally
public with a named compensating control). No route relies on
`require_permission` alone to scope its object (checklist 14b) — every by-id
route resolves its target through an `id` + `organization_id` filter in the
same query, confirmed by direct read of every handler, not sampled.

### Re-verified from passes 1–3 (all hold)

- **INT-1** (send-time SSRF re-validation, `assert_outbound_url_safe`): intact
  in `calcom_service.py`, `slack_service.py`, `discord_service.py`,
  `teams_service.py`, `webhook_service.py` — each calls it immediately before
  the outbound request, confirmed by direct read of every connector this
  pass, not grep alone.
- **INT-2** (OAuth `error` URL-encoded): intact, `salesforce_sync.py:419`.
- **INT-3** (list/get gated on `integrations.manage`; `/connected`
  status-only on bare auth, registered first): intact,
  `integrations.py:464-517`.
- **INT-4** (`exclude_unset` partial-PATCH merge): intact, `integrations.py:345`.
- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist): unchanged, still an
  explicit owner decision, `app/utils/url_validator.py`.
- **INT-6** (connector exception sanitization via `sanitize_connector_error`):
  intact at `integrations.py:848`, `salesforce_sync_service.py:664`/`704`, and
  the three non-interpolating re-raises in `google_calendar_service.py`,
  `outlook_calendar_service.py`, `weather_service.py`.
- **INT-7** (`_SizeLimitedTransport` response-size cap): intact,
  `base.py:98-139`, wired into `create_integration_client()`.
- **INT-8** (`http1`/`http2`/`cert` kwargs reaching the wrapped transport):
  intact, `base.py:212-386`.
- **INT-9** (Google Calendar bypasses the shared HTTP hardening — no size cap,
  no future wall-clock deadline): still open, still correctly scoped to
  `google_calendar_service.py`'s `googleapiclient`/`httplib2` transport, which
  never reaches `create_integration_client()`. `KNOWN_LIMITATIONS.md`'s entry
  is current and accurate; re-verified rather than re-derived.
- **SOQL injection defense** (`_soql_quote`/`_soql_identifier`,
  `salesforce_sync_service.py:131-149`): every dynamic SOQL construction site
  (`_find_contact_by_email:314`, `_find_record_by_external_id:735-737`) still
  uses them; `pull_contacts`' `LastModifiedDate > {ts}` interpolation
  (line 419) is a server-formatted `datetime` (`integration.last_sync_at`),
  never user input, so it carries no injection surface.
- **Instance-URL domain pinning** (`salesforce_service.py`): `_INSTANCE_URL_RE`
  now also gates `_api_url()` itself (`:157-175`), not only the token-refresh
  path — confirmed still the case, closing the gap the file's own docstring
  there describes (a cached access token skips `_refresh_access_token()`
  entirely, so without this second gate an admin-editable `instance_url`
  would reach every request URL, with the live bearer token attached,
  unvalidated).
- **Secret handling** (`models/integration.py`): secrets live only in
  `encrypted_config` (AES-256 via `app/core/security.encrypt_data`), decrypted
  only through `get_secret()`; `_sanitize_config` redacts any
  `_SECRET_KEY_PATTERN`-matching key before a response is built. No endpoint
  response includes a raw secret — confirmed by reading every response
  builder in `integrations.py`/`salesforce_sync.py`/`calcom_sync.py`, not
  assumed.
- **Frontend cache exclusion**: `/integrations` is in `apiCache.ts`'s
  `UNCACHEABLE_PREFIXES` (SEC-00's SEC4-3 pin covers it), and
  `integrationsService` is built on the shared, CSRF/auth-wired
  `services/apiClient.ts` — not a bespoke module axios instance (Pitfall #7
  n/a; there is only one client here).
- **Webhook replay dedup** (`app/utils/webhook_replay.py`): Redis-backed,
  10-minute TTL, fails open (not drops) when Redis is unavailable — bounded,
  no Pitfall #9 tracker concern.

### Findings

#### INT-10 — MED — `documenso_service.py` never re-validated its outbound URL at send time — ✅ FIXED

**What:** `KNOWN_LIMITATIONS.md`'s "Outbound Integration Requests" entry
(found by the training-extended rotation's pass 4, added 2026-09-10) named
`documenso_service.py` as the one `create_integration_client`-family connector
with **no** `assert_outbound_url_safe` call anywhere in the file — worse than
its five siblings (which at least narrow the DNS-rebinding TOCTOU window),
this one had no send-time re-check at all. Since Documenso is this feature's
own file, closing the documented "first step" (adding the missing call, matching
`calcom_service.py`'s identical `_assert_base_url_safe()` shape) belongs to
this rotation pass rather than waiting for another feature to stumble onto it
again.
**Where:** `backend/app/services/integration_services/documenso_service.py` —
`test_connection()` (the only currently-invoked path, via the
`test_integration_connection` dispatcher) and `create_document()` (not yet
wired to any route, but part of this class's public API).
**Failure scenario:** a department points a self-hosted Documenso instance's
`api_base_url` at a hostname that resolves to a public IP at config-save time
(passing `validate_integration_url`) and is later re-pointed (DNS rebinding)
at `169.254.169.254`/`127.0.0.1`/an internal host. Every sibling connector
(Cal.com, Slack, Discord, Teams, generic webhook) would refuse the request at
send time; Documenso's `test_connection()`/`create_document()` would not —
the only thing standing between the request and an internal service was the
save-time check, whose window was the entire lifetime of the stored config.
**Impact:** MED — SSRF against internal infrastructure, gated behind
`integrations.manage` (an org admin must have configured the integration), so
not attacker-reachable without that permission, but a real gap relative to
every sibling connector doing the equivalent request.
**Fix:** added `_assert_base_url_safe()` (identical shape and docstring intent
to `calcom_service.py`'s own method) and call it before the request in both
`test_connection()` and `create_document()`. This is the "narrowed, not
closed" TOCTOU shape the other five connectors already have — it does not
pin the resolved address the way `external_training_service.py`'s
`SSRFSafeAsyncTransport` does; that larger cross-cutting fix (resolve once,
connect to the pinned IP, preserve Host/SNI) remains tracked, unfixed, for all
six `create_integration_client`-family connectors in
`KNOWN_LIMITATIONS.md`'s "Outbound Integration Requests" entry, updated below
to reflect that `documenso_service.py` is no longer the _worse_ case (no
check at all), only the same "narrowed, not closed" case as its siblings.
**Guard tests:** `backend/tests/test_integration_services.py::TestDocumensoPayload::test_connection_blocks_unsafe_base_url`
and `::test_create_document_blocks_unsafe_base_url` — each patches
`assert_outbound_url_safe` to raise, asserts the exception propagates
(fail-closed), and asserts `create_integration_client` is never called (proves
the check runs _before_ any request, not merely somewhere in the method).
Both verified to fail against the pre-fix code (`AttributeError: ... does not
have the attribute 'assert_outbound_url_safe'`, since the import did not
exist) via `git stash` on just this file, and to pass after.

#### INT-11 — LOW-MED — Salesforce's "blank the refresh token to switch to client credentials" feature has no reachable frontend control — 🚩 FLAGGED

**What:** `connect_integration`/`update_integration`
(`integrations.py:568-572`, `:720-724`) special-case an explicit
`config["refresh_token"] == ""` on a Salesforce integration: it clears the
stored `refresh_token` _and_ `access_token`, switching the integration from
the interactive OAuth grant to Salesforce's client-credentials flow on the
next sync. This requires the wire payload to contain the literal key/value
pair `"refresh_token": ""`. `IntegrationsPage.tsx:585` builds the Salesforce
config as `refresh_token: sfRefreshToken || undefined` — when the field is
blank, this is `undefined`, which `JSON.stringify` (and therefore the request
body axios sends) **omits entirely**, not `""`. Grepped the whole file for
any other place that could send an explicit empty string for this field —
none exists; the field only reaches the backend as either a real token or
absent.
**Where:** `frontend/src/pages/IntegrationsPage.tsx:580-590` (the Salesforce
branch of `getConfigFromForm`); the backend behavior it can never trigger is
`backend/app/api/v1/endpoints/integrations.py:568-572` (connect) and
`:720-724` (update).
**Failure scenario:** an IT administrator who previously pasted a
colleague's personal Salesforce refresh token (interactive OAuth) wants to
switch the org to the Connected App's own client-credentials flow — the
documented, intended way to do this is to clear the Refresh Token field and
save. Clearing the field and saving does nothing: the key is omitted from the
payload, the backend's merge (`{**stored, **public_config}`) leaves the
stored `refresh_token`/`access_token` untouched, and every subsequent sync
keeps authenticating as whoever the old refresh token belonged to — silently,
with no error, and no way for the admin to tell from the UI that their intent
was not carried out (the form has no separate confirmation of which auth mode
is currently active). If that person leaves the department or Salesforce
revokes their session, sync failures start with no visible link back to "the
field I cleared didn't do what its own tooltip position implies."
**Impact:** LOW-MED. Not attacker-reachable (requires `integrations.manage`
and the admin's own mistaken belief that clearing the field did something) —
this is a credential-lifecycle correctness gap, not a leak or an escalation.
Flagged rather than fixed because closing it is a product decision between at
least two shapes (a distinct "Switch to Client Credentials" button/checkbox
that sends the explicit `""`, versus changing the field's semantics so a
blank submission always means "clear," which would itself need its own
review against every _other_ field this form treats as "blank = leave
unchanged" — CSV3-style scope creep this pass should not decide unilaterally).
**Mirrored:** `docs/KNOWN_LIMITATIONS.md`, new entry below.

### Checked, no new finding

- **Abuse resistance on the sync-trigger endpoints**
  (`push/members`/`push/training`/`push/events`/`pull/contacts`): none of the
  four carry a rate-limit dependency, and each runs synchronously within the
  request (no background task), so a large org's push could hold the request
  open for a while. Not flagged: the actor must already hold
  `integrations.manage`, the work is bounded by the org's own data (not
  attacker-controlled), and the effect (a slow request, a duplicate
  Salesforce Contact if two pushes race) is self-inflicted within the org's
  own tenant, not a cross-tenant or resource-exhaustion vector against the
  platform. Consistent with three prior passes not flagging this; recorded so
  the next pass does not re-derive the question from scratch.
- **`mcp_keys.py`'s four routes**: enumerated in the route inventory above.
  `DELETE /keys/{key_id}` resolves via `McpKeyService.get_key(org_id, key_id)`
  (`app/mcp/keys.py:155-163`), which filters both — confirmed by direct read,
  closing the one route in this file with a client-supplied id (checklist
  14a). No new finding; this is the first pass to enumerate these routes
  rather than treating the whole file as out of scope.
- **`nfc-id-cards`/coming-soon catalog entries with no `INTEGRATION_CONFIG_SCHEMAS`
  entry** (`active911`, `google-maps`, `zapier`, `whatsapp`, `imagetrend`,
  `eso-solutions`, `nremt`, `firstwatch`, `pulse-point`, `nfc-id-cards`): PATCH
  (unlike POST `/connect`) does not check `status == "coming_soon"`, so an
  admin can write arbitrary JSON into a not-yet-implemented integration's
  public config. No schema means no `extra="forbid"` and no secret-key
  restriction beyond the generic `SECRET_CONFIG_KEYS` split, but this is the
  org's own admin writing to the org's own row — no cross-tenant or
  injection surface. `nfc-id-cards` itself stores no config at all in
  practice (`app/utils/nfc_integration.py` reads only `enabled`/`status`).
  Not flagged — a data-quality nit, not a security finding.
- **JSON-column mutation** (`integration.config`): every write in this
  feature is a flat top-level merge (`{**stored, **new}`) or a `dict()` copy
  with only top-level key assignment (`salesforce_sync.py:564-568`) — no
  nested-mutation-on-shared-reference shape anywhere in this feature
  (Pitfall #12 n/a here, consistent with SEC-00 pass 4's sweep 9).
- **LIKE-pattern usage**: none in this feature (`grep -rn "\.like(\|\.ilike("`
  across every file in scope: zero hits). Checklist §4's LIKE item is n/a.

## Schema & migration notes

None — no model or migration change this pass. `validate_migrations.py
--strict`: 443 revisions, single head, unchanged from before this pass.

## Guard tests added

| Test                                                                                              | Invariant asserted                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_integration_services.py::TestDocumensoPayload::test_connection_blocks_unsafe_base_url`      | `DocumensoService.test_connection()` re-validates `api_base_url` at send time and fails closed before any request; fails on reintroduction of the missing call. |
| `test_integration_services.py::TestDocumensoPayload::test_create_document_blocks_unsafe_base_url` | Same guard on `create_document()`.                                                                                                                              |

## Completion gate (pass 4)

| Check                                                                                                                       | Result                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                                                               | ✅ 0 violations                                  |
| `black --check app/ tests/ alembic/`                                                                                        | ✅ 1586 files unchanged                          |
| `isort --check-only app/ tests/ alembic/`                                                                                   | ✅ clean (isort 9.0.1, CI's pinned version)      |
| `python3 scripts/validate_migrations.py --strict`                                                                           | ✅ 443 revisions, single head, PASSED            |
| backend tests, scope (`-k "integration or salesforce or calcom or documenso or paypal or webhook or connector or mcp_key"`) | ✅ 2690 passed, 21 skipped (env-only), 0 failed  |
| backend tests, full suite (`pytest tests/ -q`)                                                                              | ✅ 12450 passed, 21 skipped (env-only), 0 failed |
| `tsc --noEmit` (frontend)                                                                                                   | ✅ 0 errors                                      |
| `eslint --max-warnings 10` (frontend)                                                                                       | ✅ 0 errors, 0 warnings                          |

---

## Pass 3 (2026-09-06) — one new finding (dead safeguard), everything else re-verified

**Scope of growth since pass 2:** `integrations.py` grew 710 → 841 lines (+131);
`salesforce_sync.py` (585), `salesforce_service.py` (447),
`salesforce_oauth_service.py` (161) are byte-identical; `salesforce_sync_
service.py` grew 958 → 966 (+8, unrelated to security — no new call site of
either eviction/audit/exception-handling logic). Read all backend files in
this feature's declared scope in full, plus `calcom_sync.py`,
`app/api/public/integrations_webhook.py` (public, inbound webhooks — not
explicitly enumerated in pass 2's file list) and
`app/services/integration_services/base.py`, `__init__.py` (the connector
dispatcher), neither of which pass 1/2 read in full either.

**The +131 lines in `integrations.py` are new Claude (MCP) integration
glue** (`claude-mcp` catalog entry + `ClaudeMcpConfig` schema, `_test_mcp_
connection`, MCP-service-key revocation on disconnect, `require_audit_entry`
gating on the MCP config update path) plus new `nfc-id-cards` and `paypal`
catalog entries. **The wider MCP module (`app/mcp/*`, ~5,000+ L) is not a
declared file of this feature and already carries its own
`KNOWN_LIMITATIONS.md` entry from outside this rotation** — the same scope
line Feature 15 (Scheduling, pass 3) drew for its own MCP tool file; not
duplicated here. What _is_ in scope is the glue inside `integrations.py`
itself, reviewed below.

### Route inventory (re-verified, unchanged counts)

`integrations.py`: 7 routes, same set as pass 2 (no new route — the MCP glue
lives inside the existing `connect`/`disconnect`/`update`/`test-connection`
handlers, all still `require_permission("integrations.manage")` + id+org
filter). `salesforce_sync.py`: 9 routes, unchanged. `calcom_sync.py`: 1 route
(`GET /bookings`, `integrations.manage`, org-scoped via `_get_calcom_
integration`). `app/api/public/integrations_webhook.py`: 2 intentionally
public routes (`POST /documenso/{id}`, `POST /calcom/{id}`) — both rate
limited (30/min/IP), reject any integration with no configured
`webhook_secret` (fail closed), verify HMAC/shared-secret with
`hmac.compare_digest`-based helpers, replay-protected
(`is_duplicate_webhook`), and resolve the acting org from the id-matched
`Integration` row rather than from the payload.

**Correction (Codex round, 2026-09-06):** the count above stopped one file
short. `main.py` mounts two more public webhook routers immediately before
`integrations_webhook_router` — `app/api/public/salesforce_webhook.py`
(`POST /public/v1/webhooks/salesforce/{integration_id}`) and
`app/api/public/paypal_webhook.py` (`POST /public/v1/webhooks/paypal/
{integration_id}`) — neither inspected in this pass nor in pass 2, despite
PayPal being listed as reviewed and clean below. Read both in full: **21
endpoints across six files**, not 19 across four. Both hold up to the same
checklist dimensions the rest of this pass used —

- **`salesforce_webhook.py`:** HMAC-SHA256 verified with
  `hmac.compare_digest`; an integration with no `webhook_secret` configured
  is rejected (401), not silently trusted; rate limited (30/min/IP) — but
  **correction (Codex round, 2026-09-06): the 5-minute lockout an earlier
  version of this entry claimed does not exist.** `_rate_limit_webhook()`
  calls `public_rate_limit(..., window_seconds=60)` with no
  `lockout_seconds`, which defaults to `0`. On the Redis path (the common
  case) this is moot regardless: `app.core.security.is_rate_limited` — what
  `public_rate_limit` actually calls for the distributed, Redis-backed
  check — has no `lockout_seconds` parameter at all, only a sliding window;
  it is a pure `limit`-per-`window_seconds` check with nothing to add a
  lockout to. `lockout_seconds` only reaches the in-memory fallback used
  when Redis is unavailable, and there it is `0` too, so that path also has
  no additional lockout beyond the 60-second window. In both cases, a
  request that hits the limit simply resumes once its own timestamp ages
  out of the 60-second sliding window, not after an extra 5-minute block;
  replay-protected (`is_duplicate_webhook`, correctly
  ordered _after_ shape validation so a rejected payload's fingerprint
  can't be poisoned — see the file's own comment); a `records` array is
  capped at 500 per request; the acting org comes from
  `integration.organization_id` on the id-matched row, never the payload.
  One inaccuracy fixed in the file's own docstring: it claimed payload size
  was "limited by FastAPI / Uvicorn defaults" — neither imposes a body-size
  limit on its own; see the inbound-body-size note below for the real
  mechanism. Corrected in place.
- **`paypal_webhook.py`:** signature verification is delegated to PayPal's
  own `verify-webhook-signature` API (`paypal_service.verify_webhook_
signature`), which fails closed (returns `False`, never raises past the
  caller) on a missing `webhook_id`, missing signature headers, or a
  transport failure; rate limited (60/min/IP); replay-protected the same
  way; the acting org again comes from the id-matched `Integration` row.
  **Fixed (Codex follow-up round, 2026-09-06):** `paypal_service.py`'s own
  two outbound calls to PayPal (`get_access_token`,
  `verify_webhook_signature`) used a bare `httpx.AsyncClient(timeout=
_TIMEOUT)` rather than `create_integration_client()`, so they did not
  inherit the INT-7 fix below — flagged as low risk when first noted
  (`base_url` is one of two hardcoded PayPal API hosts, never
  client/org-supplied, so there's no SSRF or cross-tenant exposure, only
  the same class of unbounded-response memory risk INT-7 covers, against a
  single trusted vendor host) but still a real gap, and a CHANGELOG entry
  claiming the fix covered "every integration connector" while this one
  didn't was itself a second finding on this same round. Rather than leave
  the inconsistency and only correct the CHANGELOG's wording,
  `create_integration_client()` gained a `timeout=` override (defaulting to
  `INTEGRATION_TIMEOUT`, so every other call site is unaffected) and both
  PayPal call sites now pass their own tuned `Timeout(15.0, connect=10.0)`
  through it — closing the gap without the timeout regression that made
  bundling this into the original INT-7 pass undesirable. See
  `backend/tests/test_integration_response_size_cap.py`'s
  `test_create_integration_client_timeout_override_preserves_hardening` and
  the PayPal-specific size-cap tests added alongside it.

**Inbound webhook body size — nginx is deployment-conditional, but the
backend has its own cap regardless (Codex round, 2026-09-06).** Both files'
`request.body()` calls run before signature verification, on a public,
unauthenticated route, which makes body size a real question independent of
INT-7 (that finding is about _outbound_ response size). Checked two things
Codex raised:

1. **Is nginx actually in front of the backend?** No, not by default.
   `docker-compose.yml`'s `nginx` service is `profiles: [production]` —
   opt-in — while `backend` publishes directly on `${BACKEND_PORT:-3001}`
   with no profile gate, so the default (`docker-compose up`, no
   `--profile production`) stack has no nginx in the request path at all,
   and the documented standalone backend image can likewise run without
   it. So a claim that inbound webhook bodies are bounded by nginx's 50 MB
   `client_max_body_size` cannot be unconditional — it depends on a
   deployment choice this repo does not default to.
2. **Does anything else cap it?** Yes — `RequestSizeLimitMiddleware`
   (`app/core/security_middleware.py`, pure ASGI per CLAUDE.md pitfall #4)
   is registered in `main.py` as the **outermost** middleware
   (`app.add_middleware(RequestSizeLimitMiddleware, max_body_size=settings.
MAX_REQUEST_BODY_SIZE)`, added last so it wraps every other layer) and
   applies to every request the ASGI app receives, public webhook routers
   included, regardless of whether nginx is present. It rejects (413) up
   front when a declared `Content-Length` exceeds the cap, and separately
   counts streamed bytes and signals disconnect if a client omits or lies
   about `Content-Length` (chunked upload), so a request body cannot be
   silently unbounded either way. `settings.MAX_REQUEST_BODY_SIZE` defaults
   to 60 MB — pre-existing on `main`, not added by this PR or this pass.

**Net effect:** the "arbitrarily large body" DoS Codex described does not
hold as stated — the backend caps inbound bodies at 60 MB unconditionally,
independent of nginx. What _is_ real, and worth naming precisely rather than
leaving to an unconditional nginx claim: without nginx, an oversized body is
rejected only after the backend process has already accepted the connection
and started counting bytes (up to 60 MB before the `RequestSizeLimitMiddleware`
disconnect fires), whereas nginx in front would reject a body over its own
50 MB cap before the request reaches a backend worker at all. That's a real,
if minor, difference in how much per-request resource an anonymous flood can
make the backend absorb — not the unbounded gap originally described, so no
new finding (no "INT-8") is warranted; the existing control already closes
the unbounded case. This finding's own prior text (in INT-7's "Impact"
section, below) named nginx's cap as the relevant control for inbound
webhook bodies; corrected there to name `RequestSizeLimitMiddleware` as the
actually load-bearing, deployment-independent control, with nginx as an
additional, deployment-conditional layer in front of it — not the reverse.

### MCP glue reviewed (new since pass 2) ✅

- **`disconnect_integration`** revokes every MCP service key
  (`McpKeyService.revoke_all`, row-locked, org-scoped) when the `claude-mcp`
  integration is disconnected — a key must not outlive the connection it was
  issued under, or reconnecting would silently reinstate it. Each revocation
  is audit-logged and gated by `require_audit_entry` (`app/api/v1/endpoints/
mcp_keys.py`): if the audit write itself failed, the whole disconnect
  rolls back rather than silently revoking a key with no record — a
  deliberately stricter failure mode than this file's other audit calls
  (`log_audit_event` alone, which swallows its own failure), and the
  comment on `require_audit_entry` names why: a widened/rotated key with no
  record is exactly the failure the record exists to catch.
- **`update_integration`** applies the same `require_audit_entry` gate when
  the integration being updated is `claude-mcp` — a live service key's
  access is what a config change to `access_mode`/`expose_finance`/
  `expose_medical_screening`/`expose_full_schedule` widens or narrows, so an
  unrecorded change to it is treated the same as an unrecorded key change.
  Other integration types keep the existing best-effort `log_audit_event`.
- **`_test_mcp_connection`** makes no outbound call (nothing external to
  reach) — it reports whether the integration is connected and whether an
  active service key exists, reading `McpKeyService(db).active_keys(
integration.organization_id)` where `integration` was already fetched by
  id+org above. No new SSRF/tenant-isolation surface.
- **`ClaudeMcpConfig`** (`schemas/integration.py`): `extra="forbid"`, four
  boolean/enum switches, no secret-shaped or URL-shaped field — none of
  `_validate_urls_in_config`'s SSRF check or `_extract_secrets`' secret
  split apply to it, correctly (there is nothing in this config to
  SSRF-check or encrypt).

Deeper MCP internals (`app/mcp/keys.py`'s `McpKeyService`, `app/mcp/tools/*`,
redaction, transport auth) are out of this feature's declared scope per the
precedent above and were not re-derived; `active_keys`/`revoke_all`'s
signatures and locking were read only far enough to confirm the call sites
inside `integrations.py` use them correctly (org id passed, row-locked,
audit-gated).

### Findings

#### INT-7 — LOW-MED — `MAX_RESPONSE_SIZE` is declared, never enforced — ✅ FIXED (Codex round, 2026-09-06)

**What:** `app/services/integration_services/base.py` declared a 10 MB
`MAX_RESPONSE_SIZE` constant with a docstring claiming "response size
limits" as one of the hardened client's defaults. Nothing read this
constant anywhere in the codebase (`grep -rn MAX_RESPONSE_SIZE app/` — one
hit, its own declaration). `create_integration_client()` returned a plain
`httpx.AsyncClient` with no size-related config; every connector
(`calcom_service.list_bookings`, `documenso_service`, `salesforce_service._
request`, the chat senders) calls the client's non-streaming
`.get()`/`.request()` and then `.json()`/`.text`. This is not a new
regression; it has been true since the constant and docstring were written
(pre-dates pass 1), but no prior pass named it — `docs/module-audit/
integrations.md`'s "Tenant isolation" bullet listed "size cap" among the
base client's verified-good hardened defaults, which per this rotation's own
rule ("a claim in Verified good must name the mechanism that makes it true")
was not actually checked against the code; corrected in that doc.

**Originally flagged, not fixed, in this pass's first draft** on the belief
that enforcing the cap meant every connector's response-reading call site
switching from `client.get(url).json()` to `client.stream(...)` plus a
running-byte-count abort — a call-site-by-call-site change across roughly
ten connector files. **A Codex review round on this PR (#2307) challenged
that premise**, and it does not hold: httpx's non-streaming `AsyncClient.
send()` still fully drains `response.stream` via `Response.aread()` before
`.json()`/`.text` become available on _any_ call — `.get()`, `.post()`,
`.request()` included (`send()` calls `await response.aread()` whenever
`stream=False`, which is the default `.get()`/`.request()` use). That
stream is exactly what a wrapping transport controls, so the cap can be
enforced once, centrally, with **no connector call site changing at all**.

**Fix:** `base.py` now wraps its transport with a new `_SizeLimitedTransport`
(and `_SizeLimitedAsyncStream`), which intercepts `response.stream` in
`handle_async_request()` and aborts — raising `ResponseTooLargeError`
(`httpx.TransportError` subclass, so it's caught by every existing `except
httpx.TransportError` retry path the same as a connection/timeout failure,
and `sanitize_connector_error` (INT-6) treats it as an unvetted infra
failure rather than a hand-authored safe message) — once more than
`MAX_RESPONSE_SIZE` bytes have been read. `create_integration_client()`
builds its own `httpx.AsyncHTTPTransport(verify=True, limits=
INTEGRATION_LIMITS)` explicitly and wraps that, rather than letting
`httpx.AsyncClient` build its default transport, because passing an
explicit `transport=` makes `AsyncClient` ignore its own `verify=`/`limits=`
kwargs entirely (`AsyncClient._init_transport` only builds a transport from
them when `transport` is `None`) — moved onto the inner transport instead so
neither hardening default silently regresses.

Verified against a real `httpx.AsyncHTTPTransport` over an actual socket
(not just `httpx.MockTransport`) before writing the fix, to confirm the
mechanism holds against the real transport class this client uses, not only
a synthetic one — see the guard tests below for the equivalent, checked-in
version of that verification.

**Where:** `backend/app/services/integration_services/base.py` (the whole
fix — one file, as the Codex round predicted).

**Reachable population corrected (Codex round, 2026-09-06):** the original
"Impact" text below said every trigger for an outbound integration call
requires `integrations.manage`. That's wrong. `notify_entity_created`
(`app/services/integration_services/notification_dispatch.py`) fans out to
every enabled Slack/Discord/Teams webhook via `create_integration_client()`
the same as any other connector, and it is enqueued as a background task
from `create_event` (`events.manage`), `create_shift`
(`scheduling.manage`), and `create_record` (`training.manage`) — three
endpoints, none gated on `integrations.manage`. So the actual reachable
population for triggering an outbound chat-webhook request (and therefore
this finding, before the fix) is anyone holding any one of those three
module-manage permissions, not just an org's integration admin. The
"self-hosted third-party endpoint the admin configured" framing for the
_destination_ still holds — a member cannot point the webhook anywhere new
— but the _trigger_ is far broader than `integrations.manage` alone.

**Timeout semantics corrected (Codex round, 2026-09-06):** the original text
below described `INTEGRATION_TIMEOUT` as bounding "how long this can run per
request" (a 10s total). That's also wrong, and raises the pre-fix severity:
`httpx.Timeout(10.0, connect=5.0)` sets a 5s _connect_ timeout and a 10s
_read_ timeout applied to each individual socket read (confirmed against
the pinned httpx 0.28.1's own source — `httpx._config.Timeout` has no
"total" concept at all; every value it accepts maps to one of
connect/read/write/pool). A server that sends one chunk every 9 seconds
resets the read timer each time and can hold the connection open
indefinitely — a slow-drip availability scenario, not a bounded one. This
was corrected in `base.py`'s own comment on `INTEGRATION_TIMEOUT` (fixed
alongside the response-size cap, since both wrong claims sat in the same
file) and in `KNOWN_LIMITATIONS.md` below. It does not change what the fix
above closes — the size cap aborts on byte count, not elapsed time, so it
still stops the slow-drip scenario from consuming unbounded _memory_; the
unbounded-_time_ half of a slow-drip request is a distinct, still-open
gap, noted as a `KNOWN_LIMITATIONS.md` follow-up rather than fixed in this
pass (a genuine wall-clock deadline needs an `asyncio.timeout()`-style
wrapper around the whole request, not a `Timeout` tweak — but, per a Codex
correction on this same PR, that does not need every connector call site
touched: every connector already gets its client from
`create_integration_client()`, so the fix centralizes the same way this
pass's `_SizeLimitedTransport` did, via an `httpx.AsyncClient` subclass
constructed there whose `send()` wraps `super().send()` in
`asyncio.timeout(N)`).

**Impact (as originally written, now superseded by the two corrections
above):** ~~every trigger for an outbound integration call requires
`integrations.manage` (an org admin), so this is not directly reachable by
an unprivileged member~~ — struck through rather than deleted, so the
correction is visible in place. Inbound webhook bodies are a separate
question from this finding (outbound response size) — see the inbound
body-size note under "Route inventory" above; nginx's `client_max_body_size`
was never load-bearing for _this_ finding, since INT-7 is about a _response_
body from an admin-configured outbound destination, not a request body from
an inbound caller.

**Guard tests:** see "Guard tests added" below —
`backend/tests/test_integration_response_size_cap.py` (new file): a
transport-unit test that an oversized streamed response aborts with
`ResponseTooLargeError`, one confirming an under-limit response is
unaffected, a structural test that `create_integration_client()` actually
wires `_SizeLimitedTransport` in (so reverting the wiring — as opposed to
the wrapper logic — also fails a test), and an end-to-end test through a
real connector (`CalcomService.test_connection`) with only the network-
facing `httpx.AsyncHTTPTransport` replaced, proving the cap holds along the
real code path a connector call takes.

### Re-verified from pass 1/2 (all hold)

- **INT-1** (send-time SSRF re-validation): intact — re-checked
  `assert_outbound_url_safe` call sites directly (grep above) across
  calcom/discord/slack/teams/webhook services; unchanged from pass 2.
- **INT-2** (OAuth `error` URL-encoded): intact.
- **INT-3** (list/get gated on `integrations.manage`, `/connected`
  status-only on bare auth, registered first): intact, route table
  above confirms both routes and their comments in the source
  (`integrations.py:463-467`, `:483-493`) still state the rationale.
- **INT-4** (`exclude_unset` partial-PATCH merge): intact.
- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist): unchanged, still
  an owner behavior decision, not auto-applied.
- **INT-6** (connector exception sanitization, type-based via
  `sanitize_connector_error`): intact at all originally-fixed sites
  (`integrations.py:840`, `salesforce_sync_service.py:664`/`704`) plus the
  three re-raise-with-interpolation sites (google/outlook calendar, NWS
  weather) — re-checked via grep for `Exception(f"...{e}"/{exc})`-shaped
  interpolation across every connector file: zero hits, only safe
  hand-authored messages remain.
- **SOQL injection defense, OAuth state validation, instance-URL domain
  pinning, secret redaction, tenant isolation**: all re-confirmed against
  current code, no change since pass 2.

## Guard tests added

**Initial draft of this pass:** none — INT-7 was flagged as a design gap
rather than fixed, on the (mistaken) premise that closing it needed a
per-connector streaming-read change with no single safe interception point,
so there was no "revert this line, watch a test fail" shape to test against.

**Codex round, 2026-09-06:** that premise didn't hold (see INT-7 above), so
this pass now ships the fix and its guard tests together —
`backend/tests/test_integration_response_size_cap.py` (new file):

- `test_oversized_response_aborts_before_full_buffering` /
  `test_response_at_or_under_the_limit_is_unaffected` — a `_SizeLimitedTransport`
  wrapping an `httpx.MockTransport` that streams a response (via `stream=`,
  not `content=` — the latter eagerly materializes `Response._content`
  inside `MockTransport`'s dispatch call, before the wrapping transport gets
  a chance to intercept anything, so it doesn't exercise the real mechanism
  a live transport uses).
- `test_create_integration_client_wires_the_size_limited_transport` — a
  structural check that `create_integration_client()`'s returned client's
  `_transport` actually is a `_SizeLimitedTransport` with the right
  `max_bytes`; this is what fails if a future edit reverts the wiring in
  `create_integration_client()` even though the wrapper class itself (and
  the two tests above, which build their own instance directly) still pass.
- `test_real_connector_call_aborts_on_an_oversized_response` — end-to-end
  through `CalcomService.test_connection()` with only the network-facing
  `httpx.AsyncHTTPTransport` replaced, proving the cap holds along the real
  code path a connector call takes, not just in the transport unit tests.

All four pass after the fix; the first, third, and fourth fail (no
`ResponseTooLargeError`/no `_SizeLimitedTransport`) if `_SizeLimitedTransport`
or its wiring into `create_integration_client()` is reverted.

## Completion gate (pass 3)

| Check                                                                                 | Result                                                                                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                         | ✅ 0 violations                                                                                                                  |
| `black --check app/ tests/ alembic/`                                                  | ✅ 1503 files unchanged                                                                                                          |
| `isort --check-only app/ tests/ alembic/`                                             | ✅ clean                                                                                                                         |
| `python3 scripts/validate_migrations.py --strict`                                     | ✅ 431 revisions, single head (`d7c1b95e2a40`), PASSED                                                                           |
| backend tests, scope (`-k "integration or salesforce or calcom or connector or nfc"`) | ✅ 2412 passed, 21 skipped (env-only), 0 failed                                                                                  |
| backend tests, full suite (`pytest tests/ -q`)                                        | ✅ 11472 passed, 21 skipped (env-only), 0 failed                                                                                 |
| `tsc --noEmit` (frontend)                                                             | ✅ 0 errors                                                                                                                      |
| `eslint .` (frontend)                                                                 | ✅ 0 errors, 3 pre-existing warnings (`ShiftDetailPanel.test.tsx`, unrelated/untouched, well under the `--max-warnings 10` gate) |

**One environment wrinkle, same shape as `SKT-19-skills-testing.md`'s pass 3
note — recorded here rather than as a finding.** This worktree started with
no `node_modules`; `npx eslint .`/`npx tsc --noEmit` initially fell back to a
global toolchain that could not resolve `@types/node`, producing 1032
spurious `@typescript-eslint/no-unsafe-*` warnings across unrelated files
(mostly Node-built-in access in test/tooling scripts) before `npm ci` (from
the worktree root) installed a real `node_modules` and both commands
returned the clean result in the table above. Recorded here so a future
reader does not mistake either number for a real `main`-red finding.

No frontend source file was touched this pass, so `tsc`/`eslint` verify no
regression rather than validate new code.

### Completion gate — Codex round (2026-09-06)

Re-run after the INT-7 fix and doc corrections above. No frontend file
touched in this round either, so `tsc`/`eslint` were not re-run — the
pass-3 table above still stands for those two checks.

| Check                                                                        | Result                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                                         | ✅ 1504 files unchanged                                                   |
| `isort --check-only app/ tests/ alembic/`                                    | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`                            | ✅ 431 revisions, single head (`d7c1b95e2a40`), PASSED (no schema change) |
| new guard tests (`test_integration_response_size_cap.py`)                    | ✅ 4 passed                                                               |
| backend tests, scope (`-k "integration or salesforce or paypal or webhook"`) | ✅ 2374 passed, 21 skipped (env-only), 0 failed                           |
| backend tests, full suite (`pytest tests/ -q`)                               | ✅ 11476 passed, 21 skipped (env-only), 0 failed                          |

---

## Follow-up round 5 (2026-09-06) — transport kwargs silently dropped; Google Calendar's coverage gap named

### INT-8 — P2 — connection-affecting kwargs (`http2`, `http1`, `cert`) weren't applied to the wrapped transports — ✅ FIXED

**What:** `create_integration_client()`'s existing `**kwargs` interface lets a
caller pass any `httpx.AsyncClient` keyword through. For `http2=True`,
`http1=False` or `cert=...`, that flowed to `httpx.AsyncClient(...)` only —
and pinned httpx 0.28.1's `AsyncClient._init_transport()` returns whatever
`transport=` it was given immediately, without ever building a transport
from `verify`/`cert`/`trust_env`/`http1`/`http2`/`limits`:

```python
def _init_transport(self, ..., transport=None):
    if transport is not None:
        return transport
    return AsyncHTTPTransport(verify=..., cert=..., http1=..., http2=..., ...)
```

`create_integration_client()` always supplies an explicit `transport=` (the
size-limiting wrapper from INT-7), so the inner `AsyncHTTPTransport` this
factory builds never saw `http1`/`http2`/`cert` at all — it silently kept
HTTP/1 enabled, HTTP/2 disabled, and no client certificate regardless of
what the caller asked for, with no error and nothing on `AsyncClient` itself
reflecting the mismatch. Same shape as the `trust_env` gap fixed earlier
this round: an opt-out/opt-in on the client's own constructor arguments was
defeated by the factory's `transport=` override, just for a different set of
kwargs.

**Reproduced:** `create_integration_client(http2=True, trust_env=False)`
against pre-fix code had `client._transport._transport._pool._http2 ==
False`; the equivalent stock `httpx.AsyncClient(http2=True)` has it `True`.
A `cert=` pointed at a nonexistent file raised nothing pre-fix (silently
ignored) versus `FileNotFoundError` post-fix (proof the value now actually
reaches `AsyncHTTPTransport`'s SSL-context construction — same verification
shape as `test_create_integration_client_trust_env_false_transport_ignores_
env_ssl_vars` used for `trust_env`).

**Fix:** `http1`, `http2` and `cert` are pulled out as named parameters on
`create_integration_client()` (default `http1=True`, `http2=False`,
`cert=None`, matching stock httpx's own defaults) and forwarded to every
`AsyncHTTPTransport(...)` this module constructs — the default transport,
the explicit-`proxy=` mount, and each environment-derived proxy mount built
by `_environment_proxy_mounts()` (which also gained the same three
parameters). They're still passed to `httpx.AsyncClient(...)` too, matching
stock behavior byte-for-byte (including its `http2=True` → `import h2`
availability check, which now runs consistently with the transport actually
requiring `h2` to negotiate HTTP/2).

No current connector call site passes any of the three — this is the same
"future caller must not silently lose what it asked for" posture as the
`trust_env`/`proxy` parameters already documented in this function's
docstring.

**Mechanism changed (2026-09-25, [#2681](https://github.com/thegspiro/the-logbook/pull/2681)).**
httpx 0.28 deprecates `cert=` on a transport, so `cert` no longer reaches any
transport, or `httpx.AsyncClient`, as that keyword. `_tls_verify()` in
`integration_services/base.py` builds an `ssl.SSLContext` with
`httpx.create_ssl_context()` and loads the client certificate into it with
`load_cert_chain()`. Every transport this module constructs receives that
context as `verify=`. The guarantee above is unchanged: a requested client
certificate still reaches every transport, the proxy mounts included.

**Guard tests** (`test_integration_response_size_cap.py`):
`test_create_integration_client_http2_kwarg_reaches_the_transport`,
`test_create_integration_client_http1_false_reaches_the_transport`,
`test_create_integration_client_default_still_has_http2_disabled` (no
regression to the no-kwarg default), `test_create_integration_client_cert_
kwarg_reaches_the_transport`, and `test_environment_proxy_mounts_forwards_
http2_and_cert` (the proxy-mount path specifically — a proxied request must
not lose protocol selection or mTLS that the direct-connection transport
was given).

### INT-9 — P2 — Google Calendar's connector bypasses the response-size cap and any future centralized deadline — ✅ size cap and timeouts FIXED 2026-10-05; wall-clock deadline still tracked

**Resolution (2026-10-05, owner decision: a custom httplib2
`connection_type` with a byte cap and timeout, tested against a streamed
response):** `_build_service()` now hands `build()` an `AuthorizedHttp` over
`_BoundedHttp`, whose connections cap the body at `MAX_RESPONSE_SIZE` as it
is read (and decompressed output via httplib2's `decode_limit_hard`), raising
the shared `ResponseTooLargeError`, and apply `INTEGRATION_TIMEOUT`'s 5 s
connect / 10 s read budgets as socket timeouts. Guarded by
`backend/tests/test_google_calendar_http_bounds.py` against a real loopback
server streaming four times the cap, a gzip bomb, and stalled responses. The
wall-clock deadline remains open for this connector and the `httpx` ones
alike — see `docs/KNOWN_LIMITATIONS.md`. The original finding follows
unchanged.

**What:** the CHANGELOG's INT-7 entry says "every integration connector's
outbound calls are covered." That was already corrected once this round for
PayPal (see the pass-3 note above); it is still inaccurate for a second,
architecturally distinct connector. `GoogleCalendarService._build_service()`
(`google_calendar_service.py`) does not use `httpx` at all — it calls
`googleapiclient.discovery.build("calendar", "v3", credentials=creds)` with
no `http=` argument, so `push_event`/`update_event`/`delete_event`/
`test_connection`'s `.execute()` calls run through whatever transport
`googleapiclient` builds for itself, not `create_integration_client()`.

**Investigated, not guessed:** traced `build()`'s no-`http=` path to
`googleapiclient._auth.authorized_http()`, which returns
`google_auth_httplib2.AuthorizedHttp(credentials, http=build_http())` —
`build_http()` is a plain `httplib2.Http()`. `httplib2.Http._conn_request()`
(confirmed against the pinned version, `httplib2==0.32.0`) always ends with
`content = response.read()` — an **unconditional, unbounded read** on the
raw `http.client.HTTPResponse` from Python's stdlib, called with no byte
limit and no streaming option. `httplib2` exposes no size-cap parameter of
any kind; the only way to intercept the read is a custom `connection_type`
passed to `httplib2.Http()` that overrides `getresponse()` to wrap the
returned response's `.read`, reaching into `httplib2`'s private connection
internals plus CPython's `http.client` implementation details — a materially
different, deeper, and more fragile change than the httpx-based fixes in
this document (including PayPal's, which was a one-line swap to the
existing shared factory because PayPal was already on `httpx`). Per this
round's own scope guidance, that fix was not attempted under review-loop
time pressure without being able to verify it holds across `httplib2`
versions and the two layers of wrapping (`google_auth_httplib2.
AuthorizedHttp` around `httplib2.Http`) in between.

**Decision: qualify and track, not force a fix.** The same reasoning
applies to the `KNOWN_LIMITATIONS.md` wall-clock-deadline follow-up's
proposed centralized fix (an `httpx.AsyncClient` subclass wrapping `send()`
in `asyncio.timeout()`, constructed inside `create_integration_client()`):
it would also miss Google Calendar entirely, for the identical reason — the
connector never reaches that factory. Both documents are corrected below
rather than left overclaiming coverage.

**Impact:** same reachable population and severity class as INT-7 pre-fix,
scoped to one connector — an org admin (`integrations.manage`) who connects
a Google Calendar integration is trusting Google's API and OAuth token
endpoint to behave; a compromised or malfunctioning response from either is
not bounded by size or, once a deadline exists elsewhere, by time. Lower
practical likelihood than the general case (the endpoint is Google's own,
not an arbitrary self-hosted destination — there is no SSRF vector here,
same as PayPal's), but the exception is real and now named rather than
silently absent from every "every connector" claim.

**Fix applied:**

- `CHANGELOG.md`'s INT-7 entry: qualified from "every integration
  connector's outbound calls are covered" to name the httpx-based scope and
  the Google Calendar exception explicitly.
- `docs/KNOWN_LIMITATIONS.md`: new entry ("Google Calendar's Connector
  Bypasses the Shared HTTP Hardening") tracking this as an open, scoped
  follow-up, and the existing wall-clock-deadline entry corrected to note
  its proposed fix would not reach Google Calendar either.

**Not fixed this round** — reaching `httplib2`'s read path safely needs its
own dedicated, verified change (a custom `connection_type` with a test
proving it actually aborts an oversized `httplib2` response, not just that
it compiles), tracked in `KNOWN_LIMITATIONS.md` rather than guessed at here.

### Completion gate — follow-up round 5 (2026-09-06)

| Check                                                                                                                 | Result                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                         | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                                                                                  | ✅ clean                                                                  |
| `isort --check-only app/ tests/ alembic/`                                                                             | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`                                                                     | ✅ 431 revisions, single head (`d7c1b95e2a40`), PASSED (no schema change) |
| `pytest tests/test_integration_response_size_cap.py -v`                                                               | ✅ 25 passed                                                              |
| backend tests, scope (`-k "integration or salesforce or paypal or webhook or calcom or google_calendar or calendar"`) | ✅ 2411 passed, 21 skipped (env-only), 0 failed                           |

---

## Pass 2 (2026-08-31)

**Backend:** `app/api/v1/endpoints/integrations.py` (710 L, 7 endpoints),
`app/api/v1/endpoints/salesforce_sync.py` (585 L, 9 endpoints),
`app/services/integration_services/salesforce_service.py` (447 L, the raw
REST client), `salesforce_oauth_service.py` (161 L, the OAuth connect flow),
`salesforce_sync_service.py` (958 L, bidirectional sync orchestration),
`app/schemas/integration.py` (303 L, config schemas).
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none — no schema change this iteration.

---

## Scope

Pass 2 of the rotation. File sizes are within a line or two of pass 1's read
(`integrations.py` 711→710, `salesforce_sync.py` 586→585,
`salesforce_service.py` 433→447, `salesforce_oauth_service.py` 162→161,
`salesforce_sync_service.py` 958→958), so the surface has not materially
grown since PR #1910. Re-read all five backend files in full rather than
diffing, since the shallow clone in this environment does not retain history
back to PR #1910's merge. Also re-read `app/schemas/integration.py` in full
and re-checked every `except Exception` in the reviewed files against where
its message ends up (endpoint response vs. internal log), which is what
surfaced INT-6 below — a class of bug the prior two passes' scope did not
specifically target, and the same class FORM-9 (feature 26, the previous
rotation stop) had just found one file over.

## Route inventory

| Method | Path                                 | Auth dependency            | Permission            | Org-scoped                              | Notes                                                                |
| ------ | ------------------------------------ | -------------------------- | --------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/integrations`                      | `require_permission`       | `integrations.manage` | yes (query filter)                      | full config, secrets redacted                                        |
| GET    | `/integrations/connected`            | `get_current_user` (bare)  | none                  | yes (query filter)                      | deliberate INT-3 carve-out — status-only projection, no URLs/secrets |
| GET    | `/integrations/{id}`                 | `require_permission`       | `integrations.manage` | yes (id + org filter)                   |                                                                      |
| POST   | `/integrations/{id}/connect`         | `require_permission`       | `integrations.manage` | yes (id + org filter)                   |                                                                      |
| POST   | `/integrations/{id}/disconnect`      | `require_permission`       | `integrations.manage` | yes (id + org filter)                   |                                                                      |
| PATCH  | `/integrations/{id}`                 | `require_permission`       | `integrations.manage` | yes (id + org filter)                   |                                                                      |
| POST   | `/integrations/{id}/test-connection` | `require_permission`       | `integrations.manage` | yes (id + org filter)                   | **INT-6 fixed here**                                                 |
| GET    | `/salesforce/status`                 | `require_permission`       | `integrations.manage` | yes (via `_get_sf_integration`)         |                                                                      |
| POST   | `/salesforce/push/members`           | `require_permission`       | `integrations.manage` | yes (query + `_get_sf_integration`)     |                                                                      |
| POST   | `/salesforce/push/training`          | `require_permission`       | `integrations.manage` | yes (query + `_get_sf_integration`)     |                                                                      |
| POST   | `/salesforce/push/events`            | `require_permission`       | `integrations.manage` | yes (query + `_get_sf_integration`)     |                                                                      |
| POST   | `/salesforce/pull/contacts`          | `require_permission`       | `integrations.manage` | yes (via `_get_sf_integration`)         |                                                                      |
| GET    | `/salesforce/readiness`              | `require_permission`       | `integrations.manage` | yes (via `get_salesforce_sync_service`) | **INT-6 fixed here**                                                 |
| POST   | `/salesforce/preview/members`        | `require_permission`       | `integrations.manage` | yes (query + service)                   |                                                                      |
| GET    | `/salesforce/oauth/authorize`        | `require_permission`       | `integrations.manage` | yes (query)                             | 302 to Salesforce consent screen                                     |
| GET    | `/salesforce/oauth/callback`         | **none** (unauthenticated) | n/a                   | yes (id + org from signed state)        | public by design; compensating control below                         |

16 endpoints, all enumerated. One intentionally public route
(`/salesforce/oauth/callback`), one intentionally bare-auth route
(`/integrations/connected`); both re-verified below. Every other route is
`integrations.manage` **and** resolves its target by id + `organization_id`
together — no route in this feature relies on `require_permission` alone to
scope an object (checklist 14b).

## Verified good ✅ (re-confirmed, not re-derived)

- **INT-1** (send-time SSRF re-validation via `assert_outbound_url_safe` on
  every outbound chat/webhook/Cal.com sender): intact. `_validate_urls_in_config`
  still gates `url`/`webhook_url`/`api_url`/`api_base_url`/`instance_url` at
  write time, unconditionally, in both `connect_integration` and
  `update_integration`; the chat senders and Cal.com client each re-validate
  independently at send time (`slack_service.py`, `discord_service.py`,
  `teams_service.py`, `webhook_service.py`, `calcom_service.py`'s
  `_assert_base_url_safe`).
- **INT-2** (OAuth `error` query param URL-encoded before the redirect):
  intact — `_connect_result_redirect` still does
  `quote(str(reason), safe="")`.
- **INT-3** (full config `list`/`get` gated on `integrations.manage`; a
  `/connected` status-only projection for cross-module callers on bare
  `get_current_user`): intact, registered before `/{integration_id}` so the
  literal path wins (verified in the route inventory above — FastAPI matches
  path operations in registration order and `/connected` is declared first).
- **INT-4** (`_validate_config` returns `model_dump(exclude_unset=True)` so
  a partial PATCH doesn't reset omitted fields to schema defaults): intact,
  explanatory comment still in place, `test_omitted_fields_not_reemitted`
  still passes.
- **INT-5** (`KNOWN_WEBHOOK_DOMAINS` allowlist deliberately uninvoked — an
  owner behavior decision, not a bug): unchanged.
- **Salesforce OAuth flow** (`salesforce_oauth_service.py`,
  `salesforce_sync.py`'s `/oauth/*` routes): signed JWT state (org + integration
  id + exact `redirect_uri` + nonce, `exp`-bound) plus a double-submitted
  httpOnly nonce cookie compared with `secrets.compare_digest`; the
  integration is re-loaded by both `id` **and** `organization_id` from the
  signed state before any token is stored; tokens are stored via
  `set_secret()` (encrypted column), never echoed back. The callback's own
  `except Exception` (line 555 of `salesforce_sync.py`) already logs the real
  exception and returns a fixed `"server_error"` reason code — this path was
  already following the safe pattern INT-6 (below) extends to the two paths
  that were not.
- **SOQL injection defense** (`salesforce_sync_service.py`): every dynamic
  SOQL query traced to its construction site — `_find_contact_by_email` and
  `_find_record_by_external_id` both use `_soql_quote` for values and
  `_soql_identifier` for any field/sobject name reaching the query string
  directly. No new SOQL construction site introduced.
- **Instance-URL domain pinning** (`salesforce_service.py`): the
  client-credentials token endpoint and the instance URL Salesforce returns
  on token refresh are both checked against `_INSTANCE_URL_RE`
  (`^https://[a-zA-Z0-9.-]+\.salesforce\.com$`) before use.
- **Tenant isolation** (checklist 3/14): every by-id query in both endpoint
  files filters `organization_id` in the same `where()` as the id — verified
  per-route in the inventory table above, not sampled.
- **No secret exposure** (checklist 5): `_sanitize_config` redacts every
  key matching `_SECRET_KEY_PATTERN` before serialization; `get_secret`/
  `set_secret`/`clear_secret` are the only paths that touch the encrypted
  secret column; no endpoint response includes a raw secret.

## New/changed surface reviewed since pass 1 (clean)

No functional changes were found between pass 1 (PR #1910) and this pass
other than what pass 1 itself introduced — the file sizes and the read above
confirm this. This pass's contribution is a fresh dimension-5 (data exposure)
pass over the `except Exception` sites in the reviewed files, prompted by the
adjacent FORM-9 finding (feature 26) landing one file over in the same
service package the previous iteration. That produced INT-6 below.

## Findings

### INT-6 — LOW-MED — Unhandled connector exceptions could leak infra details via `test-connection` and `readiness` — ✅ FIXED

**What:** `test_integration_connection()`'s per-connector implementations
(Salesforce, Cal.com, Documenso, Outlook, Google Calendar, NWS weather, the
chat webhooks) mostly raise hand-authored, safe messages on their expected
failure paths (e.g. `"Salesforce rejected these credentials"`), but several
of them do not wrap _every_ outbound call in a try/except — a raw
`httpx`/Google-API-client exception (DNS failure, TLS error, timeout,
malformed-response `JSONDecodeError`) can still propagate up unfiltered. Two
call sites returned that exception text to the client verbatim via `str(e)`
instead of routing it through the project's `sanitize_error_message()` /
`safe_error_detail()` sanitizers (CLAUDE.md's Error Handling section,
checklist dimension 5).

**Where:**

- `backend/app/api/v1/endpoints/integrations.py:710` (was
  `return {"success": False, "message": str(e)}` in `test_connection`'s
  `except Exception as e:`)
- `backend/app/services/integration_services/salesforce_sync_service.py:659`
  and `:697` (`check_readiness`'s two `except Exception as exc:` blocks,
  `report["error"] = str(exc)` and `entry["error"] = str(exc)`), consumed
  directly by `GET /integrations/salesforce/readiness`
  (`salesforce_sync.py:344`, `return await sync_service.check_readiness()`).

**Failure scenario:** an org admin (holding `integrations.manage`) configures
an integration pointing at an unreachable or misbehaving host and clicks
"Test connection", or hits the Salesforce readiness check while the org's
Salesforce instance is having connectivity trouble. If the failure occurs
inside a per-connector call that is not individually wrapped (e.g.
`calcom_service.test_connection`'s and `documenso_service.test_connection`'s
`client.get(...)` calls, `salesforce_service._request`'s raw
`client.request(**request_kwargs)`, or `get_field_names`'s
`describe_sobject`), the raw exception's `str()` — potentially including
low-level connection diagnostics — reached the JSON response unfiltered.

**Impact:** same-org, `integrations.manage`-gated only — not a cross-tenant
leak, and every hand-crafted message the connectors raise on their _expected_
failure paths was already safe (none embeds a secret; auth tokens/API keys
are sent in headers or as a config-supplied `apiKey`/`api_token`, never
interpolated into an exception string). The residual risk is narrower: an
_unhandled_ infra-level exception bypassing the connectors' own safe-message
handling and reaching the client with Python internals (a stack frame, a
driver name, in the worst case a file path) — the same shape and severity
class as FORM-9 (feature 26), reached through a different boundary. Recorded
LOW-MED to match FORM-9's precedent severity for this exact defect class.

**Fix:** both sites now route through `sanitize_error_message()` (matching
the existing `inventory.py:774` precedent for a service-returned error
string, not an exception object — `safe_error_detail()` itself only passes
through `ValueError`/`PermissionError`, and these connectors raise bare
`Exception`, so swapping to `safe_error_detail()` directly would have
replaced every one of the intentional safe messages with the generic
fallback, a functional regression). `sanitize_error_message()` only replaces
a message that matches the SQL/path/traceback unsafe-pattern list, so the
existing hand-authored messages pass through unchanged — verified by a
dedicated regression test (below) alongside the leak-prevention test.

**Correction (2026-08-31, on PR #2087 itself):** Codex caught that
`sanitize_error_message()`'s blacklist is the wrong tool for this specific
boundary. It only recognizes SQL/path/traceback/driver-name patterns — a
realistic DNS/TLS/timeout message like
`[Errno -2] Name or service not known` matches none of them and passed
through unchanged, so the exact scenario the fix was written to close (an
unhandled infra-level exception reaching the client) still leaked. Fixed by
adding `sanitize_connector_error()` (`app/core/utils.py`) as the correct
tool for this boundary: it checks the exception's _type_, not its message —
`type(exc) is Exception` (or an explicitly-named `trusted_types` subclass,
e.g. `PayPalError`) is trusted content from a connector's own hand-authored
raise, and anything else (an `httpx` transport error, any other exception
class) always gets the generic fallback regardless of what its message
looks like, since a generic infra failure has no fixed vocabulary a
blacklist could enumerate. Both original INT-6 sites, plus the
previously-unfixed second `check_readiness` site
(`salesforce_sync_service.py`'s per-sObject `get_field_names` catch, same
method, same defect, not itself named in the original finding) now use it.

Investigating why the exact-type check is _necessary_ (not just a nicety)
surfaced a second, sharper instance of the same root problem: three
connectors' own `test_connection()` — `google_calendar_service.py`,
`outlook_calendar_service.py`, `weather_service.py` — catch a broad
exception and re-raise it as `Exception(f"...: {e}")`, interpolating the
caught exception's raw text into the new message. That re-raised message
_is_ of exact type `Exception`, which is exactly what a type-based check
(correctly) treats as "hand-authored and safe" — so the interpolated raw
text (an httpx DNS/TLS/timeout message, unfiltered) would have reached the
client anyway, defeating both the blacklist approach and the type-check
approach. Confirmed the other reachable connectors (Slack, Discord, Teams,
generic-webhook, Documenso, Cal.com, PayPal) don't have this shape: their
outbound calls are either unwrapped (a raw `httpx` exception propagates
under its own type, which the boundary check already treats as untrusted)
or the exception is fully swallowed and replaced with a static,
non-interpolated message. Fixed all three by dropping the interpolation —
they now log the real exception server-side (`logger.error`) and raise a
static, connector-specific message with no embedded exception text.

## Confirmed still open — nothing needing a product decision

- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` chat-webhook allowlist) —
  re-verified unchanged, still an explicit owner behavior decision (enabling
  it could reject legitimately-proxied webhook setups).

## Schema & migration notes

None — no code change touches a table or column this iteration.

## Guard tests added

- `backend/tests/test_salesforce_sync.py::test_check_readiness_sanitizes_connection_error`
  and `::test_check_readiness_sanitizes_field_lookup_error` — an unhandled
  exception raised inside `check_readiness()`'s two try/except blocks must
  not appear verbatim in the returned report; both fail before the fix
  (raw `OperationalError`/traceback-shaped text present in `report["error"]`)
  and pass after it.
- `backend/tests/test_integrations_security.py::TestTestConnectionEndpointSanitizesErrors`
  — two tests: `test_unhandled_exception_is_sanitized` (an unhandled
  exception raised inside `test_integration_connection()` must not appear
  verbatim in the endpoint's `message`) and
  `test_hand_authored_message_still_passes_through` (a safe, hand-authored
  connector message — e.g. the Cal.com "rejected the API key" message — must
  survive unchanged, so the fix does not regress into the FORM-9-adjacent
  mistake of over-sanitizing legitimate connector diagnostics).

Verified to fail on reintroduction: reverting either `sanitize_error_message`
call back to bare `str(e)`/`str(exc)` fails its corresponding test with the
literal sensitive substring showing up in the assertion diff.

**Correction round guard tests added:**

- `test_salesforce_sync.py::test_check_readiness_sanitizes_infra_exception_with_no_blacklist_match`
  and `::test_check_readiness_field_lookup_sanitizes_infra_exception` — an
  `httpx.ConnectError` with DNS-failure text that matches no
  `sanitize_error_message()` pattern must still resolve to the generic
  fallback, at both `check_readiness()` catch sites.
- `test_integrations_security.py::test_infra_exception_with_no_blacklist_match_gets_generic_fallback`
  — same scenario at the `test-connection` endpoint.
- `test_integrations_security.py::test_paypal_error_still_passes_through` —
  `PayPalError`, the one named `trusted_types` exception besides bare
  `Exception`, must still pass its hand-authored message through unchanged.
- `test_connector_exception_wrapping.py` (new file) — one test per fixed
  connector (Google Calendar, Outlook Calendar, NWS weather): a caught
  DNS-failure exception must not appear, in any form, in the message the
  connector re-raises.

All four verified to fail on reintroduction: reverting `sanitize_connector_error`'s
type check back to an unconditional `sanitize_error_message(str(exc))` call
fails the three infra-exception tests (the DNS text passes through
unfiltered); reverting any of the three connectors' fix back to
`raise Exception(f"...: {e}")` fails that connector's test in
`test_connector_exception_wrapping.py`.

## Completion gate

| Check                                                                                                                                                                               | Result                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                       | ✅ 0 violations                                 |
| `black --check app/ tests/ alembic/`                                                                                                                                                | ✅ 1337 files unchanged                         |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                           | ✅ clean                                        |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                   | ✅ 394 revisions, single head, PASSED           |
| backend tests, scope (integration/salesforce/connector)                                                                                                                             | ✅ 1581 passed, 21 skipped (env-only), 0 failed |
| backend tests, `test_integrations_security.py` + `test_salesforce_sync.py` + `test_integration_services.py` + `test_salesforce_webhook.py` + `test_connector_exception_wrapping.py` | ✅ 172 passed                                   |
| `tsc --noEmit` / `eslint .`                                                                                                                                                         | n/a — no frontend file changed this iteration   |
