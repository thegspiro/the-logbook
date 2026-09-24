# Inventory NFC tags

_Added 2026-09-24._ Stick an NFC tag on a helmet, a radio, an SCBA case or a
shelf, link it to its item or storage area, and a phone tap finds it. Tags work
for these things:

- **Finding an item.** In the distribute and return scanner, or from a phone's
  home screen.
- **Putting things away.** Tap a shelf, then the items on it, to record where
  they are.
- **A "last seen" trail.** Every tap by a quartermaster is logged on the item.
- **Shelf audits.** Tap everything on a shelf to see what is missing and what
  does not belong there.
- **Identifying a member** by tapping their NFC ID card, where the department
  issues them.

A **not-seen report** sits alongside: the items nobody has handled in months.
It uses assignments and checkouts as well as taps, so it also works without
tags.

> **Off until you turn it on.** The feature is gated by an organization
> setting, `inventory.nfc_tracking_enabled`, and the check is on the
> **server**. While it is off, every NFC tag endpoint answers 403 and the NFC
> controls are hidden. An installation that has never set it reads as off.

This is separate from [Member ID Cards](Member-ID-Cards), which identify
**people** at a check-in station and are switched on under Settings →
Integrations. The two share a hashing scheme and nothing else.

## Before you start

### What each device can do

Web NFC, the browser feature the app uses to read and write tags, exists only
in **Chrome on Android, over HTTPS**. That is a browser limit, not an app
setting. Plan around it:

| Device                          | Link tags         | Tap in the app (scanner, put-away) | Open an item by tapping a written tag |
| ------------------------------- | ----------------- | ---------------------------------- | ------------------------------------- |
| Android phone, Chrome, HTTPS    | Yes               | Yes                                | Yes                                   |
| iPhone (any browser)            | No                | No                                 | **Yes**: iOS opens the link natively  |
| Desktop with a USB NFC reader   | Yes, typed serial | Put-away only (typed serial)       | —                                     |
| Any device over plain `http://` | No                | No                                 | Opens, but the page is `http://`      |

At least one **Android phone with Chrome** is needed to write tags. The site
must be served over **HTTPS** with a valid certificate. A LAN address over
`http://`, common on Unraid, does not qualify, and the app says so on the
settings page.

### Which tags to buy

- **For item and shelf tags: blank, writable NTAG213, NTAG215 or NTAG216.** An
  NTAG213 (144 bytes) is enough; the link the app writes is under 100 bytes.
  These are the common round stickers, key fobs and hard tags.
- **For metal surfaces** (SCBA bottles, toolboxes, steel shelving), buy
  **on-metal / anti-metal** tags. An ordinary sticker on metal will not read.
- **For turnout gear and anything that gets washed**, use laundry-rated tags
  and put them where they will not be crushed.
- **Tags that cannot be written** (locked, pre-encoded or read-only cards) can
  still be linked by their **chip serial**. Only an Android phone inside the
  app can then read them; see
  [Written link or serial?](#written-link-or-serial) below.

### Who does what

| Task                                   | Permission                                            |
| -------------------------------------- | ----------------------------------------------------- |
| Turn the feature on or off             | `settings.manage` or `organization.update_settings`   |
| Link, relabel, mark lost/found, unlink | `inventory.manage`                                    |
| Put items away by tap                  | `inventory.manage`                                    |
| See an item's tap log (Last Seen)      | `inventory.manage`                                    |
| Shelf audits, schedules, bulk tagging  | `inventory.manage`                                    |
| Identify a member by ID card tap       | `inventory.manage`, plus the NFC ID Cards integration |
| Items Not Seen report                  | `inventory.manage` (works with NFC off)               |
| Tap a tag to open an item              | `inventory.view` (held by the seeded member roles)    |

## Step 1: turn it on

**Inventory → Administration → NFC Tags** (`/inventory/admin/nfc`). Tick
**Use NFC tags for inventory items**. The setting saves immediately.

Turning it off later hides the controls and stops tags resolving, but **keeps
every link**; turning it back on restores them. Nothing is deleted.

## Step 2: link tags to items

Open the item, then find the **NFC Tags** card on the item page. It is shown
to `inventory.manage` holders only while the setting is on.

1. Optionally type **where the tag is** ("Inside left cuff", "Case lid"). Two
   tags on one item are told apart by this label and by the last four
   characters of the tag.
2. Then choose one:
   - **Write a link to a blank tag** (recommended). Tap the button, then hold
     the tag against the back of the phone until it confirms. The tag now
     holds a link; the app links it to the item only after the write
     succeeds.
   - **Read a tag's serial.** For a tag that cannot be written. Tap the
     button, then hold the tag to the phone.
   - **Type the serial, or use a USB reader.** Put the cursor in the serial
     box and tap the tag on the reader, then press **Link serial**.

An item can carry **several tags**, for example one on the item and one on its
case. A tag can be linked to **one** item or shelf. Linking it somewhere else
is refused, and the message names where it is linked now. **Unlink** it there
first.

Pool (quantity-tracked) items take tags the same way. Put the tag on the bin
or the shelf edge, not on each unit.

### Written link or serial?

|                                     | Written link                              | Chip serial                        |
| ----------------------------------- | ----------------------------------------- | ---------------------------------- |
| Tag needed                          | Blank, writable NTAG21x                   | Any NFC tag, including locked ones |
| Opens on any phone from home screen | **Yes**, iPhones included                 | No                                 |
| Works in the app's scanner          | Yes (Android)                             | Yes (Android)                      |
| Can be reused on another item       | Yes: unlink, then write again             | Yes: unlink, then link again       |
| Stops working when unlinked         | Yes: the link names the tag, not the item | Yes                                |

The written link looks like `https://your-site/inventory/tag/INVT…`. It names
the **tag**, not the item, so unlinking a tag in the app stops its link
working even though nothing on the tag changes.

## Step 3: tag your shelves (optional)

**Inventory → Storage Areas**, open a shelf, bin or cabinet with its edit
button. The **NFC Tags** card in the dialog works exactly like the item's. A
shelf must exist before it can be tagged.

Tapping a shelf's written tag with a phone:

- **as an inventory manager** opens **Put Away by NFC** with that shelf already
  chosen;
- **as anyone else** shows which storage area the tag marks.

### Tagging many items at once

**Inventory → Administration → Tag Items in Bulk**
(`/inventory/admin/nfc/enroll`) lists the active items with no working tag. An
item whose only tag is marked lost counts as untagged. Narrow the list with
**Which items**, then:

- **Write links**: tap **Write a tag for** the item shown, and hold a blank
  tag to the phone. The item is linked once the write succeeds, and the page
  moves on. One press per item, so a write only lands on the tag you meant.
- **Read serials**: tap **Start reading tags**, then tap each item's tag in
  turn. The reader stays on and each tag links to the item shown, then moves
  on. A tag read twice while held still is ignored.
- A typed or USB-read serial works in either mode. **Skip this item** passes
  one over.

## Using the tags

### In the distribute and return scanner

Open **Distribute** or **Return** for a member as usual. Next to **Start
Camera**, tap **Tap NFC**, then tap each tag. Every tap adds the item to the
list, and the reader stays on until you tap **Stop NFC** or close the dialog.

A tap finds the item by **exact match only**. The scanner never falls back to
the partial search the barcode box uses, so a short serial cannot land on the
wrong item. A tag on a shelf is refused here with "This tag marks a storage
area, not an item."

### Put Away by NFC

**Inventory → Administration → Put Away by NFC**, or the **Put Away by NFC**
button on Storage Areas (`/inventory/put-away`). Tap **Start tapping tags**,
then work in either order:

- **Shelf first.** Tap the shelf's tag; the page says "Items tapped now go on
  _Shelf B_". Every item you tap afterwards is moved onto it, until you tap
  another shelf or **Close shelf**. Use this to stock a whole bin.
- **Item first.** Tap one item; the page asks you to tap its shelf. Tapping a
  shelf moves that one item and does **not** keep the shelf open, so the next
  item waits for its own shelf.

Without an Android phone, pick the shelf from **Or pick a shelf** and type or
USB-read the item's serial into the box.

A move uses the **same rule as the barcode Put away panel** on Storage Areas:

- The item takes the room of the shelf, or of the nearest area above it that
  has a room.
- An item that is **assigned to a member, checked out, lost, stolen or
  retired** is refused with the reason. Return it, check it in, or update its
  status first.

### Shelf audits

**Inventory → Administration → Shelf Audit** (`/inventory/shelf-audit`). Tap
**Start tapping tags**, tap the shelf (or pick it), tap every item on it, then
**Finish audit**. The audit is saved, and shows:

| List           | Means                                             | What happens                                                                      |
| -------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Missing**    | Recorded on this shelf, not tapped                | Listed only. **Never marked lost**: look for it, then update it yourself          |
| **Unexpected** | Tapped here, recorded somewhere else (or nowhere) | Tick and **Move selected**: uses the put-away rule, so assigned items are refused |
| **Found**      | Recorded here, tapped                             | Nothing                                                                           |

- The audit covers **exactly** the storage area tapped, not the bins inside
  it. Audit each bin on its own.
- Items that are assigned, checked out, lost, stolen or retired are not
  expected on a shelf, so they are never reported missing. Tapping one on a
  shelf shows it as unexpected, which is usually worth a look.
- Tapping a different shelf mid-audit is refused. Finish or cancel first.
- Every tapped item is logged in its **Last Seen** trail as found on that
  shelf. **Recent audits** keeps the last ten; **View** reopens one.

### Scheduling shelf audits

Give a storage area an audit schedule and the app tracks when it is due.

1. **Inventory → Storage Areas**, open the area with its edit button.
2. Under **Shelf audit schedule**, pick **Weekly**, **Monthly**, **Quarterly**
   or **Yearly**. It saves immediately. **Not scheduled** takes it off.

Due dates count from the area's **latest saved audit**, in calendar periods: a
monthly shelf audited on 31 January is next due on 28 February. An area that
has never been audited is due now.

**Shelf Audit** lists every scheduled area under **Audit schedule**, due ones
first. **Audit now** chooses that shelf and starts an audit.

**Weekly reminder email.** Once a week, while any scheduled shelf is overdue,
everyone with `inventory.manage` gets one email listing them. Nothing is sent
in a week when nothing is overdue, or while NFC is turned off. The check runs
daily but counts the week from the last email actually sent, so restarting the
server does not send it twice.

### Identifying a member by ID card

Where the department issues [Member ID Cards](Member-ID-Cards) (**Settings →
Integrations → NFC ID Cards** connected), the **Scan Member ID** window on the
inventory screens also shows **Or tap their ID card** to `inventory.manage`
holders on an Android phone. Hold the member's card to the phone. A card
marked lost, an unregistered card, or an inactive member is refused with the
reason. Card taps are not written to the equipment tap log.

### Items not seen

**Inventory → Administration → Items Not Seen** (`/inventory/admin/not-seen`)
lists active items nobody has handled in 30, 90, 180 (the default) or 365
days, never-handled first. "Handled" is the latest of:

- a tap by a quartermaster (lookup, put-away or shelf audit);
- an assignment to a member, or its return;
- a checkout or check-in;
- a pool issuance, or its return.

Editing an item's record does **not** count, and neither does a barcode
put-away, which leaves no per-item record to read. Retired items are left out.
**Download CSV** exports up to 5,000 rows. The report works with NFC turned
off.

### Last Seen

The item page shows **Last Seen (NFC)** below the NFC Tags card: the ten most
recent taps, with who tapped and where the item was put.

**Only taps by `inventory.manage` holders are logged.** That covers scanner
lookups, a quartermaster opening a written tag, and every put-away. A member
opening a written tag from their own phone finds the item but leaves **no
record**: the log tracks equipment, not where members were.

## Looking after tags

- **Mark lost** a tag that has gone missing. While lost it finds nothing,
  because whoever has it may have stuck it on something else. **Mark found**
  puts it back in service.
- **Unlink** a tag to free it for another item. The tap log keeps its rows.
- **A tag on a retired item finds nothing**, the same as the barcode lookup.
- **Anyone with an NFC app can rewrite an unlocked tag.** Inside the app this
  is harmless: a tag pointing anywhere but your own site is ignored. From a
  phone's home screen, though, a rewritten tag could open a different website.
  Tell members to check the address before signing in. For tags in public
  view, lock them with a third-party NFC app after writing (permanent: a
  locked tag cannot be rewritten or reused), or link them by serial instead.

## Troubleshooting

| Symptom                                                   | Cause and fix                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No **Tap NFC** or write buttons anywhere                  | The setting is off, the viewer lacks `inventory.manage`, or the browser has no Web NFC. Use Chrome on Android over HTTPS                                                                                                                                     |
| "NFC requires a secure (HTTPS) connection"                | The site is being opened over `http://`. Serve it over HTTPS                                                                                                                                                                                                 |
| "NFC is switched off"                                     | Turn on NFC in the phone's settings                                                                                                                                                                                                                          |
| "NFC permission was denied"                               | Allow NFC for the site in Chrome's site settings                                                                                                                                                                                                             |
| The write never completes                                 | Hold the tag flat against the phone's NFC antenna (usually the upper back) and keep still. Metal behind an ordinary tag blocks it; use an on-metal tag                                                                                                       |
| "This tag is not linked to anything"                      | The tag was never linked, was unlinked, or was linked in another organization                                                                                                                                                                                |
| "This tag is marked lost"                                 | **Mark found** on the item or shelf it belongs to                                                                                                                                                                                                            |
| A tag linked on a phone does not match at the desk reader | Many USB readers type the serial as a **decimal** number, or with the bytes **reversed**. The app matches the hexadecimal serial a phone reads. Set the reader to hexadecimal, forward byte order, or link tags with the same reader you will read them with |
| An iPhone tap opens the login page                        | Expected: the member must be signed in. After signing in, the tag's page finds the item                                                                                                                                                                      |
| Put-away refuses an item                                  | It is assigned, checked out, lost, stolen or retired. The message says which; fix the record first                                                                                                                                                           |
| A shelf audit lists an item as missing that is there      | Its tag was not read. Tap it again before **Finish audit**; an item on a shelf with no tag is always missing                                                                                                                                                 |
| **Or tap their ID card** does not appear                  | The NFC ID Cards integration is not connected, inventory NFC is off, or the phone has no Web NFC                                                                                                                                                             |

## Reference

- Endpoints and data model: [Inventory → NFC Tags](Module-Inventory#nfc-tags-2026-09-24).
- Tables: `inventory_nfc_tags`, `inventory_nfc_scans`, `inventory_nfc_audits`,
  `inventory_nfc_audit_items`, `inventory_nfc_audit_digests`, and
  `storage_areas.audit_frequency`. See
  [Database Schema](Database-Schema).
- Tag identifiers are stored as a **peppered SHA-256 hash** plus the last four
  characters, the same scheme as member ID cards. The phone that links
  equipment tags also reads ID cards, and a card tapped here by mistake must not
  leave its serial on record.
