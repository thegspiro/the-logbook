# Label & Station Printing

> The full reference is [docs/LABEL_PRINTING_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/LABEL_PRINTING_MODULE.md).

Barcode labels and watch-desk paperwork sent **straight to a network printer**,
in the printer's own command language, with no browser print dialog in the way.

**Why skip the print dialog?** A barcode only scans at the size it was drawn.
Most drivers default to "Fit to page" or "Shrink to fit", so a label that looked
right on screen came out at 94% of its width and would not scan. Sending the job
straight to the printer fixes the size in printer dots before it leaves the
server.

There is **no module switch**. A department that registers no printer never
sees the direct-print controls and keeps printing labels as PDFs or through
the browser.

---

## Before you start: the operator must approve the network

The server, not the officer's browser, opens the connection to the printer. So
the networks it may reach are an **operator** decision, set in the server's
environment:

```bash
LABEL_PRINTER_ALLOWED_NETWORKS=192.168.10.0/24
```

It takes a comma-separated list of IP addresses or CIDR ranges and is **empty
by default, which turns direct printing off**. A printer outside the list is
refused with _"… does not resolve to an operator-approved label-printer
network."_ The shipped `docker-compose.yml` passes the variable through; a
compose file of your own must add it to the backend's `environment:` block.
Upgrade notes:
[UPGRADING.md](https://github.com/thegspiro/the-logbook/blob/main/docs/UPGRADING.md#direct-label-printing-needs-an-approved-network-2026-09-14).

Whatever the list says, the server also refuses:

- loopback, link-local (including the cloud metadata address
  `169.254.169.254`), multicast, reserved and unspecified addresses;
- any port other than **9100–9109** or **6101**.

## What prints

### Labels

| Labels for               | Print page                              | Permission (any of)                                      |
| ------------------------ | --------------------------------------- | -------------------------------------------------------- |
| Inventory items          | `/inventory/print-labels`               | `inventory.manage`                                       |
| Storage areas (shelves…) | `/inventory/storage-areas/print-labels` | `inventory.manage`                                       |
| Apparatus                | `/apparatus/print-labels`               | `apparatus.view`, `apparatus.manage`                     |
| Facilities               | `/facilities/print-labels`              | `facilities.view`, `facilities.manage`                   |
| Members                  | `/members/print-labels`                 | `members.manage`, `members.manage_id_cards`              |
| Prospective members      | `/prospective-members/print-labels`     | `prospective_members.view`, `prospective_members.manage` |

Each page is reached from its own module — for example **Print Labels** on the
inventory list or an item, or the selection bar on the applicant pipeline.

- **A member label is a badge.** Its barcode or QR encodes the member's
  server-issued badge code (such as `MB-7KQ2W9HXRT`), the same value as their
  plastic ID card, and the membership number prints as text. That is why it
  needs the ID-card permissions rather than `members.view`. CR80 plastic cards
  are a separate print path — see [Member ID Cards](Member-ID-Cards).
- **An applicant label carries a short record id**, not the applicant's
  status-check link. Labels printed before 2026-09-28 still carry that link and
  remain a credential for it: destroy them rather than leave them posted.
- **Inventory labels are tracked.** After a print the quartermaster confirms it
  came out, and the item records who printed it and when; changing the printed
  value marks it as needing a new label. See
  [Inventory](Module-Inventory#scanning-labels-and-nfc).

### Station documents

Built from live records when requested and printed at the watch desk. Nothing
is stored (these are not the `/documents` file store).

| Document              | Where the button is                                                    | Permission (any of)                                                        |
| --------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Shift roster          | **Print roster** on a shift's detail panel in Scheduling               | `scheduling.view`, `scheduling.manage`                                     |
| Apparatus check sheet | The print icon on a checklist template (`/inventory/admin/checklists`) | `inventory.check_view`, `inventory.check_submit`, `inventory.check_manage` |

Station documents need a **receipt (ESC/POS) printer** — a die-cut label has no
room for a column of text. The buttons do not appear at all when the department
has only label printers.

## Permissions

| Action                                           | Permission                                          |
| ------------------------------------------------ | --------------------------------------------------- |
| See the list of registered printers              | Any signed-in member                                |
| Register, edit or remove a printer               | `settings.manage` or `organization.update_settings` |
| Test connection, send a test label, check status | `settings.manage` or `organization.update_settings` |
| Print labels                                     | That module's own permission (table above)          |
| Print a station document                         | That document's own permission (table above)        |

- **The settings screen needs `settings.manage`.** The API also accepts
  `organization.update_settings`, but the Label Printers panel lives on
  `/settings`, which is gated on `settings.manage` alone.
- **Printing is gated on the module, not on printers.** Holding
  `settings.manage` does not let anyone print labels for a module they cannot
  read.
- **A printed document never shows more than the screen would.** A shift's
  pass-down notes print only for `scheduling.manage`, the shift officer, or an
  assigned or confirmed crew member.

---

## Printer languages

Chosen per printer when you register it.

| Language | Printers                                                                                                                                                 | Prints                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `zpl`    | Zebra, plus the many printers with a ZPL emulation mode — TSC, Godex, Honeywell (PC42/PC43), Citizen, SATO. Turn the emulation on and register it as ZPL | Labels                       |
| `escpos` | Receipt printers — Epson TM, Star, generic 58mm/80mm units, which make good asset-tag printers with linerless label roll                                 | Labels and station documents |

## Registering a printer

**Organization Settings → Organization → Label Printers** (`/settings`).

1. **Name** and optional **Location** — for people to recognise it.
2. **Language** — ZPL or ESC/POS.
3. **Host** and **Port** (9100 is standard).
4. **Resolution (dpi)** — ZPL only: 203 on most desktop units, 300 on
   high-resolution ones (600 is also accepted). **A wrong value prints at the
   wrong physical size.**
5. **Label stock loaded** (ZPL) or **Paper width** (ESC/POS: 58mm or 80mm —
   receipt stock feeds continuously and has no label length).
6. **Darkness adjustment** — ZPL only, −30 to 30; leave blank to keep the
   printer's own tuning.
7. **Test connection** before saving. The printer is asked to identify itself,
   so a wrong address shows up now rather than at the first print; if it
   reports its resolution, the dpi field is filled from it.
8. Save, then **Send test label** — it proves the server reached the printer,
   the stock size is right and the code scans.

The first printer added becomes the default. A port outside the allowlist is
refused when you save; an address outside the approved networks is refused
when the server tries to connect.

## Printing labels

1. Open the module's print page with the records selected.
2. Choose the label size and the code (Code 128 barcode or QR).
3. Choose the printer and press **Print to _printer name_** (**Print to network
   printer** until one is chosen). **Print in browser** is still there for
   sheet labels.

Things the page handles for you:

- **Avery sheet with a ZPL printer** — direct printing is disabled; a sheet of
  30 has no meaning on a roll.
- **Partly used Avery sheet** — **Start at label** (1–30) leaves the earlier
  positions blank.
- **Page size differs from the printer's registered stock** — the panel says
  so and offers **Match printer**. The printer cannot tell it has the wrong
  labels loaded.
- **A die-cut size sent to a receipt printer** — ignored; the loaded roll wins.
- **A value too long for a small label** is refused with the reason rather than
  printed unscannable. A 58mm roll holds about 12 Code 128 characters and 80mm
  about 21 — use QR for longer values.

## Printing a station document

Press the print button on the shift or checklist, check the preview, choose the
receipt printer and **Print**. The page is rebuilt from live records when you
print, so a change made while the preview was open (a crew confirmation, an
edited pass-down note) is on the paper. Declined and cancelled crew are left
off the roster; assigned but unconfirmed crew print marked `(unconfirmed)`.
Times print in the department's timezone.

## Printer status and faults

A successful connection does not mean a label came out — it also succeeds
against a printer that is on and out of labels. So **every direct print is
followed by a status query**, and a fault is reported instead of a success
message. **Check status** on the printer's row in Label Printers asks on demand.

| Language | Reported faults                                                                                                           | Warnings                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| ZPL      | Out of labels, out of ribbon, printhead open, cutter fault, printhead over temperature                                    | Media needs calibrating, printhead needs cleaning or replacing, labels nearly out |
| ESC/POS  | Cover open, out of paper, cutter fault, unrecoverable fault (power-cycle it), recoverable fault, printer reports an error | Paper nearly out                                                                  |

- **Labels nearly out is a warning**, so the print still goes through — load a
  roll before the next shift rather than during it.
- **A printer that answers nothing** is reported as such, never as healthy.
  Older firmware that cannot answer the query says fault reporting is
  unavailable on **Check status**; after a print, the page shows an ordinary
  success message, which means only that the job was accepted.

## Gotchas

| Symptom                                                 | Cause                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| "does not resolve to an operator-approved … network"    | `LABEL_PRINTER_ALLOWED_NETWORKS` is empty or does not include the printer — an operator change, not a setting |
| You can ping the printer but the server cannot reach it | The server opens the connection; reachability is the backend container's, not your laptop's                   |
| Labels print the wrong physical size                    | Wrong dpi registered, or the page's label size does not match the loaded stock                                |
| No print button for rosters or check sheets             | No ESC/POS printer is registered                                                                              |
| A member cannot print a colleague's member label        | Member labels need `members.manage` or `members.manage_id_cards`                                              |
| A printer that cannot be reached                        | The request fails with **502**, not 500 — the application worked and the device did not                       |

More: [Troubleshooting](Troubleshooting#barcode-label-printing-issues).

---

## For developers

- **API** (all under `/api/v1`, all authenticated):
  - Labels: `POST /labels/preview`, `/labels/generate`, `/labels/print`;
    `GET`/`PUT /label-preset/{module}` (per-position, per-module presets). An
    unknown module key returns 404.
  - Printers: `GET`/`POST /label-printers`, `PUT`/`DELETE /label-printers/{id}`,
    `POST /label-printers/{id}/test`, `GET /label-printers/{id}/status`,
    `POST /label-printers/probe`.
  - Station documents: `POST /station-documents/preview`, `/station-documents/print`.
- **Model:** `LabelPrinter` (table `label_printers`; `created_by_id` is
  `SET NULL` + nullable).
- **Services:** `label_printer_service.py` (printers, print orchestration,
  status), `label_service.py` (`MODULE_LABELS` — the module registry and its
  permissions), `print_document_service.py` (`MODULE_DOCUMENTS` and the
  per-record rules).
- **Utilities:** `printer_transport.py` (the network boundary — allowlist,
  address checks, 5s connect / 3s status timeouts, 1 MiB payload cap),
  `zpl_renderer.py`, `escpos_renderer.py`, `printer_status.py`,
  `label_renderer.py` (PDF and shared barcode geometry).
- **Frontend:** `components/labels/LabelPrintPage.tsx`,
  `components/settings/LabelPrintersSection.tsx`,
  `components/PrintDocumentButton.tsx`.

## Related

- [Inventory](Module-Inventory) — item labels, storage areas and label tracking
- [Member ID Cards](Member-ID-Cards) — badge codes and CR80 card printing
- [Inventory NFC Tags](Inventory-NFC-Tags)
- [Scheduling](Module-Scheduling)
- [Apparatus](Module-Apparatus)
- [Configuration — Environment](Configuration-Environment)
- [Troubleshooting](Troubleshooting#barcode-label-printing-issues)
