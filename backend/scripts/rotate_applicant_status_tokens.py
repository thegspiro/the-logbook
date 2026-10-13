#!/usr/bin/env python3
"""
Rotate every applicant status token in one department, on request (W17-3).

Applicant labels printed before the W17-3 fix (2026-09-28) carry the
applicant's live status token, the bearer credential behind the public
application-status page. The fix stopped printing it; it could not recall
labels already printed. Rotating the tokens is how a department that is
concerned about those labels revokes them.

What it costs
-------------
**Every status link already emailed to that department's applicants stops
working**, not just the ones on labels — the token on the label and the token
in the email are the same token. Nothing is re-sent by this script. An
applicant gets a working link again from the next pipeline email that carries
the status tracker, or when they reach an Enable Status Page stage; until then
their old link opens nothing. That is why this is per-department and on
request rather than applied everywhere.

Which applicants
----------------
Every applicant in the department who holds a token, whatever their status:
a label could have been printed for any of them. Each gets a fresh
``secrets.token_urlsafe(32)`` — the same kind of token a new application gets —
and ``status_token_created_at`` is reset with it, as it is wherever a token is
issued. The stored hash follows the token automatically (the model's
validator), so the old token stops resolving the moment this commits.

Safety
------
* **Dry run by default.** Nothing is written without ``--apply``.
* **One department per run.** ``--org`` is required and must match exactly one
  organization (its id, or its exact name, case-insensitive).
* **Audit trail.** One ``applicant_status_tokens_rotated`` audit event per run
  records the department, the count and the applicant ids — never a token.

Usage:

    # See how many applicants would be affected (writes nothing):
    docker exec -it intranet-backend python scripts/rotate_applicant_status_tokens.py \\
        --org "Falls Church Volunteer Fire Department"

    # Rotate:
    docker exec -it intranet-backend python scripts/rotate_applicant_status_tokens.py \\
        --org "Falls Church Volunteer Fire Department" --apply

Exit codes:
    0 — success (dry run or apply)
    1 — --org matched no organization, or more than one
    2 — database connection error or unhandled exception
"""

import argparse
import asyncio
import os
import secrets
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select  # noqa: E402

from app.core.audit import log_audit_event  # noqa: E402
from app.core.database import (  # noqa: E402
    async_session_factory,
    database_manager,
)
from app.models.membership_pipeline import ProspectiveMember  # noqa: E402
from app.models.user import Organization  # noqa: E402

SOURCE = "scripts/rotate_applicant_status_tokens.py"


class OrgNotFound(Exception):
    pass


async def resolve_org(db, org_filter: str) -> Organization:
    """The one organization *org_filter* names, by id or exact name.

    Exact rather than substring, unlike the report scripts: rotating the wrong
    department's tokens breaks links nobody asked to break.
    """
    needle = org_filter.strip().lower()
    orgs = (await db.execute(select(Organization))).scalars().all()
    matches = [
        o
        for o in orgs
        if str(o.id) == org_filter.strip() or (o.name or "").strip().lower() == needle
    ]
    if len(matches) != 1:
        raise OrgNotFound(
            f"--org {org_filter!r} matched {len(matches)} organizations; "
            "give the organization's id or its exact name"
        )
    return matches[0]


async def plan(db, org: Organization) -> list:
    """The applicants in *org* whose token would be rotated."""
    return list(
        (
            await db.execute(
                select(ProspectiveMember)
                .where(ProspectiveMember.organization_id == str(org.id))
                .where(ProspectiveMember.status_token_hash.isnot(None))
                .order_by(ProspectiveMember.id)
            )
        )
        .scalars()
        .all()
    )


async def apply(db, org: Organization, prospects: list) -> int:
    """Give each applicant a fresh token and record one audit event."""
    if not prospects:
        return 0
    now = datetime.now(timezone.utc)
    for prospect in prospects:
        prospect.status_token = secrets.token_urlsafe(32)
        prospect.status_token_created_at = now
    await log_audit_event(
        db=db,
        event_type="applicant_status_tokens_rotated",
        event_category="membership",
        severity="warning",
        event_data={
            "organization_id": str(org.id),
            "count": len(prospects),
            "prospect_ids": [str(p.id) for p in prospects],
            "reason": "W17-3: revoke status tokens printed on applicant labels",
            "applied_by": SOURCE,
        },
        organization_id=str(org.id),
    )
    await db.commit()
    return len(prospects)


def _print(org: Organization, prospects: list, applying: bool) -> None:
    bar = "=" * 78
    verb = "APPLYING" if applying else "DRY RUN — no changes written"
    print(bar)
    print(f"ROTATE APPLICANT STATUS TOKENS  ({verb})")
    print(bar)
    print(f"\nDepartment: {org.name} ({org.id})")
    print(f"Applicants holding a status token: {len(prospects)}")
    if prospects:
        print(
            "\nEvery status link already emailed to these applicants, and every"
            "\nprinted label, stops working. Nothing is re-sent; an applicant gets"
            "\na working link from the next pipeline email that carries one."
        )
        if not applying:
            print("\nRe-run with --apply to rotate them.")
    print(f"\n{bar}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Rotate every applicant status token in one department, revoking "
            "printed labels and every status link already emailed."
        )
    )
    parser.add_argument(
        "--org",
        metavar="ID_OR_EXACT_NAME",
        required=True,
        help="The one organization to rotate (its id, or its exact name)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Rotate the tokens (without this, the run is a dry run)",
    )
    args = parser.parse_args()

    async def _main() -> int:
        await database_manager.connect()
        try:
            async with async_session_factory() as db:
                try:
                    org = await resolve_org(db, args.org)
                except OrgNotFound as exc:
                    print(f"ERROR: {exc}", file=sys.stderr)
                    return 1
                prospects = await plan(db, org)
                _print(org, prospects, args.apply)
                if args.apply:
                    rotated = await apply(db, org, prospects)
                    print(f"Rotated {rotated} status token(s).")
                return 0
        finally:
            await database_manager.disconnect()

    try:
        return asyncio.run(_main())
    except Exception as exc:  # pragma: no cover - operational safety net
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
