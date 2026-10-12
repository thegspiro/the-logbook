# Elections Module — Developer Reference

Routes, API endpoints, data model and frontend architecture for the
elections module. What the module does and how departments use it is on
[Elections Module](Module-Elections).

## Pages

| URL                      | Page              | Permission                                                    |
| ------------------------ | ----------------- | ------------------------------------------------------------- |
| `/elections`             | Elections List    | Authenticated, module enabled (API requires `elections.view`) |
| `/elections/:electionId` | Election Detail   | Authenticated, module enabled (API requires `elections.view`) |
| `/elections/settings`    | Election Settings | `elections.manage`                                            |
| `/ballot`                | Ballot Voting     | Public (token-based, rate-limited)                            |

The elections list shows four summary cards — **Active Elections**, **Need
Attention** (drafts and overdue elections), **Completed** and **Total Votes
Cast** — above the election cards. A card for an election closed early shows
the real close time (`closed_at`), not the scheduled end.

### Election Detail Tabs

`/elections/:electionId?tab=<id>` addresses each workflow tab. The active tab
is derived from the URL (tab changes use `replace`, so Back leaves the page
rather than stepping through tabs); an unknown or currently hidden value falls
back to the first tab the viewer may see.

| `?tab=`       | Label        | Visible to                                         |
| ------------- | ------------ | -------------------------------------------------- |
| `ballot`      | Ballot       | Managers, unless cancelled                         |
| `nominations` | Nominations  | Everyone during nominations; managers in draft     |
| `candidates`  | Candidates   | Managers                                           |
| `eligibility` | Eligibility  | Managers, unless cancelled                         |
| `attendance`  | Attendance   | Managers, in draft, nominations or open            |
| `overrides`   | Overrides    | Managers, unless cancelled                         |
| `proxies`     | Proxy Voting | Managers, unless cancelled                         |
| `voting`      | Cast Vote    | Everyone, while open                               |
| `results`     | Results      | Closed elections, or `results_visible_immediately` |

The tabs follow the WAI-ARIA Tabs pattern: arrow keys, Home and End move
between tabs, and each `tabpanel` is labelled by its tab. The lifecycle
stepper is a named list with `aria-current="step"` on the current stage.

### Ballot Voting Page (`/ballot`)

The emailed link carries the token in the URL **fragment**
(`/ballot#token=…`), which browsers never send to a server. The page captures
the token, scrubs it from the address bar, and loads the ballot with one
`POST /elections/ballot/lookup` call. A `?token=` query string is also
accepted. Approval and multi-vote items render as checkboxes, ranked-choice
items as per-candidate rank selects; a confirmation modal summarises every
choice before the ballot is submitted atomically. A test ballot shows a
**TEST BALLOT** banner.

---

## API Endpoints

All paths are under `/api/v1`. "manage" means `elections.manage`; "view"
means `elections.view`; "auth" means any signed-in member.

```
# Elections
GET    /elections                                   # List elections (view; includes closed_at)
POST   /elections                                   # Create election (manage)
GET    /elections/{id}                              # Get election details (view)
PATCH  /elections/{id}                              # Update election; field allowlist varies by status (manage)
DELETE /elections/{id}                              # Delete election; reason required unless draft (manage)
POST   /elections/{id}/open                         # Open voting (manage)
POST   /elections/{id}/close                        # Close voting; evaluates runoffs (manage)
POST   /elections/{id}/rollback                     # Roll back status, guarded (manage)
POST   /elections/{id}/clone                        # Fresh draft from this election's setup (manage)
GET    /elections/settings                          # Election settings: proxy voting, features (manage)
PATCH  /elections/settings                          # Update election settings (manage)

# Ballot building
GET    /elections/templates/ballot-items            # Built-in ballot item templates (manage)
GET    /elections/templates/saved-ballots           # List the org's saved templates (manage)
POST   /elections/templates/saved-ballots           # Save a ballot as a template; 409 on duplicate name (manage)
DELETE /elections/templates/saved-ballots/{template_id}  # Delete a saved template; 404 if not in org (manage)
GET    /elections/{id}/preview-ballot               # Preview a member's ballot (manage)
GET    /elections/{id}/printable-ballot             # Official blank paper ballot PDF (manage)

# Candidates and nominations
GET    /elections/{id}/candidates                   # List candidates; pending only in nominations or for managers (view)
POST   /elections/{id}/candidates                   # Add candidate (manage)
PATCH  /elections/{id}/candidates/{cid}             # Update candidate (manage)
DELETE /elections/{id}/candidates/{cid}             # Remove candidate (manage)
POST   /elections/{id}/write-ins/merge              # Consolidate write-in variants (manage)
POST   /elections/{id}/open-nominations             # Draft -> nomination phase (manage)
POST   /elections/{id}/close-nominations            # Nomination phase -> draft (manage)
POST   /elections/{id}/nominations                  # Nominate a member or yourself (view)
POST   /elections/{id}/nominations/{cid}/accept     # Nominee accepts (view)
POST   /elections/{id}/nominations/{cid}/decline    # Nominee declines; entry removed (view)

# Voting (in-app)
GET    /elections/{id}/eligibility                  # Current user's eligibility (auth)
GET    /elections/{id}/ballot                       # In-app ballot; ?proxy_authorization_id= for a proxy ballot (auth)
POST   /elections/{id}/ballot                       # Cast the in-app or proxy ballot atomically (auth)
GET    /elections/{id}/ballot/proxies               # Proxies the current member holds, named elections only (auth)
POST   /elections/{id}/vote                         # Cast a single vote (auth)
POST   /elections/{id}/vote/bulk                    # Cast votes atomically (auth)
POST   /elections/{id}/proxy-vote                   # Cast a vote as an authorized proxy (auth)
POST   /elections/{id}/verify-receipt               # Verify a receipt, {"receipt": …} in the body (public, rate-limited)
GET    /elections/{id}/verify-receipt               # Deprecated ?receipt= form (public, rate-limited)

# Public token ballot (no auth, rate-limited; the token always travels in
# the POST body — never a query string or path)
POST   /elections/ballot/lookup                     # Ballot + candidates, filtered to the token's eligibility snapshots
POST   /elections/ballot/vote                       # Cast one vote (method-aware)
POST   /elections/ballot/vote/bulk                  # Submit full ballot atomically (single choice, candidate_ids, or rankings)

# Results, reports and integrity
GET    /elections/{id}/results                      # Results, visibility-gated (view)
GET    /elections/{id}/stats                        # Ballot counts / turnout (manage)
GET    /elections/{id}/certified-results            # Certified results PDF, closed only (manage)
POST   /elections/{id}/send-report                  # Email results report, closed only (manage)
GET    /elections/{id}/integrity                    # Verify vote signatures (manage)
GET    /elections/{id}/forensics                    # Forensic report (manage)
DELETE /elections/{id}/votes/{vote_id}              # Void a vote; ?reason= 3-500 chars (manage)

# Ballot email and communication
POST   /elections/{id}/send-ballot                  # Email ballots with unique tokens; open elections only (manage)
POST   /elections/{id}/send-test-ballot             # Test ballot to yourself; excluded from results (manage)
GET    /elections/{id}/non-voters                   # Eligible voters who haven't voted (manage)
POST   /elections/{id}/remind-non-voters            # Reminder with fresh link to non-voters only (manage)
GET    /elections/{id}/package-recipients           # Prefill list for the pre-meeting package (manage)
GET    /elections/{id}/package-pdf                  # Pre-meeting package PDF; variant=member|full (manage)
POST   /elections/{id}/send-package                 # Email pre-meeting package to an edited address list (manage)

# Paper ballots
POST   /elections/{id}/manual-ballots               # Record an in-room paper tally (manage)
GET    /elections/{id}/manual-ballots               # List paper batches with attestation trail (manage)
POST   /elections/{id}/manual-ballots/{batch}/attest  # Attest a batch's count; not the recorder (manage)
POST   /elections/{id}/manual-ballots/{batch}/void    # Void a mis-keyed batch (manage)

# Eligibility, attendance, overrides and proxies
GET    /elections/{id}/eligibility-roster           # Full eligibility breakdown for the secretary (manage)
GET    /elections/{id}/attendees                    # List meeting check-ins (view)
POST   /elections/{id}/attendees                    # Check in an attendee (manage)
DELETE /elections/{id}/attendees/{user_id}          # Remove a check-in (manage)
POST   /elections/{id}/import-meeting-attendees     # Import check-ins from the linked meeting or event (manage)
GET    /elections/{id}/voter-overrides              # List voter overrides (manage)
POST   /elections/{id}/voter-overrides              # Grant a voter override (manage)
POST   /elections/{id}/voter-overrides/bulk         # Grant overrides in bulk (manage)
DELETE /elections/{id}/voter-overrides/{user_id}    # Remove an override (manage)
GET    /elections/{id}/proxy-authorizations         # List proxy authorizations (manage)
POST   /elections/{id}/proxy-authorizations         # Authorize a proxy (manage)
DELETE /elections/{id}/proxy-authorizations/{authorization_id}  # Revoke a proxy (manage)
```

Related endpoints in other modules:

```
GET    /prospective-members/prospects/{id}/election-package  # prospective_members.view|manage or elections.manage
GET    /prospective-members/election-packages                # prospective_members.view|manage or elections.manage
GET    /meetings/attendance/dashboard                        # Secretary attendance dashboard (shares the attendance window)
```

---

## Data Model

Models live in `backend/app/models/election.py`; schemas in
`backend/app/schemas/election.py`; business logic in
`backend/app/services/election_service.py`.

| Model                     | Table                        | Purpose                                                                                                      |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Election`                | `elections`                  | The election: type, positions, `ballot_items`, `position_eligibility`, dates, status, rules, runoff links    |
| `Candidate`               | `candidates`                 | A candidate or nominee; `accepted`, `is_write_in`, `merged_into_candidate_id`, `statement`                   |
| `VotingToken`             | `voting_tokens`              | Hashed ballot token with `voter_hash`, `is_test`, `eligible_item_ids`, `eligible_positions`, `superseded_at` |
| `Vote`                    | `votes`                      | One vote row: `candidate_id`, `position`, `vote_rank`, signature, chain/receipt hashes, `vote_dedup_hash`    |
| `ManualBallotBatch`       | `manual_ballot_batches`      | A paper-tally batch: `status`, `required_attestations`, `ballots_cast`, void fields                          |
| `ManualBallotAttestation` | `manual_ballot_attestations` | One officer's attestation of a batch                                                                         |
| `SavedBallotTemplate`     | `saved_ballot_templates`     | Org-scoped reusable ballot structure; `name_key` for case-insensitive uniqueness                             |

Notable `Election` columns:

| Column                                                                                                         | Purpose                                               |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `status`                                                                                                       | `draft`, `nominations`, `open`, `closed`, `cancelled` |
| `voting_method`, `victory_condition`, `victory_threshold`, `victory_percentage`                                | How winners are decided                               |
| `max_votes_per_position`, `seats_per_position`, `tie_policy`                                                   | Multi-vote, multi-seat and tie rules                  |
| `anonymous_voting`, `voter_anonymity_salt`                                                                     | Secret ballot; salt destroyed at close                |
| `eligible_voters`, `eligible_roster_snapshot`                                                                  | Restricted voter list; roll frozen at open            |
| `attendees`, `voter_overrides`, `proxy_authorizations`                                                         | JSON lists managed through their endpoints            |
| `quorum_type`, `quorum_value`                                                                                  | Quorum rule                                           |
| `enable_runoffs`, `runoff_type`, `max_runoff_rounds`, `is_runoff`, `parent_election_id`, `runoff_round`        | Runoff chain                                          |
| `meeting_id`, `event_id`, `meeting_date`                                                                       | Meeting or event link                                 |
| `auto_open`, `reminder_hours_before_close`, `reminder_sent_at`, `nomination_deadline`, `nominations_closed_at` | Lifecycle automation                                  |
| `email_sent`, `email_sent_at`, `email_recipients`, `email_skipped_details`                                     | Ballot send record                                    |
| `closed_at`, `closed_by`                                                                                       | Actual close time and actor                           |
| `results_visible_immediately`, `results_revisions`                                                             | Results visibility and post-close revisions           |
| `last_chain_hash`, `rollback_history`                                                                          | Integrity chain head and rollback log                 |

`Vote` also records `is_test`, `is_manual` / `recorded_by` / `manual_batch_id`
for paper votes, `is_proxy_vote` / `proxy_voter_id` /
`proxy_authorization_id` / `proxy_delegating_user_id` for proxy votes,
`ip_address` / `user_agent` (purged at close on anonymous elections), and
soft-delete fields `deleted_at` / `deleted_by` / `deletion_reason`.

---

## Frontend Architecture

| Location                          | Contents                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `modules/elections/routes.tsx`    | `getElectionsRoutes()` (protected) and `getElectionsPublicRoutes()` (`/ballot`) |
| `pages/ElectionsPage.tsx`         | List, summary cards and create form                                             |
| `pages/ElectionDetailPage.tsx`    | Detail page, workflow tabs, panels and modals                                   |
| `pages/ElectionsSettingsPage.tsx` | Election Settings, rendered through `SettingsLayout`                            |
| `pages/BallotVotingPage.tsx`      | Public token ballot                                                             |
| `services/electionService.ts`     | API client for every elections endpoint                                         |
| `types/election.ts`               | Election, ballot, candidate and result types                                    |
| `utils/electionHelpers.ts`        | `getVictoryDescription` and other display helpers                               |
| `utils/electionForensics.ts`      | Forensics report formatting                                                     |
| `constants/enums.ts`              | `VotingMethod`, `VictoryCondition`, `BallotChoice`, `RunoffType`, `QuorumType`  |

Module components (`modules/elections/components/`):

| Component              | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `ElectionWorkflowTabs` | Tabbed navigation with tab visibility based on status and permission   |
| `EligibilityRoster`    | Secretary eligibility dashboard with search, filter, per-member detail |
| `PublishResultsPanel`  | Result publishing and report email                                     |
| `RunoffChain`          | Multi-stage election timeline                                          |
| `ElectionSummaryCards` | Metrics cards on the elections list page                               |

Shared components (`components/`): `BallotBuilder`, `CandidateManagement`,
`ElectionBallot` (in-app ballot), `ElectionResults`, `MeetingAttendance`,
`VoterOverrideManagement`, `VerifyReceipt`, and `ballot/` (`BallotItemCard`,
`ballotChoices`, `useBallotChoices`, shared by the in-app and token ballots).

Detail-page panels and modals (`components/election-detail/`):
`BallotPreviewModal`, `CloneElectionModal`, `DeleteElectionModal`,
`EditDatesModal`, `ElectionCloseStamp`, `ExtendElectionModal`,
`LiveTurnoutPanel`, `MergeWriteInsModal`, `NominationsPanel`,
`PaperBallotBatchesPanel`, `PreMeetingPackageModal`,
`RecordPaperBallotsModal`, `RemindNonVotersModal`, `RollbackElectionModal`,
`SendBallotEmailsModal`.

---
