# Historical Data Import

**Integrations → Historical Data Import** brings in the hours members logged in
the system a department used before The Logbook: shifts on a unit, on-call
(recall) time, training and administrative work, all from one export.

Only the **IT Manager** can open it by default. Its permission,
`integrations.historical_import`, is granted to no other position; a
department that wants someone else to run an import grants it to that
position on purpose.

## What it does, step by step

1. **Upload the export** (CSV, up to 200,000 rows / 40MB). Name the system it
   came from — and use the same name every time you import from that system,
   so rows already brought in are recognised. Nothing is written yet.
2. **Say how to read it.** Columns are detected from the header row and can be
   corrected: who the member is (membership / volunteer ID, name or email), the
   date and times, the unit, and the row's own ID. Then mark each column that
   holds hours with what it is — shift, on-call, training or administrative —
   and each column that counts calls with the department's call type.
3. **Check how the rows sorted.** Every row becomes the kind of record its
   nonzero hours column names. The page shows the count and hours of each kind
   and the clean-up applied on the way:
   - **Recorded hours win over the clock.** Where the hours column disagrees
     with the start and end times, the member is credited the recorded hours.
   - **Times past midnight.** `2445` is read as `00:45` the next day; a start of
     `2400` or later moves the entry to the next day.
   - **Overnight shifts** (`1800`–`0800`) end the next day.
4. **Send shifts to review.** Shift and on-call rows go to the
   [shift history import](Module-Scheduling) as review batches split by month
   (about 5,000 rows each). Review and commit each batch there: who each member
   is (members not in The Logbook can be created as archived former members,
   named from the file or by you), which unit each name means (your own
   apparatus or another agency's), the position a crew takes on each unit, and
   which members were one crew. "All the same shift" answers every probable
   crew match at once.
5. **Import administrative hours.** Open _Set up administrative hours_ and
   choose each row's Admin Hours category: by a yes/no flag column first (a
   birthday party, an open house, a meeting — the first set flag in the list
   wins, and the list can be reordered), otherwise by the hours column it is in.
   Create a category here if the department does not have one yet. Pick the
   columns that describe an entry, settle any member nothing matched, check the
   counts per category, and import. Entries arrive **approved** and marked
   _Imported_, credited with their recorded hours.
6. **Download the log** at any time: one line per row with what became of it —
   imported, in review, skipped, or waiting for a later step.

## What a committed batch writes

- **Shifts** on your apparatus, finalized, with each member's attendance
  credited by their recorded hours. On-call rows become **on-call shifts**,
  shown with an _On call (recall)_ badge and counted in shift hours.
- **Calls by type** (EMS, fire…) filed on each shift the way a shift close-out
  files them. A shift's count of each type is the most any one crew member
  logged, so four members on one EMS call is one call. A call two of your units
  both ran is counted once for each unit, because the export does not say they
  were the same call.
- **Outside-agency hours** for time on another department's unit, with the
  member's call count.
- **Admin Hours entries**, approved and marked _Imported_, in the category the
  rules chose, with the description from the file. They are not run through
  the 24-hour cap or overlap check a member's own entry gets — those are for
  hours typed today, not for settled history.

## Where the imported hours show up

A member's **profile** has a _Shift & Call History_ section with the same
figures as their own **My Hours** screen: hours by month and year, how many of
them were on call, calls, and hours and calls with other departments. The
member sees their own; officers holding `scheduling.report` (the chiefs,
captains, lieutenants and scheduling officer by default) see anyone's.

## Running it twice is safe

Every row a batch writes is recorded against the source system's row ID. A
second run of the same file — or a later export from the same system that
overlaps it — leaves those rows out, and a batch that somehow still carries one
skips it. Use the same source system name each time for this to work.

## Not yet included

Training hours are sorted and counted on this page but are imported by a later
step of this tool.
