# Recent changes: October 5 – 6, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-10-05_TO_10-06.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10-05_TO_10-06.md).
Predecessor: [October 4 – 5](Recent-Changes-2026-10-04-to-10-05).

**The headline:** member badges now carry a **server-issued code** and ID cards
print on a plastic-card printer; **finance approvals go to the named approver**;
a **finalized event can finally be edited**; and **compliance figures were
re-aligned** so the dashboard, the matrix and the annual report agree — which
moves some departments' percentages.

## Read this first

**If you administer a department or run the server:**

- **Run the normal upgrade.** Seven migrations land (head `15802f3df5c4`, a
  merge). Downgrading `ad3b979746f1` discards issued badge codes, so printed
  badges would stop scanning.
- **Compliance percentages may change.** Members that nothing grades now show
  **N/A** and leave every percentage; the Department Compliance card and the annual
  report use compliance profiles like the matrix; a requirement scoped by role now
  matches **rank**; a certification requirement no longer credits a course that
  merely contains its name (requirements that already exist keep name matching for
  records up to the upgrade day). Stored annual reports keep their old figures.
- **Shift Compliance grades only shift-credited requirements.** SHIFTS
  requirements are credited automatically; an HOURS requirement drops off the report
  until an officer ticks **Shift Credit** on it.
- **Finance approval steps now enforce who may approve.** Check **Finance →
  Approval Chains** for a step flagged as one nobody can act on; an approvals admin
  can override with a written reason.
- **Badges:** every member gets a random badge code. Old badges (membership number,
  short id, old QR) keep scanning until an officer turns off **Accept old badges**.
  Printing a badge needs `members.manage` or `members.manage_id_cards`.
- **Certificate files from self-reported training** can expire: set a retention
  period under **Review Submissions → Settings → Certificate Files** (minimum 90
  days). Nothing is deleted until you choose one.
- **Proxy limits were raised** (400 connections, 50 requests/second with a queue)
  because one dashboard load could lose requests behind a shared station address.
  If you customized `nginx.conf`, compare it.

**If you train or schedule people:**

- **Exchange With a Member** (My Shifts): both members must be cleared for each
  other's seat; a pair that lapsed while pending can still be approved with
  **Approve anyway**. The dashboard says **Not eligible** instead of offering Sign Up.
- **Cohorts:** **Add member** on the Roster tab, then decide each class a late joiner
  missed — credit it or schedule a make-up. Shifting or cancelling a cohort is now
  all-or-nothing.
- **Effectiveness tab:** **Submit Evaluation**. **Skills Testing:** records are paged
  and the CSV export needs a date range of up to a year.
- **Review Submissions / My Training:** pending records stay visible; imports name the
  bad row and value.

**If you edit events:**

- A **finalized event can be edited from the edit form.** Only a change to a locked
  field (type, category, schedule, check-in rules) is refused; the form says which
  and how to unlock them.

**If you use a phone or station computer:**

- Offline items are sent only under the member who queued them; items queued before
  the upgrade are held with **Send as me** / **Discard**.
- A sign-out that the server never confirms blocks the screen until it is retried.
- Two tabs refreshing together no longer sign a member out everywhere.
- Members and Inventory admin pages fit a phone (no double margin; Items filters
  behind a **Filters** button).

**Emails changed:** low stock says "at or below reorder point"; certification alerts
say "Expires Today / Tomorrow"; the weekly supply alert is **Supplies to Replace** with
a **Status** column; five more emails fit a phone. A failed end-of-shift email is
retried, and failed scheduled tasks now show in **Error Monitoring**.

## Engineering notes

| Area       | Note                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Badges     | `users.badge_code` via `/member-badges` (`GET`, `reissue`, `resolve`); never in roster/export responses. CR80 PDFs via `/member-id-cards/{layout,pdf}`. |
| Finance    | `finance_approver_matching.py` is the single authority; `approver-coverage` report; 403 on mismatch; override reason audited.                           |
| Compliance | `ComplianceGrading` / `classify_standing` are the one definition; `not_applicable` standing; `name_match_until`; `shift_credited`.                      |
| API paging | `GET /training/records` `skip`/`limit` + `X-Total-Count`; skills-testing `/tests` → `{items,total}`.                                                    |
| Errors     | New `LB-AUTH-012` (409, refresh superseded) and `LB-SCHED-002` (exchange qualification).                                                                |
| Security   | Integration senders DNS-pinned (SSRF); Google Calendar capped at 10 MB.                                                                                 |

## Reviews in this window

Security review (0 fixes unless noted): finance-approvals (1 fix), users-
organizations, elections-ballots, membership-pipeline (1 fix), medical-screening,
documents-legal, inventory, facilities, apparatus-nfc, equipment-check-shifts,
scheduling, events-requests. App review: dashboard pass 3 (7 fixes), locations &
kiosk pass 3 (6 fixes), medical screening pass 5 (2 fixes), apparatus pass 5 (2 fixes).

## Where to read more

[Module-Training](Module-Training) · [Module-Scheduling](Module-Scheduling) ·
[Module-Events](Module-Events) · [Member-ID-Cards](Member-ID-Cards) ·
[Module-Compliance](Module-Compliance)
