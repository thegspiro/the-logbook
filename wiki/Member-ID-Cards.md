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

Cards ship blank, so **the tag's serial number is the credential** — there is
nothing written onto the card to read instead.

### What the department stores, and what it cannot read back

| Stored                                                                                                       | Not stored                               |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| A **peppered SHA-256 hash** of the serial                                                                    | The serial itself, anywhere, in any form |
| `uid_preview` — the **last four characters**, so an officer can tell two of a member's cards apart on screen | —                                        |

There is no screen and no endpoint that reads a card number back out, and none
should be added. A card serial is the whole of the credential: a plaintext
column would make a database backup a stack of working ID cards.

**Revoking is permanent.** A revoked card is never reactivated — a replacement
is a fresh registration. Suspension is the reversible state, for a card a
member has mislaid and may still find.

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
| Active, probationary                  | Yes           | —                                                                          |
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

See [API Reference → NFC ID Cards & Station Check-In](API-Reference#nfc-id-cards--station-check-in-2026-08-23).

## Data

`nfc_tags` — see
[Database Schema](Database-Schema#recent-schema-changes-2026-08-23--08-24).
