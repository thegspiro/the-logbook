# Shift History Import — User Guide

Bring the shifts your department worked before it used The Logbook into the
schedule, from a spreadsheet. Imported shifts count toward hours, **My Hours**
and shift-based training compliance exactly like shifts worked here, so members
keep credit for years of service from day one.

**Who can use it:** anyone with the `scheduling.manage` permission.

**Where:** **Scheduling → Administration → Shift History Import**, under
"After the shift" (`/scheduling/admin/history-import`).

> **Nothing reaches the schedule until you commit.** An upload becomes a
> _draft_. You can review it over several sittings, and every decision is saved
> as you make it. You can throw a draft away at any time. **A commit is final:**
> there is no "undo this import". After committing, you correct imported shifts
> one at a time from the schedule, like any other shift.

---

## Contents

1. [Before you start](#before-you-start)
2. [Prepare the file](#prepare-the-file)
3. [Upload](#upload)
4. [Review](#review)
5. [Commit](#commit)
6. [Importing several files](#importing-several-files)
7. [How the import decides things](#how-the-import-decides-things)
8. [Troubleshooting](#troubleshooting)
9. [Quick reference](#quick-reference)

---

## Before you start

The import matches the file against what is already in The Logbook, so a few
minutes of setup saves a lot of hand-mapping later.

- **Add your current members.** People in the file are matched to members by
  membership number, email, username or name. Anyone not found can be added
  during review as an archived former member, but current members should exist
  first.
- **Add your own units in Apparatus.** Rows on your department's units become
  shifts on the schedule, matched by **unit number** or **name**.
- **Add other agencies' units, if your members rode on them.** Rows on another
  agency's unit (a county ambulance, a neighbouring department's engine) become
  [outside-agency hours](Module-Scheduling#shifts-with-other-departments)
  rather than shifts. You can also add these units during review.
- **Check the department's time zone** in Settings. A file is read in that zone
  unless you choose another one at upload.

---

## Prepare the file

The file must be a **CSV**: from Excel, use _Save As → CSV_. Each file can hold
**up to 10,000 rows**, and at most **10 MB**. Put a single header row first, then
**one row per member per shift**. If four people rode a shift, it takes four
rows.

Click **Download template** on the import page for a header row the import reads
with no mapping needed:

```
member_name,membership_number,email,username,unit,agency,position,date,start_time,end_time,call_count,status
```

### Columns

| Column              | Needed?                       | What goes in it                                                                                                  |
| ------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `member_name`       | One of these four identifiers | `John Smith` or `Smith, John`. Separate `first_name` / `last_name` columns also work                             |
| `membership_number` | (see row above)               | Badge or department ID. The most reliable way to match a person                                                  |
| `email`             | (see row above)               | Matched against the member's work or personal email                                                              |
| `username`          | (see row above)               | Their Logbook username                                                                                           |
| `unit`              | **Required**                  | The vehicle exactly as your department names it, e.g. `A106E`                                                    |
| `agency`            | Optional                      | Who owns the unit. Leave blank, or use your department's name, for your own units; name the agency for any other |
| `position`          | Optional                      | The seat ridden: `Officer`, `Driver`, `EMT`… Blank means **firefighter**                                         |
| `date`              | Required, with one exception  | The day the shift **started**. Can be omitted if `start_time` holds a full date and time                         |
| `start_time`        | **Required**                  | When the member started                                                                                          |
| `end_time`          | **Required**                  | When the member finished                                                                                         |
| `call_count`        | Optional                      | How many calls they ran, as a whole number from 0 to 500. Only the total is kept, not individual calls           |
| `status`            | Optional                      | `cancelled`, `canceled` or `no-show` skips the row. Anything else, or blank, imports it                          |

Your columns don't have to use these names. Common headings are recognised
automatically: `Name`, `Badge #`, `Apparatus`, `Vehicle`, `Time In`, `Clock Out`,
`Calls`, `Shift Date` and more. Anything unrecognised you assign during review.

### Dates and times

| Kind        | Accepted                                                                              |
| ----------- | ------------------------------------------------------------------------------------- |
| Dates       | `2025-03-01` (preferred), `2025/03/01`, `03/01/2025`, `3/1/25`, `03-01-2025`          |
| Times       | `07:00`, `7:00 PM`, `0700`, `700`, `7pm`, `24:00`                                     |
| Date + time | `2025-03-01 07:00` or `03/01/2025 7:00 AM` in a time column (then `date` is optional) |

Dates are read **month first**: `03/01/2025` is March 1.

**Shifts that cross midnight.** Give the start date and the two clock times. An
end time at or before the start time means the shift ended the next day:

| Date       | Start | End   | Read as                      |
| ---------- | ----- | ----- | ---------------------------- |
| 2025-03-01 | 07:00 | 19:00 | 12 hours, same day           |
| 2025-03-01 | 19:00 | 07:00 | 12 hours, ending March 2     |
| 2025-03-01 | 07:00 | 06:00 | 23 hours, ending March 2     |
| 2025-03-01 | 07:00 | 07:00 | **24 hours**, ending March 2 |

A single row can be at most 48 hours. Only shifts that have already ended can be
imported.

### Shifts logged in pieces

Some older systems can't record a shift past a fixed time and log the overflow
as a second entry. You don't need to merge these by hand. When the same member
has back-to-back entries on the **same unit** with **30 minutes or less**
between them, the import joins them into one stretch on duty:

| Date       | Unit  | Start | End   |
| ---------- | ----- | ----- | ----- |
| 2025-10-09 | A106E | 06:00 | 06:00 |
| 2025-10-10 | A106E | 06:00 | 07:30 |

These two rows become **one 25.5-hour attendance**. If the two entries really
were separate shifts, you can split them apart during review.

### Tips

- **Split a long history by year** to stay under 10,000 rows. The import is
  built to take several files; see [Importing several files](#importing-several-files).
- **Include membership numbers if you have them.** Names alone go wrong when
  two members share a name, or when someone appears as "Bob" in one file and
  "Robert" in another.
- **Keep unit names exactly as written.** `A106` and `A106E` are treated as two
  different vehicles, which is correct when one is the county's and one is
  yours.

### Sample file

This short file shows most of what the import handles. Copy it into a text
editor, save it as `sample.csv`, and upload it to see the review screens before
you prepare your own:

```csv
member_name,membership_number,email,username,unit,agency,position,date,start_time,end_time,call_count,status
"Smith, John",101,,,A106E,,Officer,2025-03-01,07:00,07:00,6,
Maria Lopez,102,,,A106E,,Driver,2025-03-01,07:00,07:00,6,
Dana Former,77,,,A106E,,,2025-03-01,07:30,07:00,5,
Alice Ng,103,,,A106E,,EMT,2025-03-02,19:00,07:00,3,
Bob Diaz,104,,,A106E,,EMT,2025-03-02,7:00 PM,7:00 AM,3,
Alice Ng,103,,,A106E,,EMT,2025-10-09,06:00,06:00,8,
Alice Ng,103,,,A106E,,EMT,2025-10-10,06:00,07:30,1,
Bob Diaz,104,,,A106,County EMS,,03/05/2025,0800,2000,4,
Maria Lopez,102,,,A106E,,Driver,2025-03-08,07:00,07:00,,Cancelled
```

The results below assume a department that:

- owns unit **A106E**;
- has **A106** listed as a County EMS unit;
- has members numbered 101 to 104;
- has nobody numbered 77.

| Line | What it shows                                                                                  | What the import does                                                                                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2–3  | Two members on a 24-hour shift. `"Smith, John"` is in quotes because the name contains a comma | One shift on A106E from 07:00 on March 1 to 07:00 on March 2, with John as officer and Maria as driver, each credited 24 hours and 6 calls                                                                                                                  |
| 4    | A former member, arriving 30 minutes late, with no position                                    | **Dana Former** shows as _No match_ on **Members**. Once you choose _Create as an archived former member_, the row is an **85% match** for that shift and waits on **Shifts** for _Same shift_ or _Keep separate_. A blank position is the firefighter seat |
| 5–6  | A night shift crossing midnight, written in two time formats                                   | One 12-hour shift, 19:00 on March 2 to 07:00 on March 3, with Alice and Bob in the EMT seat                                                                                                                                                                 |
| 7–8  | One shift logged in two pieces                                                                 | Joined into **one 25.5-hour attendance** for Alice, with the call counts added together (9). **Split apart** on **Shifts** undoes it                                                                                                                        |
| 9    | Time on another agency's unit, with a US-style date and 24-hour times without colons           | **12 outside-agency hours** for Bob on County EMS's A106, not a shift on your schedule                                                                                                                                                                      |
| 10   | A cancelled shift                                                                              | Skipped, and listed under **Skipped** on **Rows**                                                                                                                                                                                                           |

Line numbers count the header as line 1, matching the line numbers the review
screens show.

---

## Upload

1. Open **Shift History Import**.
2. Drop the CSV on the upload box, or click it to browse.
3. Under **Times in the file are in**, leave _The department's time zone_ unless
   the file was written somewhere else. You can change this later.
4. Click **Upload and review**.

The file is read and you're taken straight to its review page. The **Imports**
list on the main page shows every draft and committed import, with the time zone
each one was read in. **Review** reopens a draft, and the bin icon discards one.

---

## Review

The review page has a summary bar and seven tabs. Every change you make is
saved immediately, and the whole file is re-checked, so the counts and the
issue list are always current. You can leave and come back at any time.

The summary shows the rows, the time zone the times were read in, and how many
issues remain. Below that are four counts:

- **New shifts**
- **Existing shifts added to**
- **Outside-agency entries**
- **Already recorded (skipped)**

A tab's number shows how many things on it still need a decision.

A good order to work in:
**Columns & time zone → Members → Units → Positions → Shifts → Issues**.
Settling one member or unit often clears dozens of issues at once.

### Issues

Every problem that blocks the commit, in plain language, for example "No member
matches 'Dana Former'" or "Line 3 is a 70% match…". Click **Resolve** to jump to
the tab that fixes it. When the list is empty, the page says _Nothing blocks
this import_.

### Columns & time zone

- **Time zone:** every time in the file is read in this zone. If the hours look
  an hour or more off, the file was probably written in a different zone. Change
  it here and the whole file is re-read.
- **Columns:** which column of your file feeds each field. Pick
  _Not in this file_ for anything the file doesn't have, then click **Save
  columns**. Re-mapping keeps any per-row edits you've made.

### Members

This tab lists each **person** in the file once, however many rows they have.
By default it shows only the people who need a decision. Tick **Show settled**
to see everyone.

| Badge                   | Meaning                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| **Matched**             | Found automatically. No action needed                                                           |
| **Mapped**              | You chose who this is                                                                           |
| **Will be created**     | Will be added as an archived former member                                                      |
| **Conflict**            | An ID or email belongs to a member with a different surname, so it may be a reused badge number |
| **More than one match** | Two or more members have this name                                                              |
| **No match**            | Nobody in the department matches                                                                |
| **Remembered**          | Settled by a decision from an earlier import (see [below](#importing-several-files))            |

For each person, open the dropdown and choose one of:

- **Map to an existing member.** The likely candidates are listed first, and
  inactive or archived members can be chosen too.
- **Create as an archived former member.** For people who no longer serve.

**Create all _N_ unmatched as archived** does the second for every _No match_
person at once. It deliberately skips conflicts and ambiguous names, because
those may well be people already in the department.

**About archived former members:**

- They exist so their history has someone to belong to.
- They have no password and cannot sign in.
- No email or invitation is sent to them.
- They don't appear on the current roster.

**Names are never matched loosely.** "J. Smith" is not assumed to be "John
Smith". It shows here for you to map by hand.

### Units

This tab lists each unit name in the file, with its agency if the file gave one.
For each, choose one of:

- **One of this department's units.** Its rows become shifts on your schedule.
- **An outside agency's unit.** Its rows become outside-agency hours for each
  member.
- **Add as an outside agency's unit…** Use this when the unit isn't in the
  system yet. Enter the agency and unit name, then click **Use this unit**. The
  agency and unit are created when you commit.

Unit names only match **exactly** (ignoring case and spacing), so `A106` never
matches `A106E`.

### Positions

Only rows on your own units take a seat. Positions show up here once every
row's member and unit is settled.

- **Matched automatically:**
  - a blank position, which is the **firefighter** seat;
  - the standard seats: Officer, Driver, Firefighter, EMT/EMS, Paramedic,
    Captain, Lieutenant, Probationary, Volunteer and Other;
  - any custom seat your department has, if the name matches exactly.
- **Anything else**, such as "Acting Lt" or "Rider", needs mapping. Choose one
  of your seats from the dropdown.

### Shifts

This tab shows the shifts the import will create or add to, one card per shift,
with its unit, its times in the file's time zone, and its crew. It shows only
the shifts waiting on a decision; untick **Only shifts that need a decision** to
see all of them.

- **A % match** badge means a row was close but not certain to be part of this
  shift. Choose:
  - **Same shift** to keep it on this shift;
  - **Keep separate** to make it its own shift.
- **_N_% match for a shift already on the schedule** means a matching shift is
  already on your schedule. Choose:
  - **Add to that shift** to add these members to the existing shift;
  - **Import separately** to create a new shift.
- **Joined from _N_ entries** marks back-to-back entries that were
  [joined into one](#shifts-logged-in-pieces). If they were really separate
  shifts, click **Split apart**.
- **Already recorded — will be skipped** means this member is already on that
  shift, or already has those outside-agency hours, so nothing is written twice.

Rows on outside agencies' units are listed under **Outside-agency hours** at
the bottom of the tab.

### Rows

This tab is every line of the file, for fixing or leaving out individual rows.
Filters: **Need attention** (the default), **All**, **Skipped** and
**Excluded**.

- **Edit** (pencil icon): correct any field on that one row. The original file
  is never changed. An edited field is marked _(edited)_ and **Revert** restores
  the file's value.
- **Exclude / Include:** leave a row out of the import entirely, or bring it
  back.
- **Undo** reverses a _Same shift_ or _Keep separate_ decision.
- **Rejoin** reverses a _Split apart_.

Rows marked cancelled or no-show in the `status` column appear under
**Skipped** automatically.

---

## Commit

**Commit import** becomes available when the Issues tab is empty. Clicking it
shows exactly what will be written: new shifts, existing shifts added to,
attendance and outside-agency entries, and any former members to be created.
Confirm with **Commit import**, or choose **Keep reviewing**.

**What a commit does:**

- **Creates the shifts** as finalized shifts, with each member on the roster in
  their seat and an attendance record for their hours and call count.
- **Adds members to existing shifts** where you chose _Add to that shift_.
- **Logs outside-agency hours** as counted entries.
- **Creates the archived former members** and any new outside agencies and
  units.
- **Counts toward everything:** department hours reports, each member's **My
  Hours**, and shift-based training compliance.
- **Remembers your decisions** for the next file.

**What a commit deliberately does _not_ do:**

- Send notifications or emails of any kind.
- Ask for shift close-out reports, end-of-shift equipment checks or trainee
  evaluations. Those are for shifts that just happened, not ones from 2019.

**After committing:**

- The import page shows a summary of what was written.
- The Imports list keeps a record of it.
- **There is no batch undo.** To correct an imported shift, open it on the
  schedule and fix it like any other.

> **Check before you commit.** Spend a minute on the **Shifts** tab with
> **Only shifts that need a decision** unticked, and spot-check a few busy days.
> Fixing a draft is one click; fixing committed shifts is one shift at a time.

---

## Importing several files

The import is designed for a history that arrives in several files, for example
one per year.

**Decisions are remembered.** When you commit, the import saves each person,
unit and position decision you made. On the next file, the same name settles
itself and shows a **Remembered** badge. This means:

- someone you created as a former member in the 2019 file is **mapped to that
  same record** in the 2020 file, never created twice;
- an outside unit you added once is reused;
- a position you mapped once stays mapped.

**Rules for remembered decisions:**

- **You can override one.** Choose differently in the dropdown, and that
  file's choice wins.
- **Only committed decisions are remembered.** A discarded draft teaches the
  import nothing.
- **Automatic matches aren't stored.** They're simply found again.
- **A remembered member who has since been removed is ignored.** That name
  needs a decision again.
- **Decisions stay within your department.**

**Re-importing is safe.** Each new file is checked against the schedule as it is
now, including shifts from earlier imports:

- a shift that's already there is matched, not duplicated;
- a member already on it is shown as _Already recorded_ and skipped.

The same applies to shifts entered by hand after go-live.

---

## How the import decides things

### Which rows are the same shift

Rows on the **same unit**, starting on the **same day**, are compared by their
start and end times, and only if both are within **2 hours** of each other.
Start time counts for more (60%) than end time (40%), because crews start
together but leave as calls allow.

| Confidence | What happens                                               |
| ---------- | ---------------------------------------------------------- |
| 90–100%    | Same shift, automatically                                  |
| 60–89%     | Grouped, but held on the **Shifts** tab for you to confirm |
| below 60%  | A separate shift                                           |

Examples against a crew on 07:00 → 07:00 the next day:

| Another member's row | Confidence | Result                  |
| -------------------- | ---------- | ----------------------- |
| 07:00 → 07:00        | 100%       | Same shift              |
| 07:10 → 07:00        | 95%        | Same shift              |
| 07:30 → 07:00        | 85%        | You're asked to confirm |
| 08:30 → 07:00        | 55%        | Separate shift          |

The same bands decide whether a shift in the file matches one **already on the
schedule** for that unit and day.

Steps happen in a fixed order. Back-to-back entries are
[joined](#shifts-logged-in-pieces) **before** rows are grouped. That way, the
tail end of one day's shift isn't mistaken for a member of the next day's crew.

### Who a person is

The import tries each of these in turn and stops at the first that applies:

1. **Membership number:** exact match.
2. **Email:** exact match against the work or personal email.
3. **Username:** exact match.
4. **First and last name:** both must match. The first name may match a
   member's preferred name.

An ID or email match where the file's surname differs from the member's is
flagged as a **Conflict**. That is how a badge number reused years later is
caught.

### Time zones and daylight saving

Times are read as local times in the import's zone and stored in UTC. They are
shown back to each viewer in their own time zone, as everywhere else in the
app. Twice a year the clock is ambiguous, and the standard rule applies:

- **Spring forward:** a time that never happened, such as 02:30, is read as
  if the clock hadn't changed yet, so it lands an hour later.
- **Fall back:** a time that happened twice is read as the first occurrence.

---

## Troubleshooting

| Message or symptom                                           | What to do                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| "The file has more than 10,000 rows"                         | Split it, by year for example, and import each part                                                           |
| "The file has no header row" / "The file is empty"           | Make sure the first line is the column headings, and that you saved as CSV, not `.xlsx`                       |
| "Date '…' is not a date"                                     | Use `YYYY-MM-DD` or `MM/DD/YYYY`. Fix the row on **Rows**, or correct the column mapping                      |
| "No unit" / "No start time" / "No end time" on every row     | A column wasn't recognised. Assign it on **Columns & time zone**                                              |
| "The shift has not ended yet"                                | Only past shifts can be imported. Exclude the row                                                             |
| "A single row cannot be longer than 48 hours"                | Usually a wrong date. Edit the row                                                                            |
| "…put the same member on the same unit at overlapping times" | The file lists the member twice. Exclude or correct one row                                                   |
| "…put the same member on this shift twice"                   | Exclude one row, or **Keep separate** one of them                                                             |
| "A new member … would reuse the membership number …"         | That ID belongs to someone already in the system. Map the person to that member, or edit the ID on their rows |
| "… has no name in the file"                                  | A person with only an ID or email can be mapped, but can't be created. Add a name on their rows, or map them  |
| All hours look an hour or more off                           | Change the time zone on **Columns & time zone**                                                               |
| Positions tab is empty                                       | Positions appear once every member and unit is settled                                                        |
| "Nothing in this file is new"                                | Every row is excluded, skipped or already recorded, so there is nothing to commit. Discard the draft          |
| Imported something wrong                                     | Fix the affected shifts on the schedule. There is no batch undo                                               |

---

## Quick reference

| Limit or rule             | Value                                               |
| ------------------------- | --------------------------------------------------- |
| Permission                | `scheduling.manage`                                 |
| File type and size        | CSV, up to 10 MB                                    |
| Rows per file             | 10,000                                              |
| Same-shift tolerance      | Start and end within 2 hours                        |
| Automatic / review bands  | 90%+ automatic · 60–89% review · below 60% separate |
| Joining back-to-back rows | Same member, same unit, gap of 30 minutes or less   |
| Longest row               | 48 hours                                            |
| Calls per row             | 0–500                                               |
| Skipped statuses          | cancelled, canceled, no-show                        |
| Undo after commit         | None. Correct shifts individually                   |

See also: [Scheduling module](Module-Scheduling).
