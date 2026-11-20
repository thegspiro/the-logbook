"""Every page of a filed record says where it falls in the whole set.

Minutes, evaluations, certified election results and the pre-meeting package
are filed and handed round as loose pages. "Page 2" does not tell a reader
whether page 3 exists or has gone missing; "Page 2 of 3" does. The ballot,
the report kit and the impact plan already number their pages this way.
"""

import re
from io import BytesIO
from typing import Dict, List

import pytest
from pypdf import PdfReader

from tests import test_pdf_print_safety as safety
from tests.test_pdf_running_header import DOCUMENTS

pytestmark = pytest.mark.unit

# The band at the foot of a page that holds its footer lines.
_BAND = 60

RECORDS = ["certified results", "pre-meeting package", "evaluation", "minutes"]


def _feet(pdf: bytes) -> Dict[int, str]:
    lines: Dict[int, List[str]] = {}
    for page, _w, _h, _x0, y0, _x1, _y1, text in safety._runs(pdf):
        if y0 <= _BAND:
            lines.setdefault(page, []).append(text)
    return {page: " ".join(parts) for page, parts in lines.items()}


@pytest.mark.parametrize("name", RECORDS)
def test_every_page_is_numbered_out_of_the_total(name: str):
    render, _title = DOCUMENTS[name]
    pdf = render()
    total = len(PdfReader(BytesIO(pdf)).pages)
    assert total > 1, "the sample must run past one page"
    feet = _feet(pdf)
    for page in range(1, total + 1):
        assert f"Page {page} of {total}" in feet.get(page, ""), feet.get(page)


@pytest.mark.parametrize("name", RECORDS)
def test_no_page_is_numbered_without_its_total(name: str):
    render, _title = DOCUMENTS[name]
    for foot in _feet(render()).values():
        assert not re.search(r"Page \d+(?! of \d)", foot), foot
