# Governance — Organizational Chart

**Added 2026-08-24.** The department's real chain of command, drawn as a tree
you can read as an outline or as a diagram.

- **Page:** `/governance/org-chart`
- **Reading:** any signed-in member
- **Editing:** `orgchart.manage` **or** `settings.manage`
- **Tables:** `org_chart_nodes`, `org_chart_node_holders`

## Why reading needs no permission

The chart exists so an ordinary member can work out who is in charge of an
area without asking around. Gating it behind a permission would leave the
general membership — the audience the screen was built for — outside the one
screen built for them. Editing is gated server-side; without
`orgchart.manage` or `settings.manage` the page renders read-only, with no
edit affordances shown.

## What a seat is

A **node** is a seat: a title, an optional statement of what that seat is
responsible for, optional contact email and phone, and a position in the tree
under its parent. Seats are ordered among their siblings, and a seat can be
unpublished to keep it off the chart while you work on it.

**A seat holds several people.** A department with two deputy chiefs puts both
in one box rather than inventing two boxes that mean the same thing. Holders
are ordered within the seat.

**A holder need not be a member of the department.** A holder row carries
either a `user_id` or a plain `display_name`, which is how the town attorney,
a mutual-aid liaison or a county fire marshal appears on the chart without
being given an account.

## Linking a seat to a position or rank

A seat can name a **position** or a **rank code**. This _assists_ the seat; it
does not define it:

- Linking a seat to a position **fills its holders in** from that position's
  current assignees, so you do not retype the roster you already maintain.
- **Unlinking keeps the people you typed, and drops the ones the link supplied.**
  That distinction matters before you press it: holders that arrived _from_ the
  position or rank are filtered out of the seat when the link is removed, because
  they were never stored on the seat — they were resolved through the link every
  time the chart was drawn. Only hand-entered holders are rows of their own and
  survive. **A seat whose holders all came from its link becomes vacant when you
  unlink it**, so type the names in first if you want to keep them.

The link is an _assist_ rather than the seat's definition — a seat can hold
people the position does not, which is the point: a department whose org chart
differs from its permission structure, which is most of them, still has to be
able to draw its real chain of command.

## Getting started

The chart **starts empty**. Nothing is inferred from positions, ranks or the
member list, because a permission structure is not an org chart and guessing
would produce a diagram nobody recognises. Add your top seat, then work down.

## Screenshots

Not yet captured — see
[`docs/training/SCREENSHOT_CURRENCY.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/training/SCREENSHOT_CURRENCY.md).
The outline view and the diagram view are **not interchangeable** and both
need shooting, as does the node modal showing a multi-holder seat and a
non-member holder.
