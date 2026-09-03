"""The last-seals payload is camelCase, because the check form reads it that way.

`GET /equipment-checks/templates/{id}/last-seals` returns a bare dict keyed by
compartment id rather than a response schema, so it carries none of the alias
generation every other endpoint gets for free. It answered `seal_number` /
`checked_at`; `LastSealRecord` in the frontend declares `sealNumber` /
`checkedAt`, and `getLastCheckSeals` casts the response without mapping it.

Every lookup was therefore `undefined`. `SealPanel` prefills its input from the
last count and computes `canClear` by comparing against it, so with no number
to compare the tag never prefilled, the panel reported "No seal recorded at the
last count" on a bag whose seal *had* been recorded, and the one-tap
clear-the-contents shortcut — the whole point of a tamper seal — could not be
reached at any number the crew typed.

The service keeps snake_case and is covered by `test_equipment_check_seals_db`;
what is asserted here is the boundary conversion, which is what the browser
sees.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import app.api.v1.endpoints.equipment_check as equipment_check

pytestmark = [pytest.mark.unit]

BAG = str(uuid4())
CHECKED_AT = "2026-08-31T22:23:42+00:00"


async def _call(monkeypatch, service_payload):
    fake = SimpleNamespace(get_last_check_seals=AsyncMock(return_value=service_payload))
    monkeypatch.setattr(equipment_check, "EquipmentCheckService", lambda db: fake)
    return await equipment_check.get_last_check_seals(
        template_id="tpl-1",
        apparatus_id=None,
        db=AsyncMock(),
        current_user=SimpleNamespace(id=uuid4(), organization_id="org-1"),
    )


class TestLastSealsShape:
    async def test_keys_are_the_ones_the_check_form_reads(self, monkeypatch):
        """The regression: snake_case here is invisible until a crew taps."""
        result = await _call(
            monkeypatch,
            {
                BAG: {
                    "seal_number": "M3-40817",
                    "intact": True,
                    "checked_at": CHECKED_AT,
                }
            },
        )

        assert set(result[BAG]) == {"sealNumber", "intact", "checkedAt"}
        assert result[BAG]["sealNumber"] == "M3-40817"
        assert result[BAG]["intact"] is True
        assert result[BAG]["checkedAt"] == CHECKED_AT

    async def test_a_broken_seal_keeps_its_verdict(self, monkeypatch):
        """`intact` decides whether a match may clear the contents at all, so
        it has to survive the conversion as a boolean rather than a truthy."""
        result = await _call(
            monkeypatch,
            {
                BAG: {
                    "seal_number": "M3-40817",
                    "intact": False,
                    "checked_at": CHECKED_AT,
                }
            },
        )

        assert result[BAG]["intact"] is False

    async def test_no_seals_is_an_empty_object(self, monkeypatch):
        assert await _call(monkeypatch, {}) == {}

    async def test_every_compartment_is_converted(self, monkeypatch):
        other = str(uuid4())
        result = await _call(
            monkeypatch,
            {
                BAG: {"seal_number": "A", "intact": True, "checked_at": CHECKED_AT},
                other: {"seal_number": "B", "intact": True, "checked_at": CHECKED_AT},
            },
        )

        assert result[BAG]["sealNumber"] == "A"
        assert result[other]["sealNumber"] == "B"
