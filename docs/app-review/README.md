# Application Review — Feature-by-Feature

A rotating, **completion-driven** review of the whole application. Where the
[module audit](../module-audit/PROGRESS.md) was a security-first sweep, this
review is broader: each iteration takes **one feature** and reviews it across
six dimensions — correctness, security, duplication, dead code, documentation,
and future development.

## How it runs

One iteration = **one feature**. The next iteration starts when the previous
feature is *done*, not on a wall-clock timer. That is the point of the
completion-driven design: features vary from 300 to 15,000 lines, and a fixed
15-minute tick either truncates the big ones or idles on the small ones.

```
/loop /app-review        # runs a feature, finishes it, starts the next
```

`/app-review` (see `.claude/commands/app-review.md`) is the unit of work. Run it
without the loop to do exactly one feature and stop.

## The three files

| File | Purpose |
|------|---------|
| [`PROGRESS.md`](./PROGRESS.md) | The tracker: feature inventory, rotation order, status, running log |
| [`CHECKLIST.md`](./CHECKLIST.md) | What each iteration checks — the six dimensions plus the project-specific pitfalls |
| [`_TEMPLATE.md`](./_TEMPLATE.md) | The shape of a per-feature findings file |
| [`CROSS-CUTTING.md`](./CROSS-CUTTING.md) | Patterns spanning features (`AXC-n`), so one sweep closes the class |

Each completed feature gets `docs/app-review/<feature>.md`.

## What an iteration is allowed to change

Same contract as the module audit, which worked well across 27 modules:

- **Apply** fixes that are clearly correct, low-risk, and verifiable — real
  bugs, security hardening, dead-code removal, doc corrections.
- **Flag** anything that changes behavior, needs a product decision, requires a
  migration, or is too large to verify in one iteration. Write it up with enough
  detail that the owner can decide; do not implement it unilaterally.
- **Never** silence an error. The [CLAUDE.md completion gate](../../CLAUDE.md)
  applies to every iteration: `tsc --noEmit`, `flake8`, `npm run lint`, and the
  existing tests must all be clean before the feature is marked done.

## Finding IDs

`<PREFIX>-<n>` where the prefix is the feature's short code (e.g. `SF-1` for
storefront). Severity is one of **CRITICAL / HIGH / MED / LOW / NIT**. Findings
that are fixed in the same iteration are marked ✅ FIXED inline; open ones stay
open and the owner-decision ones are mirrored into
[`KNOWN_LIMITATIONS.md`](../KNOWN_LIMITATIONS.md).

## Relationship to the other review tracks

- [`docs/module-audit/`](../module-audit/PROGRESS.md) — completed 2026-07-26.
  27 modules, security/tenant-isolation focus. Its cross-cutting patterns
  (XC-1/2/3) are inputs to this review, not repeats of it.
- [`docs/review-log.md`](../review-log.md) — the older time-based `/loop`.
  Superseded by this review for feature coverage; its owner-decision list is
  still live.
</content>
