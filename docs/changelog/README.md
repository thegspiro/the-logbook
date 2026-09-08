# Changelog archive

Monthly archives of [the project changelog](../../CHANGELOG.md), which was
**closed to new entries on 2026-09-08**. Both these archives and the root file
are historical reference now — nothing is added to either.

Entries are reproduced unchanged apart from link paths, which were written
relative to the repository root and are rewritten to `../../` here.

| Month                              | Sections | Notes                                         |
| ---------------------------------- | -------: | --------------------------------------------- |
| [Aug–Sep 2026](../../CHANGELOG.md) |      584 | Final months — still in `CHANGELOG.md`        |
| [July 2026](2026-07.md)            |       28 | ISO alignment, module security audit          |
| [June 2026](2026-06.md)            |       12 | OAuth, MFA, platoon rotations                 |
| [May 2026](2026-05.md)             |        4 | Client IP resolution, GeoIP                   |
| [April 2026](2026-04.md)           |        9 | Shift summaries, trainee follow-up            |
| [March 2026](2026-03.md)           |      148 | Frontend consolidation, pipeline auto-advance |
| [February 2026](2026-02.md)        |      122 | Initial release and the build-out after it    |

## Why this is split

The changelog reached **13,859 lines** in one file. The risk that carries is not
untidiness — it is that people stop reading it, and a changelog nobody reads
stops being written to. That already happened once: a full-history audit on
2026-08-16 found roughly forty merged changes that had never reached the
changelog at all, five of them contradicted by the documentation then in force.

Splitting by month keeps the file somebody actually opens down to the period
they are asking about, without discarding anything.

## Nothing is added here any more

The ledger stopped taking entries on 2026-09-08. **Do not add entries to these
archives, and do not add them to [`CHANGELOG.md`](../../CHANGELOG.md) either** —
see [Changelog entries are no longer part of a pull
request](../../CLAUDE.md#changelog-entries-are-no-longer-part-of-a-pull-request)
for why, and for where a change's narrative goes instead.

Everything from the freeze onward is read from the merged pull requests, which
carry the same detail with none of the merge cost.

**Moving a closed month here is still allowed**, and is the one thing that
touches these files. `CHANGELOG.md` still holds its final months; relocating
their `###` sections into a new file here — rewriting root-relative links to
`../../` and adding a row to the table above — relocates frozen history rather
than adding to it, so the reason for the split survives the freeze. Do it on its
own branch, never alongside a feature change.
