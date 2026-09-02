# Mobile — Quick Entry Review

**Reviewed:** 2026-09-01 · **Scope:** the whole application as used from a
phone, with the emphasis on _entering_ information rather than reading it.
**Method:** source inventory of every navigation surface, capture flow and
create schema, cross-checked against the mobile e2e ratchet
(`frontend/src/e2e/mobile-presentation.spec.ts`) and a Playwright pass at
390×844 against the dev server.
**Standard applied:** a member standing in an apparatus bay, one-handed, on a
phone, should be able to start any routine log entry without first knowing
which module owns it.

Severity is about consequence, not polish — the same grades
[SHIFT_SCHEDULING_UX_REVIEW.md](./SHIFT_SCHEDULING_UX_REVIEW.md) uses:

| Grade                 | Meaning                                                           |
| --------------------- | ----------------------------------------------------------------- |
| **Blocks work**       | Someone cannot finish the task on this screen.                    |
| **Invites mistakes**  | The screen is readable, but the obvious reading is the wrong one. |
| **Slows people down** | Clear enough once learned, more work than it needs to be.         |

**Nothing here blocks work.** That is the headline, and it changes what the
findings are worth: this is not a phone-support backlog, it is a list of taps
and round trips to remove.

---

## What is already right, and why it matters to the findings

Recording this first, because several findings below would otherwise read as
larger than they are.

- **The presentation layer is machine-enforced, not reviewed.**
  `mobile-presentation.spec.ts` asserts `maxSmallTargets: 0` and
  `maxTinyText: 0` on every listed route — no interactive element under 44×44,
  no ordinary text under 12px, no horizontal page scroll, no crash. It began as
  a real backlog (212 undersized targets, ~200 sub-12px nodes) and was
  ratcheted to zero. `mobile-route-inventory.ts` then forces every user-facing
  route to be classified `ratchet`, `workflow` or explicitly `exempt`, so a new
  page cannot quietly skip the pass.
- **The hard mobile-layout problems are solved centrally.** Safe-area insets,
  the on-screen keyboard (`useKeyboardInset`), the bottom bar painting over
  dialogs (`useOverlaySurface`), and dialog height capping
  (`modal-panel-scroll`, Pitfall #21) all have one owner each.
- **The field capture paths that exist are genuinely phone-first.** Equipment
  checks (`EquipmentCheckForm`, `CheckSweep`), QR clock-in and shift check-in,
  barcode and NFC scanning, and training self-report were all built for a
  phone, several with IndexedDB offline queues behind them.

So the gap is not that the app is hard to use on a phone. It is that **starting
an entry costs navigation**, which is what QE-1 is about.

---

## Findings

| ID    | Finding                                                    | Grade             | Status                |
| ----- | ---------------------------------------------------------- | ----------------- | --------------------- |
| QE-1  | No global quick-add; every capture flow costs 3–4 taps     | Slows people down | ✅ Fixed (2026-09-01) |
| QE-2  | The command palette is keyboard-only                       | Slows people down | Open                  |
| QE-3  | No image input opens the camera directly                   | Slows people down | Open                  |
| QE-4  | The generic offline queue covers two kinds of write        | Invites mistakes  | Open                  |
| QE-5  | Replay protection exists on one create schema out of many  | Invites mistakes  | Open                  |
| QE-6  | Field entries live in desktop modals inside detail tabs    | Slows people down | Open                  |
| QE-7  | The highest-volume mobile write echoes data it already has | Slows people down | Open                  |
| QE-8  | No unified "what do I need to do" endpoint                 | Slows people down | Open                  |
| QE-9  | The bottom-nav preference is read and written by nothing   | Slows people down | Open                  |
| QE-10 | Pull-to-refresh is opted into by seven pages               | Slows people down | Open                  |
| QE-11 | The PWA manifest declares no `share_target`                | Slows people down | Open                  |
| QE-12 | Four mobile utilities are defined and never used           | Dead code         | Open                  |

---

### QE-1 — Nothing in the app is one tap from "add" — ✅ Fixed (2026-09-01)

**Grade:** slows people down.

On a phone, every capture flow was reached the same way: tap **More**, wait for
the drawer, find the module, find the page, find its button. Four taps and two
page loads before the first field.

The bottom bar was five destinations and no action. Two surfaces could have
closed this and did not:

- `frontend/src/components/ux/FloatingActionButton.tsx` is a complete, correct
  speed-dial — nav-bar-aware bottom offset, backdrop, Escape, outside-click —
  used on **three pages, all inventory**
  (`InventoryItemsPage`, `WriteOffsPage`, `EquipmentRequestsPage`), and on two
  of those the action it offers is a **filter**, not a create.
- `frontend/src/components/ux/CommandPalette.tsx` is mounted globally by
  `AppLayout` and opens on `Cmd/Ctrl+K` only — see QE-2.

**The fix.** The centre of the phone bottom bar is now **Add**, opening a
permission- and module-gated sheet of the app's existing fast capture paths:
log training hours, start a rig check, add an action item, log a shift report,
clock in, check into a shift, scan a member ID, request equipment, create an
event, add a member. Two taps from anywhere.

Three decisions inside that are worth keeping:

- **It adds no forms of its own.** Every row lands on the screen that already
  owns that entry, so there is no second path for the data to drift down. That
  also means the sheet cannot fall behind a form's validation rules.
- **Configurable slots went from three to two, not the bar from five items to
  six.** Six items on a 390px phone is 65px each — above the touch minimum but
  visually crowded, and it would have pushed the action to an edge rather than
  under the thumb. A preference written before this shipped keeps its first two
  entries and is left intact on disk; the third destination is still under More.
- **The sheet is the shared `Modal`, not a new shell.** A 2026-08 sweep found
  99 hand-built dialog shells, of which 62 handled Escape and none trapped
  focus or locked scroll. `Modal` supplies all three through `useDialog`, plus
  the `useOverlaySurface` registration that hides the bottom bar — without
  which the bar, `fixed bottom-0 z-50` and painted after the page, covers the
  rows nearest the thumb and swallows their taps.

**Gate integrity is now enforced rather than reviewed.**
`frontend/src/navGateIntegrity.test.ts` already existed because a nav row, a
palette entry and a keyboard shortcut once shipped the same gate mistake at
once. Quick Add is the fourth such surface and gets the strongest form of that
check: because its entries are a typed export rather than literals inside a
component, every row is resolved against the **real route definition** — the
route must exist, the row's permissions must be a subset of what the route
accepts, and a route's `requiredModule` must be repeated on the row.

**Files:** `components/layout/quickAddActions.ts`,
`components/layout/QuickAddSheet.tsx`, `components/layout/BottomNavigation.tsx`,
`navGateIntegrity.test.ts`, `e2e/quick-add.spec.ts`.

---

### QE-2 — The command palette cannot be opened on a phone

**Grade:** slows people down.

`CommandPalette.tsx:317` binds `Cmd/Ctrl+K` and nothing else. There is no
on-screen trigger in `SideNavigation`, `TopNavigation` or `BottomNavigation` —
no search icon anywhere in the app shell. The palette is a complete, carefully
permission-gated global jump-to that a phone user cannot reach at all.

It is also navigation-only: every command is a `path`, so even reached, it
cannot start an action. Quick Add now covers the action half; the jump-to half
is still keyboard-only.

**Suggested fix:** a search affordance in the mobile header (`SideNavigation`'s
`md:hidden` bar already has the space beside the department name) dispatching
the same open. Cheap, and it makes an existing feature reachable by the
majority of sessions rather than building anything new.

---

### QE-3 — Photographing something is always one tap longer than it needs to be

**Grade:** slows people down.

Six file inputs accept images, and **none sets the `capture` attribute**:

```
modules/inventory/pages/EquipmentCheckForm.tsx
modules/inventory/pages/CheckItemControls.tsx      ← the defect-photo button
modules/storefront/components/ProductFormModal.tsx
modules/onboarding/pages/OrganizationSetup.tsx
pages/SettingsPage.tsx
pages/MemberProfilePage.tsx
```

Without it a phone opens the generic file chooser and the member must then pick
"Take Photo". With `capture="environment"` the rear camera opens directly.

`CheckItemControls.tsx` is the one that matters: it is the photo button on a
failed equipment-check item, taken with gloves on beside a truck, and it is the
app's most-used image input by a wide margin.

**Caveat worth stating rather than discovering:** `capture` forces a fresh
capture and removes the library as a source. That is right for a defect photo
and wrong for a profile picture or a product image, so this is a per-site
decision, not a sweep.

---

### QE-4 — The generic offline queue carries two kinds of write

**Grade:** invites mistakes.

`utils/genericOfflineQueue.ts:17` declares
`GenericQueueKind = 'training-submission' | 'event-rsvp'`. Equipment checks and
shift reports have their own queues (they carry photo blobs). Everything else
posts straight to the network.

So a member logging administrative hours, a fuel stop or a maintenance defect
from a bay with no signal gets an error toast and loses what they typed — on
exactly the screens, and in exactly the places, where the queues exist because
signal is known to be unreliable. The infrastructure is built and the retry,
purge-on-logout and sync-engine machinery all work; the kinds list is simply
short.

**Suggested fix:** extend `GenericQueueKind` and route the remaining plain-JSON
creates through `enqueueGeneric`. Read QE-5 first — queueing a write without
replay protection is how you get duplicates.

---

### QE-5 — One create schema has replay protection; the rest do not

**Grade:** invites mistakes.

`client_submission_id` appears exactly once in the whole schema layer:

```
backend/app/schemas/equipment_check.py:423   ShiftEquipmentCheckCreate
```

`StandaloneEquipmentCheckCreate` (`:426`) does not carry it, and neither does
any inventory, training, admin-hours or shift-report create. The changelog
records why it exists at all: an offline queue replaying after reconnect
created a duplicate check, and the fix was to mint the id **before the request
leaves the phone**.

That reasoning applies to every write a queue may replay, not to one of them.
It is filed as _invites mistakes_ rather than _slows people down_ because a
duplicated record looks like a correctly saved one.

---

### QE-6 — Field entries live in desktop modals inside detail tabs

**Grade:** slows people down.

Three routine at-the-truck entries are reachable only through a detail page's
tab, in a modal built for a desktop, asking for far more than the API requires:

| Entry                | Modal                                             | Fields | API requires                        |
| -------------------- | ------------------------------------------------- | -----: | ----------------------------------- |
| Fuel log             | `apparatus/components/FuelLogModal.tsx`           |     11 | 4 (`apparatus_id`, date, type, gal) |
| Apparatus defect     | `apparatus/components/MaintenanceRecordModal.tsx` |     18 | 2 (`apparatus_id`, type)            |
| Facility maintenance | `facilities/components/MaintenanceSection.tsx`    |     10 | 1 (`facility_id`)                   |

The backend is already shaped for quick capture — `ApparatusMaintenanceCreate`
needs an apparatus and a type and nothing else. The frontend is what asks for
eighteen fields.

**Suggested fix:** one-screen phone sheets posting only the required fields,
reachable from Quick Add. Deliberately **not** done in the QE-1 change set: it
adds forms, and a second way to create a maintenance record is a real
maintenance cost that deserves its own decision.

---

### QE-7 — The busiest mobile write echoes back data it was just sent

**Grade:** slows people down.

`CheckItemResultSubmit` (`backend/app/schemas/equipment_check.py:358`) requires
the client to send `compartment_name` and `item_name` alongside
`template_item_id` — snapshots of values it fetched from the same server
moments earlier. The comment above `compartment_name` notes that nested
containers arrive as a full storage path at 200 characters per segment, so the
snapshot is explicitly unbounded.

A full rig check is dozens to hundreds of these items in one payload, submitted
over an LTE connection in a bay. The snapshots are presumably there so a
historical result survives a template rename — a real requirement, but one the
**server** can satisfy at write time from `template_item_id`, without putting
the bytes on the wire.

**Suggested fix:** make both optional and resolve them server-side when absent,
keeping the client's values when supplied so existing clients are unaffected.

---

### QE-8 — There is no "what do I need to do" endpoint

**Grade:** slows people down.

A member's pending work is spread across at least eight module-local routes —
`/my-checklists`, `/my-shifts`, `/my-assignments`, `/my-reports`, `/drafts`,
`/my-training`, `/admin-hours/active`, `/notifications/my` and more. A phone
home screen that answers "what is waiting for me" needs roughly a dozen round
trips.

`dashboard.py:1151` (`/dashboard/action-items?assigned_to_me=true`) is the only
assigned-to-me feed, and it is scoped to the Minutes module — it returns `[]`
when Minutes is off. `admin_hub.py`'s `AdminAttentionItem` queue is the right
shape but is per-module and administrator-facing.

**Suggested fix:** one aggregate endpoint returning the member's own pending
items, module-gated per section, so the phone home screen is one request. This
is the largest item on the list and the one most worth designing before
building.

---

### QE-9 — The bottom-nav preference has no way to be set

**Grade:** slows people down.

`BOTTOM_NAV_STORAGE_KEY` (`logbook.bottom-navigation.v1`) is read on every
render and given a full per-slot fallback chain, and the only thing that ever
**writes** it is the defaults it writes for itself. There is no settings screen,
no drag handle, nothing. The customization is fully implemented and
unreachable — the same shape as Pitfall #19's notification rules, minus the
misleading UI.

Worth noting alongside QE-1: with the centre slot now Quick Add, the two
remaining configurable slots matter more per slot, not less.

---

### QE-10 — Pull-to-refresh is on seven pages

**Grade:** slows people down.

`useRegisterPullToRefresh` is opted into by `Dashboard`, `Members`,
`EventsPage`, `InventoryItemsPage`, `FleetBoardPage`, `CheckLogPage` and
`MedicalSuppliesPage`. The gesture, the indicator and the provider are all
mounted app-wide in `AppLayout`, so opting a page in is a one-line change.

The inconsistency is the cost, not the absence: the gesture works on some lists
and silently does nothing on others, which teaches members not to try it.

---

### QE-11 — The manifest declares no `share_target`

**Grade:** slows people down.

`vite.config.ts`'s manifest carries `shortcuts` (3) and `screenshots` (3) but
no `share_target`, `file_handlers`, `protocol_handlers` or `launch_handler`. A
member who photographs a defect with the camera app, or receives a certificate
PDF in email, cannot share it into The Logbook — they must open the app, find
the record, and pick the file back out of the library.

**Suggested fix:** a `share_target` accepting images and PDFs, landing on a
chooser that files the attachment against a training submission or an equipment
check. Depends on a landing route, so it is not a manifest-only change.

---

### QE-12 — Four mobile utilities are defined and never used

**Grade:** dead code.

`mobile-stack` (index.css:1078), `mobile-full-btn` (:1086),
`responsive-text-lg` (:1094) and `responsive-text-base` (:1105) have zero call
sites outside their own definitions. They are the kind of unused helper that
gets adopted years later in a shape nobody intended.

**Suggested fix:** delete them, or use them where the pattern they encode is
currently being retyped by hand (Pitfall #17's reasoning applies).

---

## Verification performed for this review

- `npm run typecheck` (TypeScript 7 via the aliased compiler) — clean.
- `npm run lint` — clean at `--max-warnings 10`.
- `npx vitest run` — 439 files, 5861 tests, all passing.
- `npx playwright test src/e2e/mobile-presentation.spec.ts` — every route
  passes at 390×844 with the new bar composition: 0 undersized tap targets,
  0 sub-12px text, 0 crashes, 0 horizontal overflow.
- `npx playwright test src/e2e/quick-add.spec.ts` — the sheet meets the same
  44px/12px minimums the ratchet enforces elsewhere, the bar gets out of its
  way, the sheet survives the bar disappearing, and a row lands on its page.
- `mobile-route-integrity`, `modal-mobile`, `mobile-workflows` and `navigation`
  — 49 tests, all passing.
