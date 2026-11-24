"""Each outreach request type can carry a preset of the roles it usually needs.

Owner decision, 2026-11-20: an organizer sets a signup sheet's roles starting
from a preset kept per request type in Event settings. A preset is held to
what a sheet allows — roles the department has configured, and no more seats
than a sheet holds — and a type without one is stored as it always was.
"""

import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.user import Organization, User, UserStatus
from app.schemas.event import EventSettingsUpdate, OutreachEventType
from app.utils.outreach_roles import settle_type_role_presets

ROLES = [
    {"value": "tour_guide", "label": "Tour Guide"},
    {"value": "greeter", "label": "Greeter"},
]


@pytest.mark.unit
class TestSettlingPresets:
    def test_a_preset_is_stored_in_the_canonical_shape(self):
        settled = settle_type_role_presets(
            [
                {
                    "value": "station_tour",
                    "label": "Station Tour",
                    "default_roles": [
                        {"role": "tour_guide", "count": 2},
                        {"role": "tour_guide", "count": 1},
                        {"role": "greeter", "count": 1},
                    ],
                }
            ],
            ROLES,
        )
        assert settled == [
            {
                "value": "station_tour",
                "label": "Station Tour",
                "default_roles": [
                    {"role": "tour_guide", "count": 3, "essential": True},
                    {"role": "greeter", "count": 1, "essential": True},
                ],
            }
        ]

    def test_a_preset_keeps_an_optional_role(self):
        # Through the schema, as a save arrives: OutreachRoleNeed once dropped
        # the flag, and every preset role read back as essential.
        typed = OutreachEventType(
            value="station_tour",
            label="Station Tour",
            default_roles=[
                {"role": "tour_guide", "count": 2},
                {"role": "greeter", "count": 1, "essential": False},
            ],
        )
        settled = settle_type_role_presets([typed.model_dump()], ROLES)
        assert settled[0]["default_roles"] == [
            {"role": "tour_guide", "count": 2, "essential": True},
            {"role": "greeter", "count": 1, "essential": False},
        ]

    @pytest.mark.parametrize("preset", [None, []])
    def test_a_type_without_a_preset_is_stored_as_before(self, preset):
        settled = settle_type_role_presets(
            [{"value": "other", "label": "Other", "default_roles": preset}], ROLES
        )
        assert settled == [{"value": "other", "label": "Other"}]

    def test_an_unknown_role_is_refused_not_dropped(self):
        with pytest.raises(ValueError, match="Station Tour: unknown role"):
            settle_type_role_presets(
                [
                    {
                        "value": "station_tour",
                        "label": "Station Tour",
                        "default_roles": [{"role": "puppeteer", "count": 1}],
                    }
                ],
                ROLES,
            )

    def test_a_preset_larger_than_a_sheet_is_refused(self):
        with pytest.raises(ValueError, match="at most 50"):
            settle_type_role_presets(
                [
                    {
                        "value": "fair",
                        "label": "County Fair",
                        "default_roles": [
                            {"role": "tour_guide", "count": 30},
                            {"role": "greeter", "count": 30},
                        ],
                    }
                ],
                ROLES,
            )

    def test_the_schema_bounds_a_count(self):
        with pytest.raises(ValidationError):
            OutreachEventType(
                value="x", label="X", default_roles=[{"role": "greeter", "count": 0}]
            )


@pytest.mark.integration
class TestSavingPresets:
    async def _manager(self, db) -> User:
        org = Organization(
            name="Preset FD",
            slug=f"preset-{uuid.uuid4().hex[:10]}",
            timezone="UTC",
            settings={},
        )
        db.add(org)
        await db.flush()
        user = User(
            organization_id=org.id,
            username=f"mgr-{org.id[:8]}",
            email=f"mgr-{org.id[:8]}@example.test",
            first_name="Casey",
            last_name="Morgan",
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        await db.flush()
        return user

    async def _save(self, db, manager, **updates):
        from app.api.v1.endpoints.events import update_event_settings

        return await update_event_settings(
            EventSettingsUpdate(**updates), db=db, current_user=manager
        )

    async def test_a_preset_is_saved_against_the_departments_roles(self, db_session):
        manager = await self._manager(db_session)
        merged = await self._save(
            db_session,
            manager,
            outreach_event_types=[
                {
                    "value": "station_tour",
                    "label": "Station Tour",
                    "default_roles": [{"role": "tour_guide", "count": 2}],
                },
                {"value": "other", "label": "Other"},
            ],
        )
        assert merged["outreach_event_types"] == [
            {
                "value": "station_tour",
                "label": "Station Tour",
                "default_roles": [
                    {"role": "tour_guide", "count": 2, "essential": True}
                ],
            },
            {"value": "other", "label": "Other"},
        ]

    async def test_a_role_saved_in_the_same_update_is_known(self, db_session):
        manager = await self._manager(db_session)
        merged = await self._save(
            db_session,
            manager,
            outreach_roles=[{"value": "car_seat_tech", "label": "Car Seat Tech"}],
            outreach_event_types=[
                {
                    "value": "car_seat_check",
                    "label": "Car Seat Check",
                    "default_roles": [{"role": "car_seat_tech", "count": 2}],
                }
            ],
        )
        assert merged["outreach_event_types"][0]["default_roles"] == [
            {"role": "car_seat_tech", "count": 2, "essential": True}
        ]

    async def test_an_unknown_role_is_a_400(self, db_session):
        manager = await self._manager(db_session)
        with pytest.raises(HTTPException) as exc:
            await self._save(
                db_session,
                manager,
                outreach_event_types=[
                    {
                        "value": "station_tour",
                        "label": "Station Tour",
                        "default_roles": [{"role": "puppeteer", "count": 1}],
                    }
                ],
            )
        assert exc.value.status_code == 400
