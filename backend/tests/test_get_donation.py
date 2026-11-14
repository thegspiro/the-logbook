"""GET /grants/donations/{id}: the one donation the edit page loads (W69).

A donation's PUT worked but nothing could load a single gift to edit it. The
new read is scoped to the caller's department, and it presents an anonymous
gift exactly as the list does (GF-8), so asking for one row is no way around
the list's privacy.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization
from app.services.fundraising_service import FundraisingService

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


def _donation(**overrides):
    values = {
        "id": str(uuid.uuid4()),
        "organization_id": str(uuid.uuid4()),
        "campaign_id": None,
        "donor_id": str(uuid.uuid4()),
        "amount": Decimal("250.00"),
        "donation_date": NOW,
        "payment_method": "check",
        "payment_status": "completed",
        "is_recurring": False,
        "recurring_frequency": None,
        "is_anonymous": True,
        "donor_name": "Pat Quinn",
        "donor_email": "pat@example.org",
        "dedication_type": None,
        "dedication_name": None,
        "notes": None,
        "tax_deductible": True,
        "currency": "USD",
        "transaction_id": None,
        "check_number": None,
        "receipt_sent": False,
        "thank_you_sent": False,
        "custom_fields": None,
        "recorded_by": None,
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _user():
    return SimpleNamespace(id=uuid.uuid4(), organization_id=uuid.uuid4())


@pytest.mark.unit
class TestEndpoint:
    @pytest.mark.parametrize(
        ("can_manage", "expected"), [(False, None), (True, "Pat Quinn")]
    )
    async def test_an_anonymous_gift_reads_as_the_list_reads_it(
        self, monkeypatch, can_manage, expected
    ):
        from app.api.v1.endpoints import grants as endpoint

        service = MagicMock()
        service.get_donation = AsyncMock(return_value=_donation())
        monkeypatch.setattr(endpoint, "FundraisingService", lambda _db: service)
        monkeypatch.setattr(endpoint, "user_has_permission", lambda _u, _p: can_manage)

        out = await endpoint.get_donation(
            donation_id=uuid.uuid4(), db=MagicMock(), current_user=_user()
        )

        assert out.donor_name == expected

    async def test_a_missing_gift_is_a_404(self, monkeypatch):
        from app.api.v1.endpoints import grants as endpoint

        service = MagicMock()
        service.get_donation = AsyncMock(return_value=None)
        monkeypatch.setattr(endpoint, "FundraisingService", lambda _db: service)

        with pytest.raises(HTTPException) as missing:
            await endpoint.get_donation(
                donation_id=uuid.uuid4(), db=MagicMock(), current_user=_user()
            )

        assert missing.value.status_code == 404


@pytest.mark.integration
class TestServiceScope:
    async def _org(self, db: AsyncSession) -> Organization:
        org = Organization(
            id=str(uuid.uuid4()),
            name="Donation Read VFD",
            slug=f"donation-read-{uuid.uuid4().hex[:8]}",
            timezone="America/Chicago",
        )
        db.add(org)
        await db.flush()
        return org

    async def test_reads_its_own_departments_gift_and_not_anothers(
        self, db_session: AsyncSession
    ):
        mine = await self._org(db_session)
        other = await self._org(db_session)
        service = FundraisingService(db_session)
        gift = await service.create_donation(
            mine.id,
            {
                "amount": Decimal("40.00"),
                "donation_date": NOW,
                "payment_method": "cash",
                "payment_status": "completed",
                "donor_name": "Sam Lee",
            },
            None,
        )

        assert (await service.get_donation(gift.id, mine.id)).id == gift.id
        assert await service.get_donation(gift.id, other.id) is None
