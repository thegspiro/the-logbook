"""A donor's contact details need fundraising.manage, not just .view (GF-9).

GF-8 hid an anonymous donor from a view-only caller. Every other donor was
still returned whole: email, phone, postal address, notes, lifetime total. A
view-only caller now reads names, the donor type, the company, totals and
dates; the contact details are the manage permission's, which belongs to the
people who send receipts and thank-you letters.
"""

import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import mysql

from app.services.donor_privacy import (
    DONOR_CONTACT_FIELDS,
    present_donation,
    present_donor,
)
from tests.test_anonymous_donations import ORG, _donation, _donor

pytestmark = pytest.mark.unit


class TestAViewOnlyCallerSeesNoContactDetails:
    def test_a_named_donor_keeps_the_name_and_totals_and_loses_the_contact(self):
        donor = _donor(
            is_anonymous=False,
            company_name="Quinn Roofing",
            communication_preferences={"email": True},
            user_id=str(uuid.uuid4()),
        )

        out = present_donor(donor, can_see_identity=False)

        assert (out.first_name, out.last_name) == ("Pat", "Quinn")
        assert out.company_name == "Quinn Roofing"
        assert out.donor_type == "individual"
        assert out.total_donated == Decimal("250.00")
        assert out.donation_count == 1
        for field in DONOR_CONTACT_FIELDS:
            assert getattr(out, field) is None, field
        assert out.contact_hidden is True

    def test_an_anonymous_donor_is_still_masked_as_before(self):
        out = present_donor(_donor(), can_see_identity=False)

        assert (out.first_name, out.last_name) == ("Anonymous", "donor")
        assert out.contact_hidden is True

    def test_a_manager_reads_the_whole_record(self):
        out = present_donor(
            _donor(is_anonymous=False, communication_preferences={"email": True}),
            can_see_identity=True,
        )

        assert out.email == "pat@example.org"
        assert out.phone == "555-0100"
        assert out.address_line1 == "1 Main St"
        assert out.notes == "Prefers no publicity"
        assert out.communication_preferences == {"email": True}
        assert out.contact_hidden is False

    def test_every_contact_field_is_a_field_of_the_response(self):
        # A name that drifts out of the schema would silently stop masking.
        out = present_donor(_donor(), can_see_identity=True)

        assert all(hasattr(out, field) for field in DONOR_CONTACT_FIELDS)

    def test_a_donation_keeps_the_donor_name_but_not_the_email(self):
        out = present_donation(_donation(is_anonymous=False), can_see_identity=False)

        assert out.donor_name == "Pat Quinn"
        assert out.donor_email is None
        assert out.amount == Decimal("250.00")

    def test_a_manager_still_sees_a_donations_email(self):
        out = present_donation(_donation(is_anonymous=False), can_see_identity=True)

        assert out.donor_email == "pat@example.org"


def _user():
    return SimpleNamespace(id=uuid.uuid4(), organization_id=uuid.uuid4())


class TestEndpoints:
    @pytest.mark.parametrize(
        ("can_manage", "expected"), [(False, None), (True, "pat@example.org")]
    )
    async def test_donor_list_and_detail(self, monkeypatch, can_manage, expected):
        from app.api.v1.endpoints import grants as endpoint

        donor = _donor(is_anonymous=False)
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

        assert listed[0].email == expected
        assert detail.email == expected
        assert service.list_donors.await_args.kwargs["search_contact"] is can_manage


class TestSearchDoesNotConfirmAnEmail:
    async def test_view_only_search_leaves_the_email_out(self):
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

        await service.list_donors(ORG, search="pat@", search_contact=False)
        hidden = str(captured[-1].compile(dialect=mysql.dialect())).lower()
        await service.list_donors(ORG, search="pat@")
        managed = str(captured[-1].compile(dialect=mysql.dialect())).lower()

        # The address is encrypted, so a contact search matches its
        # fingerprint, and only for a caller allowed to see contact details.
        assert "donors.email_hash in" not in hidden
        assert "donors.email_hash in" in managed
        assert "lower(donors.email) like" not in managed
        # Names and company are still searchable by a view-only caller.
        assert "lower(donors.last_name) like" in hidden
        assert "lower(donors.company_name) like" in hidden
