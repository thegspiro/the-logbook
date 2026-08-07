"""
CS-9 (officer #6): ISO-readiness hour aggregation must count a member's records
even if the record's user_id arrives as a UUID rather than the String(36) value
it is today — member_ids is a set of str(id) and member_hours is keyed by those
strings, so an un-normalized UUID would silently drop the member's hours. DB
mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.services.compliance_officer_service import ISOReadinessService


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


class TestISOReadinessUserIdNormalization:
    async def test_uuid_typed_record_user_id_is_still_counted(self):
        member_id = uuid4()  # str(m.id) will key member_hours
        member = SimpleNamespace(id=member_id)
        # A record whose user_id is a UUID object (not the str it is in prod).
        record = SimpleNamespace(
            user_id=member_id,
            training_type="driver_training",  # -> Driver/Operator (needs 12h)
            hours_completed=12,
        )
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalars([member]), _scalars([record])])
        result = await ISOReadinessService(db).get_iso_readiness("org-1", 2026)

        driver_cat = next(
            c for c in result["categories"] if c["name"] == "Driver/Operator Training"
        )
        # The member met the 12h requirement — proves the UUID user_id matched.
        assert driver_cat["members_meeting_requirement"] == 1
