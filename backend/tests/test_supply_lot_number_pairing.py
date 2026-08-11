"""The lot number and the expiration on a position must name the same box.

`_soonest_expiration` derives the earliest date across every lot aboard —
that is the whole point of `check_item_deployed_lots`, and it is the date that
decides whether a truck is in service. `item.lot_number` is the legacy scalar
holding whichever lot was restocked **last**.

Read together, as the supply worklist and the apparatus view both read them,
those two describe different boxes. A drug bag carrying NLX-2405 (expires
September) and NLX-2411 (expires the following March) rendered as
"Lot NLX-2411 · Exp 9/4/2026" — the number of one box beside the date of the
other. A crew acting on that line goes to the wrong box and leaves the
expiring one in the bag.

Found by photographing the page, not by a test: every field was individually
correct, and only the pair was wrong.
"""

from datetime import date, timedelta
from pathlib import Path

from app.models.apparatus import CheckItemDeployedLot, CheckTemplateItem
from app.services.equipment_check_service import EquipmentCheckService

SOON = date.today() + timedelta(days=24)
LATER = date.today() + timedelta(days=213)


def _item(**kwargs) -> CheckTemplateItem:
    item = CheckTemplateItem(
        id="item-1",
        name="Naloxone 4mg Nasal",
        check_type="quantity",
        has_expiration=True,
        **kwargs,
    )
    return item


def _lot(number, expiration, quantity=1) -> CheckItemDeployedLot:
    return CheckItemDeployedLot(
        id=f"lot-{number}",
        template_item_id="item-1",
        lot_number=number,
        expiration_date=expiration,
        quantity=quantity,
    )


class TestSoonestLotNumber:
    def test_names_the_box_that_is_expiring(self):
        # Deliberately ordered latest-first, so a reader that takes the first
        # row rather than the soonest one fails here.
        item = _item(lot_number="NLX-2411", expiration_date=LATER)
        item.deployed_lots = [_lot("NLX-2411", LATER), _lot("NLX-2405", SOON)]

        assert EquipmentCheckService._soonest_expiration(item) == SOON
        assert EquipmentCheckService._soonest_lot_number(item) == "NLX-2405"

    def test_the_pair_always_describes_one_lot(self):
        item = _item(lot_number="STALE-SCALAR", expiration_date=LATER)
        item.deployed_lots = [_lot("A", LATER), _lot("B", SOON), _lot("C", None)]

        number = EquipmentCheckService._soonest_lot_number(item)
        expiration = EquipmentCheckService._soonest_expiration(item)
        match = [
            lot
            for lot in item.deployed_lots
            if lot.lot_number == number and lot.expiration_date == expiration
        ]
        assert match, (
            f"projected Lot {number} with expiry {expiration}, which is not "
            "any single lot aboard"
        )

    def test_undated_lot_still_names_itself(self):
        # A position holding only undated units has no date to report, but the
        # number it shows must still be one that is actually aboard rather than
        # the scalar left behind by an older restock.
        item = _item(lot_number="STALE-SCALAR", expiration_date=None)
        item.deployed_lots = [_lot("FOUND-STOCK", None, quantity=4)]

        assert EquipmentCheckService._soonest_expiration(item) is None
        assert EquipmentCheckService._soonest_lot_number(item) == "FOUND-STOCK"

    def test_falls_back_to_the_scalar_with_no_lots(self):
        # Every position a department has not yet restocked through the lot
        # flow. The scalar is consistent here because it is also where
        # `_soonest_expiration` takes the date from.
        item = _item(lot_number="LEGACY-1", expiration_date=SOON)
        item.deployed_lots = []

        assert EquipmentCheckService._soonest_expiration(item) == SOON
        assert EquipmentCheckService._soonest_lot_number(item) == "LEGACY-1"


class TestEveryProjectionUsesThePair:
    """The helper is only half the fix — every reader has to call it.

    There are three projections that report a derived `expiration_date`
    alongside a lot number: the supply worklist, the apparatus inventory view,
    and the item-to-apparatus reverse lookup. The first two were fixed and the
    third was missed, so the reverse lookup went on pairing NLX-2411 with
    NLX-2405's date — found by photographing an item's Stock tab after the
    other two already looked right.

    Reading the source is the only way to assert "no *other* site does this":
    a behavioural test can only cover the projections somebody remembered.
    """

    SERVICE = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "services"
        / "equipment_check_service.py"
    )

    def test_no_projection_pairs_the_scalar_with_a_derived_date(self):
        source = self.SERVICE.read_text()
        lines = source.splitlines()
        offenders = []
        for i, line in enumerate(lines):
            if '"lot_number": item.lot_number' not in line:
                continue
            # A derived date within a few lines of the scalar lot number is the
            # mismatch. `item.expiration_date` beside it is self-consistent and
            # fine — both come from the same row.
            window = "\n".join(lines[i : i + 4])
            if '"expiration_date": exp' in window:
                offenders.append(i + 1)
        assert not offenders, (
            "these lines pair the legacy lot_number scalar with a derived "
            f"expiration, so they name different boxes: {offenders}. Use "
            "_soonest_lot_number(item)."
        )

    def test_the_three_known_projections_use_the_helper(self):
        source = self.SERVICE.read_text()
        assert source.count("_soonest_lot_number(item)") >= 3, (
            "the supply worklist, the apparatus inventory view and the "
            "item-to-apparatus lookup all report a soonest date and must all "
            "name the lot it belongs to"
        )
