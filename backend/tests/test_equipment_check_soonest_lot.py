"""A position's reported lot number must belong to the date beside it.

``CheckTemplateItem.lot_number`` is a scalar left over from the last swap. On a
position carrying more than one lot it names a *different* lot from the one
``_soonest_expiration`` reports, and the two are rendered side by side as one
fact — "Lot NLX-2411, expires 9/4/2026" — about a lot that actually expires the
following March. The number now comes from the same deployed row as the date.

DB mocked; no MySQL.
"""

from datetime import date, timedelta
from types import SimpleNamespace

from app.services.equipment_check_service import EquipmentCheckService

TODAY = date(2026, 8, 11)


def _lot(number, days, quantity=1):
    return SimpleNamespace(
        lot_number=number,
        expiration_date=(TODAY + timedelta(days=days)) if days is not None else None,
        quantity=quantity,
    )


def _item(deployed, lot_number="STALE-1", has_expiration=True):
    return SimpleNamespace(
        deployed_lots=deployed,
        lot_number=lot_number,
        expiration_date=TODAY + timedelta(days=900),
        has_expiration=has_expiration,
    )


def test_two_lots_report_the_number_belonging_to_the_soonest_date():
    # Deliberately out of date order, and with the scalar naming the later lot
    # — which is exactly what the last swap leaves behind.
    item = _item(
        [_lot("NLX-2411", 213), _lot("NLX-2405", 24)],
        lot_number="NLX-2411",
    )

    assert EquipmentCheckService._soonest_expiration(item) == TODAY + timedelta(days=24)
    assert EquipmentCheckService._soonest_lot_number(item) == "NLX-2405"


def test_single_lot_is_unchanged():
    item = _item([_lot("EPI-3382", 61, quantity=2)], lot_number="EPI-3382")

    assert EquipmentCheckService._soonest_lot_number(item) == "EPI-3382"


def test_undated_lots_do_not_displace_the_scalar():
    """A truck holding only undated units still reports what was known."""
    item = _item([_lot(None, None, quantity=4)], lot_number="GZ-9910")

    assert EquipmentCheckService._soonest_lot_number(item) == "GZ-9910"


def test_position_with_no_deployed_lots_reports_the_scalar():
    item = _item([], lot_number="NS-5520")

    assert EquipmentCheckService._soonest_lot_number(item) == "NS-5520"


def test_lots_drawn_to_zero_are_not_consulted():
    """A spent lot is not aboard, so it cannot name the position's date."""
    item = _item(
        [_lot("SPENT-1", 3, quantity=0), _lot("FRESH-2", 90, quantity=5)],
        lot_number="SPENT-1",
    )

    assert EquipmentCheckService._soonest_expiration(item) == TODAY + timedelta(days=90)
    assert EquipmentCheckService._soonest_lot_number(item) == "FRESH-2"
