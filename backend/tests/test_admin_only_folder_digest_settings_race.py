"""Recording the admin-only folder digest keeps a settings change saved meanwhile.

DOC2-12: the scheduled task loads every organization when it starts, and its
session keeps them past each commit. ``_record_digest`` deep-copied that copy
of ``organization.settings`` (right for pitfall #12) and wrote the whole JSON
column back after the emails went out — so a settings change an administrator
saved in between, such as the enabled modules, was silently undone. The stamp
now re-reads the row under a lock before changing it.

Two sessions committing independently, against the real database.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.core.database import database_manager
from app.models.user import Organization
from app.services.admin_only_folder_digest import _record_digest

pytestmark = [pytest.mark.integration]


@pytest.mark.usefixtures("_initialize_database")
async def test_the_digest_stamp_keeps_a_settings_change_made_meanwhile():
    factory = database_manager.session_factory
    task, admin = factory(), factory()
    org = Organization(
        name="Digest VFD",
        slug=f"digest-{uuid.uuid4().hex[:12]}",
        settings={"modules": {"enabled": ["a"]}},
    )
    task.add(org)
    await task.commit()
    org_id = org.id
    try:
        # The task holds the organization from when it started.
        loaded = (
            await task.execute(select(Organization).where(Organization.id == org_id))
        ).scalar_one()
        other = (
            await admin.execute(select(Organization).where(Organization.id == org_id))
        ).scalar_one()
        changed = dict(other.settings)
        changed["modules"] = {"enabled": ["a", "b"]}
        other.settings = changed
        await admin.commit()

        await _record_digest(task, loaded, date(2026, 11, 26))
        await task.commit()

        check = factory()
        try:
            stored = (
                await check.execute(
                    select(Organization.settings).where(Organization.id == org_id)
                )
            ).scalar_one()
        finally:
            await check.close()
        assert stored["modules"] == {"enabled": ["a", "b"]}
        assert stored["documents"]["admin_only_digest_last_sent"] == "2026-11-26"
    finally:
        cleanup = factory()
        await cleanup.execute(
            Organization.__table__.delete().where(Organization.id == org_id)
        )
        await cleanup.commit()
        await cleanup.close()
        await task.close()
        await admin.close()
