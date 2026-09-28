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
