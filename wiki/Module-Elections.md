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

| URL                   | Page              | Permission                         |
| --------------------- | ----------------- | ---------------------------------- |
| `/elections`          | Elections List    | Authenticated                      |
| `/elections/:id`      | Election Detail   | Authenticated                      |
| `/elections/settings` | Election Settings | `elections.manage`                 |
| `/ballot`             | Ballot Voting     | Public (token-based, rate-limited) |

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

Voter eligibility for each ballot item is determined by the member's **standing**, not by their assigned roles/positions. A member may hold multiple roles (e.g. EMT on the operational side and Quartermaster on the administrative side), but their standing is what controls which ballot items they can vote on.

### Standing is two fields, not one _(changed 2026-08-26)_

Eligibility used to read `User.membership_type`, a single column that conflated two independent facts. It now reads the pair that replaced it:

| Concept             | Field                  | Purpose                                                                  | Example                                                             |
| ------------------- | ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| **Member class**    | `User.member_class`    | What kind of member somebody is; decides `operational` eligibility       | operational, administrative, social                                 |
| **Member status**   | `User.member_status`   | Where they sit on the membership ladder; decides `life` / `probationary` | prospective, probationary, regular, life, retired, honorary, junior |
| **Membership type** | `User.membership_type` | Legacy single classification, now **derived** from the pair              | active, administrative, life, probationary                          |
| **Role / Position** | `User.roles`           | Assigned positions; determines system permissions                        | EMT, Quartermaster, Secretary, Chief                                |

**What each built-in category requires**, per `ElectionService._user_has_role_type`:

| Category         | Requires                                        |
| ---------------- | ----------------------------------------------- |
| `operational`    | operational class **and** regular status        |
| `regular`        | operational class **and** (regular **or** life) |
| `life`           | operational class **and** life status           |
| `probationary`   | operational class **and** probationary status   |
| `administrative` | administrative class                            |
| `social`         | social class                                    |

**The built-in categories keep their legacy meaning**, deliberately. An earlier
version of this change had `operational` read the class alone; that was
reverted the same day (`f65e4e7ae`) because it admitted probationary and
retired members to a restricted ballot.

The real changes are narrower than the split first appears, and one of them is
a **tightening**:

- **A life member now receives a `regular` ballot.** With one fused field,
  `life` and `regular` were mutually exclusive values, so a life member could
  not satisfy `regular`.
- **Every status category now also requires the operational class.** An
  administrative member with regular standing no longer receives ballots
  restricted to active/life members.
- `administrative` and `social` are answered by class rather than by a single
  value that had to carry both facts at once.

`ElectionService` falls back to deriving the pair from `membership_type` when the new columns are unset, so a member whose record predates the change is still evaluated correctly.

A member's role (e.g. EMT) does **not** make them eligible for "operational" ballot items. Their member class does.

### Eligible Voter Types

Each ballot item has an `eligible_voter_types` field that controls who can vote on it. These map to membership types:

| Voter Type       | Eligible Membership Types        | Use Case                                             |
| ---------------- | -------------------------------- | ---------------------------------------------------- |
| `all`            | Everyone                         | General resolutions, budget votes                    |
| `operational`    | Active                           | Operational officer elections (Chief, Captain, etc.) |
| `administrative` | Administrative                   | Administrative-specific votes                        |
| `regular`        | Active + Life                    | Bylaw amendments, membership approvals               |
| `life`           | Life                             | Life-member-only votes                               |
| `probationary`   | Probationary                     | Probationary-specific votes                          |
| _(role slug)_    | _(any member holding that role)_ | Fine-grained restrictions by specific position       |

Specific role slugs (e.g. `chief`, `secretary`) can also be used as a fallback for niche eligibility rules that go beyond membership type.

### Additional Eligibility Checks

Beyond membership type, a member may also be restricted by:

- **Membership tier rules** — Organization settings can mark certain tiers as not voting-eligible or require minimum meeting attendance percentages. _(2026-09-29)_ The attendance window runs from the later of `voting_attendance_period_months` ago (calendar months) and the start of the member's current stint (latest `MemberServicePeriod`, else `hire_date`) to the department's today — see [below](#voting-attendance-window-2026-09-29)
- **Attendance requirement** — Individual ballot items can require the voter to be checked in as present at the meeting. The roll is frozen at open, so a member checked in after opening is recorded present but cannot vote without an override
- **Secretary overrides** — The secretary can grant eligibility overrides for individual members (chosen by name on the **Overrides** tab since 2026-09-30), bypassing tier, attendance and role checks. **Not** a specific `eligible_voters` list: an override for someone off the list is stored and counted in the eligible denominator, yet their vote is still refused — open owner decision (W50-13)

---

## Per-Department Feature Toggles (2026-07-29)

Election Settings → **Features** lets each department turn optional
workflows on or off (all ON by default; stored in
`org.settings.election_features`; enforced in the service layer, hidden
in the UI):

- `nominations_enabled` — nomination phase and member nominations
- `paper_ballots_enabled` — officer paper-tally entry
- `reminders_enabled` — manual and automatic non-voter reminders
- `auto_open_enabled` — scheduled opening of flagged drafts
- `paper_ballot_attestations_required` — officers (besides the recorder)
  who must confirm each paper batch before it counts (0–3, default **2**)

Not toggleable by design: automatic closing at `end_date` and the
nomination-deadline auto-close. Closing finalizes results and runs the
anonymous-election IP/salt purge — a privacy guarantee, not a
convenience — and an in-flight nomination phase must always be closeable.

**Pending-nomination visibility** _(2026-08-16)_: the member-facing
candidate list (`GET /elections/{id}/candidates`) returns pending
(unaccepted) nominations only while the election is in its nominations
phase — so nominees can see and respond to their nomination. In every
other phase, members see accepted candidates only; callers holding
`elections.manage` always see the full list. Pending nominations outside
that window are election-management records, not member-visible data.

### Paper-Ballot Attestation (2026-07-29)

With attestations required (the default is 2 — e.g. the secretary records,
the President and Chief or their designees validate), a recorded batch
starts **pending**: its votes are signed and chained immediately but
excluded from results and stats. Officers with `elections.manage` attest
via the batch panel on the election page; the recorder can never attest
their own batch and each officer counts once. When the snapshotted
requirement is met the batch flips to **confirmed** and its ballots count.
A disputed batch is voided with a reason (the existing correction path).
Attestation is only possible while voting is open — a batch still pending
at close stays out of the certified results and the close writes a warning
`election_manual_ballots_unattested_at_close` audit event.

_(2026-08-12)_ That exclusion now reaches **every** tally the close path
runs, not just the published results: the runoff-advancement count and the
membership-package Approve/Deny sync each carry a SQL predicate
(`_is_attested_vote`) that skips votes belonging to a still-`pending`
batch. Previously an unattested paper batch was invisible in the results
yet could still decide which candidates advanced to a runoff or flip a
prospect's package to `elected`/`not_elected`. Votes in a batch that is
later confirmed count again everywhere; electronic votes (no
`manual_batch_id`) and pre-attestation-era batches are unaffected.

### Enhancement Batch (2026-07-29)

- **Printable ballot PDF** — the in-room paper ballot is generated from
  the election itself (positions, accepted candidates, write-in lines,
  method instructions), closing the loop with paper entry + attestation.
- **Election cloning** — "run it again" copies the setup (never votes,
  tokens, attendees, overrides, or the salt — a fresh salt is generated)
  with new dates; optionally copies accepted candidates.
- **Voter-roll freeze** — opening an election snapshots the eligible
  roster; mid-election membership changes can no longer change who may
  vote or the turnout denominator. Secretary overrides still admit.
  NULL snapshot (pre-feature elections) = legacy live evaluation.
- **Certified results package** — closed elections offer a formal PDF
  with tallies, turnout/quorum, the attestation trail, integrity
  verification, and officer signature lines.
- **Live turnout dashboard** — meeting-night panel (fullscreen-capable)
  with ballots received vs eligible and quorum progress; auto-refreshes;
  never shows candidate tallies before close.
- **Tie policy** — per-election `tie_policy`: `co_winners` (legacy
  default), `runoff`, `revote`, `chair_decides`. Non-legacy policies
  declare no winner on a tie, flag it in results and the UI, and audit
  `election_tie_detected` at close.
- **Write-in consolidation** — spelling variants merge under one
  candidate via an audited alias (`merged_into_candidate_id`); signed
  vote rows are never mutated, so integrity verification still passes.

## Lifecycle Automation (2026-07-29)

The `election_lifecycle` scheduled task (every 15 minutes) automates status
transitions and reminders:

- **Auto-close**: OPEN elections past `end_date` are closed automatically.
  Votes are already rejected after `end_date`; closing is what finalizes
  results, evaluates runoffs, and runs the anonymous-election IP purge and
  salt destruction — so an overdue election left open was a privacy
  liability. No opt-in.
- **Auto-open**: DRAFT elections are opened at `start_date` only when the
  creator enabled **Open Automatically at Start Time** (`auto_open`). The
  real open path runs, so an invalid draft (e.g. no candidates) is skipped
  and retried, never force-opened.
- **Nomination auto-close**: an election in the nomination phase with a
  `nomination_deadline` returns to draft automatically once the deadline
  passes (audited as `nominations_auto_closed`).
- **Automatic reminder**: when `reminder_hours_before_close` is set, the
  task sends exactly one reminder ballot email to members who haven't
  voted once the window opens. Any reminder (manual or automatic) stamps
  `reminder_sent_at`, which suppresses the automatic one.

Reminders reuse the real ballot-send path, so each reminded member gets a
fresh voting link. Earlier unused tokens stay valid deliberately: the vote
dedup hash already guarantees at most one vote per member, and expiring the
old token could disenfranchise a member whose reminder email bounces.
Audit events: `election_auto_opened`, `election_auto_closed`,
`election_reminder_sent`.

## Saved Ballot Templates (2026-08-12)

A secretary who runs the same officer slate every year can now save the
ballot as a **named, reusable template** and apply it to next year's
election instead of rebuilding it item by item.

- **Configuration only, by construction.** A template snapshots the ballot
  _structure_ — items, positions, voting methods, victory conditions,
  eligibility types — and never candidates, voter rosters, votes, tokens,
  attendance, or lifecycle state. The create schema is `extra="forbid"`,
  so a payload that tries to smuggle any of those in is rejected with 422
  rather than silently stored.
- **Org-scoped, `elections.manage` only.** List, save, and delete all
  require `elections.manage` and filter to the caller's organization —
  there is no `elections.view`-level read. Cross-org ids 404.
- **Case-insensitive unique names.** Uniqueness is enforced per org on
  `name_key` (SHA-256 of the NFKC-normalized, casefolded name), so
  "Annual Officers" and "annual officers" collide with a 409 while the
  display name keeps its original casing.
- **Applying regenerates item ids.** The BallotBuilder's template picker
  gains a "Your saved ballots" section; applying a template replaces the
  current ballot (two-step confirm) and mints fresh ballot-item ids so a
  snapshot can never carry ids already referenced by draft state.
- **Survives its author.** `created_by` is `SET NULL` — deleting the
  member who saved a template leaves the department's template intact.
- Model `SavedBallotTemplate` (`saved_ballot_templates`), migration
  `20260812_0001`. Audit events `ballot_template_created` /
  `ballot_template_deleted` (category `elections`).

The same batch hardened ballot definitions themselves (create _and_
update): ballot-item ids are validated (`^[A-Za-z0-9_-]+$`, unique per
ballot), voting methods / victory conditions are checked against the known
sets, `victory_percentage` is required for supermajority items, voter-type
lists are de-duplicated and `'all'` cannot be combined with other types,
position names must be unique case-insensitively, and quorum is
cross-validated (`quorum_value` required when quorum is enabled; a
**percentage** quorum caps at 100 while a **count** quorum may exceed it —
the blanket `le=100` that wrongly capped count quorums is gone). Election
**cloning** now copies `ballot_items` too (deep-copied so editing the
clone can never mutate the source).

## Recent Fixes (2026-08-12)

### Vote-Casting Integrity

- **Concurrent vote validation is serialized.** `cast_vote` now takes a
  row-level `SELECT … FOR UPDATE` lock on the election before inspecting
  prior votes. The method-aware dedup hash permits distinct
  candidates/ranks, so its unique constraint alone could not stop two
  simultaneous requests from both passing the per-voter limit check and
  both committing — an over-voting window under concurrency. The lock
  forces validate-then-insert through one request at a time.
- **Token votes are normalized to the candidate's position.** On the
  public token-ballot path, a voter who omitted `position` for a
  positioned candidate previously produced a `position=NULL` vote row in a
  different bucket from the same voter's explicit-position vote — letting
  one voter double-vote a position (and dodge the dedup hash) simply by
  leaving the field out. The vote's stored position, the duplicate/limit
  filters, and the dedup hash now all use `position or candidate.position`.
  A genuinely positionless candidate still stores NULL and is limited as
  before.
- **Election packages are no longer readable at `elections.view`.**
  `GET /prospective-members/prospects/{id}/election-package` and
  `GET /prospective-members/election-packages` dropped `elections.view`
  from their permission list (now `prospective_members.view`,
  `prospective_members.manage`, or `elections.manage`). A package bundles
  the interview and coordinator material the vote is based on — applicant
  PII, unlike ordinary election data — and every voter-level
  `elections.view` holder could read it. A regression test pins the
  permission set exactly (additions fail it too).

### Election Detail Tabs Are Addressable

`/elections/{id}?tab=` now round-trips all nine workflow tabs (`ballot`,
`nominations`, `candidates`, `eligibility`, `attendance`, `overrides`,
`proxies`, `voting`, `results`). The active tab is **derived from the
URL**, not mirrored into state, so the Back button works; an unknown or
not-currently-visible value falls back to the first tab the viewer may
see. This is what finally made the **Eligibility roster** linkable
(`?tab=eligibility`) — and photographable.

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
GET    /api/v1/elections/{id}/ballot         # In-app ballot: every item and position, per-item standing (?proxy_authorization_id= for a proxy ballot)
POST   /api/v1/elections/{id}/ballot         # Cast the in-app (or proxy) ballot atomically, emailed-ballot shape
GET    /api/v1/elections/{id}/ballot/proxies # Proxies the current member holds (named elections only)
GET    /api/v1/elections/{id}/results        # Get results (visibility-gated)
GET    /api/v1/elections/{id}/stats          # Ballot counts / turnout (manage)
POST   /api/v1/elections/{id}/open-nominations  # Draft -> nomination phase (manage)
POST   /api/v1/elections/{id}/close-nominations # Nomination phase -> draft (manage)
POST   /api/v1/elections/{id}/nominations    # Nominate a member or yourself (any member)
POST   /api/v1/elections/{id}/nominations/{cid}/accept   # Nominee accepts
POST   /api/v1/elections/{id}/nominations/{cid}/decline  # Nominee declines (entry removed)
POST   /api/v1/elections/{id}/manual-ballots # Record in-room paper-ballot tally (manage; plausibility-guarded)
GET    /api/v1/elections/{id}/manual-ballots # List paper batches with attestation trail (manage)
GET    /api/v1/elections/{id}/printable-ballot # Official blank paper ballot PDF (manage)
GET    /api/v1/elections/{id}/certified-results # Certified results package PDF, closed only (manage)
POST   /api/v1/elections/{id}/clone         # Fresh draft from this election's setup (manage)
POST   /api/v1/elections/{id}/write-ins/merge # Consolidate write-in variants (manage)
POST   /api/v1/elections/{id}/manual-ballots/{batch}/attest # Attest a batch's count (manage; not the recorder)
POST   /api/v1/elections/{id}/manual-ballots/{batch}/void # Void a mis-keyed paper batch (manage)
GET    /api/v1/elections/{id}/non-voters     # Eligible voters who haven't voted (manage)
POST   /api/v1/elections/{id}/remind-non-voters # Reminder ballot email (fresh link) to non-voters only (manage)
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

# Saved ballot templates (2026-08-12; all require elections.manage, org-scoped)
GET    /api/v1/elections/templates/saved-ballots            # List the org's saved templates
POST   /api/v1/elections/templates/saved-ballots            # Save current ballot as a template (409 on duplicate name)
DELETE /api/v1/elections/templates/saved-ballots/{template_id}  # Delete a saved template (404 if not in org)

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

- **Two privacy variants**: the _member_ variant lists eligible voters and
  counts only; the _full_ variant (leadership) adds per-member ineligibility
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
- **Runoffs inherit the parent's rule set with a fresh salt** _(follow-up)_: auto-created runoffs previously dropped quorum, position eligibility, the meeting/event link, attendees, and voter overrides — and anonymous runoffs had **no anonymity salt** (voter hashes keyed with an empty string were pre-computable from user ids). Runoffs now inherit the rules and generate their own salt
- **Same-meeting runoffs work in one click** _(follow-up)_: opening an election clamps a future start date to the open time (audited as `start_adjusted_to_open_time`), an election whose end date already passed can't be opened, and draft elections gained an **Edit Dates** modal (Start Now, 15-min/30-min/1-hour/1-day quick durations)
- **Voting tokens hashed at rest** _(follow-up, ELEC-5)_: only SHA-256 hashes are stored; the raw token exists solely in the emailed ballot link (migration `20260731_0001` hashes existing rows in place — old links keep working)
- **IP metadata purged at close** _(follow-up, ELEC-6)_: anonymous elections erase per-vote IP/user-agent when closed, and the forensics report returns a thresholded suspicious-IP set (`suspicious_ips`, `unique_ip_count`, `ip_metadata_purged`) instead of the full per-IP vote map
- **Cloudflare email attachments** _(follow-up)_: the pre-meeting package PDF now attaches on the Cloudflare email backend too (base64 API attachments, 5 MiB cap with skip-and-warn)
- **Ballot tokens never appear in URLs** _(follow-up, R-D3, 2026-07-29)_: the emailed link now carries the token in the URL **fragment** (`/ballot#token=…` — browsers never send fragments to any server), the voting page scrubs it from the address bar after capture, and the two GET read endpoints were replaced by `POST /elections/ballot/lookup` with the token in the body. Links emailed before the change (`?token=`) keep working until those tokens expire
- **Position eligibility enforced for token ballots** _(follow-up, R-D4, 2026-07-29)_: positional elections' `position_eligibility` rules now apply to email-token voters too — eligible positions are snapshotted on the token at send time (`eligible_positions`, migration `20260801_0001`), enforced at vote time, and used to filter the positions/candidates the ballot page shows. Members eligible for no position are skipped at send time with a reason
- **Method-aware token voting** _(follow-up, R-D5, 2026-07-29)_: approval and ranked-choice elections now work end-to-end by email ballot — the ballot page renders checkbox multi-select (approval / multi-vote) and per-candidate rank selects (ranked choice), submitted as `candidate_ids` / `rankings` on the bulk endpoint; the single-vote token endpoint mirrors the authenticated path's per-candidate/per-rank duplicate rules
- **Anonymous elections keep voter IPs out of the audit log** _(follow-up, ELEC-6 residual, 2026-07-29)_: voter-action audit events no longer record an IP for anonymous elections (audit rows are hash-chained and can never be scrubbed, so this had to be a write-time fix; rows written earlier keep their IPs)

### Edge Cases (2026-07-28)

| Scenario                                                               | Behavior                                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Token vote on an item the voter isn't eligible for                     | Rejected with the item title in the error; abstaining on it is allowed                                                                 |
| Legacy token issued before the migration                               | No item snapshot (`NULL`) — unrestricted, bounded by token expiry                                                                      |
| Test ballot vote followed by the sender's real vote                    | Both succeed; only the real vote counts                                                                                                |
| Election closed before its end date with no winner                     | Runoff still created (when runoffs enabled)                                                                                            |
| Approval voter approves two candidates for one position                | Both votes recorded; duplicate candidate rejected                                                                                      |
| Ranked-choice voter submits ranks 1–3                                  | All recorded atomically; duplicate rank or candidate rejected                                                                          |
| Reopen closed anonymous election with votes                            | Refused — create a new election instead                                                                                                |
| Positionless token vote after an unrelated positioned vote             | No longer blocked (filter previously degraded to a no-op)                                                                              |
| Runoff created from a quorum/position-restricted election              | Inherits quorum, position eligibility, meeting/event link, attendees, and overrides — with a **fresh** anonymity salt of its own       |
| Runoff opened at the meeting (default start is +1h)                    | Opening clamps a future start to "now" — voting works immediately; draft dates are also editable via the new **Edit Dates** modal      |
| Opening an election whose end date already passed                      | Refused — update the dates first                                                                                                       |
| Token holder votes for a position their membership type can't vote for | Rejected ("You are not eligible to vote for …") — omitting the position field can't bypass it (falls back to the candidate's position) |
| Token restricted to one position casts that vote                       | Token marked fully used, even though the election has more positions                                                                   |
| Approval election by email ballot                                      | Voter checks every candidate they support; one vote per checked candidate, duplicate candidate rejected                                |
| Ranked-choice election by email ballot                                 | Voter assigns unique ranks per candidate; submission order defines rank 1..n                                                           |
| Old `?token=` ballot link (emailed before the fragment change)         | Still works — the page falls back to the query string, then scrubs the URL                                                             |

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

| Scenario                                | Behavior                                                         |
| --------------------------------------- | ---------------------------------------------------------------- |
| Ballot email to recipient with no email | Skipped with reason logged; included in eligibility summary      |
| One failed email in batch               | Per-recipient exception handling; other recipients still receive |
| Proxy authorization cross-tenant        | Blocked by `organization_id` filter — returns 404                |
| Rollback history mutation               | Uses `copy.deepcopy()` before appending                          |
| Elections with only ballot items        | Can be opened — `open_election` no longer requires candidates    |
| Eligibility summary email               | Sent only to the user who triggered ballot dispatch              |
| No eligible voters found                | Descriptive error instead of false success with 0 recipients     |
| Concurrent vote attempts                | Database-level locking prevents double-voting race conditions    |

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

| Component              | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `ElectionWorkflowTabs` | Tabbed navigation with dynamic tab visibility based on election status |
| `EligibilityRoster`    | Secretary eligibility dashboard with search, filter, per-member detail |
| `PublishResultsPanel`  | Post-election result publishing and report email                       |
| `RunoffChain`          | Multi-stage election timeline visualization                            |
| `ElectionSummaryCards` | Dashboard metrics cards on elections list page                         |

### Edge Cases (2026-03-24)

| Scenario                                      | Behavior                                             |
| --------------------------------------------- | ---------------------------------------------------- |
| Election linked to non-business-meeting event | Now allowed (event type filter removed)              |
| Department email collision                    | Appends numeric suffix (john.smith2@dept.org)        |
| Cancelled election tabs                       | Only Ballot tab visible                              |
| Results tab auto-select                       | Navigates to Results when election is closed         |
| Runoff chain for standalone election          | Shows single-node chain                              |
| Eligibility roster with 0 members             | Empty state with message                             |
| Secretary override on ineligible member       | Blue row with override badge, eligible for all items |

---

## Recent Improvements (2026-03-22)

### Eligibility, Email Reliability & Meeting Integration

- **Eligibility uses standing, not role slugs**: Voter eligibility uses the member's standing rather than their roles. _(As of 2026-08-26 that standing is `member_class` / `member_status`; this entry described the earlier `membership_type` form.)_ A member's role (e.g., EMT) does not make them eligible for operational ballot items — their membership type (e.g., "active") does
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

| Scenario                                                                                  | Behavior                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Member with role `emt` but member class `administrative`                                  | Not eligible for `operational` ballot items                                                                                                                                                                                          |
| Email fails for one recipient in batch                                                    | Loop continues; summary shows per-recipient status                                                                                                                                                                                   |
| Election linked to past meeting                                                           | Past meetings filtered out of dropdown                                                                                                                                                                                               |
| No eligible voters after filtering                                                        | Descriptive error with reasons instead of false success                                                                                                                                                                              |
| Neither class/status nor membership type set on member                                    | **Treated as operational + regular.** `split_membership_type(None)` returns the defaults, so an entirely blank standing qualifies for `operational` **and** `regular` — not just `all`. Verify before relying on a restricted ballot |
| Member on an org-configured tier (e.g. the shipped `senior`)                              | Matches **no** class and no status — eligible for `all` only. This is the case that resolves to nothing, and it is deliberate: the tier satisfied neither category before the split                                                  |
| Life member, on an `operational` ballot item                                              | **Not** eligible — `operational` requires regular status. They are eligible for `regular` and `life` items                                                                                                                           |
| Life member, on a `regular` ballot item _(changed 2026-08-26)_                            | **Eligible.** With the old fused field, `life` and `regular` were mutually exclusive values and they were not                                                                                                                        |
| Administrative member with regular standing, on a `regular` item _(tightened 2026-08-26)_ | **Not** eligible — status categories now also require the operational class                                                                                                                                                          |

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

| Scenario                           | Behavior                                            |
| ---------------------------------- | --------------------------------------------------- |
| Event with no checked-in attendees | Returns empty list with informational message       |
| Attendee already in ballot list    | Skipped silently; count reflects only new additions |
| Election linked to cancelled event | Link preserved; event shows cancelled badge         |

---

**See also:** [Prospective Members](../docs/PROSPECTIVE_MEMBERS_MODULE.md) | [Role System](Role-System)

## Ballot eligibility and duplicate-vote hardening _(2026-09-02)_

The elections security review's third pass closed ten findings. Most are one
shape wearing different clothes, and it is worth stating the shape once.

### Name collisions between a position and a ballot item

Voting eligibility is checked per candidate against **one of two independent
rule sets**, depending on how that candidate is classified. When a plain
election position and an unrelated ballot item happened to share an exact name,
the classification picked one rule set and skipped the other — so **a token
authorized for the unrestricted contest could cast a vote for the restricted
one under the same name.**

Fixed by detecting the collision and requiring **both** rule sets to authorize
the vote. The fix then needed a fix of its own: where a legacy contest shared a
name with _two_ different restricted positions at once (via its internal id and
its displayed title), the check picked one of the two effectively at random. It
now requires clearing **every** colliding name.

The check is defined once and reused by every vote-submission route — the
single-vote link, the ballot preview and the full-ballot route each had to be
closed separately, and defining it once is what stops them drifting apart
again.

### The database's duplicate-vote safety net could not recognise a duplicate

On a contest configured to accept votes differently from the rest of its
election — several selections on one contest while the rest allows one — the
two submission routes **computed different internal fingerprints for the
identical vote**, so the near-simultaneous double-vote constraint could not see
them as the same vote. A voter holding two unused ballot links could cast one
through each and have both counted.

Both routes now compute the same fingerprint, and both recognise every label a
legacy contest can be recorded under. Separately, a legitimate vote could be
**wrongly rejected** as a duplicate of a completely different contest whose
displayed title matched another contest's internal identifier.

### A custom membership tier kept restricted voting rights

A member moved onto a department's own custom tier (e.g. "Senior") kept
counting as an operational/regular voter for ballots restricted to that
category, **even though a custom tier is documented to match none of the
built-in voter categories.**

The cause is worth recording: an unrelated and _correct_ shift-scheduling fix
started preserving a member's prior class/status across a tier switch, and
election eligibility reads the same two columns and inherited the carryover.
Eligibility now re-checks the member's live membership tier before trusting
those columns.

### Mixed elections

- A member eligible **only** for a plain position never received a ballot at
  all — the decision to skip a member with zero eligible ballot items ran
  before their position eligibility was checked.
- A tier-wide voting ban and an administrator's per-voter override were both
  honoured for structured ballot items and **silently ignored for plain
  positions**.
- Casting a vote for a plain position could prematurely mark a ballot fully
  submitted while a legitimate ballot-item vote was still outstanding, so that
  second valid vote was rejected as a duplicate.

> **Known limitation, flagged not fixed:** an eligible member's plain-position
> vote in a mixed election has no way to be cast today. See
> `KNOWN_LIMITATIONS.md`.

### Paper-ballot batches and locking

- **Officer attestation could race a concurrent election close** — the
  attestation locked the batch but not the election, so a batch attested
  moments before close could be confirmed after the election had already
  generated its certified results excluding it.
- **Voiding was not safe against two officers at once**: both could load the
  same votes before either committed, and the second commit silently overwrote
  the first officer's recorded reason and timestamp.
- **Attestation, voiding and election deletion locked the batch and the
  election in opposite orders** and could deadlock. All three now lock in the
  same order.
- A vote submitted through an emailed link could **read stale election/token
  state past its own row lock** — the lock was acquired correctly, but the
  already-cached pre-lock Python objects were returned instead of the freshly
  locked row's values.

Full per-finding write-up: `docs/security-review/ELEC-06-elections-ballots.md`
(ELEC-13 … ELEC-39).

## Voting attendance window _(2026-09-29)_

Tier-based voting eligibility measured meeting attendance from a bare
look-back cutoff with **no upper bound and no regard for when the member
joined**. A member hired two months ago was charged with ten pre-hire
meetings, a reinstated member with every meeting held while dropped, and
everyone with meetings already scheduled for next week.

`attendance_window()` in `membership_tier_service.py` now returns
`(max(cutoff, current_stint_start), org_today)`, where the cutoff is
`voting_attendance_period_months` calendar months back (`relativedelta`, not
30-day months) and the stint start is the latest `MemberServicePeriod`, else
`hire_date`. `tally_attendance()` classifies meetings by id sets, so a meeting
that is both waived and inside a leave is excluded once rather than twice (the
old subtraction could push a percentage over 100%), and attendance counts only
inside the eligible set. The ballot check and the secretary's attendance
dashboard (`GET /meetings/attendance/dashboard`) both call it, so they cannot
disagree (CLAUDE.md pitfall 29).

## W50 browser review _(2026-09-30 → merged 2026-10-03)_

Two Playwright drivers ran the module end to end with a real SMTP sink, and
41 findings were fixed across `3de83db`, `d6f828c` and `7aa3405`, with an
earlier single-driver pass (W50 part 1) fixing eight UI defects. The full
record is `docs/workflow-review/W50-elections.md`; the owner decisions left
open are tabled in `docs/KNOWN_LIMITATIONS.md` under "Elections — Owner
Decisions From the W50 Drive (2026-09-30)".

> **⚠️ Upgrade: close any OPEN election first.** In-app votes on a
> ballot-item election now carry the item id as their position and token votes
> key the same vote by a hash of it; rows written before the change match
> neither, so a member who voted in-app before the deploy could vote once more
> after it and both would count. Closed tallies are not rewritten. See
> `docs/UPGRADING.md`, "Close any election that is OPEN before you upgrade".

### Integrity and anonymity

| Finding                                                                                                                                                                   | Fix                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W50-1 (CRITICAL) `DELETE /elections/{id}` 500'd on any election with tokens — after leadership was mailed "permanently deleted"                                           | `voting_tokens` relationship gets `cascade="all, delete-orphan", passive_deletes=True`; the leadership mail and `election_deleted_critical` audit run only after the commit, and a mail failure cannot turn the committed delete into a 500 |
| W50-2 Anonymous election de-anonymised in two reads                                                                                                                       | New `vote_cast` rows carry no `user_id` on anonymous elections; forensics `deleted_votes.records[].candidate_id` is `null` on anonymous elections. Pre-fix audit rows keep the voter (cannot be scrubbed from the hash chain)               |
| W50-3 / -4 / -5 In-app and token votes on a named election both counted; an item id as `position` skipped the attendance rule; a missing `position` allowed a second vote | One shared vote-target resolver for `cast_vote`, the proxy route and the token route; `get_non_voters` and `total_voters` key on the voter hash too                                                                                         |
| W50-6 A voided voter's next vote 500'd (`ix_votes_dedup_hash`)                                                                                                            | The dedup hash is nulled on soft-delete (migration `6394fbf42581` nulls it on rows already voided); an `IntegrityError` on either route is a 400                                                                                            |
| W50-9 Certified results renamed after close                                                                                                                               | Name, position or acceptance of a candidate with (non-test) votes is refused; compared by value, so a statement edit saves. Merge / void / batch-void after close stay allowed — flagged                                                    |
| W50-39 `DELETE …/votes/{id}` ignored the election in the path and took an empty reason                                                                                    | Scoped to the path's election; `reason` required (3–500 characters)                                                                                                                                                                         |
| W50-41 `eligible_voters: []` meant "nobody" in-app and "everyone" for mail                                                                                                | `[]` normalised to `NULL` on create/update; existing `[]` rows need a one-off `UPDATE` (left to the owner)                                                                                                                                  |
| W50-42 Punctuation write-in 500; write-ins double-escaped                                                                                                                 | Stored as typed; pre-fix rows stay escaped (backfill left to the owner)                                                                                                                                                                     |

### Reporting

| Finding                                                                                   | Fix                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W50-7 Ballot-item outcomes reported nowhere                                               | Per-item results with a `label` on the Results tab, the report mail and the certified PDF. The pooled `overall_results` list is unchanged — flagged                                                                          |
| W50-8 Print Blank Ballots carried positions only                                          | Each approval item prints "☐ Approve ☐ Deny". Recording paper votes on items is still impossible — flagged                                                                                                                   |
| W50-12 `send-report` mailed a mid-vote tally as "closed … official report"                | 400 "Election report is only available after the election closes"                                                                                                                                                            |
| W50-14 Early close dated to the scheduled end, with no actor                              | `elections.closed_at` / `closed_by` (migration `ac06a2998013`), stamped on manual and lifecycle closes and printed on the PDF and report ("… by Sam Ortiz"); older rows fall back to the scheduled end and "Automatic close" |
| W50-20 Pre-meeting package said everyone was eligible                                     | Per-item eligibility block from the roster's `item_eligibility`                                                                                                                                                              |
| W50-32 / -48 Ties printed as two 50% rows; "Quorum Met" with no quorum                    | `is_tie` set under co-winners too, report prints "Tie — co-winners per policy" / "Tie — runoff round created"; `quorum_met: None` and "No quorum requirement" when `quorum_type == 'none'`                                   |
| W50-33 Close report invented recipient facts                                              | One source: `email_recipients` plus `elections.email_skipped_details` (migration `c4e8a1f7d2b6`) from the last send or reminder                                                                                              |
| W50-65 / -66 Forensics and results counters disagreed; voided batch cards showed no trail | Tokens reported as issued / used / superseded / expired / live; batches carry `voided_by` / `voided_at` / `void_reason` / `over_count_override` (migration `d9f3a6c2e8b1`, backfilled for already-voided batches)            |
| W50-45 Audit Log page showed "system" for every row                                       | `username` resolved server-side; "system" only when `user_id` is null                                                                                                                                                        |
| W50-71 `runoff_election_created` had no `election_id`                                     | Written on the parent with a mirror on the child                                                                                                                                                                             |

### Mail, tokens and lifecycle

| Finding                                                                                                                                               | Fix                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W50-18 Test ballot indistinguishable from a real one                                                                                                  | "[TEST]" subject and stamp, `is_test` on the lookup, receipt `counted: false` with a test message; `email_sent` is not set by a test send                                                                                                                                                                                                                                  |
| W50-27 A reminder was a second "Ballot Available" mail and its superseded link read "expired"                                                         | Subject "Reminder: vote in …", `reminder_sent_at` stamped instead of `email_sent_at`, `voting_tokens.superseded_at` (migration `b7d2e41c9f03`) and "This link was replaced by a newer ballot email"                                                                                                                                                                        |
| W50-35 A DRAFT could be mailed as "Ballot Available" (API)                                                                                            | `send-ballot` refuses DRAFT and NOMINATIONS unless `is_test`, as well as CLOSED and CANCELLED                                                                                                                                                                                                                                                                              |
| W50-44 A dead token after close blamed the voter roll                                                                                                 | Status checked before the hash: "Voting has closed"; after a reopen, ask the secretary for a new link                                                                                                                                                                                                                                                                      |
| W50-37 / -68 Rollback alert claimed later votes no longer count; ballot mail said it would "log you in", printed an empty "Meeting Date:" and no zone | Per-transition `rollback_effect` sentence with invalidated-link and resend counts; "opens your ballot"; the meeting line omitted when there is none; zone printed. Migration `c8266855a348` moves `ballot_notification`, `election_rollback` and `election_report` rows still byte-identical to the shipped bodies onto the new wording; an edited template keeps its text |
| W50-34 A runoff reset its tie policy and could not be emailed                                                                                         | `tie_policy` copied; description names the tie; the parent's candidate-selection items copied                                                                                                                                                                                                                                                                              |
| W50-49 Max Proxies Per Person was never enforced                                                                                                      | Enforced; schema `ge=1, le=10`                                                                                                                                                                                                                                                                                                                                             |
| W50-54 A voided vote's receipt read "No matching vote found"                                                                                          | `verified: false, voided: true, "This vote was voided by an officer"`                                                                                                                                                                                                                                                                                                      |
| W50-55 Roster said a member created after open "will receive ballot"                                                                                  | The roster reads the frozen roll                                                                                                                                                                                                                                                                                                                                           |
| W50-67 Malformed `user_id` on attendee check-in → 500; unbounded statement                                                                            | 422; `statement` `max_length=5000`                                                                                                                                                                                                                                                                                                                                         |
| W50-69 Clone copied a published parent's `results_visible_immediately`                                                                                | Reset on clone; lands on `?tab=ballot`                                                                                                                                                                                                                                                                                                                                     |

### Frontend

Fixed: the Positions **Add** click swallowed by a full-screen click-away layer
(W50 part 1-1); the start/end time pickers' names (part 1-2); "Voting Method:
Simple Majority" for a plurality election — the card now reads "One choice per
voter" / "Ranked choice" / "Approval" with a **Winner** row from
`getVictoryDescription` (part 1-3); keyboard reach of the workflow tabs
(arrow keys, Home, End; `tabpanel` labelled by its tab) (part 1-4); the
stepper as a named list with `aria-current="step"` (part 1-5); voter overrides
by member picker instead of a raw user id, listed by `member_name` (part 1-6);
labels on the candidate form, ballot builder and attendance list (part 1-7);
the reason **Send Ballot Emails** is disabled shown in text, and
`ballot_send_message` reporting whether the eligibility summary actually went
(part 1-8); quick durations and **End of Day** computed in the org zone
(W50-15); a cleared candidate statement sent as `null` (W50-16); `?tab=` writes
use `replace` (W50-17); **Results & Publishing** shows **Publish Results** only
when CLOSED and **Email Results Report** only after close (W50-21, -28); the
meeting link cleared with `null` and no toast for a no-op (W50-60).

**Not merged in this window:** the "frontend round 2" items the W50 record
marks _FIX in progress_ — among them the delete and close dialog wording, the
`ElectionCloseStamp` on cards, the ballot page's test banner and double lookup,
Election Settings labels, the void and proxy forms' member pickers, and the
Extend Time direction check. Treat their backend halves as live and their
screens as unchanged.

## Election Settings → Defaults removed _(2026-09-29)_

The **Defaults** section (default voting method, victory condition,
anonymity, write-ins, results visibility, runoffs) was stored in organization
settings and read by nothing — the create form never consulted it (CLAUDE.md
pitfall 19). It was briefly relabelled "Saved defaults (not yet applied)" and then
removed, both on 2026-09-29. Election Settings now has **Proxy Voting**, **Features**, **Test
Ballot** and **Security**; every election's options are chosen on its own
create form. Values already stored are left in place and unused.
