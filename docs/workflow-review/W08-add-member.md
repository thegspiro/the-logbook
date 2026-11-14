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
**Owner decision (2026-10-05) — fixed:** add status to the create endpoint as a new optional field. `AdminUserCreate.status` accepts `active` (the default), `inactive` or `leave`; statuses that end or suspend membership are refused, since the status change is what records them. Add Member offers those three again and sends the choice. Preferred contact stays unrecorded. Tests: `test_add_member_initial_status.py`, `AddMember.test.tsx`.

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

### W08-6 — LOW — While a password change is required, the app fires 17 refused requests — FIXED (2026-10-25)

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
**Fixed (2026-10-25):** that one rule now lives in the two axios clients rather than in the shell. `services/passwordChangeGate.ts` answers any request outside the server's allowlist (`_MUST_CHANGE_PW_ALLOWED_SUFFIXES`) with the server's own `403 LB-AUTH-004` without sending it, while the signed-in user has `must_change_password` set, and `reportApiError` does not report that refusal. Re-driven on a fresh member: 24 refused requests on `main` (nine of them `POST /errors/log`), 0 with the fix; the change itself, sign-out and sign-in with the new password then sent 57 requests, none refused. Not covered: an expired password past its grace period is still gated by the server only — its refusals are no longer reported, but they are still sent, because the client cannot see that state until a request is refused.

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

## Second pass — Add Member after the status, labels and forms changes (2026-11-09)

**Driven:** 2026-11-09 · **As:** `admin`, the new member, `member2` · **Viewports:** 1280×900, 390×844
**Commit:** `9ffc4fa` plus this pass's fixes · **Database:** continued from the W07 second pass; no reset

The owner asked to continue with W08. Since the first pass:

- the form takes a starting status again (W08-1, owner decision 2026-10-05);
- the first sign-in no longer fires refused requests (W08-6);
- the form reports errors per field with a summary (owner decision 2026-11-05);
- creating a member with a rank or position asks the officer to confirm it's them.

### What was driven

1. As `admin`, Members Administration → Add Member:
   - submitted the form empty;
   - filled it in with a run in the password (`Abcdefgh1234!`);
   - replaced the password and saved with:
     - Status On Leave;
     - class Operational, membership status Probationary;
     - rank Firefighter, position Safety Officer;
     - station, platoon and join date.
   - Confirmed the "Confirm it's you" prompt.
2. Read the new member's record through the API.
3. As the new member, in a fresh browser:
   - signed in while On Leave;
   - after `admin` set them Active from their profile, signed in again, changed the password when told to, and signed in with the new one.
4. As `member2`:
   - opened the Add Member tab;
   - tried `POST /users`;
   - looked the new member up in the directory.
5. Read the audit rows for all of it.
6. At 390×844, as `admin`, added a second member with no rank or position.

Not driven, as in the first pass: adding a member **without** a password. Email is off in the review install, so the form requires one and says why.

### Held up ✅

- **Empty submit:** 13 fields are flagged, each with its own message, and focus moves to the summary ("Fix these before saving"). Nothing is sent.
- **Weak password:** refused at the field ("Password does not meet every rule listed below"), and nothing is sent.
- **Step-up:** a create that grants a rank or position is refused once with `LB-AUTH-013`. The form opens "Confirm it's you" and completes the create once the password is confirmed.
- **Everything the form sends is stored:**
  - status `leave`;
  - class and membership status;
  - rank and station, platoon and join date;
  - phone and address;
  - the emergency contact;
  - Member plus Safety Officer.

  Members Management counts the member under On Leave.

- **First sign-in:** "Password change required", with every rule listed and no refused request (W08-6 holds). The change signs the member out "everywhere". The new password lands on the dashboard.
- **`member2`:** gets "Access Denied" on the tab and `403 LB-PERM-001` from the API, and sees the new member in the directory.
- **Audited, every row stamped with the department:**
  - `stepup_verified` and `user_created`, the latter with the positions granted;
  - the refused sign-in, as `login_failed` with reason `account_inactive`;
  - the status change;
  - the password change.
- **Phone:** no sideways scroll, and the member was added. The only control under 44px is the inline "Set it up now" link, which is exempt.

### W08-7 — LOW — The optional fields' examples read as entered values — ✅ FIXED

**Saw:** eight optional fields showed their placeholder in full-strength text, the same as a typed value:

- middle name ("Michael") and preferred name ("Terry");
- secondary phone;
- both emergency emails;
- the whole second emergency contact ("Bob Doe", "Parent").

An officer reading the form back would take them for data already entered. Every other field uses `form-input`'s faded placeholder.
**Where:** `AddMember.tsx`. The eight inputs added `placeholder-theme-text-muted` on top of `form-input` (CLAUDE.md pitfall 17).
**Fix:** the override is removed, so every text field on the form shares one placeholder style. Re-driven.
**Test:** `AddMember.test.tsx`, which failed before the fix.
**Lead:** 127 other uses of `placeholder-theme-text-muted` across the app; not swept here.

### W08-8 — LOW — The create audit did not record the starting status — ✅ FIXED

**Saw:** the member was created On Leave and refused at sign-in. The `user_created` row carried the id, username, email and positions, but no status, and no `member_status_changed` row exists for a starting status. Nothing in the audit log said why the member could not sign in.
**Where:** `create_member` (`backend/app/api/v1/endpoints/users.py`).
**Fix:** the row now carries `status`.
**Test:** `tests/test_add_member_initial_status.py`, whose new case failed before the fix (`KeyError: 'status'`).

### W08-9 — LOW — Nothing said that a member added On Leave cannot sign in — ✅ FIXED

**Saw:** sign-in admits only Active and Probationary members. The member added On Leave got "Account is inactive. Please contact an administrator." with the password the officer had just set and handed over. The Status field's help spoke only of retired and dropped members.
**Fix:** the help now starts "A member added Inactive or On Leave cannot sign in until their status is set to Active." Re-driven at 390px.
**Test:** `AddMember.test.tsx`, which failed before the fix.
**Not changed:** whether a member on leave should be able to sign in at all. The rule applies to every member set On Leave, not only new ones, so it is a product question beyond this form.

### W08-10 — NIT — "On Leave" on the form, "Leave" on the profile

Add Member and the Members Management tile say "On Leave". The profile header ("Status: Leave") and its Change Member Status dialog say "Leave".

### Checklist

| Section                 | Result                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ add (with step-up) → record → first sign-in → forced change → dashboard |
| 2. The right people     | ✅ `member2` refused on page and API                                       |
| 3. Wrong input, failure | ✅ per-field errors and summary; weak password held; W08-9 fixed           |
| 4. Browser signals      | ✅ only the provoked `403`s (step-up, inactive sign-in, `member2`)         |
| 5. Coming back to it    | ✅ the new member is in the directory and the On Leave count               |
| 6. On a phone           | ✅ clean                                                                   |
| 7. Everyone can use it  | ✅ after W08-7                                                             |
| 8. What happens around  | ✅ every step audited, after W08-8                                         |
