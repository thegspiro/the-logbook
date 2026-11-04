#!/usr/bin/env python3
"""
List supervision loops already recorded in ``member_supervisor_assignments``.

Since 2026-11-04 the service refuses any new or changed assignment that would
make a member report, directly or through others, to someone they supervise
(owner decision 2026-11-01, "Refuse loops"). Assignments written between the
table's creation (2026-11-01) and that rule were not checked, so a loop could
already exist. This script finds them; it changes nothing. Which assignment in
a loop is the wrong one is a members-manager's call, made on the member's
profile (Reports To) by changing or ending it -- and ending or changing an
assignment is never refused by the loop rule, so a loop can always be broken.

Usage (from backend/):

    python scripts/report_supervision_loops.py

Exit status is 0 when no loop exists and 1 when at least one does, so it can
gate an upgrade check.
"""

import asyncio
import os
import sys


async def _main() -> int:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from sqlalchemy import select

    from app.core.database import async_session_factory, database_manager
    from app.models.user import Organization
    from app.services.member_supervisor_service import MemberSupervisorService

    await database_manager.connect()
    found = 0
    try:
        async with async_session_factory() as db:
            orgs = (await db.execute(select(Organization.id, Organization.name))).all()
            for org_id, org_name in orgs:
                svc = MemberSupervisorService(db)
                loops = await svc.find_existing_loops(str(org_id))
                if not loops:
                    continue
                names = await svc.names_by_id(
                    str(org_id), {i for chain in loops for i in chain}
                )
                for chain in loops:
                    found += 1
                    # chain[0] is supervised by chain[1], and so on; the last
                    # id is supervised by chain[0], closing the loop.
                    described = " reports to ".join(
                        names.get(i, i) for i in [*chain[-1:], *chain]
                    )
                    print(f"{org_name}: {described}")
    finally:
        await database_manager.disconnect()
    if not found:
        print("No supervision loops found.")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
