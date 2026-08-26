"""An EMS-only service is not offered a fire department's rigs.

``DEFAULT_APPARATUS_TYPE_DEFAULTS`` seated engine, ladder, tanker, brush, tower
and hazmat for every organization. An EMS-only service does not own any of
them, so its scheduling settings opened on six staffing templates it can never
use — and the settings panel offered no way to remove them.

Two things make this different from the rank and position seeds:

* **Nothing seeds this table.** ``get_settings`` reads the built-ins live on
  every request and folds a stored row over them, and a row exists only once an
  admin has saved the panel. So this reaches every organization that has never
  saved, immediately — not just new ones.
* **The crew slots are untouched.** ``"firefighter"`` inside these entries is a
  ``ShiftPosition`` — a seat on a rig, a different namespace from rank codes and
  position slugs — persisted verbatim into three untyped JSON columns. Only the
  *selection* of apparatus types varies by agency.
"""

import uuid

import pytest
from sqlalchemy import text

from app.services.scheduling_module_config_service import (
    DEFAULT_APPARATUS_TYPE_DEFAULTS,
    DEFAULT_SHIFT_SETTINGS,
    SchedulingModuleConfigService,
    apparatus_type_defaults_for,
)

pytestmark = pytest.mark.unit

_FIRE_ONLY = ("engine", "ladder", "tanker", "brush", "tower", "hazmat")

#: What an EMS-only service keeps. Spelled out rather than derived, so an
#: apparatus type added later has to be classified instead of inherited.
_EMS_TYPES = {"ambulance", "rescue", "boat", "chief", "utility"}


class TestTheSelection:
    def test_an_ems_service_is_offered_no_fire_apparatus(self):
        offered = apparatus_type_defaults_for("ems_only")
        for code in _FIRE_ONLY:
            assert code not in offered, f"an EMS-only service does not run a {code}"

    def test_an_ems_service_keeps_its_own_rigs(self):
        assert set(apparatus_type_defaults_for("ems_only")) == _EMS_TYPES

    def test_a_fire_department_is_unchanged(self):
        assert (
            apparatus_type_defaults_for("fire_department")
            is DEFAULT_APPARATUS_TYPE_DEFAULTS
        )

    @pytest.mark.parametrize("org_type", [None, "", "fire_ems_combined", "new_kind"])
    def test_anything_else_gets_the_full_set(self, org_type):
        # Same fallback direction as the rank and position seeds: a department
        # shown one rig too many can ignore it, one shown too few has no
        # indication anything is absent.
        assert set(apparatus_type_defaults_for(org_type)) == set(
            DEFAULT_APPARATUS_TYPE_DEFAULTS
        )

    def test_nothing_is_invented(self):
        """Withheld, never replaced — no new type, no new staffing number."""
        for code, entry in apparatus_type_defaults_for("ems_only").items():
            assert entry is DEFAULT_APPARATUS_TYPE_DEFAULTS[code]

    def test_the_seat_vocabulary_is_untouched(self):
        """Filtering seats would orphan rows; filtering types does not.

        An EMT is already eligible for a ``firefighter`` seat via the EMT rank's
        ``eligible_positions``, so the seat names buy nothing by changing and
        cost every stored ``positions`` JSON column if they do.
        """
        ems = apparatus_type_defaults_for("ems_only")
        assert ems["ambulance"]["positions"] == ["driver", "ems", "ems"]
        assert ems["rescue"]["positions"] == [
            "officer",
            "driver",
            "firefighter",
            "firefighter",
        ]


class TestTheSettingsShape:
    def test_every_settings_field_survives_the_narrowing(self):
        """``_SETTINGS_COLUMNS`` is derived from the full shape.

        Narrowing the apparatus defaults must never narrow the set of stored
        fields, or ``update_settings`` writes an incomplete row.
        """
        from app.services.scheduling_module_config_service import _SETTINGS_COLUMNS

        assert set(_SETTINGS_COLUMNS) == set(DEFAULT_SHIFT_SETTINGS)
        assert "apparatus_type_defaults" in _SETTINGS_COLUMNS


async def _org(db_session, organization_type: str) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, slug, organization_type, timezone) "
            "VALUES (:id, :n, :s, :t, 'America/New_York')"
        ),
        {
            "id": org_id,
            "n": f"Agency {org_id[:8]}",
            "s": f"agency-{org_id[:8]}",
            "t": organization_type,
        },
    )
    await db_session.flush()
    return org_id


@pytest.mark.integration
class TestGetSettingsReadsTheAgency:
    async def test_an_ems_service_reads_no_engine(self, db_session):
        org_id = await _org(db_session, "ems_only")
        settings, row = await SchedulingModuleConfigService(db_session).get_settings(
            org_id
        )
        assert row is None, "no row: this org is reading the built-ins live"
        assert "engine" not in settings["apparatus_type_defaults"]
        assert "ambulance" in settings["apparatus_type_defaults"]

    async def test_a_fire_department_reads_the_full_set(self, db_session):
        org_id = await _org(db_session, "fire_department")
        settings, _ = await SchedulingModuleConfigService(db_session).get_settings(
            org_id
        )
        assert settings == DEFAULT_SHIFT_SETTINGS

    async def test_the_narrowed_copy_is_still_a_copy(self, db_session):
        """The deepcopy guard has to survive the agency lookup.

        Mutating what a caller was handed must not poison the module constant
        for the next request.
        """
        org_id = await _org(db_session, "ems_only")
        service = SchedulingModuleConfigService(db_session)
        settings, _ = await service.get_settings(org_id)
        settings["apparatus_type_defaults"]["ambulance"]["minStaffing"] = 99

        fresh, _ = await service.get_settings(org_id)
        assert fresh["apparatus_type_defaults"]["ambulance"]["minStaffing"] == 2
        assert DEFAULT_APPARATUS_TYPE_DEFAULTS["ambulance"]["minStaffing"] == 2

    async def test_an_unresolvable_organization_gets_the_full_set(self, db_session):
        settings, _ = await SchedulingModuleConfigService(db_session).get_settings(
            str(uuid.uuid4())
        )
        assert set(settings["apparatus_type_defaults"]) == set(
            DEFAULT_APPARATUS_TYPE_DEFAULTS
        )
