# Recent changes: August 17–19, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-08-17_TO_19.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-17_TO_19.md).
Predecessor: [August 15–16](Recent-Changes-2026-08-15-to-16).

**The headline:** a department that does not run incident reporting can now
record call volume — enough for a grant application or an ISO rating, and
deliberately nothing that would make the record PHI. Closing out a shift became
a three-step wizard that survives a locked phone. Separately, NFC tags now work
across events, admin hours and shift check-in.

## Pages and connection points

| Area                          | Pages                                                                                                                                                                         | API/data connection                                                                                                                                                         | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling — call volume      | Scheduling → Settings → General → _Shift close-out rules_ → **Record a call count at close-out**; Reports → Call Volume                                                       | New tables `org_calls`, `org_call_responses`; org setting `scheduling.call_tracking.{mode,call_types}`; `GET /scheduling/reports/call-volume` gains `counts_unit_responses` | Three numbers that are **not supposed to add up**: department volume (one call however many units rolled), apparatus runs (unit responses), member credit (per person). Blank ≠ 0. 100 calls per shift is a hard cap. A department that has never touched this setting keeps per-incident logging — absence means today's behaviour, never "off". |
| Scheduling — close-out wizard | Shift detail → **Close out shift**                                                                                                                                            | New column `shifts.closeout_step`; `GET /scheduling/shifts/{id}/closeout`, `PATCH …/closeout/attendance`, `PATCH …/closeout/calls`                                          | Each step saves as it advances, so a phone locking at 0700 resumes where it left off. Only count-only departments see the wizard; everyone else keeps the single finalize checklist unchanged. Reopening a finalized shift restarts the wizard.                                                                                                   |
| NFC tags                      | `/events/:id/qr-code`, `/admin-hours/categories/:id/qr-code`, `/locations/qr-codes`, shift detail QR block; **Tap Tag** on Events, My Admin Hours and the scheduling calendar | `constants/nfc.ts` target registry; Web NFC                                                                                                                                 | A tag is untrusted input: the payload is resolved against the app's own origin, only known routes are accepted, and the route handed to the router is **rebuilt** rather than the raw string. `/display/:code` is deliberately not taggable — that code is a check-in credential. Chrome on Android over HTTPS only.                              |
| Upgrades                      | — (CLI)                                                                                                                                                                       | `python -m app.preflight`, `--compose PATH`                                                                                                                                 | Answers "will this configuration start?" **before** the restart that would otherwise find out by losing the service. Run it with `--build` and the same `-f` files the deployment uses, or it answers about a configuration nobody runs.                                                                                                          |
| Sign-in                       | Login, forgot password, the two public forms                                                                                                                                  | Breached-password lookup; suspicious-IP throttle; CAPTCHA                                                                                                                   | The breach lookup **fails open** (it is supplementary — complexity, history, MFA and lockout still apply); CAPTCHA **fails closed** (nothing sits behind it). Lockout responses are generic by default. Account lockout is per-user and so does not cover password spraying; the per-IP throttle does.                                            |
| Privacy                       | `/privacy`, `/terms`                                                                                                                                                          | Static content, rewritten                                                                                                                                                   | The department, not the platform, is the data controller, and the notice now says so up front. Print stylesheet extracted; accessibility pass on both.                                                                                                                                                                                            |
| Dashboard                     | `/dashboard` on a phone                                                                                                                                                       | —                                                                                                                                                                           | The week strip and alert list collapse on narrow screens; the phone line counts the whole week, not the visible slice.                                                                                                                                                                                                                            |

## Database upgrade route

Two migrations, both additive and introspection-guarded, neither backfilling:

| Revision                    | Adds                              |
| --------------------------- | --------------------------------- |
| `82bdcb3b1e64` (2026-08-18) | `org_calls`, `org_call_responses` |
| `2827079fd66c` (2026-08-19) | `shifts.closeout_step`            |

They sit on top of `8050e5a61f34`, the 2026-08-17 rejoin that collapsed the four
heads left by concurrently-merged pull requests. **Back up, confirm
`alembic heads` returns exactly one, then `alembic upgrade head`.**

An organization that has never used count-only tracking gets two empty tables
and a NULL column. Every existing report keeps reading the source it already
read.

## What the call tables deliberately do not hold

No address, no cross streets, no patient or caller identity, no narrative, no
dispatch/on-scene/clear times, and no CAD incident number for display. Those
are the fields that make a call record PHI, and collecting them is what a
department choosing this mode declined to do.

It is enforced by absence — there is no field to type one into and no column to
store it in. `call_date` is a **date, not a timestamp**, because a timestamp
would let response times be reconstructed, which is the first step back toward
an incident record.

## Reading the call-volume report correctly

In count-only mode the report says **Unit Responses**, not **Total Calls**.
That is not cosmetic. Until the cross-unit attach picker ships, two units that
closed out independently each reported their own call, so the figure counts an
incident once per responding unit.

**Do not put that number in a grant application as a department call count.**
Either wait for the picker, or reconcile mutual responses by hand.

## Operational notes

- **Enabling _Record a call count at close-out_ takes effect immediately** — no
  reload. It changes what officers see at 0700 the same day, so tell them
  before you flip it.
- **A count-only department that enforces end-of-shift equipment checks can
  still close out.** The wizard carries the override and its logged reason, and
  the pass-down notes field, because it replaces the checklist rather than
  sitting beside it.
- **Only assigned and confirmed crew appear in close-out.** Declined, pending
  and no-show members are excluded — every listed member otherwise takes the
  apparatus's full call count by default.
- **Correcting a shift's date or apparatus after close-out moves its calls with
  it.** The totals were always right; before this fix the daily and
  per-apparatus reports pointed at the wrong day and the wrong truck.

## CI note for contributors

An unbounded `apt-get` in six CI job instances stalled for 19m26s on 2026-08-19
and consumed the entire 20-minute budget of two backend jobs. Because the
integration and contract matrices sit behind `needs:`, they reported **skipped**
rather than failed — so a merge reached `main` with no backend test having run
and nothing red to react to.

The install is now a script that skips apt entirely when the library is already
loadable, and otherwise retries under one 240-second deadline covering every
attempt. Backend database setup for the integration and contract jobs is a
single composite action rather than two verbatim copies.
