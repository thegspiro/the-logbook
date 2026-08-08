#!/usr/bin/env python3
"""
Relink training requirements whose ``required_courses`` hold typed-in course
names, where the intended course is unambiguous.

Companion to ``find_unlinked_course_requirements.py``, which reports the
problem. That script suggests a single best match so a human can judge it; this
one writes changes, so it holds a stricter bar and only acts where there is
nothing to judge.

What "high confidence" means here
---------------------------------
Not "the best match" — *the only match*. The reporting script returns its
top-ranked candidate, which hides ambiguity: a stored "CPR" ranks "CPR / BLS"
first even when "CPR Instructor" and "CPR Renewal" are equally plausible.
Picking one of those automatically would silently attach the wrong course to a
compliance requirement.

So an entry is relinked only when **exactly one** library course matches at one
of these tiers:

  * ``exact``         — the stored text equals a course's name or code
                        (case-insensitively).
  * ``contains-name`` — a course's full name appears inside the stored text, as
                        in "ICS-100: Introduction to the Incident Command
                        System" carrying the library's "ICS-100". The stored
                        text is a verbose spelling of that course.

Two tiers are deliberately **never** applied, only reported:

  * ``fragment`` — the stored text is a piece of a longer course name ("CPR"
                   inside "CPR Instructor"). The direction matters: a verbose
                   stored value naming a short course is evidence; a short
                   stored value inside a long course name is a coincidence
                   waiting to happen.
  * ``fuzzy``    — similarity scoring. Fine for a human-reviewed suggestion,
                   not for an unattended write.

Entries that are well-formed UUIDs but absent from the org's library
("dangling") are never touched: there is no name to match on, and the right
answer may be to delete rather than remap.

Safety
------
* **Dry run by default.** Nothing is written without ``--apply``.
* **Per-organization matching.** A course from another tenant can never be
  selected, so this cannot introduce a cross-tenant reference.
* **Rollback file.** ``--apply`` writes before/after state for every changed
  requirement; ``--restore FILE`` puts it all back.
* **Audit trail.** Each change is recorded through the normal audit logger, so
  it lands in the same tamper-evident chain as an officer's edit.
* **Partial fixes are kept.** A requirement with three resolvable names and one
  ambiguous one gets the three, and is reported as still needing attention.

Usage:

    # See what would change (default — writes nothing):
    docker exec -it intranet-backend python scripts/apply_course_link_suggestions.py

    # Apply, recording a rollback file:
    docker exec -it intranet-backend python scripts/apply_course_link_suggestions.py \
        --apply --rollback-file /tmp/relink-rollback.json

    # One organization at a time:
    docker exec -it intranet-backend python scripts/apply_course_link_suggestions.py \
        --org "Falls Church" --apply

    # Undo:
    docker exec -it intranet-backend python scripts/apply_course_link_suggestions.py \
        --restore /tmp/relink-rollback.json

Exit codes:
    0 — nothing left ambiguous (either nothing to do, or everything relinked)
    1 — entries remain that need a human decision
    2 — database connection error or unhandled exception
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select  # noqa: E402

from app.core.audit import log_audit_event  # noqa: E402
from app.core.database import (  # noqa: E402
    async_session_factory,
    database_manager,
)
from app.models.training import TrainingCourse, TrainingRequirement  # noqa: E402
from app.models.user import Organization  # noqa: E402

# Tiers safe to write without review. Both require a unique match; see the
# module docstring for why 'fragment' and 'fuzzy' are excluded.
AUTO_TIERS = ("exact", "contains-name")


def _is_uuid(value) -> bool:
    from uuid import UUID

    try:
        UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _candidates(text: str, courses):
    """Every library course matching ``text``, with its tier.

    Returns a list of ``(course, tier)``. Unlike the reporting script's
    single best match, this keeps all of them — ambiguity is the signal that
    decides whether a write is safe, so it must not be collapsed away.
    """
    needle = str(text).strip().lower()
    if not needle:
        return []

    found = []
    for course in courses:
        name = (course.name or "").strip().lower()
        code = (course.code or "").strip().lower()

        if needle == name or (code and needle == code):
            found.append((course, "exact"))
        elif name and name in needle:
            # Stored text spells out this course's name in full.
            found.append((course, "contains-name"))
        elif name and needle in name:
            # Stored text is only a piece of this course's name.
            found.append((course, "fragment"))

    if not found:
        return []

    # Keep only the strongest tier present: one exact match alongside three
    # fragment matches is unambiguous, and should not be blocked by the noise.
    for tier in ("exact", "contains-name", "fragment"):
        at_tier = [pair for pair in found if pair[1] == tier]
        if at_tier:
            return at_tier
    return []


def _classify(entry, courses):
    """Decide what should happen to one required_courses entry."""
    key = str(entry)

    if _is_uuid(key):
        return {"value": key, "action": "skip", "reason": "dangling id"}

    matches = _candidates(key, courses)
    if not matches:
        return {"value": key, "action": "skip", "reason": "no match in the library"}

    tier = matches[0][1]
    if len(matches) > 1:
        names = ", ".join(c.name for c, _ in matches[:4])
        return {
            "value": key,
            "action": "skip",
            "reason": f"ambiguous — {len(matches)} candidates ({names})",
        }
    if tier not in AUTO_TIERS:
        course = matches[0][0]
        return {
            "value": key,
            "action": "skip",
            "reason": f"{tier} match only ({course.name}) — needs a human",
        }

    return {
        "value": key,
        "action": "relink",
        "course": matches[0][0],
        "tier": tier,
    }


async def _plan(db, org_filter, active_only):
    """Build the list of intended changes without writing anything."""
    orgs = (await db.execute(select(Organization))).scalars().all()
    if org_filter:
        needle = org_filter.strip().lower()
        orgs = [
            o
            for o in orgs
            if str(o.id) == org_filter or needle in (o.name or "").lower()
        ]
        if not orgs:
            raise SystemExit(f"No organization matched {org_filter!r}")

    plan = []
    for org in orgs:
        # Per-org library: a course belonging to another tenant must never be
        # selectable, so this cannot introduce a cross-tenant reference.
        courses = (
            (
                await db.execute(
                    select(TrainingCourse).where(
                        TrainingCourse.organization_id == str(org.id)
                    )
                )
            )
            .scalars()
            .all()
        )
        by_id = {str(c.id): c for c in courses}

        query = select(TrainingRequirement).where(
            TrainingRequirement.organization_id == str(org.id)
        )
        if active_only:
            query = query.where(TrainingRequirement.active.is_(True))

        for req in (await db.execute(query)).scalars().all():
            entries = req.required_courses or []
            if not entries:
                continue

            decisions, changed = [], False
            for entry in entries:
                if str(entry) in by_id:
                    decisions.append({"value": str(entry), "action": "keep"})
                    continue
                decision = _classify(entry, courses)
                decisions.append(decision)
                if decision["action"] == "relink":
                    changed = True

            if not changed and not any(d["action"] == "skip" for d in decisions):
                continue

            plan.append(
                {
                    "org": org,
                    "requirement": req,
                    "before": [str(e) for e in entries],
                    "decisions": decisions,
                    "changed": changed,
                }
            )
    return plan


def _new_value(item):
    """The requirement's required_courses after applying its relinks."""
    out = []
    for decision in item["decisions"]:
        if decision["action"] == "relink":
            out.append(str(decision["course"].id))
        else:
            out.append(decision["value"])
    return out


def _print_plan(plan, applying: bool) -> int:
    bar = "=" * 78
    verb = "APPLYING" if applying else "DRY RUN — no changes written"
    print(bar)
    print(f"RELINK TYPED-IN COURSE NAMES  ({verb})")
    print(bar)

    if not plan:
        print("\nNothing to do — no requirement has an unresolved course entry.")
        print(f"\n{bar}")
        return 0

    relinked = skipped = 0
    for item in plan:
        req = item["requirement"]
        print(f"\n{item['org'].name} / {req.name}")
        print(f"  id={req.id}")
        for decision in item["decisions"]:
            if decision["action"] == "keep":
                continue
            if decision["action"] == "relink":
                relinked += 1
                course = decision["course"]
                code = f" [{course.code}]" if course.code else ""
                print(f"  RELINK  {decision['value']!r}")
                print(
                    f"          -> {course.name}{code}  id={course.id}"
                    f"  ({decision['tier']})"
                )
            else:
                skipped += 1
                print(f"  SKIP    {decision['value']!r}")
                print(f"          {decision['reason']}")

    print(f"\n{bar}")
    print(f"{relinked} entr(ies) relinked, {skipped} left for a human.")
    if not applying and relinked:
        print("\nRe-run with --apply to write these, ideally with --rollback-file.")
    if skipped:
        print(
            "\nThe skipped entries are the ambiguous ones — open each requirement "
            "and pick the course by hand."
        )
    print(bar)
    return 1 if skipped else 0


async def _apply(db, plan, rollback_path):
    """Write the planned relinks, recording rollback state and audit entries."""
    rollback = []
    for item in plan:
        if not item["changed"]:
            continue
        req = item["requirement"]
        after = _new_value(item)

        rollback.append(
            {
                "requirement_id": str(req.id),
                "organization_id": str(req.organization_id),
                "requirement_name": req.name,
                "before": item["before"],
                "after": after,
            }
        )

        # Assign a brand-new list rather than mutating in place: a plain
        # Column(JSON) does not track in-place edits, so appending to or
        # reassigning elements of the existing list would be silently dropped
        # at commit (CLAUDE.md pitfall 12). A fresh list with different
        # contents is detected by the normal attribute comparison, so no
        # flag_modified is needed — and only requirements whose contents
        # actually change reach this line.
        req.required_courses = after

        await log_audit_event(
            db=db,
            event_type="training_requirement_courses_relinked",
            event_category="training",
            severity="info",
            event_data={
                "requirement_id": str(req.id),
                "requirement_name": req.name,
                "before": item["before"],
                "after": after,
                "applied_by": "scripts/apply_course_link_suggestions.py",
                "action": "requirement_courses_relinked",
            },
            organization_id=str(req.organization_id),
        )

    if not rollback:
        return 0

    await db.commit()

    if rollback_path:
        payload = {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source": "scripts/apply_course_link_suggestions.py",
            "changes": rollback,
        }
        with open(rollback_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        print(f"\nRollback written to {rollback_path} ({len(rollback)} requirement(s))")
        print("  Undo with: --restore " + rollback_path)

    return len(rollback)


async def _restore(db, path) -> int:
    """Put required_courses back to the 'before' state in a rollback file."""
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)

    changes = payload.get("changes", [])
    if not changes:
        print(f"{path} records no changes — nothing to restore.")
        return 0

    restored, missing, diverged = 0, 0, 0
    for change in changes:
        req = (
            await db.execute(
                select(TrainingRequirement).where(
                    TrainingRequirement.id == change["requirement_id"],
                    TrainingRequirement.organization_id == change["organization_id"],
                )
            )
        ).scalar_one_or_none()

        if req is None:
            missing += 1
            print(
                f"  MISSING  {change['requirement_name']} ({change['requirement_id']})"
            )
            continue

        current = [str(e) for e in (req.required_courses or [])]
        if current != change["after"]:
            # Someone edited it since. Restoring would discard their work, so
            # leave it and say so.
            diverged += 1
            print(
                f"  CHANGED  {change['requirement_name']} — edited since the "
                "relink; left alone"
            )
            continue

        # New list object, same reasoning as in _apply().
        req.required_courses = list(change["before"])
        restored += 1
        print(f"  RESTORE  {change['requirement_name']}")

    if restored:
        await db.commit()

    print(
        f"\n{restored} restored, {diverged} edited since (skipped), {missing} missing."
    )
    return 1 if (diverged or missing) else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Relink training requirements whose required_courses hold typed-in "
            "course names, where exactly one library course matches."
        )
    )
    parser.add_argument(
        "--org",
        metavar="ID_OR_NAME",
        help="Limit to one organization (id, or case-insensitive name substring)",
    )
    parser.add_argument(
        "--active-only",
        action="store_true",
        help="Skip requirements that are already deactivated",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the changes (without this, the run is a dry run)",
    )
    parser.add_argument(
        "--rollback-file",
        metavar="PATH",
        help="With --apply, write before/after state here so it can be undone",
    )
    parser.add_argument(
        "--restore",
        metavar="PATH",
        help="Undo a previous --apply using its rollback file",
    )
    args = parser.parse_args()

    if args.restore and args.apply:
        parser.error("--restore and --apply are mutually exclusive")
    if args.rollback_file and not args.apply:
        parser.error("--rollback-file only makes sense with --apply")

    async def _main() -> int:
        await database_manager.connect()
        try:
            async with async_session_factory() as db:
                if args.restore:
                    return await _restore(db, args.restore)

                plan = await _plan(db, args.org, args.active_only)
                status = _print_plan(plan, args.apply)
                if args.apply:
                    await _apply(db, plan, args.rollback_file)
                return status
        finally:
            await database_manager.disconnect()

    try:
        return asyncio.run(_main())
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover - operational safety net
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
