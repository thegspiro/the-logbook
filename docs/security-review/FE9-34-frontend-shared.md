# Security Review — Feature 34: Frontend Shared (pass 9)

**Prefix:** `FE9` · **Iteration:** 34 · **Reviewed:** 2026-10-18 · **PR:** (opening)

**Frontend:** `utils/apiCache.ts` (+ `apiCache.test.ts`), `services/apiClient.ts`,
`utils/createApiClient.ts`, `utils/errorHandling.ts`, `services/errorTracking.ts`
(+ `services/errorReporting.ts`), `services/api.ts` (global barrel),
all 13 `modules/*/services/api.ts` files, the four second per-module clients,
`components/ProtectedRoute.tsx`, `stores/authStore.ts` (+ offline-queue
ownership/quarantine utilities), `stores/learningProgressStore.ts`,
`stores/pendingSyncStore.ts`, `stores/skillsTestingStore.ts`,
`stores/practicalSkillsStore.ts` (new), plus a repo-wide sweep for new
`api.get(`/`api.get<` call sites, new `axios.create(`/`createApiClient(` call
sites, `localStorage.setItem`/`sessionStorage.setItem` call sites, hardcoded
secret/token literals, and XSS sinks (`dangerouslySetInnerHTML`/`innerHTML
=`/`document.write`/`eval(`) since the pass-8 baseline.
**Backend:** read-only cross-reference for the two fixes below —
`backend/app/schemas/inventory.py` (`MaintenanceRecordResponse`/
`MaintenanceRecordBase.performed_by`), `backend/app/schemas/facilities.py`
(`FacilityMaintenanceBase.performed_by`) — plus the new rich-text feature's
backend half, `backend/app/utils/rich_text.py` and its wiring in
`backend/app/schemas/minute.py`, read in full as a new shared-surface XSS
control even though `minutes` itself is a different feature's rotation slot.
**Migrations:** none written or reviewed as in-scope (618 revisions, single
head, confirmed via `validate_migrations.py --strict` — unrelated to this
feature).

**2 fixes, 0 new OPEN/FLAGGED findings.**

---

## Method

1. **Established the baseline**: `3f429ede` (the merge that landed
   `FE8-34-frontend-shared.md`, confirmed via `git log --diff-filter=A`).
2. **Independently re-confirmed Step 0** before starting: PR #3393 (Feature 33,
   Core infrastructure, pass 7) was the last security-review PR and had
   already merged (confirmed via `pull_request_read`, `merged: true`); a fresh
   `search_pull_requests` for an open `head:claude/security-review-` PR
   returned zero results.
3. **Diffed every feature-owned file** against the baseline
   (`git diff --stat 3f429ede..HEAD -- <each file>`). Six files changed
   (`SignOutUnconfirmedNotice.tsx`, `services/api.ts`, `services/apiClient.ts`,
   `services/errorReporting.ts`, `utils/apiCache.ts`, `utils/errorHandling.ts`)
   plus one new global store (`stores/practicalSkillsStore.ts`). Everything
   else named in FE8's scope line — `ProtectedRoute.tsx`, `authStore.ts`, the
   four offline queues and their ownership/quarantine utilities,
   `createApiClient.ts`, all 13 module `services/api.ts` files plus the four
   second-client files — is byte-identical to the baseline (confirmed by the
   same diff-stat producing no entry for each).
4. **Read every line of the diff** for all seven changed/new feature-owned
   files, applying `CHECKLIST.md`'s seven dimensions.
5. **Enumerated every axios-instance-creating file fresh**
   (`grep -rln "axios.create(" frontend/src`): still exactly two —
   `services/apiClient.ts` and `utils/createApiClient.ts`. Enumerated every
   `createApiClient(` caller fresh: still the same 13 module files plus the
   same four second-client files — no bespoke axios instance anywhere.
6. **Ran a repo-wide diff sweep** for new `api.get(`/`api.get<` call sites
   since `3f429ede`, across the whole frontend (not just feature-owned files).
   Found ~50 new call sites; traced each to its client (global cached `api`
   from `services/apiClient` vs. a module's own `createApiClient()` instance,
   which has no cache interceptor at all) and, for the former, checked it
   against `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS`. This is where
   FE9-34-1 (below) was found — not from a named call site itself (which
   reuses an existing, already-reviewed endpoint), but from a sibling method
   added to the same service that prompted a fresh read of that endpoint's
   response schema.
7. **Ran a repo-wide sweep** for `localStorage.setItem(`/`sessionStorage.
setItem(`, hardcoded API-key/secret/token literals, and new XSS sinks
   since `3f429ede` — found four hits. Two are test-file `document.body.
innerHTML` setup/teardown (no production code). Two are a genuinely new
   production sink: `components/ux/RichText.tsx`'s `dangerouslySetInnerHTML`
   and `utils/richText.ts`'s `holder.innerHTML = sanitizeRichText(html)`, both
   new shared UX components (694 lines across 7 new files) supporting the
   Minutes rich-text editor. Audited in full (below) rather than treated as a
   routine "no new sink" result, since this one both is new and reaches
   `dangerouslySetInnerHTML`.
8. **Ran the full backend+frontend completion gate** (below).

## Findings

### FE9-34-1 — LOW — member-attributed maintenance records are cacheable — ✅ FIXED

**What:** `GET /inventory/items/{item_id}/maintenance` and `GET
/facilities/maintenance` were not in `UNCACHEABLE_PREFIXES` or
`UNCACHEABLE_SUBSTRINGS`. Both list a maintenance record shaped like the
other member-attributed sub-resources this file already excludes
(`/issuances`, `/history`, `/exposures`): `backend/app/schemas/inventory.py`
`MaintenanceRecordBase.performed_by: Optional[UUID]` plus free-text
`description`/`notes`/`issues_found`, and `backend/app/schemas/
facilities.py` `FacilityMaintenanceBase.performed_by: Optional[str]` (a
**typed-in name**, not an id) plus free-text `description`/`work_performed`/
`findings`.
**Where:** `frontend/src/utils/apiCache.ts` (before this fix);
`frontend/src/services/inventoryService.ts:542,548` (`getItemMaintenanceHistory`,
pre-existing, and the new `getOpenMaintenanceRecords`, added this pass's
diff window — it was this new sibling method that prompted re-reading the
shared endpoint's schema); `frontend/src/services/facilitiesServices.ts:668`
(`getMaintenanceRecords`, pre-existing). Both routes go through the global
cached client (`import api from './apiClient'` in both service files,
confirmed), not a module-local `createApiClient()` instance.
**Failure scenario:** a facilities officer closes a maintenance record and
types a correction into `findings`/`work_performed`, naming a specific
person by free text in `performed_by`. A second admin who had the maintenance
list open within the prior 90 seconds still sees the pre-correction record —
the same staleness-of-a-member-attributed-record class `/history`'s own
comment describes, not a cross-tenant leak (both routes are already org- and
permission-scoped).
**Impact:** LOW. Same-org, no disclosure to anyone not already entitled to
see the record — the defect is a stale member-attributed/free-text record for
up to 90 seconds, the same category every other item/facility sub-resource in
this file is excluded for.
**Fix:** added `/maintenance` to `UNCACHEABLE_SUBSTRINGS`, grouped with the
other inventory-item sub-resources since it covers
`/inventory/items/{id}/maintenance` the same way, and noted in its comment
that it also covers `/facilities/maintenance`. The item list/detail routes
themselves (`/inventory/items`, `/inventory/items/{id}`) stay cacheable —
confirmed by test. Corrected the preceding comment block's stale count
("three" sub-resources, actually four even before this pass's addition —
`issuances`, `nfc-scans`, `nfc-tags`, `exposures`) to "five." Guard test added
(see below).

## Verified good ✅ (re-confirmed against the current baseline)

- **Every one of the 13 `modules/*/services/api.ts` files, plus all four
  second-client files, calls `createApiClient()`**, and `createApiClient.ts`
  itself is byte-identical to `3f429ede` (0 diff) — still wires
  `withCredentials: true`, the CSRF double-submit header, and 401 →
  `performSharedRefresh()` → retry on every instance it creates. Still
  exactly two `axios.create()` call sites in the whole frontend.
- **`ProtectedRoute.tsx`, `authStore.ts`, and all four offline queues plus
  their ownership/quarantine utilities are byte-identical to `3f429ede`**
  (0 diff) — re-confirmed via diff-stat rather than re-asserted from a prior
  pass. The auth/permission/forced-redirect logic and the per-queue,
  per-entry ownership re-check at drain time that FE8-34 verified in full
  still stand unchanged.
- **No token (access, refresh, or bearer) written to `localStorage` or
  `sessionStorage`** anywhere in the diff since `3f429ede` — confirmed by
  reading every `.setItem(` call added, all of which are in test setup/
  teardown.
- **No hardcoded secret/token literal** added anywhere in the diff.
- **The new shared rich-text feature (Minutes editor) is a genuine new XSS
  surface, audited in full and found clean by construction:**
  - `frontend/src/utils/richText.ts`'s `sanitizeRichText()` uses DOMPurify
    with a fixed allowlist (`p, br, strong, em, u, h2, h3, ul, ol, li,
blockquote, a`), `ALLOWED_ATTR = ['href']` only, and
    `ALLOWED_URI_REGEXP` restricted to `https?:`/`mailto:` — a `javascript:`
    href cannot survive sanitization. A DOMPurify hook forces
    `rel="noopener noreferrer"` on every surviving `<a>` (tabnabbing
    protection).
  - **The frontend and backend allowlists are the same decision, kept in
    sync by comment and verified by reading both**:
    `backend/app/utils/rich_text.py`'s `nh3.clean()` (the Rust `ammonia`
    binding — "sanitizing HTML is the textbook way to ship an XSS hole, and
    a maintained allowlist sanitizer is the narrowest thing that works," per
    its own module docstring) uses the identical tag set, `{"a": {"href"}}`,
    `url_schemes={"http", "https", "mailto"}`, and
    `link_rel="noopener noreferrer"`.
  - **The backend sanitizes on every write, not just on render**:
    `SectionEntry._settle_rich_text` and `TemplateSectionEntry.
_settle_rich_text` (`backend/app/schemas/minute.py`, `@model_validator
(mode="after")`) call `sanitize_html()` whenever `format == "html"` —
    this runs on every request body that constructs these Pydantic models,
    before anything is persisted.
  - **`components/ux/RichText.tsx`'s `dangerouslySetInnerHTML`** only ever
    receives `sanitizeRichText(content)`'s output, recomputed via
    `useMemo` keyed on `content`/`format` — never the raw `content` prop.
  - **`RichTextEditor.tsx`** (TipTap) seeds the editor with `sanitizeRichText
(value)`, restricts its own `StarterKit` extensions to the same subset
    (no code/codeBlock/strike/horizontalRule, link `autolink: false` and
    `protocols: ['mailto']`), and its own link-insertion dialog
    (`withProtocol()`) rejects any URL with a scheme other than `http(s):`/
    `mailto:` before calling `setLink()`.
  - **Explicit adversarial test coverage already exists** for this feature
    (not added by this pass — found and verified, not re-derived):
    `frontend/src/utils/richText.test.ts` asserts `<script>`, `onerror=`,
    and `javascript:` hrefs are stripped and `ftp:` hrefs are rejected;
    `frontend/src/components/ux/RichText.test.tsx` asserts the same at the
    component level; `frontend/src/modules/minutes/pages/
MinutesDetailPage.richText.test.tsx` asserts `document.body.innerHTML`
    never contains an injected `<script>` tag at the page level;
    `backend/tests/test_minutes_rich_text.py` covers the server side.
  - **The public-facing path is covered by the same control**: the minutes
    public-copy feature (PR #3392, merged separately) reuses the PDF data
    builder (`minutes_print_data.py`), which calls `html_to_pdf_blocks()` →
    `sanitize_html()` — there is no separate, unsanitized path from a
    section's stored content to a public page.
- **`apiClient.ts`'s 503-retry change is behavior-only, not a new trust
  boundary**: it now retries only a 503 the server did not send on purpose
  (`isTransientServiceUnavailable`, keyed on two specific error codes),
  leaving a deliberate 503 (e.g. `LB-UPLD-005`, the malware scanner
  unavailable) to surface immediately rather than retry for 3+ minutes with
  no visible error. No new header, credential, or endpoint is involved.
- **`errorReporting.ts`'s new size-fitting logic
  (`fitContextToLimit`/`fitPayload`) only truncates strings that were already
  queued for an existing error report** — it does not add any new field to
  what is collected, and the existing `sanitizePath()` redaction (display/
  nfc-tag tokens, etc.) runs before a value ever reaches this truncation
  path. Re-read in full; no new data-collection surface.
- **`services/api.ts`'s diff is pure type re-exports** (`StorageAreaScanHit`,
  `AgendaDocument`, `AgendaItem`, `GoogleWorkspaceLinkResult`,
  `GoogleWorkspaceAttentionItem`) — no runtime code, no new client, no new
  cache behavior.
- **`stores/practicalSkillsStore.ts` (new) carries no PII and is explicitly
  not an access-control surface** (its own docstring: "the server enforces
  nothing on it beyond what a shift report records"), stores only an enum
  value and an organization id, and writes nothing to browser storage.
- **New `GET` call sites under `/elections/` (`ballot-send-jobs`) and
  `/training/submissions/` (`crew/context`, `crew/shifts`)** are already
  covered by their respective bare-prefix exclusions in
  `UNCACHEABLE_PREFIXES` — re-confirmed by direct `isCacheable()` check
  against both new paths.
- **The two new `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS` entries added
  by other feature work since baseline** (`/integrations/google-workspace/`,
  `/ical-feed`) are both redundant with the pre-existing bare `/integrations`
  prefix (`GET /integrations/{id}/ical-feed` and the Google Workspace routes
  are both nested under `/integrations`) — confirmed by `isCacheable()`
  returning `false` for both paths with either entry removed. Not a gap:
  extra caution, consistent with this file's established belt-and-suspenders
  style elsewhere (e.g. `/nfc-tags` appearing in both the prefix and
  substring lists for different URL shapes).

## Not fixed — considered, judged correctly scoped

- **FE5-34-1's broader ask** (excluding the whole `/inventory/items` catalog
  from caching) — unchanged, still a product trade-off, recorded in
  `KNOWN_LIMITATIONS.md`. Not re-litigated.

No product decision from this pass needs mirroring into
`KNOWN_LIMITATIONS.md` — the one fix (FE9-34-1) is a mechanical, low-risk
cache-exclusion addition matching an established pattern, not a behavior
change requiring an owner's call.

## Documentation corrections

None needed beyond the stale sub-resource count fixed in `apiCache.ts`
itself (part of FE9-34-1's fix, not a separate correction).

## Schema & migration notes

n/a — frontend-only fix, no owned tables. `validate_migrations.py --strict`
run as part of the completion gate regardless: 618 revisions, single head —
unrelated to this feature, confirmed clean.

## Guard tests added

- `frontend/src/utils/apiCache.test.ts` — one new `it()` block under
  `describe('isCacheable')` asserting `/inventory/items/{id}/maintenance`
  and `/facilities/maintenance` are excluded (FE9-34-1), while
  `/inventory/items` and `/inventory/items/{id}` themselves stay cacheable.
  Fails if the `/maintenance` substring entry is ever removed.
- No other new finding required a fix, so no other new guard test. The rich-
  text feature's own pre-existing guard tests (listed above, under "Verified
  good") already cover the one new XSS-relevant surface this pass audited.

## Completion gate

| Check                                                           | Result                          |
| --------------------------------------------------------------- | ------------------------------- |
| `flake8 app/ tests/ alembic/`                                   | ✅ 0 violations                 |
| `black --check app/ tests/ alembic/`                            | ✅ clean, 2,426 files unchanged |
| `isort --check-only app/ tests/ alembic/`                       | ✅ clean                        |
| `validate_migrations.py --strict`                               | ✅ 618 revisions, single head   |
| `npm run typecheck` (whole frontend)                            | ✅ 0 errors                     |
| `npm run lint` (whole frontend, `--max-warnings 10`)            | ✅ 0 errors, 0 warnings         |
| Scoped frontend suite (`apiCache.test.ts`, `apiClient.test.ts`) | ✅ 105 passed                   |

No backend file was touched this pass; the backend gate was still run in
full per CLAUDE.md's completion-gate requirement and confirmed clean.

Diff scope for this pass: 7 feature-owned files changed/added since the
`3f429ede` baseline (6 pre-existing files touched by other work, 1 new
global store), plus the two files this pass itself edits (`apiCache.ts`:
+9/-5; `apiCache.test.ts`: +8/-0) and this findings file / `PROGRESS.md`.
