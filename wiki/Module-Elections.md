# Elections Module

The Elections module provides a complete election management system with ranked-choice voting, audit logging, and ballot forensics.

---

## Key Features

- **Ranked-Choice Voting** — Members rank candidates by preference; automatic runoff rounds
- **Multiple Election Types** — Officer elections, bylaw votes, membership approvals
- **Ballot Forensics** — Tamper-proof audit trail for every ballot cast
- **Election Packages** — Auto-generated from prospective member pipeline stages
- **Voting Eligibility** — Based on membership type, meeting attendance, and membership tier rules — enforced both when ballots are issued and when votes are submitted
- **Secret Ballots** — Anonymous voting via per-election salted voter hashes (no voter ID stored on votes); voters receive a cryptographic receipt they can verify without revealing their choice
- **Real-Time Results** — Live tallying with round-by-round breakdowns
- **Audit Logging** — Complete trail of election creation, voting, and result certification
- **Meeting Link** — Elections can be linked to formal meeting records for procedural compliance
- **Voter Overrides** — Secretary can grant voting eligibility overrides for individual members
- **Proxy Voting** — Proxy voting authorization management for absent members
- **Ballot-Item Elections** — Support for elections with only ballot items (approval votes, resolutions) and no candidates

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/elections` | Elections List | Authenticated |
| `/elections/:id` | Election Detail | Authenticated |
| `/elections/settings` | Election Settings | `elections.manage` |
| `/ballot` | Ballot Voting | Public (token-based, rate-limited) |

---

## Workflow

1. **Create Election** — Set title, type, candidates, voting period, eligibility rules, and optionally link to a meeting record
2. **Open Voting** — Members receive ballot access via in-app notification or email link (ballot-item-only elections supported)
3. **Cast Ballots** — Members rank candidates (ranked-choice) or vote yes/no
4. **Close Voting** — Automatically at the scheduled end time or manually by admin
5. **Certify Results** — Admin reviews results, round-by-round tallies, and certifies the outcome
6. **Archive** — Election and all ballots are preserved for audit

---

## Voter Eligibility

Voter eligibility for each ballot item is determined by the member's **membership type** (`User.membership_type`), not by their assigned roles/positions. A member may hold multiple roles (e.g. EMT on the operational side and Quartermaster on the administrative side), but their membership type is a single classification that controls which ballot items they can vote on.

### Membership Type vs Roles

| Concept | Field | Purpose | Example |
|---------|-------|---------|---------|
| **Membership Type** | `User.membership_type` | Department classification; determines ballot eligibility | Active, Administrative, Life, Probationary |
| **Role / Position** | `User.roles` | Assigned positions; determines system permissions | EMT, Quartermaster, Secretary, Chief |

A member's role (e.g. EMT) does **not** make them eligible for "operational" ballot items. Their membership type (e.g. "active") does.

### Eligible Voter Types

Each ballot item has an `eligible_voter_types` field that controls who can vote on it. These map to membership types:

| Voter Type | Eligible Membership Types | Use Case |
|------------|--------------------------|----------|
| `all` | Everyone | General resolutions, budget votes |
| `operational` | Active | Operational officer elections (Chief, Captain, etc.) |
| `administrative` | Administrative | Administrative-specific votes |
| `regular` | Active + Life | Bylaw amendments, membership approvals |
| `life` | Life | Life-member-only votes |
| `probationary` | Probationary | Probationary-specific votes |
| *(role slug)* | *(any member holding that role)* | Fine-grained restrictions by specific position |

Specific role slugs (e.g. `chief`, `secretary`) can also be used as a fallback for niche eligibility rules that go beyond membership type.

### Additional Eligibility Checks

Beyond membership type, a member may also be restricted by:

- **Membership tier rules** — Organization settings can mark certain tiers as not voting-eligible or require minimum meeting attendance percentages
- **Attendance requirement** — Individual ballot items can require the voter to be checked in as present at the meeting
- **Secretary overrides** — The secretary can grant eligibility overrides for individual members, bypassing all other checks

---

## API Endpoints

```
GET    /api/v1/elections                     # List elections
POST   /api/v1/elections                     # Create election
GET    /api/v1/elections/{id}                # Get election details
PATCH  /api/v1/elections/{id}                # Update election (field allowlist varies by status)
DELETE /api/v1/elections/{id}                # Delete election (reason required)
POST   /api/v1/elections/{id}/open           # Open voting
POST   /api/v1/elections/{id}/close          # Close voting (evaluates runoff conditions)
POST   /api/v1/elections/{id}/rollback       # Roll back status (guarded — see below)
POST   /api/v1/elections/{id}/vote           # Cast a single vote (authenticated)
POST   /api/v1/elections/{id}/vote/bulk      # Cast votes atomically (approval/ranked/multi-position)
GET    /api/v1/elections/{id}/eligibility    # Check current user's eligibility
GET    /api/v1/elections/{id}/results        # Get results (visibility-gated)
GET    /api/v1/elections/{id}/stats          # Ballot counts / turnout (manage)
GET    /api/v1/elections/{id}/non-voters     # Eligible voters who haven't voted (manage)
POST   /api/v1/elections/{id}/send-ballot    # Email ballots with unique voting tokens
POST   /api/v1/elections/{id}/send-test-ballot  # Send a test ballot to yourself (votes excluded from results)
POST   /api/v1/elections/{id}/send-report    # Email election results report
GET    /api/v1/elections/{id}/package-recipients  # Prefill list for the pre-meeting package (manage)
GET    /api/v1/elections/{id}/package-pdf    # Download pre-meeting package PDF (manage; variant=member|full)
POST   /api/v1/elections/{id}/send-package   # Email pre-meeting package to an edited address list (manage)
GET    /api/v1/elections/{id}/preview-ballot # Preview a member's ballot (manage)
GET    /api/v1/elections/{id}/verify-receipt # Verify a vote receipt (public, rate-limited)
GET    /api/v1/elections/{id}/integrity      # Verify vote signatures (manage)
GET    /api/v1/elections/{id}/forensics      # Full forensic report (manage)
GET    /api/v1/elections/{id}/attendees      # List meeting check-ins
POST   /api/v1/elections/{id}/attendees      # Check in an attendee (manage)
POST   /api/v1/elections/{id}/import-meeting-attendees  # Import check-ins from linked meeting/event
GET    /api/v1/elections/{id}/voter-overrides   # Get voter overrides (manage)
POST   /api/v1/elections/{id}/voter-overrides   # Grant voter override (manage)
POST   /api/v1/elections/{id}/proxy-authorizations  # Authorize a proxy (manage)
GET    /api/v1/elections/{id}/proxy-authorizations  # List proxy authorizations (manage)
POST   /api/v1/elections/{id}/proxy-vote        # Cast a vote as an authorized proxy
GET    /api/v1/elections/settings               # Get election settings (proxy voting config)
PATCH  /api/v1/elections/settings               # Update election settings
GET    /api/v1/elections/{id}/eligibility-roster  # Full eligibility breakdown for secretary

# Public token-ballot endpoints (no auth, rate-limited; the token always
# travels in the POST body — never a query string or path — so the live
# credential stays out of server/proxy logs)
POST   /api/v1/elections/ballot/lookup       # Load ballot + candidates in one call (minimal view; items, positions, and candidates filtered to the voter's eligibility snapshots)
POST   /api/v1/elections/ballot/vote         # Cast one vote (method-aware: accepts vote_rank for ranked-choice; approval allows one vote per candidate)
POST   /api/v1/elections/ballot/vote/bulk    # Submit full ballot atomically (single choice, candidate_ids multi-select, or rankings per item)
```

---

## Pre-Meeting Package (2026-07-28)

Secretaries can generate and distribute a **pre-meeting package** for annual
and special meetings — a print-ready PDF containing the linked meeting's
details and agenda, the election configuration (voting method, victory
condition, quorum, proxy availability, runoffs), a full ballot preview with
candidates and statements, and the voter-eligibility roster.

- **Two privacy variants**: the *member* variant lists eligible voters and
  counts only; the *full* variant (leadership) adds per-member ineligibility
  reasons and granted overrides. Membership-tier and attendance details are
  never broadcast to the general membership
- **Editable recipients**: the send modal prefills from leadership or the
  eligible-voter roster, and the secretary edits the list freely — remove
  anyone, add outside addresses (e.g. board counsel). Recipients are BCC'd
- **Download-only flow**: the PDF can be downloaded directly (no email) and
  attached to the secretary's own communication or filed with the minutes
- Available for draft and open elections from the Communication section of
  the election detail page; sends and downloads are audit-logged
  (`pre_meeting_package_sent` / `pre_meeting_package_downloaded`)

---

## Recent Improvements (2026-07-28)

### Security & Correctness Review — Eligibility Enforcement, Runoffs, Multi-Vote Methods

A full security review of the module (see `docs/module-audit/elections.md`,
findings R-1…R-10) fixed the following. Migration `20260730_0001` adds
`voting_tokens.is_test` and `voting_tokens.eligible_item_ids`.

- **Per-item eligibility enforced at vote submission**: Ballot-item restrictions (`eligible_voter_types`, `require_attendance`) were previously checked only when ballot emails were sent — a token holder could vote on restricted items by submitting their ids. The eligible item set is now snapshotted on each voting token at issue time and enforced when the ballot is submitted; the public ballot endpoint also only returns the items the voter may vote on. The authenticated vote path now runs the same per-position/per-item checks
- **Public ballot response minimized**: the token ballot lookup previously returned the full election record — attendee names, eligible-voter lists, email recipients — to any ballot-link holder. It now returns a minimal ballot view with no roster/PII fields
- **Test ballots are excluded from results**: "Send test ballot" now issues a flagged token; votes cast with it are stored `is_test`, excluded from results/stats/rosters, and never consume the sender's real vote
- **Runoffs trigger on early close**: Closing an election before its scheduled end date (the normal end-of-meeting flow) previously skipped runoff creation silently; runoff conditions are now evaluated on every close
- **Approval & ranked-choice voting fixed**: Both methods were rejected at the vote-dedup layer (any second vote collided) and the UI submitted votes non-atomically. Votes now carry a method-aware dedup discriminator, duplicate rules are per-candidate/per-rank, and the ballot UI submits all approvals/rankings in one atomic bulk call
- **Rollback guard**: Reopening a closed anonymous election that has votes is refused once the anonymity salt is destroyed (reopening would let prior voters vote again undetected). Rollback with zero votes still works
- **Quorum counts only voting-eligible members**: Turnout/quorum denominators exclude membership tiers marked not voting-eligible (a percentage quorum could previously fail even with 100% eligible turnout); secretary-override members are counted back in
- **Vote receipts delivered**: Ballot submission responses now include receipt hashes, making the public `verify-receipt` endpoint usable end-to-end
- **Ballot preview matches reality**: The secretary's preview-ballot now uses the same eligibility logic as the real ballot filter (shared `annotate_ballot_items_for_user`) instead of a hand-rolled comparison that could disagree
- **Attendance can't be forged at creation**: `attendees` removed from the election create payload; check-ins must go through the audited attendee endpoints
- **Frontend fixes**: Non-managers no longer see a blank election detail page; `/elections/settings` route is permission-gated; exact candidate↔ballot-item matching ("Chief" no longer matches "Assistant Chief" items); election list responses excluded from the API cache
- **Runoffs inherit the parent's rule set with a fresh salt** *(follow-up)*: auto-created runoffs previously dropped quorum, position eligibility, the meeting/event link, attendees, and voter overrides — and anonymous runoffs had **no anonymity salt** (voter hashes keyed with an empty string were pre-computable from user ids). Runoffs now inherit the rules and generate their own salt
- **Same-meeting runoffs work in one click** *(follow-up)*: opening an election clamps a future start date to the open time (audited as `start_adjusted_to_open_time`), an election whose end date already passed can't be opened, and draft elections gained an **Edit Dates** modal (Start Now, 15-min/30-min/1-hour/1-day quick durations)
- **Voting tokens hashed at rest** *(follow-up, ELEC-5)*: only SHA-256 hashes are stored; the raw token exists solely in the emailed ballot link (migration `20260731_0001` hashes existing rows in place — old links keep working)
- **IP metadata purged at close** *(follow-up, ELEC-6)*: anonymous elections erase per-vote IP/user-agent when closed, and the forensics report returns a thresholded suspicious-IP set (`suspicious_ips`, `unique_ip_count`, `ip_metadata_purged`) instead of the full per-IP vote map
- **Cloudflare email attachments** *(follow-up)*: the pre-meeting package PDF now attaches on the Cloudflare email backend too (base64 API attachments, 5 MiB cap with skip-and-warn)
- **Ballot tokens never appear in URLs** *(follow-up, R-D3, 2026-07-29)*: the emailed link now carries the token in the URL **fragment** (`/ballot#token=…` — browsers never send fragments to any server), the voting page scrubs it from the address bar after capture, and the two GET read endpoints were replaced by `POST /elections/ballot/lookup` with the token in the body. Links emailed before the change (`?token=`) keep working until those tokens expire
- **Position eligibility enforced for token ballots** *(follow-up, R-D4, 2026-07-29)*: positional elections' `position_eligibility` rules now apply to email-token voters too — eligible positions are snapshotted on the token at send time (`eligible_positions`, migration `20260801_0001`), enforced at vote time, and used to filter the positions/candidates the ballot page shows. Members eligible for no position are skipped at send time with a reason
- **Method-aware token voting** *(follow-up, R-D5, 2026-07-29)*: approval and ranked-choice elections now work end-to-end by email ballot — the ballot page renders checkbox multi-select (approval / multi-vote) and per-candidate rank selects (ranked choice), submitted as `candidate_ids` / `rankings` on the bulk endpoint; the single-vote token endpoint mirrors the authenticated path's per-candidate/per-rank duplicate rules
- **Anonymous elections keep voter IPs out of the audit log** *(follow-up, ELEC-6 residual, 2026-07-29)*: voter-action audit events no longer record an IP for anonymous elections (audit rows are hash-chained and can never be scrubbed, so this had to be a write-time fix; rows written earlier keep their IPs)

### Edge Cases (2026-07-28)

| Scenario | Behavior |
|----------|----------|
| Token vote on an item the voter isn't eligible for | Rejected with the item title in the error; abstaining on it is allowed |
| Legacy token issued before the migration | No item snapshot (`NULL`) — unrestricted, bounded by token expiry |
| Test ballot vote followed by the sender's real vote | Both succeed; only the real vote counts |
| Election closed before its end date with no winner | Runoff still created (when runoffs enabled) |
| Approval voter approves two candidates for one position | Both votes recorded; duplicate candidate rejected |
| Ranked-choice voter submits ranks 1–3 | All recorded atomically; duplicate rank or candidate rejected |
| Reopen closed anonymous election with votes | Refused — create a new election instead |
| Positionless token vote after an unrelated positioned vote | No longer blocked (filter previously degraded to a no-op) |
| Runoff created from a quorum/position-restricted election | Inherits quorum, position eligibility, meeting/event link, attendees, and overrides — with a **fresh** anonymity salt of its own |
| Runoff opened at the meeting (default start is +1h) | Opening clamps a future start to "now" — voting works immediately; draft dates are also editable via the new **Edit Dates** modal |
| Opening an election whose end date already passed | Refused — update the dates first |
| Token holder votes for a position their membership type can't vote for | Rejected ("You are not eligible to vote for …") — omitting the position field can't bypass it (falls back to the candidate's position) |
| Token restricted to one position casts that vote | Token marked fully used, even though the election has more positions |
| Approval election by email ballot | Voter checks every candidate they support; one vote per checked candidate, duplicate candidate rejected |
| Ranked-choice election by email ballot | Voter assigns unique ranks per candidate; submission order defines rank 1..n |
| Old `?token=` ballot link (emailed before the fragment change) | Still works — the page falls back to the query string, then scrubs the URL |

---

## Recent Improvements (2026-03-19)

### Hardening, Audit Logging & Email Improvements

- **Comprehensive audit logging**: All election state changes (create, open, close, certify, cancel, extend, rollback) now generate audit log entries with actor, action, and metadata
- **Response model standardization**: All election response schemas use `UTCResponseBase` for consistent datetime serialization with UTC timezone markers. Added missing `quorum_required` and `quorum_met` fields
- **Race condition fixes**: Proxy authorization and vote casting now use database-level locking to prevent concurrent modification. Cross-tenant data access blocked with `organization_id` filtering
- **JSON column mutation fixes**: Fixed `rollback_history` and attendee check-in not persisting due to in-place JSON mutation. Uses `copy.deepcopy()` pattern
- **Ballot sending reliability**: Fixed ballot emails silently returning 0 recipients — root cause was `User.is_active` property not queryable in SQLAlchemy filters; converted to `hybrid_property`. Added per-recipient exception handling and diagnostic logging
- **Eligibility summary email**: After dispatching ballots, the secretary receives a summary email listing skipped voters with reasons (no email, ineligible, already voted)
- **Secretary-facing error messages**: Election errors now include actionable details (e.g., "Election has no candidates" instead of generic "cannot open election")
- **Election report email**: Officers can email election results as a formatted report
- **Upcoming business meetings section**: Election detail page shows upcoming business meetings for linking elections to meeting records
- **Linked meetings filter**: Correctly shows only upcoming meetings (not past ones)
- **Extend modal date display fix**: Fixed incorrect date formatting in the election extension modal
- **Safe error handling**: All elections endpoints wrapped with `safe_error_detail()`
- **Empty string form value fix**: Optional election form fields use `||` instead of `??`

### API Endpoints — Election Report & Summary (2026-03-19)

```
POST   /api/v1/elections/{id}/send-report-email      # Email election results report
```

### Edge Cases (2026-03-19)

| Scenario | Behavior |
|----------|----------|
| Ballot email to recipient with no email | Skipped with reason logged; included in eligibility summary |
| One failed email in batch | Per-recipient exception handling; other recipients still receive |
| Proxy authorization cross-tenant | Blocked by `organization_id` filter — returns 404 |
| Rollback history mutation | Uses `copy.deepcopy()` before appending |
| Elections with only ballot items | Can be opened — `open_election` no longer requires candidates |
| Eligibility summary email | Sent only to the user who triggered ballot dispatch |
| No eligible voters found | Descriptive error instead of false success with 0 recipients |
| Concurrent vote attempts | Database-level locking prevents double-voting race conditions |

---

## Recent Improvements (2026-03-24)

### Secretary Workflow, Eligibility Roster, Enums & Result Publishing

- **Tabbed election detail workflow**: New `ElectionWorkflowTabs` component replaces monolithic detail page. Dynamic tabs based on election status: Ballot, Candidates, Eligibility, Overrides, Proxies (always visible when not cancelled), Attendance (draft/open), Cast Vote (open), Results (closed/published). WAI-ARIA Tabs pattern with roving tabindex
- **Eligibility roster**: New secretary tool (`EligibilityRoster` component) showing all active members with per-ballot-item eligibility. Color-coded rows: green (eligible), red (ineligible), blue (override), muted (voted). Search + filter buttons (All, Eligible, Ineligible, Already Voted, Has Override). Expandable per-member detail rows with keyboard navigation (Enter/Space)
- **Publish results panel**: `PublishResultsPanel` with one-click visibility toggle (`aria-pressed`), status overview (vote count, turnout %), and "Send Report" button for emailing results. Color-coded: green border (closed), blue border (open)
- **Runoff chain visualization**: `RunoffChain` component showing multi-stage elections as horizontal timeline. Each node: title, status, vote count, status icon. Current election highlighted with `aria-current="page"`. Builds chain by walking `parent_election_id`
- **Election summary cards**: 4-column dashboard on elections list page: Active Elections (green), Need Attention (amber, draft + expired), Completed (blue), Total Votes Cast (purple). Responsive 2→4 column grid
- **Election enums in constants**: `VotingMethod`, `VictoryCondition`, `BallotChoice`, `RunoffType`, `QuorumType` moved to `constants/enums.ts`. 50+ string literals replaced across 10+ frontend files
- **Backend validator deduplication**: 8 field validators consolidated into `_validate_choice()` helper. `VALID_QUORUM_TYPES` extracted as constant
- **Event type filter removed**: Elections can now link to any event type (not just business meetings)
- **Department email generation**: Auto-generates department email on prospect election/transfer. Four format patterns. Collision handling with numeric suffix. Personal email preserved

### New API Endpoints (2026-03-24)

```
GET    /api/v1/elections/{id}/eligibility-roster    # Full member eligibility breakdown for secretary
```

### New Frontend Components (2026-03-24)

| Component | Purpose |
|-----------|---------|
| `ElectionWorkflowTabs` | Tabbed navigation with dynamic tab visibility based on election status |
| `EligibilityRoster` | Secretary eligibility dashboard with search, filter, per-member detail |
| `PublishResultsPanel` | Post-election result publishing and report email |
| `RunoffChain` | Multi-stage election timeline visualization |
| `ElectionSummaryCards` | Dashboard metrics cards on elections list page |

### Edge Cases (2026-03-24)

| Scenario | Behavior |
|----------|----------|
| Election linked to non-business-meeting event | Now allowed (event type filter removed) |
| Department email collision | Appends numeric suffix (john.smith2@dept.org) |
| Cancelled election tabs | Only Ballot tab visible |
| Results tab auto-select | Navigates to Results when election is closed |
| Runoff chain for standalone election | Shows single-node chain |
| Eligibility roster with 0 members | Empty state with message |
| Secretary override on ineligible member | Blue row with override badge, eligible for all items |

---

## Recent Improvements (2026-03-22)

### Eligibility, Email Reliability & Meeting Integration

- **Eligibility uses membership_type**: Voter eligibility now correctly uses `User.membership_type` instead of role slugs. A member's role (e.g., EMT) does not make them eligible for operational ballot items — their membership type (e.g., "active") does
- **Email recipient tracking accuracy**: `email_recipients` now tracks only successfully sent ballots, not attempted sends
- **Linked meeting filter**: Meeting dropdown shows only upcoming business meetings, not past ones
- **Concurrent ballot sending**: Email dispatch uses concurrent sending with per-recipient error isolation
- **Eligibility summary email**: Secretary receives detailed summary after ballot dispatch (sent count, skipped voters with reasons)
- **Secretary-facing error messages**: Actionable guidance in error messages (e.g., "No active members with email addresses found")
- **Election report email**: New "Send Report Email" button on election detail page
- **Business meetings section**: Election detail page displays upcoming business meetings for procedural linking
- **Code quality sweep**: Module refactored — removed dead code, fixed unused state, standardized error handling

### API Endpoints (2026-03-22)

```
POST   /api/v1/elections/{id}/send-report-email      # Email election results report
```

### Edge Cases (2026-03-22)

| Scenario | Behavior |
|----------|----------|
| Member with role `emt` but membership_type `administrative` | Not eligible for `operational` ballot items |
| Email fails for one recipient in batch | Loop continues; summary shows per-recipient status |
| Election linked to past meeting | Past meetings filtered out of dropdown |
| No eligible voters after filtering | Descriptive error with reasons instead of false success |
| Membership type not set on member | Falls back to "all" eligibility only |

---

## Recent Improvements (2026-03-12)

- **Ballot email notifications**: Election creators can send ballot notification emails to eligible voters directly from the election detail page. Emails include election title, voting period, direct ballot link, and organization logo
- **Org logo in election emails**: All election-related emails (ballot notifications, result announcements) now include the organization's logo in the header using the shared `build_logo_html()` utility
- **Settings persistence fix**: Election settings (proxy voting config) now use `copy.deepcopy()` for JSON column mutations, fixing silent write failures

### API Endpoints — Ballot Notifications

```
POST   /api/v1/elections/{id}/send-ballot-emails   # Send ballot notification to eligible voters
```

---

## Recent Improvements (2026-03-06)

- **BallotBuilder redesigned**: Modern card-based UI with `@dnd-kit` drag-and-drop reordering, expandable inline editing, color-coded type badges (emerald/purple/blue), two-step inline delete, template popover, and summary pills
- **Ballot position matching fixed**: Template-created ballot items now include the `position` field. Preview and voting pages use position-based matching with title-based fallback for backward compatibility
- **One ballot item per position**: Position dropdowns only show unused positions with validation toast on duplicates
- **Ballot preview enhanced**: Shows meeting date, prospective member info cards on approval items, write-in input placeholders, security notice footer, and election configuration summary
- **Position dropdown from org ranks**: Position field loads operational ranks (Chief, Captain, etc.) with type-ahead filtering. Also added to candidate edit form
- **Write-in candidate auto-fill**: Checking "Write-in candidate" auto-fills name and clears linked member
- **Proxy voting settings**: Enable/disable toggle with max proxies per person in Election Settings
- **Election settings API fixed**: GET/PATCH endpoints return flat field names matching frontend expectations
- **Election integrity chain**: Ballot hash chaining and server-side voter eligibility enforcement

---

## Recent Fixes (2026-03-01)

- **Type errors and missing fields**: Fixed TypeScript type errors and added missing required fields across election pages
- **CSS visual fixes**: Resolved inconsistent indigo focus ring colors and unused variable lint errors on ElectionDetailPage
- **Code quality**: Improved code quality across election components

---

## Fixes (2026-02-27)

- **Election detail page fix**: Route param mismatch (`:id` vs `electionId`) caused the detail page to hang on loading; now correctly loads
- **Ballot-item elections**: `open_election` no longer requires candidates, allowing approval votes and resolutions to proceed
- **Close election errors**: Returns descriptive messages instead of misleading "Election not found" for wrong-status elections
- **Voter overrides API**: Frontend correctly handles `{ overrides: [...] }` response shape

---

---

## Event Attendee Import & Linked Elections (2026-03-24)

- **Import event attendees**: Officers can import checked-in attendees from a linked event into the election's ballot recipient list via the election detail page
- **Linked elections on event pages**: Event detail pages display linked elections with status badges and direct links to the election
- **Linked elections on minutes pages**: Meeting minutes detail pages show associated elections
- **Quick-link buttons**: Upcoming Meetings list on election detail shows quick-action buttons for meeting-to-election association
- **Removed redundant section**: Cleaned up duplicate Upcoming Meetings display

### API Endpoint

```
POST   /api/v1/elections/{id}/import-attendees   # Import event attendees into ballot list
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Event with no checked-in attendees | Returns empty list with informational message |
| Attendee already in ballot list | Skipped silently; count reflects only new additions |
| Election linked to cancelled event | Link preserved; event shows cancelled badge |

---

**See also:** [Prospective Members](Module-Prospective-Members) | [Role System](Role-System)
