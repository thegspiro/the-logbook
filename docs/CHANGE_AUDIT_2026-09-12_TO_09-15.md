# Change audit: September 12 – 15, 2026

Net changes merged to `main` in the three days ending 2026-09-15, picking up
where the [September 6 – 12 audit](./CHANGE_AUDIT_2026-09-06_TO_09-12.md)
stopped at `ae789019d` (2026-09-12 01:47 UTC).

**46 pull requests (#2493 – #2594).** One schema migration, head
`6ab7d903fae5`. **No route was added and none retired** — the second window
running with no bookmark to repair, and this time nothing new to bookmark
either. Ninety-three of the window's 128 commits are security-review passes.

The window has no single theme. It is a **correction window**: twelve of its
seventeen substantive changes fix a rule that was written down somewhere and
enforced nowhere, or enforced on one path out of two. The membership pipeline
accounts for five of them on its own.

**Four changes from the window's first hours are already documented and are not
repeated here.** The previous audit was written against `ae789019d` and the
commits immediately after it carried their own documentation: the skills-test
scorecard guard and the setup-wizard singleton are both in
[`UPGRADING.md`](./UPGRADING.md), and the call-tracking radio group has its own
disposition in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md). This
audit covers what was left.

**Four changes alter what a member or an operator sees without anyone asking
for it**, and they are the ones to read before upgrading: the Open Shifts
board gets shorter, a completed repair stops moving an inspection deadline, an
email configuration that could never send is now refused at the point of
saving, and a click in the gutter around a dialog stops throwing the form
away.

Companion operator lesson: the **September 12–15** section of
[`training/20-september-2026-release-changes.md`](./training/20-september-2026-release-changes.md).
Wiki handoff:
[`Recent-Changes-2026-09-12-to-09-15`](../wiki/Recent-Changes-2026-09-12-to-09-15.md).
Media disposition — which screenshots must be created, which replaced — is in
[Documentation and media disposition](#documentation-and-media-disposition)
below.

## Read this first

Four things in this window change what somebody sees or may do, rather than
only what the code does. A fifth — the membership-vote gate reaching the
**Convert** button — extends an entry
[`UPGRADING.md`](./UPGRADING.md#changes-you-will-notice-after-an-upgrade)
already carries, and is described under
[Permission and enforcement movements](#permission-and-enforcement-movements).

1. **The Open Shifts board now lists only shifts with a seat the member is
   cleared for.** Two checks were answering different questions and never
   intersecting them: `filter_shifts_with_open_positions` asks whether the
   _shift_ still has an unfilled required seat, and the eligibility filter asks
   whether the _member_ is cleared for any position on it. A shift with an
   empty driver's seat and a full firefighter seat satisfied both for a
   firefighter, who was then refused at signup with **"Position was filled
   after this request was submitted"** — a message about a race, for a seat
   that had been taken for days. `GET /shifts/open` now serves members
   `get_claimable_shifts`, which intersects the two. **A holder of
   `scheduling.manage` keeps the department-wide staffing-gap view**, because
   that tab is also how a scheduling admin finds gaps.
   `filter_shifts_with_open_positions` itself is untouched — the administration
   hub's short-staffed metric, the MCP tool and outreach sheets all depend on
   its required-only meaning.

2. **A completed maintenance record only moves the inspection clock when it is
   an inspection.** [#2479](https://github.com/thegspiro/the-logbook/pull/2479)
   gated `create_maintenance_record` and stopped there. The commoner route was
   left open: work is usually scheduled and marked complete later, which is a
   `PATCH` through `update_maintenance_record`, and that still wrote
   `item.last_inspection_date` for any completed record. **A coat inspected in
   April and repaired in August had its annual NFPA 1851 deadline slide to the
   following August**, and the department read as compliant four months longer
   than it was. Nothing raised and nothing logged; the only sign was two dates
   on the item page disagreeing. **This is fix-forward** — rows already
   advanced keep the date they hold, so a department that has been completing
   repairs against gear on an inspection interval should spot-check the
   inspection dates on that gear.

3. **An email configuration that is enabled and cannot send is now refused
   when you save it.** `missing_for_enabled` had branches for the two App
   Password presets and for self-hosted SMTP only, so an enabled `cloudflare`
   section with no account or token, and an enabled `other` section with
   nothing in it at all, both saved green. Neither can send. **The hollow
   section was also actively harmful**: `_get_smtp_config` returns early on
   `enabled`, so it shadowed whatever deployment-wide `SMTP_*` settings the
   installation had, and a department that was sending through those stopped.
   Both are now named on the write, and the settings screen says so inline
   rather than leaving Save to explain it.

4. **A click outside a dialog no longer closes it.** `Modal` defaults
   `closeOnClickOutside` to `false`, which covers its 99 call sites, and 27
   hand-rolled overlays lost their backdrop handler. The reported case was the
   inventory Add Item dialog, where a name, category, room, storage area and a
   set of sizes and garment style axes are picked before the backend fans them
   out into one item per combination — a single click in the gutter threw all
   of it away and reopened blank. Escape and the header X still close
   everything; **five surfaces keep click-away** because they hold no user
   input (the command palette, the two equipment-check jump sheets, the
   checklist picker and the publish-blocker sheet), and menus and popovers are
   untouched. Recorded as
   [Pitfall #31](../CLAUDE.md#31-a-dialog-does-not-close-on-a-click-outside-it-2026-09-13)
   with `dialogDismissIntegrity.test.ts` behind it.

## Release map

| Theme                   | What changed                                                                                                                                                                                                                                                          | Where it is documented                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Membership pipeline** | Election Vote stage gates on the ballot on both **Advance** and **Convert**; a Meeting stage naming no event auto-advances on nothing; a form submission advances only the stage it belongs to; Election Vote and Manual Approval are creatable from the stage picker | [`UPGRADING.md`](./UPGRADING.md), [`training/15-prospective-members.md`](./training/15-prospective-members.md) |
| **Scheduling**          | Open Shifts filtered to claimable seats; `scheduling.manage` admitted to the calendar, summary, time-off and swap reads (seven of the fourteen widenings)                                                                                                             | [`SCHEDULING_MODULE.md`](./SCHEDULING_MODULE.md)                                                               |
| **Email**               | Enabled-but-unsendable sections refused on write; Cloudflare batch sending; twelve SMTP quick-fill presets; a null `email_service` section no longer breaks sending                                                                                                   | [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)                                                                   |
| **Inventory**           | Inspection dates moved only by inspections; items-list top-up guards keyed to the filter set                                                                                                                                                                          | [Read this first](#read-this-first)                                                                            |
| **Frontend-wide**       | Dialogs no longer dismiss on an outside click                                                                                                                                                                                                                         | [`CLAUDE.md` pitfall #31](../CLAUDE.md)                                                                        |
| **Permissions**         | The `manage` grant admitted to fourteen reads whose bodies branch on it                                                                                                                                                                                               | [Permission and enforcement movements](#permission-and-enforcement-movements)                                  |
| **First-run setup**     | `onboarding_status` constrained to one row; duplicate rows de-duplicated on upgrade                                                                                                                                                                                   | [Alembic route](#alembic-route-upgrade-data-path)                                                              |
| **Security review**     | 93 commits; pass 5 completed its lap at features 00–22 and the rotation reset; pass 6 has reached Feature 06 (Elections & ballots)                                                                                                                                    | [`security-review/PROGRESS.md`](./security-review/PROGRESS.md)                                                 |
| **Build**               | The redundant root `vite` override dropped, with `scripts/check_npm_overrides.py` guarding the drift it caused                                                                                                                                                        | [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md)                                                               |

## New URLs

**None.** No `<Route>` was added, none retired, and neither
`APPLICATION_PAGES.md`, `testingRegistry.ts` nor `e2e/mobile-route-inventory.ts`
changed. Every behaviour change in this window happens at an address that
already existed.

## Alembic route (upgrade data path)

One migration, and it is the only schema change in the window.

| Revision       | What it does                                                                        | Reversible                                    |
| -------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| `6ab7d903fae5` | Enforces the `onboarding_status` singleton and de-duplicates any rows already there | Yes — the downgrade drops the constraint only |

**What it fixes.** Concurrent first-run requests could each insert an
`onboarding_status` row. Once two existed, `scalar_one_or_none()` raised
`MultipleResultsFound` on every `GET /onboarding/status`, which turned two
harmless rows into a permanent 500 and left setup with no way forward. The
readers were made duplicate-safe in the same change — they take `.first()`,
which answers the only question being asked — so an installation that is
_already_ duplicated recovers on the code upgrade rather than needing the
migration to land first.

**The downgrade does not restore duplicates**, which is correct: it removes the
constraint and leaves one row. There is nothing a second row was carrying that
the first does not.

## Permission and enforcement movements

**Nothing is revoked this window.** Fourteen reads were widened, all the same
shape, and one enforcement gate reached a second path.

### Fourteen reads now admit the `manage` grant

`permission_matches` is literal: `X.manage` does not imply `X.view`. A route
gated on `X.view` alone whose body then branches on `X.manage` to widen scope
refuses the manage-only holder before the branch can run.

| Route(s)                                                                                                                   | Was gated on               | Reaches a default install?            |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------- |
| `GET /prospects/{id}/events`                                                                                               | `prospective_members.view` | **Yes**                               |
| Elections' candidate list, events' attendee list, finance's expense-report list and detail, member dues, dues payments (6) | `X.view`                   | No — needs a hand-configured position |
| `GET /calendar/week`, `/calendar/month`, `/summary` (3)                                                                    | `scheduling.view`          | No                                    |
| `GET /time-off`, `GET /time-off/{id}` (2)                                                                                  | `scheduling.view`          | No                                    |
| `GET /swap-requests`, `GET /swap-requests/{id}` (2)                                                                        | `scheduling.swap`          | No                                    |

**The one that reaches a default install is `GET /prospects/{id}/events`.**
President, secretary, vice president and membership coordinator are all seeded
`prospective_members.manage` _without_ `.view`. They could link an event to a
prospect — `POST` is gated on `manage` — and not read the links back.
`LinkedEventsSection` catches the rejection into `setLinkedEvents([])`, so the
drawer showed **"no linked events"** rather than an error: an empty set
rendered as a passing one, and the links they added kept vanishing.

**The swap pair sat on a different base grant, and that is the point.** Swaps
are gated on `scheduling.swap`, which every line member holds, rather than on
`scheduling.view`. A position granted `manage` alone held neither, so the defect
is identical while the gate it hides behind is not. **The four swap and time-off
_writes_ stay on `scheduling.swap` alone**, checked rather than assumed: not one
of them branches on `manage`, because proposing and cancelling a request are the
member's own actions. The sweep's test pins that half too, so the widening
cannot spread along the resource by habit.

**The time-off pair is a reversal, in the same window.** `d1070ecc2` left it
narrow on the reasoning that the list carries members' stated reasons and so is
not a projection of anything `manage` already reads. `241bdb3cb` reversed that
five hours later: the reasoning is true of the data and irrelevant to the gate,
because both handlers **already branch on `scheduling.manage`** to hand a
reviewer the department-wide view. A `manage`-only position is exactly who
`/time-off/{id}/review` exists for, and could reach neither the queue that finds
a request to review nor a request it was sent a link to.

**No handler body changed and no read gains a path it did not have.** Each
still scopes on `current_user.organization_id`, and the finance and dues
handlers still narrow to the caller for anyone without `finance.manage`
(pitfall #14).

`tests/test_permission_gate_branch_sweep.py` turns the one-off scan into a
standing check: a gate must admit every grant its own body branches on, and a
`.view` gate must admit the `.manage` grant seeded beside it, computed from
`DEFAULT_POSITIONS` and `OPERATIONAL_RANKS` rather than hardcoded.

### The membership-vote gate reached the Convert button (MP-30)

The election-vote completion gate added by ordinary feature work ran inside
`complete_step` only. It never ran on `transfer_to_membership` —
`POST /prospects/{id}/transfer` — **which is the documented, primary way a
coordinator finishes a pipeline's final stage.** `skip_current_step`'s own
refusal message says "convert or reject instead", and the frontend's **Convert**
button, shown whenever an applicant is on the last stage, calls transfer
directly and never `complete_step`. So an applicant the department's own
election had rejected could be converted to a full member with the gate never
consulted.

`_election_block_reason` is now checked first thing in `_do_transfer`, returning
the same refusal shape that method already uses for every other business rule.
**This extends the 2026-09-13 `UPGRADING.md` entry**, which describes the gate
as refusing **Advance**: it refuses Convert too.

## Documentation and media disposition

### Screenshots

Full per-image queue in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md);
coverage counts are regenerated into
[`training/SCREENSHOT_STATUS.md`](./training/SCREENSHOT_STATUS.md) by
`scripts/screenshots/status_report.py` (**530 captured, 42 remaining** as of
this audit).

**This window adds a small queue, and none of it is urgent** — no screen moved
and no control was added to a page that had none. What changed is what a
screen _contains_ under the same address.

| Image area                               | Disposition   | Why                                                                                                                       |
| ---------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Scheduling → **Open Shifts** board       | **REPLACE**   | The member's board is now filtered to claimable seats; an old capture over-states what is offered                         |
| Shift signup picker → position dropdown  | **REPLACE**   | Offers only seats the server will grant, and says "every seat you are cleared for is filled" instead of "not eligible"    |
| Settings → **Email**, provider list      | **REPLACE**   | Twelve SMTP quick-fill presets are now offered where the screen previously showed Self-Hosted or Other                    |
| Settings → **Email**, inline validation  | **NEW**       | The refusal for an enabled-but-empty Cloudflare or Other section is new, and is what an operator will hit after upgrading |
| Stage builder → **Meeting** config       | **REPLACE**   | Carries the Auto-Link Event Type warning beside the auto-advance checkbox                                                 |
| Stage builder → **Election Vote** config | **NEW**       | The type is creatable from the picker for the first time                                                                  |
| Inventory item → maintenance history     | **NO CHANGE** | The rule changed, the screen did not                                                                                      |

**Do not re-shoot for the dialog change.** A dialog that no longer closes on an
outside click looks identical in a still frame. It is a video and prose matter,
not a screenshot one.

### YouTube script beats

Determinations are made by **reading the script files**, not by inferring from
this change list. Full disposition in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

- **03 — IT Manager / System Admin.** The email beats are the material here:
  an enabled section that cannot send is now refused at save time, the SMTP
  preset list makes Yahoo, Fastmail, Zoho, SES, SendGrid and seven more
  reachable without reasoning about "Self-Hosted", and a Cloudflare department
  can send ballot mail for the first time. Say plainly that a half-filled
  section used to shadow deployment-wide SMTP.
- **04 — Fire Chief / Leadership.** Four pipeline changes land on this script
  at once, and it is the script that carries the membership pipeline (fifteen
  mentions; no other script carries more than five). **Lead with the Convert
  button** — it is now gated by the ballot result, and the old take showing a
  coordinator converting an applicant straight off the final stage no longer
  reflects what happens.
- **06 — Member Guide.** The Open Shifts board is what a member notices. Frame
  it as what it is — the board stopped offering shifts the system would have
  refused.
- **08 — Quick Tips & Shorts.** Two shorts available: what the Open Shifts
  board now hides, and the SMTP preset list.
- **The inspection-clock fix has no script that owns it, and none was
  invented.** "Inspection" appears once each in 02, 04 and 07, and none of the
  three walks a maintenance record. 07 — Secretary / Administrative is where a
  gear chapter would go if one is ever added, and the forward-only caveat
  belongs in it then: **inspection dates that already slid keep the wrong
  value.** Recorded in `SCRIPT_CURRENCY.md` rather than forced into a script
  that does not cover the screen.
- **The dialog change needs no script edit, which the change list alone would
  have got wrong.** All seventeen scripts were searched for "click outside",
  "clicking outside", "click away" and "click off". **No script closes a dialog
  that way.** The only hit in the whole documentation set is the inventory
  guide describing an inline number field committing on blur, which is
  unrelated and unchanged.

**Do not script the crew Sweep, do not script qualification entry, and do not
script the equipment-check lap.** All three remain built and unreachable —
carried forward from the last three windows, unchanged.

## Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = 6ab7d903fae5
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
cd backend && python scripts/generate_schema_docs.py  # DATABASE_SCHEMA.md must not change
```

All six were run clean against `4c291192d` while writing this audit: migration
head `6ab7d903fae5`, single head, no branch points, 444 revisions; 228 routes
checked with 0 errors and 0 warnings (17 redirects skipped); 1,489 documented
route handlers with 0 errors and 0 warnings; 358 Markdown files with 0 broken
links; 530 screenshots captured with 42 remaining; `DATABASE_SCHEMA.md`
regenerated to 265 tables and 4,484 columns with no diff.
