#!/usr/bin/env python3
"""
Find training requirements whose ``required_courses`` entries do not resolve to
a course in the organization's library.

Why these exist
---------------
``training_requirements.required_courses`` holds **course ids**. Every
compliance evaluator asks the same question — "is this member's training record
for one of these course ids?" — so an entry that is not an id can never match a
record, and the requirement can never be completed.

Until the course picker landed, the department Requirements page collected this
field as free text, one course *name* per line. Requirements created that way
still carry names, and no amount of training will satisfy them. The picker
stops new ones; this script finds the existing ones so they can be re-linked.

What it reports, and why the distinction matters
------------------------------------------------
Each unresolved entry is classified:

  * ``name``    — not a UUID at all, so almost certainly typed-in text from the
                  old free-text field. The script suggests the closest match in
                  that org's course library so re-linking is mechanical.
  * ``dangling`` — a well-formed UUID that is not in this org's library. Either
                  the course was removed, or the id belongs to another
                  organization. Courses are soft-deleted (``active = 0``) rather
                  than dropped, and a resolvable-but-archived course is reported
                  as OK-with-a-note, so a true dangling id is worth a look.

Severity depends on the requirement type:

  * ``courses``       — needs *every* linked course. Any unresolved entry means
                        the requirement can never reach 100%.
  * ``certification`` — falls back to matching records by name, training type
                        and registry code, so it may still work; the broken
                        entry just is not helping.

Read-only. Nothing is modified — remediation is an officer decision about which
library course each name meant.

Usage:

    # Inside the backend container, so it uses the app's DB configuration:
    docker exec -it intranet-backend python scripts/find_unlinked_course_requirements.py

    # One organization only (id, or a case-insensitive name substring):
    docker exec -it intranet-backend python scripts/find_unlinked_course_requirements.py --org "Falls Church"

    # Skip requirements already deactivated:
    docker exec -it intranet-backend python scripts/find_unlinked_course_requirements.py --active-only

    # Machine-readable, for feeding a follow-up fix:
    docker exec -it intranet-backend python scripts/find_unlinked_course_requirements.py --json

Exit codes:
    0 — every required_courses entry resolves (or there are none to check)
    1 — at least one unresolved entry found
    2 — database connection error or unhandled exception

Scope note: ``recertification_pathways.required_courses`` uses the same
convention but was never populated by a free-text UI, so it is deliberately not
scanned here. Widen this script if that changes.
"""

import argparse
import asyncio
import json
import os
import sys
from difflib import SequenceMatcher
from uuid import UUID

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select  # noqa: E402

from app.core.database import (  # noqa: E402
    async_session_factory,
    database_manager,
)
from app.models.training import TrainingCourse, TrainingRequirement  # noqa: E402
from app.models.user import Organization  # noqa: E402

# Below this similarity a suggestion is more distracting than helpful — the
# officer is better served by "no confident match" than by a wrong one.
_SUGGESTION_FLOOR = 0.55


def _is_uuid(value: str) -> bool:
    try:
        UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _enum_value(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _best_match(text: str, courses):
    """Closest library course to a typed-in string, or None.

    Tried in order of confidence: exact name/code match, then substring either
    way (a stored "ICS-100: Introduction to ICS" against a library "ICS-100"),
    then fuzzy ratio. Returns ``(course, confidence_label)``.
    """
    needle = str(text).strip().lower()
    if not needle:
        return None

    for course in courses:
        if needle in (
            (course.name or "").strip().lower(),
            (course.code or "").strip().lower(),
        ):
            return course, "exact"

    for course in courses:
        name = (course.name or "").strip().lower()
        code = (course.code or "").strip().lower()
        if name and (needle in name or name in needle):
            return course, "partial"
        if code and (needle.startswith(code) or code in needle.split()):
            return course, "partial"

    scored = [
        (SequenceMatcher(None, needle, (c.name or "").strip().lower()).ratio(), c)
        for c in courses
        if c.name
    ]
    if scored:
        ratio, course = max(scored, key=lambda pair: pair[0])
        if ratio >= _SUGGESTION_FLOOR:
            return course, f"fuzzy {ratio:.0%}"
    return None


async def _collect(org_filter: str | None, active_only: bool):
    """Return (findings, stats). Findings are per-requirement dicts."""
    async with async_session_factory() as db:
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

        findings = []
        stats = {"requirements_scanned": 0, "entries_scanned": 0, "orgs": len(orgs)}

        for org in orgs:
            # Course library is built per organization on purpose: an id that
            # exists only in another org must count as unresolved, not as a
            # match. That is the cross-tenant case worth surfacing.
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
            requirements = (await db.execute(query)).scalars().all()

            for req in requirements:
                entries = req.required_courses or []
                if not entries:
                    continue
                stats["requirements_scanned"] += 1

                resolved, unresolved, archived = [], [], []
                for entry in entries:
                    stats["entries_scanned"] += 1
                    key = str(entry)
                    course = by_id.get(key)
                    if course is not None:
                        resolved.append(course)
                        if course.active is False:
                            archived.append(course)
                        continue

                    kind = "dangling" if _is_uuid(key) else "name"
                    suggestion = _best_match(key, courses) if kind == "name" else None
                    unresolved.append(
                        {
                            "value": key,
                            "kind": kind,
                            "suggestion": suggestion,
                        }
                    )

                if unresolved:
                    findings.append(
                        {
                            "org": org,
                            "requirement": req,
                            "resolved": resolved,
                            "archived": archived,
                            "unresolved": unresolved,
                        }
                    )

        return findings, stats


def _print_report(findings, stats) -> None:
    bar = "=" * 78
    print(bar)
    print("UNRESOLVED COURSE LINKS ON TRAINING REQUIREMENTS")
    print(bar)
    print(
        f"\nScanned {stats['requirements_scanned']} requirement(s) carrying "
        f"{stats['entries_scanned']} course entr(ies) across "
        f"{stats['orgs']} organization(s).\n"
    )

    if not findings:
        print("No unresolved entries — every linked course resolves in its org.")
        print(f"\n{bar}")
        return

    by_org: dict = {}
    for finding in findings:
        by_org.setdefault(finding["org"].id, []).append(finding)

    blocking = 0
    for org_findings in by_org.values():
        org = org_findings[0]["org"]
        print(f"\n{org.name}  ({org.id})")
        print("-" * 78)

        for finding in org_findings:
            req = finding["requirement"]
            rtype = _enum_value(req.requirement_type)
            total = len(req.required_courses or [])
            broken = len(finding["unresolved"])

            # A courses requirement needs all of them, so any unresolved entry
            # makes it uncompletable; certification still has its name/registry
            # fallback.
            fatal = rtype == "courses"
            if fatal:
                blocking += 1
            marker = "BLOCKING" if fatal else "degraded"
            state = "" if req.active else "  [inactive]"

            print(f"\n  [{marker}] {req.name}{state}")
            print(f"      id={req.id}  type={rtype}  {broken}/{total} unresolved")

            for item in finding["unresolved"]:
                label = "typed-in name" if item["kind"] == "name" else "dangling id"
                print(f"      - {label}: {item['value']!r}")
                if item["suggestion"]:
                    course, confidence = item["suggestion"]
                    code = f" [{course.code}]" if course.code else ""
                    archived = "" if course.active else "  (archived)"
                    print(
                        f"          -> likely {course.name}{code}{archived}"
                        f"  id={course.id}  ({confidence})"
                    )
                else:
                    print("          -> no confident match in the course library")

            if finding["archived"]:
                names = ", ".join(c.name for c in finding["archived"])
                print(f"      note: resolves to archived course(s): {names}")

    print(f"\n{bar}")
    print(f"{len(findings)} requirement(s) with unresolved course links.")
    if blocking:
        print(
            f"{blocking} of them are 'courses' requirements, which need every "
            "linked course — those can never reach 100% until fixed."
        )
    print(
        "\nTo fix: open each requirement and re-pick its courses from the "
        "library.\n"
        "  Department requirements: /training/admin?page=setup&tab=requirements\n"
        "  Pipeline requirements:   the pipeline's Requirements tab\n"
        "Suggestions above are hints, not decisions — confirm each one before "
        "relinking."
    )
    print(bar)


def _to_json(findings, stats) -> str:
    payload = {
        "stats": stats,
        "findings": [
            {
                "organization_id": str(f["org"].id),
                "organization_name": f["org"].name,
                "requirement_id": str(f["requirement"].id),
                "requirement_name": f["requirement"].name,
                "requirement_type": _enum_value(f["requirement"].requirement_type),
                "active": bool(f["requirement"].active),
                "total_entries": len(f["requirement"].required_courses or []),
                "unresolved": [
                    {
                        "value": item["value"],
                        "kind": item["kind"],
                        "suggested_course_id": (
                            str(item["suggestion"][0].id)
                            if item["suggestion"]
                            else None
                        ),
                        "suggested_course_name": (
                            item["suggestion"][0].name if item["suggestion"] else None
                        ),
                        "confidence": (
                            item["suggestion"][1] if item["suggestion"] else None
                        ),
                    }
                    for item in f["unresolved"]
                ],
            }
            for f in findings
        ],
    }
    return json.dumps(payload, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Find training requirements whose required_courses entries do not "
            "resolve to a course in the organization's library."
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
        "--json",
        dest="as_json",
        action="store_true",
        help="Emit JSON instead of the human-readable report",
    )
    args = parser.parse_args()

    async def _main() -> int:
        # Standalone script: bring up the DB engine the app normally starts.
        await database_manager.connect()
        try:
            findings, stats = await _collect(args.org, args.active_only)
        finally:
            await database_manager.disconnect()

        if args.as_json:
            print(_to_json(findings, stats))
        else:
            _print_report(findings, stats)
        return 1 if findings else 0

    try:
        return asyncio.run(_main())
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover - operational safety net
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
