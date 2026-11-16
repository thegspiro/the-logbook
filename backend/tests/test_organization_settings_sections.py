"""``GET /organization/settings`` returns the sections the screens read.

The handler converts the service's ``OrganizationSettings`` into
``OrganizationSettingsResponse``, which copies only the fields the response
declares. Every other stored section was dropped, so the scheduling
notifications panel never saw a saved value: it showed its built-in defaults,
and a save from it wrote those defaults over the department's configuration.
``station_mode`` was lost the same way, so the Locations page never showed the
mode it had saved.

The endpoint is open to every signed-in member, so the notification sections
(which carry CC addresses and position keys) go only to those who may manage
settings or scheduling; ``station_mode`` goes to everyone; any other stored
section stays out, as before.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest

import app.api.v1.endpoints.organizations as orgs
from app.models.user import Organization
from app.schemas.organization import OrganizationSettingsResponse

pytestmark = [pytest.mark.integration]

NOTIFICATION_SECTIONS = (
    "scheduling",
    "scheduling_assignment",
    "shift_reminders",
    "equipment_check_alerts",
)


async def _get(db_session, permissions):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Settings Sections FD",
        slug=f"sections-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={
            "scheduling": {"notify_roles": ["lieutenant"], "send_email": True},
            "scheduling_assignment": {"send_email": True},
            "shift_reminders": {"lookahead_hours": 6},
            "equipment_check_alerts": {"notify_roles": ["captain"]},
            "station_mode": "multi_station",
            "officer_directory": {"chief_email": "chief@example.com"},
        },
    )
    db_session.add(org)
    await db_session.flush()
    caller = SimpleNamespace(id=str(uuid.uuid4()), organization_id=org.id)
    with patch.object(orgs, "_collect_user_permissions", return_value=set(permissions)):
        body = await orgs.get_organization_settings(db=db_session, current_user=caller)
    # What FastAPI does with the returned dict before serializing it.
    return OrganizationSettingsResponse.model_validate(body).model_dump()


async def test_a_scheduling_manager_reads_the_saved_notification_sections(db_session):
    body = await _get(db_session, {"scheduling.manage"})

    assert body["scheduling"]["notify_roles"] == ["lieutenant"]
    assert body["scheduling"]["send_email"] is True
    assert body["scheduling_assignment"] == {"send_email": True}
    assert body["shift_reminders"] == {"lookahead_hours": 6}
    assert body["equipment_check_alerts"]["notify_roles"] == ["captain"]


async def test_a_settings_administrator_reads_them_too(db_session):
    body = await _get(db_session, {"settings.manage"})

    assert set(NOTIFICATION_SECTIONS) <= set(body)


async def test_a_member_gets_station_mode_but_not_the_notification_sections(
    db_session,
):
    body = await _get(db_session, set())

    assert body["station_mode"] == "multi_station"
    assert not set(NOTIFICATION_SECTIONS) & set(body)


async def test_other_stored_sections_stay_out_for_everyone(db_session):
    for permissions in (set(), {"scheduling.manage"}, {"settings.manage"}):
        body = await _get(db_session, permissions)
        assert "officer_directory" not in body
