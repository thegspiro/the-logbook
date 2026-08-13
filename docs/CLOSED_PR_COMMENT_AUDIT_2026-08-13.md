# Closed-PR Review Comment Audit — 2026-08-13

> **Implementation status (this branch):** Every Tier 1 item below is
> implemented on `claude/closed-pr-helpful-comments-p5si2d` — see commits
> `fix(auth)`, `fix(training)`, `fix(pipeline)`, `fix(facilities)`,
> `fix(elections)`, `feat(elections)` and the cross-cutting `fix` commit —
> except two that need an owner decision: **1.13** (the leaked calendar-token
> PNG is still retrievable from git history; containing it means resetting
> the feed token on the live deployment and rewriting shared history) and the
> **1.10 residual** (the audit trust boundary remains a numeric row ID rather
> than an attestation of the final legacy chain hash — the env-var wiring
> half IS done). Tier 2 is also implemented on this branch — see commits
> `fix(deploy)`, `fix(facilities)` (extended sections), `fix(equipment-checks)`,
> `fix(a11y,skills-testing)`, `fix(elections)` (ballot builder), and
> `feat(scheduling)` (server-side shift settings). Tiers 3-4 remain open.

An audit of review comments on the 150 most recently closed pull requests
(#1197–#1358, closed 2026-08-08 → 2026-08-13) to find helpful, actionable
review suggestions that were never implemented — neither in the PR itself nor
by any later change. Every finding below was re-verified against main at
commit `1643ce2` (2026-08-13); items that were since fixed by follow-up work
are excluded.

## How suggestions go unimplemented here

- **PRs #1197–#1254 have no review comments at all** — they were self-merged,
  typically within minutes of opening. The only recoverable material there is
  the author's own explicitly deferred items in PR bodies (included below
  where still open).
- **From ~#1255 onward, the Codex review bot (`chatgpt-codex-connector`)
  reviews most PRs.** The dominant failure mode: the PR merges **minutes after
  the review posts**, with no reply and no fix commit — the threads are never
  resolved and the findings are simply lost. Long-lived branches (the
  shift-scheduling series) did absorb several rounds of fixes; the
  merge-in-minutes PRs absorbed none.
- **A recurring theme in the security-hardening PRs (#1273–#1280, #1358):
  server-side permission tightening shipped without the matching frontend
  change**, so previously working member/officer workflows now deterministically
  403 behind unchanged UI.

Roughly 110 suggestions survived verification. They are ranked below.

---

## Tier 1 — Security & data integrity (implement first)

### 1.1 Refresh-token replay revocation is a no-op (#1308, P1)

`_revoke_all_user_sessions` only `flush()`es (`backend/app/services/auth_service.py:358`,
`:420-426`); the endpoint then raises 401 (`backend/app/api/v1/endpoints/auth.py:1075-1080`)
and the session dependency rolls the transaction back
(`backend/app/core/database.py:173-179`). The PR's headline guarantee —
account-wide revocation on replay — never commits; stolen rotated tokens keep
working. **Fix: commit the revocation before raising.**

### 1.2 Concurrent-vote race persists despite the lock (#1306, P1)

`check_voter_eligibility`'s plain reads establish the REPEATABLE READ snapshot
(`backend/app/services/election_service.py:1058`) _before_ the
`with_for_update()` at `:1067-1071`, and the post-lock `_get_user_votes`
(`:1107`) is still a snapshot read — the second racer misses the first's
committed vote. Over-voting remains possible; the exact race the PR was
written to close.

### 1.3 Cloning an election corrupts real applicant packages (#1300, P1)

`copy.deepcopy(source.ballot_items)` (`election_service.py:3564`) copies
`prospect_package_id` into the clone despite the docstring's "does NOT copy
anything stateful"; `_sync_package_statuses` (`:4319-4361`) then sets the real
package `elected`/`not_elected` from the clone's votes when the clone closes.
**Strip stateful keys on clone.**

### 1.4 Paper multi-vote turnout is a lower bound (#1341, 2×P1)

`paper_ballots = max(manual_counts.values())` (`election_service.py:1838-1855`)
undercounts approval-style paper voters (10 ballots split 5/5 counts as 5), so
percentage-quorum checks can wrongly void winners. The single-choice test also
ignores per-ballot-item voting-method overrides (`:1847-1851`). **Capture the
physical ballot count.**

### 1.5 Legacy NULL-position votes escape duplicate detection (#1305, P1+P2)

Duplicate lookup filters `Vote.position == effective_position`
(`election_service.py:6825-6829`); pre-deploy rows stored with NULL positions
are invisible — a reusable token that voted pre-deploy can cast a second
counted vote. Token bookkeeping also skips NULL positions (`:6906`). **Backfill
migration + NULL-aware lookup.**

### 1.6 Officer-only checklist data still leaks to members (#1279, 2×P1)

- `GET /programs/{id}/requirements` (`backend/app/api/v1/endpoints/training_programs.py:1016-1039`)
  and `GET /training/requirements` (`backend/app/api/v1/endpoints/training.py:897-922`)
  return full `checklist_items` (incl. `member_visible: false` steps) to any
  member — a direct bypass of the sanitization that PR shipped on other routes.
- A member PATCHing their own progress with `progress_notes` that omits
  `checklist_done` passes the guard (`training_program_service.py:2457-2464`)
  and the full-dict replacement (`:2734-2735`) **wipes officer sign-off state**.

### 1.7 Pipeline stage machinery: two P1s (#1326)

- Skip guard uses "last by sort_order" (`membership_pipeline_service.py:1214`)
  while transfer uses `is_final_step` (`:1191`) — skipping a reordered final
  stage can fire `_do_transfer` and silently create an active member.
- Checklist / multi-approval / reference-check stages **can never be
  legitimately completed**: validation reads stored `action_result`
  (`:1022,1044,1068`) which is only persisted _after_ validation
  (`:1140` → `:1162-1172`); no other endpoint writes it. Prospects on those
  stages can only advance via skip.

### 1.8 Org deactivation doesn't cut off signed-in members (#1331, P1)

`refresh_access_token` checks only `user.is_active`
(`backend/app/services/auth_service.py:317-377`) and re-issues 7-day refresh
tokens indefinitely; only login checks `Organization.active`. **Check org
status on refresh (or revoke sessions at deactivation.)**

### 1.9 `facilities.view_sensitive` rollout gaps (#1358, 4 threads)

- No data migration grants it to existing orgs' VP/Treasurer (grant exists only
  in `DEFAULT_POSITIONS`, `backend/app/core/permissions.py:1261,1289`; no
  alembic reference) — existing officers 403 on utility/insurance/budget data.
- Chief rank defaults lack the grant (`permissions.py:845-849,895-899,939-942`)
  and the rank-grant ceiling matches exact/wildcard only (`:648-667`;
  `endpoints/users.py:696-701`) — **chiefs cannot promote a member to Captain**.
- `FacilityResponse` still exposes `lease_expiration`/`property_tax_id` to
  plain `facilities.view` (`backend/app/schemas/facilities.py:365-366,423`).
- Onboarding position save rebuilds permissions from `.view/.manage/.*` only
  (`backend/app/api/v1/onboarding.py:1917-1956`), silently stripping the grant.

### 1.10 `AUDIT_LOG_LEGACY_MAX_ID` is inert in every compose deployment (#1309/#1331, 2×P1)

The setting exists (`backend/app/core/config.py:211`) but appears in **no**
compose file's explicit `environment:` mapping — upgraded Docker installs keep
`0`, every pre-HMAC audit row fails integrity verification, and `rehash_chain`
refuses repair. Residual from the same review: the trusted boundary is still a
mutable numeric ID (`backend/app/core/audit.py:319`), not an attestation of
final legacy chain state.

### 1.11 Guest check-in PII has no retention policy (#1237 deferral)

`backend/app/services/retention_service.py:62-130` has no record class for
`EventExternalAttendee` or guest-created prospects — unauthenticated members of
the public submit name/email/phone that persists forever. The framework already
exists; the addition is small.

### 1.12 Error-log token redaction misses live credentials (#1340, 2×P1)

- Pattern covers only plural `/event-requests/status/`
  (`frontend/src/services/errorReporting.ts:208`;
  `backend/app/core/error_reporting.py:38`) while the page route is singular
  `/event-request/status/:token` (`frontend/src/modules/events/routes.tsx:160`).
- `display_code` (guest check-in credential) is not in `SENSITIVE_QUERY_KEYS`
  and no `/display/` path pattern exists (`error_reporting.py:24-41`).

### 1.13 Leaked calendar-feed token still in git history (#1270, P1)

Deleting `docs/training/images/03-34-calendar-subscribe.png` did not contain
the leak — `git show 6cc88d2:...` still returns the 183 KB secret-bearing PNG.
Reset the feed token (likely a demo credential, unverified) and purge or accept
the history exposure explicitly.

---

## Tier 2 — Deterministically broken user-facing workflows

### 2.1 Facilities extended sections (#1324 merged / #1346 & #1325 closed-unmerged; identical Codex review on all three, live in main)

- **Infinite refetch loop**: every `ResourceSection` gets an inline `load`
  prop; `reload` → effect → re-render → new `load` — opening
  Utilities/Access-Keys/Shutoffs/etc. hammers the API continuously
  (`frontend/src/modules/facilities/components/ExtendedFacilitySections.tsx:66-79`
  - inline props at `:349,399,450,496,550,606`).
- **"Add reading" is dead on arrival**: payload omits required
  `utility_account_id` (`:285-289` vs `backend/app/schemas/facilities.py:843`)
  — every submission 422s.
- **Blank optional dates sent as `''` → 422** on capital-project, insurance,
  occupant forms (`:504,:558,:612`) — the project's own Pitfall #1.
- **Cleared numerics silently keep old values** (`numberValue` at `:220`
  omits keys on update — Pitfall #1 update-path bug).
- `useFacilitiesAccess` exposes only `canManage/canCreate/canViewSensitive`;
  holders of `facilities.edit`/`facilities.maintenance` (backend-authorized,
  `endpoints/facilities.py:1072,1147`) see no mutation UI.
- Insurance `POLICY_TYPES` omits supported `equipment` (`:254`); room-backed
  location reparenting unguarded (`backend/app/services/location_service.py:148-159`);
  print-labels route/permission mismatch (`routes.tsx:38` vs `label_service.py:157`).

### 2.2 Equipment-check permission tightening broke member flows (#1273–#1280)

- **Swap always 403s for members**: endpoint now requires manage
  (`backend/app/api/v1/endpoints/equipment_check.py:1664-1666`) but
  `EquipmentCheckForm.tsx:1774-1789` renders Swap unconditionally.
- **Lot quantity saves always 403 for submit-only crew**: the field-presence
  gate (`equipment_check.py:1550-1556`) rejects because `LotsAboardPanel`
  always sends `lotNumber`/`expirationDate` even when only quantity changed.
- **Manager override lost on resume**: `submit_check` delegates without
  `allow_any=True` (`equipment_check_service.py:971-980` vs `:1210`) — manager
  resuming another member's incomplete check gets "Check not found".
- Restock **Undo** shown to non-managers who 403 (`ApparatusInventoryPage.tsx:324-332`);
  the manage-only restriction is bypassable via `set_item_quantity`
  (`equipment_check.py:1582-1586` → `_sync_restock_after_restocking`).
- Checklist feed lists checks the submit guard rejects (no
  `assignment_status` filter, `equipment_check_service.py:1361-1370` vs `:933-935`);
  stale/declined assignments grant template visibility forever (`:215-229`);
  owned incomplete checks dead-end when a template is deactivated (`:203-213`).

### 2.3 Expiration handling contradicts its own UI (#1276/#1293, 3×P1)

- The form still promises "Expiration on the replacement — the template will
  be updated to match" (`EquipmentCheckForm.tsx:1794-1825`) while the backend
  deliberately discards `expiration_found`
  (`equipment_check_service.py:730-759`) — replaced items keep failing every
  check until an admin edits the template.
- An observed **earlier/expired** date can't fail a check: `_resolve_expiration`
  (`:662-713`) reads only the template, so a crew-recorded expired item can pass.

### 2.4 Fresh production installs fail to boot (#1290, P1)

`SECURITY_REQUIRE_TLS` defaults true (`docker-compose.prod.yml:46`) and startup
fails closed, but `install.sh` / `scripts/universal-install.sh` never set it or
configure TLS for bundled services — every bundled install dies until `.env`
is hand-edited.

### 2.5 Backup/restore machinery quietly broken (#1320/#1322, 6 findings)

- `backup.sh` runs `set -a; source .env` (`scripts/backup.sh:22-27`); the
  template's unquoted `APP_NAME=The Logbook` aborts every backup/restore.
- Restore auto-selects a local `logbook-db` container over a configured remote
  `DB_HOST` (`backup.sh:291`) — wrong-database restores.
- `run_backup || echo` in the sidecar disables `set -e` mid-function
  (`scripts/backup-sidecar.sh:114`) — corrupt archives published as success,
  pruning older good ones.
- The verification sidecar runs on `mysql:8.0` which has no `python3`
  (`docker-compose.prod.yml:70` → `verify_backup.sh:58`) — restore drills have
  never actually run.
- `safe_extract_tar.py:17` requires Python ≥3.12 (`filter=` kwarg) with no
  fallback for older operator hosts.
- Container detection gated on `DB_HOST` being set (`backup.sh:66`) breaks
  documented Unraid manual backups; `BACKUP_LOCATION` never wired for Unraid.

### 2.6 Unraid deployment gaps (#1320/#1332, 3 findings)

- `COOKIE_SECURE` is documented for the HTTP LAN trial but never forwarded in
  either Unraid compose's explicit `environment:` list — LAN logins break
  (browsers drop Secure cookies).
- The HTTPS requirement skips existing installs: option-2 update returns early
  before validation (`unraid/unraid-setup.sh:249-252`) — the population that
  needs the fix never gets it.
- Port 7880 still serves the full app over plaintext
  (`unraid/docker-compose-unraid.yml:246-247`); `verify_deployment` probes
  HTTP and claims the HTTPS origin works (`unraid-setup.sh:440-463`).

### 2.7 Skip-to-main removed — WCAG 2.4.1 regression (#1284/#1293, P1 twice)

No "Skip to main content" link remains anywhere in `frontend/src` (orphaned
CSS at `styles/index.css:1397`); `AppLayout.tsx:169,203` only sets
`tabIndex={-1}`. Keyboard users tab through the full nav on every page. Also:
route announcement never retries after async loads
(`components/ux/PageTransition.tsx:29-33`).

### 2.8 Ballot builder deterministic breaks (#1300/#1301, flagged twice)

- Enabling a supermajority per-item override submits the election's (possibly
  null) percentage, never the displayed 67 → 422 from normal UI
  (`BallotBuilder.tsx:426-431,453-457,476`).
- "Replace" from a saved template is offered while voting is open but the
  PATCH always fails (`:541`, `:612-638`).
- `Promise.all` couples saved-template fetch to built-in templates — one
  failure empties both (`:580-591`).
- Mixed naive/aware datetimes in create → 500 not 422
  (`backend/app/schemas/election.py:346-349`); unconditional quorum check
  bricks PATCHes on legacy rows (`endpoints/elections.py:1052-1061`);
  tightened `BallotItem.id` pattern can fail response validation on legacy
  stored items (`election.py:48-54,462`) with no migration.

### 2.9 Email-results button always 403 for member examiners (#1292, P1)

The PR locked the endpoint to `training.manage` but the practice-test bar
renders "Email Results to Candidate" ungated
(`ActiveSkillTestPage.tsx:1952-1961`; `isOfficer` computed at `:1039`).

### 2.10 Skill-test auto-start races the autosave (#1285, P1)

The draft→in_progress transition is fire-and-forget with a shared
`expected_version` and an empty `.catch()`
(`ActiveSkillTestPage.tsx:1242-1252` vs `saveTest` `:1303,1319`) — a lost 409
leaves the clock running locally on a draft test; a won one makes the autosave
report a false conflict.

### 2.11 Shift settings are per-browser, not per-department (#1241 deferral)

`ShiftSettingsPanel` persists department-wide defaults to `localStorage`
(`frontend/src/modules/scheduling/types/shiftSettings.ts:121`;
`ShiftSettingsPanel.tsx:112,143,150`) — each admin has a private copy; new
browsers see factory defaults. Needs a backend endpoint.

### 2.12 Out-of-service failures alert with empty details (#1282/#1293, P1 then P2)

Failure counter counts `fail` + `out_of_service` (`equipment_check_service.py:718`)
but the alert detail collector skips non-`fail` (`:1056`) — officers get
"N of M items" with empty lists. UI variant: compartments containing
out-of-service items render green "Complete" (`EquipmentCheckForm.tsx:225`).

---

## Tier 3 — Medium-value fixes

| #    | PR          | Finding                                                                                                                                                                                                                                                            | Evidence                                                                                                                         |
| ---- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | #1345       | Error-report queue cleared only after login settles → previous user's reports can post under new user's cookie; 401-hold path resets throttling → unbounded retry stream                                                                                           | `authStore.ts:191-206`; `errorReporting.ts:354-411,127-142`                                                                      |
| 3.2  | #1342       | Deferred training credit records the **approving** officer as evaluator instead of the filing officer                                                                                                                                                              | `shift_completion_service.py:1487-1491,834,886`                                                                                  |
| 3.3  | #1333       | "Timing unverified" flag hidden exactly at the validation decision point and absent from the `detail=criteria` CSV the UI exports                                                                                                                                  | `ActiveSkillTestPage.tsx:2246`; `skills_testing.py:3329-3379`; `SkillsTestingTestRecordsTab.tsx:431`                             |
| 3.4  | #1336       | Explicit JSON `null` on disclosure fields persists and then 500s every GET/PUT of training-module config                                                                                                                                                           | `schemas/training_module_config.py:154-155`; `models/training.py:2079-2082`                                                      |
| 3.5  | #1349       | Restored unique index: no duplicate reconciliation in the migration (deploy-blocking if dupes exist); public-form race now 500s (no `IntegrityError` handling); raw un-normalized email persisted                                                                  | `20260812_0003:34-41`; `membership_pipeline_service.py:772-882,785,838`                                                          |
| 3.6  | #1356       | DBs stamped with the old colliding `20260812_0002` skip the resume-count migration — `skill_tests.resume_count` missing at query time                                                                                                                              | `alembic/versions/` (no reconciliation)                                                                                          |
| 3.7  | #1266       | Duplicate form submission race under REPEATABLE READ (no locking read / unique constraint); public form client has no 401 refresh (loses completed forms); onboarding reset locks out the owner after 30-min token expiry                                          | `forms_service.py:938-954`; `formsServices.ts:150-186`; `onboarding.py:2125-2130`                                                |
| 3.8  | #1281       | Salesforce: stored OAuth tokens can't be cleared to adopt client-credentials; 403 `REQUEST_LIMIT_EXCEEDED` not retried; `Retry-After` date form unparsed/10s cap; token endpoint never retried                                                                     | `salesforce_service.py:35,90,104-119,199-210`; `integrations.py:324-326`                                                         |
| 3.9  | #1277       | Compatibility merge revision carries DDL (rollback drops a column while stamping a revision that had it); startup stale-file recovery regex can't parse tuple `down_revision` → can break the migration graph it protects                                          | `20260810_0002`; `backend/main.py:478-504,561`                                                                                   |
| 3.10 | #1271/#1269 | Inventory-link audit written in a second transaction — audit-write failure leaves unaudited links and retries no-op; entry lacks per-row old/new                                                                                                                   | `equipment_check_service.py:2804`; `equipment_check.py:338-352`                                                                  |
| 3.11 | #1326       | Skipped pipeline stages render as completed (authenticated) or upcoming (public); YoY growth compares against previous _populated_ year                                                                                                                            | `api.ts:319-353`; `ApplicationStatusPage.tsx:101,192-193`; `reports_service.py:1822-1848`                                        |
| 3.12 | #1267       | Learning Center absent from `TopNavigation` (undiscoverable on that layout); learning paths ignore `useEnabledModules()`                                                                                                                                           | `SideNavigation.tsx:166`; `LearningCenterPage.tsx`                                                                               |
| 3.13 | #1323       | Mobile drawer keeps conflicting positioning utilities (fix may not apply); actionable stat cards vanish from printouts (`button:not([data-print])`)                                                                                                                | `SideNavigation.tsx:586`; `DashboardStatCard.tsx:49`; `index.css:863-874,1458`                                                   |
| 3.14 | #1294       | `hscroll ... w-fit` still overflows the page on phones in two files                                                                                                                                                                                                | `NotificationsPage.tsx:424`; `FormsPage.tsx:443,927`                                                                             |
| 3.15 | #1316       | RunoffChain fetches every election detail in parallel (O(N)); election list vote counts include test/unattested votes the detail excludes; legacy compounded runoff titles keep compounding                                                                        | `RunoffChain.tsx:49-66`; `elections.py:231-237`; `election_service.py:54`                                                        |
| 3.16 | #1331       | Saved ballot templates don't capture election-wide voting method / write-in settings the docs promise; `CohortDetailPage` shows officer controls to students (all 403)                                                                                             | `BallotBuilder.tsx:597-600`; `CohortDetailPage.tsx`                                                                              |
| 3.17 | #1295       | Insecure-origin (HTTP LAN) camera error replaced by generic message in two flows; tab auto-normalization pushes history (Back trap); explicit `?tab=` overridden on closed elections; 30/60-day screening fetches share one store slice (60-day list can truncate) | `useHtml5Scanner.ts:119-120`; `constants/camera.ts:89-90`; `ElectionDetailPage.tsx:119,206-209`; `ComplianceDashboard.tsx:16-31` |
| 3.18 | #1318       | Scanner start-failure cleanup can kill the newer stream; html5 scanner stop/restart not serialized                                                                                                                                                                 | `InventoryScanModal.tsx:253-260`; `useHtml5Scanner.ts:72-114`                                                                    |
| 3.19 | #1322       | WS origin fallback ignores scheme; analytics 10s poll flashes a full-page spinner and has a route-change race                                                                                                                                                      | `websocket_origin.py:33`; `AnalyticsDashboardPage.tsx:21-62`                                                                     |
| 3.20 | #1302       | CatalogQuickAdd results list clips at viewport bottom (no flip-above)                                                                                                                                                                                              | `CatalogQuickAdd.tsx:202-258`                                                                                                    |
| 3.21 | #1254       | Deferred: dual source of truth for on-truck lot/expiration (the seam where the date-substitution bug lived); no E2E coverage of inventory/shift-check screens; `critical_minimum_quantity` unused outside checks                                                   | `models/apparatus.py:2164,2290`; `frontend/src/e2e/`                                                                             |
| 3.22 | #1319       | Label builders pick first non-empty identifier, not first Code128-safe one — one bad asset tag fails the whole PDF instead of falling back                                                                                                                         | `label_service.py:76,118,141`; `label_renderer.py:163-169`                                                                       |
| 3.23 | #1273       | `manage`-without-`view` role can't list/fetch templates it can edit                                                                                                                                                                                                | `equipment_check.py:134,166`                                                                                                     |
| 3.24 | #1238       | Clearing a requirement's numeric target leaves stale progress percentages (early return)                                                                                                                                                                           | `training_program_service.py:1259-1261`                                                                                          |

## Tier 4 — Low / tooling / docs (grouped)

- **#1344** screenshot bootstrap: `--allow-remote` doesn't require HTTPS;
  documented `token_urlsafe(24)` fails the special-char password policy ~36%
  of the time; no reserved-username validation.
- **#1354/#1302/#1295/#1267/#1234** screenshot manifest/seeder accuracy:
  hard-coded election dates, alt text vs actual capture (runoff settings,
  quantity stepper), case-sensitive template dedupe, impossible dual-SSO mock,
  worn-gear seeding can't recover from partial failure, warm-DB lot repair
  skipped, seeder requires public DNS, "Line Officers" profile targets all
  actives, Vector Solutions screenshot blocked on seeder support.
- **#1287** seeder prompts for the examiner password before `--templates-only`
  exits (blocks unattended runs); docs still instruct the removed
  `--examiner-password` flag (`docs/SKILLS_TESTING_DATA_REVIEW.md:99-100`).
- **#1331/#1297/#1295** doc/contract accuracy: API reference over-claims
  nested extra-field rejection; elections guide says foreign templates 404 on
  list; expired screenings claimed visible in a list that excludes them
  (`medical_screening_service.py:376`); router-level 400 declared on GET
  display endpoints that can't emit it (`backend/main.py:2128-2132`); inventory
  `?tab=` validated against the global tab list.
- **#1317** security-scan policy gate still substring-matches `pip-audit -r`
  anywhere in the file (`check_security_scan_policy.py:29`).
- **#1298** stale "Next feature: B1" marker in `docs/app-review/PROGRESS.md:2038`
  can misdirect the autonomous review loop away from the re-enabled Tier A.
- **#1278** guest check-in shows "We have your details / Someone will be in
  touch" even when no contact info was collected (`GuestCheckInPage.tsx:164-176`).
- **#1268** equipment-requests pagination keeps a stale offset after the last
  row on a page is removed (`EquipmentRequestsPage.tsx:57-72`).
- **#1266** foreign-org session rejected (404) on forms allowing anonymous
  repeats (`public/forms.py:183-187`) — arguably a defensible posture.
- **#1279** `training.view_all` holders get redacted PATCH responses despite
  full GET access (`training_programs.py:1480-1482`).
- **#1210** deficiency flags remain full-Apparatus-only (documented product
  decision; `BasicApparatus` has no `has_deficiency`).
- **#1320** verification drill root-account concern — likely invalid
  (`mysql:8.0` creates `root@'%'` by default); noted for completeness.

---

## Verified as already fixed (excluded from the lists above)

Spot-checks that confirm the pipeline does absorb some findings: #1350 (fail-closed
API-key migration `20260812_0004`), #1329 (SW update race, CSP, injectRegister),
#1339 (schema test), #1330 (onboarding email/persist), #1265 (all 7 threads),
#1289 (all 9), #1264, #1263, #1319's 1×1 preset, #1316's paper-voter counting
(superseded by #1341's approach — whose own review findings are Tier 1.4),
#1233's deferred prerequisites (#1235), #1241/#1238's guest check-in contract
gaps (#1239), #1216's duplicate-JWT 500, #1220's roster exposure (#1222),
#1209's kanban truncation (#1213).
