"""The certification expiry alert switches a training manager can set.

``CertAlertService`` already sends the 90/60/30/7-day and expired emails, but
only when ``organization.settings["cert_alert_config"]["enabled"]`` is true, and
nothing but a hand-edited database row could set it. These tests pin the screen's
read and write path: absence reads as off, a save changes only the switches it
was sent and keeps the officer position lists stored beside them, and the write
is refused without ``training.manage``.

The unit half mocks the session. The integration half drives the real routes
over HTTP against the real schema, because the stored JSON and the permission
gate are what is under test.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import text

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import training as ep
from app.core.database import get_db
from app.models.user import Organization, User
from app.schemas.training import CertAlertSettingsUpdate
from app.services.cert_alert_service import ALERT_SWITCHES, CertAlertService


def _org(config=None, **extra):
    settings = dict(extra)
    if config is not None:
        settings["cert_alert_config"] = config
    return SimpleNamespace(id="org-1", settings=settings)


def _db(org):
    found = MagicMock()
    found.scalar_one_or_none.return_value = org
    db = MagicMock()
    db.execute = AsyncMock(return_value=found)
    db.commit = AsyncMock()
    return db


@pytest.mark.unit
class TestReadingTheSwitches:
    async def test_a_department_that_never_set_them_reads_all_off(self):
        settings = await CertAlertService(_db(_org())).get_alert_settings("org-1")

        assert settings == {name: False for name in ALERT_SWITCHES}

    async def test_a_missing_organization_reads_all_off(self):
        settings = await CertAlertService(_db(None)).get_alert_settings("org-1")

        assert settings == {name: False for name in ALERT_SWITCHES}

    async def test_stored_switches_are_reported(self):
        org = _org({"enabled": True, "cc_chief_on_escalation": True})

        settings = await CertAlertService(_db(org)).get_alert_settings("org-1")

        assert settings == {
            "enabled": True,
            "cc_chief_on_escalation": True,
            "include_personal_email_on_final": False,
        }

    async def test_a_config_that_is_not_an_object_reads_as_off_rather_than_raising(
        self,
    ):
        settings = await CertAlertService(_db(_org("on"))).get_alert_settings("org-1")

        assert settings == {name: False for name in ALERT_SWITCHES}


@pytest.mark.unit
class TestWritingTheSwitches:
    async def test_it_changes_only_the_switches_it_was_sent(self):
        org = _org(
            {"enabled": False, "cc_chief_on_escalation": True},
            events={"visible": True},
        )
        db = _db(org)

        result = await CertAlertService(db).update_alert_settings(
            "org-1", {"enabled": True}
        )

        assert result == {
            "enabled": True,
            "cc_chief_on_escalation": True,
            "include_personal_email_on_final": False,
        }
        assert org.settings["cert_alert_config"]["enabled"] is True
        assert org.settings["cert_alert_config"]["cc_chief_on_escalation"] is True
        assert org.settings["events"] == {"visible": True}
        db.commit.assert_awaited_once()

    async def test_the_officer_position_lists_stored_beside_them_survive(self):
        org = _org(
            {
                "enabled": False,
                "training_officer_roles": ["training_officer"],
                "escalation_roles": ["chief"],
            }
        )

        await CertAlertService(_db(org)).update_alert_settings(
            "org-1", {"enabled": True}
        )

        config = org.settings["cert_alert_config"]
        assert config["training_officer_roles"] == ["training_officer"]
        assert config["escalation_roles"] == ["chief"]

    async def test_it_assigns_a_new_object_so_the_update_is_not_skipped(self):
        org = _org({"enabled": False})
        before = org.settings

        await CertAlertService(_db(org)).update_alert_settings(
            "org-1", {"enabled": True}
        )

        assert org.settings is not before
        assert before["cert_alert_config"]["enabled"] is False

    async def test_a_department_with_no_config_gets_one(self):
        org = _org()

        await CertAlertService(_db(org)).update_alert_settings(
            "org-1", {"enabled": True}
        )

        assert org.settings["cert_alert_config"] == {"enabled": True}

    async def test_a_stored_config_that_is_not_an_object_is_replaced(self):
        org = _org("on")

        await CertAlertService(_db(org)).update_alert_settings(
            "org-1", {"enabled": True}
        )

        assert org.settings["cert_alert_config"] == {"enabled": True}

    async def test_a_missing_organization_changes_nothing(self):
        db = _db(None)

        result = await CertAlertService(db).update_alert_settings(
            "org-1", {"enabled": True}
        )

        assert result is None
        db.commit.assert_not_awaited()


@pytest.mark.unit
class TestTheUpdatePayload:
    def test_an_omitted_switch_is_not_part_of_the_change(self):
        update = CertAlertSettingsUpdate(enabled=True)

        assert update.model_dump(exclude_unset=True) == {"enabled": True}

    @pytest.mark.parametrize("name", ALERT_SWITCHES)
    def test_an_explicit_null_is_refused(self, name):
        with pytest.raises(ValidationError):
            CertAlertSettingsUpdate(**{name: None})

    def test_a_switch_that_does_not_exist_is_refused(self):
        with pytest.raises(ValidationError):
            CertAlertSettingsUpdate(enabled=True, cc_everyone=True)


@pytest.fixture
async def world(db_session):
    org = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id,'D','fire_department',:s,'UTC')"
        ),
        {"id": org, "s": f"d-{org[:8]}"},
    )

    async def member(permissions):
        uid, pid = str(uuid.uuid4()), str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id,:o,:u,'A','B',:e,'h','active')"
            ),
            {"id": uid, "o": org, "u": f"u-{uid[:8]}", "e": f"{uid[:8]}@t.example"},
        )
        await db_session.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, permissions) "
                "VALUES (:id,:o,:n,:s,:p)"
            ),
            {
                "id": pid,
                "o": org,
                "n": f"P-{pid[:6]}",
                "s": f"p-{pid[:6]}",
                "p": '["' + '","'.join(permissions) + '"]',
            },
        )
        await db_session.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u,:p)"),
            {"u": uid, "p": pid},
        )
        await db_session.flush()
        user = await db_session.get(User, uid)
        await db_session.refresh(user, ["positions"])
        return user

    return SimpleNamespace(
        org=org,
        manager=await member(["training.manage"]),
        ordinary=await member(["training.view"]),
    )


def _client(db, user):
    app = FastAPI()
    app.include_router(ep.router, prefix="/t")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://t",
    )


@pytest.mark.integration
class TestTheRoutes:
    async def test_a_new_department_reads_all_off(self, db_session, world):
        async with _client(db_session, world.manager) as c:
            r = await c.get("/t/certifications/alert-settings")

        assert r.status_code == 200
        assert r.json() == {name: False for name in ALERT_SWITCHES}

    async def test_a_save_is_stored_and_read_back(self, db_session, world):
        async with _client(db_session, world.manager) as c:
            put = await c.put(
                "/t/certifications/alert-settings",
                json={"enabled": True, "include_personal_email_on_final": True},
            )
            got = await c.get("/t/certifications/alert-settings")

        expected = {
            "enabled": True,
            "cc_chief_on_escalation": False,
            "include_personal_email_on_final": True,
        }
        assert put.status_code == 200
        assert put.json() == expected
        assert got.json() == expected
        org = await db_session.get(Organization, world.org)
        await db_session.refresh(org)
        assert org.settings["cert_alert_config"]["enabled"] is True

    async def test_a_second_save_keeps_the_switches_it_did_not_send(
        self, db_session, world
    ):
        async with _client(db_session, world.manager) as c:
            await c.put(
                "/t/certifications/alert-settings",
                json={"enabled": True, "cc_chief_on_escalation": True},
            )
            r = await c.put("/t/certifications/alert-settings", json={"enabled": False})

        assert r.json() == {
            "enabled": False,
            "cc_chief_on_escalation": True,
            "include_personal_email_on_final": False,
        }

    @pytest.mark.parametrize(
        "body", [{"enabled": None}, {"enabled": "maybe"}, {"x": 1}]
    )
    async def test_a_bad_payload_is_a_422(self, db_session, world, body):
        async with _client(db_session, world.manager) as c:
            r = await c.put("/t/certifications/alert-settings", json=body)

        assert r.status_code == 422

    async def test_a_member_without_training_manage_can_neither_read_nor_write(
        self, db_session, world
    ):
        async with _client(db_session, world.ordinary) as c:
            got = await c.get("/t/certifications/alert-settings")
            put = await c.put(
                "/t/certifications/alert-settings", json={"enabled": True}
            )

        assert got.status_code == 403
        assert put.status_code == 403
        org = await db_session.get(Organization, world.org)
        await db_session.refresh(org)
        assert "cert_alert_config" not in (org.settings or {})
