# Skills Testing — Offline Support Implementation Plan

> Status: **Scoping document for review. No implementation code has been written.**
> Autosave for the active test screen already shipped (`useAutoSave` wired into
> `ActiveSkillTestPage`) and covers the common data-loss case — a locked phone
> or a killed tab while the device still has signal. This document scopes the
> separate, larger problem: conducting a skills evaluation with **no
> connectivity at all**.
>
> Two decisions in §5 and §6 need an owner's answer before implementation
> starts. They are policy calls, not engineering ones.

Related: [SKILLS_TESTING_FEATURE.md](./SKILLS_TESTING_FEATURE.md) ·
[Skills Testing Guide](./training/09-skills-testing.md) ·
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)

---

## 1. Goal & Non-Goals

**Goal.** Let an examiner run a skills evaluation end to end from a phone with
no usable network — the burn tower, the back of the apparatus bay, a county
training ground — and have the result reach the server intact when signal
returns.

**In scope:**

- Persisting an in-progress evaluation locally when the network is unavailable.
- Replaying those writes correctly (ordered, coalesced) on reconnect.
- Making an already-opened test survive a signal drop mid-evaluation.
- Surfacing pending/failed sync state to the examiner.

**Out of scope for this plan:**

- Starting a test from a device that has _never_ had signal for that test.
  See §4 — this is the Option B decision, deliberately separated.
- Offline template browsing or test creation from the templates list.
- Multi-device concurrent editing of one test (see §7, conflict handling).
- Offline access to the member-facing results view
  (`MySkillTestResultPage`) — reading your own past results is not a
  field-critical path.

---

## 2. The framing problem: reads, not just writes

The obvious statement of this task is "queue the writes." That solves half the
problem, and not the half that bites first.

`vite.config.ts` sets every `/api/*` route to `NetworkOnly`:

```js
runtimeCaching: [
  { urlPattern: /^.*\/api\/.*/, handler: 'NetworkOnly' },
  ...
]
```

This is deliberate and correct — it is one of the controls that keeps
PHI-adjacent API responses out of the service-worker cache. But it means
`GET /training/skills-testing/tests/{id}` is the _only_ source of
`template_sections` and any previously recorded `section_results`. An examiner
who loses signal before opening the test gets an empty page, and queueing their
writes is moot because there is nothing to write into.

So this work is two problems:

|           | Problem                                            | Covered by |
| --------- | -------------------------------------------------- | ---------- |
| **Entry** | Getting the test and its structure onto the device | Phase 3    |
| **Exit**  | Getting the recorded results back to the server    | Phases 1–2 |

Only the second is "queueing." Scoping the first out entirely produces a
feature that works only when the network fails at exactly the right moment.

---

## 3. Why the existing generic queue cannot carry this

`frontend/src/utils/genericOfflineQueue.ts` backs training submissions and event
RSVPs, and is drained by `useOfflineSyncEngine`. It is the right _pattern_ but
the wrong _vehicle_, for four concrete reasons:

1. **It is POST-only.** `flushOne` calls `axios.post(item.url, item.body)`.
   Skills tests need `PUT /tests/{id}` for every save.

2. **`GenericQueueKind` is a closed union** of two kinds, training submissions
   and event RSVPs. Adding a third is trivial; the point is that the queue was
   designed for fire-and-forget single submissions, which is the assumption
   the next two items break.

3. **No coalescing.** Autosave fires every `AUTO_SAVE_INTERVAL_MS` (30s). An
   hour offline enqueues roughly 120 PUTs for a _single_ test, replayed in
   order on reconnect. Every one but the last is a stale intermediate state.
   The queue needs last-write-wins dedupe keyed on test id.

4. **No ordering guarantee against `complete`.** The drain loop processes items
   independently. `POST /tests/{id}/complete` scores whatever `section_results`
   the server currently holds, so it _must_ land after the final PUT. If it
   drains first, the recorded score is computed from a partial scorecard — and
   because scoring also feeds training-pipeline requirement completion, a wrong
   score can mark a requirement satisfied.

### 3.1 A failure mode worth designing against explicitly

`update_test` rejects any write to a `voided` test outright, and on a
`completed` test allows only `section_results` and `notes`. A queued save
carries `elapsed_seconds` too, so a PUT replayed after the test was completed
or voided from another device returns 400 either way, burns through
`GENERIC_QUEUE_MAX_RETRIES` (5), and is then **silently discarded**. The
examiner sees only:

> 1 pending item failed permanently and was discarded

with no indication that the discarded item was a skills evaluation, which test,
or which candidate. Acceptable for an RSVP. Not acceptable for a scored
evaluation. The skills queue needs to surface a permanent failure with enough
context to act on, and ideally retain the payload for manual recovery rather
than dropping it.

---

## 4. The identity decision (sets the size of everything else)

Skill tests are **server-created**. `POST /training/skills-testing/tests`
returns a server-generated UUID; every subsequent call is
`PUT /tests/{id}`. With no network there is no id, so there is no target to
write to.

**Option A — online-start only.** The examiner creates the test while they
still have signal, then goes offline to conduct it. This matches the existing
precedent: `EquipmentCheckForm.tsx` composes offline and submits once, but the
shift context it needs was loaded while online.

- Covers: signal lost during or just before the evaluation.
- Does not cover: arriving at a site already dark.
- Roughly half the work of Option B.

**Option B — client-minted UUIDs.** The client generates the id and
`create_test` accepts a caller-supplied one idempotently.

- Covers true cold-start offline.
- Requires a backend change (accept + validate a supplied id, guard against
  collision and cross-org id squatting), plus create-then-update ordering in
  the queue on top of everything in Phase 2.

**Recommendation: ship Option A first.** Option B is a separate decision with
its own security surface, not a later phase of the same work. Option A is also
independently useful — the common field failure is signal _degrading_, not
being absent from the start.

---

## 5. DECISION REQUIRED — shared-device data retention

`frontend/src/utils/purgeLocalMemberData.ts` clears every offline queue on
logout, under FE-6/FE-7:

> Fire stations run on shared computers — whoever is on duty signs in on the
> same browser profile. localStorage and IndexedDB are scoped to that profile,
> not to the signed-in member, so anything left behind at logout is readable by
> the next person to sit down.

That policy is sound, and it interacts badly with this feature in two ways.

**5.1 Logout destroys unsynced evaluations.** The purge makes a best-effort
flush first, which fails when offline, then discards and reports a _count_. An
examiner who finishes a drill offline and logs out before regaining signal
loses the evaluation — on a candidate who has already gone home. For an
equipment check that is a tolerable trade. For a scored evaluation it is not.

**5.2 Storing the scorecard at all is a new exposure.** Offline skills testing
requires holding pass/fail per criterion plus free-text examiner notes, against
a named member, in IndexedDB, unencrypted, on a browser profile the whole
station shares. This is adjacent to what `NetworkOnly` on `/api` exists to
prevent.

Three ways forward, in rough order of cost:

| Option                                    | Effect                                                                                                                      | Cost                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Block logout while skills work is pending | Examiner is warned and must sync or explicitly discard                                                                      | Low; a confirm dialog plus a pending-count check                            |
| Encrypt the skills queue at rest          | Reduces shared-profile exposure; key management on a browser is genuinely hard and partly theatre without a server-held key | High                                                                        |
| Accept the risk, documented               | Matches how equipment-check photos are already handled                                                                      | None, but should be a recorded decision in [COMPLIANCE.md](./COMPLIANCE.md) |

**This is an owner decision.** The implementation cannot sensibly pick for you.

### 5.3 The first option was built and reverted

A logout guard was implemented on the reasoning above — cheap, correct
whichever way the retention question goes. It was reverted on the owner's call,
and the reasoning is worth keeping:

> An examiner offline enough to be signing out mid-drill has larger problems
> than a dialog, and those problems get handled in person.

The loss it prevented is also smaller than it looked. Everything up to the last
successful save is on the server, and the records list offers the test straight
back — `loadTest` restores the clock from `elapsed_seconds` and the section
index returns the examiner to the step they had reached. Re-entry, not
prevention, is the supported path, and it already works.

The same call was made about **annotating a resumed test's timing**: a
`resume_count` column and "timing not verified" markings across the examiner
screen, scorecard, printed record and export were built and reverted. A skills
evaluation is two people in an apparatus bay; when an evolution is interrupted,
the examiner and the training officer settle it face to face. They already have
free-text notes on the test and on every criterion, and the officer reviews
before validating. A system that annotates its own uncertainty invites an
officer to trust a badge instead of asking.

This does not change the case for Phases 1–3 — losing a *whole evaluation* to
no signal is a different problem from a clock that drifted — but it does set
the bar: sync the work, do not editorialize about it.

---

## 6. DECISION REQUIRED — is Option A enough?

If the department's actual failure mode is "we drive to a county facility with
no coverage and start from there," Option A does not help and the work should
be scoped as A+B together. If it is "coverage at the station is patchy and
drops mid-drill," Option A is the whole job.

Worth answering before Phase 1, because it changes whether the queue is keyed
on server ids or client ids — a structural choice, not a later refactor.

---

## 7. Conflict handling

`SkillTest` carries no version column or ETag, only `updated_at`. Reconnect is
therefore **last-write-wins**, with no detection.

For the expected case — one examiner, one device, one test — this is fine and
needs no work. It fails silently when two devices hold the same test, or when
an officer edits the scorecard in the admin UI while an offline device holds
pending changes: one side's work vanishes with no warning.

Adding optimistic concurrency (send `updated_at`, reject on mismatch, surface a
conflict) is a backend change of maybe half a day. **Recommend deferring it**
and recording it as a known limitation, unless §6 answers that multiple
examiners commonly share a device pool.

---

## 8. Phasing and sizing

Estimates assume Option A, and include tests.

| Phase                               | Work                                                                                                                                                                          | Size                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **1. Queue foundation**             | `skillsTestOfflineQueue.ts` — own IndexedDB store via `openIndexedDb`, PUT support, coalesce-by-test-id on enqueue                                                            | ~1 day                  |
| **2. Ordering & failure surfacing** | `complete` as a terminal marker draining only after the final PUT for that test; reject-on-completed/voided handled explicitly rather than discarded after 5 retries          | ~1–2 days               |
| **3. Entry (read path)**            | Cache the test payload locally when it is opened, so a mid-evaluation signal drop is survivable; hydrate `ActiveSkillTestPage` from the cache when the network is unavailable | ~1–2 days               |
| **4. UX**                           | Offline banner on the test screen (mirroring `EquipmentCheckForm`), pending count into `pendingSyncStore` so the nav pill covers it, permanent-failure surfacing              | ~1 day                  |
| **5. Purge integration**            | Register with `purgeLocalMemberData`, plus whichever §5 option is chosen                                                                                                      | ~0.5 day + the decision |

**Total: 4–6 days for Option A.** Option B adds roughly 2 days plus a backend
change and its own review.

---

## 9. What recent work already paid for

Two things are cheaper than they would have been before the
`template_snapshot` work (see `20260807_0006_add_skill_test_template_snapshot`):

- **Phase 3 is caching a payload we already receive.** `SkillTestResponse`
  now carries `template_sections` sourced from the test's own frozen snapshot,
  so the client already holds everything needed to render the scorecard. There
  is no separate template fetch to cache and no risk of the cached structure
  drifting from what the test was scored against.

- **A client-side score preview becomes feasible.** The client has the full
  structure and scoring rules locally, so an offline examiner could see a
  provisional pass/fail instead of a blank result until sync. Authoritative
  scoring must stay server-side (`calculate_test_result`) — the preview would
  be advisory only, and should be labelled as such.

---

## 10. Open questions

1. §5 — which shared-device option?
2. §6 — Option A alone, or A+B?
3. Should an offline examiner see a provisional score (§9), or is an unscored
   "pending sync" state less misleading?
4. Does `max_attempts` enforcement (currently open in
   [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)) need to hold offline, or is
   server-side enforcement on sync sufficient? Enforcing on sync means an
   examiner can conduct an attempt that is later rejected.
