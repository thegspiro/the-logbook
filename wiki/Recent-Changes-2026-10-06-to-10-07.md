# Recent changes: October 6 – 7, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-10-06_TO_10-07.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10-06_TO_10-07.md).
Predecessor: [October 5 – 6](Recent-Changes-2026-10-05-to-10-06).

**The headline:** every setting in your `.env` now actually reaches the server
(some that were silently ignored will start working), **open shift swaps are
first-come, first-served**, a department's **own crew seats** can be filled,
**compliance counts shift attendance** for "shifts completed" requirements,
**elections use one ballot** for the app and the email (with proxy voting and
multi-seat races), and **Claude can connect to a member's account** through an
opt-in sign-in.

## Read this first

**If you run the server:**

- **Review `.env` before upgrading.** The backend's compose `environment:` block was
  an allowlist, so about four in five settings (SMTP, sign-in providers, Twilio,
  CAPTCHA, push, Sentry, password policy) were ignored. All of them now pass
  through. A stale `EMAIL_ENABLED=true`, an old `ACCESS_TOKEN_EXPIRE_MINUTES=480`, or
  a placeholder `SALESFORCE_OAUTH_REDIRECT_URI` will take effect, and a typo or a
  production-check violation (for example `RATE_LIMIT_ENABLED=false`) stops the
  backend booting. Run the preflight described at the top of
  `docs/UPGRADING.md` (and see [Deployment-Docker](Deployment-Docker)) first. A compose file you maintain yourself
  keeps its old allowlist.
- **Unraid:** the template has a new required, masked **ENCRYPTION_SALT** field.
- **Signing keys:** if `AUDIT_LOG_SIGNING_KEY` or `VOTE_SIGNING_KEY` was in `.env`,
  it only starts signing now. Old rows keep verifying with `SECRET_KEY`, so **do not
  change `SECRET_KEY`** while they matter.
- **Eleven migrations** land after head `15802f3df5c4`. Downgrading some of them
  discards data: knowledge tests, integration sync history, MCP connections,
  election revision marks and seats-per-race. The shift-seat migration refuses to
  downgrade while a custom seat is stored.
- **Managed database or Redis?** There is a new opt-in
  `docker-compose.external-services.yml` override; see
  [Deployment-Production](Deployment-Production). With it, back up the `uploads` and
  `audit_archives` volumes yourself.

**If you administer a department:**

- **Compliance numbers move.** A "shifts completed" requirement now counts
  attendance on your finalized shifts (plus counted external shifts) everywhere;
  a department requirement linked into a training program shows the member's live
  figure instead of starting at zero.
- **Open swaps:** the first eligible member to **Pick up** takes the seat; officers
  can deny but no longer approve an open swap. Nobody is emailed about open swaps.
- **Members:** a position name another position already uses is refused; the base
  **Member** position cannot be removed from an active member; phone numbers are
  checked when saved.
- **Elections:** a closed election's results are visible to everyone who can view
  elections (the publish switch is gone). Ranked choice cannot be combined with
  more than one seat.

## What's new

### Training and members

- **Online knowledge tests**: question bank, online delivery and automatic grading;
  members take them on the **Knowledge Tests** page. Answers are never sent before
  submitting.
- **Skill Evaluations** screen under Training Admin › Setup, and **skills testing
  that works offline**, with a queue that replays when the signal returns.
- **Cohort rooms**: pick a room per cohort and override it per class.
- **Qualifications** can be entered on a member's profile or imported from a CSV
  (previewed first) in **Members admin → Import Qualifications**.
- **Department Readiness** heat-map on Training Admin › Advanced › Competency.
- **Undo a mistaken drop** within 7 days; **Add Member** can set the starting
  status; leave editing and **Overdue Property Returns** have screens.
- **Admin hours Review Rules**: a sole-officer department can approve its own
  entries; a resync that grows an approved entry past 25% sends it back for review.
- Optional **virus scanning** of self-reported certificates (off by default).

### Scheduling

- **Shared calls** in the close-out wizard: tick a call another unit already logged
  so it is counted once.
- **Open swaps** and **custom crew seats**, as above. An unrecognised seat is refused
  with error `LB-SCHED-003`.

### Elections

- One ballot for the in-app **Cast Vote** tab and the emailed ballot; positions-only
  elections can now email ballots.
- **Proxy ballots** (refused on anonymous elections for now), a ballot email that
  names the proxy, **seats per race**, and a visible **Results revised** mark when a
  closed election is corrected.

### Security, integrations and operations

- **Security Alerts** page (`/admin/security-alerts`): acknowledge and resolve with a
  note; every export is audited and listed.
- **Integration health**: each integration has a detail page with sync history, last
  error and **Retry sync**.
- **Claude connections** (opt-in OAuth 2.1): members approve Claude at
  `/claude/authorize` and manage connections at `/claude/connections`; admins register
  clients on the Integrations page. See [Integration-Claude-MCP](Integration-Claude-MCP).
- **Medical screening**: Member/Prospect picker on Add Record, a **Self-recorded**
  badge, and an audit event for every view of screening records.
- **Public portal and PayPal**: portal limits shared across workers; a daily task
  catches PayPal payments the webhook missed.
- **Desktop density**: with a mouse, icon buttons are 36px and switches a 24px pill
  (still 44px on phones and touch screens); long event, store and cohort titles get
  more room.

## Security review results

Training core (one MEDIUM flagged: `POST /training/enrollments` can create a
duplicate active enrollment), training extended (one MEDIUM fixed: an officer could
credit themselves for a missed cohort class), skills testing, compliance, admin hours
and grants & fundraising (no fixes needed). The new knowledge-test code has not had
its own security pass yet.
