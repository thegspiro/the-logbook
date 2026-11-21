# Workflow Review — W11 Edit a Member as an Officer

**Driven:** 2026-09-28 · **As:** `admin`, with `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `f3f1728` plus this run's fixes (re-driven) · **Database:** continued from W10; no reset

---

## What was driven

All on Casey Newhire, the member added in W08.

1. As `admin`, Members Administration → Edit:
   - Set the middle name, cleared the phone, and set then cleared the personal email. Reloaded after each.
   - Added an emergency contact with a name, relationship and phone but no email.
   - Added one with only a name.
   - Changed the membership type from Probationary to Active.
2. From the member's profile: Change status → Leave, with a reason. Reloaded.
3. View History:
   - read every filter;
   - opened an entry's details.
4. Members Administration:
   - Reset Password, first with a password that breaks a rule, then with a valid one.
   - View by Role → Manage Members: added two members to Historian, then removed them.
   - Opened the "×" on a member's base Member position and backed out.
5. As `member2`:
   - opened the edit page;
   - sent `PATCH /users/{id}/profile` and `PATCH /users/{id}/status`;
   - sent `GET /users/{id}/audit-history`.
6. The edit page and the history page at 390×844.
7. Put Casey back to active and probationary through the API.

Not driven: Casey signing in with the reset password. The forced change after an officer-set password is the same flow W08 drove end to end.

## Held up ✅

- **Clearing works.** Middle name, phone and personal email each saved, cleared and survived a reload. The update path sends the cleared value rather than omitting it.
- **Status change:**
  - The status dialog refuses a no-op and hides Archived, which has its own flow.
  - Leave and its reason were stored.
  - The history shows "Status changed: active → leave" with the reason in its details.
- **Membership type:** saved, survived a reload, and is listed under Membership Changes.
- **History filters:**
  - Profile Updates lists each save with the fields it changed.
  - Status Changes, Membership Changes and Password Resets each show exactly their own events.
  - An empty filter says so and offers "Clear filter".
- **Manage Members:** adding two members to a position and removing them both landed, confirmed through the API.
- **`member2` is refused** everywhere:
  - the page shows "Access Denied";
  - both PATCHes and the history return `403`.
- **At 390px:** no sideways scroll on either page. The status dialog fits the screen.

## Findings

### W11-1 — MED — An emergency contact without an email could not be saved — ✅ FIXED

**Did:** Add Contact; filled in name, relationship and phone; left the email empty; saved.
**Saw:** `422`: "emergency_contacts.1.email: value is not a valid email address: An email address must have an @-sign." The contact was lost. After a reload only the existing contact remained.
**Why:** the new contact's email starts as `''`. The page sent contacts as they were, and `EmergencyContact.email` is `EmailStr | None`. The same refusal came back for a contact with no relationship, which the schema requires, worded as a field path.
**Where:** `MemberAdminEditPage.tsx`, `handleSave`.
**Fix:** contacts are trimmed and a blank email is omitted. A contact missing its name or relationship is named on the page ("Emergency contact 2 needs a name and a relationship.") and nothing is sent.
**Re-driven:** the name-only contact was refused on the page. With the relationship added it saved as `{"name":"Sam Newhire", …, "email":null}`.
**Test:** `MemberAdminEditPage.test.tsx`.

### W11-2 — LOW — The edit page's fields, and both member dialogs, had no programmatic label — ✅ FIXED

**Saw:**

- 21 of the edit page's 23 fields were unnamed. Only Rank and Membership Type had a name. This covered every emergency-contact field.
- The status dialog's New Status and Reason were unnamed.
- The reset-password dialog's two password fields were unnamed.

**Fix:**

- Each field has an `id`, and its label points to it. Contact fields are keyed by index.
- Re-driven: no unnamed field remains on the page.

**Test:**

- `MemberAdminEditPage.test.tsx`
- `MemberProfilePage.test.tsx`
- `MembersAdminPage.test.tsx`

### W11-3 — LOW — Reset Password did not say which rule a password broke, and said nothing on success — ✅ FIXED

**Did:** tried `Abcdefgh1234!`, then a valid password.
**Saw:**

- The refusal was "Password does not meet strength requirements", with no rule named.
- On success the dialog closed and nothing was shown. That reads the same as a dismissed dialog.

**Fix:**

- The dialog lists the rules as the password is typed (the shared `PASSWORD_CHECKLIST`, as W08-4) and refuses with "Password does not meet every rule listed below".
- Success shows "Password reset for Casey Newhire".

**Re-driven:** both states, and two "Password reset by administrator" entries in the history.
**Test:** `MembersAdminPage.test.tsx`.

### W11-4 — LOW — Manage Members hid a partial save — ✅ FIXED (the W05 lead)

**Read from code, then tested:**

- The dialog sent every member's change at once under `Promise.all`.
- If one was refused, the others still landed. The page showed only the refusal, did not reload, and did not say anything had been saved.

**Fix:**

- Changes are sent one member at a time.
- The list reloads afterwards.
- A refusal keeps the dialog open with "1 of 2 changes saved. Not saved — Ian Two: <server's reason>".

Sending one at a time also stops this page from sending two removals at the moment the server counts administrators (see W11-8).
**Re-driven:** added and removed two members on Historian; the API confirmed both ways.
**Test:** `MembersAdminPage.test.tsx`. It asserts one request at a time and the message.

### W11-5 — LOW — Removing a position with "×" hid its name and the server's reason — ✅ FIXED

**Saw:**

- The confirmation read "Remove this role from Ian Two?", without naming the position.
- Read from code: any refusal, including the last-administrator refusal, was replaced with "Please check your connection and try again".

The same was true of the "×" in View by Role.
**Fix:**

- The confirmation names the position: "Remove Member from Ian Two?".
- Both handlers show the server's reason when there is one.

**Test:** `MembersAdminPage.test.tsx`.

### W11-6 — LOW — The history showed a date and no time — ✅ FIXED

**Saw:** every entry read "9/28/2026". Seven changes made that day could not be put in order, and an audit trail exists to answer "when".
**Fix:** `formatDateTime` in the member's timezone. Re-driven: "Monday, September 28, 2026 at 5:39 AM".
**Test:** `MemberAuditHistoryPage.test.tsx`.

### W11-7 — NIT — Tap targets at 390px — ✅ FIXED

These are now 44px on phones:

- "Back to Members Admin" (was 20px);
- each contact's "Remove" (was 16px);
- "View History" (was 16px);
- on the history page, "← Back to Edit Member" and "▼ Details" (both were 20px).

### W11-8 — MED — The last-administrator check takes no lock — FLAGGED

**Read from code, not driven:** `assert_not_last_administrator` counts active administrators with a plain read, then lets the change proceed.

Two requests that each remove a different administrator's access can both count two and both proceed. That leaves the department with none. The requests can be:

- two officers at once;
- a script;
- the old `Promise.all` in Manage Members, which W11-4 closed for that page.

This is the read-then-write shape of CLAUDE.md pitfall 27.
**Why flagged:** the fix is a locking read over the organization's administrators on every path that can remove one:

- position changes;
- status changes;
- archive;
- delete.

That touches the authorization core, so it is recorded rather than changed in a review pass. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W11-9 — LOW — A member's base Member position can be removed like any other — FLAGGED

**Did:** opened the "×" on Ian Two's Member position, then backed out.
**Saw:** "Remove Member from Ian Two?", with nothing about the consequence. Nothing on the server stops it.

The Member position carries the 16 baseline grants every member needs: `members.view`, `training.view`, `scheduling.view`, `inventory.view` and so on. Removing it leaves a member who can sign in and see almost nothing.
**Why flagged:** whether the base position may be removed, and whether it should be refused or only warned about, is a permissions decision. Mirrored to `docs/KNOWN_LIMITATIONS.md`. The W05 lead is closed by this entry.
**Owner decision (2026-10-05) — fixed:** refuse unless the member is archived. Both write paths (`DELETE /users/{id}/roles/{role_id}` and the replace-all `PUT /users/{id}/roles` the admin screens use) answer `400` when the base `member` position would come off a member who is not archived. Manage Roles no longer offers the "×" on it, and its box stays ticked and locked in both role dialogs; an archived member's can still be removed.

Seen and left:

- **"Member profile viewed" dominates the history.** It made up 38 of Casey's 41 entries under All Events, because every officer visit is audited. That is deliberate for PHI access, and the filters isolate the changes.
- **The raw status value `leave`** appears in the edit page's header ("Status: leave"). The profile shows the same value, capitalised by CSS.

## Checklist

| Section                 | Result                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| 1. The job gets done    | ✅ edit → clear → status → type → history; W11-1 fixed                   |
| 2. The right people     | ✅ `member2` refused on page and API; W11-8 and W11-9 flagged            |
| 3. Wrong input, failure | ✅ after W11-1, W11-3, W11-4, W11-5                                      |
| 4. Browser signals      | ✅ only the provoked `422` before the fix                                |
| 5. Coming back to it    | ✅ every change survived a reload and is in the history, now with a time |
| 6. On a phone           | ✅ after W11-7                                                           |
| 7. Everyone can use it  | ✅ after W11-2                                                           |
| 8. What happens around  | ✅ each change audited under the right filter; reset confirmed (W11-3)   |

## Completion gate

| Check                    | Result                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                                                                                                                                                                |
| npm run lint             | ✅ clean (after one `only-throw-error` in a new test was fixed)                                                                                                                                                                                         |
| flake8 (changed files)   | n/a — no Python changed                                                                                                                                                                                                                                 |
| black --check            | n/a                                                                                                                                                                                                                                                     |
| frontend tests (touched) | ✅ full suite: 604 files, 8,212 tests. An earlier full run, which overlapped a concurrent run while a test file was being edited, reported 3 failures that were not captured by name; the clean re-run found none. Every new case failed before its fix |
| backend tests (touched)  | n/a                                                                                                                                                                                                                                                     |

## Second pass — editing a member after the forms and step-up changes (2026-11-16)

**Driven:** 2026-11-16 · **As:** `admin`, with `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `4c0fe2b` plus this pass's fixes · **Database:** continued from the W10 second pass; no reset

The owner asked to continue with W11. Since the first pass:

- the edit page saves with a field error flagged rather than refusing the whole save (owner decision 2026-11-05);
- a change to a member's rank or positions asks the officer to confirm it's them;
- the base Member position can't be removed from a current member (W11-9, owner decision 2026-10-05);
- the last-administrator check now takes a locking read (`assert_not_last_administrator`, W11-8).

### What was driven

All on Reese Varga, imported in W09.

1. As `admin`, Members Administration → Edit:
   - set the middle name and membership number, cleared the phone, set the rank;
   - added an emergency contact with a name, relationship and phone but no email;
   - saved, cancelled "Confirm it's you", saved again and confirmed.
2. From the profile, Change status → Leave with a reason. Later, tried Leave → Probationary.
3. View History, then each change below in turn.
4. Members Administration:
   - Reset Password, first with `Abcdefgh1234!`, then a valid password;
   - Manage positions: added Historian (with step-up), then removed it with its "×";
   - `DELETE` of the base Member position through the API.
5. As `member2`: the edit page, `PATCH /profile`, `PATCH /status`, `GET /audit-history`, `POST /reset-password`.
6. The edit page and the history page at 390×844.
7. Put Reese back to probationary.

### Held up ✅

- **Every edit was stored:** middle name, membership number and rank. The phone cleared to `null`, and the contact saved with `email: null` (W11-1 holds).
- **Step-up:** a rank change asks "Confirm it's you". Cancelling keeps every edit on the page, and confirming saves them.
- **Reset Password:** the weak password is held at the field with the rule list, and nothing is sent. The valid one is confirmed ("Password reset for Reese Varga").
- **Positions:**
  - Historian was added after step-up and removed with "×". The confirmation names it ("Remove Historian from Reese Varga?").
  - The base Member position offers no "×" and is locked in the dialog. The API refuses its removal: "The Member position carries the baseline access every member needs, so it can only be removed from an archived member."
- **The history** shows each change with date and time in the department's timezone (W11-6 holds).
- **`member2` is refused** on the page and on every endpoint (`403`).
- **Phone:** no sideways scroll on either page. The two checkboxes sit inside full-width labels, and the only control under 44px is the exempt inline "Set it up now" link.

### W11-10 — LOW — Cancelling "Confirm it's you" told an administrator they had no permission — ✅ FIXED

**Saw:** after cancelling the step-up prompt on Save Changes: "You do not have permission to update this member. Contact an administrator." The officer is an administrator, and they had only declined to confirm.
**Where:** `MemberAdminEditPage.tsx`. Every 403 was read as a missing permission, including the server's `LB-AUTH-013` step-up refusal, which the API client passes on when the prompt is cancelled.
**Fix:** that refusal now reads "Not saved: the confirmation was cancelled. Your changes are still here; save again to confirm it's you." A real permission refusal still reads as one. Re-driven.
**Test:** `MemberAdminEditPage.test.tsx`. The new case failed before the fix; the permission case is the control.

### W11-11 — LOW — The history printed stored field names and statuses — ✅ FIXED

**Saw:** "Member profile updated: middle_name, phone, membership_number, rank, emergency_contacts" and "Status changed: probationary → leave".
**Where:** `get_member_audit_history` (`backend/app/api/v1/endpoints/users.py`).
**Fix:** the history reads "middle name, phone, membership number, rank, emergency contacts" and "Probationary → Leave" ("Dropped voluntary", not `dropped_voluntary`). Re-driven.
**Test:** `tests/test_member_audit_history_wording.py`, whose two cases failed before the fix.

### W11-12 — LOW — Reset Password and Add Member showed the password rules' state only as ✓ / ○ — ✅ FIXED

**Saw:** each rule in both checklists began with a bare ✓ or ○. A screen reader reads "check mark" or "white circle", or skips it. W03-10 had fixed the same thing on the reset page and in My Account.
**Fix:** the mark is hidden from assistive technology, and each rule starts with a visually hidden "Met:" or "Not met:".
**Test:** `MembersAdminPage.test.tsx` and `AddMember.test.tsx`. The Reset Password test asserted the visible "○ No runs…" string; it now asserts the state text, as the Add Member test does. Both failed before the fix.

### W11-13 — LOW — Every position change in the history read "All roles replaced" — ✅ FIXED

**Saw:** adding Historian and removing it were both listed as "All roles replaced". The admin screens change positions through the replace-all `PUT /users/{id}/roles`, whose audit row kept only the resulting position ids, so the history could not say what had changed.
**Fix:** the row now records the names added and removed, and the history reads "Positions changed: added Historian" / "Positions changed: removed Historian". Rows written before this keep their old wording. Re-driven.
**Test:**

- `tests/test_users_delete_endpoint.py`: a new case asserts the names in the audit row. Two existing cases gained a `name` on their stand-in positions, which every real position has; their assertions are unchanged.
- `tests/test_member_audit_history_wording.py`: the new wording, and the old wording for an old row.

The new cases failed before the fix.

### W11-14 — LOW — The status dialog offered changes the server refuses — ✅ FIXED

**Did:** with Reese on leave, chose Probationary.
**Saw:** the dialog offered all eight statuses. The server answered `400`: "Cannot change status from 'leave' to 'probationary'. Allowed: active, dropped_involuntary, …".
**Where:** the profile's Change Member Status dialog (`MemberProfilePage.tsx`) listed every status. The lifecycle rules live in `ALLOWED_STATUS_TRANSITIONS` (`member_status.py`).
**Fix:** `GET /users/{id}/status-change` now also returns `allowed_next_statuses`, read from that same table. This is an added field, and nothing existing changes. The dialog reads it on opening and lists the current status plus those. If the read fails, it offers every status as before. Re-driven: for a member on leave the list no longer has Probationary.
**Test:** `tests/test_status_change_allowed_next.py` (every status matches the table) and `MemberProfilePage.test.tsx`. Both failed before the fix.

Seen and left:

- **The server's refusal lists raw values** ("Allowed: active, dropped_involuntary, …"). The dialog no longer leads there, so it is now reached only through the API.
- **A new emergency contact is not primary until ticked.** The edit page has a "Primary contact" checkbox, and nothing in the app reads the flag for a member's contacts.

### Checklist

| Section                 | Result                                                               |
| ----------------------- | -------------------------------------------------------------------- |
| 1. The job gets done    | ✅ edit → clear → step-up → status → positions → reset → history     |
| 2. The right people     | ✅ `member2` refused on page and API; base Member position protected |
| 3. Wrong input, failure | ✅ after W11-10 and W11-14                                           |
| 4. Browser signals      | ✅ only the provoked `403`s (step-up) and the `400` behind W11-14    |
| 5. Coming back to it    | ✅ every change stored and in the history, after W11-11 and W11-13   |
| 6. On a phone           | ✅ clean                                                             |
| 7. Everyone can use it  | ✅ after W11-12                                                      |
| 8. What happens around  | ✅ each change audited with its fields and positions named           |
