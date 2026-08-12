# Screenshot currency

Which captured screenshots still match the application. Companion to
[SCREENSHOT_STATUS.md](./SCREENSHOT_STATUS.md), which counts how many
placeholders are **filled**; this file records whether what was captured is still
**true**.

Kept separately because `SCREENSHOT_STATUS.md` is regenerated wholesale by
`scripts/screenshots/status_report.py` and anything hand-written there is lost on
the next run.

**Newest flags first: see _[Images invalidated by the 2026-08-11 → 08-12
changes](#images-invalidated-by-the-2026-08-11--08-12-changes)_** — the mobile
hamburger moved to the left edge (touches every phone-width capture with a
header) and the Ballot Builder grew a Save-as-Template control. Flagged
2026-08-12, not yet re-captured.

**Re-captured 2026-08-11.** The seventeen images flagged under _[Images
invalidated by the 2026-08-10 → 08-11 changes](#images-invalidated-by-the-2026-08-10--08-11-changes)_
were re-shot against a live stack, and every one of them was opened and read
against its caption afterwards. See _[The 2026-08-11
pass](#the-2026-08-11-pass)_ for what that found. The guides listed under _Not
re-captured_ below are otherwise unchanged and remain stale.

**Re-captured 2026-08-10.** The 02, 03 and 09 guides — 57 images — were shot
against a live stack rebuilt from current `main`. The three other guides listed
under _Not re-captured_ below still carry images from **2026-08-09 09:43 UTC or
earlier** and remain stale.

> **An earlier revision of this file said re-capture was impossible here**,
> because MariaDB and a Docker daemon were both absent. That was true of the
> container, not of the project: `apt-get install mariadb-server` supplies the
> database, and the pipeline runs fine without Docker. The claim is corrected
> rather than deleted because it is the sort of environment assumption that
> quietly becomes policy.

---

## Images invalidated by the 2026-08-11 → 08-12 changes

**Flagged 2026-08-12, not yet re-captured.** Two UI changes landed after the
2026-08-11 passes and reach existing images. Flagged by comparing each image's
subject against the commits, not by opening them.

### A. The mobile hamburger moved to the left edge

`SideNavigation`'s phone header now puts the ☰ button at the **left** edge
(the edge the drawer slides in from) with the logo/department name to its
right; it was previously at the far right. The component renders the top bar
of **every authenticated page on a phone**, so every phone-width capture that
includes the top bar now shows an outdated header:

| Image | Why it's in frame |
| --- | --- |
| `10-04-mobile-dashboard` | fullPage, header at top |
| `10-05-mobile-inventory` | header at top |
| `10-06-mobile-inventory-admin` | fullPage, header at top |
| `10-10-mobile-minimum-text` | header at top |
| `10-15-mobile-menu-notifications` | shot *of* the open menu — the button itself is the subject |
| `10-14-scan-camera-denied` | viewport-anchored, header at top |
| `03-48-settings-phone`, `03-73-flat-check-form-header`, `03-95-apparatus-inventory` | top-anchored phone shots |

**Not invalidated, recorded so nobody re-checks:** `10-12-mobile-bottom-nav`
(clipped to the bottom nav element), `03-71-set-all-to-par-confirm` (dialog
clip), `04-32`/`04-33` guest sign-in (public `/login` renders outside
`AppLayout` — no hamburger), and mid-page clips that never reach the top bar
(`03-60`, `03-70`, `03-72`, `03-96` — verify by opening before re-shooting).

The training guide's new header note carries a matching
`[SCREENSHOT NEEDED]` for the re-shoot.

### B. The Ballot Builder grew a "Save as Template" button

`14-04-ballot-configuration` pictures the Ballot Builder, which now shows
**Save as Template** beside its actions whenever the ballot has items (and the
template picker gained a "Your saved ballots" section). The whole guide-14 set
was already listed under *Not re-captured* as cosmetically stale; `14-04` is
now **structurally** stale, and two new placeholders in
`14-elections.md` (the save form, the saved-ballots picker) have never been
shot. Note for the harness: the saved-templates picker needs a seeded saved
template — `seed_demo_data.py` does not create one yet.

### C. Checked and not invalidated

- **The responsive sweeps (08-11)** are scoped under 768px, so the existing
  desktop captures are unaffected. The two everywhere-width changes have no
  captures to invalidate: the Member Training Status page (gained its page
  gutter) has no shot in the manifest, and no facility detail page is shot at
  phone width.
- **The confirm-dialog sweep** replaced *native* browser dialogs, which
  Playwright could never photograph anyway; `00-14-confirm-dialog` pictures
  the in-app dialog, which is the surviving pattern.
- **`02-104-cohort-preview-step`** was captured in the same commit that fixed
  the holiday-chip date format it pictures, so it is already current.

---

## What re-capturing exposed

Eight defects, plus two in the harness itself. None were reported by the
capture run: it listed **26/26 captured, 0 flagged** for a batch containing two
images showing the opposite of their captions. Its empty-state check can tell
that a page rendered, not that it rendered the thing the caption promises.

| Defect                                                                                                                                           | Found by                                                          | Fix                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platoon Management captioned "platoon columns and their members", showing a "platoon scheduling is turned off" banner over one Unassigned column | Opening the image                                                 | Seeder enables platoons and deals the roster A/B/C                                                                                                                                                                                                             |
| Scheduling Settings showed six sections against documentation describing seven                                                                   | Same — Platoons is hidden while the feature is off                | Same fix                                                                                                                                                                                                                                                       |
| `03-14` captioned "compliance report", showing an empty date picker                                                                              | Opening the image                                                 | `prepare` step drives the Shift Compliance tab                                                                                                                                                                                                                 |
| `09-10`, `09-11`, `09-12` timed out on an empty validation queue                                                                                 | Capture failure, then tracing it to the data                      | Peer examiner was a **lieutenant**, whose rank grants `training.manage`, so their submission self-validated. Switched to a firefighter; the seeder now asserts it                                                                                              |
| `02-21` and `02-41` were **byte-identical**, both shooting the default tab under two different captions                                          | Hashing the whole image set                                       | Both routes now carry `?tab=`                                                                                                                                                                                                                                  |
| `04-20` and `17-01` byte-identical to _other_ shots — hub routes defaulting to another tab                                                       | The same MD5 sweep, set aside at first as another guide's problem | Both carry `?tab=`. `17-01` needed a second fix: `/settings/account` is a `<Navigate>` with no query, so React Router dropped `?tab=` on the redirect and the shot stayed on the Account tab while the harness reported success. Uses the canonical `/account` |
| Expiring Certifications permanently empty                                                                                                        | Fixing the route above                                            | The seeder's own comment promised near-future expiries; its arithmetic put the earliest at **TODAY + 233 days**, so none of the 66 records could enter the 90-day window                                                                                       |

### Two defects in the harness

Both surfaced by images, and both had been costing accuracy silently:

- **A false positive held back a correct screenshot.** The empty-state check
  scanned the whole page as one blob, so `17-01` was flagged on its own help
  text — "These are optional — _nothing here_ is required for membership."
  Prose, not an empty state. It now matches per line and only on lines short
  enough to _be_ the message, which is what distinguishes a standalone
  "No Integrations Yet" from the same words mid-sentence.
- **A false negative let an empty page through.** The pattern required the
  phrase to end in found/yet/scheduled/available/to show, so
  "No certifications expiring within 90 days" scanned as populated — which is
  exactly why the empty expiring-certs page reported `empty=False` and was
  publish-eligible while showing nothing. Line scoping makes a whole-line
  "No …" safe to match, so that gap is closed.

### Two duplicate pairs are legitimate

`03-15` / `03-32` (settings defaults to `?tab=general`) and `03-02` / `03-08`
(the Calls / Runs section lives inside the shift detail panel) are genuinely one
screen satisfying two captions. Recorded so a future hash sweep does not
re-investigate them.

### A product bug these images display

`03-14` shows **"Total Members 66"** for a 22-member department.
`SchedulingReportsPage.tsx` computes that card as
`complianceData.reduce((sum, r) => sum + r.total_members, 0)` — a sum of
per-requirement cohorts, so a member counted under three requirements counts
three times. The Compliant and Non-Compliant cards sum the same way: the values
are member-requirement pairs, the labels claim members.

**Not fixed here.** The payload carries no distinct-member count, so correcting
it means either relabelling the cards or adding a field to the API — a product
decision, not a screenshot one. The image accurately shows current behaviour;
this note exists so the guide does not silently endorse the number.

### Held back deliberately

`02-68-vector-category-mapping` still has nothing to photograph. Category
mappings are created **only** by `POST /providers/{id}/sync-categories`, which
fetches the live vendor catalogue over the network — there is no create
endpoint the seeder could call, so the table stays empty however much demo data
is added. The harness flags the shot and does not apply it, and it is **not
committed**, so the guide keeps its unfilled placeholder rather than gaining a
picture of an empty table under a caption describing a full one.

**Resolved 2026-08-12 for `02-42-external-integrations`.** That one was empty
for a reason the seeder _could_ fix — the demo department had no provider
configured at all. `seed_external_provider` now saves one, and the shot is
captured and applied. Only the configuration is seeded: `connection_verified`
and `last_sync_at` are written by a real sync, so the card reads "Connection
not verified" and "Last Sync: Never", which the guide's prose now explains
rather than contradicts.

### Salesforce cannot be connected in a demo department, and that is correct

The Salesforce Sync panel is real and worth a picture, but it renders only for
an integration whose status is `connected`, and `POST
/integrations/{id}/connect` will not grant that. `instance_url` must match
`^https://[a-zA-Z0-9\-\.]+\.salesforce\.com$` **and** resolve in DNS — the SSRF
guard calls `getaddrinfo` on it. A Salesforce instance host is per-customer
(`oakvillefd.my.salesforce.com`), so the demo department's does not exist and
never will.

**Deliberately not worked around.** The hosts that do resolve —
`login.salesforce.com`, `test.salesforce.com`, `na1.salesforce.com` — are login
and pod hosts, not any department's instance, and seeding one would put a URL
in the demo database that is wrong in a way a reader could copy. That is a
different case from `seed_external_provider`, where the vendor's real API host
_is_ the value every customer uses.

The section's prose has been corrected against the code instead, so the guide
describes the panel accurately without a picture of it.

### A seed gap that wasn't — the quantity checklist was reachable all along

**Withdrawn 2026-08-12, the day after it was written.** This section claimed
three 03-scheduling placeholders — the carry-over banner, the Set All to Par
confirmation, and the flat check form on a phone — were unreachable because the
only template with quantity items is bound to **M-3** and `seed_scheduling`
rosters shifts onto `fleet[:3]` only. The premise about the roster is true. The
conclusion drawn from it was not.

**A check does not need a shift.** `MyChecklistsPage` has an **Unscheduled
checklist** button that offers every active template and starts a check with no
shift attached — the same standalone-check feature the guide documents two
sections further down. All three shots were captured through it with no seeder
change at all, and they are now applied.

The mistake was reasoning from `/equipment-checks/my-checklists` (which is
shift-derived, and was correctly read) to "the screen is unreachable", without
reading the page that renders it. Recorded rather than deleted because the
cheap check — open the page and look at what else is on it — is the one that
was skipped.

**What was genuinely missing** was smaller and got fixed here: no seeded
template had a **section header**, so the bold in-compartment caption the guide
documents could not be pictured and the renderer had never met one in demo
data. `_add_section_header` now puts one on the engine checklist.

---

## Not re-captured

These guides still carry pre-2026-08-09 images. Everything in them is at least
**cosmetically** stale: the 2026-08-10 form-control sweep touched 103 files
across every module, so any screenshot containing a text input, select or
checkbox differs from the current build in control padding, corner radius,
checkbox size and focus ring.

| Guide                        | Captured |
| ---------------------------- | -------: |
| `00-getting-started.md`      |        4 |
| `01-membership.md`           |        9 |
| `04-events-meetings.md`      |       10 |
| `05-inventory.md`            |       18 |
| `06-apparatus-facilities.md` |       13 |
| `07-documents-forms.md`      |       13 |
| `08-admin-reports.md`        |       11 |
| `10-mobile-pwa.md`           |        5 |
| `11-finance.md`              |       12 |
| `12-grants-fundraising.md`   |       10 |
| `13-medical-screening.md`    |        5 |
| `14-elections.md`            |        7 |
| `15-prospective-members.md`  |       11 |
| `16-integrations.md`         |        1 |
| `17-privacy-data-rights.md`  |        2 |
| `18-storefront.md`           |        4 |

`10-mobile-pwa.md` is the most affected of these: it shoots at phone width,
where the sweep's 44px minimum control height changes layout rather than just
appearance.

---

## Verification method

Captured images were checked **by opening them and reading them against the
caption they fill**, not by trusting the harness's exit code — every defect
above survived a green capture run. Two whole-set screens ran alongside that:
an MD5 pass for duplicate files, which is what caught `02-21`/`02-41`, and a
colour-uniformity pass for blank or near-blank pages.

Not every one of the 57 was opened individually. Priority went to the
structurally-changed screens, every shot carrying a `prepare` step, and anything
either screen flagged.

---

## Superseded — the 2026-08-09 staleness audit

The table below is the pre-re-capture analysis, kept for the reasoning rather
than the verdicts.

Every **Structural** row was re-captured successfully. Four —
`09-07`, `09-08`, `09-09` and `09-12` — produced **byte-identical** output, so
they do not appear in the commit diff. That is not the same as "not
re-captured": those screens already matched the current build, and the shots had
been failing for a data reason rather than a rendering one. `09-12` is the clear
case — it timed out before the examiner fix and captures cleanly after it, while
rendering exactly the same pixels, because the stale file on disk had been shot
when a pending validation happened to exist.

Worth stating because a diff-based reading gets it backwards: an unchanged image
file after a successful re-capture is the _good_ outcome. It means the screen was
already current.

## Structural — re-capture first

| Image                                     | Screen                        | What changed                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `03-15-scheduling-settings.png`           | `/scheduling/settings`        | Rebuilt onto the shared settings layout: section sidebar on desktop, tab strip on phones, single header replacing two stacked titles                                                                                                                               |
| `03-32-settings-general-closeout.png`     | `?tab=general`                | Same, plus the Save/Reset footer now appears only on General, Apparatus and Equipment                                                                                                                                                                              |
| `03-34-settings-checklist-timing.png`     | `?tab=shift-reports`          | Same layout change; Shift Reports no longer shows the page-level Save footer                                                                                                                                                                                       |
| `03-35-settings-form-sections.png`        | `?tab=shift-reports`          | Same                                                                                                                                                                                                                                                               |
| `03-36-settings-apparatus-skills.png`     | `?tab=shift-reports`          | Same                                                                                                                                                                                                                                                               |
| `03-37-settings-rating-scale.png`         | `?tab=shift-reports`          | Same                                                                                                                                                                                                                                                               |
| `03-38-notifications-assignment.png`      | `?tab=notifications`          | Same layout change, plus the preset toggles are now labelled switches with a disabled treatment and an error state when the rules fail to load                                                                                                                     |
| `03-39-notifications-reminders.png`       | `?tab=notifications`          | Same                                                                                                                                                                                                                                                               |
| `03-40-settings-position-eligibility.png` | `?tab=eligibility`            | Same layout change                                                                                                                                                                                                                                                 |
| `02-09-program-detail.png`                | `/training/programs` → detail | Gained the per-requirement **prerequisite** toggle, the checklist step list, and the reminder-schedule editor                                                                                                                                                      |
| `02-11-pipeline-wizard.png`               | Create-pipeline wizard        | Structure picker is **Phases / One list** ("Sequential" retired); checklist requirements now have a steps editor with per-step visibility                                                                                                                          |
| `09-*` (11 images)                        | Skills testing                | The scoring screen was rebuilt — 44px section chips replace progress dots, candidate name added to the header, scored/total and save-status lines added, **Next** replaces **Finish** as the primary bottom-bar button. Test Records rows now read "Tap to resume" |

## Cosmetic — the rest

All remaining images. Guides, with the count of captured images each:

| Guide                        | Captured | Backing screens touched by the 2026-08-09/10 sweep                      |
| ---------------------------- | -------: | ----------------------------------------------------------------------- |
| `00-getting-started.md`      |        4 | Login, Dashboard, Account Settings                                      |
| `01-membership.md`           |        9 | Members, Add Member, prospect drawer                                    |
| `02-training.md`             |       21 | Most training pages (see structural rows above for two)                 |
| `03-scheduling.md`           |       26 | Scheduling page and its tabs, shift detail panel, equipment-check pages |
| `04-events-meetings.md`      |       10 | Events list/detail/edit, minutes                                        |
| `05-inventory.md`            |       18 | Allowances, item detail                                                 |
| `06-apparatus-facilities.md` |       13 | Apparatus, locations, facilities sections                               |
| `07-documents-forms.md`      |       13 | Forms                                                                   |
| `08-admin-reports.md`        |       11 | Reports, action items, org settings, error monitoring                   |
| `09-skills-testing.md`       |       11 | **See structural**                                                      |
| `10-mobile-pwa.md`           |        5 | Multiple, at phone width — most affected by the 44px control minimum    |
| `11-finance.md`              |       12 | Finance settings, approval chains, check requests                       |
| `12-grants-fundraising.md`   |       10 | Grants pages                                                            |
| `13-medical-screening.md`    |        5 | Screening record and requirement forms                                  |
| `14-elections.md`            |        7 | Elections list/detail/settings, ballot voting                           |
| `15-prospective-members.md`  |       11 | Pipeline board, settings, interview page                                |
| `16-integrations.md`         |        1 | Integrations catalog                                                    |
| `17-privacy-data-rights.md`  |        2 | Account settings                                                        |
| `18-storefront.md`           |        4 | Product form, store settings                                            |

---

## Images invalidated by the 2026-08-10 → 08-11 changes

**Read this before trusting the "Re-captured 2026-08-10" note above.** That pass
ran at **22:34 UTC** and covered guides 02, 03 and 09. Two large branches merged
**after** it:

| Branch                                    | Merged               | What it changed on screen                                                                                                      |
| ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Email template catalogue + footer library | 2026-08-10 **22:45** | The whole outgoing-email design, and a new **Footers** tab on the Email Templates page                                         |
| Inventory ↔ equipment-check supply loop   | 2026-08-10 **23:22** | The template builder toolbar, the check form, the inventory items grid and toolbar, the inventory admin hub, and two new pages |

So **no capture in the repository postdates the supply work**, and the guide-08
email screenshots predate the email redesign by 21 hours. Everything below is
flagged by comparing each image's last-captured timestamp against the commit that
changed the screen it pictures — not by opening it, which is the check that still
has to happen.

### A. Stale because of the supply / catalog-linking work

Nothing in this group has ever been captured against the shipped code.

| Image                               | Captured    | What is now different                                                                                                                                                 |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03-22-equipment-check-builder.png` | 08-10 22:34 | The toolbar now carries a **linked / unlinked count**, and the quick-add bar is a **catalog search** with a "create in inventory" option rather than a plain name box |
| `03-25-equipment-checks-tab.png`    | 08-10 22:34 | The **My Equipment Checklists** header now carries an **Apparatus Inventory** link beside "Start a Check"                                                             |
| `05-01-inventory-items.png`         | 08-10 01:11 | The **Qty** column reads ready units across in-date lots for lot-stocked items and is labelled **"in-date lots"**                                                     |
| `05-47-items-filter-bar.png`        | 08-10 01:11 | The Manage Items toolbar now carries **Receive Stock**, **Add Several** and **Import CSV** that was previously unreachable from this page                             |
| `05-25-admin-hub.png`               | 08-08 00:45 | The hub now links out to **Scheduling → Supply** (Expiring on Apparatus)                                                                                              |

### B. Stale because of the email redesign

Guide 08 was **not** part of the 22:34 re-capture. All three images show the
retired full-bleed red band over a grey slab; outgoing mail is now a white card
on a grey page.

| Image                                                  | Captured    | What is now different                                                                                                                                                                   |
| ------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `08-34-email-templates.png`                            | 08-10 01:11 | Preview pane shows the old design; the tab strip is missing **Footers**                                                                                                                 |
| `08-36-template-search.png`                            | 08-10 01:11 | Same page, same two changes                                                                                                                                                             |
| `08-37-email-officers.png`                             | 08-10 01:11 | Same page, same two changes                                                                                                                                                             |
| `18-01-member-storefront.png`, `18-02-store-admin.png` | 08-08       | **Check before re-shooting.** The storefront's _emails_ moved onto the shared theme; these two picture the store's own screens and may be unaffected. Listed so the question gets asked |

### C. Stale because the pictured screen was fixed after the shot

All captured at **08-10 01:11**, before the fix landed the same day.

| Image                                                                                             | What is now different                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `00-04-dashboard-overview.png`, `00-07-dashboard-panels.png`                                      | The **Open Shifts** panel is capped at five with an "N more" line. It previously rendered every open shift in the next 30 days — 48 rows on the demo department, which is why the dashboard in these shots is 6,930px tall with the ID card and equipment panels pushed off the bottom. Shift dates in **My Upcoming Shifts** were also rendering a day early for some viewers |
| `11-05-budget-detail.png`, `11-12-purchase-request-detail.png`, `11-14-expense-report-detail.png` | **Breadcrumbs now render on the loaded record.** They previously appeared only in the loading and not-found states, so these three shots have no breadcrumb trail where the shipped page has one                                                                                                                                                                               |
| `05-45-impact-planner.png` (08-08)                                                                | Ranks rendered as **"Deputy_chief"** with the underscore. Fixed 2026-08-10                                                                                                                                                                                                                                                                                                     |
| `06-21-apparatus-evoc-level.png` (08-08)                                                          | **Setting this field returned a server error when the shot was taken**, and once any apparatus had a level, the fleet list returned one too. The form works now, and the guide text around it was corrected: the levels are per-organization records, not a fixed Basic/Intermediate/Advanced triple                                                                           |

### The 2026-08-11 pass

**All seventeen images in groups A, B and C above were re-captured**, and each
was then opened and read against its caption. Sixteen came out right. The
seventeenth is the reason this section exists.

| Group | Images                             | Verified                                                                                                                         |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A     | `03-25`, `05-01`, `05-47`, `05-25` | Supply-loop changes present                                                                                                      |
| A     | `03-22`                            | **Was wrong. See below.**                                                                                                        |
| B     | `08-34`, `08-36`, `08-37`          | **Footers** now in the tab strip; the editor shows "Closes with"                                                                 |
| B     | `18-01`, `18-02`                   | The question the table asked is answered: the storefront's own screens were unaffected by the email redesign. Re-shot regardless |
| C     | `00-04`, `00-07`                   | Open Shifts is capped; the full dashboard is 4,486px, down from 6,930px                                                          |
| C     | `11-05`, `11-12`, `11-14`          | Breadcrumbs render on the loaded record                                                                                          |
| C     | `05-45`, `06-21`                   | Ranks read "Deputy Chief"; the EVOC form saves and shows "Level 2 — Intermediate"                                                |

**`03-22-equipment-check-builder` was photographing the wrong page, and had
been for as long as it existed.** Its route was
`/scheduling/equipment-check-templates/**new**` — the blank create form — and it
carried `allowEmptyState: true` with a note calling that correct, "the shot is
of the builder layout". But the guide text this image sits under is about
compartments, item check types and drag-to-reorder, and the page in the image
says "No compartments yet". The two changes that got it flagged for re-capture
in the first place — the toolbar's linked/unlinked catalog count and the
quick-add bar's catalog search — do not render at all without items on the page,
so re-shooting the same route would have produced the same wrong picture with a
fresher timestamp.

It now opens the seeded **Medic 3 Supply Check**, and shows the `5/8 linked`
badge, three compartments, per-item check types, the catalog quick-add bar and
the summary bar. `fullPage` is off: the toolbar and the summary bar are both
sticky, so a full-page capture paints each of them twice.

The lesson is the one the harness section above already makes, sharpened: an
`allowEmptyState` flag records that somebody decided a page was legitimately
empty. That decision is worth re-examining whenever the caption changes — the
flag is what stops the one check that would have caught this.

**Three empty-state flags were false positives, all the same shape.** A
`<select>`'s placeholder option — "No EVOC requirement", "No EVOC level", "No
category" — is in the DOM on every render, including the ones where a real value
is selected. `03-52` and `06-23` now carry `allowEmptyState` with a comment
saying which option is doing it. `03-54`'s flag is a different false positive:
"No calls logged for this shift" belongs to a sub-panel further down the same
drawer, and the shift is deliberately in the future.

**One shot needed new seed data.** `03-54-crew-board-open-slots` had been
failing outright — "no future shift is part-staffed with 2+ open" — because the
seeder staffs every shift to its minimum or one short. That is what a real
schedule looks like, but it meant the crew board never showed more than one open
row and the bulk **Fill All Open** action, which appears only at two or more,
was unreachable in the demo. `PART_STAFFED_SHIFT` now leaves one future shift
crewed by its officer alone. The repair runs against the API as well as in the
create path: an existing shift is skipped on a re-run, so a create-path-only fix
would have worked on a fresh database and nowhere else.

**The Add Operator form cannot be photographed with its picker open.** Both
selects on it are native, and an open native popup is drawn by the operating
system rather than the page, so Playwright cannot capture it. `06-23` shows the
two fields _set_ instead, which makes the same point more directly: a real
member name proves the box is a picker over the roster, and an EVOC level beside
it is the combination that used to return a server error.

**Still not fixed: `11-05-budget-detail` pictures a budget with no
transactions.** The breadcrumb fix it was flagged for is confirmed, but every
seeded budget has `amountSpent: 0`, so Transaction History is genuinely empty and
the utilization bar reads 0.0%. The seeder creates purchase requests and expense
reports without settling any of them against a budget. Closing that gap is
seeder work, not a capture setting.

### Two sessions shot the same screens at once

This pass and the one recorded above it ran in parallel against the same
backlog, and both photographed the email screens, the two inventory modals, an
item's Stock tab and four of the supply shots. Nothing was lost — the duplicates
were reconciled on merge, keeping whichever version was better and deleting the
other — but the effort was spent twice, and one of the reconciliations was not
obvious:

- **`08-67-email-preview-design`.** One version opened the welcome email and
  concluded, in the guide, that the preview pane simply cannot show a footer:
  it is a fixed 600px iframe and the message is taller. The other opened
  **Shift Assignment** instead, because the footer renders only where the body
  contains `{{footer_html}}` and most shipped bodies predate footers. The second
  is right, and the first would have documented a limitation that is really a
  template-choice problem. Kept the second.
- **Numbering collided.** Both sessions took `05-65`, `05-66` and the `03-57`
  … `03-62` range for different screens. Ids are full slugs, so no file was
  overwritten, but the numbers no longer read in order. Before adding a shot,
  check the manifest for the next free number rather than counting the images
  on disk.

### D. Verified current — do not re-shoot on this pass

| Image(s)                                                                  | Why                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Everything in guides **02**, **03** and **09** except `03-22` and `03-25` | Captured 08-10 22:34 against the current code for those screens |
| `01-08-member-audit-history.png`                                          | Re-captured after the event-type filter and details-panel fixes |
| `08-60` … `08-63` (notification shots)                                    | Captured after the delivered-status and `?tab=` fixes           |
| The 15-prospective-members set                                            | The Linked Events badge capitalization fix is in these captures |

### Screenshots that do not exist yet

The 2026-08-11 documentation pass added **18 new `[SCREENSHOT NEEDED]`
placeholders** for screens that have never been photographed:

| Guide                        | Placeholders added                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03-scheduling.md`           | Apparatus Inventory page, the lots sheet, the report-used sheet, the quick-add catalog search, the bulk inventory-match dialog, the check form with carry-over banner, the Set All to Par warning, the Expiring on Apparatus worklist (8) |
| `05-inventory.md`            | The two-ledger items grid, the Receive Stock modal, the Add Several modal, an item's Stock tab with deployed positions                                                                                                                    |
| `06-apparatus-facilities.md` | The Operators tab, the Add Operator member picker                                                                                                                                                                                         |
| `08-admin-reports.md`        | The Footers tab, the footer selector in the template editor, the Organization variable palette, the new email preview design                                                                                                              |

**All eighteen are now captured and applied** _(2026-08-11)_, across the two
parallel sessions recorded above:

| Guide | Shot as                                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03`  | `03-95` apparatus inventory, `03-96` lots sheet, `03-59` worklist, `03-69` quick-add, `03-68` bulk match, plus the report-used sheet, carry-over banner and par warning |
| `05`  | `05-53` the two-ledger grid, `05-09` Receive Stock, `05-10` Add Several, `05-07` an item's Stock tab                                                                    |
| `06`  | `06-22` Operators tab, `06-23` Add Operator                                                                                                                             |
| `08`  | `08-64` Footers tab, `08-65` footer selector, `08-66` variable palette, `08-67` email preview                                                                           |

The numbering does not run in order because two sessions allocated ids at the
same time — see _Two sessions shot the same screens at once_ above. The
apparatus shots select M-3 from the picker by the option's **value** rather
than its label, since the label is built from two fields and matching it as a
string breaks the moment either changes.

`08-64` only became possible on 2026-08-11: the Email Templates page held its
tab in plain state, so a shot of the Footers tab would have silently captured
the Templates tab — the same way `02-21`/`02-41` and `04-20`/`17-01` came to be
byte-identical images under different captions. `?tab=` now round-trips all
five tabs, with a test pinning every call site.

**Superseded.** An earlier revision of this section said fourteen of the
eighteen had no manifest entry and that several needed seed data that did not
exist — a position carrying two lots with two dates, a truck below par, a
restock report raised by a member. All three now exist, and all eighteen are
shot.

**The seeder gap is closed** _(2026-08-11)_. `seed_supply_tracking` in
`scripts/screenshots/seed_demo_data.py` now builds the state these sections
describe, on the medic unit:

| What it seeds                                                                              | Which screenshot needs it                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Five dated consumables with shelf lots, one of them **already expired**                    | The struck-through row on the worklist; the two-ledger Qty column                                                                                            |
| Catalog links on the counted positions, **and three positions deliberately left unlinked** | The toolbar's coverage count; the bulk-match dialog                                                                                                          |
| Naloxone from **two lots with two dates** on one bracket                                   | The lots sheet, and the "soonest aboard" rule                                                                                                                |
| Gauze at **18 of 24**                                                                      | The amber short count, and the Set All to Par warning — which is suppressed on a compartment already at par, so a fully stocked department cannot picture it |
| A restock report raised **by the demo member**, not the administrator                      | The worklist row naming a real reporter, which is the whole claim about who can record use                                                                   |

**A defect the wiring exposed.** The seeder had been writing
`"check_type": "presence"` on every equipment-check item. The column is a free
`String(30)` so the API accepted it, but the eight types the check form
recognises spell it **`present`** — and an unrecognised value falls through the
form's switch to the pass/fail branch. So every seeded item rendered **Pass /
Fail** buttons under a guide describing Present / Missing, and nothing reported
a problem. Fixed, with a `_repair_check_types` pass for rows a long-lived demo
database already holds. Same shape as the skills-testing `"checkbox"` criterion
type recorded in `KNOWN_LIMITATIONS.md`; worth assuming there are more of these
wherever a type is stored as a free string.

---

## Re-capturing

See [`scripts/screenshots/README.md`](../../scripts/screenshots/README.md). The
short version, once MySQL/MariaDB and Redis are up:

```bash
scripts/screenshots/dev_env.sh                       # blocks until the stack answers
python scripts/screenshots/seed_demo_data.py         # run before EVERY capture
node scripts/screenshots/capture.mjs --only 03-      # one guide at a time
python scripts/screenshots/apply_placeholders.py
python scripts/screenshots/status_report.py
```

**Structural first, and by guide.** `--only 09-` and `--only 03-` cover the two
screens that changed shape; the cosmetic tier is worth doing in one full run
rather than piecemeal, since a partial sweep leaves two control styles side by
side in the same guide.

**Update this file when you do.** It is the only record that a captured image was
checked against the build rather than merely present on disk.
