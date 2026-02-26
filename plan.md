# Scheduling Module Production Readiness Fixes

## Summary

Cleanup of the scheduling/shifts module across frontend and backend to fix bugs,
improve type safety, remove dead code, and harden error handling for production.

---

## 1. Frontend: Remove unsafe non-null assertions (`!`) on array indexes

**Files:** `SchedulingPage.tsx`

Lines 239-240 use `weekDates[0]!` and `weekDates[6]!` for the date range label.
Line 267 uses `weekDates[0]!` for the fetch query. While `weekDates` is always
length 7, the `!` assertions circumvent strict null checks. Replace with safe
fallbacks:

```ts
const start = weekDates[0] ?? new Date();
const end = weekDates[6] ?? new Date();
```

Same in `fetchShifts` callback at line 267.

---

## 2. Frontend: Remove unused `shiftForm` fields

**File:** `SchedulingPage.tsx` (lines 154-161)

`shiftForm.name` and `shiftForm.minStaffing` are initialized in state and reset
after creation, but never wired to any form input or sent to the API. Remove them
to avoid confusion.

---

## 3. Frontend: Replace `as unknown as` casts with proper typing

**File:** `SchedulingPage.tsx` (lines 172-173)

The apparatus list and backend templates are cast with `as unknown as`. Instead,
type the API service methods to return the correct types so consumers don't need
unsafe casts.

**File:** `services/api.ts` — update `getBasicApparatus()` and `getTemplates()`
return types to match the `BasicApparatus` and `BackendTemplate` interfaces.

---

## 4. Frontend: Improve error handling — replace silent `catch {}` blocks

**Files:** `SchedulingPage.tsx`, `MyShiftsTab.tsx`, `OpenShiftsTab.tsx`

Multiple empty `catch {}` blocks silently swallow errors. Add `console.warn` at
minimum so failures are visible during development/debugging. Use
`getErrorMessage(err, ...)` for user-facing toast messages.

---

## 5. Frontend: Add double-click guard on confirmation buttons

**File:** `ShiftDetailPanel.tsx`

The inline decline/remove confirmation buttons (`Yes`/`No`) have no loading
state. If the user double-clicks `Yes`, duplicate requests fire. Add a
`submitting` flag to disable the button while the async operation runs.

---

## 6. Frontend: Fix missing `useEffect` cleanup for stale async results

**File:** `ShiftDetailPanel.tsx` (lines ~107-121)

The assignment/calls fetch `useEffect` sets state after an async call with no
abort check. If the component unmounts (user closes panel) before the fetch
completes, React warns about setting state on unmounted component. Add an
`aborted` flag pattern:

```ts
useEffect(() => {
  let aborted = false;
  const load = async () => { ... if (!aborted) setAssignments(...); };
  load();
  return () => { aborted = true; };
}, [shift.id]);
```

---

## 7. Backend: Add `attendee_count` to `_enrich_shifts` helper

**File:** `scheduling.py` endpoint (lines 67-80)

The `_enrich_shifts` helper builds a dict from ORM columns but omits
`attendee_count`. The Pydantic `ShiftResponse` model defaults it to `0`, which
works — but the GET `/shifts/{id}` endpoint explicitly sets it to
`len(attendance)`. The calendar/week and list endpoints don't. For consistency,
compute `attendee_count` inside `_enrich_shifts` by querying attendance counts.

*This is a lower-priority optimization — current behavior returns 0 which is
technically correct for list views.*

---

## 8. Backend: Guard against `None` result from `create_shift`

**File:** `scheduling.py` endpoint (line 141)

After `create_shift`, if `result` is `None` and `error` is also `None` (edge
case), `_enrich_shifts(... [result])` would crash with `NoneType has no attribute
__table__`. Add an explicit None check:

```python
if error or result is None:
    raise HTTPException(status_code=400, detail=...)
```

Apply the same pattern to `update_shift` (line 188) and any other endpoints that
unpack tuples from service methods.

---

## 9. Backend: Use `exclude_unset` instead of `exclude_none` for updates

**File:** `scheduling.py` endpoint (line 182)

`shift.model_dump(exclude_none=True)` means a client cannot explicitly set a
field to `null` (e.g., clearing `notes` or `apparatus_id`). Use
`exclude_unset=True` instead, which only excludes fields the client didn't send
at all.

---

## 10. Frontend: Memoize template category filtering in Create Modal

**File:** `SchedulingPage.tsx` (lines 903-937)

The IIFE inside the template `<select>` filters `effectiveTemplates` by category
on every render. Move this to a `useMemo` to avoid repeated work.

---

## Order of Implementation

1. Items 1-2 (quick safety fixes)
2. Items 5-6 (runtime correctness)
3. Items 4, 8-9 (error handling + backend safety)
4. Items 3, 7, 10 (cleanup + optimization)
