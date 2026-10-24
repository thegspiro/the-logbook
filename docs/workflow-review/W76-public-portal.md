# Workflow Review — W76 Public Portal and the Public Pages

**Driven:** 2026-10-21 · **As:** `admin`, and anonymous (a signed-out browser, and `curl` with an API key) · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-21 plus this run's changes · **Database:** continued from W75

---

## What was driven

1. Signed out: `/`, `/privacy` and `/terms`.
2. As `admin`, Public Portal (`/admin/public-portal`):
   - Enable Portal, double-clicked;
   - API Keys → Create API Key "Department website (W76)", Create
     double-clicked;
   - Data Control: the organization's name, phone, website and physical
     address; events' title, start, location and description; stats'
     members and stations;
   - Configuration: the default rate limit emptied, then 500 saved
     double-clicked;
   - Access Logs, filtered to 401, and a row's details; Statistics;
   - Revoke Key, double-clicked; Disable Portal, then Enable.
3. Anonymous, against `/api/public/v1/…`:
   - organization info, stats and public events, before and after fields
     were enabled;
   - with no key, an unknown key, the revoked key, and while the portal was
     disabled.
   - A public-education event and a members-only training were created for
     the events check.
4. At 390×844: every portal section, creating and revoking a key, disabling
   and re-enabling.

Not driven:

- an expiring key, and a rate limit actually reached;
- the bulk whitelist update (no control calls it);
- events whose location is a facility (`location_id`), since none exist here.

## Held up ✅

- **Public pages:** `/` sends a signed-out visitor to sign-in, named for the
  department; Privacy and Terms render signed out, each linking to the other
  and back to sign-in.
- **Fails closed:** with the portal on and a key issued but no fields
  enabled, every endpoint returned `{}` or `[]`.
- **Only enabled fields:**
  - organization info returned exactly name, phone and website;
  - the members-only training was not published, the public-education event
    was, with only its enabled fields;
  - stats returned 20 members, which matches the 20 active accounts.
- **Refusals:**
  - no key → 401 "API key required";
  - an unknown key → 401 "Invalid API key";
  - the revoked key → 401 "API key has been revoked", logged under the
    department;
  - portal disabled → 503 "Public portal is currently disabled".
- **Double-clicks:** enabling, creating a key and revoking each acted once.
- **Keys:** the key is shown once, with a copy button. A key with no override
  reads the default, and it followed the default from 1000 to 500.
- **Configuration:** an empty rate limit is refused with "Enter a whole number
  from 1 to 100,000."; 500 was saved and survived a reload.
- **Statistics:** the counts match the access log (7 requests, 3 endpoints).
- **At 390×844:** no sideways scroll; the section strip scrolls.

## Findings

### W76-1 — MED — Each Data Control switch moved the list under the pointer — ✅ FIXED

**Did:** in Data Control, switched on several fields one after another.
**Saw:** two of them landed on the wrong field. Phone and website were meant,
and the organization's physical address (PII) and stats' apparatus were
enabled instead. Every switch re-read the whitelist with `loading` set, so
the tab swapped the list for a spinner and back. That reopened every section
the admin had closed and moved the rows, so the next tap hit another field.
**Where:** `hooks/usePublicPortal.ts` `useDataWhitelist.toggleField` called
`fetchWhitelist()`, which raises the spinner.
**Fix:**

- The re-read after a toggle (and a bulk update) is now quiet. The list and
  the sections stay put; scroll held at 1825px across a switch when
  re-driven.
- A switch is disabled while its save is in flight.
- A failed toggle, already reported by toast, no longer escapes as an
  unhandled rejection.

`publicPortal.w76.test.tsx` "keeps the list and its sections in place".

### W76-2 — MED — The station's address was never published when it matched the mailing address — ✅ FIXED

**Did:** switched on the physical address. The department's profile has a
mailing address and "physical address same as mailing", the onboarding
default.
**Saw:** organization info returned no physical address at all.
**Where:** `app/api/public/portal.py` `get_organization_info` published the
physical columns only `if physical_address_line1 and not
physical_address_same`. A department using the default stores its address in
the mailing columns alone. Onboarding and the email templates both read the
mailing address as the physical one.
**Fix:** when the two are the same, the physical address is the mailing
address. It is still published only when the physical-address field is
enabled. Re-driven: `"physical_address":{"line1":"100 Main Street",…}`.
`tests/test_public_portal_physical_address.py` (the same-as-mailing case fails
without the fix; the separate-address and field-off cases pin the rest).

### W76-3 — LOW — Disable Portal cut every key off without asking — ✅ FIXED

**Saw:** one click set `enabled: false`, and the live key got 503. Revoking a
single key asks first; switching the portal off, which stops every key at
once, did not.
**Fix:** it now asks: "Disable the public portal?", which says every website
stops receiving data and that keys and field choices are kept, with the
buttons "Keep it running" and "Disable portal". Enabling still needs no
confirmation, since it exposes only fields already enabled.
The section buttons now carry `aria-current`.

### W76-4 — LOW — The access log hid why a request was refused, and overstated what it lists — ✅ FIXED

- A refusal records its reason ("Revoked API key") without being flagged
  suspicious. Details showed the reason only for flagged rows, so a 401
  explained nothing. It now shows as "Reason:" (or "Flag Reason:" when
  flagged).
- The header said "Every request to the public API, including rejected ones."
  A request with no key or an unknown key cannot be attributed to a
  department and is stored without one, by design. The text now says which
  refusals are listed and which are not.
- The five filter labels were not tied to their controls.
- Every row's button read "Details" and was 20px tall. It is now named for
  its request and time ("Show details of GET /api/public/v1/organization/info
  at …"), carries `aria-expanded`, and is 44px on a touch screen.

### W76-5 — LOW — Smaller defects — ✅ FIXED

- **Duplicate switch names.** Two switches both read "Enable description"
  (Events and Organization). They now carry the category ("Enable Events
  description"), and section headers carry `aria-expanded`.
- **Unnamed revoke buttons.** Every key's Revoke read just "Revoke" and was
  16–20px tall. They are now named for the key and are 44px on touch.
- **Placeholder host.** The new key's usage example said
  `https://your-domain.com/…`. It now uses this server's address, where the
  public API is served.

### W76-6 — LOW — Three statistics fields can be enabled but always publish null — FLAGGED

Data Control offers `stats.stations`, `stats.total_volunteer_hours` and
`stats.total_calls_ytd`. `get_organization_stats` hard-codes all three to
`null`. Driven: stations enabled, and `"stations":null` returned. Each needs a
definition the owner must choose. Mirrored to KNOWN_LIMITATIONS.

## Checklist

| Section                 | Result                                                                            |
| ----------------------- | --------------------------------------------------------------------------------- |
| 1. The job gets done    | ❌ → ✅ the station address never published; fixed                                |
| 2. The right people     | ✅ only enabled fields leave; keyless, unknown, revoked and disabled all refused  |
| 3. Wrong input, failure | ✅ empty rate limit refused with a reason; refusals logged with a reason          |
| 4. Browser signals      | ✅ clean (one page error from this run's own first edit, fixed before the commit) |
| 5. Coming back to it    | ✅ config, keys and fields read back after a reload and through the public API    |
| 6. On a phone           | ❌ → ✅ revoke and details buttons 16–20px; fixed                                 |
| 7. Everyone can use it  | ❌ → ✅ duplicate switch names, unnamed row buttons, untied labels                |
| 8. What happens around  | ❌ → ✅ switches moved the list and enabled the wrong fields; fixed               |

## Completion gate

| Check                    | Result                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                    |
| npm run lint             | ✅ clean                                                                                                    |
| flake8 (changed files)   | ✅ clean                                                                                                    |
| black --check            | ✅ clean                                                                                                    |
| frontend tests (touched) | ✅ `src/modules/public-portal` 58 passed; the new file's 6 fail without the fix                             |
| backend tests (touched)  | ✅ `-k "public_portal or portal"` 154 passed, 1 skipped (optional `pywebpush`), the new file's 3 among them |
