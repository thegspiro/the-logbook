"""
Anonymous gifts hide the donor from fundraising.view, not from .manage (GF-8).

``is_anonymous`` on a donation (and on a donor) had no effect: every reader
with ``fundraising.view`` got the donor's name, email and id. The owner chose
to hide identity from view-only callers and keep it for ``fundraising.manage``,
who record gifts and send the receipts.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import mysql

from app.services.donor_privacy import present_donation, present_donor

pytestmark = pytest.mark.unit

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
ORG = str(uuid.uuid4())


def _donation(**overrides):
    values = {
        "id": str(uuid.uuid4()),
        "organization_id": ORG,
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
        "check_number": "1041",
        "receipt_sent": False,
        "thank_you_sent": False,
        "custom_fields": None,
        "recorded_by": None,
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _donor(**overrides):
    values = {
        "id": str(uuid.uuid4()),
        "organization_id": ORG,
        "user_id": None,
        "first_name": "Pat",
        "last_name": "Quinn",
        "email": "pat@example.org",
        "phone": "555-0100",
        "address_line1": "1 Main St",
        "address_line2": None,
        "city": "Falls Church",
        "state": "VA",
        "postal_code": "22046",
        "country": "USA",
        "donor_type": "individual",
        "company_name": None,
        "notes": "Prefers no publicity",
        "tags": None,
        "communication_preferences": None,
        "is_anonymous": True,
        "total_donated": Decimal("250.00"),
        "donation_count": 1,
        "first_donation_date": None,
        "last_donation_date": None,
        "active": True,
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class TestPresentDonation:
    def test_view_only_sees_no_identity_on_an_anonymous_gift(self):
        out = present_donation(_donation(), can_see_identity=False)
        assert (out.donor_name, out.donor_email, out.donor_id) == (None, None, None)
        # What totals and campaign progress are built from stays.
        assert out.amount == Decimal("250.00")
        assert out.is_anonymous is True

    def test_manage_sees_the_donor(self):
        out = present_donation(_donation(), can_see_identity=True)
        assert out.donor_name == "Pat Quinn"
        assert out.donor_email == "pat@example.org"

    def test_a_named_gift_is_untouched_for_view_only(self):
        out = present_donation(_donation(is_anonymous=False), can_see_identity=False)
        assert out.donor_name == "Pat Quinn"


class TestPresentDonor:
    def test_view_only_sees_a_placeholder_for_an_anonymous_donor(self):
        out = present_donor(_donor(), can_see_identity=False)
        assert (out.first_name, out.last_name) == ("Anonymous", "donor")
        for field in ("email", "phone", "address_line1", "city", "postal_code"):
            assert getattr(out, field) is None
        assert out.notes is None
        assert out.is_anonymous is True
        assert out.total_donated == Decimal("250.00")

    def test_manage_sees_the_record(self):
        out = present_donor(_donor(), can_see_identity=True)
        assert (out.first_name, out.email) == ("Pat", "pat@example.org")

    def test_a_named_donor_is_untouched(self):
        out = present_donor(_donor(is_anonymous=False), can_see_identity=False)
        assert out.last_name == "Quinn"


def _user():
    return SimpleNamespace(id=uuid.uuid4(), organization_id=uuid.uuid4())


class TestEndpoints:
    @pytest.mark.parametrize(
        ("can_manage", "expected"), [(False, None), (True, "Pat Quinn")]
    )
    async def test_list_donations(self, monkeypatch, can_manage, expected):
        from app.api.v1.endpoints import grants as endpoint

        service = MagicMock()
        service.list_donations = AsyncMock(return_value=[_donation()])
        monkeypatch.setattr(endpoint, "FundraisingService", lambda _db: service)
        monkeypatch.setattr(endpoint, "user_has_permission", lambda _u, _p: can_manage)

        out = await endpoint.list_donations(
            campaign_id=None,
            donor_id=None,
            start_date=None,
            end_date=None,
            pagination=SimpleNamespace(skip=0, limit=100),
            db=MagicMock(),
            current_user=_user(),
        )

        assert out[0].donor_name == expected

    async def test_dashboard_recent_donations(self, monkeypatch):
        from app.api.v1.endpoints import grants as endpoint

        grants = MagicMock()
        grants.get_dashboard_data = AsyncMock(return_value={})
        fundraising = MagicMock()
        fundraising.get_dashboard_data = AsyncMock(
            return_value={"recent_donations": [_donation()]}
        )
        monkeypatch.setattr(endpoint, "GrantService", lambda _db: grants)
        monkeypatch.setattr(endpoint, "FundraisingService", lambda _db: fundraising)
        monkeypatch.setattr(endpoint, "user_has_permission", lambda _u, _p: False)

        out = await endpoint.get_dashboard(db=MagicMock(), current_user=_user())

        assert out.recent_donations[0].donor_name is None
        assert out.recent_donations[0].donor_email is None

    @pytest.mark.parametrize(
        ("can_manage", "expected"), [(False, "Anonymous"), (True, "Pat")]
    )
    async def test_donors_list_and_detail(self, monkeypatch, can_manage, expected):
        from app.api.v1.endpoints import grants as endpoint

        donor = _donor()
        service = MagicMock()
        service.list_donors = AsyncMock(return_value=[donor])
        service.get_donor = AsyncMock(return_value=donor)
        monkeypatch.setattr(endpoint, "FundraisingService", lambda _db: service)
        monkeypatch.setattr(endpoint, "user_has_permission", lambda _u, _p: can_manage)

        listed = await endpoint.list_donors(
            search="quinn",
            donor_type=None,
            pagination=SimpleNamespace(skip=0, limit=100),
            db=MagicMock(),
            current_user=_user(),
        )
        detail = await endpoint.get_donor(
            donor_id=uuid.uuid4(), db=MagicMock(), current_user=_user()
        )

        assert listed[0].first_name == expected
        assert detail.first_name == expected
        # A view-only search must not match an anonymous donor by the hidden name.
        assert service.list_donors.await_args.kwargs["search_anonymous"] is can_manage


class TestDonorSearch:
    async def test_view_only_search_excludes_anonymous_donors(self):
        from app.services.fundraising_service import FundraisingService

        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            result = MagicMock()
            result.scalars.return_value.all.return_value = []
            return result

        db = MagicMock()
        db.execute = execute
        service = FundraisingService(db)

        await service.list_donors(ORG, search="quinn", search_anonymous=False)
        hidden = str(captured[-1].compile(dialect=mysql.dialect())).lower()
        await service.list_donors(ORG, search="quinn")
        managed = str(captured[-1].compile(dialect=mysql.dialect())).lower()

        assert "donors.is_anonymous is false" in hidden
        assert "donors.is_anonymous is false" not in managed
