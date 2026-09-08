# Security Review — Public Surface & Webhooks

**Prefix:** `PUB` · **Iteration:** 03 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3), 2026-09-08 (pass 4) · **PR:** #1806 (pass 1)

---

## Pass 4 (2026-09-08)

**Backend:** all 12 files under `app/api/public/` (2 351 L, 20 routes) plus
`app/core/public_portal_security.py` (539 L) — **read in full, not diffed** —
and the collaborators the public routes actually reach:
`app/schemas/public_portal.py`, `app/utils/webhook_replay.py`,
`app/services/integration_services/webhook_service.py`'s two verifiers,
`paypal_service.verify_webhook_signature`, `finance_service.approve_by_token`,
`forms_service.submit_public_form` / `_create_public_submission` /
`_sanitize_submission_data`, `membership_pipeline_service.get_prospect_by_token`,
`scheduling_service.get_user_by_calendar_token` / `get_shifts_for_user_feed`,
`security_middleware.public_rate_limit` / `daily_cap_exceeded`,
`core/database.get_session`
**Frontend:** none modified; `modules/prospective-members/services/api.ts`,
`services/formsServices.ts` and the three `fetch()` call sites read to settle
the response-cache question below
**Migrations:** none written

### Scope — full read, not a diff

`git log 9f7e3f314..main -- backend/app/api/public/ backend/app/core/public_portal_security.py`
(pass 3's own closing commit as the lower bound, with the corrected file set
pass 3 established) returns **two** commits, `0b5dae82d` and `eb78bc285`, both
feature 27's Integrations work on the webhook transports and the Salesforce
rate-limit docstring — neither introduces a public route.

So a diff-scoped pass would have had nothing to look at, and passes 2 and 3
were both diff-scoped. This pass therefore read all 13 files end to end, the
same methodology change PERM-02's pass 4 made for the same reason, and **that
is what produced all three findings** — every one predates pass 3 and none is
visible in any diff since pass 1. Route count re-derived and unchanged at 20;
file count unchanged at 12.

### Route inventory — all 20 unauthenticated routes

Dimension 1 is "no" for every route here by construction, so it is worked as:
what is the **compensating control**, and does the route resolve its
organization from that control rather than from the request?

| Method | Path                                                       | Compensating control                                                                 | Org resolved from             |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------- |
| GET    | `/api/public/v1/organization/info`                         | API key (bcrypt, selective prefix) → IP 100/min → key n/hour → `public_info` module  | the key's own row             |
| GET    | `/api/public/v1/organization/stats`                        | same                                                                                 | the key's own row             |
| GET    | `/api/public/v1/events/public`                             | same, plus `limit` capped at 100                                                     | the key's own row             |
| GET    | `/api/public/v1/application-status/{token}`                | 256-bit token, 100/min per IP, pipeline opt-in, sliding TTL, `no-store` headers      | the prospect row              |
| GET    | `/api/public/v1/health`                                    | none needed — static strings, no request input read                                  | n/a                           |
| GET    | `/api/public/v1/display/{code}`                            | 40-bit display code, ASCII `fullmatch`, 60/min per IP                                | the location row              |
| GET    | `/api/public/v1/display/{code}/events/{id}/guest`          | same, plus event must be in that room; uniform 404 on every failure                  | the location row              |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-check-in` | 10/min + 10-min lockout, honeypot, per-event daily cap, bounded payload              | the location row              |
| GET    | `/api/public/v1/calendar/{token}.ics`                      | 384-bit feed token, 60/min per IP, `deleted_at IS NULL`                              | the token's user              |
| GET    | `/api/public/v1/forms/{slug}`                              | 48-bit hex slug (regex), 60/min + 5-min lockout, published+public only               | the form row                  |
| POST   | `/api/public/v1/forms/{slug}/submit`                       | 10/min + 10-min lockout, CAPTCHA, honeypot, per-slug daily cap, sanitizer            | the form row                  |
| GET    | `/api/public/v1/legal`                                     | 30/min per IP, `limit(2)` single-org guard, 100 kB cap, plain text only              | n/a — anonymous               |
| GET    | `/.well-known/security.txt`                                | none needed — rendered from settings, no request input read                          | n/a                           |
| POST   | `/api/public/v1/webhooks/salesforce/{integration_id}`      | HMAC-SHA256 (fail closed if unconfigured), 30/min, 500-record cap, replay guard      | `integration.organization_id` |
| POST   | `/api/public/v1/webhooks/paypal/{integration_id}`          | PayPal `verify-webhook-signature` (fail closed), 60/min, replay guard                | `integration.organization_id` |
| POST   | `/api/public/v1/webhooks/documenso/{integration_id}`       | shared secret **or** HMAC (fail closed), 30/min, replay guard                        | `integration.organization_id` |
| POST   | `/api/public/v1/webhooks/calcom/{integration_id}`          | HMAC-SHA256 (fail closed), 30/min, replay guard                                      | `integration.organization_id` |
| GET    | `/api/public/v1/finance/approvals/{token}`                 | 256-bit token, 30/min per IP; returns step name/status only, no amount               | the record's chain            |
| POST   | `/api/public/v1/finance/approvals/{token}/approve`         | same + `with_for_update()` + PENDING re-check + expiry + self-approval guard         | the record's chain            |
| POST   | `/api/public/v1/finance/approvals/{token}/deny`            | same (no self-approval guard, deliberately — withdrawing your own is not a conflict) | the record's chain            |

### Verified good ✅

- **All four webhook receivers verify before they act, and fail closed when
  unconfigured.** Mechanism, per receiver: Salesforce and Cal.com compare an
  HMAC-SHA256 over the **raw body** with `hmac.compare_digest`; Documenso
  accepts either that or a `compare_digest` on the shared secret; PayPal asks
  PayPal's own `verify-webhook-signature` API and treats anything that is not
  an explicit `SUCCESS` — a missing header, an unconfigured `webhook_id`, a
  transport failure, a ≥400 — as "do not trust this". Each returns/raises
  **before** any service call, so no forged payload reaches
  `sync_inbound_contacts`, `record_external_payment` or
  `complete_current_step_for_integration_event`.
- **No webhook trusts the payload for tenancy.** Mechanism: all four resolve
  the organization from `integration.organization_id` on a row selected by
  `(id, integration_type, enabled)`; the payload's own fields are never read
  for an org, and the integration type is part of the `WHERE`, so a Cal.com id
  cannot be presented to the Documenso route.
- **Replay protection is ordered correctly at all four**, in two different
  correct ways: PayPal, Documenso and Cal.com fingerprint **after** signature
  verification (an unsigned request must not be able to poison a fingerprint);
  Salesforce additionally defers it past payload-shape validation, which is
  PUB-1 round 2's fix and is still in place at `salesforce_webhook.py:173`.
- **The finance token path still holds every guard passes 1–2 established.**
  Mechanism, re-read at current line numbers: `finance_service.py:951-999` —
  `with_for_update()` on the record joined to its chain, `status != PENDING`
  rejected, expiry checked, `_ensure_current_step`, the `EMAIL`-approver
  self-approval comparison (PUB-4), and `approval_token = None` before the
  flush, so the token is single-use.
- **`display.py`'s guest check-in still resolves org and event from the
  display code**, and both rejection gates still precede the atomic daily-cap
  `INCR` (`display.py:335-361`) — the ordering `b2b2c53c` established and pass
  3 recorded.
- **No CSV writer and no `like`/`ilike` anywhere in the 13 files** (checklist
  §4, Pitfalls #15 and #25): grep returns zero hits in `app/api/public/` and
  `public_portal_security.py`. The one LIKE that reads this feature's data is
  the admin-side access-log filter, and it already carries `like_pattern` +
  `escape=LIKE_ESCAPE_CHAR` (`public_portal_admin.py:398-402`).
- **No public response is reachable by the frontend response cache.**
  Mechanism: `utils/apiCache.ts` is imported only by `services/apiClient.ts`
  (SEC-00 pass 4's finding, re-derived here), and every frontend caller of an
  `/api/public/v1/...` path uses bare `axios`, bare `fetch`, or a
  `createApiClient()` instance — checked at all seven call sites, including
  `application-status`, which is the only one returning a person's name.

### Findings

Three, all reachable without credentials or with only a valid API key, all
older than pass 3.

#### PUB-5 — MED — The per-API-key hourly quota could be held below its ceiling indefinitely — ✅ FIXED

**What:** `check_rate_limit` keeps a per-process in-memory tally and, once that
tally reaches 90 % of the key's limit, replaces it with a `COUNT(*)` over
`public_portal_access_log` — **assigning** the database's answer rather than
reconciling with it.

**Where:** `app/core/public_portal_security.py:157-172` (pre-fix; the fix is
at `:157-182` now).

**Failure scenario:** that table only ever carried requests that _committed_.
`get_db` rolls the session back whenever the handler raises (asserted, not
assumed — see the guard test), and every non-200 answer on this router is an
`HTTPException`; a 401 or 429 never reaches the handler that writes the row at
all. So for a caller whose requests error, `db_count` is **0** forever. Take a
department that has switched its portal off: every call answers 503 from
`check_portal_enabled`, nothing is persisted, the in-memory tally climbs to
900 of 1 000, the reconciliation query answers 0, the tally is reset to 0, and
the loop repeats. The hourly key quota is never reached. The same undercount
applies in the ordinary case too, more mildly: the current request's own row is
not committed when the check runs, and neither are concurrent in-flight ones.

**Impact:** the second of the two layers protecting this surface (per-key
hourly) is bypassable by any API-key holder whose traffic does not persist a
log row; only the per-IP 100/min limiter remains, which permits ~6 000
requests/hour against a default 1 000/hour key ceiling. Requires a valid API
key, so it is a key-holder-abuse and noisy-neighbour issue rather than an
anonymous one.

**Fix:** `current_count = max(current_count, db_count)`, then write that back to
the cache. The database can still _raise_ a per-process tally to the
cross-process truth — the reason the query exists, and the case a
multi-worker deployment depends on — but it can no longer lower it.

**PUB-5b — the reconciliation query counted the wrong window — ✅ FIXED
(Codex, pass 4 round 2):** the fix above still scoped its `COUNT(*)` to a
rolling `now - 1 hour`, while `current_count` and `X-RateLimit-Reset` both key
off the fixed clock-hour bucket `hour_timestamp` starts. Shortly after a clock
hour turns over, the rolling window still includes the tail of the _previous_
bucket's traffic, and because the reconciled value can now only raise the
in-memory tally and never lower it, an inflated `db_count` from stale traffic
would stick in the new bucket for the rest of the hour — 429ing legitimate
requests until the bucket rolled over again. Fixed by scoping the query to
`datetime.fromtimestamp(hour_timestamp, tz=timezone.utc)` instead of `now -
timedelta(hours=1)`. `test_reconciliation_query_scopes_to_the_current_hour_bucket`
(`tests/test_public_portal_security.py`) captures the query's compiled lower
bound and asserts it equals the hour bucket's start; verified red against the
rolling-window version (asserted `2026-09-08T04:31:25...` — wall-clock minus
one hour — where `2026-09-08T05:00:00` — the bucket start — was expected).

#### PUB-6 — LOW — The data whitelist's default-deny path answered 500, not an empty document — ✅ FIXED

**What:** `portal.py` builds the full organization dictionary, runs it through
`filter_data_by_whitelist`, and constructs the response model from what
survives. Under Pydantic v2, `Optional[str]` **with no default is a required
field** that merely accepts `None` — and every field on
`PublicOrganizationInfo` and `PublicOrganizationStats` was declared that way.

**Where:** `app/schemas/public_portal.py:219-241` (pre-fix); the two call
sites are `app/api/public/portal.py:314` and `:411`.

**Failure scenario:** nothing seeds `public_portal_data_whitelist` — rows exist
only once an administrator adds them through `POST /whitelist`, and
`bulk-update` updates existing rows rather than creating any. So a fresh
deployment that enables the portal and issues a key gets `filtered_data == {}`,
`PublicOrganizationInfo(**{})` raises `ValidationError`, the handler's own
`except Exception` catches it, and `GET /organization/info` answers **500 to
every request** — as does `/organization/stats`. A partially-whitelisted
organization fares no better: nine of nine fields had to be enabled. Even then
`mailing_address` was typed `Dict[str, str]` while the handler builds it with a
`None` `line2`/`country`, so a complete whitelist could still 500 on a real
address. Verified against the real models
(`model_fields[...].is_required()` is `True` for all nine and all six) and by
constructing them.

**Impact:** availability, and a control whose safe default cannot express
itself. It fails _closed_ — the 500 body is the app's generic
`"Internal server error"`, so nothing leaks — but "no fields whitelisted" is
supposed to mean "an empty document", and it meant "a broken endpoint". Two
prior audits recorded "whitelist is default-deny"
(`docs/app-review/public-portal.md:137`) on the strength of the filter alone,
without ever exercising the model it feeds.

**Fix:** every field on both models now defaults to `None`, and the address
components are `Dict[str, Optional[str]]`. This exposes nothing new — the
whitelist filter upstream is untouched, and an un-enabled field serialises as
`null` rather than 500ing — and it is the shape
`docs/PUBLIC_API_DOCUMENTATION.md:145` already documents ("Only whitelisted
fields are returned. Some fields may be null if not configured").

#### PUB-7 — LOW — `GET /events/public` 500s whenever it is configured to return anything — 🚩 FLAGGED

**What:** the handler emits `{title, description, start_datetime, end_datetime,
location, event_type}` per event; `response_model=list[PublicEvent]` requires
`{id, title, description, event_type, start_time, end_time, location,
is_public}`. Three of the eight names do not exist in what the handler
produces, and all eight are required.

**Where:** `app/api/public/portal.py:482-493` (the dict) vs
`app/schemas/public_portal.py:269-279` (the model).

**Failure scenario:** with **no** events field whitelisted, `filtered_event` is
`{}`, the `if filtered_event:` guard skips it, and the route returns `[]` —
which is why this has never been noticed. Whitelist even one events field and
have one upcoming non-cancelled, non-draft `PUBLIC_EDUCATION` event, and
FastAPI's response serialisation raises `ResponseValidationError` outside the
handler's `try`, producing a 500 from the global handler. Reproduced with the
real `PublicEvent` model and the handler's exact dictionary.

**Impact:** the department's public website gets a 500 exactly when an
administrator finishes configuring it. Availability only — fail-closed, generic
500 body, no leak.

**Why flagged rather than fixed:** unlike PUB-6, this cannot be repaired
without deciding a public contract. `docs/PUBLIC_API_DOCUMENTATION.md:207-220`
documents the **schema's** field names — `start_time`, `end_time`, plus `id`
and `is_public` — so either
(a) the handler is re-keyed to the documented names, which silently voids any
`start_datetime`/`end_datetime` whitelist row an administrator has already
created and requires deciding whether the internal event `id` and `is_public`
should become whitelistable at all (a data-exposure decision on an
unauthenticated surface), or
(b) `PublicEvent` is re-declared to match the handler and made all-optional,
which contradicts the published documentation and any client written against
it. They are not equivalent, and the wrong one is worse than the 500. Mirrored
into `docs/KNOWN_LIMITATIONS.md`.

#### PUB-8 — LOW — The public portal access log recorded successes only — ✅ FIXED (in part) / 🚩 FLAGGED (in part)

**What:** `log_access` ends at `db.flush()`, so the row's fate is the request
transaction's — and `get_db` rolls that back on any raised exception. All six
`except` branches in `portal.py` log the failing status code and then re-raise,
so the row they wrote was discarded on the way out.

**Where:** `app/core/public_portal_security.py:282-283` (the flush);
`app/api/public/portal.py:318`/`:322`, `:415`/`:419` and `:508`/`:512` (the
six branches that log a failure and re-raise).

**Failure scenario:** `detect_anomalies` reads this table on every request and
has three signals; one of them counts rows with `status_code == 401` in the
last five minutes. **Nothing in `app/` has ever written a 401 row** — the only
caller of `log_access` is `portal.py`, and `authenticate_api_key` raises its
401 from the dependency, before the handler runs. So that branch was
unreachable, and the 503/404/500 rows the other branches did write were rolled
back. An operator reviewing the access log, or the "flagged suspicious" count
on the admin screen, saw only traffic that had succeeded.

**Impact:** detection and audit, not access control. It is also what made PUB-5
exploitable in the shape described above.

**Fix (the rollback half):** `log_public_api_request` now commits the row it
just wrote, guarded — a commit failure is logged and rolled back rather than
replacing the answer the caller was owed. Safe because these three handlers
write nothing else: the access-log entry is the only pending row, and the
session is created with `expire_on_commit=False`, so committing mid-handler
cannot expire an attribute a later line reads.

**Flagged (the 401 half):** logging a failed authentication needs
`PublicPortalAccessLog.organization_id` and `config_id` to be nullable — an
unknown API key cannot be attributed to an organization, and both columns are
`nullable=False` (`models/public_portal.py:202-211`), even though the model's
own comment beside `api_key_id` says "NULL if invalid/missing key". That is a
migration plus a decision about how an unattributable row is scoped for the
per-organization admin read, so it is not a security-review-iteration change.
Until then `detect_anomalies`' failed-auth branch stays dead; the per-IP
limiter and `suspicious_ip` are the controls actually covering that case.
Mirrored into `docs/KNOWN_LIMITATIONS.md`.

#### PUB-9 — LOW — `response_model_exclude_unset` was missing, so the PUB-6 defaults round-tripped as explicit `null`s — ✅ FIXED

**What:** PUB-6 gave every field on `PublicOrganizationInfo` /
`PublicOrganizationStats` a `None` default so the models could be constructed
from a whitelist-filtered dict without raising. That fixed construction but
not serialisation: FastAPI's default response behaviour serialises every
declared field, default or not, so a field an administrator never whitelisted
came back as an explicit `"field": null` instead of being absent, and a
partial whitelist returned every field the whitelist had _not_ enabled right
alongside the ones it had — the inverse of "only whitelisted fields are
returned".

**Where:** `app/api/public/portal.py` — the `GET /organization/info` and
`GET /organization/stats` route decorators (neither set
`response_model_exclude_unset`).

**Fix:** both decorators now pass `response_model_exclude_unset=True`.
`PublicOrganizationInfo(**filtered_data)` only marks the whitelist-filtered
keys as "set" (`model_fields_set`), so `exclude_unset` reconstructs exactly
the whitelist's contract: an unwhitelisted field is omitted, and a whitelisted
field that happens to be empty still serialises as `null` (configured but
blank) rather than being dropped. Verified with the existing
`test_public_portal_whitelist_shape.py` suite (unaffected — it asserts on
`model_dump()` without `exclude_unset`, i.e. the model's own default-null
shape, not the route's wire shape) plus manual construction:
`PublicOrganizationInfo(name="x").model_dump(exclude_unset=True)` returns
`{"name": "x"}`, not the other eight keys as `null`.

Found by Codex on PR #2393, pass 4.

#### PUB-10 — LOW — The access-log commit ran before the response model was actually validated — ✅ FIXED

**What:** PUB-8 made `log_public_api_request` commit its row immediately so it
survives a raised `HTTPException`. All three success paths called it and then
_separately_ built the return value on the next line — `return
PublicOrganizationInfo(**filtered_data)` for the two organization routes,
`return events` (a list of plain dicts) for `/events/public`. FastAPI runs
`response_model` validation against the return value _after_ the handler
returns, outside the `try` these three routes commit inside. A failure at that
stage answers the client 500, but the 200 row was already committed and
`get_db` cannot roll it back on the way out — durable proof of a request the
security log now misreports as successful.

**Where:** `app/api/public/portal.py` — all three success paths
(`get_organization_info`, `get_organization_stats`, `get_public_events`).

**Failure scenario:** concretely reachable on `/events/public` today, via
PUB-7: whitelist one events field, have one matching upcoming event, and the
handler's dict is missing three fields `PublicEvent` requires. Before this
fix: `log_public_api_request(..., 200, ...)` commits, `return events` hands
FastAPI a list of dicts, response serialisation raises
`ResponseValidationError`, the client gets 500 — and the access log says 200.
The two organization routes were not concretely reachable the same way
(`PublicOrganizationInfo`/`Stats` have no required fields left after PUB-6),
but the ordering was identical and would have reopened the same class of bug
the moment either model gained a required field.

**Fix:** construct the response value — and thereby run the same validation
`response_model` would — _before_ calling `log_public_api_request`, still
inside the `try`. A `ValidationError` at construction now falls through to the
existing `except Exception` branch and logs 500, matching what the client
actually receives, instead of skipping validation until after 200 is already
durable. `/events/public` now builds a `PublicEvent(**filtered_event)` per
event inside the loop rather than appending the raw dict; this does not change
PUB-7's flagged status or its client-visible 500 — it only makes the access
log agree with the answer the client got. Verified with the full
`test_public_portal_whitelist_shape.py` and
`test_public_portal_access_log_persistence.py` suites (unaffected; neither
exercises FastAPI response serialisation) and by re-reading the reordered
control flow against `test_dependency_teardown_rolls_back_on_httpexception`'s
pinned `get_db` semantics.

Found by Codex on PR #2393, pass 4.

### Checked and deliberately not raised

Recorded so pass 5 does not spend the time again.

- **`token_expires_at` compared naive-to-aware.** `finance_service.py:967,1031`
  compare the column against `datetime.now(timezone.utc)` with no tzinfo
  normalisation, while `finance_approvals.py:113-116` and
  `training_session_service.py:1115` both normalise defensively — which reads
  like a `TypeError` waiting on a money path. It is not: `core/database.py:38`
  registers a global `load` listener that stamps every naive
  `DateTime(timezone=True)` attribute as UTC on ORM load. Traced before being
  written up; the defensive normalisations are belt-and-braces, not evidence of
  a bug.
- **The legacy-prefix bcrypt fan-out.** A caller sending an 8-character
  `X-API-Key` still selects every pre-PP-4 key whose stored prefix is the
  constant `"logbook_"` and bcrypt-verifies each. Bounded by the 100/min per-IP
  limit ahead of it and self-healing (each legacy key's prefix is upgraded on
  first successful use), and PP-4 already recorded it. Unchanged, not re-raised.
- **`get_user_by_calendar_token` does not filter `is_active`.** A deactivated
  member's ICS token keeps resolving. No practical exposure — the feed only
  returns that member's own non-cancelled shift assignments, which a
  deactivated member has none of going forward — and adding the filter is
  feature 15's call, not this one's.
- **`PublicFormResponse` returns `form.id`** despite the call site's comment
  saying "no internal IDs exposed". The slug already identifies the form to the
  same caller, so this discloses nothing the request did not carry.
- **A non-dict JSON body reaches `payload.get(...)` on the Salesforce route**
  (`salesforce_webhook.py:149`), where the other three receivers go through
  `_read_json`'s `isinstance(payload, dict)` guard. A valid HMAC over the body
  is required to get there, so the worst case is a 500 for someone holding the
  secret. Left alone rather than changed on an unauthenticated surface for a
  non-issue.

### Schema & migration notes

No drift, none written. The one schema change (PUB-6) is to Pydantic response
models, not to a table. PUB-8's flagged half would need a migration and is
recorded as such rather than started. PUB-3's `create_all`-only approval tables
remain accepted and unchanged.

### Guard tests added

- `TestCheckRateLimitDbReconciliation` (4 tests,
  `tests/test_public_portal_security.py`) — the reconciliation query must still
  run at the threshold and must still raise a low process-local tally, but must
  not lower one; and a repeated-check loop that pre-fix never limited now
  reaches the ceiling. Verified red against the pre-fix assignment (2 of 4).
- `tests/test_public_portal_whitelist_shape.py` (6 tests) — no field on either
  whitelist-filtered response model may be required, `model()` with nothing
  whitelisted must construct, a partial whitelist must construct, and address
  components may be null. The first is the ratchet: a new field added without a
  default fails it. Verified red against the pre-fix declarations (6 of 6).
- `tests/test_public_portal_access_log_persistence.py` (6 tests) — the access
  log is committed for 200/404/503/500 alike, a commit failure is swallowed and
  rolled back rather than becoming the caller's answer, and — separately — a
  real `TestClient` request pins the FastAPI behaviour the fix exists for, so
  if a future version stopped throwing into the `get_db` generator on an
  `HTTPException` the test says so instead of the fix quietly becoming
  redundant. Verified red against the pre-fix handler (5 of 6; the FastAPI
  behaviour test passes either way, by design).

### Completion gate

| Check                                                                             | Result                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.3.0, flake8-pytest-style 2.2.0)                  | ✅ 0 violations                                                    |
| `black --check app/ tests/ alembic/` (26.5.1)                                     | ✅ 1 533 files unchanged                                           |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                                 | ✅ clean                                                           |
| `validate_migrations.py --strict`                                                 | ✅ single head `1603bd9c59e7`                                      |
| scoped pytest (`-k "public or portal or webhook or salesforce or paypal or ..."`) | ✅ 495 passed, 1 skipped (`py_vapid` not installed — pre-existing) |
| ratchet suites (org-scoping, endpoint-auth, LIKE, CSV, capacity)                  | ✅ 56 passed                                                       |
| **full backend suite**                                                            | ✅ 11 831 passed, 21 skipped, 0 failed                             |
| `check_docs_links.py`                                                             | ✅ 0 broken links                                                  |
| `tsc --noEmit` / `eslint .`                                                       | n/a — no frontend file modified                                    |

---

## Pass 3 (2026-09-01) — re-verified, no new findings

**Scope — corrected mid-review by Codex.** The first cut of this section's
scope command was `git log 36ce7595..HEAD -- backend/app/api/public/`
(`36ce7595` is pass 2's own closing merge — the actual merge commit used as
the lower bound, not a date, per the methodology correction PERM-02's pass 3
recorded after Codex caught a missed commit there). That command only
covers the `app/api/public/` directory, but this feature's declared scope
is 12 files, one of which — `app/core/public_portal_security.py` (the
public portal's API-key resolution and rate-limit controls) — lives outside
that directory, in `app/core/`. The write-up below claimed that file
byte-identical on the strength of a command that never actually looked at
it. Re-run with the complete scope,
`git log 36ce7595..HEAD -- backend/app/api/public/ backend/app/core/public_portal_security.py`:
still exactly one commit, `b2b2c53c`, touching only `display.py` — the
substantive conclusion is unchanged, but it's now the command shown that
establishes it. File count unchanged at 12; route count unchanged at 20
(`grep -rc "@router\."` across all 12 files).

- **`b2b2c53c` — reorders `guest_check_in`'s rejection gates ahead of the
  per-event daily cap.** This is feature 32's (Locations & kiosk) own
  round-2 fix (LOC-32-4), not new work from this pass — cited and
  re-verified rather than re-derived. Before: the daily-cap check (an atomic
  Redis `INCR`, so asking the question spends an allowance slot) ran before
  the check-in-window-open and attendance-finalized checks, so refused
  traffic (before the window opens, or after attendance closes) could
  exhaust the day's cap and deny legitimate guests. After: both rejection
  gates run first; the cap is only spent by a request that would otherwise
  be accepted — the same ordering `event_requests.py`'s public submission
  endpoint already uses (EV-19). Confirmed the reorder is complete (both
  gates precede the cap check in the current file) and that it doesn't
  touch org/location scoping, which is resolved earlier in the same handler
  and unaffected by this diff. Already covered by a guard test in the
  originating PR; not re-added here.

**No new findings.** Pass 1/2's "Verified good" conclusions for the other
11 files (`portal.py`, `core/public_portal_security.py`, `calendar.py`,
`integrations_webhook.py`, `forms.py`, `paypal_webhook.py`,
`finance_approvals.py`, `legal.py`, `responses.py`, `salesforce_webhook.py`,
`security_txt.py`) stand — byte-identical since pass 2, confirmed via the
git log above. PUB-1, PUB-2, PUB-4 remain fixed; PUB-3 remains an accepted,
documented `create_all`-only table (not a defect).

**Completion gate:** no backend or frontend source file was modified by
this pass (the one code change in scope, `b2b2c53c`, predates this pass and
belongs to feature 32). `flake8 app/ tests/ alembic/` and
`python3 scripts/validate_migrations.py --strict` re-run directly to
confirm the baseline this pass sits on is clean; this pass's own PR's CI run
is the authority for the frontend gates and the full test suite, per the
same correction PERM-02 pass 3 recorded (cite the PR's own current-tree CI
run, not a prior PR's).

---

## Pass 2 (2026-08-27)

`git diff` between PR #1806's merge commit (`91406252`) and current `main`
touches only 3 of the 12 files in scope — `finance_approvals.py` (+6/-1),
`legal.py` (+33/-6), `portal.py` (+40/-4). The other 9, including
`display.py` (re-read in full at pass 1 for its guest-check-in growth), are
byte-identical. File count is unchanged at 12 (11 + `__init__.py`) — no new
public endpoint file since pass 1.

- **`finance_approvals.py`:** a new `BudgetLimitExceededError` (fail-closed
  overspend guard, feature 05's territory — `finance_service.py` itself grew
  +519 net lines, out of this feature's declared scope) is now caught and
  mapped to 409 in both `approve_via_token`/`deny_via_token`. Its message is
  a fixed, generic string (`"Insufficient available budget"`, no
  interpolated data) — safe to return raw. Verified PUB-4's self-approval
  guard (`approve_by_token`'s `SeparationOfDutiesError` check) and the
  `.with_for_update()` locking read (Pitfall #27) are both still present and
  still ordered before any state mutation — the new budget check fires later,
  inside `_finalize_approval`, after the guard, so it doesn't disturb the
  ordering PUB-4 depends on.
- **`legal.py`:** a correctness fix (DOC-10 finding: privacy policy and
  terms of service previously shared one `lastUpdated` date, so publishing
  one could misdate the other) — now two independent dated fields, with a
  deprecated `lastUpdated` kept for backward compatibility with the
  documented v1 API shape (a Codex finding on an earlier PR, already
  resolved before this pass). `_clean_text` (blocks HTML injection into the
  unauthenticated response) still wraps both new fields; the single-org
  guard (PUB-2) is untouched. No security-relevant change.
- **`portal.py`:** a genuine defense-in-depth fix connecting to feature 02's
  new `require_module` mechanism — `check_portal_enabled` now also checks
  the `public_info` module is enabled (via `OrganizationService
.get_enabled_modules(config.organization_id)`), because this router is
  mounted separately from the session-authenticated `/api/v1` tree
  `require_module` covers, so an API-key caller could keep reading
  organization info/stats/events after an admin turned the module off.
  Applied to all three of this router's module-gated routes
  (`get_organization_info`/`get_organization_stats`/`get_public_events`) —
  confirmed by checking every `check_portal_enabled` call site. The other
  two public routes in this file (`get_application_status`,
  a per-prospect-token endpoint unrelated to the portal API-key system; and
  `health_check`) were correctly left alone — neither was gated by portal
  enablement before this diff either.

**No findings.** No code changes this pass — the changes since pass 1 were
already-complete fixes for other rotation findings (PUB-4 area, DOC-10) and
one new defense-in-depth improvement, none of which introduced a gap.

**Completion gate (pass 2):** flake8/black/isort clean on `app/ tests/
alembic/`; `validate_migrations.py --strict` passed (381 revisions, single
head); pass-1 guard tests (`test_salesforce_webhook.py`,
`test_finance_approval_tokens.py`) 10/10 pass; broader scoped tests (`-k
"finance or legal or public_portal or portal or webhook or salesforce or
display or calendar or security_txt or forms"`) 366 passed, 1 skipped
(pre-existing); full backend suite 9040 passed, 22 skipped (pre-existing),
0 failed. No frontend files touched.

---

## Pass 1 (2026-08-25)

**Backend:** all 12 files under `app/api/public/` (2317 L total) —
`portal.py`, `core/public_portal_security.py`, `calendar.py`, `display.py`,
`integrations_webhook.py`, `forms.py`, `paypal_webhook.py`,
`finance_approvals.py`, `legal.py`, `responses.py`, `salesforce_webhook.py`,
`security_txt.py`
**Frontend:** none touched
**Migrations:** none touched (finding on `ApprovalChain`/`ApprovalChainStep`/
`ApprovalStepRecord` is informational, not a fix)

---

## Scope

Every route here is intentionally unauthenticated — that is what makes it
"public." Six of the twelve files already carry thorough prior coverage
(`docs/module-audit/public-portal.md` + `docs/app-review/public-portal.md`,
4 passes through 2026-08-09, for `portal.py`/`public_portal_security.py`/
`calendar.py`/`display.py`; `docs/module-audit/integrations.md` +
`docs/app-review/integrations.md` for `integrations_webhook.py`;
`docs/module-audit/forms.md` + `docs/app-review/forms.md` for `forms.py`;
`docs/module-audit/storefront.md` for `paypal_webhook.py`). Those were
spot-checked rather than re-derived — full write-up below.

**`display.py` was re-read in full**, not spot-checked: it grew from 119 to
401 lines since the last audit (the entire guest QR check-in feature was
added). **Five files carry no prior audit at all** and were read in full
against all seven checklist dimensions: `finance_approvals.py`, `legal.py`,
`responses.py`, `salesforce_webhook.py`, `security_txt.py`.

Since dimension 1 ("every route carries an auth dependency") is trivially
"no" for every route in this feature by design, it was reframed per-route as:
what is the **compensating control** (rate limit, signed/high-entropy token,
webhook signature, API key, or "truly public, nothing to protect")?

## Route inventory — newly-reviewed files

| File                    | Route                                             | Compensating control                                                                                                | Org-scoped                           | Notes                             |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------- |
| `finance_approvals.py`  | `GET /approvals/{token}`                          | 256-bit token, 30/min/IP                                                                                            | via token→record                     | step name/status only, no amount  |
| `finance_approvals.py`  | `POST /approvals/{token}/approve`                 | same + `.with_for_update()` locking read                                                                            | via token→record                     | only `notes` client-writable      |
| `finance_approvals.py`  | `POST /approvals/{token}/deny`                    | same                                                                                                                | via token→record                     | same                              |
| `salesforce_webhook.py` | `POST /webhooks/salesforce/{integration_id}`      | HMAC-SHA256, fail-closed if unconfigured, 30/min (60s window, no added lockout — corrected in INT-27), replay guard | via `integration.organization_id`    | see PUB-1                         |
| `legal.py`              | `GET /legal`                                      | 30/min/IP; single-tenant-only guard                                                                                 | n/a (anonymous)                      | see PUB-2 (doc only)              |
| `responses.py`          | n/a — shared OpenAPI response shapes, no route    | n/a                                                                                                                 | n/a                                  | no runtime effect                 |
| `security_txt.py`       | `GET /.well-known/security.txt`                   | none needed — server config only, no request input consumed                                                         | n/a                                  | RFC 9116                          |
| `display.py`            | `GET /display/{code}`                             | 60/min/IP, ASCII code regex                                                                                         | via `location.organization_id`       | unchanged from prior audit        |
| `display.py`            | `GET /display/{code}/events/{id}/guest`           | same                                                                                                                | via location org **and** location id | new                               |
| `display.py`            | `POST /display/{code}/events/{id}/guest-check-in` | 10/min+lockout, honeypot, per-event daily cap                                                                       | same                                 | new — full guest check-in feature |

## Verified good ✅

- **`finance_approvals.py` token scheme is solid.** 256 bits of entropy
  (`secrets.token_urlsafe(32)`), 7-day TTL, single-use (token cleared to
  `None` on use), status re-validated to `PENDING` before any write, and the
  mutating fetch uses `.with_for_update()` (`finance_service.py:718,753`) —
  correctly following Pitfall #27 (capacity/state check as a locking read),
  closing the double-approve race a plain re-check would miss.
- **`salesforce_webhook.py` matches the audited `integrations_webhook.py`
  pattern exactly.** HMAC-SHA256 via `hmac.compare_digest`
  (`salesforce_webhook.py:94-95` pre-fix numbering), fails closed with 401 if
  no `webhook_secret` is configured, rate-limited (30/min + 5-min lockout)
  before any DB/HMAC work, replay-protected via the same `is_duplicate_webhook`
  helper. Org resolution never trusts the payload: the integration row's own
  `organization_id` is the only source, and inbound sync's `rank` exclusion
  (verified against CHANGELOG 2026-08-11/12) still holds — a forged/leaked
  webhook secret cannot promote a member's rank.
- **`display.py`'s new guest check-in feature is tenant-safe and
  abuse-resistant.** Org+location resolution is display-code-first by
  explicit design (a leaked code for Room A can't be combined with an
  `event_id` from Room B); every failure path (unknown code, wrong room,
  feature disabled) answers an identical 404, so the endpoint can't be used
  to enumerate which rooms/events exist. Honeypot + a per-event/day cap sit
  alongside the per-IP rate limit specifically because a distributed flood
  defeats per-IP limiting alone and each sign-in has a real side effect
  (a pipeline record). `GuestCheckInResponse` correctly omits
  `prospect_created` (verified against the CHANGELOG 2026-08-11 fix closing
  a prospect-existence enumeration channel) — the field is still computed
  for the audit log only.
- **No injection surface, no unbounded cache, no TODO/FIXME** across any of
  the 12 files.
- **Spot-checks all held** — `portal.py`'s org-scoping, `public_portal_security.py`'s
  selective-prefix + rate-limit-before-bcrypt ordering + bounded caches,
  `calendar.py`'s CSPRNG token + full ICS escaping, `integrations_webhook.py`'s
  signature/replay/org-scoping, `forms.py`'s slug validation + CAPTCHA/honeypot,
  and `paypal_webhook.py`'s signature/replay/audit-logging are all present and
  unchanged in mechanism at their current (drifted) line numbers.

## Findings

### PUB-1 — LOW — Salesforce inbound webhook had no cap on payload record count — ✅ FIXED

**What:** `records = payload.get("records", [])` had no length limit before
each record triggered 1-2 DB queries via `sync_service.sync_inbound_contacts`.

**Where:** `app/api/public/salesforce_webhook.py:143` (pre-fix).

**Failure scenario:** the endpoint is rate-limited per-request (30/min), not
per-record. A party in possession of a valid (or compromised/leaked)
`webhook_secret` could send one oversized, validly-signed request to run an
effectively unbounded number of DB round-trips within that same 30/min
budget. This requires the secret already — not reachable by an
unauthenticated attacker — but every other public write in this feature
(guest check-in's daily cap, the API-key rate limiter's bucket caps) has an
explicit ceiling, and this one didn't.

**Fix:** added `MAX_RECORDS_PER_WEBHOOK = 500`; a request exceeding it gets a
422 before any sync work runs, following the same shape as the existing
`MAX_PHOTOS_PER_ITEM` cap pattern in `equipment_check.py`.

**Fix, round 2 (caught by Codex review on the PR, before merge):** the first
version of this fix placed the new cap check _after_ the existing
`is_duplicate_webhook` replay guard. That guard marks a delivery "seen" via
an atomic `SET NX` the moment it's called — so an over-cap request still got
fingerprinted even though it was then rejected with 422. A provider's
identical retry of that same oversized payload would hit the duplicate
branch and get **200**, which stops the provider from retrying — silently
dropping the batch forever instead of ever being retried at a size the cap
allows. Fixed by moving all payload-shape validation (JSON parse, `sobject`/
`records` presence, the record-count cap) **before** the replay check, so
only a request that's actually going to be processed — or already
duplicate-rejected on its own separate merits — gets fingerprinted.

**Guard tests:** `tests/test_salesforce_webhook.py` —
`test_rejects_payload_over_the_cap` (501 records → 422, matches the cap
number), `test_at_the_cap_passes_the_check` (exactly 500 records reaches the
sync path, proving the boundary is inclusive rather than off-by-one), and
`test_over_cap_payload_is_not_fingerprinted_as_seen` (asserts
`is_duplicate_webhook` is never awaited when the cap rejects a request —
fails if the ordering regresses).

### PUB-2 — NIT — `legal.py`'s single-org guard was correct but unexplained — ✅ FIXED (comment only)

`len(orgs) == 1` (`legal.py:75`) is the only thing preventing a multi-tenant
deployment from leaking an arbitrary organization's legal text to every
anonymous caller (this endpoint has no org context at all — no API key, no
subdomain routing). The code was already correct; added a comment naming the
invariant so a future "simplify this to `.first()`" edit doesn't reintroduce
the leak.

### PUB-4 — MED — Finance token-based approval had no self-approval guard, despite the documented invariant — ✅ FIXED

**What:** `approve_by_token`/`deny_by_token` never called
`assert_different_person()` the way the authenticated `approve_step` does.
The initial pass through this file recorded that as **verified safe**,
reasoning that the token path's approver has no Logbook account/id to
compare against a requester id. **A Codex review comment on the PR correctly
identified this reasoning as incomplete**, and it was wrong to close as a
non-finding: for an `approver_type == EMAIL` step, the approver's identity
_is_ knowable — it's the literal email address on `step.approver_value`.

**Where:** `app/services/finance_service.py:711` (pre-fix).

**Failure scenario:** if a chain step's `approver_value` is configured to
the same email address as the person who submits the request it's meant to
gate (plausible in a small department — e.g. a Treasurer step where the
Treasurer is also the usual requester, or simple misconfiguration), that
person receives the approval-request email themselves and can click through
and approve their own purchase/expense/check request with **zero** guard —
directly contradicting `docs/FINANCE_MODULE.md:181`'s documented invariant
("`allow_self_approval`: By default false — prevents the requester from also
being the approver at any step"). `allow_self_approval` exists specifically
to gate this and defaults to `False`, but nothing read it on this path.

**Fix:** `approve_by_token` now eager-loads `record.step` and, when
`step.approver_type == ApproverType.EMAIL` and `not step.allow_self_approval`,
resolves the requester's email (new `_entity_creator_email` helper, mirroring
the existing `_entity_creator_id`) and compares it case-insensitively against
`step.approver_value`. A match raises `SeparationOfDutiesError` (a
`ValueError` subclass — the endpoint's existing `except ValueError → 400`
mapping picks it up unchanged, no endpoint-layer change needed). Steps using
`POSITION`/`PERMISSION`/`SPECIFIC_USER` approver types are untouched by this
check (no email to compare — the original "no Logbook identity to compare
against" reasoning does hold for those three, just not for `EMAIL`).
`deny_by_token` is deliberately left unguarded, matching the existing
`approve_step`/`deny_step` asymmetry: withdrawing your own request is not a
separation-of-duties conflict, only approving it is.

**Guard tests:** `tests/test_finance_approval_tokens.py` —
`TestApproveByTokenSelfApprovalGuard` covers: rejects when the approver email
matches the requester (case-insensitively), allows when the step explicitly
sets `allow_self_approval=True`, allows when the emails differ, and allows
all three non-`EMAIL` approver types unconditionally.

### PUB-3 — INFO — `ApprovalChain`/`ApprovalChainStep`/`ApprovalStepRecord` have no Alembic migration — not a defect, flagging for the record

No migration creates these three tables — they exist only via the
`create_all` + `_add_missing_model_columns` startup path (Pitfall #26
territory, consistent with the ~39 other tables already documented as
`create_all`-only). The schema itself is correct (`SET NULL` FKs are
`nullable=True`, `models/finance.py:365,433,483,486`). Not fixed because
nothing is wrong to fix — recorded so it's an explicit "yes, intentional"
rather than a silent gap the next reviewer has to rediscover.

## Schema & migration notes

No drift found. `ApprovalChain`/`ApprovalChainStep`/`ApprovalStepRecord`
`SET NULL` FKs are correctly `nullable=True` (see PUB-3). No other model
behind these 12 files was touched this iteration.

## Guard tests added

- `test_rejects_payload_over_the_cap` / `test_at_the_cap_passes_the_check` /
  `test_over_cap_payload_is_not_fingerprinted_as_seen`
  (`tests/test_salesforce_webhook.py`) — fail if the record-count cap
  regresses, its boundary becomes off-by-one, or the replay-fingerprint
  ordering regresses.
- `TestApproveByTokenSelfApprovalGuard` (5 tests,
  `tests/test_finance_approval_tokens.py`) — fail if the token-approval
  self-approval guard regresses, stops respecting `allow_self_approval`, or
  starts blocking non-`EMAIL` approver types it shouldn't.

## Completion gate

| Check                                                                   | Result                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                           | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/`                                    | ✅ unchanged                                                        |
| `isort --check-only app/ tests/ alembic/`                               | ✅ clean                                                            |
| `validate_migrations.py --strict`                                       | ✅ single head                                                      |
| backend tests (scoped: finance/legal/public/webhook/salesforce/display) | ✅ 256 passed, 1 skipped (environment-only: py_vapid not installed) |
| `tsc --noEmit`                                                          | ✅ 0 errors (no frontend files touched)                             |
| `eslint .`                                                              | n/a — no frontend files touched                                     |
