"""Every page of the inventory impact plan says where it falls in the set.

The plan is printed and handed round as loose pages at a purchasing
meeting. Until 2026-11-17 it had no footer at all, so a page that came
loose could not be put back in order or shown to be complete.
"""

from io import BytesIO

import pytest
from pypdf import PdfReader

from tests import test_pdf_print_safety as safety
from tests.test_pdf_running_header import _impact_plan

pytestmark = pytest.mark.unit

# The band at the foot of a page in which the footer sits.
_BAND = 60


def test_every_page_is_numbered_out_of_the_total():
    pdf = _impact_plan()
    total = len(PdfReader(BytesIO(pdf)).pages)
    assert total > 1, "the sample must run past one page"
    feet = {}
    for page, _w, _h, _x0, y0, _x1, _y1, text in safety._runs(pdf):
        if y0 <= _BAND:
            feet.setdefault(page, []).append(text)
    for page in range(1, total + 1):
        foot = " ".join(feet.get(page, []))
        assert f"Inventory Impact Plan · Page {page} of {total}" in foot, foot


def test_a_planning_sheet_carries_no_continue_warning():
    # The "continues on the next page" line is for a voter holding a ballot.
    text = "".join(p.extract_text() for p in PdfReader(BytesIO(_impact_plan())).pages)
    assert "continue" not in text.lower()
