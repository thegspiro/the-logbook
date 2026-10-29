# Elections Module

The Elections module provides a complete election management system:
ballot building, nominations, eligibility rules, in-app and emailed ballots,
proxy and paper voting, ranked-choice and multi-seat tallying, runoffs,
certified results, audit logging and ballot forensics.

---

> **Developers:** routes, API endpoints, the data model and the frontend
> architecture are on [Elections Module — Developer Reference](Module-Elections-Developer).

## Key Features

- **Ranked-Choice Voting** — Members rank candidates by preference; automatic
  runoff rounds
- **Multiple Election Types** — Officer elections, bylaw votes, membership
  approvals, general votes
- **Ballot Builder** — Drag-and-drop ballot items, reusable saved ballot
  templates, printable paper ballots
- **Ballot Forensics** — Signed, hash-chained votes with integrity
  verification and a forensic report
- **Election Packages** — Auto-generated from prospective member pipeline
  stages
- **Voting Eligibility** — Based on member class and status, meeting
  attendance and membership tier rules — enforced both when ballots are issued
  and when votes are submitted
- **Secret Ballots** — Anonymous voting via per-election salted voter hashes
  (no voter ID stored on votes); voters receive a cryptographic receipt they
  can verify without revealing their choice
- **Real-Time Results** — Live tallying with round-by-round breakdowns and a
  live turnout dashboard
- **Audit Logging** — Complete trail of election creation, voting, and result
  certification
- **Meeting Link** — Elections can be linked to a meeting record or an event
  for procedural compliance
- **Voter Overrides** — Secretary can grant voting eligibility overrides for
  individual members
- **Proxy Voting** — Proxy voting authorization management for absent members
- **Paper Ballots** — In-room paper tallies with officer attestation
- **Ballot-Item Elections** — Support for elections with only ballot items
  (approval votes, resolutions) and no candidates

---

## Workflow

1. **Create Election** — Set title, type, candidates, voting period,
   eligibility rules, and optionally link to a meeting or event
2. **Nominations (optional)** — Open a nomination phase where members nominate
   candidates and nominees accept or decline; closing nominations returns the
   election to draft
3. **Open Voting** — Members vote in the app, or receive an emailed ballot
   link (ballot-item-only elections supported)
4. **Cast Ballots** — Members rank candidates (ranked-choice), select
   candidates, or vote Approve/Deny on ballot items
5. **Close Voting** — Automatically at the scheduled end time or manually by
   an officer
6. **Certify Results** — Officers review results, round-by-round tallies, and
   download the certified results package
7. **Archive** — Election and all ballots are preserved for audit

### Election Statuses

| Status        | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `draft`       | Being configured; editable                                              |
| `nominations` | Optional pre-ballot phase; members nominate, nominees accept or decline |
| `open`        | Voting in progress                                                      |
| `closed`      | Voting ended; results finalized                                         |
| `cancelled`   | Abandoned                                                               |

**Rollback** (`POST /elections/{id}/rollback`, `elections.manage`, reason
required) moves an election back one step: `closed` → `open` or `open` →
`draft`. Leadership is emailed and the action is audit-logged with a
per-transition `rollback_effect` sentence (how many ballot links were
invalidated and how many ballots need re-sending). Reopening a closed
**anonymous** election that has votes is refused, because its anonymity salt
was destroyed at close and prior voters could vote again undetected — create a
new election instead. With zero votes a reopen mints a fresh salt; the old
ballot links are retired (`superseded_at`) and new ones must be sent.

---

## Voter Eligibility

Voter eligibility for each ballot item is determined by the member's
**standing**, not by their assigned roles/positions. A member may hold
multiple roles (e.g. EMT on the operational side and Quartermaster on the
administrative side), but their standing is what controls which ballot items
they can vote on.

### Standing Is Two Fields

| Concept             | Field                  | Purpose                                                                                       | Example                                                             |
| ------------------- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Member class**    | `User.member_class`    | What kind of member somebody is; decides `operational` eligibility                            | operational, administrative, social                                 |
| **Member status**   | `User.member_status`   | Where they sit on the membership ladder; decides `life` / `probationary`                      | prospective, probationary, regular, life, retired, honorary, junior |
| **Membership type** | `User.membership_type` | Legacy single classification, **derived** from the pair; also holds an org-configured tier id | active, administrative, life, probationary, senior                  |
| **Role / Position** | `User.roles`           | Assigned positions; determines system permissions                                             | EMT, Quartermaster, Secretary, Chief                                |

**What each built-in category requires**, per
`ElectionService._user_has_role_type`:

| Category         | Requires                                        |
| ---------------- | ----------------------------------------------- |
| `operational`    | operational class **and** regular status        |
| `regular`        | operational class **and** (regular **or** life) |
| `life`           | operational class **and** life status           |
| `probationary`   | operational class **and** probationary status   |
| `administrative` | administrative class                            |
| `social`         | social class                                    |

Every status category requires the operational class, so an administrative
member with regular standing does not receive ballots restricted to
active/life members. A life member satisfies both `regular` and `life`.

When `member_class` / `member_status` are unset, `ElectionService` derives
them from `membership_type` via `split_membership_type`. When
`membership_type` is an org-configured custom tier (e.g. the shipped
`senior`), any stored class/status is discarded for election purposes: a
custom tier matches no built-in voter category, even though shift
eligibility keeps the member's prior class/status across a tier switch.

A member's role (e.g. EMT) does **not** make them eligible for "operational"
ballot items. Their member class does.

### Eligible Voter Types

Each ballot item has an `eligible_voter_types` field that controls who can
vote on it:

| Voter Type       | Eligible standing                | Use Case                                             |
| ---------------- | -------------------------------- | ---------------------------------------------------- |
| `all`            | Everyone                         | General resolutions, budget votes                    |
| `operational`    | Active (operational + regular)   | Operational officer elections (Chief, Captain, etc.) |
| `administrative` | Administrative class             | Administrative-specific votes                        |
| `social`         | Social class                     | Social-member votes                                  |
| `regular`        | Active + Life                    | Bylaw amendments, membership approvals               |
| `life`           | Life                             | Life-member-only votes                               |
| `probationary`   | Probationary                     | Probationary-specific votes                          |
| _(role slug)_    | _(any member holding that role)_ | Fine-grained restrictions by specific position       |

Specific role slugs (e.g. `chief`, `secretary`) can also be used as a
fallback for niche eligibility rules that go beyond standing. `'all'` cannot
be combined with other types, and duplicate types are removed.

Plain election positions have their own rule set in `position_eligibility`.
Eligible positions are snapshotted on each emailed token
(`eligible_positions`) and enforced at vote time; members eligible for no
position and no ballot item are skipped at send time with a reason.

### Additional Eligibility Checks

Beyond standing, a member may also be restricted by:

- **Membership tier rules** — Organization settings
  (`membership_tiers[].benefits`) can mark a tier as not voting-eligible
  (`voting_eligible`) or require a minimum meeting attendance percentage
  (`voting_requires_meeting_attendance`, `voting_min_attendance_pct`). Both
  apply to plain positions as well as ballot items. See
  [Voting Attendance Window](#voting-attendance-window)
- **Attendance requirement** — Individual ballot items can require the voter
  to be checked in as present at the meeting (`require_attendance`). The roll
  is frozen at open, so a member checked in after opening is recorded present
  but cannot vote without an override
- **Election-wide rules** — `elections.eligibility_rules` holds a
  meeting-attendance requirement and a waiting period per member type that
  every voter in that election must meet, whatever the ballot item. See
  [Election-Wide Voter Rules](#election-wide-voter-rules)
- **Restricted voter list** — An election can be limited to a specific
  `eligible_voters` list. An empty list is stored as `NULL` (no restriction)
- **Secretary overrides** — The secretary can grant eligibility overrides for
  individual members, chosen by name on the **Overrides** tab, bypassing
  tier, attendance and role checks for both ballot items and plain positions.
  On an election restricted to an `eligible_voters` list, an override
  **extends** the list: the member votes in the app, is sent a ballot email
  and counts in the eligible total, as the roster shows

### Election-Wide Voter Rules

`elections.eligibility_rules` (`ElectionEligibilityRules`) is copied from
the department's defaults (`org.settings.election_eligibility.rules`, set on
**Election Settings → Voter Eligibility**) when the election is created. An
explicit value on the create request, `null` included, wins. It can be changed
while the election is a draft or taking nominations; the update endpoint
refuses it once the election is open. `NULL` means no rules, which is what
every election created before the column existed carries.

- **Attendance, count mode**: the member attended at least `min_meetings` of
  their last `of_last_meetings` eligible meetings. A member who has had fewer
  eligible meetings than the look-back is held to the same proportion, rounded
  up, so 6 of 12 becomes 2 of 4 (`required_recent_meetings`).
- **Attendance, percent mode**: `min_pct` of the meetings in the last
  `period_months`. This is the same calculation as the tier rule.
- **`meeting_types`**: limits which meeting types count. `null` counts every
  meeting.
- **`waiting_periods`**: per member type, whether that type may vote. See
  [Waiting Periods by Member Type](#waiting-periods-by-member-type).

Both attendance modes judge the same eligible meetings as the tier rule (see
[Voting Attendance Window](#voting-attendance-window)): meetings since the
current stint began, up to the department's today, excluding waived meetings
and leave.

The rules are part of the universal gate (`ElectionService._universal_gate`),
together with the tier's `voting_eligible`. That gate is used by the in-app
ballot check, per-item annotation, the eligibility roster, the roll frozen at
open, emailed-ballot snapshots and the turnout denominator, so they cannot
disagree. A voter override bypasses the rules. Runoffs and clones copy them.

### Waiting Periods by Member Type

`waiting_periods` maps a member type to one of three settings:

- **No waiting period** (`none`), which is also what an unlisted type means.
- **Never eligible to vote** (`never`).
- **Wait a number of months** (`months`, 1–600).

**Which type a member is.** The class decides first: an administrative or
social member follows that class's setting whatever their status. Every
operational member follows their status: regular, life, probationary, junior,
retired or honorary (`voter_type_key` in `app/utils/membership.py`). A
prospective member, or one on a custom tier that implies no class, gets no
setting.

**When the wait starts.**

- The wait counts from **when the member became that type**. That is
  `users.member_class_since` for a class-decided type and
  `users.member_status_since` otherwise.
- `_reconcile_membership` stamps both on every write path. A re-save of the
  same value does not move them.
- The count never starts before the member's current stint, so a member who
  rejoined is not credited with time from before they left.
- With no stamp, the start of the stint stands in. With neither, the member
  is not held back, because a missing record is not evidence of a recent
  change.
- Members who existed before migration `c7e2a91f4d36` have a best-guess date:
  the last tier change, or else the hire date.

**Per-member override.** It is set on the member's profile, in the **Voting
eligibility** card (`elections.manage`), and every change is audit-logged as
`member_voting_wait_override_changed`.

- **Count the wait from** (`voting_wait_from`) replaces the recorded date
  outright, and is not clamped to the stint. A later change to the member's
  class or status clears it, since it described their previous type.
- **Waive the waiting period** (`voting_wait_waived`) lifts a timed wait. It
  never lifts **Never eligible to vote**, nor an attendance requirement. A
  per-election voter override still lifts everything.
- Setting either one requires a reason. Clearing both removes the reason.
- Changes reach every election whose roll is not yet frozen. An open election
  keeps the roll it froze.

### Voter-Roll Freeze

Opening an election snapshots the eligible roster
(`eligible_roster_snapshot`). Membership changes during voting do not change
who may vote or the turnout denominator; secretary overrides still admit a
member. The eligibility roster reads the frozen roll, so a member created
after open is not listed as receiving a ballot. A `NULL` snapshot means
eligibility is evaluated live.

### Voting Attendance Window

`attendance_window()` in `membership_tier_service.py` returns
`(max(cutoff, current_stint_start), org_today)`:

- the cutoff is `voting_attendance_period_months` (default 12) **calendar**
  months back (`relativedelta`, not 30-day months);
- the stint start is the latest `MemberServicePeriod`, else `hire_date`, so a
  recent hire or reinstated member is not charged with meetings held before
  they (re)joined;
- the window ends at the department's today, so a meeting already scheduled
  for next week is not an absence.

`tally_attendance()` classifies meetings by id sets, so a meeting that is both
waived and inside a leave is excluded once, and attendance counts only inside
the eligible set. A member with no eligible meetings reads as 100%. The ballot
check and the secretary's attendance dashboard
(`GET /meetings/attendance/dashboard`) both call these functions, so they
cannot disagree.

### Eligibility Roster

The **Eligibility** tab (`EligibilityRoster`,
`GET /elections/{id}/eligibility-roster`) lists every active member with
per-ballot-item eligibility. Rows are colour-coded: green (eligible), red
(ineligible), blue (override), muted (voted). It has search, filter buttons
(**All Members**, **Eligible**, **Ineligible**, **Already Voted**, **Has
Override**) and expandable per-member detail rows (Enter/Space).

### Eligibility Edge Cases

| Scenario                                                         | Behavior                                                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member with role `emt` but member class `administrative`         | Not eligible for `operational` ballot items                                                                                                                                            |
| Neither class/status nor membership type set on member           | **Treated as operational + regular.** `split_membership_type(None)` returns the defaults, so an entirely blank standing qualifies for `operational` **and** `regular` — not just `all` |
| Member on an org-configured tier (e.g. the shipped `senior`)     | Matches **no** class and no status — eligible for `all` (and any role-slug rule) only                                                                                                  |
| Life member, on an `operational` ballot item                     | **Not** eligible — `operational` requires regular status. They are eligible for `regular` and `life` items                                                                             |
| Life member, on a `regular` ballot item                          | **Eligible**                                                                                                                                                                           |
| Administrative member with regular standing, on a `regular` item | **Not** eligible — status categories also require the operational class                                                                                                                |
| Secretary override on an ineligible member                       | Blue roster row with override badge; eligible for all items                                                                                                                            |
| Eligibility roster with 0 members                                | Empty state with message                                                                                                                                                               |

---

## Ballot Builder and Voting Methods

The **Ballot** tab (`BallotBuilder`) is a card-based editor with `@dnd-kit`
drag-and-drop reordering, expandable inline editing, colour-coded type
badges, two-step inline delete, a template popover and summary pills.
Position fields load the organization's operational ranks (Chief, Captain,
etc.) with type-ahead filtering; each position may appear on only one ballot
item. Candidates are matched to ballot items by exact position, with a
title-based fallback.

Ballot item types are `membership_approval`, `officer_election` and
`general_vote`; vote types are `approval` (Approve/Deny) and
`candidate_selection`.

### Ballot Definition Rules

Enforced on create and update:

- ballot-item ids match `^[A-Za-z0-9_-]+$` and are unique per ballot;
- voting methods and victory conditions must be known values;
- `victory_percentage` is required for supermajority items;
- voter-type lists are de-duplicated and `'all'` cannot be combined with
  other types;
- position names are unique case-insensitively;
- quorum is cross-validated — `quorum_value` is required when quorum is
  enabled; a **percentage** quorum caps at 100 while a **count** quorum may
  exceed it.

### Methods and Conditions

| Setting           | Values                                                          |
| ----------------- | --------------------------------------------------------------- |
| Voting method     | `simple_majority`, `ranked_choice`, `approval`, `supermajority` |
| Victory condition | `most_votes`, `majority`, `supermajority`, `threshold`          |
| Runoff type       | `top_two`, `eliminate_lowest`                                   |
| Quorum type       | `none`, `percentage`, `count`                                   |
| Tie policy        | `co_winners` (default), `runoff`, `revote`, `chair_decides`     |

The election card describes the method in plain words — "One choice per
voter", "Ranked choice" or "Approval" — with a **Winner** row from
`getVictoryDescription`.

- **Seats per race** — `seats_per_position` (1–50): a multi-seat race marks
  up to that many winners. The victory condition decides who qualifies,
  measured against ballots cast rather than vote rows; a tie on the last seat
  follows the tie policy. Refused with ranked choice (on the election or any
  item) and with a `max_votes_per_position` below the seat count. Runoffs and
  clones copy it.
- **Tie policy** — Under `co_winners` tied candidates all win and the result
  is still flagged `is_tie`. The other policies declare no winner on a tie,
  flag it in results and the UI, and audit `election_tie_detected` at close.
- **Write-ins** — Stored as typed. Spelling variants are consolidated under
  one candidate via an audited alias (`merged_into_candidate_id`,
  `POST /elections/{id}/write-ins/merge`); signed vote rows are never
  mutated, so integrity verification still passes. Checking "Write-in
  candidate" on the candidate form auto-fills the name and clears the linked
  member.
- **Candidate edits after votes** — Changing the name, position or acceptance
  of a candidate with (non-test) votes is refused; values are compared, so a
  statement edit still saves. Statements are capped at 5,000 characters, and a
  cleared statement is sent as `null`.

### Saved Ballot Templates

A secretary who runs the same officer slate every year saves the ballot as a
**named, reusable template** and applies it to next year's election instead of
rebuilding it item by item.

- **Configuration only, by construction.** A template snapshots the ballot
  _structure_ — items, positions, voting methods, victory conditions,
  eligibility types — and never candidates, voter rosters, votes, tokens,
  attendance, or lifecycle state. The create schema is `extra="forbid"`, so a
  payload carrying any of those is rejected with 422 rather than stored.
- **Org-scoped, `elections.manage` only.** List, save, and delete all require
  `elections.manage` and filter to the caller's organization — there is no
  `elections.view`-level read. Cross-org ids 404. An organization may hold up
  to 200 templates.
- **Case-insensitive unique names.** Uniqueness is enforced per org on
  `name_key` (SHA-256 of the NFKC-normalized, casefolded name), so "Annual
  Officers" and "annual officers" collide with a 409 while the display name
  keeps its original casing.
- **Applying regenerates item ids.** The BallotBuilder's template picker has a
  "Your saved ballots" section; applying a template replaces the current
  ballot (two-step confirm) and mints fresh ballot-item ids.
- **Survives its author.** `created_by` is `SET NULL` — deleting the member
  who saved a template leaves the department's template intact.
- Audit events `ballot_template_created` / `ballot_template_deleted`
  (category `elections`).

### Ballot Preview and Printable Ballot

- **Preview ballot** (`GET /elections/{id}/preview-ballot`) shows the ballot a
  given member would receive, using the same eligibility logic as the real
  ballot (`annotate_ballot_items_for_user`). The preview shows the meeting
  date, prospective member info cards on approval items, write-in
  placeholders, a security notice and the election configuration.
- **Print Blank Ballots** (`GET /elections/{id}/printable-ballot`) generates
  the in-room paper ballot from the election itself: positions, accepted
  candidates, write-in lines, method instructions, and "☐ Approve ☐ Deny" for
  each approval item.

### Election Cloning

**Clone Election** ("run it again", `POST /elections/{id}/clone`) creates a
fresh draft from the setup with new dates. It copies ballot items
(deep-copied), positions, position eligibility, seats and rules — never votes,
tokens, attendees, overrides, proxy authorizations or the salt (a fresh salt
is generated) — and optionally copies accepted candidates.
`results_visible_immediately` is reset. The clone opens on `?tab=ballot`.

---

## Casting Votes

### In-App Ballot

`GET /elections/{id}/ballot` returns every item and position with the
member's per-item standing; `POST /elections/{id}/ballot` casts the whole
ballot atomically in the same shape as the emailed ballot. With
`?proxy_authorization_id=` the same endpoints serve a proxy ballot, and
`GET /elections/{id}/ballot/proxies` lists the proxies the current member
holds (named elections only). `POST /vote` and `POST /vote/bulk` remain for
single and atomic multi-vote submissions.

Casting a vote refetches the election in place — the loading skeleton shows
only until the election has loaded once — so the ballot and its receipt stay
on screen.

### Emailed (Token) Ballot

**Send Ballot Emails** (`POST /elections/{id}/send-ballot`) issues each
eligible member a unique voting token and emails a "Vote Now" link. It is
available only while the election is **open**; drafts are previewed with a
test ballot instead. The button shows in text why it is disabled when it is.

The send runs in the background (`POST /elections/{id}/ballot-send-jobs`),
so a large roster no longer hits the browser's 30-second timeout. The dialog
stays in its sending state until it finishes. Leaving the page does not stop
the send. A second send for the same election is refused while one is still
running, so members are not mailed twice. A resend gives each member a new
link and leaves the earlier one working; each member still votes only once.

- Tokens are stored as SHA-256 hashes; the raw token exists only in the
  emailed link, and always travels in a POST body, never a query string or
  path.
- Each token snapshots the voter's eligible ballot items
  (`eligible_item_ids`) and positions (`eligible_positions`). The lookup
  returns only those items, positions and candidates, in a minimal view with
  no roster or PII fields; submission enforces the same sets. A token with no
  snapshot (`NULL`) is unrestricted, bounded by token expiry.
- Votes are method-aware: approval allows one vote per candidate,
  ranked-choice takes unique ranks per candidate (submitted as `rankings`),
  multi-select submits `candidate_ids`.
- A token restricted to one position is marked fully used once that vote is
  cast, even if the election has more positions.
- `email_recipients` records only successfully sent ballots; skipped members
  and reasons are kept in `email_skipped_details` for the last send or
  reminder. With `send_eligibility_summary`, the sender receives a summary
  email listing who was sent a ballot and who was skipped and why (no email,
  ineligible, already voted).
- Sending is concurrent with per-recipient error isolation, so one failed
  address does not stop the rest. When nobody is found, the response explains
  why instead of reporting success with zero recipients.

Lookup messages distinguish dead links: a link replaced by a reminder reads
"This link was replaced by a newer ballot email"; a link retired by a
zero-vote rollback says the election was closed and reopened; a token for a
closed election reads "Voting has closed".

### Proxy Voting

When enabled in Election Settings, officers authorize a proxy for an absent
member (`POST /elections/{id}/proxy-authorizations`). The proxy votes through
the proxy ballot or `POST /elections/{id}/proxy-vote`. **Max Proxies Per
Person** (1–10) is enforced.

### Test Ballots

**Send Test Ballot** (Election Settings → Test Ballot, or
`POST /elections/{id}/send-test-ballot`) sends the sender a flagged token.
The mail carries a "[TEST]" subject and stamp; the lookup reports `is_test`;
votes are stored `is_test`, excluded from results, stats and rosters, and
never consume the sender's real vote. The receipt reads `counted: false`.
A test send does not set `email_sent`.

### Vote Receipts

Ballot submissions return receipt hashes. `POST /elections/{id}/verify-receipt`
with `{"receipt": …}` in the body verifies one publicly (rate-limited); the
`GET ?receipt=` form is deprecated. A voided vote's receipt returns
`verified: false, voided: true` with "This vote was voided by an officer".

### Vote Integrity Rules

- **Serialized validation.** `cast_vote` takes a `SELECT … FOR UPDATE` lock on
  the election before inspecting prior votes, so two simultaneous requests
  cannot both pass the per-voter limit check. Token votes re-read the
  election and token state after acquiring their row locks.
- **One vote-target resolver.** `cast_vote`, the proxy route and the token
  route share one resolver: a vote's stored position, the duplicate/limit
  filters and the dedup hash all use `position or candidate.position`, so
  omitting `position` cannot open a second vote, and an item id passed as
  `position` cannot skip the attendance rule. In-app votes on a ballot-item
  election carry the item id as their position.
- **One voter, one vote across channels.** In-app and token votes on a named
  election key on the same voter hash; `get_non_voters` and `total_voters` do
  too.
- **Method-aware dedup hash.** `vote_dedup_hash` carries a discriminator so
  approval and ranked-choice ballots can hold several rows per position while
  the unique constraint still blocks a true duplicate. Both submission routes
  compute the same fingerprint and recognise every label a contest can be
  recorded under. The hash is nulled when a vote is soft-deleted, so a voided
  voter can vote again; an `IntegrityError` on either route returns 400.
- **Name collisions.** When a plain position and a ballot item share a name,
  a vote must clear **both** rule sets (and every colliding name). The check
  is defined once and reused by every vote-submission route.
- **Mixed elections.** Position eligibility is checked before a member with
  zero eligible ballot items is skipped, and a plain-position vote does not
  mark a token fully used while a ballot-item vote is outstanding.
- **Voiding a vote.** `DELETE /elections/{id}/votes/{vote_id}` is scoped to
  the path's election and requires a `reason` of 3–500 characters.

### Voting Edge Cases

| Scenario                                                        | Behavior                                                                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Token vote on an item the voter isn't eligible for              | Rejected with the item title in the error; abstaining on it is allowed                                      |
| Token holder votes for a position their standing can't vote for | Rejected ("You are not eligible to vote for …"); omitting `position` falls back to the candidate's position |
| Test ballot vote followed by the sender's real vote             | Both succeed; only the real vote counts                                                                     |
| Approval voter approves two candidates for one position         | Both votes recorded; duplicate candidate rejected                                                           |
| Ranked-choice voter submits ranks 1–3                           | All recorded atomically; duplicate rank or candidate rejected                                               |
| Ranked-choice election by email ballot                          | Voter assigns unique ranks per candidate; submission order defines rank 1..n                                |
| `?token=` ballot link                                           | Accepted; the page scrubs the URL                                                                           |

---

## Nominations

When the **nominations** feature is enabled, an officer opens a nomination
phase (`POST /elections/{id}/open-nominations`). Any member can nominate a
member or themselves; the nominee accepts or declines (a declined entry is
removed). A member may have at most 10 pending third-party nominations per
election. Closing nominations — manually or automatically at
`nomination_deadline` — returns the election to draft for the secretary to
finalize the ballot.

The member-facing candidate list (`GET /elections/{id}/candidates`) returns
pending (unaccepted) nominations only while the election is in its
nominations phase, so nominees can see and respond. In every other phase,
members see accepted candidates only; callers holding `elections.manage`
always see the full list.

---

## Paper Ballots and Attestation

With **paper ballots** enabled, officers record in-room paper tallies
(`POST /elections/{id}/manual-ballots`): up to 50 candidate lines of 1–500
ballots each, with an optional physical `ballots_cast` count (1–2,000) that
makes quorum math exact. Entries are plausibility-guarded.

With attestations required (default **2**, configurable 0–3 — e.g. the
secretary records, the President and Chief or their designees validate), a
recorded batch starts **pending**: its votes are signed and chained
immediately but excluded from results and stats. Officers with
`elections.manage` attest via the batch panel on the election page; the
recorder can never attest their own batch and each officer counts once. When
the snapshotted requirement is met the batch flips to **confirmed** and its
ballots count. A disputed batch is voided with a reason.

- Attestation is only possible while voting is open. A batch still pending at
  close stays out of the certified results, and the close writes a warning
  `election_manual_ballots_unattested_at_close` audit event.
- The exclusion reaches **every** tally the close path runs: the
  runoff-advancement count and the membership-package Approve/Deny sync each
  carry a SQL predicate (`_is_attested_vote`) that skips votes in a pending
  batch. Electronic votes (no `manual_batch_id`) are unaffected.
- Attestation locks the election as well as the batch, so it cannot race a
  concurrent close. Attestation, voiding and election deletion lock the batch
  and the election in one consistent order, and concurrent voids cannot
  overwrite each other's reason and timestamp.
- Voided batches carry `voided_by`, `voided_at`, `void_reason` and
  `over_count_override`, shown on the batch card.
- Merge, void and batch-void remain allowed after close.

---

## Closing, Results and Reporting

### Closing

Closing (manual or automatic) finalizes results, evaluates runoff conditions,
stamps `closed_at` / `closed_by`, and — on anonymous elections — erases
per-vote IP address and user agent and destroys the anonymity salt. Runoffs
are evaluated on every close, including an early close.

### Runoffs

Auto-created runoffs inherit the parent's rules — quorum, position
eligibility, the meeting/event link, attendees, voter overrides, tie policy,
seats and the parent's candidate-selection items — and generate their own
anonymity salt. The description names the tie. The
`runoff_election_created` audit event is written on the parent with a mirror
on the child. The `RunoffChain` component shows a multi-stage election as a
horizontal timeline, built by walking `parent_election_id`, with the current
election marked `aria-current="page"`.

### Results

`GET /elections/{id}/results` is visibility-gated. Results include per-item
outcomes with a `label`; `overall_results` holds only candidates in no
contest, and the runoff check reads each race separately. Ties are flagged
(`is_tie`), and `quorum_met` is `None` with "No quorum requirement" when
`quorum_type == 'none'`.

Turnout and quorum denominators count only voting-eligible members:
membership tiers marked not voting-eligible are excluded, and
secretary-override members are counted back in.

The **Results & Publishing** panel (`PublishResultsPanel`) shows vote count
and turnout, a **Publish Results** toggle (only when closed), and **Email
Results Report** / **Send Report** (only after close).

### Reports

- **Results report email** (`POST /elections/{id}/send-report`) is refused
  with 400 until the election closes. **Send Report** emails it to the officer
  who pressed it. The automatic copy at close goes, one message each, to the
  election's creator and every leadership member who is a current member
  (active or probationary) and receives election-administration email; a
  creator who has left gets nothing. When nobody qualifies, the close logs an
  error and audits `election_report_not_sent`. It prints the close time and actor
  ("… by Sam Ortiz", or "Automatic close"), per-item outcomes, tie wording
  ("Tie — co-winners per the election's tie policy" / "Tie — no winner
  declared; runoff round created") and recipient facts drawn from
  `email_recipients` and `email_skipped_details`.
- **Certified results package** (`GET /elections/{id}/certified-results`,
  closed elections only) is a formal PDF with tallies, turnout/quorum, the
  attestation trail, integrity verification and officer signature lines.

### Live Turnout Dashboard

A meeting-night panel (`LiveTurnoutPanel`, fullscreen-capable) shows ballots
received versus eligible and quorum progress, auto-refreshes, and never shows
candidate tallies before close.

### Closing Edge Cases

| Scenario                                            | Behavior                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Election closed before its end date with no winner  | Runoff still created (when runoffs enabled)                                              |
| Runoff opened at the meeting (default start is +1h) | Opening clamps a future start to "now"; draft dates are also editable via **Edit Dates** |
| Opening an election whose end date already passed   | Refused — update the dates first                                                         |
| Reopen closed anonymous election with votes         | Refused — create a new election instead                                                  |
| Runoff chain for standalone election                | Shows single-node chain                                                                  |
| Results tab auto-select                             | Navigates to Results when the election is closed                                         |

---

## Opening and Dates

Opening an election (`POST /elections/{id}/open`) clamps a future start date
to the open time (audited as `start_adjusted_to_open_time`), so a same-meeting
runoff works in one click. An election whose end date has passed cannot be
opened, and an election with only ballot items and no candidates can be
opened. Errors name the problem (e.g. "Election has no candidates").

Drafts have an **Edit Dates** modal with **Start Now** and 15 Min / 30 Min /
1 Hour / 1 Day quick durations; open elections have **Extend Election Time**
(which also shortens). Quick durations and **End of Day** are computed in the
organization's time zone.

Opening an election with no ballot items warns that ballot emails cannot be
sent once it opens and members will vote in the app only.

---

## Lifecycle Automation

The `election_lifecycle` scheduled task (every 15 minutes) automates status
transitions and reminders:

- **Auto-close**: OPEN elections past `end_date` are closed automatically.
  Votes are already rejected after `end_date`; closing is what finalizes
  results, evaluates runoffs, and runs the anonymous-election IP purge and
  salt destruction. Not optional.
- **Auto-open**: DRAFT elections are opened at `start_date` only when the
  creator enabled **Open Automatically at Start Time** (`auto_open`). The real
  open path runs, so an invalid draft (e.g. no candidates) is skipped and
  retried, never force-opened. The ballots are then emailed as the election's
  creator, with links on `FRONTEND_URL`; a send that fails or reaches nobody
  leaves the election open and emails every `elections.manage` holder to send
  them (`ballots_auto_sent` / `ballots_auto_send_failed` audit events).
- **Nomination auto-close**: an election in the nomination phase with a
  `nomination_deadline` returns to draft automatically once the deadline
  passes (audited as `nominations_auto_closed`).
- **Automatic reminder**: when `reminder_hours_before_close` is set, the task
  sends exactly one reminder to members who haven't voted once the window
  opens. Any reminder (manual or automatic) stamps `reminder_sent_at`, which
  suppresses the automatic one.

Audit events: `election_auto_opened`, `election_auto_closed`,
`election_reminder_sent`.

### Reminders

**Remind non-voters** (`POST /elections/{id}/remind-non-voters`) emails only
eligible members who haven't voted, with a minimum of 60 minutes between
reminder sends. The mail is titled "Reminder: vote in …" and each reminded
member gets a fresh voting link; the previous link is stamped `superseded_at`.
The vote dedup hash guarantees at most one vote per member regardless of how
many links they hold.

Like ballot sends, a reminder runs in the background
(`POST /elections/{id}/reminder-send-jobs`), so many non-voters no longer hit
the browser's 30-second timeout, and leaving the page does not stop it. A
reminder cannot start while a ballot send or another reminder for the same
election is still running.

---

## Pre-Meeting Package

Secretaries generate and distribute a **pre-meeting package** for annual and
special meetings — a print-ready PDF containing the linked meeting's details
and agenda, the election configuration (voting method, victory condition,
quorum, proxy availability, runoffs), a full ballot preview with candidates
and statements, the voter-eligibility roster and a per-item eligibility block
(from the roster's `item_eligibility`).

- **Two privacy variants** (`variant=member|full`): the _member_ variant lists
  eligible voters and counts only; the _full_ variant (leadership) adds
  per-member ineligibility reasons and granted overrides. Membership-tier and
  attendance details are never broadcast to the general membership
- **Editable recipients**: the send modal prefills from leadership or the
  eligible-voter roster, and the secretary edits the list freely — remove
  anyone, add outside addresses (e.g. board counsel). Each recipient gets
  their own email, so nobody sees another's address, and the confirmation
  names any address the package could not be sent to. The send runs in the
  background, so a long list does not time out
- **Download-only flow**: the PDF can be downloaded directly (no email) and
  attached to the secretary's own communication or filed with the minutes
- **Email backends**: the PDF attaches on SMTP and on the Cloudflare email
  backend (base64 API attachments within the 5 MiB message cap)
- Available for draft and open elections from the **Communication** section
  of the election detail page; sends and downloads are audit-logged
  (`pre_meeting_package_sent` / `pre_meeting_package_downloaded`)

---

## Meeting and Event Links

An election links to either a meeting record (`meeting_id`) or an event of
any type (`event_id`) from the **Linked Meeting** field on the detail page
(**Link Meeting or Event**). Clearing the link sends explicit `null`s, and a
no-op change shows no toast. The detail page also lists upcoming events for
quick linking.

**Import Attendees from Meeting / Event**
(`POST /elections/{id}/import-meeting-attendees`) copies members marked
present at the linked meeting, or members who checked in to the linked event
(or RSVP'd "going" if nobody has checked in yet), into the election's
attendance list. Members already present are skipped. Check-ins otherwise go
through the audited attendee endpoints; attendees cannot be set in the create
payload.

Event detail pages and meeting minutes detail pages show **Linked Elections**
with status badges and links.

---

## Election Settings

`/elections/settings` (`elections.manage`) has six sections:

| Section               | Contents                                                       |
| --------------------- | -------------------------------------------------------------- |
| **Proxy Voting**      | Enable/disable proxy voting; **Max Proxies Per Person** (1–10) |
| **Voter Eligibility** | Default voter rules for new elections (below)                  |
| **Features**          | Per-department feature toggles (below)                         |
| **Defaults**          | Where a new election's form starts (below)                     |
| **Test Ballot**       | **Send Test Ballot** to preview the voting experience          |
| **Security**          | The integrity guarantees in force                              |

### Voter Eligibility Defaults

Stored in `org.settings.election_eligibility` (`EligibilityDefaults`). Each
part has a reader, and none of them changes an existing election:

- **Rules every voter must meet** (attendance, waiting periods) are copied onto each new
  election. See [Election-Wide Voter Rules](#election-wide-voter-rules).
- **New ballot items**: the check-in requirement and **Who can vote** that new
  and custom items start with in the ballot builder. Built-in templates keep
  their own per-template voter types.
- **Who votes for each position**: position name → voter types. A new
  election's `position_eligibility` is seeded for the positions it names,
  matched without regard to case, and a custom ballot item takes the mapped
  voter types when its position is chosen.
- **Membership tier rules** are shown read-only (`tier_voting_rules`) with a
  link to the tier settings where they are edited.

#### Regular Business Meetings and the Annual Meeting

Every election records where it is held, in `elections.meeting_kind`: either
`regular` (a business meeting) or `annual`. The section keeps two sets of the
defaults above, and an election copies the set for its kind:

- **Regular business meetings** use `org.settings.election_eligibility`.
- **The annual meeting** uses `org.settings.election_eligibility_annual` when
  **Use different rules at the annual meeting** is on. It starts as a copy of
  the regular set, so only what differs needs changing. When the toggle is
  off, the setting is `null` and the annual meeting uses the regular set.
- **On the create form**, **Held at** sets the kind. Linking a meeting record
  whose type is annual selects **Annual meeting**. Calendar events carry no
  annual type. A request that omits the kind gets `annual` from a linked annual
  meeting, and `regular` otherwise.
- **Changing an election's kind** on its Eligibility tab replaces its rules and
  `position_eligibility` with that kind's defaults, after a confirmation. This
  is allowed until voting opens. Rules sent in the same request win.
- **Runoffs and clones** keep the kind.

The membership tier rules apply at both kinds of meeting.

### Defaults

The **Create Election** form starts from the department's defaults (since
2026-10-29, ELEC2-9): the winner rule and its percentage, anonymous voting,
write-ins, and the quorum. An officer can change any of them on one election,
and elections already created are unaffected. With nothing saved, the form
starts where it always did: most votes wins, anonymous, no write-ins, no
quorum. The form has no quorum control of its own, so a default quorum shows
there as a read-only line. Only the form reads these: an election created
directly through the API takes the schema's own defaults. Runoffs and results
visibility have no default and are set on each election.

### Feature Toggles

**Features** lets each department turn optional workflows on or off (all ON
by default; stored in `org.settings.election_features`; enforced in the
service layer, hidden in the UI):

- `nominations_enabled` — nomination phase and member nominations
- `paper_ballots_enabled` — officer paper-tally entry
- `reminders_enabled` — manual and automatic non-voter reminders
- `auto_open_enabled` — scheduled opening of flagged drafts
- `paper_ballot_attestations_required` — officers (besides the recorder) who
  must confirm each paper batch before it counts (0–3, default **2**)

Not toggleable by design: automatic closing at `end_date` and the
nomination-deadline auto-close. Closing finalizes results and runs the
anonymous-election IP/salt purge — a privacy guarantee, not a convenience —
and an in-flight nomination phase must always be closeable.

---

## Anonymity, Audit and Forensics

- **Anonymous elections** store a per-election salted voter hash instead of a
  voter id. `vote_cast` audit rows carry no `user_id`, voter-action audit
  events record no IP address, and the forensics report's
  `deleted_votes.records[].candidate_id` is `null`.
- **IP purge at close**: anonymous elections erase per-vote IP and user agent
  when closed. The forensics report (`GET /elections/{id}/forensics`) returns
  a thresholded suspicious-IP set (`suspicious_ips`, `unique_ip_count`,
  `ip_metadata_purged`) rather than a per-IP vote map, and reports tokens as
  issued / used / superseded / expired / live.
- **Integrity chain**: votes are signed and hash-chained;
  `GET /elections/{id}/integrity` verifies signatures.
- **Audit logging**: every state change (create, open, close, extend,
  rollback, delete, nominations, paper batches, overrides, proxies) is
  audit-logged with actor and metadata. The Audit Log page resolves
  `username` server-side and shows "system" only when `user_id` is null.
- **Deleting an election** (`DELETE /elections/{id}`) cascades its voting
  tokens. Draft elections delete freely; open or closed elections require a
  reason (10–500 characters), and leadership is emailed and an
  `election_deleted_critical` audit event written only after the delete
  commits.
- **Public token routes** are rate-limited per IP: ballot reads and receipt
  checks 10 per minute, vote submissions 5 per minute.
- All election responses use `UTCResponseBase` for UTC datetime
  serialization, and `/elections` responses are excluded from the frontend
  API cache.

---

## Email Templates

Election mail is rendered from editable email templates, including
`ballot_notification`, `election_rollback` and `election_report`. The ballot
mail says the link "opens your ballot", omits the meeting line when there is
no meeting, and prints the time zone. An edited template keeps its own text.

---

## Known Limitations

- **Emailed ballots cover ballot items only.** An election built from plain
  positions alone cannot email ballots; members vote in the app. Opening such
  an election shows a warning.
- **Paper tallies record candidates only.** `ManualBallotEntry` takes a
  `candidate_id`, so paper votes on Approve/Deny ballot items cannot be
  recorded, although the printable ballot carries them.
- Owner decisions still open are tabled in `docs/KNOWN_LIMITATIONS.md` under
  "Elections — Owner Decisions From the W50 Drive".

---

## Cross-Module Connections

- **Prospective Members** — Election packages are generated from pipeline
  stages. They bundle interview and coordinator material (applicant PII), so
  they require `prospective_members.view`, `prospective_members.manage` or
  `elections.manage` — not `elections.view`. Membership-approval votes sync
  each package to `elected` / `not_elected` at close. Electing or
  transferring a prospect can auto-generate a department email address, with
  a numeric suffix on collision (e.g. `john.smith2@dept.org`).
- **Meetings and Minutes** — Elections link to meeting records, import their
  attendance, and appear on minutes detail pages. Tier attendance rules share
  `attendance_window()` with the meetings attendance dashboard.
- **Events** — Elections link to events of any type and import their
  check-ins; event detail pages list linked elections.
- **Membership tiers** — `membership_tiers` in organization settings supply
  voting eligibility and attendance requirements.

---

## Related Documentation

- [Prospective Members](https://github.com/thegspiro/the-logbook/blob/main/docs/PROSPECTIVE_MEMBERS_MODULE.md)
- [Role System](Role-System)
- `docs/module-audit/elections.md` — module security audit
- `docs/security-review/ELEC-06-elections-ballots.md` — ballot eligibility
  and duplicate-vote review
- `docs/workflow-review/W50-elections.md` — end-to-end browser review
- `docs/KNOWN_LIMITATIONS.md` — open elections items
