# Workflow Review — W08 Add a Member, and Their First Sign-in

**Driven:** 2026-09-28 · **As:** `admin`, the new member, `member2` · **Viewports:** 1280×900, 390×844
**Commit:** `9a4e208` plus this run's fixes (re-driven) · **Database:** continued from W07; no reset

---

## What was driven

1. As `admin`, from Members Administration → Add Member:
   - Submitted the form empty.
   - Filled it in with Status "On Leave", Preferred Contact "Email" and a password containing a run (`Abcdefgh1234!`).
   - Replaced the password with a valid one and saved.
2. Read the new member's record through the API.
3. As the new member, in a fresh browser:
   - Signed in with the set password and changed it when told to.
   - Signed in again with the new password.
4. At 390×844, as `admin`:
   - Added a second member whose email shares the first one's local part (`casey.newhire@other.org`).
   - After the fixes, did it again, starting with a weak password.
5. As `member2`:
   - Looked both new members up in the directory.
   - Opened the Add Member tab.
   - Tried `POST /users` through the API.
6. As `admin`, read the audit log.

Not driven: adding a member **without** a password. Email is off in the review install, so the form requires one and says why. The welcome-email path waits for an install with email.

## Held up ✅

- **Empty submit** marked 13 required fields and sent nothing.
- **Everything the form sends was stored**:
  - name and membership number;
  - phone and address;
  - probationary operational status;
  - the emergency contact;
  - the base Member position.
- **With email off**, the password is required and the form explains why.
- **First sign-in works end to end:**
  - The set password signs in.
  - The member is held on "Password change required" with every rule listed.
  - The change signs them out.
  - The new password lands on the dashboard with no failed request.
- **Both new members appear in `member2`'s directory.**
- **`member2` is refused** the Add Member tab ("Access Denied") and `POST /users` (`403`).
- **Every create is audited** (`user_created`, actor `review_admin`, with the username).
- **At 390px:** no sideways scroll. The one small control is fixed below (W08-5).

## Findings

### W08-1 — MED — Status and Preferred Contact were offered, and neither was saved — FLAGGED (controls removed)

**Did:** added a member with Status "On Leave" and Preferred Contact "Email".
**Saw:** the member was created `active`, and the record has no preferred contact at all. The payload never carried either value, and `AdminUserCreate` has no field for them.
**Why removed:** a control wired to nothing lets an officer believe a member is on leave when the system says otherwise (CLAUDE.md pitfall 19). Removing it loses nothing, since nothing was ever stored.
**Why flagged:** whether a member can be _created_ inactive or on leave, and whether preferred contact is recorded at all, needs a decision. Either means a new field on the create endpoint, and preferred contact also a new column. Mirrored to `docs/KNOWN_LIMITATIONS.md`.
**Test:** `AddMember.test.tsx`.

### W08-2 — MED — A second member whose email shared a local part could not be added — ✅ FIXED

**Did:** added `casey.newhire@other.org` after `casey.newhire@example.org`.
**Saw:** "Username already exists" (`400`). The form has no username field; it derives one from the part of the email before the @. The officer could not add this member at all, and the message named something they never saw.
**Where:** `AddMember.tsx`, `handleSubmit`.
**Fix:** on exactly that refusal, the form tries the next free suffix (`casey_newhire_2`, up to 20 attempts). Any other error still stops and shows. Re-driven: the second member was created as `casey_newhire_2`, and the one `400` in the events is the expected first attempt.
**Test:** `AddMember.test.tsx`.

### W08-3 — LOW — 28 fields had no programmatic label — ✅ FIXED

**Saw:** every text field and select except Membership Type and Rank was unnamed, including the password fields. This confirms the W08 lead.
**Fix:** each label has `htmlFor` and each control an `id`. Re-driven: no unnamed fields.
**Test:** `AddMember.test.tsx`. The existing test file's comment, which said the labels were not associated, was corrected.

### W08-4 — LOW — The initial password was checked only for length — ✅ FIXED

**Did:** entered `Abcdefgh1234!`.
**Saw:** the form sent it. The server refused it ("cannot contain sequential characters"), and the reason appeared only in a toast.
**Fix:** the form uses the shared `validatePasswordStrength`, lists the rules as the password is typed (W03-4's `PASSWORD_CHECKLIST`), and refuses at the field. Re-driven: "Password does not meet every rule listed below", with "No runs like 123 or abc" unticked, and nothing sent.
**Test:** `AddMember.test.tsx`.

### W08-5 — NIT — Two small controls — ✅ FIXED

- "← Back to Members" was 20px tall at 390px; it is now 44px on phones.
- The show-password button had no accessible name; it is now "Show password" / "Hide password".

### W08-6 — LOW — While a password change is required, the app fires 17 refused requests — OPEN

**Saw:** on the first sign-in, before the change, the page made 17 requests that each got `403`. The server blocks everything but the password change until it is made. The requests:

- the module list;
- unread notifications;
- push configuration;
- integrations;
- ranks;
- the member's own profile, four times;
- `POST /errors/log`, six times.

That last one means errors from this state cannot be reported. Nothing on the page broke.
**Why not fixed here:** the requests come from the app shell and half a dozen shared hooks. Quieting them means one rule — make no data request while `must_change_password` is set — applied across the shell, not a change to this form. Added as a lead.

## Checklist

| Section                 | Result                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| 1. The job gets done    | ✅ add → record → first sign-in → forced change → dashboard; W08-2 fixed |
| 2. The right people     | ✅ a member is refused on page and API                                   |
| 3. Wrong input, failure | ✅ required fields named; W08-4 fixed; W08-1 flagged                     |
| 4. Browser signals      | W08-6 open; otherwise only the provoked `400`s                           |
| 5. Coming back to it    | ✅ the new member is in the directory for others                         |
| 6. On a phone           | ✅ after W08-5                                                           |
| 7. Everyone can use it  | ✅ after W08-3 and W08-5                                                 |
| 8. What happens around  | ✅ creates audited; with email off, nothing claims an email was sent     |

## Completion gate

| Check                    | Result                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| npm run typecheck        | ✅ clean                                                                       |
| npm run lint             | ✅ clean                                                                       |
| flake8 (changed files)   | n/a — no Python changed                                                        |
| black --check            | n/a                                                                            |
| frontend tests (touched) | ✅ full suite: 604 files, 8199 tests; the four new cases failed before the fix |
| backend tests (touched)  | n/a                                                                            |
