# Workflow Review — W09 Import Members from a Spreadsheet

**Driven:** 2026-09-28 · **As:** `admin`, with `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `f34ff84` plus this run's fixes (re-driven) · **Database:** continued from W08; no reset

---

## What was driven

1. As `admin`, Members Administration → Import Members. Read the instructions and downloaded the template.
2. Uploaded a seven-row roster built on that template:
   - a full row with a quoted address containing a comma;
   - dates in `MM/DD/YYYY`;
   - an existing member's email;
   - a missing last name;
   - an unknown role ("Wizard");
   - an email whose local part matches another row;
   - a name beginning with `=`.
3. Downloaded the error report, then imported the rows that passed. Read each created record through the API.
4. Uploaded the same file again; uploaded the error report as-is; uploaded a non-CSV file.
5. At 390×844:
   - Uploaded a row with an existing member's email under a different username, before and after the fix.
6. As `member2`, opened the Import tab.

Not driven:

- Sending welcome emails: email is off here, and the option is disabled with the reason given.
- The imported members' first sign-in: an imported member has no known password until an officer uses Reset Password, which W11 covers.

## Held up ✅

- **The pre-check is thorough.** It flagged four of the seven rows before anything was written, each with a reason naming the column and value:
  - the missing last name;
  - the unknown role, with the fix ("create it there, or clear the role column and use rank instead");
  - the existing member's username;
  - the in-file username collision ("already used on line 2 of this file").
- **The error report** returns those rows with the reason as a first column. It neutralises a leading `=` (`escapeCsvCell`), so the report is safe to open in a spreadsheet.
- **Everything imported was stored as written:**
  - `3/15/1985` became `1985-03-15`;
  - `"5 Pump Rd, Unit 2"` kept its comma;
  - rank, platoon, position, membership number and emergency contact all saved.
- **Re-uploading the file** flagged every row as already on the roster, naming the member.
- **Uploading the error report unchanged** is handled: "Ignoring 1 unrecognized column(s): errorReason".
- **A non-CSV file** is refused ("Please select a CSV file").
- **With nothing valid,** the Import button reads "Import 0 Members" and is disabled.
- **With email off,** "Send welcome emails now" is disabled with the reason.
- **`member2` is refused** the Import tab.

## Findings

### W09-1 — MED — A duplicate email passed the pre-check whenever the department hides work email — ✅ FIXED

**Did:** at 390px, uploaded one row with an existing member's email and a new username.
**Saw:** the preview said "Showing the first 1 of 1 members that will be imported". The import then failed that row on the server: "Email already exists".
**Why:** the pre-check indexed the roster from `GET /users`. That endpoint applies the department's contact-visibility ceiling even to managers, so with work email hidden (this install's setting, seen in W04) every email came back `null`, and the duplicate-email check could never match.
**Where:** `ImportMembers.tsx`, the pre-check's roster load.
**Fix:** the pre-check reads `GET /users/with-roles`, which returns emails to `members.manage`, the permission this page already requires. The existing warning still covers a failed load. Re-driven: `email "imp.two@example.org" already belongs to Ian Two in this organization — this member is already on the roster`, flagged before import.
**Test:** `ImportMembers.test.tsx`. Its mock now serves the with-roles list, and the existing duplicate-email tests run against it.

### W09-2 — LOW — "Import Complete! Successfully imported 0 members" over a run where every row failed — ✅ FIXED

**Saw:** the success icon and heading over "0 Successful · 1 Failed".
**Fix:** when nothing was imported, the page reads "Nothing Was Imported", with a warning icon and "Every row was refused. The reasons are listed below."
**Test:** `ImportMembers.test.tsx`. The existing test for this case now asserts the honest heading.

### W09-3 — NIT — Plural and touch targets — ✅ FIXED

- "Import 1 Members" now reads "Import 1 Member", and the result says "Imported 1 member".
- "← Back to Members" and "Remove file" were 20px tall at 390px; both are now 44px on phones.

Seen and left: a duplicate email in the file is reported as a _username_ collision when the two emails share a local part. Both statements are true, and the row is correctly refused.

## Checklist

| Section                 | Result                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ template → fill → check → import → records stored exactly                 |
| 2. The right people     | ✅ `member2` refused                                                         |
| 3. Wrong input, failure | ✅ every bad row named with a reason; W09-1 and W09-2 fixed                  |
| 4. Browser signals      | ✅ only the provoked `400`                                                   |
| 5. Coming back to it    | ✅ re-upload is safe: every row flagged as already on the roster             |
| 6. On a phone           | ✅ no overflow; W09-3                                                        |
| 7. Everyone can use it  | ✅ reasons in text; the report is a plain CSV                                |
| 8. What happens around  | ✅ nothing claims an email was sent with email off; report cells neutralised |

## Completion gate

| Check                    | Result                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                      |
| npm run lint             | ✅ clean                                                                      |
| flake8 (changed files)   | n/a — no Python changed                                                       |
| black --check            | n/a                                                                           |
| frontend tests (touched) | ✅ full suite: 604 files, 8199 tests; the changed cases failed before the fix |
| backend tests (touched)  | n/a                                                                           |

## Second pass — the import after class and status split and step-up (2026-11-10)

**Driven:** 2026-11-10 · **As:** `admin`, with `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `f877e25` plus this pass's fixes · **Database:** continued from the W08 second pass; no reset

The owner asked to continue with W09. Since the first pass:

- the template gained `memberClass` and `memberStatus` columns (2026-10-29);
- a create that grants a rank or position asks the officer to confirm it's them.

### What was driven

1. As `admin`, Members Administration → Import Members. Downloaded the template.
2. Uploaded a nine-row file:
   - a full row with rank Captain, position Safety Officer and a quoted address containing a comma;
   - `MM/DD/YYYY` dates with `membershipType` probationary;
   - `memberClass` administrative with rank Captain;
   - the phone "call me maybe";
   - `membershipType` "wizard";
   - the email "not-an-email";
   - the email of the member added in W08;
   - a first name beginning with `+`;
   - the date of birth `13/45/2001`.
3. Imported, confirmed "Confirm it's you" when it opened mid-run, and downloaded the error report.
4. Read each created record through the API, and the audit rows.
5. After the fixes, re-uploaded the administrative-with-rank row, then the whole file again.
6. As `member2`, opened the Import tab.
7. At 390×844, uploaded the file.

### Held up ✅

- **The pre-check named four bad rows before anything was sent**, each with the column and value: membership type, email, date, and the existing member's email and username.
- **Step-up mid-import:** the first row with a position was refused with `LB-AUTH-013`. "Confirm it's you" opened, and once confirmed the run carried on from that row; nothing was skipped or sent twice.
- **Everything imported was stored as written:**
  - `05/09/1994` became `1994-05-09`;
  - `"7 Ladder Ct, Apt 3"` kept its comma;
  - rank and position, platoon and emergency contact were saved;
  - `probationary` became the probationary class and status.
- **Rows the server refused come back in the error report**, with the server's reason in the first column. The report is not limited to the pre-check's rows.
- **Re-uploading the file** flagged every imported row as already on the roster.
- **Audited:** `stepup_verified` and one `user_created` per member, each stamped with the department, the IP and (since W08-8) the starting status.
- **`member2` is refused** the Import tab.
- **Phone:** no sideways scroll. The only control under 44px is the inline "Set it up now" link, which is exempt; the 16px checkbox sits inside a full-width label.

### W09-4 — LOW — The pre-check passed an administrative member with a rank — ✅ FIXED

**Saw:** the preview counted the `memberClass` administrative / rank Captain row as one to import. The import then failed it: "Administrative members do not hold an operational rank."
**Where:** `validateRow` in `ImportMembers.tsx`.
**Fix:** the pre-check flags the row: `rank "Captain" is set on an administrative member, who holds no operational rank — clear the rank or make the member operational`. It uses the `isAdministrativeMember` helper that greys out Add Member's rank field, so `membershipType` administrative counts too. Re-driven.
**Test:** `ImportMembers.test.tsx`, whose two new cases failed before the fix.

### W09-5 — LOW — "Leave membershipNumber blank to have the system assign one" was not true here — ✅ FIXED

**Saw:** all three imported members have no membership number. The server assigns one only when automatic numbering is on, and in this install it is off.
**Fix:** the instruction reads the same preview Add Member reads:

- with numbering on, it names the next number ("… starting at FD-0042");
- with numbering off, it says a blank imports the member without a number, and where numbering is set;
- if the preview can't be read, it states the condition.

Re-driven.
**Test:** `ImportMembers.test.tsx`, whose two new cases failed before the fix.

### W09-6 — MED — Add Member requires a membership number; the import does not — FLAGGED

With numbering off, Add Member refuses to save without a number, but the import creates the member with none. `POST /users` accepts either, so the rule lives only in one form. Should it be required, and on the endpoint? And what happens to members already stored without one? Recorded in `docs/KNOWN_LIMITATIONS.md`.

### W09-7 — LOW — A bad phone passes the pre-check — LEAD

**Saw:** "call me maybe" passed the pre-check. The server refused it with the W04-7 phone rule, and the row came back in the error report.
**Why not fixed:** the rule is defined only on the server (`app/utils/phone_numbers.py`). Copying it into the pre-check would give it two definitions (CLAUDE.md pitfall 29). The outcome is correct, just late. A shared definition, or a server-side dry run of the file, would let the pre-check catch it.

### Checklist

| Section                 | Result                                                               |
| ----------------------- | -------------------------------------------------------------------- |
| 1. The job gets done    | ✅ template → check → import (with step-up) → records stored exactly |
| 2. The right people     | ✅ `member2` refused                                                 |
| 3. Wrong input, failure | ✅ bad rows named; W09-4 fixed; W09-7 a lead                         |
| 4. Browser signals      | ✅ only the provoked `400`, `403` and `422`                          |
| 5. Coming back to it    | ✅ re-upload flags every imported row                                |
| 6. On a phone           | ✅ clean                                                             |
| 7. Everyone can use it  | ✅ reasons in text; the report is a plain CSV                        |
| 8. What happens around  | ✅ every create audited; W09-5 fixed, W09-6 flagged                  |
