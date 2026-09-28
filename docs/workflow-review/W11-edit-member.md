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
