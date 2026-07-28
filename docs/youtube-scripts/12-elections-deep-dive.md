# Script 12: Creating, Running & Auditing Elections — The Complete Guide

**Video Type:** Feature Deep Dive (Long-Form)
**Estimated Length:** 38–42 minutes
**Target Audience:** Secretaries, Presidents, Fire Chiefs, election administrators — anyone who runs a department vote
**Roles Covered:** secretary, president, fire_chief (any role holding `elections.manage`)
**Chapters:** 13 (each designed as a standalone clip)
**Companion Content:** Edge-Case Shorts Pack 12a–12k (scripts included at the end of this file)

> **Relationship to other scripts:** This supersedes the elections chapters in
> Script 4 (Chief, Ch. 5) and Script 7 (Secretary, Ch. 6) as the canonical
> deep-dive. Members who just need to vote can watch Script 6's voting segment
> or Short 12d. Short 8E remains the 90-second teaser.

---

## CHAPTER 1: Introduction — Why Digital Elections (0:00 – 2:00)

### HOOK (0:00 – 0:40)

**[SCREEN: A meeting room shot (stock or B-roll) — paper ballots being passed
around, someone tallying on a legal pad. Cut to: the Elections list page with
an open election, live turnout percentage climbing.]**

> "Every department has been here: it's 9 PM at the business meeting, someone's
> counting paper ballots at the front table, someone else is double-checking,
> and a member in the back is asking whether proxies were counted. The Logbook
> replaces all of that — secret ballots, automatic tallying, eligibility rules
> enforced by the system, and a cryptographic audit trail you can hand to
> anyone who disputes the result."

### WHAT WE'LL COVER (0:40 – 2:00)

**[SCREEN: Elections list page, then a quick montage: Ballot Builder,
Eligibility Roster, the public ballot on a phone, the Results page, the
Forensics tab.]**

> "This is the complete guide. We'll create an election from scratch, build the
> ballot, configure who's allowed to vote — down to individual ballot items —
> send it out, watch the votes come in, close it, publish results, handle
> runoffs, and then the part most systems can't do at all: audit it. Vote
> signatures, receipts, forensics, the works."

> "You'll need the `elections.manage` permission for everything in this video —
> by default that's the Secretary, President, and Chief roles."

**[CALLOUT: "Requires: elections.manage permission"]**

---

## CHAPTER 2: Organization Defaults — Election Settings (2:00 – 3:30)

**[SCREEN: Navigate to Elections > Settings (ElectionsSettingsPage)]**

> "Before your first election, take two minutes in Elections Settings. These
> are organization-wide defaults — every new election starts from them, and you
> can override per election."

**[SCREEN: Walk down the settings list, toggling a few]**

> "Default voting method and victory condition — most departments run simple
> majority. Anonymous voting on by default — recommended, and I'll explain the
> anonymity model later because it's genuinely well done. Write-ins, immediate
> results visibility, runoffs. And proxy voting — off by default. If your
> bylaws allow a member to vote on behalf of an absent member, enable it here
> and set the maximum number of members one person can represent."

**[CALLOUT: "Settings are defaults, not limits — each election can override"]**

> "One note for your IT manager: the settings page — like everything else in
> this video — is gated behind the `elections.manage` permission. Members
> can't wander in here."

---

## CHAPTER 3: Creating the Election (3:30 – 7:30)

**[SCREEN: Elections list > Create Election. Fill the form as we talk.]**

> "Let's build a real one: the 2027 Annual Officer Election. Title,
> description, election type — officer election. Start and end dates: I'm
> setting it to open at 7 PM on meeting night and close at 9 PM the same
> night. Don't worry about closing exactly on time — you can close it manually
> the moment the last vote is in, and everything downstream still works.
> More on that in the results chapter."

### VOTING METHODS (4:30 – 5:45)

**[SCREEN: Open the voting-method dropdown, pause on each option]**

> "Four voting methods, and picking the right one matters:"

> "**Simple majority** — each voter picks one candidate per position. This is
> the default and what most officer elections use."

> "**Ranked choice** — voters rank candidates in order of preference. If
> nobody has a majority of first-choice votes, the last-place candidate is
> eliminated and their votes transfer to each voter's next choice, round by
> round, until someone crosses fifty percent. Great for three-plus candidate
> races because it eliminates the spoiler effect."

> "**Approval** — voters approve as many candidates as they like; most
> approvals wins. Perfect for board seats or 'vote for any you support'
> situations. And a technical note: when a voter submits approvals or
> rankings, all of their selections are recorded together in one atomic
> transaction — you can never end up with half a ballot."

> "**Supermajority** — single-choice voting counted against a higher bar,
> which brings us to victory conditions."

### VICTORY CONDITIONS, QUORUM & RUNOFFS (5:45 – 7:30)

**[SCREEN: The victory condition, quorum, and runoff sections of the form]**

> "The victory condition defines what winning means. **Most votes** — a
> plurality, ties flag every tied candidate. **Majority** — more than half of
> votes cast. **Supermajority** — a configured percentage, sixty-seven for a
> classic two-thirds bylaw vote. **Threshold** — an absolute vote count."

> "**Quorum** is separate from winning: it defines whether the election is
> valid at all. Percentage quorum — say, fifty-one percent turnout — or a
> fixed count of voters. Here's the important part: the turnout denominator
> only counts members who are actually allowed to vote. If your organization
> has social or junior tiers marked not voting-eligible, they don't count
> against your quorum. If quorum fails, results still display, but every
> winner flag is cleared and the results are marked advisory."

> "**Runoffs**: enable them and pick a style — top-two advance, or eliminate
> the lowest and re-vote — plus a maximum number of rounds. If no one meets
> the victory condition when the election closes, the system creates the
> runoff for you automatically. We'll run one later in this video."

**[CALLOUT: "Quorum = is the election valid? Victory condition = who won?"]**

> "Finally, link the election to tonight's meeting record or calendar event.
> This is what lets you import meeting check-ins as attendance — which can
> gate voting eligibility. Create — and we have a draft election."

---

## CHAPTER 4: Building the Ballot (7:30 – 11:00)

**[SCREEN: Election detail page, Ballot tab, the card-based Ballot Builder]**

> "The ballot is a stack of items — each one is a question the voters answer.
> Officer positions, bylaw amendments, membership approvals, budget votes."

### BALLOT ITEMS & TEMPLATES (8:00 – 9:00)

**[SCREEN: Click Add Ballot Item, then open the template popover]**

> "Templates cover the common cases — officer election, membership approval,
> general resolution, budget approval — pre-configured with sensible
> eligibility and vote types. Or build a custom item."

**[SCREEN: Create 'Fire Chief' item from the officer template; position
dropdown showing org ranks with type-ahead]**

> "For officer items, the position dropdown loads your organization's actual
> rank structure. One ballot item per position — the dropdown only shows
> unused positions, so you can't accidentally create two 'Chief' items. Drag
> the cards to reorder; the ballot presents them in this order."

### PER-ITEM ELIGIBILITY — THE IMPORTANT PART (9:00 – 10:30)

**[SCREEN: Expand a ballot item's eligibility section. Show the
eligible-voter-types selector and the attendance toggle.]**

> "Each item carries its own eligibility rules, and this is where The Logbook
> is more precise than a paper ballot. **Eligible voter types** map to
> membership types — not roles. 'Operational' means active members.
> 'Regular' means active plus life members. 'Life' means life members only.
> A member who holds the EMT role but is classified administrative is *not*
> operational — classification controls the ballot, positions control system
> permissions."

> "So your officer election item might be open to operational members, while
> the bylaw amendment right below it is restricted to regular members. Same
> ballot, different electorates — and each member only sees, and can only
> vote on, the items they qualify for."

> "**Require attendance** on an item means the voter must be checked in as
> present at the linked meeting. And here's the security guarantee: these
> rules aren't just cosmetic filtering on the ballot page. When a ballot is
> issued, the member's eligible items are locked to their voting token, and
> the server enforces them again at submission. Someone hand-crafting a
> request to vote on a restricted item gets rejected — with an audit trail."

**[CALLOUT: "Eligibility is enforced at the ballot box, not just the mailbox"]**

### PER-ITEM OVERRIDES (10:30 – 11:00)

**[SCREEN: Show victory-condition override fields on a bylaw item]**

> "Items can also override the election-level victory condition — so your
> officer races run majority while the bylaw amendment on the same ballot
> requires two-thirds. Set it once, per item, and the tally handles the rest."

---

## CHAPTER 5: Candidates & Nominations (11:00 – 13:00)

**[SCREEN: Candidates tab. Add candidates to the Fire Chief position.]**

> "Add candidates to each position. Pick the member from the roster — their
> name fills in — set the position, and optionally a statement and photo that
> voters see on the ballot. Display order controls ballot ordering."

**[SCREEN: Toggle a candidate's accepted status]**

> "Candidates have an accepted flag. If someone declines the nomination, mark
> them not accepted — they stay visible in your records but voters can't vote
> for them."

**[SCREEN: Attempt to delete a candidate who has votes — show the block]**

> "Two guardrails: a candidate with recorded votes can't be deleted — that
> would corrupt the tally and the audit trail. Mark them declined instead.
> And write-in candidates, when you allow them, are created automatically at
> vote time with the name the voter typed — sanitized, and flagged as
> write-ins in the results."

> "For membership approval items you usually don't add candidates at all —
> the system generates Approve and Deny options automatically."

---

## CHAPTER 6: Who Can Vote — Eligibility, the Roster & Overrides (13:00 – 17:00)

> "This chapter is the one to re-watch before your first real election.
> Eligibility has four layers, checked in order."

**[SCREEN: Diagram callout — four stacked layers:
1. Election voter list (optional explicit list)
2. Membership tier rules (org settings)
3. Per-item voter types
4. Per-item attendance requirement]**

> "Layer one: an explicit voter list on the election, if you set one — only
> those members, period. Layer two: membership tier rules from your
> organization settings. A tier can be marked not voting-eligible — think
> social members — or can require a minimum meeting-attendance percentage
> over a lookback window. The system computes each member's actual attendance
> and denies members under the bar, with the percentage in the denial reason.
> Layers three and four we covered: per-item voter types and per-item
> attendance."

### THE ELIGIBILITY ROSTER (14:00 – 15:30)

**[SCREEN: Eligibility tab — the full roster. Point at the color coding.]**

> "Before you send a single ballot, open the Eligibility Roster. Every active
> member, color-coded: green rows are eligible, red are ineligible — with the
> reason, per ballot item — blue rows have an override, and muted rows have
> already voted. Search, filter, and expand any member to see exactly which
> items they'll receive and why."

**[SCREEN: Expand a red row — show per-item reasons like "membership type not
eligible (requires: regular; member has: probationary)"]**

> "This kills the number-one election headache: 'why can't I vote?' The
> answer is right here, before it becomes a meeting-night argument."

### PREVIEW A MEMBER'S BALLOT (15:30 – 16:00)

**[SCREEN: Use the ballot preview for a specific member]**

> "Want to see it exactly as one member will? Preview their ballot. Eligible
> items render normally; ineligible items are grayed out with the reason. And
> this preview runs the *same* eligibility code as the real ballot — it can't
> drift from what the member actually receives."

### OVERRIDES (16:00 – 17:00)

**[SCREEN: Grant an override on an ineligible member; the row turns blue]**

> "Overrides are the escape hatch. A member whose tier was set wrong, an
> excused absence your bylaws allow — grant an override with a reason, and
> that member is eligible for everything, bypassing every layer. Overrides
> are logged with who granted them and when, they're visible in the roster,
> and overridden members count in your quorum denominator. Use them
> deliberately — the reason field is your paper trail."

**[CALLOUT: "Every override is audit-logged: who, when, why"]**

---

## CHAPTER 7: Test Ballots & Opening the Election (17:00 – 19:30)

### SEND YOURSELF A TEST BALLOT FIRST (17:00 – 18:00)

**[SCREEN: Click Send Test Ballot. Open the email. Cast a test vote.]**

> "Never send four hundred ballots untested. Send Test Ballot emails a real
> ballot to *you* — real email rendering, real voting link, real submission
> flow. And it's safe to actually vote on it: test-ballot votes are flagged
> internally, excluded from every result, statistic, and roster, and they
> don't use up your real vote. When the real ballots go out, you vote again
> like everyone else."

**[CALLOUT: "Test votes never count — and never block your real vote"]**

### THE PRE-MEETING PACKAGE (17:55 – 18:00, brief beat — full demo is Short 12k)

**[SCREEN: Click Pre-Meeting Package; flash the generated PDF]**

> "One more prep tool: the Pre-Meeting Package — a printable PDF with the
> meeting agenda, the full ballot preview, and the eligible-voter list, ready
> to email out before the meeting or file with the minutes. Two versions: a
> member version with names and counts, and a leadership version that adds
> the ineligibility reasons. More in the shorts below."

### OPEN & SEND (18:00 – 19:30)

**[SCREEN: Click Open Election. Then Send Ballots. Show the confirmation
summary: sent / failed / skipped with reasons.]**

> "Open the election — it needs at least one accepted candidate or one ballot
> item, and the system will tell you if it's not ready. Then send ballots.
> The system walks your eligible voters, issues each one a unique
> single-use voting token, locks their eligible items to it, and emails a
> voting link. The summary tells you exactly what happened: sent, failed,
> and skipped — with per-member reasons. No email on file, ineligible tier,
> zero eligible items — nobody silently falls through the cracks, and the
> skipped list is emailed to you for follow-up."

> "Two operational notes. Ballot links are built from your server's
> configured public URL — `FRONTEND_URL` — not from whoever clicked Send. If
> members report dead links, that's the setting to check with IT. And tokens
> expire at the election's end date, or thirty days, whichever comes first —
> re-sending a ballot issues a fresh token."

**[CALLOUT: "Ballot links come from FRONTEND_URL — set it correctly before election night"]**

---

## CHAPTER 8: The Voting Experience (19:30 – 23:00)

### TOKEN VOTING — THE EMAIL LINK (19:30 – 21:00)

**[SCREEN: Phone mockup — open the ballot email, tap Vote Now, land on the
public ballot page]**

> "Members click the link and vote from any device — no login. The token *is*
> the authentication, and it's a 512-bit random value with rate limiting on
> every public ballot endpoint. The page shows only that voter's eligible
> items. Every item defaults to abstain, so skipping a question is always an
> explicit choice."

**[SCREEN: Walk the ballot: approve a membership item, pick a Chief candidate,
type a write-in on another, leave one item on abstain. Review the
confirmation modal. Submit.]**

> "A confirmation modal summarizes every choice before submission — then the
> whole ballot submits atomically. All the votes record together, or none
> do; there is no such thing as a half-submitted ballot."

**[SCREEN: The confirmation screen with receipt hashes displayed]**

> "And this is my favorite detail: the voter gets **receipts**. One code per
> vote. Save them. Later — even after the election closes — anyone holding a
> receipt can verify against the system that the vote was recorded, without
> revealing *what* the vote was. We'll use these in the audit chapter."

### IN-APP VOTING (21:00 – 21:45)

**[SCREEN: Logged-in member on the election detail page, Cast Vote tab]**

> "Members can also vote logged-in, on the Cast Vote tab. Same eligibility
> checks, same one-ballot rule — the system tracks that a member voted, by
> either path, and blocks a second attempt."

### THE ANONYMITY MODEL (21:45 – 23:00)

**[SCREEN: Simple diagram callout: user ID + per-election secret salt →
one-way voter hash → stored on the vote. The user ID itself: never stored.]**

> "How can it block double-voting *and* be a secret ballot? Anonymous
> elections never store who you are on the vote. Instead, your ID is run
> through a one-way hash keyed by a secret salt generated for that election
> alone. The hash proves 'this voter already voted' without saying which vote
> is theirs. And when the election closes, the salt is destroyed — after
> that, connecting members to votes isn't just against policy, it's
> mathematically impossible. Even for the database administrator."

**[CALLOUT: "Salt destroyed at close = de-anonymization permanently impossible"]**

---

## CHAPTER 9: Proxy Voting (23:00 – 25:00)

**[SCREEN: Election Settings — proxy voting enabled. Then the election's
Proxies tab.]**

> "If your bylaws allow it and you've enabled it in settings: proxy voting.
> A member who can't attend authorizes another member to vote on their
> behalf. On the Proxies tab, create the authorization — the delegating
> member, the proxy holder, and the reason. The proxy holder gets notified,
> and they're CC'd on the delegating member's ballot notifications."

**[SCREEN: Cast a proxy vote; point out the recorded proxy metadata]**

> "When the proxy votes, the vote is recorded as the *delegating member's*
> vote — their eligibility is what's checked, their one-ballot rule is what
> applies — with full proxy metadata attached: who physically cast it, and
> under which authorization. If the absent member shows up and votes first,
> the proxy attempt is blocked; first vote wins, always."

> "Revoking an authorization stops future proxy votes but never un-casts a
> vote. And every authorization, revocation, and proxy vote is audit-logged."

**[CALLOUT: "Proxy votes carry full metadata: who voted, for whom, under which authorization"]**

---

## CHAPTER 10: Monitoring While Voting Is Open (25:00 – 26:30)

**[SCREEN: Stats view — ballots issued, ballots received, turnout percentage
climbing. Then the Non-Voters list.]**

> "While the election is open you see participation, not results: how many
> ballots issued, how many returned, turnout percentage. Individual votes
> stay sealed — even from you — unless you deliberately configured immediate
> results visibility, which I'd reserve for informal polls."

> "The Non-Voters view lists eligible members who haven't voted yet. On
> meeting night, that's your last-call list — read it out or use it to nudge
> the room before you close voting."

---

## CHAPTER 11: Closing, Results & Quorum (26:30 – 30:00)

### CLOSING — INCLUDING EARLY (26:30 – 27:30)

**[SCREEN: Click Close Election before the scheduled end time; confirm]**

> "When the last vote is in, close the election. Closing early — before the
> scheduled end time — is the normal move at a live meeting, and everything
> downstream works: the tally runs, runoff conditions are evaluated, pipeline
> results flow, and the anonymity salt is destroyed."

> "One thing to know about early closes: the results *API* stays gated until
> the originally scheduled end time passes — a safeguard against premature
> disclosure. If you want the room to see results now, flip **results
> visible immediately** on the closed election. It's one toggle on the
> Publish Results panel, and it's the single most common 'where are my
> results?' question. Short 12c covers just this."

**[CALLOUT: "Closed early? Flip 'results visible immediately' to publish now"]**

### READING THE RESULTS (27:30 – 29:00)

**[SCREEN: The Results tab — per-position tallies, winner highlighted,
turnout bar, quorum banner]**

> "Results show per-position vote counts with the winner flagged by your
> victory condition, write-ins tallied under their typed names, overall
> turnout, and — if you configured quorum — the quorum banner. For ranked
> choice you get the full round-by-round elimination so you can narrate
> exactly how the winner emerged."

> "If quorum failed, the banner says so, the winner flags are cleared, and
> the numbers stand as advisory. What your bylaws do next is up to you — the
> system just refuses to call it a valid result."

### PUBLISH & REPORT (29:00 – 30:00)

**[SCREEN: Publish Results panel — visibility toggle, Send Report button]**

> "The Publish Results panel is your one-stop close-out: toggle member
> visibility, and Send Report emails a formatted results report. Then record
> the outcome in your meeting minutes — if the election is linked to the
> meeting, it's displayed right on the minutes page."

---

## CHAPTER 12: Runoffs (30:00 – 32:00)

**[SCREEN: Close a tied majority-condition election. The runoff appears —
show the Runoff Chain timeline.]**

> "Nobody hit the victory condition? With runoffs enabled, the system builds
> the runoff for you at close: a child election, top-two candidates — or
> everyone minus last place, per your setting — write-ins disabled, in draft
> status so you control when it opens. The Runoff Chain view shows the whole
> series: original, runoff one, runoff two, each with its status and vote
> count, up to your configured round limit."

**[SCREEN: Open the runoff, members vote, close it, winner declared]**

> "And the runoff carries the original's full rule set — quorum, position
> eligibility, the meeting link, your overrides — with a fresh anonymity
> salt of its own. Running it at the meeting is one click: opening an
> election *starts* it, even if its scheduled start was later — so open the
> runoff and the room can vote immediately. Want a defined window instead?
> Edit Dates on the draft lets you set, say, a fifteen-minute floor vote.
> Ballots, votes, close, results. On a meeting night a runoff adds about
> ten minutes, not a second meeting."

**[SCREEN: Show the Edit Dates modal on the draft runoff — Start Now +
15 Min quick buttons — then Open Election]**

**[CALLOUT: "Runoffs are evaluated on every close — early closes included"]**

---

## CHAPTER 13: Auditing — Integrity, Forensics & Disputes (32:00 – 38:00)

> "Here's what separates this from a web poll. Every election carries a
> tamper-evident audit layer, and you should know how to read it *before*
> anyone disputes a result."

### THE INTEGRITY MODEL IN 90 SECONDS (32:00 – 33:30)

**[SCREEN: Diagram callout, three layers:
1. Signature — every vote HMAC-signed over all its fields
2. Chain — each vote's hash linked to the previous vote's
3. Receipt — voter-held proof a vote exists]**

> "Three layers. Every vote is **signed** — an HMAC over the vote's fields:
> candidate, position, rank, proxy data, timestamp. Change anything in the
> database and the signature no longer matches. Every vote is **chained** —
> its hash incorporates the previous vote's hash, so deleting or reordering
> votes breaks the chain visibly. And every voter holds a **receipt** that
> proves their vote exists without exposing its content. On top of all that,
> every operation — open, close, vote, override, rollback, even pulling a
> forensics report — lands in the organization-wide tamper-proof audit log."

### RUNNING AN INTEGRITY CHECK (33:30 – 34:30)

**[SCREEN: The Integrity check — "142 votes verified, 0 tampered, chain
verified, status PASS"]**

> "One click re-verifies every signature and walks the whole chain. PASS
> means no vote was altered, deleted, or reordered since casting. FAIL names
> the exact tampered vote IDs. Run it before you announce results — it takes
> seconds, and 'the integrity check passed' is a wonderful sentence to say
> out loud at a meeting."

### THE FORENSICS REPORT (34:30 – 36:00)

**[SCREEN: The Forensics tab — walk each section]**

> "For a dispute, pull Forensics — one report with everything: the integrity
> results; every soft-deleted vote with who deleted it and why — votes are
> never physically erased; rollback history; token issuance and usage — who
> got ballots, which were used, access counts; anomaly detection flagging
> IPs with unusual vote counts; and an hour-by-hour voting timeline that
> makes ballot-stuffing bursts jump out. Two context notes: a shared station
> computer legitimately produces many votes from one IP — read anomalies
> with judgment. And treat forensics access itself as sensitive: in a small
> department, IP patterns can narrow down who voted when — which is why
> pulling this report is itself audit-logged."

### RECEIPTS, DISPUTES & THE ROLLBACK RULE (36:00 – 38:00)

**[SCREEN: Verify a receipt via the verification endpoint — valid, timestamp,
position. Then attempt a rollback on the closed election — show the refusal.]**

> "A member claims their vote wasn't counted? Ask for their receipt. Valid —
> here's proof it was recorded, timestamp and position, content still
> secret. Invalid — now you have a real problem report, and forensics is
> your next stop. This works because receipts are handed to voters at
> submission time — remind members to save them."

> "Last rule, and it's important: an anonymous election that has votes
> **cannot be reopened** after closing. The salt that made voter hashes
> comparable was destroyed at close — reopening would let everyone who
> already voted vote again, undetectably. The system refuses, tells you why,
> and the answer is a fresh election. A closed election with *zero* votes
> can still be rolled back — that's for the 'opened it by mistake' case.
> Every rollback requires a written reason and emails all of leadership."

**[CALLOUT: "Closed + anonymous + has votes = permanent. By design."]**

### WRAP-UP (38:00 – 38:30)

> "That's the full lifecycle: configure, build, verify eligibility, test,
> send, vote, monitor, close, publish, run off, and audit. Your next election
> can be counted in seconds, defended in a dispute, and secret to everyone —
> including you. Below this video: a shorts pack covering the ten edge cases
> that generate every election-night support question."

**[SCREEN: End card — subscribe, shorts pack playlist, docs link]**

---

## Clip Extraction Guide

| Clip | Timecode | Standalone Title |
|------|----------|-----------------|
| Election Settings | 2:00–3:30 | "Election Defaults Every Department Should Set" |
| Voting Methods Explained | 4:30–5:45 | "Simple Majority vs Ranked Choice vs Approval Voting" |
| Quorum & Victory Conditions | 5:45–7:30 | "Quorum, Supermajorities & Victory Conditions" |
| Ballot Builder | 7:30–11:00 | "Building a Department Ballot" |
| Eligibility Deep Dive | 13:00–17:00 | "Who Can Vote? Eligibility, Rosters & Overrides" |
| Test Ballot & Send | 17:00–19:30 | "Test Your Ballot Before You Send 400 of Them" |
| The Voting Experience | 19:30–23:00 | "How Members Vote (And Why It's Actually Secret)" |
| Proxy Voting | 23:00–25:00 | "Proxy Voting: Setup to Cast" |
| Closing & Results | 26:30–30:00 | "Closing an Election & Publishing Results" |
| Runoffs | 30:00–32:00 | "Automatic Runoff Elections" |
| The Audit Layer | 32:00–38:00 | "Auditing a Department Election (Integrity & Forensics)" |

---
---

# Edge-Case Shorts Pack (12a – 12j)

**Format:** 60–120 seconds each, vertical (1080×1920), standalone — no series
context required. Each answers one real support question. Record against the
same demo org as Script 12 for visual continuity.

---

## SHORT 12a: "Why Can't This Member Vote?" — Eligibility Debugging

**Length:** 90 seconds
**Audience:** Election admins

**[SCREEN: Eligibility Roster, a red row]**

> "A member says they can't vote. Don't guess — look it up. Eligibility
> Roster, search their name."

**[SCREEN: Expand the red row — per-item reasons visible]**

> "The roster tells you exactly why, per ballot item: wrong membership type —
> here it wants regular members and they're probationary. Not checked in at
> the meeting. Attendance percentage below the tier's minimum. Or they're not
> on the election's voter list."

**[SCREEN: Ballot preview for that member]**

> "Still unsure? Preview their exact ballot — it uses the same eligibility
> code the real ballot uses, so what you see is what they get."

**[SCREEN: Grant Override with a reason; row turns blue]**

> "If they *should* be able to vote, grant an override with a reason — it's
> logged — then re-send their ballot so their new token picks up the change."

**[CALLOUT: "Roster → reason → override → re-send"]**

---

## SHORT 12b: Test Ballots — Practice Without Polluting the Results

**Length:** 60 seconds
**Audience:** Election admins

**[SCREEN: Send Test Ballot; the [TEST] email arrives]**

> "Before ballots go department-wide, send one to yourself. Real email, real
> link, real ballot."

**[SCREEN: Cast a test vote; then show Results — zero votes]**

> "And yes — actually vote on it. Test votes are flagged internally: they
> never appear in results, statistics, or rosters, and they don't use your
> real vote. When the real election runs, you vote again like everyone else."

**[SCREEN: The same admin's real vote landing later — counted]**

> "Practice run, zero consequences. Every election, every time."

**[CALLOUT: "Test votes: never counted, never block your real vote"]**

---

## SHORT 12c: Closed Early? Here's Why Results Are Hidden

**Length:** 75 seconds
**Audience:** Election admins

**[SCREEN: A closed election, Results tab showing "Results not available yet"]**

> "You closed the vote at the meeting, the election says CLOSED — and results
> are… hidden? Not a bug. A safeguard."

**[SCREEN: Highlight the election's scheduled end date, still hours away]**

> "Results stay gated until the election's *scheduled* end time passes, so
> nobody can peek by closing early. But when the room is waiting:"

**[SCREEN: Publish Results panel — toggle 'results visible immediately']**

> "Open the Publish Results panel and flip 'results visible immediately.'
> Done — results are live for the membership, and you can email the report
> right from the same panel."

> "Runoffs, by the way, don't wait for the gate — if one's needed, it was
> already created the moment you closed."

**[CALLOUT: "Early close + one toggle = instant results"]**

---

## SHORT 12d: Your Vote Receipt — Proof Without Exposure

**Length:** 60 seconds
**Audience:** All members

**[SCREEN: Phone — ballot submitted, receipt codes on the confirmation screen]**

> "When you submit your ballot, you get receipts — one code per vote. Screenshot
> them."

**[SCREEN: The receipt verification check returning valid + timestamp]**

> "Ever wonder if your vote actually counted? Verify the receipt. The system
> confirms a vote with that receipt exists — when it was cast and for which
> office — but never *what* you voted. Not to you, not to the officers, not
> to anyone."

> "Proof it counted. Secret forever. That's the deal."

**[CALLOUT: "Save your receipts — proof your vote was counted"]**

---

## SHORT 12e: Proxy Voting in Two Minutes

**Length:** 120 seconds
**Audience:** Secretaries, election admins

**[SCREEN: Election Settings — proxy voting toggle + max proxies]**

> "Member can't make the meeting, bylaws allow a proxy? First: proxy voting
> is off until you enable it in Election Settings — and you cap how many
> members one person can represent."

**[SCREEN: Proxies tab — create an authorization]**

> "On the election, authorize it: who's absent, who votes for them, and why.
> The proxy holder is notified and CC'd on the ballot emails."

**[SCREEN: Proxy holder casting; show the vote recording under the delegator]**

> "The proxy's vote records as the *absent member's* vote — their
> eligibility, their one-ballot limit — with metadata showing who physically
> cast it and under which authorization."

**[SCREEN: The absent member trying to vote afterward — blocked]**

> "If both try to vote, first one in wins; the second is blocked. Revoking an
> authorization stops future votes but never un-casts one. And all of it —
> authorization, vote, revocation — is in the audit log."

**[CALLOUT: "Enable → authorize → vote → audit trail"]**

---

## SHORT 12f: Nobody Won — Automatic Runoffs

**Length:** 90 seconds
**Audience:** Election admins

**[SCREEN: Results — three candidates, none over 50%, majority required]**

> "Three candidates, nobody over fifty percent, and your rules require a
> majority. On paper, that's a second ballot and another hour. Here:"

**[SCREEN: Close the election; the runoff appears in the Runoff Chain]**

> "Close the election — the runoff already exists. Top two candidates
> advance — or drop just the last-place finisher, your choice — write-ins
> off, created as a draft so you pick the moment."

**[SCREEN: Adjust dates, open, vote, close — winner]**

> "Check its dates, open it, members vote on fresh ballots, close, done. The
> Runoff Chain shows the whole series — original through final — with a
> round cap so it can't loop forever. Works even when you close the original
> early."

**[CALLOUT: "No majority? The runoff is already built"]**

---

## SHORT 12g: Quorum — Making Elections Count (Literally)

**Length:** 90 seconds
**Audience:** Election admins, leadership

**[SCREEN: Election form — quorum type percentage, value 51]**

> "A vote with ten of your eighty members isn't much of a mandate. Set a
> quorum: a turnout percentage, or a hard voter count."

**[SCREEN: Results with the quorum banner — met, winners flagged]**

> "Meet it, and results certify normally. Miss it —"

**[SCREEN: Results with quorum FAILED — winner flags cleared, advisory note]**

> "— and the system shows the numbers but clears every winner flag and marks
> the outcome advisory. No accidental certification of a hollow vote."

> "And the denominator is fair: only members *allowed* to vote count toward
> it. Social members in a non-voting tier can't sink your quorum — and
> members you granted overrides count in."

**[CALLOUT: "Quorum failed = numbers shown, no winners declared"]**

---

## SHORT 12h: Why You Can't Reopen a Closed Election

**Length:** 75 seconds
**Audience:** Election admins

**[SCREEN: Rollback attempt on a closed anonymous election with votes — the
refusal message]**

> "Closed the election, someone wants it reopened — and the system says no.
> Here's why that's protecting you."

**[SCREEN: Diagram callout: salt → voter hashes; salt destroyed at close]**

> "In an anonymous election, double-voting is blocked by voter hashes built
> from a secret per-election salt — and that salt is destroyed at close.
> That's what makes your members' votes permanently secret. But it also
> means a reopened election couldn't recognize who already voted. Everyone
> could vote twice, undetectably."

**[SCREEN: Show rollback succeeding on a closed election with zero votes]**

> "So: closed with votes — permanent; run a new election, it takes two
> minutes. Closed by accident with *no* votes — rollback works fine, with a
> written reason, and leadership gets notified either way."

**[CALLOUT: "Vote secrecy and reopening can't coexist. Secrecy wins."]**

---

## SHORT 12i: Investigating a Disputed Election

**Length:** 120 seconds
**Audience:** Leadership, election admins

**[SCREEN: The Forensics tab]**

> "'The count is wrong.' 'Someone voted twice.' Don't argue — investigate.
> One report answers it."

**[SCREEN: Integrity section — PASS]**

> "Step one, integrity: every vote's cryptographic signature re-verified,
> the vote chain walked end to end. PASS means nothing was altered, deleted,
> or reordered since casting. A FAIL names the exact votes."

**[SCREEN: Audit trail — vote_double_attempt entries; deleted votes section;
timeline chart]**

> "Step two, the audit trail. Double-vote attempts? Already blocked at the
> database — and logged. Removed votes? Soft-deleted only, with who and why.
> The voting timeline exposes stuffing bursts; IP anomalies get flagged —
> just remember a shared station computer looks 'anomalous' and isn't."

**[SCREEN: Receipt verification — valid]**

> "Step three, the voter's receipt: valid proves their vote was recorded —
> content still secret."

> "Save the report, keep it with the minutes. Every step you just took was
> itself audit-logged — including you pulling the report."

**[CALLOUT: "Integrity check → audit trail → receipts. Then decide."]**

---

## SHORT 12j: Choosing a Voting Method

**Length:** 90 seconds
**Audience:** Leadership, bylaw committees

**[SCREEN: The voting-method dropdown]**

> "Four ways to count a vote — pick by the race, not by habit."

**[SCREEN: Quick visual for each — one mark; ranked list; multiple checks;
2/3 bar]**

> "**Simple majority**: one member, one mark. Two-candidate races, routine
> officer elections."

> "**Ranked choice**: rank your preferences; last place is eliminated round
> by round until someone has a true majority. Three-plus candidates, no
> spoiler effect, no runoff night — usually."

> "**Approval**: check everyone you'd accept; most approvals wins. Board
> seats, 'any of these is fine' votes."

> "**Supermajority**: one choice, higher bar — the two-thirds bylaw
> amendment. Set the percentage; the tally enforces it."

> "Whatever you pick, ballots submit atomically, duplicates are blocked at
> the database, and results show the math — including every ranked-choice
> elimination round."

**[CALLOUT: "2 candidates → simple. 3+ → ranked. 'Any of these' → approval. Bylaws → supermajority."]**

---

## SHORT 12k: The Pre-Meeting Package

**Length:** 90 seconds
**Audience:** Secretaries

**[SCREEN: Election detail page, Communication section — click Pre-Meeting Package]**

> "Annual meeting in two weeks? Send the package. One click builds a
> print-ready PDF: the meeting agenda, every ballot item with its candidates
> and statements, the election rules — quorum, voting method, proxies — and
> the eligible-voter list."

**[SCREEN: The modal — prefill Leadership, remove one chip, add an outside address]**

> "Prefill the recipients from leadership or all eligible voters, then edit
> freely — drop anyone, add outside addresses like board counsel. Everyone's
> BCC'd."

**[SCREEN: Toggle the full-roster checkbox; show the two PDF variants side by side]**

> "Two versions: members get names and counts. Leadership's version adds who's
> *not* eligible and why — tier and attendance details that shouldn't go
> department-wide."

**[SCREEN: The Preview PDF download links]**

> "Or skip sending entirely — download the PDF and attach it to your own
> email, print it for the meeting, file it with the minutes. Either way, it's
> audit-logged."

**[CALLOUT: "One click: agenda + ballot + voter roster, ready to mail"]**

---

## Production Notes (Shorts Pack)

- Record all ten against the **same demo election** used for Script 12 —
  reuse captures where timecodes overlap.
- 12a, 12c, and 12h resolve the three highest-frequency support questions —
  prioritize these if producing incrementally.
- 12d and 12j are evergreen and member/leadership-facing — good candidates
  for department onboarding playlists.
- Each short's `[CALLOUT]` doubles as its YouTube thumbnail text.
