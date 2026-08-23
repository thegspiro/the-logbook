# Recent changes: August 19–23, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-08-19_TO_23.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-19_TO_23.md).
Predecessor: [August 17–19](Recent-Changes-2026-08-17-to-19).

**The headline:** departments can now write and publish their own privacy
notice and terms, with publishing held behind a second permission. Equipment
checks became safe to retry — one check per shift is now a database rule, so
a crew that completes an inspection in a dead spot no longer creates a
duplicate when the phone reconnects. Dialogs on a phone are finally tappable
all the way to the bottom. And two scheduling endpoints changed shape, which
will break anything reading them as a plain list.

## Read this first if you integrate with the API

`GET /scheduling/swap-requests` and `GET /scheduling/time-off` **no longer
return an array.** They now return:

```json
{ "items": [...], "total": 0, "skip": 0, "limit": 50 }
```

Anything treating the response as a list — a script, an export, a dashboard —
needs updating.

## Pages and connection points

| Area                         | Pages                                                                                 | API/data connection                                                                                                                                                                                        | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Governance — Legal Documents | **`/governance/legal`** (new). What it publishes is what `/privacy` and `/terms` show | New table `legal_document_revisions`; new grants `legal.propose`, `legal.publish`; `GET /legal-documents`, `POST …/revisions`, `POST …/revisions/{id}/publish`, `POST …/{document_type}/revert-to-default` | **Proposing and publishing are separate permissions** — `legal.propose` drafts, `legal.publish` makes it public. One published revision per document at a time. Old revisions are archived, never deleted, because a records request asks what the notice said _on a date_. The reason for a change is required, not optional. The "Last updated" line is free text and is never parsed — date it however your records officer does            |
| Equipment checks             | Shift detail → equipment check; template builder; compartment tree                    | New table `equipment_check_bulk_requests`; new column `shift_equipment_checks.client_submission_id`; two new unique constraints                                                                            | **One check per shift per template, enforced by the database.** A retry, a double tap, or an offline queue replaying on reconnect now resolves to the same check instead of creating a second. Standalone (non-shift) checks require `equipment_check.manage`. Expired-equipment failures are worked out at read time, so a lot expiring after the check was recorded shows up without rewriting the record. Deep nested storage paths now fit |
| Dashboard                    | `/dashboard`; chief operations; organization asset widgets; training-officer widgets  | `GET /dashboard/widgets?period=`, `GET /dashboard/operations`, `GET /dashboard/asset-widgets`                                                                                                              | Sections are gated by **both** module and permission, and a section you cannot see is **omitted, not emptied** — so the dashboard cannot be used to work out what exists. `settings.manage` is deliberately **not** money access: totals need `finance.manage`, fundraising needs `fundraising.view`, outreach needs `events.manage`. Asset widgets carry counts and links only — no facility codes, accounts, budgets or leases               |
| Scheduling — requests        | Scheduling → Requests                                                                 | `GET /scheduling/swap-requests`, `GET /scheduling/time-off` now paginated                                                                                                                                  | **A requester can no longer review their own swap or time-off request, even holding `scheduling.manage`.** On a small department the officer requesting the swap is often the one who can approve it; a permission is not a second person. Requests are also restricted to their participants                                                                                                                                                  |
| Mobile — dialogs             | Every dialog, drawer and bottom sheet on a phone                                      | `useOverlaySurface`; `modal-panel-scroll`                                                                                                                                                                  | The bottom navigation now **hides while an overlay is open**. It previously painted over dialogs and swallowed their taps — the buttons were untappable rather than merely hidden, and the tap navigated the page out from under the dialog                                                                                                                                                                                                    |
| Browser tabs                 | Every page                                                                            | `RouteTitleManager`                                                                                                                                                                                        | Tabs now carry the page name instead of a generic app title, so several Logbook tabs are finally distinguishable. Titles work in background tabs, and a slow page never shows the previous page's name                                                                                                                                                                                                                                         |
| Events                       | Event type picker; pipeline board; event detail                                       | New `recruitment` event type                                                                                                                                                                               | Open houses and recruitment nights get their own type, so a pipeline stage can point at "the next recruitment event" without matching every fire-safety demo. New recruitment events **default to guest sign-in** — a recruitment event whose attendees never reach the pipeline has not recruited anybody. The event page shows who it brought in                                                                                             |
| Exports                      | Every CSV in the product                                                              | One shared escaper                                                                                                                                                                                         | A member named `Smith, John` no longer shifts the columns after them in the attendance export. Spreadsheet formula characters are neutralized everywhere, and blank cells no longer pick up a stray apostrophe                                                                                                                                                                                                                                 |

## Database upgrade route

Eight new migrations. **Current head: `a17c4e9d2b61`.** Back up, confirm
`alembic heads` returns exactly one, then `alembic upgrade head`.

| Revision                        | Adds                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `1eeb053d59b7`                  | Normalizes crew seat lists to one stored shape                                   |
| `7ed8593bc904`                  | Repeats a storage-area barcode backfill that a revision-id collision skipped     |
| `5c2f6a8b1d34`                  | Creates `push_subscriptions` where a collision skipped it                        |
| `d6f4a13c9e20` / `4c8d7e2a91b3` | Widen `check_items.compartment_path` to `TEXT`                                   |
| `9f6d1c2a4b70`                  | Makes `documents.file_name` / `file_path` nullable on already-upgraded databases |
| `06adc68a8b84`                  | `legal_document_revisions` + the `legal.propose` / `legal.publish` grants        |
| `5223a69474b8`                  | The `recruitment` event type                                                     |
| `8a4f2d1c9b30`                  | `equipment_check_bulk_requests`                                                  |
| `9bb38ab9b052`                  | Merge revision rejoining five heads                                              |
| `a17c4e9d2b61`                  | One-check-per-shift constraints; `client_submission_id`                          |

### Two things to know before you upgrade

**Three of these migrations repair a database that believes it is already
up to date.** Three earlier migrations were released under one revision id
and later renumbered, so a database upgraded during those windows carries a
valid stamp for work that never ran. The stamp cannot tell the two histories
apart, so the repair simply repeats the work, guarded by schema inspection.
On a healthy database all three are no-ops.

**Two migrations do not cleanly reverse.**

- `1eeb053d59b7` expands a legacy seat `count` into that many seats.
  Downgrading would cut a three-firefighter template to one, permanently.
- `a17c4e9d2b61` keeps one equipment check per shift and template, preferring
  a completed check and then the earliest one. **Duplicates are detached, not
  deleted** — their item snapshots are kept and a note explains what happened
  — but the downgrade cannot re-attach them, because a later check may now
  own that slot.

**Also:** downgrading past _both_ `compartment_path` widenings narrows the
column back to `VARCHAR(200)` and will truncate deep storage paths.

## What Legal Documents does and does not store

The **live wording** your members and the public see stays where it always
was, in the organization's own settings, so the public pages load with no
sign-in and no database join. The new table is the **governance record
around** it: who proposed which wording, what rule they were addressing, who
published it, and what the page said before.

That split is the point. A department can already see its current notice. What
it could not do before is answer the question a records request actually asks,
which is what the notice said on a given date.

Deleting the member who drafted or published a revision does not delete the
revision — the wording published on a date is a department record and outlives
the account.

## Sign-in, permissions and who sees what

Two new permissions this window, both for Legal Documents:

| Permission      | Grants                                                              |
| --------------- | ------------------------------------------------------------------- |
| `legal.propose` | Read the current notices and draft alternatives. **Cannot publish** |
| `legal.publish` | Publish a draft, and revert a document to the platform default      |

`settings.manage` also reaches the screen, for departments that do not want a
separate role.

## Known limitations opened this window

- **The main dashboard widget registry is mostly unread.** Eight widgets are
  declared; one is used. Five of the eight aggregate paths have no backend
  endpoint. Nothing is broken — nothing calls them — but the file reads as
  authoritative. Tracked as **DASH-1**.
- **`compartment_path` is widened by two separate migrations.** Harmless on
  upgrade, asymmetric on downgrade. Tracked as **SCHEMA-1**.

Both are in
[`docs/KNOWN_LIMITATIONS.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md).
