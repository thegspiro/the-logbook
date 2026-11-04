"""The Public Information backfill (revision 289504a34d3c).

Owner decisions 2026-11-03 (workflow review W01-24): existing installations
get Public Information turned on where setup stored it off, but not where an
administrator set it themselves under Settings → Modules. Switching it off is
how a department retires its public portal, so overriding that choice could
resume publishing to an external website.

CLAUDE.md pitfall 35: CI migrates an empty database, so this proves the step
against rows that exist, in every state the migration has to tell apart.
"""

import importlib.util
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261103_2316_289504a34d3c_backfill_public_info_on_where_setup_.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_backfill_public_info", _PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


STAMP = "2026-11-03T23:00:00+00:00"


@pytest.mark.unit
class TestTheDecisions:
    def test_an_explicit_false_is_turned_on_and_marked(self):
        m = _migration()
        settings = {"modules": {"public_info": False, "training": True}}

        updated = m.backfilled(settings, STAMP)

        assert updated["modules"]["public_info"] is True
        assert updated["modules"]["training"] is True
        assert updated["modules"][m.MARKER] == STAMP
        assert settings["modules"]["public_info"] is False  # input untouched

    @pytest.mark.parametrize(
        "settings",
        [
            {"modules": {"public_info": True}},
            {"modules": {"training": True}},  # absent: already the default (on)
            {"modules": {}},
            {},
            None,
            "not json",
        ],
    )
    def test_anything_but_an_explicit_false_is_left_alone(self, settings):
        assert _migration().backfilled(settings, STAMP) is None

    def test_json_text_is_read_as_the_driver_may_return_it(self):
        m = _migration()
        updated = m.backfilled(json.dumps({"modules": {"public_info": False}}), STAMP)

        assert updated["modules"]["public_info"] is True

    @pytest.mark.parametrize(
        ("event_data", "expected"),
        [
            (
                {
                    "settings_changed": ["modules"],
                    "module_updates": {"public_info": False},
                },
                True,
            ),
            ({"module_updates": {"public_info": True}}, True),
            ({"module_updates": {"training": False}}, False),
            ({"settings_changed": ["email"]}, False),
            (json.dumps({"module_updates": {"public_info": False}}), True),
            (None, False),
        ],
    )
    def test_an_admin_choice_is_a_settings_change_naming_public_info(
        self, event_data, expected
    ):
        assert _migration().admin_set_public_info(event_data) is expected

    def test_downgrade_restores_off_and_drops_the_marker(self):
        m = _migration()
        settings = {"modules": {"public_info": True, m.MARKER: STAMP}}

        restored = m.restored(settings, admin_changed_since=False)

        assert restored["modules"] == {"public_info": False}

    def test_downgrade_keeps_a_later_admin_choice(self):
        m = _migration()
        settings = {"modules": {"public_info": True, m.MARKER: STAMP}}

        restored = m.restored(settings, admin_changed_since=True)

        assert restored["modules"] == {"public_info": True}

    def test_downgrade_leaves_an_unmarked_organization_alone(self):
        assert _migration().restored({"modules": {"public_info": True}}, False) is None


async def _org(db_session: AsyncSession, modules: dict) -> str:
    # Inserted directly: OnboardingService.create_organization allows one
    # organization per installation, and the backfill has to be seen telling
    # several apart.
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, slug, settings) "
            "VALUES (:id, :name, :slug, :s)"
        ),
        {
            "id": org_id,
            "name": f"Backfill VFD {org_id[:8]}",
            "slug": f"backfill-{org_id[:8]}",
            "s": json.dumps({"modules": modules}),
        },
    )
    return org_id


async def _user(db_session: AsyncSession, org_id: str) -> str:
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, email) "
            "VALUES (:id, :org, :u, :e)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "u": f"u{user_id[:8]}",
            "e": f"{user_id[:8]}@example.org",
        },
    )
    return user_id


async def _settings_change(
    db_session: AsyncSession,
    *,
    org_id,
    user_id,
    module_updates: dict,
    when: datetime,
):
    await db_session.execute(
        text(
            "INSERT INTO audit_logs (timestamp, timestamp_nanos, event_type, "
            "event_category, severity, user_id, organization_id, event_data) "
            "VALUES (:ts, 0, 'organization_settings_updated', 'administration', "
            "'warning', :user, :org, :data)"
        ),
        {
            "ts": when.replace(tzinfo=None),
            "user": user_id,
            "org": org_id,
            "data": json.dumps(
                {"settings_changed": ["modules"], "module_updates": module_updates}
            ),
        },
    )


async def _modules(db_session: AsyncSession, org_id: str) -> dict:
    raw = await db_session.scalar(
        text("SELECT settings FROM organizations WHERE id = :id"), {"id": org_id}
    )
    return (json.loads(raw) if isinstance(raw, str) else raw)["modules"]


@pytest.mark.integration
class TestAgainstRows:
    async def test_it_changes_only_what_setup_stored(self, db_session: AsyncSession):
        m = _migration()
        before = datetime.now(timezone.utc) - timedelta(days=30)

        from_setup = await _org(db_session, {"public_info": False, "training": True})
        chose_off = await _org(db_session, {"public_info": False})
        await _settings_change(
            db_session,
            org_id=chose_off,
            user_id=await _user(db_session, chose_off),
            module_updates={"public_info": False},
            when=before,
        )
        # An older audit row, written before organization_id was stamped: the
        # acting user still ties it to the department.
        chose_off_old_row = await _org(db_session, {"public_info": False})
        await _settings_change(
            db_session,
            org_id=None,
            user_id=await _user(db_session, chose_off_old_row),
            module_updates={"public_info": False},
            when=before,
        )
        other_change = await _org(db_session, {"public_info": False})
        await _settings_change(
            db_session,
            org_id=other_change,
            user_id=await _user(db_session, other_change),
            module_updates={"training": True},
            when=before,
        )
        already_on = await _org(db_session, {"public_info": True})

        for _ in range(2):  # safe to run twice
            await db_session.run_sync(lambda s: m._upgrade(s.connection()))

        assert (await _modules(db_session, from_setup))["public_info"] is True
        assert (await _modules(db_session, from_setup))["training"] is True
        assert m.MARKER in await _modules(db_session, from_setup)
        assert (await _modules(db_session, other_change))["public_info"] is True
        assert (await _modules(db_session, chose_off))["public_info"] is False
        assert (await _modules(db_session, chose_off_old_row))["public_info"] is False
        assert await _modules(db_session, already_on) == {"public_info": True}

    async def test_downgrade_reverts_it_unless_an_admin_has_chosen_since(
        self, db_session: AsyncSession
    ):
        m = _migration()
        reverted = await _org(db_session, {"public_info": False})
        kept = await _org(db_session, {"public_info": False})

        await db_session.run_sync(lambda s: m._upgrade(s.connection()))
        # An administrator confirms it on after the backfill.
        await _settings_change(
            db_session,
            org_id=kept,
            user_id=await _user(db_session, kept),
            module_updates={"public_info": True},
            when=datetime.now(timezone.utc) + timedelta(minutes=5),
        )

        await db_session.run_sync(lambda s: m._downgrade(s.connection()))

        assert await _modules(db_session, reverted) == {"public_info": False}
        assert await _modules(db_session, kept) == {"public_info": True}
