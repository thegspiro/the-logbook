"""
Tests for the scheduling module configuration service
(app/services/scheduling_module_config_service.py) and its schemas.

DB-backed: defaults when unset, wholesale update persistence, org scoping
(org A's settings never bleed into org B), and reset-to-defaults. Plus
schema-level checks that the wire shape is camelCase and validation rejects
out-of-range values.
"""

import uuid

import pytest
from pydantic import ValidationError

from app.models.user import Organization, User
from app.schemas.scheduling_module_config import (
    ShiftSettingsResponse,
    ShiftSettingsSchema,
)
from app.services.scheduling_module_config_service import (
    DEFAULT_SHIFT_SETTINGS,
    SchedulingModuleConfigService,
)


def _make_payload(**overrides) -> ShiftSettingsSchema:
    base = {
        "defaultDurationHours": 24,
        "defaultMinStaffing": 3,
        "requireAssignmentConfirmation": False,
        "overtimeThresholdHoursPerWeek": 56,
        "enabledPositions": ["officer", "driver", "firefighter"],
        "customPositions": [{"value": "rescue_tech", "label": "Rescue Technician"}],
        "apparatusTypeDefaults": {
            "engine": {"positions": ["officer", "driver"], "minStaffing": 2}
        },
        "resourceTypeDefaults": {
            "first_aid_station": {"positions": ["ems"], "label": "First Aid"}
        },
    }
    base.update(overrides)
    return ShiftSettingsSchema(**base)


async def _make_org(db_session, name: str) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"smc-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.mark.integration
class TestDefaults:
    async def test_defaults_returned_when_unset(self, db_session):
        org = await _make_org(db_session, "SMC Defaults FD")
        service = SchedulingModuleConfigService(db_session)

        settings, row = await service.get_settings(org.id)

        assert row is None
        assert settings == DEFAULT_SHIFT_SETTINGS
        # deepcopy guard: mutating the returned dict must not poison the
        # module-level defaults for the next caller
        settings["apparatus_type_defaults"]["engine"]["minStaffing"] = 99
        fresh, _ = await service.get_settings(org.id)
        assert fresh["apparatus_type_defaults"]["engine"]["minStaffing"] == 4

    async def test_defaults_validate_as_full_schema(self, db_session):
        org = await _make_org(db_session, "SMC Schema FD")
        service = SchedulingModuleConfigService(db_session)
        settings, _ = await service.get_settings(org.id)

        # The GET endpoint builds the response this way; the defaults must
        # satisfy the required-everything schema.
        response = ShiftSettingsResponse(
            settings=ShiftSettingsSchema(**settings), stored=False
        )
        wire = response.model_dump(by_alias=True)
        assert wire["stored"] is False
        assert wire["settings"]["defaultDurationHours"] == 12
        assert wire["settings"]["apparatusTypeDefaults"]["engine"]["minStaffing"] == 4
        assert "equipmentCheckSettings" not in wire["settings"]


@pytest.mark.integration
class TestUpdate:
    async def test_update_persists_and_reads_back(self, db_session):
        org = await _make_org(db_session, "SMC Update FD")
        service = SchedulingModuleConfigService(db_session)
        user_id = str(uuid.uuid4())
        db_session.add(
            User(
                id=user_id,
                organization_id=org.id,
                username=f"smc-{user_id[:8]}",
                email=f"smc-{user_id[:8]}@test.local",
                first_name="Sched",
                last_name="Manager",
                password_hash="x",
            )
        )
        await db_session.flush()

        await service.update_settings(org.id, _make_payload())

        settings, row = await service.get_settings(org.id)
        assert row is not None
        assert settings["default_duration_hours"] == 24
        assert settings["default_min_staffing"] == 3
        assert settings["require_assignment_confirmation"] is False
        assert settings["overtime_threshold_hours_per_week"] == 56
        assert settings["enabled_positions"] == [
            "officer",
            "driver",
            "firefighter",
        ]
        assert settings["custom_positions"] == [
            {"value": "rescue_tech", "label": "Rescue Technician"}
        ]
        # JSON columns keep the camelCase wire shape
        assert settings["apparatus_type_defaults"] == {
            "engine": {"positions": ["officer", "driver"], "minStaffing": 2}
        }
        assert "equipment_check_settings" not in settings
        # user_id is only stamped when passed
        assert row.updated_by is None
        await service.update_settings(org.id, _make_payload(), updated_by=user_id)
        _, row = await service.get_settings(org.id)
        assert row.updated_by == user_id

    async def test_update_is_wholesale_replacement(self, db_session):
        org = await _make_org(db_session, "SMC Wholesale FD")
        service = SchedulingModuleConfigService(db_session)

        await service.update_settings(org.id, _make_payload())
        await service.update_settings(
            org.id,
            _make_payload(
                customPositions=[],
                apparatusTypeDefaults={
                    "boat": {"positions": ["officer"], "minStaffing": 1}
                },
            ),
        )

        settings, _ = await service.get_settings(org.id)
        # Cleared list persists as cleared, and the replaced dict does not
        # merge with the previously stored one
        assert settings["custom_positions"] == []
        assert list(settings["apparatus_type_defaults"].keys()) == ["boat"]

    async def test_update_creates_single_row_per_org(self, db_session):
        org = await _make_org(db_session, "SMC SingleRow FD")
        service = SchedulingModuleConfigService(db_session)

        await service.update_settings(org.id, _make_payload())
        await service.update_settings(org.id, _make_payload(defaultDurationHours=8))

        settings, row = await service.get_settings(org.id)
        assert settings["default_duration_hours"] == 8
        assert row is not None


@pytest.mark.integration
class TestOrgScoping:
    async def test_org_a_settings_never_reach_org_b(self, db_session):
        org_a = await _make_org(db_session, "SMC Org A")
        org_b = await _make_org(db_session, "SMC Org B")
        service = SchedulingModuleConfigService(db_session)

        await service.update_settings(org_a.id, _make_payload(defaultDurationHours=48))

        settings_b, row_b = await service.get_settings(org_b.id)
        assert row_b is None
        assert settings_b == DEFAULT_SHIFT_SETTINGS

        settings_a, row_a = await service.get_settings(org_a.id)
        assert row_a is not None
        assert row_a.organization_id == org_a.id
        assert settings_a["default_duration_hours"] == 48

    async def test_reset_only_clears_own_org(self, db_session):
        org_a = await _make_org(db_session, "SMC Reset A")
        org_b = await _make_org(db_session, "SMC Reset B")
        service = SchedulingModuleConfigService(db_session)

        await service.update_settings(org_a.id, _make_payload(defaultDurationHours=48))
        await service.update_settings(org_b.id, _make_payload(defaultDurationHours=6))

        await service.reset_settings(org_a.id)

        settings_a, row_a = await service.get_settings(org_a.id)
        assert row_a is None
        assert settings_a == DEFAULT_SHIFT_SETTINGS
        settings_b, row_b = await service.get_settings(org_b.id)
        assert row_b is not None
        assert settings_b["default_duration_hours"] == 6


@pytest.mark.integration
class TestReset:
    async def test_reset_when_nothing_stored_is_a_noop(self, db_session):
        org = await _make_org(db_session, "SMC ResetNoop FD")
        service = SchedulingModuleConfigService(db_session)

        await service.reset_settings(org.id)

        settings, row = await service.get_settings(org.id)
        assert row is None
        assert settings == DEFAULT_SHIFT_SETTINGS


class TestSchemaValidation:
    def test_rejects_out_of_range_values(self):
        with pytest.raises(ValidationError):
            _make_payload(defaultDurationHours=0)
        with pytest.raises(ValidationError):
            _make_payload(defaultMinStaffing=-1)
        with pytest.raises(ValidationError):
            _make_payload(overtimeThresholdHoursPerWeek=400)

    def test_accepts_snake_case_too(self):
        # populate_by_name lets backend code build the schema from the
        # service's snake_case dicts
        schema = ShiftSettingsSchema(
            default_duration_hours=12,
            default_min_staffing=4,
            require_assignment_confirmation=True,
            overtime_threshold_hours_per_week=48,
            enabled_positions=["officer"],
            custom_positions=[],
            apparatus_type_defaults={},
            resource_type_defaults={},
        )
        wire = schema.model_dump(by_alias=True)
        assert wire["defaultDurationHours"] == 12
        assert "default_duration_hours" not in wire

    def test_ignores_the_retired_equipment_check_settings_key(self):
        """A browser left open across the deploy still PUTs the old key.

        The four equipment-check switches were stored and read by nothing, so
        they were removed outright. The panel sends the whole settings object on
        every save, which means a stale tab's payload carries a field the schema
        no longer declares — that has to be dropped, not 422'd, or the first
        save after a deploy fails for anyone who did not hard-refresh.
        """
        schema = _make_payload(
            equipmentCheckSettings={
                "enabled": True,
                "requireSignature": True,
                "defaultExpirationWarningDays": 14,
                "blockShiftStartOnFail": True,
            }
        )
        assert not hasattr(schema, "equipment_check_settings")
        assert "equipmentCheckSettings" not in schema.model_dump(by_alias=True)
