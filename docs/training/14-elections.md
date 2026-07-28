# Elections & Voting

The Elections module manages department elections, officer nominations, anonymous voting, proxy authorization, ballot distribution, runoff chains, and forensic audit trails. It supports both in-person meeting votes and remote ballot distribution via email.

---

## Table of Contents

1. [Elections Overview](#elections-overview)
2. [Creating an Election](#creating-an-election)
3. [Configuring Ballot Items](#configuring-ballot-items)
4. [Nominating Candidates](#nominating-candidates)
5. [Voter Eligibility & Overrides](#voter-eligibility--overrides)
6. [Opening an Election](#opening-an-election)
7. [Casting Votes](#casting-votes)
8. [Proxy Voting](#proxy-voting)
9. [Monitoring & Results](#monitoring--results)
10. [Runoff Elections](#runoff-elections)
11. [Vote Integrity & Forensics](#vote-integrity--forensics)
12. [Election Settings](#election-settings)
13. [Meeting Attendance Integration](#meeting-attendance-integration)
14. [Prospective Member Election Packages](#prospective-member-election-packages)
15. [Realistic Example: Annual Officer Election](#realistic-example-annual-officer-election)
16. [Troubleshooting](#troubleshooting)

---

## Elections Overview

Navigate to **Elections** in the sidebar or from **Events & Meetings > Elections** to view all department elections.

The elections module supports:

- **Officer elections** — Annual or special elections for department leadership positions
- **Board elections** — Board of directors or governance body elections
- **General votes** — Membership approval, bylaw amendments, budget approvals
- **Membership approval** — Voting on prospective member applications (integrated with the Prospective Members pipeline)

Key pages:

| URL | Page | Permission |
|-----|------|------------|
| `/elections` | Elections List | `elections.view` |
| `/elections/:electionId` | Election Detail | `elections.view` |
| `/elections/settings` | Election Settings | `elections.manage` |
| `/ballot` | Public Ballot (token-based) | Public (rate-limited) |

> **[SCREENSHOT NEEDED]:** _Screenshot of the Elections list page showing several elections with status badges (Draft in gray, Open in green, Closed in blue), election titles, dates, and vote counts._

---

## Creating an Election

**Required Permission:** `elections.manage`

1. Navigate to **Elections** and click **Create Election**
2. Fill in the election details:
   - **Title** — e.g., "2026 Annual Officer Election"
   - **Description** — Purpose and scope of the election
   - **Election Type** — Officer Election, Board Election, or General
   - **Start Date** — When voting opens
   - **End Date** — When voting closes
   - **Voting Method** — How votes are counted (see below)
   - **Anonymous Voting** — Whether votes are anonymous (recommended for officer elections)
   - **Allow Write-Ins** — Whether voters can write in candidates not on the ballot
3. Click **Create** — the election is created in **Draft** status

### Voting Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| **Simple Majority** | Each voter selects one candidate per position | Officer elections, single-choice races |
| **Ranked Choice** | Voters rank candidates; lowest eliminated in instant-runoff rounds | Contested multi-candidate races |
| **Approval** | Voters may approve any number of candidates; most approvals wins | Board seats, membership approval votes |
| **Supermajority** | Single-choice voting counted against a higher victory threshold | Bylaw amendments |

> **Note:** Approval and ranked-choice ballots are submitted atomically — all of a voter's approvals (or rankings) for a position are recorded together, or none are.

### Victory Conditions

| Condition | Description |
|-----------|-------------|
| **Most Votes** | Whoever gets the most votes wins (ties: all tied candidates flagged) |
| **Majority** | Must receive >50% of total votes cast |
| **Supermajority** | Must reach the configured percentage (`victory_percentage`, default 67) |
| **Threshold** | Must reach a configured absolute vote count (`victory_threshold`) |

> **[SCREENSHOT NEEDED]:** _Screenshot of the Create Election form showing title, description, type selector, date range, voting method dropdown, anonymous toggle, and write-in toggle._

> **Hint:** For bylaw amendments requiring a 2/3 supermajority, set the victory condition to **Supermajority** with **victory_percentage = 67**.

---

## Configuring Ballot Items

After creating an election, add ballot items — the individual questions or positions voters will decide:

1. Open the election detail page
2. Navigate to the **Ballot Items** section
3. Click **Add Ballot Item**
4. Configure:
   - **Position** — The position being filled (e.g., "President", "Vice President")
   - **Candidates** — Add nominated candidates
   - **Write-in allowed** — Whether voters can write in a name
   - **Approval/Denial** — For membership votes, voters approve or deny each applicant

> **[SCREENSHOT NEEDED]:** _Screenshot of the ballot item configuration showing a position field ("Fire Chief"), a list of nominated candidates, the write-in toggle, and Add/Remove candidate buttons._

> **Hint:** Use **ballot item templates** (`GET /elections/templates/ballot-items`) for common configurations like officer positions or membership approval votes.

---

## Nominating Candidates

**Required Permission:** `elections.manage`

1. Open the election detail page
2. Click **Add Candidate** on a ballot item
3. Select the member from the dropdown or enter details for an external candidate
4. Optionally add a **candidate statement** or bio
5. Save — the candidate appears on the ballot item

### Candidate Fields

| Field | Description |
|-------|-------------|
| **Name** | Candidate's full name |
| **Position** | Which position they're running for |
| **Statement** | Candidate statement or bio (shown to voters) |
| **Display Order** | Sort order on the ballot |
| **Accepted** | Whether the candidate has accepted the nomination |

> **[SCREENSHOT NEEDED]:** _Screenshot of the candidate nomination form showing member dropdown, position selector, statement text area, and acceptance checkbox._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Candidate with existing votes | Cannot be deleted (preserves audit trail) |
| Candidate declines nomination | Mark as not accepted; still visible but noted |
| Write-in candidate receives votes | Recorded as-is; counted in results |

---

## Voter Eligibility & Overrides

By default, all active members in the organization are eligible to vote. Eligibility can be restricted by:

- **Membership tier** — Only certain tiers can vote (e.g., Active and Life members, not Honorary)
- **Meeting attendance** — Must be present at the associated meeting
- **Specific voter list** — Manually defined list of eligible voter IDs

### Voter Overrides

**Required Permission:** `elections.manage`

When a member is excluded from voting but should be allowed (e.g., absent member with proxy authorization, or a member whose tier was incorrectly set):

1. Open the election detail page
2. Navigate to **Eligibility Roster**
3. Find the member and click **Grant Override**
4. Enter a reason for the override
5. The member is now eligible to vote regardless of other restrictions

> **[SCREENSHOT NEEDED]:** _Screenshot of the Eligibility Roster showing a table of members with columns for name, rank, tier, attendance status, eligibility status (green check or red X), and an "Override" button for ineligible members._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Member not on attendance list | Ineligible unless override granted |
| Override granted, then member's tier changes | Override persists regardless |
| Bulk override for remote voters | Use bulk override endpoint to add multiple members |

---

## Opening an Election

**Required Permission:** `elections.manage`

When the election is ready:

1. Review all ballot items and candidates
2. Click **Open Election** — status changes from Draft to Open
3. If configured, ballot emails are sent to all eligible voters
4. Voters can now cast their votes via the in-app interface or email ballot link

> **Hint:** Send a **test ballot** to yourself first (`POST /elections/:id/send-test-ballot`) to verify the email rendering and voting link before sending to all members. Votes cast from a test ballot are flagged as test votes — they are excluded from results, statistics, and rosters, and they never consume your real vote.

### Ballot Distribution

When you click **Send Ballots**, the system:

1. Identifies all eligible voters (respecting tier, attendance, and override rules)
2. Generates a unique voting token per voter — the token records which ballot items that voter is eligible for, and this is enforced again when the ballot is submitted (a voter cannot vote on restricted items even by crafting the request manually)
3. Sends an email with a link to the public ballot page (`/ballot?token=...`)
4. Reports how many ballots were sent and which members were skipped (with reasons)

> **[SCREENSHOT NEEDED]:** _Screenshot of the ballot send confirmation showing "42 ballots sent, 3 skipped" with a list of skipped members and reasons (e.g., "No email address", "Ineligible tier")._

> **Hint:** Ballot links are built from the server-configured `FRONTEND_URL`, not the address of the request that triggers the send. Your administrator should set `FRONTEND_URL` to the department's real public site URL (e.g. `https://app.yourdept.org`) so members receive working ballot links — if it is misconfigured, the emailed link points to the wrong host even though the send still reports success.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Member without email address | Skipped during send; reason logged |
| Ballot sent to member who already voted | Second submission is rejected — votes are never overwritten (double-vote prevention is enforced at the database level) |
| Member with zero eligible ballot items | Skipped during send (no empty ballot); reason shown in the send summary |
| Election opened without ballot items or candidates | Cannot open — at least one accepted candidate or one ballot item is required |

---

## Casting Votes

### In-App Voting (Authenticated)

1. Navigate to **Elections** and open the active election
2. Review each ballot item and the candidates
3. Select your choice for each position (or your approvals/rankings for approval and ranked-choice elections)
4. Click **Submit Vote** — for approval and ranked-choice elections all of your selections for the position are submitted together, atomically
5. A **receipt hash** is returned with your submission — save it; you can later confirm your vote was recorded via the receipt verification endpoint without revealing who you voted for

### Email Ballot Voting (Token-Based)

1. Open the ballot email from your department
2. Click the voting link
3. The public ballot page loads with your ballot items — you only see the items you are eligible to vote on
4. Select your choices
5. Click **Submit** — no login required; the token authenticates you. The confirmation screen shows your vote receipts — save them if you want to verify your votes later

> **[SCREENSHOT NEEDED]:** _Screenshot of the public ballot page showing the election title, a position ("Fire Chief") with three candidate options as radio buttons, a write-in text field, and a Submit button at the bottom._

### Bulk Voting

For elections with multiple ballot items, votes can be submitted atomically using bulk vote — all positions submitted in a single request.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Voter tries to vote twice for the same candidate/position | Rejected (enforced at the database level); approval voters may still add approvals for *different* candidates, and ranked-choice voters one vote per rank |
| Voter tries to vote on a restricted ballot item | Rejected at submission — eligibility is enforced server-side, not just hidden in the UI |
| Token expired | Tokens expire at the election end date (or after 30 days, whichever is sooner); the secretary can re-send the ballot |
| Write-in candidate name matches existing candidate | Recorded as separate write-in entry |
| Ranked choice with incomplete ranking | Only ranked candidates counted; unranked treated as not preferred |
| One vote in a bulk submission fails | The entire submission is rolled back — no partial ballots |

---

## Proxy Voting

When enabled for the organization, proxy voting allows one member to vote on behalf of another who cannot attend.

**Required Permission:** `elections.manage` (to authorize)

### Authorizing a Proxy

1. Open the election detail page
2. Navigate to **Proxy Authorizations**
3. Click **Authorize Proxy**
4. Select the **delegating member** (who can't attend)
5. Select the **proxy holder** (who will vote for them)
6. Save — the proxy holder receives email notification

### Casting a Proxy Vote

1. The proxy holder navigates to the election
2. A **"Vote as Proxy"** button appears for each member they're authorized to represent
3. They cast the vote on behalf of the absent member
4. The vote is recorded under the delegating member's name with audit trail showing proxy details

> **[SCREENSHOT NEEDED]:** _Screenshot of the proxy voting interface showing "Voting as proxy for: FF Johnson" banner at the top, with the standard ballot below._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Max proxies per person exceeded | Default limit is 1 proxy per holder (configurable) |
| Delegating member also votes directly | Whichever vote is cast first stands; the second attempt (proxy or direct) is blocked by double-vote prevention |
| Proxy authorization revoked after vote cast | Vote stands; revocation prevents future proxy votes only |

---

## Monitoring & Results

### During Voting (Election Open)

If **results_visible_immediately** is enabled:
- Real-time vote counts displayed on the election detail page
- Non-voters list shows who hasn't voted yet

If results are hidden until close:
- Only total votes cast is shown (not per-candidate counts)

### After Closing (Election Closed)

**Required Permission:** `elections.manage` (to close)

1. Click **Close Election** — voting ends immediately. Closing early (before the scheduled end date) is fully supported — runoff conditions are still evaluated and membership-approval results still flow back to the pipeline
2. Results are calculated and displayed:
   - Per-position winner (or "No winner" if the victory condition wasn't met)
   - Vote counts per candidate
   - Write-in tally
   - Turnout statistics (turnout counts only voting-eligible members — tiers marked not voting-eligible are excluded from the denominator)

> **Note on early closes:** the results *API* stays gated until the election's scheduled end date has passed. If you close early and want members to see results right away, flip **results visible immediately** on the closed election (the Publish Results panel does this) — internal processes like runoff creation and the emailed report are not affected by the gate.

> **[SCREENSHOT NEEDED]:** _Screenshot of the election results page showing a position ("Fire Chief") with candidate vote counts in a bar chart, the winner highlighted in green, and turnout statistics (e.g., "38 of 42 eligible voters — 90.5% turnout")._

### Non-Voters Report

Navigate to the **Non-Voters** section to see eligible voters who did not participate. Use this for:
- Follow-up reminders (if election is still open)
- Turnout analysis (after close)

---

## Runoff Elections

When **Enable Runoffs** is on and no candidate meets the victory condition at close (including early closes):

1. The system automatically identifies candidates for the runoff — **top two** advance, or **eliminate lowest** drops the last-place candidate, depending on the configured runoff type
2. A **runoff election** is created as a child of the original, in Draft status, with write-ins disabled
3. The **Runoff Chain** view shows the progression: Original → Runoff 1 → Runoff 2 (if needed), up to the configured maximum rounds
4. Each runoff follows the same voting workflow — review it, adjust dates if needed, and open it

> **[SCREENSHOT NEEDED]:** _Screenshot of the Runoff Chain timeline showing the original election (no majority), Runoff 1 (still no majority), and Runoff 2 (winner determined), connected by arrows._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Tie in runoff | Another runoff created; continues until resolved |
| All candidates below threshold | Runoff with all candidates |
| Runoffs disabled | Election closes without a winner; secretary handles manually |

---

## Vote Integrity & Forensics

The elections module includes cryptographic integrity features for audit compliance.

### Vote Receipt Verification

Each vote generates a cryptographic **receipt hash** that:
- Is returned to the voter when they submit their ballot (shown on the confirmation screen — voters should save it)
- Proves the vote was recorded
- Does NOT reveal which candidate was selected
- Can be verified by anyone holding the receipt via `GET /elections/{id}/verify-receipt?receipt=...` (public, rate-limited — returns only the vote's timestamp and position)

### Forensics Report

**Required Permission:** `elections.manage`

Access the **Forensics** tab on the election detail page for:

- **Integrity Check** — Verifies HMAC-SHA256 signatures on all votes (detects tampering)
- **Soft-Deleted Votes** — Shows any votes that were manually removed with reason and who removed them
- **Rollback History** — If the election status was ever rolled back (e.g., reopened after closing)
- **Anomaly Detection** — Flags unusual patterns (multiple votes from same IP, rapid-fire voting)

> **[SCREENSHOT NEEDED]:** _Screenshot of the Forensics report showing an integrity check summary ("142 votes verified, 0 anomalies"), a soft-deleted votes section (empty), and a voting timeline chart._

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Vote signature mismatch | Flagged in forensics report; does not auto-delete vote |
| Secretary deletes a vote | Soft-delete with reason required; audit trail preserved |
| Election reopened after close | Rollback logged in forensics; leadership notification sent. **Not allowed** for anonymous elections that already have votes — the anonymity salt is destroyed at close, so reopening would let prior voters vote again. Create a new election instead |

---

## Election Settings

**Required Permission:** `elections.manage`

Navigate to **Elections > Settings** to configure organization-wide defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| Default Voting Method | Simple Majority | Applied to new elections |
| Default Victory Condition | Majority | Applied to new elections |
| Anonymous Voting | On | Whether votes are anonymous by default |
| Allow Write-Ins | Off | Whether write-ins are allowed by default |
| Results Visible Immediately | Off | Whether results show during voting |
| Enable Runoffs | On | Auto-create runoffs when no winner |
| Proxy Voting Enabled | Off | Whether proxy voting is available |
| Max Proxies Per Person | 1 | How many members one person can represent |

> **[SCREENSHOT NEEDED]:** _Screenshot of the Election Settings page showing toggle switches for each setting and the default voting method dropdown._

---

## Meeting Attendance Integration

Elections can be linked to meetings or events. When linked:

1. **Check-in attendance** at the meeting feeds into voter eligibility
2. Members who are present are marked eligible; absent members are excluded (unless overridden)
3. Import attendees directly from the linked meeting or event using **Import Attendees**

### How to Link an Election to a Meeting

1. When creating the election, select a **Meeting** or **Event** from the dropdown
2. Or link after creation from the election detail page

> **Hint:** For annual business meetings, create the meeting first, take attendance via QR check-in, then open the election. All checked-in members automatically become eligible voters.

---

## Prospective Member Election Packages

When a prospective member reaches the **Election Vote** stage of their pipeline, an **election package** is automatically created. This package contains:

- Applicant snapshot (name, email, phone, address, documents)
- Coordinator notes
- Supporting statement (shown to voters)
- Stage history summary

### Workflow

1. Applicant advances to Election Vote stage → package auto-created
2. Coordinator reviews and marks package as **Ready for Ballot**
3. Secretary opens the election and adds the applicant as a ballot item
4. Members vote to approve or deny
5. Results flow back: package status → `elected` or `not_elected`

> **[SCREENSHOT NEEDED]:** _Screenshot of the election detail page showing a membership approval ballot item with an applicant's name, supporting statement, and Approve/Deny voting options._

See [Membership Management > Prospective Members](./01-membership.md#prospective-members-pipeline) for the full pipeline workflow.

---

## Realistic Example: Annual Officer Election

### Background

**Oakville Fire Department** holds its annual officer election at the December business meeting. Secretary **Sarah Kim** manages the process.

### Part 1: Setup (December 1)

Sarah creates the election:
- **Title:** "2026 Annual Officer Election"
- **Type:** Officer Election
- **Start Date:** December 15 (meeting night)
- **End Date:** December 15 (same-day vote)
- **Voting Method:** Simple Majority
- **Victory Condition:** Majority
- **Anonymous Voting:** On
- **Enable Runoffs:** On

She adds three ballot items:
- **Fire Chief** — Candidates: Lt. Morrison, Capt. Davis
- **Assistant Chief** — Candidates: Lt. Hernandez, FF Brooks, FF Kim
- **Secretary** — Candidates: FF Nguyen (unopposed), Write-ins allowed

### Part 2: Meeting Night (December 15)

1. Members arrive and check in via QR code → attendance recorded
2. Sarah links the election to tonight's meeting → 38 of 42 members present
3. She opens the election and sends ballots:
   - 38 ballots sent to present members
   - 4 skipped (absent without proxy)
4. Members vote on their phones via the ballot link in their email

### Part 3: Results

After 30 minutes, Sarah closes the election:

| Position | Candidate | Votes | Result |
|----------|-----------|-------|--------|
| Fire Chief | Lt. Morrison | 22 (58%) | **Elected** |
| Fire Chief | Capt. Davis | 16 (42%) | Not elected |
| Assistant Chief | Lt. Hernandez | 14 (37%) | → Runoff |
| Assistant Chief | FF Brooks | 13 (34%) | → Runoff |
| Assistant Chief | FF Kim | 11 (29%) | Eliminated |
| Secretary | FF Nguyen | 36 (95%) | **Elected** |
| Secretary | Write-in: FF Walsh | 2 (5%) | Not elected |

**Fire Chief:** Lt. Morrison wins with simple majority (58% > 50%).

**Assistant Chief:** No candidate reached majority → automatic runoff between Lt. Hernandez and FF Brooks. Sarah opens the runoff immediately. After a second vote, Lt. Hernandez wins 21-17.

**Secretary:** FF Nguyen wins unopposed with 95%.

Sarah generates the election report and emails it to the department.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Member says they didn't receive ballot email | Check the send report for skipped members. Verify email address is on file. Re-send ballot to individual member. |
| Ballot email link points to the wrong site or won't load | The emailed link is built from the server's `FRONTEND_URL` setting, not the request URL. Have your administrator set `FRONTEND_URL` to the real public site URL and re-send the ballots. |
| Voter gets "Token expired" error | Tokens expire at the election end date (or after 30 days, whichever comes first). Secretary can re-send the ballot email. |
| Voter gets "not eligible to vote on" an item | Per-item eligibility is enforced at submission. Check the Eligibility Roster; if the member should vote, grant an override and re-send their ballot (the new token picks up their updated eligibility). |
| Election closed accidentally | Use **Rollback** to reopen (requires `elections.manage`); leadership receives notification. **Exception:** an anonymous election that already has votes cannot be reopened after closing — its anonymity salt was destroyed, so reopening would permit double voting. Create a new election. |
| Candidate wants to withdraw | Remove candidate from ballot (only if no votes cast). If votes exist, mark as "declined" instead. |
| Proxy holder can't find proxy vote button | Verify proxy authorization was created. Check that the election is still open. |
| Results don't show after closing | If the election was closed *before* its scheduled end date, results stay hidden until that date passes — flip **results visible immediately** on the closed election (Publish Results panel) to show them now. |
| Vote count doesn't match attendance | Check for proxy votes (counted separately). Check for voter overrides (members not on attendance list). |
| Forensics shows integrity warning | Run full forensics report. Contact system administrator if vote signatures are invalid. |
| Runoff not auto-created | Verify **Enable Runoffs** is on in election settings. Check that the victory condition was set correctly. |

---

**Previous:** [Medical Screening](./13-medical-screening.md) | **Next:** [Prospective Members Pipeline](./15-prospective-members.md)
