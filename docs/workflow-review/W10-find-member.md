# Workflow Review — W10 Find a Member and Read Their Profile

**Driven:** 2026-09-28 · **As:** `member`, `member2`, `admin` · **Viewports:** 1280×900, 390×844
**Commit:** `b3506ef` plus this run's fixes (re-driven) · **Database:** continued from W09; no reset

---

## What was driven

1. As `member`, from the menu (Members):
   - Searched by name, by membership number, and by email (in full and in part).
   - Searched for a name that doesn't exist.
2. Opened a colleague's profile (Imogen One) and their ID card.
3. As `admin`, turned the department's contact-visibility ceiling on for work email and phone, through the API; its settings screen is W12. Then, as `member`:
   - Searched by email.
   - Opened a colleague's profile with contact details.
4. As `member2`, My Account → Privacy: turned Work email off for other members and reloaded. Checked the result:
   - as `member`, in the browser and through the API;
   - as `admin`.
5. Put back `member2`'s choice and the department ceiling (off, as the install had it).
6. Directory and profile at 390×844 as `member`.

## Held up ✅

- **Search works on name and membership number, and finds nothing on hidden data.**
  - With work email hidden, searching an existing member's email returns "No Members Found". A member cannot confirm a hidden address by searching for it.
  - The username is searchable only by those who can see it; read from code, and covered by the existing tests.
- **A colleague's profile shows only what a member may see:**
  - name, rank, member type, platoon, member since;
  - "No contact details shared" while the department ceiling is off;
  - no raw dates or broken text.
- **The department ceiling works:** with work email and phone on, the colleague's email and phone appeared on the profile, and email search matched.
- **A member's own choice beats the ceiling for everyone but leadership:**
  - With `member2`'s work email set to "Only you and leadership", `member` saw "No contact details shared", and the API returned `email: null` to `member`.
  - `admin` saw the address, marked "Only you and leadership".
  - The choice survived a reload.
- **The ID card of a colleague** opens for `members.view`, as its code comment documents (see the lead below).
- **At 390px:** no sideways scroll.

## Findings

### W10-1 — LOW — Opening a colleague's profile fired two refused requests — ✅ FIXED

**Did:** as `member`, opened Imogen One's profile.
**Saw:** `403` twice on `GET /users/{id}/leaves-of-absence`. The endpoint serves a member's own leaves, or anyone's to `members.manage`. The page asked regardless, on every colleague's profile. Nothing on screen broke.
**Where:** `MemberProfilePage.tsx`, the load effect. The same file already gates training, admin hours and inventory by exactly this pattern.
**Fix:** leaves are fetched only for yourself or with `members.manage`. Re-driven: the same profile made no failed request.
**Test:** `MemberProfilePage.test.tsx` (three cases).

### W10-2 — LOW — The search box promised an email search that could not match — ✅ FIXED

**Saw:** "Search by name, membership number, or email..." while every email in the directory was hidden, so an email search always returned "No Members Found".
**Fix:** the placeholder and accessible name mention email only when some email is visible. Re-driven: "Search by name or membership number..." with the ceiling off, and the email wording with it on.
**Test:** `Members.test.tsx`.

### W10-3 — NIT — Tap targets at 390px — ✅ FIXED

- Each member's name in the directory was 24px tall; it is now 44px on phones.
- On the profile, "← Back to Members" (20px) and "ID Card" (30px) are now 44px on phones.

Seen and left:

- **The profile's Mobile visibility switch reads "on"** while its label says "Off for everyone (department setting)". This is deliberate: `VisibilityControl` records the member's own choice for when the department turns the field back on, and says so.

## Leads for later activities

- **Kiosk and check-in activities** — the ID card's QR code is unsigned JSON (`{type, id, membership_number, org}`). The member id appears in any profile URL. Anything that trusts a scanned code as proof of identity (a kiosk checkout, a check-in station) can be fed a code for any member. Whether the scanners treat it as identity or only as a lookup should be checked where they are driven.

## Checklist

| Section                 | Result                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| 1. The job gets done    | ✅ search → profile → ID card                                       |
| 2. The right people     | ✅ ceiling and member choice both honoured, in the page and the API |
| 3. Wrong input, failure | ✅ an unmatched search says "No Members Found"                      |
| 4. Browser signals      | ✅ after W10-1                                                      |
| 5. Coming back to it    | ✅ privacy choice survives a reload; profile URLs are deep-linkable |
| 6. On a phone           | ✅ after W10-3                                                      |
| 7. Everyone can use it  | ✅ search and visibility switches named; W10-2                      |
| 8. What happens around  | ✅ dates in local format; no raw timestamps                         |

## Completion gate

| Check                    | Result                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                  |
| npm run lint             | ✅ clean                                                                  |
| flake8 (changed files)   | n/a — no Python changed                                                   |
| black --check            | n/a                                                                       |
| frontend tests (touched) | ✅ full suite: 604 files, 8203 tests; the new cases failed before the fix |
| backend tests (touched)  | n/a                                                                       |

## Second pass — the directory and profile after the November changes (2026-11-16)

**Driven:** 2026-11-16 · **As:** `member`, `member2`, `admin` · **Viewports:** 1280×900, 390×844
**Commit:** `15d61fa` plus this pass's fix · **Database:** continued from the W09 second pass; no reset

The owner asked to continue with W10. Since the first pass and the 2026-10-31 membership re-check:

- the roster is a table again on desktop and reflows to cards when narrow;
- profiles carry service history, position history, "Reports To", shift and call history, and leave.

### What was driven

1. As `member`, from the menu (Members):
   - read the stat tiles and filtered by status;
   - searched by name, by membership number, by an email and by a name that doesn't exist.
2. Opened a colleague's profile (Quinn Harlow), then `member`'s own.
3. As `member`, through the API, read every by-member endpoint for the colleague and for themselves:
   - `with-roles`, `roles`, `supervisor`, `status-change`, `undo-drop`;
   - `service-history`, `leaves-of-absence`, `audit-history`, `consents`, `deletion-impact`, `passkeys`;
   - `member-badges` and the permissions lookup.
4. As `admin`, opened the colleague's profile.
5. As `admin`, turned the contact-visibility ceiling on for email and phone, through the API; its settings screen is W12. As `member2`, set work email to "Only you and leadership". Then:
   - as `member`, read `member2` and a colleague with a phone on file, in the browser and through the API, and searched by each one's email;
   - as `admin`, read `member2`.
6. Put back `member2`'s choice and the ceiling (off, as the install had it).
7. Directory, a colleague's profile and `member`'s own profile at 390×844.

### Held up ✅

- **The directory:** 25 members, and the Active tile and filter count probationary members as current (CLAUDE.md pitfall 32). Search found by name and membership number. With the ceiling off, it found nothing by email and the placeholder doesn't offer email (W10-2 holds).
- **A colleague's profile shows only what a member may see:** name, rank, class, membership status, platoon and positions. Contact details read "No contact details shared". The API returns no date of birth, address, phone or emergency contacts.
- **Every new by-member endpoint refuses a colleague's record to a member and serves their own:** `supervisor`, `service-history`, `leaves-of-absence` and `consents`. The rest refuse both, as before, and `member-badges` answers `404` for the colleague.
- **No failed request and no console error** on any profile, for `member` or `admin` (W10-1 holds). There were no broken values ("undefined", "NaN", raw timestamps) on either profile.
- **The ceiling and a member's own choice both hold:**
  - with the ceiling on, the colleague's email and phone appeared on the profile and email search found them;
  - `member2`'s hidden work email stayed hidden from `member` in the page, the API and search;
  - `admin` still saw it.
- **Phone:** no sideways scroll on the directory or either profile. The directory and a colleague's profile have no control under 44px.

### W10-4 — LOW — The member's own profile had small, identically named Edit buttons — ✅ FIXED

**Saw:** on `member`'s own profile at 390px:

- the Contact Information, Address and Emergency Contacts "Edit" buttons were 20px tall, and all three were named just "Edit";
- "View Full History" was 40px;
- the photo button covered only its 16px word of text. With a photo on file, that word reads "Change" while the button was named "Upload photo" (WCAG 2.5.3, label in name).

**Where:** `MemberProfilePage.tsx`, `ContactInfoSection.tsx`, `EmergencyContactsSection.tsx`, `TrainingSection.tsx`.
**Fix:**

- each Edit button names its section ("Edit contact information", "Edit address", "Edit emergency contacts"), as Service History's "Edit service history" already did, and is 44px on touch screens;
- "View Full History" is 44px on touch screens;
- the photo button fills the 80px avatar and is named "Upload photo" or "Change photo", as it reads.

Re-driven: the only control under 44px left is the inline "Manage what other members see" link, which sits in a sentence and is exempt.
**Test:** `MemberProfilePage.test.tsx`. Four tests that found these buttons by the exact name "Edit", and three that asserted no "Edit" button existed, now use the section names; the negative checks would otherwise pass vacuously. The manager test asserts each name and its touch size, and a new test covers the photo button's name. Both failed before the fix.

### Checklist

| Section                 | Result                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ search → profile                                                       |
| 2. The right people     | ✅ every new by-member endpoint gated; ceiling and member choice honoured |
| 3. Wrong input, failure | ✅ an unmatched search says "No Members Found"                            |
| 4. Browser signals      | ✅ no failed request or console error                                     |
| 5. Coming back to it    | ✅ profile URLs are deep-linkable                                         |
| 6. On a phone           | ✅ after W10-4                                                            |
| 7. Everyone can use it  | ✅ after W10-4                                                            |
| 8. What happens around  | ✅ no broken values                                                       |
