# Application Review — Locations & Kiosk

**Prefix:** `LOC` · **Iteration:** A8 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2)

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified pass-1: 6/6 endpoints gated + org-scoped; PP-3 display-code regex + no
PP-1 recurrence intact; LOC-1 (display *rendering* uses canonical
`_get_check_in_window`) and LOC-2 (kiosk timezone from org) hold; frontend clean (no
banned date APIs, tz passed to every formatter, no Pitfall #1). Lenses 1–4/6 clean.
**1 fix.**

### LOC-4 — MED — Kiosk event *selection* still used a hardcoded 1-hour window (LOC-1, one layer down) — ✅ FIXED

LOC-1 fixed the display *rendering* to use `EventService._get_check_in_window`, but
the **selection** query `get_current_events_in_check_in_window` still computed
`check_in_start_threshold = now + 1h` and selected `start_datetime <= that` — a
**superset** of the canonical per-event windows (FLEXIBLE opens 30 min before, STRICT
at `actual_start_time`, WINDOW ±N). The live kiosk frontend renders "Check-In Active"
+ a scannable QR for **any** returned event (it never reads `is_valid`), so a STRICT
or early-FLEXIBLE event showed an active check-in QR up to an hour before its window
opened; the scan was then rejected by `_validate_check_in_window` — confusing, and
the docstring's "1 hour before start" contradicted the 30-min canonical default.
**Fix:** keep a generous 1-hour SQL prefilter to bound rows, then narrow in Python to
exactly the events whose canonical `_get_check_in_window` is open now — the same
predicate `_validate_check_in_window` enforces. Swept an adjacent E712. 1 DB-free
regression test (an open FLEXIBLE event is returned, a not-yet-open STRICT event is
filtered out).

**Flagged (LOW, folded into LOC-3):** the authenticated `/locations/{id}/display`
endpoint (still zero callers) hardcodes `is_valid=True` and omits the new `timezone`
field — if LOC-3's dead-code is ever wired up rather than deleted, it must compute
`is_valid` like the public path and populate `timezone`.

---

**Backend:** `app/api/v1/endpoints/locations.py` (294 L, 6 endpoints),
`app/services/location_service.py` (279 L),
`app/api/public/display.py` (the kiosk's actual data source)
**Frontend:** `pages/LocationKioskPage.tsx` (246 L), routed publicly at
`/display/:code` from `modules/facilities/routes.tsx`
**Docs:** none specific

---

## Scope

All 6 location endpoints and the service read in full, plus the public display
endpoint and the kiosk page — the kiosk is the reason this feature is
interesting, and it turned out **not** to use the locations module's own display
endpoint at all.

`app/api/public/display.py` overlaps with **B26 public-portal**, which owns its
rate limiting and access logging. It is covered here only where it is the
kiosk's data path.

## Verified good ✅

- **All 6 endpoints authenticated and correctly tiered** — reads on
  `get_current_user`, create/edit/delete each on their own permission paired
  with `locations.manage`. Every service call passes
  `current_user.organization_id`, so XC-3 is clean.
- **PP-3's fix is intact.** The public display code is validated with an
  explicit ASCII regex (`[A-Za-z0-9]{6,12}`) rather than `str.isalnum()`, and
  the comment records why — `isalnum()` also accepts Unicode letters and digits,
  a looser gate than the codes actually issued.
- **No PP-1 recurrence.** `get_location_by_display_code` uses
  `scalar_one_or_none()`, which would 500 on a duplicate — but `display_code` is
  `unique=True` **globally** (not per-org) and the generator checks globally
  before assigning, so more than one match is impossible. This is the exact
  shape that broke public-portal API-key auth in PP-1; here the constraint
  actually backs the assumption.
- **Code generation escalates on collision** (8 chars for the first 10 attempts,
  then 12) and fails loudly rather than looping forever. The ~40-bit entropy of
  an 8-character code remains the accepted design limitation recorded in PP-7,
  not re-flagged here.
- **The kiosk page uses `formatDateCustom` with a timezone argument** and no
  banned date API — the ESLint-enforced rules are respected. (What it passed as
  that timezone was the problem; see LOC-2.)
- **The public display endpoint is rate-limited and data-minimised** — event
  descriptions are explicitly not exposed (`event_description=None` with a
  comment).

## Findings

### LOC-1 — MED — The authenticated display endpoint kept a stale check-in window — ✅ FIXED

**What:** `GET /locations/{location_id}/display` computed the check-in window
inline:

```python
check_in_start = event.start_datetime - timedelta(hours=1)
check_in_end = event.actual_end_time or event.end_datetime
```

**Where:** `locations.py` `get_location_display_info`.

**Impact:** the canonical window is `EventService._get_check_in_window`, and it
is **per-event configurable**: `check_in_window_type` (FLEXIBLE / STRICT) and
`check_in_minutes_before`, which defaults to **30 minutes**. So this copy was
wrong in two distinct ways — it opened the window **twice as early** as the
default for FLEXIBLE events, and for a STRICT event it ignored the rule entirely
(STRICT opens at `actual_start_time`, not "start minus an hour"). A display
fed by it would tell members they could check in when the check-in endpoint
would still refuse them.

What makes this a clean example of the duplication hazard: **the sibling public
endpoint was already fixed.** `tests/test_public_display.py`'s own docstring
says the kiosk "must report the authoritative check-in window/validity (the same
logic the check-in endpoint enforces), **not a hardcoded 1-hour guess**". That
correction was applied to the copy the kiosk uses and missed on this one.

**Fix:** calls `EventService._get_check_in_window(event)`, with a comment naming
why a local copy is wrong. The now-unused `timedelta` import was removed.

### LOC-2 — MED — The kiosk rendered times in the tablet's timezone — ✅ FIXED

**What:** `LocationKioskPage` is routed **publicly** (`/display/:code`, marked
"no auth — for tablets in rooms") but derived its timezone from
`useTimezone()`, which reads `useAuthStore(s => s.user?.timezone)` and falls
back to `Intl.DateTimeFormat().resolvedOptions().timeZone`.

**Impact:** with no session there is no user, so the fallback **always** won: the
kiosk rendered every time in whatever zone the tablet was set to. A
wall-mounted display left on its factory default — commonly UTC — showed event
times and check-in windows shifted by hours, on the screen members rely on to
know whether they can check in. It also contradicts the project's own rule that
times are displayed "in their local timezone (**or the organization's
configured timezone**)": the department's configured timezone was the one value
never consulted.

**Fix:** `LocationDisplayInfo` gained an optional `timezone` field, populated
from the organization in the public display endpoint; the kiosk prefers it and
keeps the browser value as a fallback. Optional so nothing breaks if the field
is absent, and an org that never set a timezone still renders. Covered by two
new tests.

### LOC-3 — LOW — `GET /locations/{id}/display` has no consumer — 🚩 FLAGGED

**What:** the endpoint LOC-1 just corrected has **zero frontend callers**. The
kiosk fetches `/api/public/v1/display/{code}` instead, and no service method
wraps the authenticated route.

**Impact:** none today — it is a second, authenticated implementation of the
same capability (location + events in their check-in window + `has_overlap`),
superseded by the public one. But it is dead weight that already drifted once,
which is how LOC-1 happened.

**Why not fixed:** deleting an endpoint is an API-surface decision, not a
correction — nothing documents it as a public integration point, but nothing
rules it out either. It is now *correct* dead code rather than *wrong* dead
code, so the decision can be taken calmly. Second instance of this shape in two
iterations, after DASH-2.

## Duplication

**The display capability exists twice** — authenticated (`locations.py`) and
public (`public/display.py`) — and the two had already diverged before this
review, which is LOC-1. The public one is strictly better: rate-limited, uses
the canonical window helper, computes `is_valid` via
`_validate_check_in_window`, and withholds event descriptions.

Now that LOC-1 has aligned the window logic, the honest resolution is LOC-3:
delete the authenticated copy, or give it a caller. Keeping two implementations
of "what is happening at this location right now" guarantees they drift again.

## Dead code

- `GET /locations/{location_id}/display` — no consumer (LOC-3).
- Removed: the `timedelta` import in `locations.py`, unused after LOC-1.
- Nothing else unreferenced; no TODO/FIXME markers.

## Documentation gaps

None corrected. Worth noting for the operator docs: the kiosk is a **public,
unauthenticated URL** whose only secret is an 8-character display code. That is
a deliberate design (a tablet cannot hold a session), and the endpoint is
rate-limited and data-minimised accordingly — but a department should know that
anyone with the URL sees which events are running at that location, and that
rotating the code is the only revocation.

## Future development

1. **Resolve the duplicate display path** (LOC-3) — delete or wire up.
2. **The kiosk has no way to signal a stale session of its own.** It polls every
   30 s and shows a `connected` flag, which is good; but if the display code is
   rotated or the location deactivated, the tablet shows a 404 screen with no
   guidance for whoever walks past it.
3. **No test covers the locations module's own endpoints.** The 6 CRUD routes
   have no direct coverage; the tests that exist are for the public display
   path. The org-scoping on `get_location` is currently asserted only by
   reading.
4. **`display_code` has no rotation endpoint.** It is assigned at creation and
   there is no way to reissue it if a code leaks, short of editing the row —
   which matters given it is the kiosk's only access control.
5. **`is_valid=True` is hardcoded** in the authenticated endpoint on the grounds
   that the query already filtered by window. True today, but the public
   sibling computes it properly; if LOC-3 resolves toward keeping this endpoint,
   it should do the same.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2514 passed, 0 failed** (was 2512 — 2 tests added). 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |
| frontend tests | ✅ **2207 passed** (159 files) |

> Note: LOC-2's extra query broke three existing `test_public_display.py` tests,
> whose `db` stub was a bare `MagicMock`. The stub was **extended** to serve the
> new lookup — not loosened, and no assertion was weakened — because the
> endpoint genuinely acquired a dependency the test had to model.
</content>
