# Platoon Scheduling — Admin Setup Guide

A task-oriented walkthrough for turning on and running **platoon-based
scheduling**. For the design/reference detail (data model, migrations, offset
math), see [SCHEDULING_MODULE.md → Platoon Rotations](./SCHEDULING_MODULE.md#platoon-rotations-added-2026-06-19).

Platoon scheduling is **opt-in** and **off by default**. When it's off, the
Scheduling module works exactly as it always has — none of the steps below
affect departments that don't use platoons.

---

## When to use platoons

Use platoons if your department staffs by rotating crews (A/B/C, or
"shifts"/"groups"/"colors") that each work the same repeating cycle offset from
one another — e.g. a 24/48 where one of three platoons is on duty each day. If
you instead build each shift's roster ad hoc, you don't need platoons.

---

## Step 1 — Enable platoons for your department

1. Go to **Scheduling → Settings**.
2. Turn on the platoon option. This sets
   `org.settings["scheduling"]["platoons_enabled"] = true`.

Once enabled, platoon badges, the per-shift hold-over roster, and platoon-aware
generation appear in the module.

## Step 2 — Assign each member to a platoon

Platoon membership is a standing, person-level attribute (`users.platoon`) — a
member is "on A platoon" until you change it, and the schedule is built from
that.

You have three ways to assign it:

1. **Department Platoon Overview** (`/scheduling/platoons`, linked from
   **Scheduling → Settings → Platoons → Department platoon overview**): see every
   platoon and its members at a glance, select any number of members, and
   **bulk-assign** them to a platoon (or clear it) in one step. Best for initial
   setup and shuffling crews.
2. **Settings → Platoons roster:** an inline list with a per-member dropdown —
   handy for quick one-off edits.
3. **Member admin UI:** set an individual member's platoon from their record.

Leave a member's platoon blank if they aren't part of the rotation (e.g. admin
staff) — they simply won't be generated into platoon shifts.

> Members can see their own platoon on their profile / assignments view, so they
> know which rotation they're on.

## Step 3 — Generate the rotation

When you generate shifts from a rotation, each platoon runs the same cycle
offset by `i × cycle_length / num_platoons` days, so exactly one platoon is on
duty per day. Validated offsets for the common presets:

| Rotation | Cycle | Platoons | Offsets (days) |
|----------|-------|----------|----------------|
| 24/48 | 3 | 3 | 0, 1, 2 |
| Kelly (9-day) | 9 | 3 | 0, 3, 6 |
| 48/96 | 6 | 3 | 0, 2, 4 |

The generated shifts reflect each platoon's **actual makeup**: a member on
approved leave during the window is omitted from the shifts they'd otherwise
staff. The responsible platoon is recorded on each shift (`shifts.platoon`).

## Step 4 — Day-to-day: filling gaps and holding over

On any shift's detail view you'll see a **hold-over roster** — members who are
available to cover a gap or be held over: same organization, **not on leave**,
and **not already assigned** to that shift.

- Click **Assign** next to a member to add them to the shift in one step.
- Approving a member's leave automatically **cancels** their conflicting
  generated shifts, so the roster stays accurate after the schedule is built.

---

## Turning platoons back off

Set the toggle off (or `platoons_enabled = false`). The platoon fields, badges,
and roster stop appearing and generation ignores platoons. Existing
`users.platoon` / `shifts.platoon` values are preserved (harmless while
disabled) so you can turn the feature back on later without re-assigning
everyone.

---

## Troubleshooting

If platoon fields don't appear or a generated rotation produces empty shifts,
see
[TROUBLESHOOTING.md → Platoon Rotations (Person-Level)](./TROUBLESHOOTING.md#platoon-rotations-person-level-no-platoon-fields-or-generated-shifts).
The usual causes are: the toggle is off, members have no platoon assigned, or
the intended crew is on approved leave for the window.
