# Workflow Review — Membership module re-check (W08, W10–W15)

**Driven:** 2026-10-31 · **As:** `admin`, `member`, `member2` · **Viewports:** 1280×900, 390×844
**Commit:** `bd965ea` · **Database:** fresh (`start.sh` + `seed.mjs` in a new container)

A re-run of the Members activities after the rotation finished, to confirm the
module still works end to end. Prefix `MR-` (membership re-check), so these ids
do not collide with the original W08–W15 findings.

---

## What was driven

1. As `member`, opened `/members` from the navigation; opened a colleague's
   profile (`member2`) and their own; called `GET /users`,
   `GET /users/{id}/with-roles` for the colleague, then `PATCH /users/{id}/profile`
   on the colleague, `PATCH` their own rank, `DELETE /users/{id}` and `POST /users`.
2. As `member`, opened every admin route directly: `/members/admin`, `/edit/:id`,
   `/waivers`, `/id-cards`, `/check-in-station`, `/scan`, `/print-id-cards`,
   `/admin/settings/ranks`.
3. As `admin`, added Rowan Quill through **Add & Import → Add Member** with every
   required field, an emergency contact and an initial password, and pressed
   **Save Member** twice quickly.
4. As `admin`, on `/members/admin/edit/:id`: cleared date of birth, phone and
   street; set rank, then class **Administrative** and status **Regular**; saved;
   read the record back through the API and from the roster's class and
   membership-status filters, and the search box.
5. As `admin`, opened the audit history, all five settings sections, waivers,
   ID-card admin, the member's ID card, training history, scan, check-in station,
   both print pages, and the three legacy redirects.
6. As `admin`, created a waiver for `member2` — first with an end date before the
   start date, then valid (1 Nov – 15 Dec 2026) — and read it from the admin's
   Active Waivers list and from `member2`'s own profile.
7. As `admin`, deactivated Logan Kim from the roster (including the step-up
   password prompt), then reloaded as `admin` and as `member`.
8. At 390×844, as `admin` and `member`: directory, profile, edit, add, waivers,
   settings, and the remove-member dialog.

**Not driven:** CSV import (W09), departure clearance / archive / reinstate
(W15), and the NFC check-in station with the integration **on** (W14, W44). The
integration is off in the seed, so only the "turned off" state was seen.

## Held up ✅

- **Access control.** Every admin route showed "Access Denied" with a way back
  to the dashboard for `member`. The API refused each mutation with 403; the
  rank change came back with a message saying who may make it.
- **Privacy.** A colleague's profile showed "No contact details shared", and
  `GET /users/{id}/with-roles` returned null email, phone, mobile, date of
  birth, address and emergency contacts. `GET /users` was redacted the same way.
- **Add member.** One record (`rowan_quill`) after two quick clicks: the button
  disabled itself after the first. Date of birth, address, phone, class
  (operational), status (probationary) and the emergency contact were all saved.
- **Clearing a field saves the clear** (pitfall 1). Date of birth and phone came
  back `null` after a reload.
- **Administrative class clears rank.** The rank control is disabled with a
  hint, by design (`MemberAdminEditPage.tsx:699`).
- **Roster filters.** Class **Administrative** and search "quill" each found the
  edited member. **Probationary** found no one once the member was moved to
  Regular.
- **Audit history** recorded `Member profile updated: member_class,
member_status, phone, date_of_birth, address_street`.
- **Waiver validation.** "End date must be after start date" was shown inline.
  The valid waiver reported "Waiver created for Alex Brooks", and `member2` saw
  it on their profile.
- **Deactivation** asked for the admin's password, then retried. The member
  left the roster for both roles, and the stat tiles dropped from 21 to 20.
- **Every screen in steps 2, 5 and 8 loaded with no console error, page error
  or failed API call** apart from MR-2, and showed no `undefined`, `NaN`,
  `Invalid Date` or `[object Object]`.
- **Phone.** No sideways overflow on any screen (`scrollWidth` 15px under the
  viewport). The remove-member dialog fit the screen and its buttons were 44px
  tall.

## Findings

### MR-1 — MED — A member's profile calls every leave "Active", including future and expired ones — ✅ FIXED

**Did:** as `admin`, created a medical waiver for `member2` from 1 Nov to
15 Dec 2026, on 31 Oct. Then, as `member2`, opened their own profile.
**Saw:** the profile's Leave of Absence card said **Active**. The admin's
Waivers → Active Waivers list (correctly) said "No active waivers".
**Expected:** the profile and the Waivers screen give the same status.
`?active_only=true` on `/users/{id}/leaves-of-absence` drops only _cancelled_
leaves, so a leave that ended years ago was also shown as Active on the
profile, permanently.
**Where:** `frontend/src/pages/MemberProfilePage.tsx` (the leave card).
**Fix:** the Waivers page's own status rule (`getStatusBadge`) moved, unchanged,
to `utils/waiverStatus.ts` as `getWaiverStatusBadge`. Both screens now call it
(pitfall #29), with today taken in the organization's timezone. The profile
shows Future / Active / Expired / Permanent. Tests:
`MemberProfilePage.test.tsx` "labels each leave by its dates…" (seen to fail
before the fix) and `utils/waiverStatus.test.ts`, which covers the boundary
days. Re-driven: `member2`'s profile now reads **Future**.

### MR-2 — LOW — The member directory sends a request every member is refused — ✅ FIXED

**Did:** as `member`, opened `/members`.
**Saw:** `GET /users/membership-tiers/config` → **403** on every load. That
endpoint requires `members.manage`.
**Expected:** no request that can only be refused (checklist §4).
**Where:** `frontend/src/pages/Members.tsx` → `hooks/useMembershipTierOptions.ts`.
**Fix:** the hook takes `enabled` (default `true`, so its other three callers
are unchanged), and the directory passes `canManageMembers`. The result for a
member is the same empty ladder they got after the 403. Tests: two in
`Members.test.tsx`. The member case was seen to fail before the fix. Re-driven:
`events` empty.

### MR-3 — LOW — Members see the built-in tier names, not the department's — FLAGGED

**Saw:** the directory's Membership Status filter shows the admin
"Active Member / Life Member / Senior Member" (the department's tier names), and
shows `member` "Regular / Life" with no Senior. The profile likewise says
"Regular member" to everyone.
**Why flagged:** the tier config is behind `members.manage`. Showing members the
department's names needs either a read-only, member-visible tier-label endpoint
or a decision that the ladder is not member-facing. Mirrored to
`KNOWN_LIMITATIONS.md`.

### MR-4 — LOW — Profile views dominate the default audit history — FLAGGED

**Saw:** on `/members/admin/history/:id`, "All Events" listed about ten "Member
profile viewed" entries for every edit. The edit itself was easy to miss. None
of the filters (Profile Updates, Status Changes, …) hide views.
**Why flagged:** view logging is HIPAA access logging and must stay. Whether the
default filter should exclude views, or a "Views" filter should be added, is a
product choice.

### MR-5 — NIT — Cleared text fields on the admin edit page are saved as `''`, not `null` — ✅ FIXED (2026-11-01)

**Saw:** clearing the street saved `address_street: ""`. The date fields saved
`null`, because they use `blankToNull`. The text fields (`phone`,
`personal_email`, address, station, platoon) sent `form.x` as is. Phone came
back `null` only because the backend normalizes it.
**Impact:** none visible, since an empty string renders as absent. It was still
the inconsistency pitfall 1 describes, and an `IS NULL` check for "no station"
would miss an emptied one.
**Checked first:** each of the twelve columns is `Mapped[Optional[...]]` on
`User`. None is in `UserUpdate.null_refused`. The profile handler writes them
through its allowlist with `setattr`. The phone validator treats null as a
clear, and the membership-number uniqueness check skips a blank. Rank is left
as it was, because `_canonical_rank_or_400` already turns `''` into `null` on
the server.
**Fix:** `MemberAdminEditPage` sends the twelve optional text fields (middle
name, personal email, membership number, station, platoon, phone, mobile, and
the five address fields) through `blankToNull`. That also trims a value that is
kept. `UserProfileUpdate` allows `null` on the six of those it did not already
allow. Tests: `MemberAdminEditPage.test.tsx` "clearing a text field" (two
tests, seen to fail before the fix). Re-driven: street, city, platoon and
personal email emptied on the edit page came back `null`.

### MR-6 — NIT — The digital ID card shows the raw account status — ✅ FIXED (2026-11-01)

**Saw:** `/members/:id/id-card` showed the badge text `active` in lower case, and
would have shown `leave` rather than "On Leave". No shared account-status label
map existed.
**Fix:** `USER_STATUS_LABELS` and `userStatusLabel()` sit beside `UserStatus` in
`constants/enums.ts`, using the roster's wording ("On Leave", "Dropped
(voluntary)"). The ID card uses them. The existing ID-card test asserted the
lowercase `active`, so its expectation was the defect and was rewritten in the
same commit, which says so. A second test covers `leave` → "On Leave". Both
were seen to fail before the fix. Re-driven: the card reads **Active**.

### MR-7 — NIT — `useMembershipStore` has no consumer — FLAGGED

Read from code. `modules/membership/store/membershipStore.ts` (186 lines plus a
351-line test) is exported from the module barrel but imported by no page. The
roster and directory load their own data in `pages/Members.tsx`. It is dead
code, but removing a barrel export is a public-surface change, so it is left
for the owner.

## Checklist

| Section                | Result                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1. Job gets done       | ✅ add, edit, clear, waiver, deactivate. Results checked from the other role and through the API, not from toasts      |
| 2. Right people        | ✅ routes and API refuse `member`; contact data redacted                                                               |
| 3. Wrong input         | ✅ required fields, waiver dates, double submit; MR-5 fixed                                                            |
| 4. Browser reported    | ✅ after MR-2; the step-up 403 is the designed re-auth prompt                                                          |
| 5. Coming back         | ✅ reload and deep links to profile, edit and history; the legacy redirects land correctly                             |
| 6. Phone               | ✅ no overflow; dialog reachable; 44px buttons                                                                         |
| 7. Everyone can use it | Partly checked. Every add/edit/waiver input has a `<label for>`. A full keyboard and screen-reader pass was not driven |

## Gate

- `npm run typecheck`: clean.
- `npm run lint`: 0 errors and 0 warnings in the changed files. It ran out of
  memory at Node's default 2 GB heap while the harness's backend, Vite and
  Chromium were also running, so it was run with
  `NODE_OPTIONS=--max-old-space-size=6144`. That is an environment limit, not a
  lint result.
- Vitest: `MemberProfilePage`, `Members`, `WaiverManagementPage` (both files),
  `AddMember`, `MemberAdminEditPage`, the scheduling components that use the
  tier hook, and `waiverStatus` all pass (19 files, 241 tests, plus the new
  ones).
- No backend file changed, so flake8 and black do not apply.
