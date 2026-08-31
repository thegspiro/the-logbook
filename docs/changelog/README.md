# Changelog archive

Monthly archives of [the project changelog](../../CHANGELOG.md). The main file
carries the **current** month; a month is moved here once it closes.

Entries are reproduced unchanged apart from link paths, which were written
relative to the repository root and are rewritten to `../../` here.

| Month                             | Sections | Notes                                         |
| --------------------------------- | -------: | --------------------------------------------- |
| [August 2026](../../CHANGELOG.md) |      584 | **Current** — still in `CHANGELOG.md`         |
| [July 2026](2026-07.md)           |       28 | ISO alignment, module security audit          |
| [June 2026](2026-06.md)           |       12 | OAuth, MFA, platoon rotations                 |
| [May 2026](2026-05.md)            |        4 | Client IP resolution, GeoIP                   |
| [April 2026](2026-04.md)          |        9 | Shift summaries, trainee follow-up            |
| [March 2026](2026-03.md)          |      148 | Frontend consolidation, pipeline auto-advance |
| [February 2026](2026-02.md)       |      122 | Initial release and the build-out after it    |

## Why this is split

The changelog reached **13,859 lines** in one file. The risk that carries is not
untidiness — it is that people stop reading it, and a changelog nobody reads
stops being written to. That already happened once: a full-history audit on
2026-08-16 found roughly forty merged changes that had never reached the
changelog at all, five of them contradicted by the documentation then in force.

Splitting by month keeps the file somebody actually opens down to the period
they are asking about, without discarding anything.

## Adding to it

Write new entries in [`CHANGELOG.md`](../../CHANGELOG.md) as before. **Do not
add entries here** — an archive covering a closed month should not gain new
ones. When a month closes, move its `###` sections into a new file here,
rewrite root-relative links to `../../`, and add a row to the table above.
