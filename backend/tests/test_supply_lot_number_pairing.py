"""Every projection that reports a derived expiry must name the lot it belongs to.

The behaviour of `_soonest_lot_number` itself is covered by
`test_equipment_check_soonest_lot.py`. This file asserts something a
behavioural test cannot: that no *other* reader pairs the legacy scalar with a
derived date.

That distinction is not academic. There are three projections reporting an
`expiration_date` alongside a lot number — the supply worklist, the apparatus
inventory view, and the item-to-apparatus reverse lookup. The first two were
fixed and the third was missed, so the reverse lookup went on rendering
"Lot NLX-2411 · Exp 9/4/2026": the number of one box beside the date of another,
which is the exact substitution `check_item_deployed_lots` exists to prevent. It
was found by photographing an item's Stock tab after the other two already
looked right, and a test naming the projections somebody remembered would have
stayed green throughout.

Reading the source is the only way to make the assertion cover a fourth
projection nobody has written yet.
"""

from pathlib import Path

SERVICE = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "services"
    / "equipment_check_service.py"
)


def test_no_projection_pairs_the_scalar_with_a_derived_date():
    lines = SERVICE.read_text().splitlines()
    offenders = []
    for i, line in enumerate(lines):
        if '"lot_number": item.lot_number' not in line:
            continue
        # A derived date within a few lines of the scalar lot number is the
        # mismatch. `item.expiration_date` beside it is self-consistent and
        # fine — both come from the same row.
        if '"expiration_date": exp' in "\n".join(lines[i : i + 4]):
            offenders.append(i + 1)
    assert not offenders, (
        "these lines pair the legacy lot_number scalar with a derived "
        f"expiration, so they name different boxes: {offenders}. Use "
        "_soonest_lot_number(item)."
    )


def test_the_three_known_projections_use_the_helper():
    source = SERVICE.read_text()
    assert source.count("_soonest_lot_number(item)") >= 3, (
        "the supply worklist, the apparatus inventory view and the "
        "item-to-apparatus lookup all report a soonest date and must all "
        "name the lot it belongs to"
    )
