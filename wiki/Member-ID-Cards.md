# Member ID cards and the check-in station

_Added 2026-08-23._ Officers issue physical NFC ID cards to members, and leave
a check-in station running at the door. Members tap and walk in.

> **Off until you turn it on.** The whole feature is gated by the
> **NFC ID Cards** integration, under Settings → Integrations. It starts off,
> and the check is on the **server**, not just in the interface — hiding a
> screen would leave a credential surface reachable. The guard fails closed: a
> department whose integration catalog has never been opened counts as not
> having turned it on.

## Issuing a card

Member profile → **ID Cards**. An officer holding `members.manage_id_cards`
binds a physical card to a member, labels it, and can later suspend it, report
it lost, or revoke it. By default that is department leadership (President,
Vice President, Chief, Deputy Chief, Assistant Chief), the Membership
Coordinator and Assistant Membership Coordinator, the Secretary and Assistant
Secretary, and Captains; a department changes it on the Positions screen.

**Issue card** binds a card one of two ways:

| Option                           | Use it when                            | What becomes the credential                       |
| -------------------------------- | -------------------------------------- | ------------------------------------------------- |
| **Write a code to a blank card** | The tag is writable — a sticker, a fob | A freshly generated 128-bit code, written onto it |
| **Read a printed card's serial** | The card is already made and locked    | The chip's own serial number                      |

Prefer writing a code: it is unguessable, it is not printed anywhere on the
card, and the tag can be rewritten and reissued to somebody else. A written
card shows **Written** beside its status. Writing needs Chrome on Android over
HTTPS; at a desk, a USB reader or a typed serial fills the field instead. An
officer always does the binding — there is no path by which a member binds
their own card.

> **Corrected 2026-10-04.** This page said cards ship blank, so the serial is
> always the credential. Both options have existed since ID cards shipped on
> 2026-08-23; the serial is the fallback for a card that cannot be written.

### What the department stores, and what it cannot read back

| Stored                                                                                                       | Not stored                               |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| A **peppered SHA-256 hash** of the serial                                                                    | The serial itself, anywhere, in any form |
| `uid_preview` — the **last four characters**, so an officer can tell two of a member's cards apart on screen | —                                        |

There is no screen and no endpoint that reads a card number back out, and none
should be added. The serial or written code is the whole of the credential: a
plaintext column would make a database backup a stack of working ID cards.

**Revoking is permanent for that registration.** A revoked or lost
registration is never switched back on. Suspension is the reversible state, for
a card a member has mislaid and may still find.

**The same physical card can be registered again** _(2026-09-30)_. A card that
turns up after being reported lost, or a revoked card handed to someone else,
is issued afresh: the old registration stays terminal on the previous holder's
record, gives up its slot in the `(organization_id, uid_hash)` unique index by
being rehashed to a tombstone no card read can produce, and a new active
registration is inserted. Until then such a card was refused for good. A card
whose registration is still **active or suspended** is refused with "This card
is already registered to another member and is still in use. Mark that
registration lost or revoked, then register the card again."

## Viewing a member's ID card _(2026-09-30)_

The **ID Card** page (`/members/:userId/id-card`) renders the printable badge —
photo, name, QR code and barcode. Every member can open **their own**. Opening
**someone else's** needs `members.manage` or `members.manage_id_cards`; the
profile's **ID Card** button is hidden otherwise, and the page answers "You can
only view your own ID card." without fetching the colleague.

It used to be open to every `members.view` holder — every member — so anyone
could pull up a colleague's scannable badge on a phone. The gate is in the app
rather than the API, deliberately: the profile fields the card is assembled
from are directory information `GET /users/{id}/with-roles` serves to
`members.view`, and what is withheld is the assembled badge. Checking members in
is unaffected — `/members/scan` and the check-in station resolve a code without
rendering anyone's card.

**Printing badges follows the same rule** _(2026-10-04)_. Member labels
(`/members/print-labels` and the label API's `membership` module) require
`members.manage` or `members.manage_id_cards`. They accepted `members.view`,
so any member could print a colleague's badge even after the card page
refused to show it.

**Badges for unnumbered members scan** _(2026-09-28)_. A badge printed for a
member with no membership number carries a short id, and neither **Scan Member
ID** nor the in-app badge scanner recognised it — the department's own badge
read "No member found". Both resolve it now. The check-in station and room
kiosks identify by NFC card, not by the printed QR code.

## Badge codes and printing CR80 ID cards _(2026-10-05)_

**Badges carry a server-issued code.** A member's printed badge, label and
digital card used to encode the membership number, or a short form of their
member id. Every member can read both in the directory, so anyone could make a
badge that scans as a colleague. Each member now has a random **badge code**
(`users.badge_code`, for example `MB-7KQ2W9HXRT`), unique per organization,
issued by the upgrade for every existing member and by default for new ones.

- It is shown only to the member (on their own ID card page) and to officers
  holding `members.manage` or `members.manage_id_cards`
  (`GET /member-badges/{id}`; anyone else gets 404). It is never in the roster,
  profile responses, export files or anonymized records.
- **Reissue badge** on a member's ID card page cancels a lost badge: every card
  printed so far, and the phone card until it reloads, stops scanning. Print a
  new card afterwards. Audited as `member_badge_reissued`.
- Both scanners (**Scan Member ID** and inventory's issue-by-badge) send what
  they read to `POST /member-badges/resolve`, which answers only within the
  caller's organization and is rate limited (120 lookups a minute per address).
  A QR's member id is no longer taken on trust.
- **Accept old badges** (switch on the Print ID Cards page, officers only) keeps
  the membership-number, short-id and old-QR badges scanning. It is **on** until
  an officer turns it off, so nothing stops working on upgrade; turning it off
  asks for confirmation and stops every pre-badge-code card at every station.
  Turn it off once every member has a reprinted card. Audited as
  `member_badge_settings_updated`.

**Print ID Cards.** On the Members list, select members and choose **Print ID
Cards** (`/members/print-id-cards`, `members.manage` or
`members.manage_id_cards`). The server renders a PDF whose every page is one
CR80 card side (3.375 x 2.125 in); any plastic card printer (Zebra, HID Fargo,
Evolis, Magicard, Entrust Datacard) prints it through its ordinary OS driver at
the CR80 / ID-1 size, at 100% (not "Fit to page"). Choose **Landscape** or
**Portrait**, **Front only** or **Front and back** (alternating pages, for a
duplex printer or flipping by hand), and **Barcode** (Code 128) or **QR code**.
**Save as department layout** keeps the choice for the next job, **Test card**
prints one card, and up to 500 cards go in one job. Cards are black-only, so
they print the same on monochrome and colour ribbons. Printing is audited as
`id_cards_printed`. This is the printed-card path; the NFC card flow above is
separate.

## The check-in station

`/members/check-in-station`, requires **`members.check_in`**.

A phone, tablet or desktop left at the door of a station, a drill night or a
meeting. An officer picks what is being checked into, arms the reader, and from
then on **nobody touches the screen between taps**.

### Two readers, because departments have both

| Reader         | How it works                                                                            |
| -------------- | --------------------------------------------------------------------------------------- |
| **Web NFC**    | Chrome on Android, over HTTPS. The tablet reads the card itself, using the tag's serial |
| **USB reader** | The desk kind that types the serial like a keyboard and presses Enter                   |

Keystrokes from a USB reader are captured **page-wide** rather than into a
focused box. A kiosk loses focus to the first stray tap on the screen, and a
station that silently stops reading is worse than one that was never armed.

### What a tap can be checked into

An event or meeting, an admin-hours category, or a shift check-in. The station
keeps offering a shift until an officer **finalizes** it — not merely because
its end time has passed, since checking out has no deadline and a crew coming
off a tour still needs to tap out. Its target lists are
cut at the same boundaries the server enforces — the station never offers a
target the check-in endpoint would refuse.

### Who may tap in

| Status                                | Tap accepted? | Why                                                                        |
| ------------------------------------- | ------------- | -------------------------------------------------------------------------- |
| Active, probationary                  | Yes           | — (probationary members can also sign in to the app since 2026-10-03)      |
| **Retired, on leave**                 | **Yes**       | They attend meetings and banquets, which is exactly what a station records |
| Suspended, dropped, archived, deleted | No            | —                                                                          |

### Outcomes are shown, not thrown

An unregistered card, a member already checked in, or a closed check-in window
come back as an ordinary success carrying a status, not as an error. A station
left running at a door has to say what happened and stay armed for the next
person — an error page in front of a queue of members is a worse failure than
the tap it was reporting.

## Tapping in at a room kiosk _(2026-10-03)_

A room's kiosk tablet (`/display/<code>`) can read cards too, with nobody
signed in. It is **off for every room** until an officer holding
`locations.manage_nfc_tags` turns on **Badge check-in** for that room on
Check-In QR Codes, and it needs the NFC ID Cards integration on.

- The room decides the event: whichever one is open for check-in there. If two
  are open at once the tap is refused — unless the member is checked in to
  exactly one of them, in which case it checks them out of it.
- A tap checks the member in, or out if they are already in. A second tap
  within a minute is read as a bounce, not a check-out, as at a station.
- The screen shows a first name and last initial, never more.
- Every tap that records attendance is in the audit log with the room and the
  tablet's IP address.

Turning a room off takes effect on the very next tap, even on a kiosk that is
already running.

## Provenance in the record

A card tapped at an officer-operated station is recorded with entry method
**`nfc_station`**, not `qr_scan`. Those are different acts by different people:
`qr_scan` means the member scanned a category's QR code with their own phone.
Exports and audits must be able to tell them apart. Rows recorded before this
distinction existed are left as they are — they really were written by the QR
path.

## Early check-in at events

An NFC tap can land inside the check-in window but well before the event
starts. That is **flagged and never credited as attendance**: the tap time
stays the honest record of when the member arrived, and the event's manager is
shown how early it was rather than having to compare timestamps by eye. See
[Events → Early check-in](Module-Events#ranked-events-list-and-early-check-in-2026-08-23--08-24).

## API

See [API Reference → NFC ID Cards & Station Check-In](API-Reference#nfc-id-cards--station-check-in-2026-08-23) and, for badge codes and CR80 printing, [API Reference → Member badges and ID card printing](API-Reference#member-badges-and-id-card-printing-2026-10-05).

## Data

`nfc_tags` — see
[Database Schema](Database-Schema#recent-schema-changes-2026-08-23--08-24).
