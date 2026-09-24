# Recent changes: September 15 – 23, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-09-15_TO_09-23.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-09-15_TO_09-23.md).
Predecessor: [September 12 – 15](Recent-Changes-2026-09-12-to-09-15).

**The headline:** **suggestion boxes** — the first new screens since early
September — and a membership pipeline that moves applicants off a meeting stage
**when the event is finalized**, not when they tap the kiosk. Four migrations,
head `5a70c5dcd138`. Nothing moved address and no bookmark breaks.

The window's theme is **records that say what really happened**: an applicant
moves when the department has settled who attended; each inventory item knows
whether it has a label; a form stops storing answers to questions the submitter
could not see; and the pipeline header counts the applicants the table shows.

## Read this first

**If you administer a department:**

- **Tell your event organizers to finalize.** A meeting stage that names its
  event (it has an **Auto-Link Event Type**, or is pinned to one event) now
  advances an applicant only once they are checked in **and** that event's
  attendance is finalized — End Event, recording the actual end time, or
  Finalize Attendance. An event nobody finalizes releases them seven days after
  it ends (`PIPELINE_ATTENDANCE_SETTLE_DAYS`). **The same rule now applies to a
  coordinator's own Advance button**, bulk or single — before, a single click
  was exempt. A stage that names no event ("meet with the chief") still takes
  the coordinator's word.
- **Look at who is parked on an event-naming meeting stage** having attended
  without being checked in. They will be refused on Advance until you record
  the attendance — which you can do after the fact from the event.
- **Five seeded positions gain `suggestions.manage`** — Fire Chief, Deputy
  Chief, Assistant Chief, President, Communications Officer. It lets them set up
  suggestion boxes. **It does not let them read any submission**; only a box's
  named reviewers can.
- **Every inventory item reads "Needs a label" after the upgrade.** There was no
  history to carry over. If your stock is already labelled you can mark it
  without printing — see the upgrade notes.
- **Optionally clear old hidden form answers** with a dry-run-by-default script.

## What members will notice

- **Suggestions** in the sidebar, just after Messages. Submit to any box your
  department has opened — named or, where allowed, anonymously — with up to five
  screenshots. An anonymous submission stores no name and no exact time, and
  screenshots lose their hidden location data. A box that allows follow-up gives
  an anonymous submitter a **one-time key** to read replies; **a lost key cannot
  be replaced**.
- **The installed app's icon is the department's logo.** Anyone who installed
  earlier keeps the old icon until they remove the app and add it again.
- **A form no longer refuses you over a question you could not see.** A required
  question that only shows for some answers is only required while showing.

## What officers will notice

- **Meeting stages** — above. The applicant drawer states the requirement before
  you click, and a refusal names the three ways out: record the attendance,
  un-tick **Required** and skip, or clear the stage's Auto-Link Event Type.
- **The pipeline header matches the table.** Converting, skipping, holding and
  the rest now refresh the stat cards too, and the cards count through the same
  search and event filter as the list. If they disagreed before, the table was
  right.
- **Quartermasters: label by filter.** Filter the items list, tick one row,
  **Select all N matching** (up to 500), **Print Labels**. The label page opened
  with nothing selected offers a Category / Location / Storage-area picker.
  After printing it asks **"Did the labels print correctly?"** — confirming
  takes the items off the new **Needs a Label** filter. Changing an item's
  barcode puts it back.
- **Medical Screening → Add Record** now warns that the record it creates is not
  linked to any member. That was always true; the dialog just says so now.

## Suggestion boxes in one paragraph

Set up under **Administration → Forms & Comms → Suggestion Boxes**
(`suggestions.manage`). Each box has reviewers (positions and/or members), an
**Anonymity** rule — **Submitter chooses**, **Always anonymous**, **Always
named** — and an **Allow follow-up** switch. Reviewers work submissions on the
**Review** tab of the Suggestions page: a disposition (**New**, **Under
review**, **Accepted**, **Implemented**, **Declined**, **Duplicate**), an
internal note, and a reply thread. A reviewer can forward a single suggestion
to other members or positions, who then review that one only. Emails carry a
link, never the content. Suggestion boxes are **not** tied to the
Communications module switch. What anonymity does not defeat — someone with
access to the server's own logs lining up times — is recorded in the repository's
`docs/KNOWN_LIMITATIONS.md`.

## Added September 24, after the window

These changes landed a day after the window closed, in
[#2667](https://github.com/thegspiro/the-logbook/pull/2667).

**Members and event organizers: the event page's Event Information card.**

- **Capacity shows on any event with a cap.** It used to show only on events
  that require an RSVP. A capped event puts people on a waitlist either way, so
  a waitlisted member could not see the "3 / 3, Event Full" that explained why.
- **No more empty card.** An event that needs no RSVP, has no cap and allows no
  guests used to show the card's heading with nothing under it. The card is now
  left out.
- **Managers see capacity once.** It stays in the Statistics card and is no
  longer repeated in Event Information.

**Nothing to do on upgrade.** The fix is on the web page only: no migration and
no setting.

**If you maintain the training screenshots:**

- **Every placeholder in the guides is now filled (600 of 600).**
- **One image shows a simulated result, and its caption says so.** It is
  Settings → Email with Microsoft 365 passing Test Connection, since the demo
  has no Microsoft 365 tenant.
- **Nine new steps in `scripts/screenshots/seed_demo_data.py`** create what the
  new screens needed. They run at the end of a normal seed and are safe to
  re-run:
  - an org chart;
  - two testing runs;
  - a capped event with a waitlisted member;
  - past closed-out shifts;
  - a retired call type;
  - photo-consent answers;
  - a member's privacy settings;
  - a long department message;
  - one out-of-stock coat size.
- **The Testing Checklist module stays off in the demo department**, as on a
  fresh install. The two testing screenshots switch it on for themselves and
  off again afterwards.
- `docs/training/SCREENSHOT_CURRENCY.md` records each shot, the data behind it,
  and the two frames that were requested but cannot exist.

## Upgrade notes

**Four migrations. Head is `5a70c5dcd138`.** Back up, confirm `alembic heads`
returns exactly one, then `alembic upgrade head`.

| Revision       | What                                            | Reverses?                                           |
| -------------- | ----------------------------------------------- | --------------------------------------------------- |
| `80e2004cd691` | Suggestion box tables                           | Yes — **and drops every suggestion**                |
| `394600cbfae2` | `suggestions.manage` onto five seeded positions | Yes — also removes a grant added by hand afterwards |
| `9cb132ad83dc` | Suggestion forwards                             | Yes — drops every forward                           |
| `5a70c5dcd138` | Label-printed columns on inventory items        | Yes — loses only the print history                  |

**Catching up labels on stock that is already labelled:** filter the items list
to **Needs a Label**, tick one row, **Select all N matching**, **Print Labels**,
**cancel** the browser's print dialog, and answer **Mark N items as labelled**.
Only confirm for items whose labels really are on the gear.

**Own reverse proxy?** The app icons are served at the paths they always had
(`/pwa-192x192.png`, `/apple-touch-icon.png`, `/apple-splash-*.png`, and the new
`/pwa-maskable-512x512.png`). Pass them through to the frontend container; a
proxy serving the built files off disk keeps serving the stock icon.

**Hidden form answers (optional):**

```bash
docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py          # dry run
docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py \
    --apply --backup-file /tmp/hidden-answers-backup.json
```

**Development note:** vitest moved to 5.0; **PyMySQL is held at 1.2.0** (1.2.1+
breaks every BLOB write through aiomysql) and **jsdom at 30.0.1** (tests only).
Both holds carry a Dependabot ignore and a lift condition in
`docs/KNOWN_LIMITATIONS.md`.

## Not yet available — do not teach these

- The crew **Sweep** and the equipment-check **lap** — built, not reachable.
- **Qualification entry** — still only through a course's _Certifies_ field.
- **Choosing the member on a medical screening record** — the dialog still cannot.

## Where to read more

| Topic                         | Repository file                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------- |
| Operator lesson               | `docs/training/20-september-2026-release-changes.md` (September 15–23 section)  |
| Suggestion boxes walkthrough  | `docs/training/07-documents-forms.md`                                           |
| Meeting stages                | `docs/training/15-prospective-members.md`, `docs/PROSPECTIVE_MEMBERS_MODULE.md` |
| Label tracking                | `docs/training/05-inventory.md`, `docs/LABEL_PRINTING_MODULE.md`                |
| Upgrade notes                 | `docs/UPGRADING.md`                                                             |
| Screenshots to create/replace | `docs/training/SCREENSHOT_CURRENCY.md`                                          |
| Video script changes          | `docs/youtube-scripts/SCRIPT_CURRENCY.md`                                       |
