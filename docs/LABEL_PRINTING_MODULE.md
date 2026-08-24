# Label & Station Printing

Barcode labels and station paperwork sent straight to a network printer, in the
printer's own command language, with no print dialog in the path.

Shipped 2026-08-23. Always available — there is no module switch. A department
that registers no printer simply never sees the direct-print controls.

> **Why a print dialog was the problem.** A barcode is only scannable at the
> size it was drawn. Every browser print path offers "Fit to page" / "Shrink to
> fit", and it is on by default in most drivers — so the reliable failure mode
> was a label that looked right on screen, printed 94% of its intended width,
> and would not scan. Sending ZPL or ESC/POS to port 9100 removes every stage
> that could rescale it: the dimensions are fixed in printer dots before the
> job leaves the server.

---

## Contents

1. [What prints](#what-prints)
2. [Printer languages](#printer-languages)
3. [Permissions](#permissions)
4. [Registering a printer](#registering-a-printer)
5. [Status read-back](#status-read-back)
6. [Status flag tables](#status-flag-tables)
7. [Network security model](#network-security-model)
8. [API reference](#api-reference)
9. [Data model](#data-model)
10. [Migrations](#migrations)
11. [Code map](#code-map)
12. [Edge cases](#edge-cases)
13. [Related](#related)

---

## What prints

**Labels** — five modules generate them, each gated on its own permission:

| Module key            | Permissions (any-of)                                     | Label carries                    |
| --------------------- | -------------------------------------------------------- | -------------------------------- |
| `inventory`           | `inventory.view`, `inventory.manage`                     | item name, asset tag             |
| `apparatus`           | `apparatus.view`, `apparatus.manage`                     | unit name, identifier            |
| `facilities`          | `facilities.view`, `facilities.manage`                   | facility name                    |
| `membership`          | `members.view`, `members.manage`                         | member name, membership number   |
| `prospective_members` | `prospective_members.view`, `prospective_members.manage` | applicant name, **status token** |

> **An applicant label's barcode is a bearer token.** `_build_prospect_specs`
> encodes `ProspectiveMember.status_token`, which is what
> `GET /api/public/v1/application-status/{token}` accepts — unauthenticated. So
> anyone who can read the barcode can read that applicant's status page. That is
> the point (it is the applicant's own label), but it means these labels should
> be handled like the token they carry: not left on a noticeboard, not
> photographed into a group chat. `facilities` labels carry a facility record
> only — there is no storage-area label builder, so a storage-area id produces
> no label.

**Station documents** — built from live records on request and printed at the
watch desk. Nothing is stored; these are separate from `/documents`, which is
the file store.

| Document key            | Permissions (any-of)                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `shift_roster`          | `scheduling.view`, `scheduling.manage`                                     |
| `apparatus_check_sheet` | `equipment_check.view`, `equipment_check.submit`, `equipment_check.manage` |

Station documents require an **ESC/POS** printer — a die-cut label has nowhere
to put a column of text. The buttons do not appear at all when a department has
only label printers, rather than appearing and failing.

---

## Printer languages

Chosen per printer at registration; everything downstream is identical.

**ZPL** — Zebra's language. Worth knowing that **many non-Zebra printers speak
it too**: TSC, Godex, Honeywell (PC42/PC43), Citizen and SATO all ship a ZPL
emulation mode. Turn it on in the printer's own settings and register it here as
ZPL; nothing else changes, and the output is the same exact-size label a Zebra
produces. This is the difference between "we need to buy a Zebra" and "the
printer in the closet already works".

**ESC/POS** — what receipt printers speak: Epson TM series, Star, and most
generic 58mm/80mm units. These are cheap, frequently already on station
networks, and with a roll of label stock one makes a perfectly good asset-tag
printer. It is also the only language that prints station documents.

### Geometry that is shared, deliberately

`label_renderer.py` owns the parts that are genuinely format-independent, and
**only those** — be precise about which, because changing a floor that is not
shared will not update every output path:

| Lives in `label_renderer.py`, read by others                            | Local to one renderer                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `code128_width_dots()`                                                  | `escpos_renderer._MIN_MODULE_DOTS` (2) and `_MAX_MODULE_DOTS` (6) — `GS w`'s documented range |
| `qr_modules_for()` and the QR version table                             | `escpos_renderer._MIN_QR_MODULE_DOTS` (3)                                                     |
| `MIN_BAR_WIDTH_INCH` (5 mil) — used by the PDF path and by ZPL Code 128 | `zpl_renderer._MIN_QR_MODULE_INCH` (0.01)                                                     |

**ESC/POS does not read `MIN_BAR_WIDTH_INCH` at all.** Its floors are in dots
because its resolution is fixed by the paper width, not configured per printer,
so an inch-based minimum has nothing to convert against.

What is shared is shared because of a bug caught in review: an
independently-chosen 2-dot module floor in the ZPL renderer rejected a 1×1″
label the PDF path prints happily. The _number of modules a value needs_ is a
property of the symbology and belongs in one place. The _minimum dots per
module a given printer can resolve_ is a property of that printer class, and
reasonably differs.

---

## Permissions

| Action                                   | Permission                                              |
| ---------------------------------------- | ------------------------------------------------------- |
| List printers                            | any authenticated member                                |
| Create / update / delete a printer       | `settings.manage` **or** `organization.update_settings` |
| Test connection, send test label, status | `settings.manage` **or** `organization.update_settings` |
| Print labels                             | the module's own view/manage permission                 |
| Print a station document                 | the document's own permissions (table above)            |

**Listing is deliberately open.** The print page needs the list to offer a
destination, and a printer's name and host are not sensitive. Changing them is
what needs `settings.manage`.

**`organization.update_settings` reaches the API, not the screen.** The
endpoints accept it, but Label Printers lives inside `/settings`, and that
route is wrapped in `<ProtectedRoute requiredPermission="settings.manage">`. A
member holding only `organization.update_settings` can register a printer by
calling the API directly and cannot get to the page that does it.

**Printing is gated on the module, not on printers.** A label reveals nothing
the PDF path does not, so `POST /labels/print` accepts exactly what
`POST /labels/generate` accepts. Holding `settings.manage` does not let anyone
print labels for a module they cannot read.

**A module permission is not always the whole rule.** A record can carry a
section with a narrower one: a shift's pass-down notes are for the incoming
crew, not for everyone who can view the schedule. Builders receive the calling
user and apply those per-record rules themselves, so a printed document can
never surface more than the screen would — see [Edge cases](#edge-cases).

---

## Registering a printer

_Organization Settings → Label Printers_.

| Field                     | Notes                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Name, location            | Free text, for people to recognise                                                                                        |
| Language                  | `zpl` or `escpos`                                                                                                         |
| Host, port                | Port defaults to 9100; see the [allowlist](#network-security-model)                                                       |
| Resolution (dpi)          | ZPL only. 203 on most desktop units, 300 on high-resolution. **Wrong value prints at the wrong physical size**            |
| Label stock / paper width | ZPL: the loaded stock. ESC/POS: `escpos_58mm` or `escpos_80mm` — receipt stock feeds continuously and has no label length |
| Darkness                  | ZPL only, −30…30, blank to leave the printer's own tuning                                                                 |

**Test connection** (`POST /label-printers/probe`) runs before saving: the
printer is asked to identify itself, so a wrong address is caught immediately
rather than at the first print. When it reports its own resolution, the dpi
field is filled from it rather than from a guess.

**Send test label** confirms all three things at once — the server reached the
printer, the stock size is right, and the code scans.

The first printer added becomes the default.

---

## Status read-back

**A successful TCP connection is not good news.** It succeeds against a printer
that is powered on and out of labels, and against whatever else has picked up
that address. So every direct print is followed by a status query, and a job
sent to an empty printer reports the fault instead of a success message and an
empty roll.

Queries are language-specific:

- **ZPL** — one text exchange, `~HI~HQES`. `~HI` returns model, firmware and
  resolution; `~HQES` returns the error and warning bitmasks.
- **ESC/POS** — three single-byte real-time queries, sent sequentially because
  nothing in a reply says which question it answers: `DLE EOT 2` (offline),
  `DLE EOT 3` (error cause), `DLE EOT 4` (paper roll). **The parser reads
  replies positionally, so the order they are sent in is a contract**, asserted
  in `test_label_printer_service.py`.

Three properties the parsers are built to hold, each of which was a real defect
at some point:

- **A printer that answers nothing is reported as such**, never as healthy.
  Port 9100 can be held by anything; decoding an SSH banner into a model name
  turns a wrong-address mistake into a confident wrong answer. ESC/POS replies
  are validated against the spec's fixed bit pattern (bits 1 and 4 set, bits 0
  and 7 clear) before being decoded at all.
- **A fault whose bit is not in the table is reported generically**, never
  dropped. This holds when _other_ bits in the same mask are recognised —
  decoding one bit must not make a partly-understood mask look fully understood
  — and when the condition sits in `~HQES`'s high group, which no table here
  names. The high group is consulted only when the printer's own fault flag is
  set, so a unit that parks something benign there does not report a fault on
  every query.
- **A wrong specific diagnosis is worse than a vague true one.** Only bits the
  published tables name are named. Bit 2 of `DLE EOT 3` is undefined in Epson's
  table and is reported generically rather than guessed at.

Older firmware that does not answer the query reports its identity and says
fault reporting is unavailable — again, rather than claiming health.

**That message is on the Check status screen only.** The API carries
`status_known: false` after a direct print, but neither `LabelPrintPage` nor
`PrintDocumentButton` reads it, so a print to a printer whose firmware cannot
answer shows an ordinary success toast. It is a success — the job was
accepted — but "accepted" is weaker than the confirmation a status-capable
printer gives, and the UI does not currently draw that distinction.

---

## Status flag tables

Sources: ZPL from the `~HQES` error/warning nibble tables in the **ZPL II
Programming Guide**; ESC/POS from the `DLE EOT` n=2/3/4 tables in **Epson's
ESC/POS command reference**. Neither is guessed, and neither should be extended
from a symptom without checking the table it came from.

### ZPL `~HQES` — errors

| Bit    | Reported as                |
| ------ | -------------------------- |
| `0x1`  | Out of labels              |
| `0x2`  | Out of ribbon              |
| `0x4`  | Printhead open             |
| `0x8`  | Cutter fault               |
| `0x10` | Printhead over temperature |

### ZPL `~HQES` — warnings

| Bit   | Reported as               |
| ----- | ------------------------- |
| `0x1` | Media needs calibrating   |
| `0x2` | Printhead needs cleaning  |
| `0x4` | Printhead needs replacing |
| `0x8` | Labels nearly out         |

**Labels nearly out is a warning, not an error, on purpose.** The printer will
finish the label in front of it. Surfacing it lets a quartermaster load a roll
before the next shift instead of during it; treating it as an error would
refuse prints that would have succeeded.

### ESC/POS `DLE EOT 2` — offline status

| Bit    | Reported as              |
| ------ | ------------------------ |
| `0x04` | Cover is open            |
| `0x20` | Out of paper             |
| `0x40` | Printer reports an error |

Bit `0x20` is _printing stops due to paper end_ — the same condition the paper
query reports, not a feed jam, and labelled to match so nobody goes looking for
a jam that is not there. The overlap is deduplicated: one empty roll reads as
one fault.

Bit `0x40` is undifferentiated, so it only speaks when nothing else named the
cause — including nothing from the error-cause byte, since a cutter jam sets
both and reporting it twice describes one jam as two faults.

Bit `0x08` — "paper being fed by the FEED button" — is **deliberately not
decoded**. Somebody is holding a button; that is not a fault.

### ESC/POS `DLE EOT 3` — error cause

| Bit    | Reported as                                           |
| ------ | ----------------------------------------------------- |
| `0x08` | Cutter fault                                          |
| `0x20` | Unrecoverable fault — the printer needs power cycling |
| `0x40` | Recoverable fault — clear it and the printer resumes  |

Without this query a cutter jam — the most common receipt-printer fault after
paper — arrived at the watch desk as "Printer reports an error", which nobody
can act on.

### ESC/POS `DLE EOT 4` — paper roll

| Bits   | Reported as                   |
| ------ | ----------------------------- |
| `0x0C` | Paper is nearly out (warning) |
| `0x60` | Out of paper (error)          |

Both bits of each pair are set together; the spec defines the pair, so both are
required rather than either.

---

## Network security model

The server opens a TCP connection to an address a user typed. That is an SSRF
primitive, and it is treated as one — `app/utils/printer_transport.py` is the
whole boundary.

**Port allowlist.** `ALLOWED_PRINTER_PORTS` = 9100–9109 plus 6101 (Zebra
legacy). Anything else is rejected **before a socket is opened**, so the
allowlist cannot be probed by timing.

**Blocked address classes**, checked on every resolved address rather than only
the first:

- loopback (v4 and v6)
- link-local — this includes `169.254.169.254`, the cloud metadata endpoint
- multicast, reserved, unspecified

**Resolve once, connect to the literal.** The hostname is resolved and the
connection is made to the resulting IP, not re-resolved from the name — a
second lookup could return a different, allowed-then-blocked address (DNS
rebinding).

**Bounded everywhere.** Payloads cap at `MAX_PAYLOAD_BYTES` (1 MiB, roughly
2000 labels); replies at `MAX_STATUS_BYTES` (4 KiB); connect at 5s and status at
3s.

**One deadline per exchange, and a per-read share.** The whole ESC/POS
conversation is bounded by one deadline so a trickling target cannot hold the
request open past it. Within that, each read is capped at an equal share of what
remains — otherwise a printer that implements some real-time queries and ignores
others spends the entire budget on the first silent one, and every later
question comes back empty. That regression is real: it would have disabled
out-of-paper reporting on exactly the generic printers whose real-time support
is patchy.

**Raw bytes are never echoed** into an API response or an error message.

---

## API reference

All routes under `/api/v1`. All require authentication.

### Labels

| Method | Path                     | Permission         |
| ------ | ------------------------ | ------------------ |
| `POST` | `/labels/preview`        | module view/manage |
| `POST` | `/labels/generate`       | module view/manage |
| `POST` | `/labels/print`          | module view/manage |
| `GET`  | `/label-preset/{module}` | module view/manage |
| `PUT`  | `/label-preset/{module}` | module view/manage |

An unknown module key returns **404**, not 403 — there is nothing to be
authorized against.

### Printers

| Method   | Path                                  | Permission                                         |
| -------- | ------------------------------------- | -------------------------------------------------- |
| `GET`    | `/label-printers`                     | any authenticated member                           |
| `POST`   | `/label-printers`                     | `settings.manage` / `organization.update_settings` |
| `PUT`    | `/label-printers/{printer_id}`        | `settings.manage` / `organization.update_settings` |
| `DELETE` | `/label-printers/{printer_id}`        | `settings.manage` / `organization.update_settings` |
| `POST`   | `/label-printers/{printer_id}/test`   | `settings.manage` / `organization.update_settings` |
| `GET`    | `/label-printers/{printer_id}/status` | `settings.manage` / `organization.update_settings` |
| `POST`   | `/label-printers/probe`               | `settings.manage` / `organization.update_settings` |

### Station documents

| Method | Path                         | Permission         |
| ------ | ---------------------------- | ------------------ |
| `POST` | `/station-documents/preview` | the document's own |
| `POST` | `/station-documents/print`   | the document's own |

`preview` returns the **same structure the renderer consumes**, so the on-screen
check and the printed page cannot disagree about layout — there is no second
rendering free to drift from the first.

It is not a snapshot, though. `print_document` rebuilds from live records on
the second request, and no document id or version travels between the two
calls. If the roster changes while the modal is open — someone confirms, a
pass-down note is edited — the printed page reflects the change, and the
approval was of slightly older content. For a watch-desk roster that is
usually what you want; it is worth knowing before assuming otherwise.

**A printer that cannot be reached returns 502**, not 500: the application
worked and a downstream device did not.

---

## Data model

One table, `label_printers`. No seed data, so nothing to register in
`SEED_DATA_FILES`.

| Column                           | Type          | Notes                                                                                  |
| -------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `id`                             | `String(36)`  | UUID primary key                                                                       |
| `organization_id`                | `String(36)`  | FK, `CASCADE`                                                                          |
| `name`                           | `String(100)` |                                                                                        |
| `location`                       | `String(200)` | nullable                                                                               |
| `language`                       | `String(20)`  | `zpl` (default) or `escpos`                                                            |
| `host`                           | `String(255)` |                                                                                        |
| `port`                           | `Integer`     | default 9100                                                                           |
| `dpi`                            | `Integer`     | default 203                                                                            |
| `label_format`                   | `String(50)`  | default `zebra_2x1`                                                                    |
| `custom_width` / `custom_height` | `Float`       | nullable                                                                               |
| `darkness`                       | `Integer`     | nullable                                                                               |
| `is_default` / `is_active`       | `Boolean`     |                                                                                        |
| `created_by_id`                  | `String(36)`  | FK, **`SET NULL` + `nullable=True`** — a printer outlives the member who registered it |

Label presets (size and barcode style) are **not** on this table. They are
scoped per position and per module, so the Quartermaster's inventory preset and
the apparatus team's are independent and follow whoever holds the role.

---

## Migrations

| Revision       | Adds                                                   |
| -------------- | ------------------------------------------------------ |
| `b3e7f1a92c40` | `label_printers`                                       |
| `c7d1f4a83e29` | `label_printers.language`                              |
| `e4b91c7d2a58` | Merge — rejoins the label-printer and event-RSVP heads |

**Why `language` is a separate revision, not a column in the first.** The
column was deliberately withheld until ESC/POS made it a real switch. A stored
setting that nothing reads is worse than no setting: it invites someone to
believe a choice took effect when it did not (CLAUDE.md pitfall #19).

The merge revision exists because two branches added migrations concurrently.
Re-parenting was rejected: the branch was already pushed and possibly applied
somewhere, and re-parenting would have made that database skip a revision
silently.

---

## Code map

**Backend**

| File                                     | Holds                                                           |
| ---------------------------------------- | --------------------------------------------------------------- |
| `app/utils/label_renderer.py`            | PDF rendering **and** the shared symbology geometry             |
| `app/utils/zpl_renderer.py`              | ZPL II generation, `^FH` hex escaping                           |
| `app/utils/escpos_renderer.py`           | ESC/POS binary generation, labels and documents                 |
| `app/utils/printer_transport.py`         | The network boundary — allowlist, address checks, timeouts      |
| `app/utils/printer_status.py`            | `~HQES` and `DLE EOT` parsers, the flag tables                  |
| `app/utils/print_document.py`            | `PrintDocument` / `DocumentSection` / `DocumentRow`             |
| `app/services/label_printer_service.py`  | Printer CRUD, print orchestration, status                       |
| `app/services/label_service.py`          | Module registry, spec builders, per-position presets            |
| `app/services/print_document_service.py` | Station document builders and their per-record permission rules |

**Frontend**

| File                                               | Holds                                                |
| -------------------------------------------------- | ---------------------------------------------------- |
| `src/services/labelService.ts`                     | Label + printer API client                           |
| `src/services/stationDocumentService.ts`           | Station document API client                          |
| `src/components/labels/LabelPrintPage.tsx`         | The shared print page                                |
| `src/components/labels/labelPresets.ts`            | Size presets                                         |
| `src/components/settings/LabelPrintersSection.tsx` | Registration UI                                      |
| `src/components/PrintDocumentButton.tsx`           | Preview-then-print, hidden without a receipt printer |

### ZPL escaping is order-critical

```python
def _escape_zpl(text: str) -> str:
    return text.replace("_", "_5F").replace("^", "_5E").replace("~", "_7E")
```

Underscore **first** — it is the `^FH` escape character, so escaping it after
`^` or `~` would corrupt the sequences those produce. The field must also carry
`^FH`, including on barcode fields: a caret in an asset tag otherwise ends the
field and prints garbage.

---

## Edge cases

| Situation                                                   | Behaviour                                                                                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sheet layout (`letter`) selected with a **ZPL** printer     | **Send to Printer** disabled — an Avery sheet of 30 has no meaning on a roll, so the button says so rather than offering a failure the backend would reject |
| Sheet layout selected with an **ESC/POS** printer           | Not blocked — a receipt printer's stock is the roll loaded in it, so the page's size selection never reaches it                                             |
| Page label size differs from the printer's registered stock | Panel says so and offers **Match printer**; the printer cannot tell its labels are the wrong size                                                           |
| Die-cut size sent to a receipt printer                      | Ignored, not rejected — the loaded roll wins, and the panel says so                                                                                         |
| Long value on a small label                                 | Rejected with the reason, rather than printing an unscannable code. 58mm holds ~12 Code 128 characters, 80mm ~21 — use QR                                   |
| Printer out of stock                                        | Print reports the fault; the post-print status check is what catches it                                                                                     |
| Printer answers the connection but not the status query     | Reported as unidentified; older firmware says fault reporting is unavailable                                                                                |
| Shift pass-down notes                                       | Printed only for `scheduling.manage`, the shift officer, or an assigned/confirmed crew member — not everyone with `scheduling.view`                         |
| Roster crew list                                            | Declined and cancelled members are **not** printed; assigned-but-unconfirmed is printed and marked `(unconfirmed)`                                          |
| Check sheet items                                           | Read through `EquipmentCheckService.get_template` so `visible_positions` narrowing applies exactly as on screen                                             |
| Times on any document                                       | The department's configured timezone, never UTC                                                                                                             |

---

## Related

- [Training 05 — Gear & supplies](./training/05-inventory.md#connecting-a-sticker--label-printer)
- [Training 03 — Scheduling](./training/03-scheduling.md#printing-station-documents)
- [Training 08 — Admin & reports](./training/08-admin-reports.md)
- [Scheduling module](./SCHEDULING_MODULE.md)
- [Alembic migrations](./ALEMBIC_MIGRATIONS.md)
