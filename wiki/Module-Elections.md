# Elections Module

The Elections module provides a complete election management system with ranked-choice voting, audit logging, and ballot forensics.

---

## Key Features

- **Ranked-Choice Voting** — Members rank candidates by preference; automatic runoff rounds
- **Multiple Election Types** — Officer elections, bylaw votes, membership approvals
- **Ballot Forensics** — Tamper-proof audit trail for every ballot cast
- **Election Packages** — Auto-generated from prospective member pipeline stages
- **Voting Eligibility** — Based on membership type, meeting attendance, and membership tier rules
- **Secret Ballots** — Encrypted ballots with anonymous vote verification
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
| `/ballot` | Ballot Voting | Public (token-based) |

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
PATCH  /api/v1/elections/{id}                # Update election
POST   /api/v1/elections/{id}/vote           # Cast ballot
GET    /api/v1/elections/{id}/results        # Get results
POST   /api/v1/elections/{id}/certify        # Certify results
POST   /api/v1/election-packages             # Create election package
GET    /api/v1/elections/{id}/voter-overrides  # Get voter overrides
POST   /api/v1/elections/{id}/voter-overrides  # Grant voter override
GET    /api/v1/elections/{id}/proxy-votes      # Get proxy authorizations
POST   /api/v1/elections/{id}/proxy-votes      # Authorize proxy vote
GET    /api/v1/elections/settings               # Get election settings (proxy voting config)
PATCH  /api/v1/elections/settings               # Update election settings
```

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

**See also:** [Prospective Members](Module-Prospective-Members) | [Role System](Role-System)
