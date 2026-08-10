# Screenshot currency

Which captured screenshots still match the application. Companion to
[SCREENSHOT_STATUS.md](./SCREENSHOT_STATUS.md), which counts how many
placeholders are **filled**; this file records whether what was captured is still
**true**.

Kept separately because `SCREENSHOT_STATUS.md` is regenerated wholesale by
`scripts/screenshots/status_report.py` and anything hand-written there is lost on
the next run.

**Audited 2026-08-10.** 194 images, all captured on or before
**2026-08-09 09:43 UTC**. 174 frontend source files changed after that. The table
below is derived from which source files back which screens — it is a staleness
_audit_, not a re-capture. **No images were re-captured in this pass**; MariaDB
and a Docker daemon were both unavailable in the environment the audit ran in, and
the pipeline drives the real application.

---

## How to read this

| Tier           | Meaning                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Structural** | The screen is laid out differently, or its controls are different. The screenshot shows something that is no longer there. **Re-capture before the guide is published or filmed.**                                 |
| **Cosmetic**   | The content and layout are unchanged; form controls were normalised (padding, corner radius, checkbox size, focus ring, 44px minimum height on phones). A reader will not be misled. Re-capture opportunistically. |

Everything captured is at least **cosmetic**-stale: the 2026-08-10 form-control
sweep touched 103 files across every module, so any screenshot containing a text
input, select or checkbox differs from the current build in control padding and
corner radius.

---

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
