"""Operations request times reach the model in UTC, whatever offset was sent.

Fuel logs, apparatus photos, inventory checkouts, equipment-request
fulfilment, public-portal API keys and storefront order windows all store
their times in MySQL DATETIME columns, and the driver formats an aware
datetime by its wall clock, dropping the offset: ``18:00-04:00`` is written as
18:00 and read back as 18:00 UTC. The schemas convert on the way in through
``app.schemas.base.UTCDateTime``.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pymysql.converters
import pytest
from pydantic import ValidationError

from app.schemas.apparatus import (
    ApparatusFuelLogCreate,
    ApparatusPhotoBase,
    ApparatusPhotoCreate,
)
from app.schemas.inventory import (
    CheckOutCreate,
    CheckoutExtendRequest,
    EquipmentRequestFulfill,
)
from app.schemas.public_portal import PublicPortalAPIKeyCreate, PublicPortalAPIKeyUpdate
from app.schemas.storefront import StoreOrderWindowCreate, StoreOrderWindowUpdate

pytestmark = [pytest.mark.unit]

EDT = timezone(timedelta(hours=-4))


def _stored(value: datetime | None) -> str:
    """What pymysql actually writes into the DATETIME column."""
    assert value is not None
    return pymysql.converters.escape_item(value, "utf8")


class TestApparatusFuelLog:
    def test_offset_fuel_date_is_stored_as_the_utc_instant(self):
        # The apparatus pages send camelCase; the alias must keep working.
        data = ApparatusFuelLogCreate(
            apparatusId="a1",
            fuelDate="2026-10-17T18:00:00-04:00",
            fuelType="diesel",
            gallons=40,
        )

        assert data.fuel_date.utcoffset() == timedelta(0)
        assert _stored(data.fuel_date) == "'2026-10-17 22:00:00'"

    def test_naive_fuel_date_is_read_as_utc(self):
        data = ApparatusFuelLogCreate(
            apparatus_id="a1",
            fuel_date="2026-10-17T16:00:00",
            fuel_type="diesel",
            gallons=40,
        )

        assert data.fuel_date.tzinfo is not None
        assert _stored(data.fuel_date) == "'2026-10-17 16:00:00'"


class TestApparatusPhoto:
    def test_offset_taken_at_is_stored_as_the_utc_instant(self):
        data = ApparatusPhotoCreate(
            apparatusId="a1",
            filePath="documents/x",
            fileName="x.jpg",
            takenAt="2026-10-17T18:00:00-04:00",
        )

        assert _stored(data.taken_at) == "'2026-10-17 22:00:00'"

    def test_multipart_metadata_path_converts_too(self):
        # upload_apparatus_photo validates the form fields through the base
        # schema, then rebuilds the create schema from its dump.
        details = ApparatusPhotoBase(taken_at=datetime(2026, 10, 17, 18, tzinfo=EDT))
        data = ApparatusPhotoCreate(
            **details.model_dump(),
            apparatus_id="a1",
            file_path="documents/x",
            file_name="x.jpg",
        )

        assert _stored(data.taken_at) == "'2026-10-17 22:00:00'"

    def test_missing_taken_at_stays_none(self):
        assert ApparatusPhotoBase().taken_at is None


class TestInventoryCheckout:
    def test_offset_return_time_is_stored_as_the_utc_instant(self):
        data = CheckOutCreate(
            item_id=uuid4(),
            user_id=uuid4(),
            expected_return_at="2026-10-24T18:00:00-04:00",
        )

        assert _stored(data.expected_return_at) == "'2026-10-24 22:00:00'"

    def test_utc_input_is_unchanged(self):
        data = CheckOutCreate(
            item_id=uuid4(),
            user_id=uuid4(),
            expected_return_at="2026-10-24T22:00:00Z",
        )

        assert _stored(data.expected_return_at) == "'2026-10-24 22:00:00'"


class TestCheckoutExtend:
    def test_offset_return_time_is_stored_as_the_utc_instant(self):
        due = (datetime.now(EDT) + timedelta(days=7)).replace(microsecond=0)
        data = CheckoutExtendRequest(expected_return_at=due.isoformat())

        assert data.expected_return_at.utcoffset() == timedelta(0)
        assert _stored(data.expected_return_at) == _stored(due.astimezone(timezone.utc))

    def test_naive_return_time_is_read_as_utc(self):
        due = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=7)
        data = CheckoutExtendRequest(expected_return_at=due)

        assert data.expected_return_at.tzinfo is not None
        assert _stored(data.expected_return_at) == _stored(due)

    def test_past_time_is_still_refused(self):
        past = datetime.now(EDT) - timedelta(hours=1)
        with pytest.raises(ValidationError, match="must be in the future"):
            CheckoutExtendRequest(expected_return_at=past)


class TestEquipmentRequestFulfill:
    def test_offset_return_time_is_stored_as_the_utc_instant(self):
        data = EquipmentRequestFulfill(
            fulfillment_type="checkout",
            expected_return_at="2026-10-24T18:00:00-04:00",
        )

        assert _stored(data.expected_return_at) == "'2026-10-24 22:00:00'"

    def test_bare_date_is_still_midnight_utc(self):
        # The fulfil form sends a <input type="date"> value; reading it as UTC
        # midnight is what was stored before, so nothing shifts.
        data = EquipmentRequestFulfill(
            fulfillment_type="checkout", expected_return_at="2026-10-24"
        )

        assert _stored(data.expected_return_at) == "'2026-10-24 00:00:00'"


class TestPublicPortalAPIKey:
    def test_create_expiry_is_the_utc_instant(self):
        data = PublicPortalAPIKeyCreate(
            name="Website", expires_at="2026-12-31T23:59:00-05:00"
        )

        assert _stored(data.expires_at) == "'2027-01-01 04:59:00'"

    def test_update_expiry_is_the_utc_instant(self):
        data = PublicPortalAPIKeyUpdate(expires_at="2026-12-31T23:59:00-05:00")

        assert _stored(data.expires_at) == "'2027-01-01 04:59:00'"

    def test_naive_expiry_is_read_as_utc(self):
        data = PublicPortalAPIKeyCreate(name="Website", expires_at="2027-01-01T04:59")

        assert _stored(data.expires_at) == "'2027-01-01 04:59:00'"

    def test_omitted_expiry_stays_none(self):
        assert PublicPortalAPIKeyUpdate(name="Renamed").expires_at is None


class TestStoreOrderWindow:
    def test_create_offset_times_are_stored_as_the_utc_instant(self):
        data = StoreOrderWindowCreate(
            name="Fall order",
            opensAt="2026-10-20T08:00:00-04:00",
            closesAt="2026-10-27T17:00:00-04:00",
        )

        assert _stored(data.opens_at) == "'2026-10-20 12:00:00'"
        assert _stored(data.closes_at) == "'2026-10-27 21:00:00'"

    def test_create_mixed_pair_in_order_is_accepted(self):
        data = StoreOrderWindowCreate(
            name="Fall order",
            opens_at="2026-10-20T12:00:00",
            closes_at="2026-10-27T17:00:00-04:00",
        )

        assert _stored(data.closes_at) == "'2026-10-27 21:00:00'"

    def test_create_mixed_pair_out_of_order_is_a_validation_error(self):
        # 22:00 UTC naive vs 17:00-04:00 (21:00 UTC): closes before it opens.
        # Comparing the two unconverted raised TypeError, a 500.
        with pytest.raises(ValidationError, match="close time must be after"):
            StoreOrderWindowCreate(
                name="Fall order",
                opens_at="2026-10-27T22:00:00",
                closes_at="2026-10-27T17:00:00-04:00",
            )

    def test_update_offset_times_are_stored_as_the_utc_instant(self):
        data = StoreOrderWindowUpdate(closesAt="2026-10-27T17:00:00-04:00")

        assert _stored(data.closes_at) == "'2026-10-27 21:00:00'"
        assert "opens_at" not in data.model_dump(exclude_unset=True)
