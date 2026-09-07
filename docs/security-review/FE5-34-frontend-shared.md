# Security Review — Feature 34: Frontend Shared (pass 5, corrective)

**Prefix:** `FE5` · **Iteration:** 34 · **Reviewed:** 2026-09-07 · **PR:** (opening)

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`utils/errorHandling.ts`, `services/errorTracking.ts`, `services/api.ts` (global),
all 13 module axios instances (`modules/*/services/api.ts`),
`modules/inventory/services/equipmentCheckApi.ts` (the second inventory
client the `modules/*/services/api.ts` glob doesn't catch — omitted from
FE4's file list, restored here), `components/ProtectedRoute.tsx`,
`stores/authStore.ts`, `stores/learningProgressStore.ts`,
`stores/pendingSyncStore.ts`, `stores/skillsTestingStore.ts`,
`components/ux/*`, plus a full-frontend sweep for new `api.get(`/`api.get<`
call sites since the corrected baseline.
**Backend:** read-only cross-reference — `backend/app/schemas/inventory.py`
and `backend/app/utils/color_names.py` (the FE4-2 caching claim), and
`backend/app/api/v1/endpoints/inventory.py`'s `get_item_colors`/`/items/colors`
route (org-scoping only — no code changed).
**Migrations:** none.

**This is not a new rotation pass over new code.** It is a corrective
re-review triggered by three `chatgpt-codex-connector[bot]` findings on PR
#2379 (Feature 34 pass 4) that merged unaddressed: FE4's stated baseline
commit was wrong, `/inventory/items/colors` was wrongly cleared as carrying
no free-text data, and `PROGRESS.md`'s tracker summary went stale on the
same day it was written. All three are addressed below.

**1 new finding: `GET /inventory/items/colors` is an unconstrained free-text
field wrongly left cacheable — fixed.** Re-diffing every file this feature
owns against the _correct_ pass-3 baseline (`796059dc`, not `b10ecfe3`) turned
up substantially more real change than FE4 reviewed (roughly 400 additional
lines across 8 files, once the invisible window between the two commits is
counted) — all of it now read in full below. Everything else in that
previously-unreviewed diff holds up: no new tenancy, auth, injection, or
exposure gap found. FE3-34-4/FE3-34-5/FE3-34-2's dispositions are unchanged
from FE4 (FE3-34-5 is OPEN, matching `FE4-34-frontend-shared.md`'s own
correction and `KNOWN_LIMITATIONS.md` — this pass does not re-litigate it).

---

## Why this pass exists

PR #2379 merged three unresolved P1/P2 Codex findings:

1. **Wrong baseline commit.** `FE4-34-frontend-shared.md` cites `b10ecfe3` as
   "the merge that landed `FE3-34-frontend-shared.md`." It is not — `git log`
   shows it is the 2026-09-04 merge of PR #2244, an unrelated change. The
   actual commit that landed the FE3-34 doc (and closed pass 3) is `796059dc`
   (PR #2120, 2026-08-31, itself the closure merge after pass-3's `6b119ece`
   /#2112 and `5a45241c`/#2118). Since `b10ecfe3` postdates `796059dc` by four
   days, every `git diff --stat b10ecfe3..HEAD` FE4 ran was scoped too
   narrowly: it silently treated everything that changed in that four-day
   window as pre-existing, already-reviewed baseline state. It was not — no
   pass had reviewed it, because pass 4 was FE3-34's immediate successor and
   used a baseline four days past pass 3's actual close.
2. **A wrong "no PII" call.** FE4's diff-sweep table cleared
   `GET /inventory/items/colors` with "No PII, no per-member data, no
   free-text field" and left it cacheable. `color` is free text.
3. **A stale tracker.** `PROGRESS.md`'s Open PR section and Log both said
   "FE3-34-4 and FE3-34-5 (both HIGH) are fixed" — true when that text was
   written, false by the time the PR merged, because Codex's review on the
   same PR reopened FE3-34-5 a few hours later (commit `9d745075`) and
   nothing updated `PROGRESS.md` to match. `FE4-34-frontend-shared.md` and
   `KNOWN_LIMITATIONS.md` were both updated correctly at the time; only the
   tracker was missed.

Verified all three independently before touching anything (`git log`,
`git cat-file -t`, reading the actual schema/service code) rather than taking
Codex's citations on faith. All three are real.

## Method

1. **Established the correct baseline**: `796059dc`. Confirmed via
   `git log --oneline` that it is PR #2120's merge (the pass-3 closure), and
   that `b10ecfe3` is PR #2244's merge — unrelated, later.
2. **Re-ran the file-owned diff** (`git diff --stat 796059dc..HEAD`) across
   every file this feature owns, including the two FE4 omitted from its own
   file list (`equipmentCheckApi.ts`, and the global `services/api.ts`
   re-export barrel). Eight files differ, not three:
   `utils/apiCache.ts` (+85), `services/apiClient.ts` (+57),
   `stores/authStore.ts` (+106), `modules/scheduling/services/api.ts` (+136),
   `modules/inventory/services/equipmentCheckApi.ts` (+33),
   `modules/testing/services/api.ts` (+7),
   `modules/storefront/services/api.ts` (+2), `services/api.ts` (+2).
3. **Read every line of that diff** (not just the hunks — each file in full,
   current context), applying `CHECKLIST.md`'s seven dimensions.
4. **Re-ran the `components/ux/*` diff** against the correct baseline. FE4's
   version of this check (against `b10ecfe3`) found 5 files; against
   `796059dc` it's 6 — `DateTimeQuarterHour.tsx` never appeared in FE4's
   sweep at all. Read it too.
5. **Re-ran the whole-frontend `api.get` sweep** against the correct
   baseline (every new call, feature-owned file or not — same method FE4
   used, corrected baseline).
6. **Confirmed the color-caching claim directly** against
   `backend/app/schemas/inventory.py` and
   `backend/app/utils/color_names.py`, rather than trusting either FE4's or
   Codex's characterization.
7. **Did not re-review** what pass 3 or pass 4 already read and that this
   pass's diff shows as byte-identical to `796059dc` — confirmed empty
   `git diff` for each such file, not assumed from either doc:
   `utils/createApiClient.ts`, `utils/errorHandling.ts`,
   `services/errorTracking.ts`, `components/ProtectedRoute.tsx`, all 4
   stores except `authStore.ts`, and 10 of the 13 module `api.ts` files
   (`admin-hours`, `apparatus`, `finance`, `governance`, `grants-fundraising`,
   `ip-security`, `medical-screening`, `minutes`, `prospective-members`,
   `reports`).

## The diff FE4 never actually reviewed

### `utils/apiCache.ts` (+85 lines)

All of it is the FE3-34-4 fix (`generation`/`prefixEpochs`/`CacheWriteToken`/
`setCacheIfCurrent` — a stale in-flight write can no longer land after a
`clearCache()`/`invalidateByPrefix()` boundary) plus two new exclusion-list
entries: `/inventory/requestable-catalog` (size-preference PII on the
request-form catalog) and the `/attendees` substring (the new
member-facing attendee list, distinct from `/rsvps`). Both entries are
correct and match a genuinely new endpoint each (see below). This is the
same fix FE4 described in detail under "FE3-34-4" — its _description_ of
the fix was accurate; its _baseline citation_ for what changed was not.
No new gap.

### `services/apiClient.ts` (+57 lines)

The write side of the same fix: every cacheable GET is stamped with a
`CacheWriteToken` at request time (`cacheWriteToken`), the response
interceptor fails closed on a missing/malformed token
(`isCacheWriteToken`), and the background stale-revalidation request now
also checks its token before writing (`setCacheIfCurrent`) and drops the
caller's `signal`/`cancelToken` so an unmounted caller's abort can't cancel
a revalidation another caller may still read from cache. No new gap —
matches FE4's FE3-34-4 writeup.

### `stores/authStore.ts` (+106 lines)

The FE3-34-5 device-claim fix (`DEVICE_MEMBER_KEY`, `claimDeviceForMember`,
`markSignInPending`/`signInPending`) — matches FE4's description and
disposition (OPEN, purge-failure path unresolved) exactly; no re-litigation
needed here.

**Not previously documented by any pass:** the same commit also added
`useSchedulingStore.getState().resetSettings()` calls on both the
device-claim path and `logout()`. Read `schedulingStore.ts` in full to
verify this is safe, since it's a cross-store call from a feature-34-owned
file into a different module's store:

- `resetSettings()` bumps two module-level counters
  (`settingsGeneration`, `accountGeneration`) before clearing state, and
  every one of the store's loaders (`loadSettings`, `loadMembers`,
  `loadTemplates`, `loadApparatus`, `loadSummary`) captures its counter at
  the start of the request and discards the response if the counter has
  since moved. A request already in flight when a session boundary hits
  therefore cannot write the previous member's — or previous
  department's — roster, call types, or apparatus list back in after the
  reset.
- `schedulingStore.ts` imports nothing from `authStore.ts` or anything that
  transitively does (`userService`/`schedulingService`/`errorHandling`/
  `enums`/`shiftBoard`/its own `types`), matching the "safe to import, no
  cycle" comment on the new `authStore.ts` import.
- **Correct and necessary, not a gap**: the scheduling store's settings are
  keyed by nothing user- or org-specific and were previously cleared only
  by a full page reload — on a shared terminal, a session that expired and
  was replaced by a different department's member signing in (never calling
  `logout()`) would otherwise read the prior department's call types,
  signup window, roster and templates until the tab refreshed. This closes
  that gap the same way `clearCache()`/`purgeLocalMemberData()` already
  close the equivalent gap for the HTTP cache and offline queues.

### `modules/scheduling/services/api.ts` (+136 lines, not the +50 FE4 cited)

All type/field additions (`late_signup_until`, `signup_open`,
`call_type_usage`, `call_type_locked`, `MemberHoursMonth`/`Totals`/`History`)
and new methods (`getShiftsNeedingCloseout`, `getMyHoursHistory`,
`declineAssignment`, `openLateSignup`/`closeLateSignup`). All go through
`createApiClient()`, which has no caching logic (confirmed by FE4 and
re-confirmed here — file is byte-identical to `796059dc`), so none of this
can reach the shared cache regardless of the exclusion list. `getMyHoursHistory`
and `getShiftsNeedingCloseout` are both self- or already-org-scoped reads
with no new PII shape. No new gap.

### `modules/inventory/services/equipmentCheckApi.ts` (+33 lines) — omitted from FE4's file list entirely

FE4's file list names 13 module `api.ts` files plus
`components/ProtectedRoute.tsx` and 4 stores, but drops the one second
inventory client that isn't a `modules/*/services/api.ts` match — the same
file FE3-34's file list explicitly called out
("one same-module second client the glob doesn't catch"). Restored to this
pass's file list above. Its diff: a doc-comment update (Scheduling now
imports it directly rather than through a re-export — an ownership/import-
path note, not a security change) and one new method,
`replaceCompartments(templateId, compartments)` — a POST through the same
`createApiClient()` instance, org-scoped server-side by the same route every
other compartment-mutation method here already uses. No new gap.

### `modules/storefront/services/api.ts` (+2) and `modules/testing/services/api.ts` (+7)

Storefront: one new optional query param (`excludeCancelled` →
`exclude_cancelled`) on an existing, already-reviewed list method — no shape
change to what's returned. Testing: `TestingCheckEntry.userId` widened from
`string` to `string | null`, matching a backend FK that is `ON DELETE SET
NULL` (CLAUDE.md Pitfall #2) — a nullability fix, not new exposure; the
adjacent `userName` field was already optional for the same reason. No new
gap in either.

### `services/api.ts` (+2, global barrel)

Two new type re-exports (`ComplianceMatrixCell`, `ComplianceMatrixRequirement`)
for types defined and already reviewed under the training-compliance
feature's own rotation slot. Re-exporting a type is not a runtime change.
No new gap.

## `components/ux/*` — the file FE4's own sweep never reached

Against `796059dc`, six files differ (FE4 found five against the wrong
baseline): `Breadcrumbs.tsx`, `breadcrumbRoutes.ts` (+ both their new test
files), `CommandPalette.tsx`, and **`DateTimeQuarterHour.tsx`**, which does
not appear anywhere in `FE4-34-frontend-shared.md`.

- **`breadcrumbRoutes.ts` (new, 152 lines) + `Breadcrumbs.tsx` (205 of its
  218 changed lines predate `b10ecfe3`)**: read in full. This is a
  fail-closed permission-mirroring allowlist, not a security boundary of
  its own — `canLinkCrumb(path, checkPermission)` returns a link only when
  the path is registered **and** the viewer holds one of its listed
  permissions; every unregistered or unauthorized path renders as inert
  text via the `DENY_ALL` fallback when `checkPermission` is unavailable
  (partially-mocked stores in 18 test suites). No `dangerouslySetInnerHTML`/
  `innerHTML`/`eval` in either file. `breadcrumbRoutes.test.ts` derives the
  real route set, each route's actual permission gate, and the ancestor set
  straight out of the router/hub source (not from the registry's own
  claims) and fails on drift — ran it: 136 tests pass across the two files'
  suites. This is exactly the substantial, previously-invisible change
  Codex's finding predicted might exist; it holds up as a correctly-built,
  fail-closed feature with no gap.
- **`CommandPalette.tsx`**: the `members.manage` → `users.create` permission
  change FE4 already reviewed, plus one comment-wording fix
  ("Gear & Uniforms" → "Inventory") from the invisible window. No security
  effect either way — a client-side visibility filter on a shortcut list,
  not an access-control decision (the destination route carries its own
  `ProtectedRoute` gate).
- **`DateTimeQuarterHour.tsx` (+17 lines, never reviewed by any pass)**: adds
  an optional `timezone` prop and threads it into `getTodayLocalDate(timezone)`
  instead of the browser-local `getTodayLocalDate()`, so picking a time
  before a date resolves "today" against the department's timezone rather
  than the browser's. A correctness fix matching CLAUDE.md's date/time
  handling rule, not a security-relevant change — no auth, tenancy, caching,
  or exposure dimension touched. No finding.

## Full-frontend sweep — new `api.get` calls since the correct baseline

Redone against `796059dc` (not `b10ecfe3`). Superset of FE4's table; every
row not already in FE4's sweep is new here:

| File                             | New call                                                                                                    | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/eventServices.ts`      | `GET /events/{id}/attendees` (new `getEventAttendees`, paginated, capped at 25 pages)                       | Matches the new `/attendees` substring exclusion added to `apiCache.ts` this same window (see above) — correctly excluded. `getEligibleMembers`'s pre-existing `/eligible-members` path is unchanged and already excluded.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `services/eventServices.ts`      | `GET /events/{id}/qr-check-in-data` — now passed `_skipCache: true`                                         | Was already not globally sensitive; the change makes an already-correct case stronger (a live check-in-window flag must not go stale for up to 90s). No gap either way.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `services/adminServices.ts`      | `GET /integrations/claude-mcp/status`, `GET /integrations/claude-mcp/keys` (new MCP service-key management) | Both start with `/integrations`, already a full prefix in `UNCACHEABLE_PREFIXES` ("integration config... API keys, webhook URLs, secrets"). Confirmed by reading `isCacheable`'s `startsWith` matching — already covered, no gap, despite this being a brand-new and highly sensitive surface (service-key issuance with `expose_finance`/`expose_medical_screening`/`expose_full_schedule` flags). Worth flagging precisely _because_ it's sensitive: the exclusion holds only because `/integrations` is a bare prefix: a future endpoint under a **different** top-level path for the same feature would not inherit it. |
| `services/facilitiesServices.ts` | `getTypes`/`getStatuses` gain an `is_active` param                                                          | Same pre-existing `/facilities/types`/`/facilities/statuses` endpoints (not new since `796059dc`); only a query param was added. Out of this pass's scope (not new API surface) — left as-is, no regression.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `services/userServices.ts`       | `GET /users/me/profile-visibility`                                                                          | Starts with `/users`, already excluded (no trailing slash, so the bare prefix matches). No gap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `services/documentsService.ts`   | `GET /documents/folders` (shape change only)                                                                | Starts with `/documents`, already excluded. No gap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `services/inventoryService.ts`   | `GET /inventory/items/colors`                                                                               | **The one real gap — see Findings.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Everything FE4's own table already covered (`/inventory/requestable-catalog`,
`/notifications/logs`, `/notifications/my`,
`/inventory/requests/{id}/fulfillment-options`,
`/scheduling/shifts/needing-closeout`) re-confirmed unchanged; not re-derived
here.

## Findings

### FE5-34-1 (P2) — `GET /inventory/items/colors` is globally cached with no cap on what it can carry

**What:** `InventoryItemBase.color` (`backend/app/schemas/inventory.py`) is
`Optional[str] = Field(None, max_length=50)` — a 50-character cap and
nothing else. `backend/app/utils/color_names.py`'s `normalize_color` only
collapses internal whitespace; `canonical_color` only folds a new spelling
into an existing one case-insensitively. Neither validates content against
any vocabulary — deliberately, per the module's own docstring ("a department
stocks whatever its supplier sells... an enum would block a legitimate
colour"). `list_item_colors`/`get_item_colors`
(`backend/app/api/v1/endpoints/inventory.py:741`) returns exactly the set of
distinct stored values, org-scoped. `FE4-34-frontend-shared.md`'s sweep
table cleared this endpoint with "No PII, no per-member data, no free-text
field" — the last clause is false; it _is_ a free-text field, just one that
happens to usually hold colour names.
**Where:** `frontend/src/utils/apiCache.ts` (`UNCACHEABLE_PREFIXES`); backend
is correct as-is (org-scoped, capped, no code change needed there).
**Impact:** if an inventory manager or a CSV import puts a name, email, or
other sensitive text into the `color` column of any item, this globally-
cached (30s fresh / 90s stale, shared across every viewer in the tab) GET
response would serve it back to any authenticated member of the
organization for up to 90 seconds after it changes — not scoped to who can
edit inventory, just to being signed in.
**Fix:** added `/inventory/items/colors` to `UNCACHEABLE_PREFIXES` in
`frontend/src/utils/apiCache.ts`, alongside the other free-text-carrying
entries already there (mirrors `/inventory/requestable-catalog`'s own
comment style). The parent `/inventory/items` catalog and its list/detail
endpoints remain cacheable — this is a `startsWith` prefix match, so it
blocks only this sub-path.
**Guard test:** `frontend/src/utils/apiCache.test.ts` — new case
`'returns false for /inventory/items/colors (unconstrained free-text
field)'`, placed next to the existing `'still caches the general inventory
catalog'` case to make the sibling relationship explicit. Verified failing
against the pre-fix `apiCache.ts` (`expected true to be false`) and passing
after.
**Disposition:** FIXED.

## Re-verification of PROGRESS.md's own claims

`PROGRESS.md`'s Open PR section and its 2026-09-07 Log entry for pass 4 both
said "FE3-34-4 and FE3-34-5 (both HIGH) are fixed." Codex's third finding is
that this went stale the same day it was written: `9d745075` (a later
commit on the same PR) correctly reopened FE3-34-5 in
`FE4-34-frontend-shared.md` and `KNOWN_LIMITATIONS.md`, but nothing updated
`PROGRESS.md` to match, so the merged tracker disagreed with the two docs it
summarizes. Corrected in this PR:

- **Open PR section**: now states FE3-34-5 was reopened, matches
  `FE4-34-frontend-shared.md`/`KNOWN_LIMITATIONS.md`, and points to this
  doc for the baseline-citation and caching-gap corrections.
- **Log entry (2026-09-07, Feature 34 pass 4)**: prepended a correction
  note under its own header, and rewrote the paragraph that said "FE3-34-4
  and FE3-34-5 (both HIGH) are fixed" to separate the two — FE3-34-4 stays
  fixed, FE3-34-5 is marked OPEN with the same reopening explanation used
  in `FE4-34-frontend-shared.md`. The colour-endpoint sentence in that Log
  entry is annotated as wrong rather than deleted, per this file's own
  practice of appending corrections instead of rewriting history.

Did not touch the rotation-state table (the ⬜/🔄/✅ column) and did not
start a new feature — Feature 34's row stays exactly as pass 4 left it; this
is a correction to what pass 4 recorded about itself, not a new pass over
new code in the rotation's ordinary sense.

## Verified good ✅ (re-confirmed against the correct baseline)

- `utils/createApiClient.ts`, `utils/errorHandling.ts`,
  `services/errorTracking.ts`, `components/ProtectedRoute.tsx`,
  `learningProgressStore.ts`, `pendingSyncStore.ts`, `skillsTestingStore.ts`,
  and the 10 module `api.ts` files not touched by this window — confirmed
  byte-identical to `796059dc` (empty `git diff`), not merely re-asserted
  from FE4's claim against a different commit.
- The FE3-34-4 and FE3-34-5 fixes described in detail above hold under the
  correct baseline exactly as FE4 described them — FE4's _technical_
  description of each fix was accurate; only its _baseline citation_ for
  what was and wasn't diffed was wrong.
- No new XSS sink (`dangerouslySetInnerHTML`/`innerHTML`/`eval`/
  `document.write`) in any file this pass read that FE4 had not already
  checked.

## Not fixed — considered, judged correctly scoped

- **FE3-34-2** (HIGH) — unchanged, still needs a product decision. Not
  re-litigated by this pass; see `FE4-34-frontend-shared.md`.
- **FE3-34-5** (HIGH) — unchanged from FE4's corrected disposition (OPEN,
  purge-failure path). Not re-litigated by this pass.

## Documentation corrections

- **`docs/security-review/FE4-34-frontend-shared.md`**: added a correction
  banner after its summary block naming both the wrong baseline citation and
  the wrong colour-caching claim, pointing here, rather than rewriting the
  body (its technical descriptions of the FE3-34-4/FE3-34-5 fixes are
  otherwise accurate and are not disturbed).
- **`docs/security-review/PROGRESS.md`**: Open PR section and the pass-4 Log
  entry corrected — see "Re-verification of PROGRESS.md's own claims" above.
- **`docs/KNOWN_LIMITATIONS.md`**: no change — already correct (FE3-34-5
  entry already shows "reopened 2026-09-07").
- **`CHANGELOG.md`**: added an entry for the colour-caching fix under
  `[Unreleased]`, matching this project's existing convention of recording
  cache-exclusion security fixes there (see e.g. the 2026-08-27
  "A few training-related pages could briefly cache data they shouldn't"
  entry).

## Schema & migration notes

n/a — frontend-only fix; the one backend file read
(`backend/app/schemas/inventory.py`) was read-only cross-reference, not
modified. `color`'s existing `max_length=50` cap and nullability are
already correct per CLAUDE.md Pitfall #2/#7's concerns — no schema change
needed or made.

## Guard tests added

- `frontend/src/utils/apiCache.test.ts` — one new case for
  `/inventory/items/colors`, verified to fail pre-fix and pass post-fix (see
  Findings above).

## Completion gate

| Check                                                                                                                                                                                                 | Result                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck` (`tsc-native.mjs`, aliased 7.0.2 compiler)                                                                                                                                        | ✅ 0 errors                                                                                                                                                                                                                                |
| `npx eslint .` (whole frontend)                                                                                                                                                                       | ✅ 0 errors, 2 warnings (pre-existing `react-refresh/only-export-components` in `modules/scheduling/components/CallTypeChips.tsx`, unrelated to this feature, within the max-warnings 10 budget — same pre-existing warnings FE4 recorded) |
| `apiCache.test.ts`                                                                                                                                                                                    | ✅ 88 passed (was 87 before this pass's new case)                                                                                                                                                                                          |
| Scoped suite (`apiCache`, `apiClient`, `authStore`, `createApiClient`, `learningProgressStore`, `pendingSyncStore`, `skillsTestingStore`, `ProtectedRoute.module`, `breadcrumbRoutes`, `Breadcrumbs`) | ✅ 365 passed (10 files)                                                                                                                                                                                                                   |
| Backend                                                                                                                                                                                               | n/a — no backend files changed; `inventory.py`/`color_names.py` read-only cross-reference for FE5-34-1                                                                                                                                     |

`modules/scheduling/services/api.ts` and
`modules/inventory/services/equipmentCheckApi.ts` have no dedicated test
file (neither had one before this pass); both were reviewed by reading the
diff and current file in full, not by running a suite, since neither was
modified by this PR.

## Commit range diffed

`796059dc..HEAD` (as of this PR's branch point) for every file this feature
owns, plus a full-frontend sweep over the same range for new `api.get(`/
`api.get<` call sites. Explicitly **not** `b10ecfe3..HEAD` — that is the
citation this pass corrects.

## Next

No change to the rotation position. Feature 34 remains ✅ in the rotation
table; the rotation's next full pass starts at 00 (cross-cutting baseline)
as pass 4 already recorded. This PR is a correction to pass 4's own record,
not a new turn in the rotation.
