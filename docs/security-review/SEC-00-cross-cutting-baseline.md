# Security Review 00 — Cross-Cutting Baseline

**Prefix:** `SEC` · **Iteration:** 00 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3) · **PR:** [#1799](https://github.com/thegspiro/the-logbook/pull/1799) (pass 1), [#2128](https://github.com/thegspiro/the-logbook/pull/2128) (pass 3)

---

## Pass 3 (2026-09-01) — re-sweep, plus four sweep classes new to this file

**Revised same-day after Codex review on PR #2128, round 1:** four P2
findings against this pass's methodology — a too-narrow tracker sweep that
missed a real gap, a too-narrow JSON shallow-copy sweep, a route-auth method
description that dropped a scan root, and a completion-gate command that ran
the wrong TypeScript compiler. All four verified against real code and
corrected below (one produced an actual source fix,
`app/services/security_monitoring.py`; the rest were methodology/doc
corrections with the same zero-finding conclusion holding once properly
re-checked). See each numbered sweep and the completion-gate section for what
changed.

**Revised again, same day, after Codex review round 2 — on the round-1
source fix itself:** Codex reviewed commit `3b6b65e4` (round 1's fix) and
found it was, itself, incomplete in two ways: the eviction it added ran
unthrottled on a real hot path but evicted one key at a time (so a saturated
tracker re-sorted itself on every single subsequent call), and a fifth
tracker (`_external_endpoints`, a `set()`) that the same fix's own
cap-enforcement helper never actually touched. This is the **second round**
of Codex catching a real gap in the same tracker-cap sweep in the same PR —
said plainly rather than undersold. Both fixed; see sweep 7's write-up below
for the full account of both rounds.

Re-verified pass 1/2's five standing sweeps against current code (backend grew
to 399 Alembic revisions, 1536 routes across 80 `app/api/` files, from pass
2's 381 revisions / 1526 routes), and added four sweep classes named in the
rotation's own "typical categories" list that this file had not yet run as an
explicit whole-codebase pass — each is a class CLAUDE.md documents as a
recurring defect, and each is exactly the kind of thing a per-feature
iteration can only ever show "not here" for. This pass does not re-derive pass
1/2's conclusions; it re-checks them against current code and extends
coverage, per the rotation's own rule (`docs/security-review/PROGRESS.md`
line ~4220).

### Re-verified standing sweeps

| #   | Class swept                      | Method                                                               | Result                                                                                    |
| --- | -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports     | `grep` for `csv.writer(` / `csv.DictWriter(` outside `csv_export.py` | **clean** — 0 sites, unchanged                                                            |
| 2   | `SET NULL` on `NOT NULL` columns | `test_set_null_fks_are_nullable` (guard test)                        | **clean** — passes                                                                        |
| 3   | Proxy-IP attribution             | grep `request.client.host`                                           | **clean** — same 3 hits as pass 1/2 (2 comments, 1 deliberate use inside `get_client_ip`) |
| 4   | Alembic chain integrity          | `backend/scripts/validate_migrations.py --strict`                    | **clean** — 399 revisions, single head `4e7e125cb00f`, no duplicate ids                   |
| 5   | LIKE-wildcard handling           | `tests/test_like_escaping.py` (2 guard tests)                        | **clean** — both pass; no new call site reintroduced a raw copy or dropped `escape=`      |

**Route auth coverage re-check (corrected on Codex review — see below):** an
AST walk of every route decorator across **two scan roots**: the 68 files
`api/v1/api.py` imports and registers (derived from its router registrations,
not a directory glob — pass 2's Codex-caught correction), plus the 10 routers
in `app/api/public/` that `backend/main.py` mounts **directly**
(`app.include_router(public_portal_router, ...)` etc. — these are never
imported by `api.py` at all, so a walk scoped to `api.py`'s registrations
structurally cannot see them). `api/v1/api.py` itself is also walked, for the
bare `GET /` root route it defines. This two-root method is what pass 1's
original "whole `app/api/`" directory walk did implicitly; pass 2 preserved it
by scanning `api/v1/endpoints/`, `api/v1/onboarding.py`, and `api/public/` as
three explicit roots; this pass's own prose (before this correction) had
narrowed the _stated_ method to "files registered in `api.py`" and dropped the
explicit second root — the walk's actual output still matched pass 1/2's
totals, but the method sentence no longer supported the conclusion,
[per Codex review](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900139059).

Re-running with both roots stated explicitly finds **69 routes with no
`Depends()`-recognized auth dependency**, unchanged from pass 1/2's count but
with one raw hit reclassified and the `public/*` subtotal corrected:

| Bucket                                               |  Count |
| ---------------------------------------------------- | -----: |
| `auth.py` (login, register, OAuth, password reset)   |     14 |
| `elections.py` (token-scoped ballot routes)          |      4 |
| `event_requests.py` (public outreach-request routes) |      4 |
| `events.py` (`GET /events/public-calendar`)          |      1 |
| `salesforce_sync.py` (OAuth callback)                |      1 |
| `onboarding.py` (bootstrap routes)                   |     24 |
| `app/api/public/*` (10 routers, main.py-mounted)     |     20 |
| `api/v1/api.py` (`GET /` root)                       |      1 |
| **Total**                                            | **69** |

The `public/*` figure is **20, not the 22** pass 2/3 had been carrying
forward — verified by direct AST count of every `@router.<verb>` in
`app/api/public/*.py` today (10 files: `calendar`, `display`×3, `finance_
approvals`×3, `forms`×2, `integrations_webhook`×2, `legal`, `paypal_webhook`,
`portal`×5, `salesforce_webhook`, `security_txt` = 20), and it matches pass
1's own original count on this same directory ("20 in `api/public/`" —
see the Pass 1 section below). The "22" was never re-derived after pass 1; it
was carried forward across pass 2 and pass 3 as prose. All 20 are
intentionally public (rate-limited, token-addressed, webhook-signature- or
CAPTCHA-verified) — no genuine gap, same conclusion as pass 1, just a
corrected subtotal.

**One raw AST hit is a false positive, not a finding:**
`app/api/v1/endpoints/inventory.py`'s `@router.websocket("/ws")` (`inventory_
websocket`) carries no `Depends()` in its signature, so a decorator-only scan
flags it. It is not ungated: WebSocket handshakes can't rely on the same
`Depends()`-before-response flow as HTTP routes (the socket must call
`.accept()` first or the browser sees a bare HTTP 403 with no close code), so
this route authenticates **in the function body** — through
`AuthService.get_user_from_token()` against the same access-token-type,
live-session, and expiry checks as every HTTP request, reading the token from
the `access_token` cookie with a query-param fallback for non-browser
clients. Manually confirmed correct; excluded from the 69. This is a
documented blind spot of the AST method going forward: it recognizes auth
expressed as a `Depends()` marker, not auth checked manually in a handler
body, and WebSocket routes are the one place in this codebase that pattern
appears.

Every one of the 69 is confined to the same features pass 1 named: auth (14),
`event_requests.py`'s 4 public routes, `elections.py`'s 4 token-scoped
routes, `events.py`'s public calendar (1), `onboarding.py`'s 24 bootstrap
routes, `salesforce_sync.py`'s OAuth callback, the API root, and the
`public/*` surface (now correctly 20, not 22). **No new ungated route outside
those features**, and the one route the wider method newly surfaced
(`inventory_websocket`) is correctly gated, just not decorator-visible.

### New sweep classes (first run in this file)

| #   | Class swept                                               | Method                                                                                                                                                                               | Result                                                                                                    |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)                   | `grep -rn "BaseHTTPMiddleware" app/`                                                                                                                                                 | **clean** — 0 imports/usages; the 7 hits are all comments in `security_middleware.py` documenting the ban |
| 7   | Unbounded in-memory trackers (Pitfall #9)                 | broadened on Codex review (see below) — module-level _and_ `self.<name> = {}`/`= set()` instance trackers, whole `app/` tree                                                         | **3 gaps found and fixed across two Codex rounds** — see below                                            |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)           | `grep` for `window.confirm(`/`window.alert(`/`window.prompt(` in `frontend/src/`; confirmed `no-restricted-syntax`'s `noBlockingBrowserDialogs` is still wired in `eslint.config.js` | **clean** — 0 raw calls in source (tests excluded); the ESLint rule is present and active                 |
| 9   | JSON-column shallow-copy-then-nested-mutate (Pitfall #12) | broadened on Codex review (see below) — every JSON/`MutableDict`-typed model attribute (132 names), whole `app/` tree                                                                | **clean** — see below for the corrected method and count                                                  |

**Sweep 7 correction (Codex review):** the original method (`grep` for
module-level `defaultdict(`/`= {}`) cannot find a tracker initialized on
`self` inside `__init__`, and one exists:
[`SecurityMonitoringService`](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900139050)
(`app/services/security_monitoring.py`) is a process-wide singleton
(`security_monitor = SecurityMonitoringService()`) whose `__init__` sets
`self._login_attempts`, `self._session_ips`, `self._data_transfers`, and
`self._api_calls` — four `Dict[str, list]` trackers keyed on attacker-
controlled IPs/user ids/session ids. Re-swept with `grep -rn "self\.\w+\s*=\s*
({}\|set()\|defaultdict(\|\[\])"` across the whole `app/` tree (not just
`app/core/`) for anything tracking request/security state; this is the only
additional tracker class found (all other `self.<dict>` hits are per-request
caches scoped to a single request/response cycle, not cross-request state).

Read the file rather than trusting Codex's "happen to be bounded" claim.
All four dicts share one cap (`_MAX_TRACKING_KEYS = 5_000`) enforced by
`_enforce_key_caps()` (evicts the least-recently-active keys first once a
dict exceeds the cap) plus a throttled (≤ once/60s) stale-entry sweep,
`_evict_stale_tracking_keys()`, which calls `_enforce_key_caps()`
unconditionally first. **But two of the four were not actually reached by
either function on the hot path that grows them:** `detect_session_hijack`
(writes `_session_ips` on every request through `security_middleware.py`) and
`detect_data_exfiltration` (writes `_data_transfers`) called neither eviction
function themselves. The only caller of `_enforce_key_caps` /
`_evict_stale_tracking_keys` was `detect_brute_force` — invoked exclusively
from the password `/auth/login` endpoint (`app/api/v1/endpoints/auth.py`) —
and `analyze_request` (the method that wraps the full time-based sweep,
`_check_rate_limit`) is never called anywhere in the app at all, dead code.
For an organization running SSO/OAuth-only (`AZURE_AD_ENABLED` /
`GOOGLE_OAUTH_ENABLED`, no password logins), `detect_brute_force` — and so
every cap on every one of the four dicts — would never fire, and
`_session_ips`/`_data_transfers` would grow without bound for the life of the
process, one entry per authenticated request.

**Fixed** (trivial, low-risk — one line each, mirroring the existing
`detect_brute_force` self-cap pattern): `detect_session_hijack` and
`detect_data_exfiltration` now call `self._enforce_key_caps()` on entry, so
the hard cap on all four trackers is enforced from the same code path that
grows the two previously-uncovered ones, independent of login volume or auth
provider. `tests/test_security_monitoring.py` (10/10) still passes unchanged.

**Round 2 (Codex review on the round-1 fix commit `3b6b65e4` itself):**
Codex reviewed the fix above and found it was, itself, incomplete in two
ways — the second time in this same PR that Codex caught a real gap in this
sweep, worth saying plainly.

1. [**The new hot-path call sorted the entire tracker on every request once
   saturated, not just when the cap was first hit**](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900232886).
   `detect_session_hijack` — now calling `_enforce_key_caps()` per the round-1
   fix — runs on every authenticated response through
   `SecurityMonitoringMiddleware.__call__`. The eviction logic computed
   `overflow = len(tracker) - _MAX_TRACKING_KEYS`, sorted the whole tracker by
   last-active timestamp, and evicted exactly `overflow` keys. Once a tracker
   first reached the 5,000-key cap, `overflow` on every later call was 1 (the
   caller's own new key pushed it there again after the previous call's
   single-key eviction), so the full `O(n log n)` sort over ~5,000 entries ran
   on **every** subsequent distinct session — turning a lightweight memory
   safeguard into sustained request-time CPU overhead under exactly the
   sustained distinct-session churn it existed to survive.

   **Fixed:** eviction is now batched. A new class constant,
   `_EVICTION_TARGET_RATIO = 0.9`, means that once a tracker exceeds its cap,
   it is trimmed down to 90% of the cap in one pass (evicting `len - target`
   keys, not just `len - cap`), buying 500 entries of headroom before the sort
   needs to run again — the sort still runs, but roughly once per ~500
   additions instead of once per addition. This is the smaller, safer diff
   consistent with the existing sort-and-evict structure (an alternative —
   `collections.OrderedDict` with `move_to_end`/`popitem(last=False)` for O(1)
   eviction — was considered and rejected as a larger structural change than
   this hot-path fix warrants; the existing dicts are plain `defaultdict`s
   used throughout the file's other logic, and batching gets the same
   amortized-cost outcome without touching that).

2. [**`_external_endpoints` — a fifth tracker, entirely missed by round
   1**](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900232889).
   It is a `set()`, not a dict — grown by `detect_data_exfiltration` adding
   every distinct external `destination` seen. Round 1's fix made
   `detect_data_exfiltration` call `_enforce_key_caps()`, but that helper's
   loop only ever iterated the four **dict** trackers
   (`_api_calls`/`_login_attempts`/`_session_ips`/`_data_transfers`); it never
   touched the set. A 200-entry cap for it (`_MAX_EXTERNAL_ENDPOINTS`) did
   exist — in `_evict_stale_tracking_keys()` — but that method's own caller
   (`_check_rate_limit`, reachable only through `analyze_request`) is **never
   invoked anywhere in the running application** (confirmed by grep: the only
   callers of `analyze_request`/`_check_rate_limit` outside the service itself
   are in `tests/test_security_monitoring.py`) — dead code. So the fifth
   tracker could grow unbounded on the exact call path
   (`detect_data_exfiltration`) round 1 had just fixed, for the same
   underlying reason: the broadened sweep pattern documented above
   (`self.<name> = {}`/`= set()`) explicitly includes `set()`, but the fix
   that followed from it was not checked all the way through to "does _this_
   set specifically have an effective, reachable cap" — it has a cap
   constant, which is not the same thing.

   **Fixed:** `_enforce_key_caps()` now caps `_external_endpoints` too, in a
   separate branch (a set has no per-entry activity timestamp to sort
   eviction by, unlike the four dicts — trimmed arbitrarily instead, which is
   sufficient for a coarse memory safeguard), called from the same
   `detect_data_exfiltration()` entry point that already calls
   `_enforce_key_caps()`. The now-redundant capping block inside
   `_evict_stale_tracking_keys()` — dead in practice, per the paragraph above
   — was removed rather than left as unreachable code sitting behind a real
   one.

**Verification, round 2:** every tracker in the file was re-checked against
its actual growth path, not just the two Codex named — `_login_attempts`,
`_session_ips`, `_data_transfers`, and `_api_calls` all resolved correctly to
the batched `_enforce_key_caps()` on their respective hot paths;
`_external_endpoints` was the only additional gap. 4 new tests added to
`tests/test_security_monitoring.py` (`TestTrackerCaps`): batched eviction
drops a saturated dict tracker to the 90% target in one pass (not left
sitting at the cap); sustained one-key-per-call churn past the cap stays
bounded and the sort call count is asserted amortized (not once per
addition); `_external_endpoints` is capped directly via
`_enforce_key_caps()`; and the same is proven end-to-end by calling
`detect_data_exfiltration()` itself repeatedly with distinct destinations —
its actual production growth path, not just the internal helper. All 4
verified to **fail** against the pre-round-2 code (commit `3b6b65e4`,
checked out standalone) and **pass** after the fix; full file 14/14.

**Sweep 9 correction (Codex review):** the original method
([flagged here](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900139055))
grepped only `.settings =` / `.positions =` / `.config =` across two
directories (`app/services/`, `app/api/v1/endpoints/`) — Codex's specific
example, `app/api/v1/onboarding.py:815`, sits one directory level up
(`app/api/v1/`, not `.../endpoints/`) and so was structurally invisible to
that grep, and the field-name list ignored the rest of the schema (`notification_
preferences`, `filters`, `custom_fields`, and more).

Re-swept properly: enumerated all **132 distinct JSON/`MutableDict`-typed
model attribute names** by parsing every `Column(JSON...)` /
`MutableDict.as_mutable(JSON)` in `app/models/*.py`, then checked the whole
`app/` tree (excluding tests) for the two idioms that actually produce this
bug regardless of which of the 132 names is involved: (a) a two-level nested
bracket mutation on any variable (`x[a][b] = ...`) — field-name-agnostic, so
complete by construction — and (b) a shallow-copy idiom (`dict(...)`,
`.setdefault(...)[...] =`, `{**x, ...}`) feeding one of the 132 field names.
(a) found 12 hits app-wide; all are either local report/response dicts
unconnected to any persisted JSON column, or mutate a dict created fresh in
the same scope (never aliased to committed ORM state). (b) found the
`onboarding.py:815` site Codex named (`org_settings = copy.deepcopy(
organization.settings or {})` at line 676, correctly deep-copied — just
outside the original two-directory scope, not a bug) plus ~30 more sites
across 26 files, spanning `notification_preferences`, `custom_fields`,
`filters`, `progress_notes`, `action_result`, `package_config`,
`applicant_snapshot`, `inactivity_config`, `steps_completed`, and
`ballot_items` in addition to the original three names. Every reassignment
found is one of: `copy.deepcopy()` before a nested mutation, a fresh dict via
`{**old, "key": new}` / `dict(old); d[k] = new` that only ever sets a
_top-level_ key (safe even with a shallow copy, per pitfall #12's own
explanation), a wholesale replace from a validated Pydantic payload (no
aliasing possible), or not a persisted SQLAlchemy attribute at all (e.g.
`training_programs.py:117`'s `notes = dict(response.progress_notes or {})`
mutates a Pydantic response model for redaction, never written back to the
DB). Every single-level bracket mutation on a bare column reference
(`session.data["key"] = ...`, 11 sites, all in `onboarding.py`) targets
`OnboardingSession.data`, the one column wrapped in `MutableDict.as_mutable
(JSON)` specifically so `__setitem__` is auto-tracked without a copy —
correct by design, not a gap. **Clean** — 0 bugs found, ~40+ sites checked
across the whole tree and all 132 attribute names, up from 16 sites / 3 names
/ 2 directories.

Three findings this pass, all in `SecurityMonitoringService`, all fixed across
two Codex rounds on the same sweep (sweep 7, above — the round-2 write-up
gives the full account, including why round 1's own fix needed a second
correction). All nine invariants otherwise hold — five re-verified against
399 revisions / 1536 routes, four checked for the first time as an explicit
whole-codebase sweep in this file (two of the four — sweeps 6 and 8 — were
already correct; sweep 7 needed two rounds of fixes and sweep 9 needed its
method broadened before it could be trusted, all corrected in this revision
after Codex review on PR #2128 — see each sweep's write-up above for what
changed and why).

**Completion gate (pass 3, revised — round 2):** `flake8`/`black --check`/
`isort --check-only` clean across `app/ tests/ alembic/` (including the one
touched file, `app/services/security_monitoring.py`, and its test file);
`validate_migrations.py --strict` passed (399 revisions, single head
`4e7e125cb00f` — unchanged by this round, no migration touched);
`test_like_escaping.py` (2/2), `test_database_schema.py::test_set_null_fks_
are_nullable` (1/1), `test_capacity_locking.py` (17/17), `test_migration_
create_all_tables.py` (clean), and `test_security_monitoring.py` (**14/14**,
up from 10 — the 4 new `TestTrackerCaps` tests proving both round-2 fixes,
each verified to fail against the pre-round-2 commit `3b6b65e4` and pass
after) all pass; **`cd frontend && npm run typecheck`** (not bare
`tsc`/`npx tsc` — see the completion-gate correction below) **0 errors**;
`eslint .` 0 errors, 8 pre-existing warnings (all `testing-
library/no-node-access` / `react-refresh/only-export-components`, unrelated
to this pass — well under the `max-warnings 10` gate, same set as round 1: no
frontend file changed in either round). One source file changed this pass:
`app/services/security_monitoring.py` (round 1: 2-line fix; round 2: batched
eviction + `_external_endpoints` capping, sweep 7 above); everything else is
documentation and the one test file.

**Completion-gate command correction (Codex review):** this section
originally reported `tsc --noEmit`
([flagged here](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900139067)).
Per CLAUDE.md's "Two TypeScript installs" section, bare `tsc`/`npx tsc`
resolves through whichever bin `npm` happened to link into `node_modules/
.bin` — the 5.9.3 `typescript` install kept for typescript-eslint's peer
range, not the 7.0.2 `typescript-native` install this repo's build and
typecheck actually run on. `npm run typecheck` is the command that goes
through `frontend/scripts/tsc-native.mjs` to force the aliased 7.0.2
compiler; re-run as `cd frontend && npm run typecheck` for this pass — 0
errors, confirming the tree was clean under the compiler that actually
matters, not just under the lint-compatibility one. Every completion-gate
section in this file (and, where they quote it, PR bodies for this rotation)
should read `npm run typecheck`, not `tsc --noEmit`.

---

## Pass 2 (2026-08-27) — re-sweep after rotation pass 1

Pass 1 completed the full 35-feature rotation (#1799–#1918) and closed SEC-1
through SEC-4 with two of the five sweeps converted into standing guard tests
(`test_like_escaping.py`, `test_database_schema.py::TestColumnConstraints::
test_set_null_fks_are_nullable`). This pass re-runs the same five sweeps
against everything that landed during pass 1 and since (the endpoint count grew
by one file — `app/api/prospect_privacy.py`, a `Depends()` helper module with
no routes of its own, not a new router — and the Alembic chain grew from 355 to
381 revisions). It does not re-derive pass 1's conclusions; it re-verifies them
against current code, per the rotation's own rule.

| #   | Class swept                      | Method                                                                                                                              | Result                                                                                                                                   |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports     | `grep` for `csv.writer(` / `csv.DictWriter(` outside `csv_export.py`                                                                | **clean** — 0 sites, unchanged                                                                                                           |
| 2   | `SET NULL` on `NOT NULL` columns | `test_set_null_fks_are_nullable` (guard test added pass 1)                                                                          | **clean** — passes                                                                                                                       |
| 3   | Proxy-IP attribution             | grep `request.client.host`                                                                                                          | **clean** — same 3 hits as pass 1 (2 comments, 1 deliberate use inside `get_client_ip`)                                                  |
| 4   | Alembic chain integrity          | `backend/scripts/validate_migrations.py --strict`                                                                                   | **clean** — 381 revisions, single head `8fb3757b80ec`, no duplicate ids                                                                  |
| 5   | LIKE-wildcard handling           | `test_every_like_call_declares_the_escape_character` + `test_wildcard_escaping_lives_only_in_sql_search` (guard tests added pass 1) | **clean** — both pass; no new `.like()`/`.ilike()` call site has reintroduced a raw copy of the transform or dropped the `escape=` kwarg |

**Route auth coverage re-check:** an AST walk of every `@router.<verb>`
decorator in `api/v1/endpoints/`, `api/v1/onboarding.py`, and `api/public/`
found 68 routes with no recognized auth dependency (pass 1: 69 — the
one-route difference is a rename/refactor within the same already-accounted
surface, not a new gap). Every route is still confined to the same five
features pass 1 named: auth (14), event_requests.py's 4 public routes,
elections.py's 4 token-scoped routes, onboarding.py's 24 bootstrap routes, and
the public/* surface (22, including `salesforce_sync.py`'s OAuth callback).
**No new ungated route outside those five features.**

**Correction (Codex review on PR #1924):** the walk above was scoped by
directory glob (`endpoints/*.py`), which is narrower than pass 1's actual
"whole `app/api/`" scope and silently excluded
`app/api/v1/public_portal_admin.py` — a router mounted directly in
`api.py` (`from app.api.v1 import onboarding, public_portal_admin`, not
`from app.api.v1.endpoints import ...`) with 13 real route decorators. Derived
the file list from `api.py`'s router registrations instead of a directory
glob and re-ran: 80 files, 1526 routes (up from 1513 — the 13 newly-included
routes), same 68 ungated routes as above. All 13 `public_portal_admin.py`
routes carry `Depends(get_current_user)`; the corrected scan changes the
denominator, not the finding. **No new ungated route.**

No findings this pass. All five pass-1 invariants hold; two are now enforced
by tests rather than by review, exactly as pass 1 intended.

**Completion gate (pass 2):** `flake8`/`black --check`/`isort --check-only`
clean across `app/ tests/ alembic/`; `validate_migrations.py --strict` passed;
`test_like_escaping.py` (2/2) and the `SET NULL` guard test pass; `tsc
--noEmit` 0 errors; `eslint .` 0 errors (10 pre-existing warnings, same set as
feature 34's gate). No code changes this pass — documentation only.

---

## Pass 1 (2026-08-25)

**Scope:** whole codebase — `backend/app/` (66 v1 endpoint files, 11 public
endpoint files, 108 services, 42 model modules, 355 Alembic revisions).

The rotation opens with the sweeps that only make sense run against everything
at once. A per-feature iteration cannot establish "this class does not exist
anywhere"; it can only establish "not here". Running them first also means the
34 feature iterations that follow inherit the invariants instead of re-checking
them by hand.

---

## Scope

**Read in full:** `app/utils/sql_search.py`, `app/utils/csv_export.py`,
`app/utils/org_scoping.py`, and every call site the five sweeps returned.

**Swept mechanically** (AST or grep over all of `backend/app/`): LIKE/ILIKE
escaping, CSV writer selection, `request.client.host` usage, `SET NULL`
nullability, route auth coverage, and model-vs-migration table/column drift.

**Not read:** the feature internals themselves. This iteration establishes
class-level absence or presence, not per-feature verdicts — those are
iterations 01–34. A clean sweep here does **not** mean a feature is clean.

---

## Sweep results

| #   | Class swept                      | Method                                                                              | Result                                                                                                                                                                   |
| --- | -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Formula injection in exports     | `grep` for `csv.writer(` / `csv.DictWriter(` outside `csv_export.py`                | **clean** — 0 sites; every exporter uses `SafeCsvWriter`                                                                                                                 |
| 2   | `SET NULL` on `NOT NULL` columns | grep every `ondelete="SET NULL"`, check the 3 lines that follow for `nullable=True` | **clean** — 0 sites; also guarded by `tests/test_database_schema.py::test_set_null_fks_are_nullable`                                                                     |
| 3   | Proxy-IP attribution             | grep `request.client.host`                                                          | **clean** — 3 hits, all non-runtime: 2 explanatory comments and 1 deliberate `direct_ip` inside `get_client_ip` itself. AXC-1 closed this class and it has stayed closed |
| 4   | Alembic chain integrity          | `backend/scripts/validate_migrations.py`                                            | **clean** — 355 revisions, single head `f2a91c7d6b04`, no duplicate ids, no orphans                                                                                      |
| 5   | LIKE-wildcard handling           | AST walk of every `.like()` / `.ilike()` call                                       | **3 findings — SEC-1/2/3, all fixed below**                                                                                                                              |

A sixth sweep (model↔migration drift) is written up under
[Schema & migration notes](#schema--migration-notes) — it found no defect, but
what it found instead is load-bearing enough to record.

---

## Route auth coverage

An AST walk of every route decorator in `app/api/` found **69 routes with no
auth dependency in the signature**, split as:

- **20 in `api/public/`** — the intentionally public surface (portal, calendar,
  display, `security.txt`, legal, four inbound webhooks, three finance
  approval-token routes, two public form routes).
- **49 in `api/v1/`** — 24 onboarding bootstrap routes, 15 auth routes (login,
  register, OAuth initiate/callback, password reset), 4 token-scoped ballot
  routes, 4 public event-request routes, the public calendar, the Salesforce
  OAuth callback, and `GET /` on the API root.

Every one of these is public **by design**. That is not the same as verified:
each needs its compensating control checked (rate limit before the expensive
work, signed/consumed token, webhook signature). That check is the substance of
iterations **01 auth**, **03 public surface**, **06 elections**, **16 events**
and **30 onboarding**, and the inventory above is recorded here so those
iterations start from a list rather than re-deriving one.

**No route outside those five features was found ungated.**

---

## Verified good ✅

- **Every CSV that leaves the system is formula-safe.** Zero uses of raw
  `csv.writer` remain in `app/`; `SafeCsvWriter` prefixes any cell opening with
  `= + - @ \t \r`. Mechanism: sweep 1, plus the class was closed repo-wide by
  the 2026-07 audit and has not regressed.
- **No `ondelete="SET NULL"` column is `NOT NULL`.** Mechanism: sweep 2, backed
  by an existing metadata test, so this is guarded rather than merely observed.
- **Client IP attribution is uniform.** Every runtime site resolves through
  `get_client_ip(request)`, which honours `TRUSTED_PROXY_IPS` and falls back to
  the peer address. Mechanism: sweep 3.
- **The migration chain is single-headed and consistent.** Mechanism: sweep 4,
  which the CI gate also runs.
- **All 76 `like`/`ilike` calls declare `escape=LIKE_ESCAPE_CHAR`**, and the
  wildcard-escaping transform has exactly one implementation. Mechanism:
  `tests/test_like_escaping.py`, added this iteration — this is now an
  invariant, not a snapshot.

---

## Findings

### SEC-1 — MED — Raw user input interpolated into a LIKE pattern — ✅ FIXED

**What:** two search paths built their pattern by direct interpolation, with no
wildcard escaping at all.

**Where:**

- `backend/app/services/messaging_service.py:124` — `pattern = f"%{search.strip()}%"`
- `backend/app/api/v1/endpoints/message_history.py:80` — `pattern = f"%{search}%"`

**Failure scenario:** a user with `settings.manage` types `%` into the
department-message search box. The pattern becomes `%%%`, which matches every
row, so the "search" silently returns the org's entire message table — and the
paginated list's count query scans all of it. `_` behaves the same way at
single-character granularity: searching `a_c` also returns `abc`, so a member
looking for one record gets a set they did not ask for and has no way to tell
the filter was ignored.

**Impact:** both queries are correctly org-scoped, so this is **not** a
cross-tenant leak. What it is: a filter that can be made to not filter, on two
list endpoints, with an unbounded scan behind it. The wrong-results half is the
part a user would never notice.

**Fix:** both now build the pattern with `like_pattern()` and pass
`escape=LIKE_ESCAPE_CHAR`.

### SEC-2 — MED — Wildcard escaping present but never declared to the database — ✅ FIXED

**What:** 47 call sites escaped the search term correctly and then emitted
`LIKE`/`ILIKE` **without an `ESCAPE` clause**.

**Where:** 12 files, chiefly `inventory_service.py` (19 sites),
`forms_service.py` (7), `apparatus_service.py` (4),
`membership_pipeline_service.py` (3), `documents_service.py` (3),
`facilities_service.py` (3).

**Failure scenario:** MySQL's default LIKE escape character depends on
`sql_mode`. Under `NO_BACKSLASH_ESCAPES` — a mode a DBA can enable for
standards compliance, and which some managed MySQL offerings set — the
backslashes the escaping inserted are treated as literal characters rather than
escapes. Every wildcard the transform was written to neutralize comes back, and
the codebase reverts to SEC-1 behaviour across all 47 sites at once. The
project already knew this: `app/utils/sql_search.py`'s own docstring says
"MySQL's default varies by mode and cannot be relied on implicitly" and "the
result must be passed with `escape=LIKE_ESCAPE_CHAR`; without it the escaping
is inert".

**Impact:** latent rather than live — on the default `sql_mode` these queries
behave correctly today. It is recorded as MED rather than LOW because the
failure is configuration-triggered, silent, simultaneous across the whole
application, and invisible in code review: the escaping _looks_ present.

**Fix:** every `like`/`ilike` call in `app/` now passes
`escape=LIKE_ESCAPE_CHAR` — 76 of 76, no exceptions. That includes the 21 sites
that had been passing a raw `"\\"` literal (now the shared constant) and the
four whose pattern is system-generated (`"ORD-2026-%"`,
`"reminder_sent:%"`, `"%probationary%"`, `"{prefix}-{year}-%"`). Declaring the
escape character on those four is **inert**, not wrong — their `%` is not
preceded by a backslash, so it stays a wildcard — and covering them is what
makes the invariant exception-free, so the guard test needs no allowlist to
grow stale.

### SEC-3 — LOW — The escaping transform was copy-pasted into 15 files — ✅ FIXED

**What:** `app/utils/sql_search.py` exists specifically to own this transform.
Its docstring names the seven modules it was copy-pasted into and says "it lives
here so a fix or a subtlety lands in one place rather than seven". Exactly one
call site — `storefront_service.py` — actually imported it. Fifteen other files
carried their own copy, including one nested inside a function
(`membership_pipeline_service.py`'s local `_escape`).

**Where:** `apparatus`, `grant`, `notifications`, `inventory`, `minute`,
`equipment_check`, `meetings`, `documents`, `forms`, `facilities`,
`membership_pipeline`, `fundraising` services, plus `audit_logs.py`,
`skills_testing.py` and `message_history.py`.

**Failure scenario:** this is the mechanism behind SEC-2. Each copy of the
transform obliged its author to remember the `escape=` kwarg independently, and
47 of them did not. A single owner makes the two halves inseparable.

**Impact:** the duplication is why the defect class existed at all, and why it
would have come back.

**Fix:** all 15 now call `like_pattern()`. The transform exists once, in
`sql_search.py`. `finance_service.py`'s local variable named `like_pattern` was
renamed `number_prefix` so it cannot shadow the helper.

### SEC-4 — MED — Inventory barcode search attributes the wrong matched field — ✅ FIXED

**What:** `search_items_by_code` runs its DB query against the LIKE-escaped
pattern (correct), then re-scans the returned rows **in Python** to decide which
field matched — and compared against the _escaped_ string rather than the raw
input.

**Where:** `backend/app/services/inventory_service.py:3392` (was
`safe_lower = safe_code.lower()`).

**Failure scenario:** a member scans or types an asset tag containing `%`, `_`
or `\` — e.g. `50%`. The escape transform turns it into `50\%`. The database
correctly returns the item whose `asset_tag` is `50%`, but the Python loop then
tests `"50\%" in "50%"`, which is false for every field, so the match falls
through to the `matched_field = "name"` default. The UI reports the item was
found by _name_ when it was found by _asset tag_, and `matched_value` shows the
item's name instead of the code that was scanned.

**Impact:** wrong attribution in a scanning workflow, silently — the item is
still returned, so nothing looks broken. Pre-existing; not introduced by this
change. It surfaced because collapsing the duplicated transform removed the
`safe_code` variable, and `flake8` then reported `F821 undefined name
'safe_code'` at the line that had been misusing it. The lint rule found a
correctness bug the tests did not.

**Fix:** compare against `code.lower()` — the raw input — with a comment stating
why the escaped form is the wrong comparand.

---

## Schema & migration notes

The model-vs-migration sweep compared every `__tablename__` and `Column` in
`app/models/` against every `create_table` / `add_column` / raw `ALTER TABLE` in
the 355 Alembic revisions. It reports:

- **37 model tables that no migration ever creates** — `positions`,
  `integrations`, `error_logs`, `event_requests`, `prospects`, `budgets`,
  `approval_step_records`, and 30 more.
- **49 model columns that no migration ever adds**, across 17 tables.
- **0 migration-created tables with no model.**

**This is not a finding.** It is the documented, deliberate shape of this
deployment: application startup runs `Base.metadata.create_all(checkfirst=True)`
followed by `_add_missing_model_columns` (`backend/main.py:274–350`), and that
is how model-only tables and later-added model columns actually materialize.
`backend/scripts/repair_schema.py` exists so CI reproduces the same state, and
its docstring names the exact count — "37 tables exist in the models with no
migration that creates them" — along with the seven contract-test failures that
resulted when CI skipped the step.

Recording it here for two reasons. First, so a later iteration does not
rediscover it and file it as a critical drift bug. Second, because it is a
standing risk worth stating plainly even though it is working as designed:
`create_all` does not carry the `ondelete` behaviour, index set, or column
ordering that a hand-written migration does, so a table born from `create_all`
and a table born from a migration are not guaranteed identical. Checklist
dimension 7 asks each feature iteration which path its tables took.

Chain integrity itself is clean: 355 revisions, one head, no duplicates.

---

## Guard tests added

`backend/tests/test_like_escaping.py` — two tests, both source-walking:

1. `test_every_like_call_declares_the_escape_character` — every `.like()` /
   `.ilike()` in `app/` passes `escape=LIKE_ESCAPE_CHAR`. Asserts SEC-2's
   invariant with no allowlist.
2. `test_wildcard_escaping_lives_only_in_sql_search` — the transform
   `.replace("%", "\\%")` appears in exactly one file. Asserts SEC-3's.

Verified to fail on reintroduction: removing the `escape=` kwarg from one call
in `documents_service.py` fails test 1 and names the file and line; restoring it
passes.

---

## Completion gate

| Check                                                 | Result                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                         | ✅ 0 violations                                     |
| `black --check app/ tests/ alembic/`                  | ✅ 1216 files unchanged                             |
| `isort --check-only app/ tests/ alembic/`             | ✅ clean — see the note below                       |
| `python3 -m pytest tests/ -k "<19 touched services>"` | ✅ **1715 passed, 1 skipped, 0 failed**, 325 errors |
| `backend/scripts/validate_migrations.py`              | ✅ 355 revisions, single head                       |
| `tsc --noEmit` / `eslint .`                           | n/a — no frontend file changed this iteration       |

The 325 errors are the sandbox's missing MySQL (`OperationalError(2003, "Can't
connect to MySQL server on 'localhost'")` at fixture setup), the same limitation
recorded in `docs/app-review/PROGRESS.md`'s baseline.

The same selection was run against unmodified `HEAD` in a separate git
worktree, which is what makes the result evidence rather than an assertion:

| Run                 |   Passed | Skipped |  Errors |
| ------------------- | -------: | ------: | ------: |
| `HEAD` (unmodified) |     1713 |       1 |     325 |
| this branch         | **1715** |       1 | **325** |

The error count is identical, so nothing moved from passing to erroring. The
`+2` is exactly the two tests added in `test_like_escaping.py`. That is the
standard AXC-1 set for a mechanical sweep, and it is the claim being made here:
behaviour-neutral to the suite, not merely still green.

### The gate that was reported clean and was not

`isort` was not installed in this sandbox and the first push went out without
it, on the reasoning that `black` and `flake8` both passed and CI would run the
real thing. CI did, and it failed: `storefront_service.py` had its
`sql_search` import placed after `storefront_payments` instead of before it.

The cause is specific and worth recording, because it is the one file where the
import was not newly added — it already existed at line 58, my sweep stripped it
along with the misplaced ones, and the AST pass that put it back inserts after
the _last_ top-level import rather than in sorted position. Every other file got
a new import that happened to sort correctly; this one did not.

`isort==8.0.1` (CI's pin) was then installed and run over `app/ tests/
alembic/`. One line moved. `black`, `flake8` and the guard test were re-run
after it and all still pass.

**The lesson is in the command file now** (Step 6): run all three linters
against `alembic/` too, and install a missing one at CI's pinned version rather
than noting it as unavailable. An import inserted programmatically is precisely
the change `isort` exists to catch, so "the other two linters passed" was never
evidence about this one.
