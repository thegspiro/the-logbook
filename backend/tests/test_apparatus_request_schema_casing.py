"""Apparatus request schemas accept the casing the frontend actually sends.

`frontend/src/utils/createApiClient.ts` performs no key transformation, and
every apparatus type in `modules/apparatus/types/index.ts` is camelCase — so a
request schema without an alias generator rejects everything the UI sends,
with a 422 raised before the handler runs.

`ApparatusCreate` has carried the camel config since it was written.
`ApparatusArchive` and `ApparatusStatusChange` did not, which made the archive
form's payload unacceptable the moment there was a form to send one: the
Archive button had never reached this endpoint, so nothing had exercised it.

Both casings are pinned here. `populate_by_name` keeps the snake_case form
valid, so a caller that was already sending it — the API's own docs, a script,
a test — does not break.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.apparatus import ApparatusArchive, ApparatusStatusChange

pytestmark = pytest.mark.unit


class TestApparatusArchiveCasing:

    def test_accepts_the_camel_case_the_frontend_sends(self):
        archive = ApparatusArchive(
            disposalMethod="sold",
            disposalReason="Replaced by Engine 2",
            soldPrice=Decimal("1500.00"),
            soldTo="County Auction",
            soldToContact="auctions@example.test",
        )

        assert archive.disposal_method == "sold"
        assert archive.disposal_reason == "Replaced by Engine 2"
        assert archive.sold_price == Decimal("1500.00")
        assert archive.sold_to == "County Auction"
        assert archive.sold_to_contact == "auctions@example.test"

    def test_still_accepts_snake_case(self):
        archive = ApparatusArchive(disposal_method="scrapped")

        assert archive.disposal_method == "scrapped"
        assert archive.sold_to is None

    def test_disposal_method_is_still_required(self):
        # The alias is what a client sees named in the 422, so that is what is
        # pinned: renaming the field without the alias config would report
        # `disposal_method` and quietly change the contract.
        with pytest.raises(ValidationError, match="disposalMethod"):
            ApparatusArchive(disposalReason="no method given")


class TestApparatusStatusChangeCasing:

    def test_accepts_the_camel_case_the_frontend_sends(self):
        change = ApparatusStatusChange(
            statusId="status-1", currentMileage=1200, currentHours=Decimal("40.5")
        )

        assert change.status_id == "status-1"
        assert change.current_mileage == 1200
        assert change.current_hours == Decimal("40.5")

    def test_still_accepts_snake_case(self):
        assert ApparatusStatusChange(status_id="status-1").status_id == "status-1"
