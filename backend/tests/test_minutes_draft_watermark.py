"""Minutes that are not the adopted record say so on every page.

Owner decision of 2026-11-21: a printed copy of minutes that have not been
approved carries a light diagonal "DRAFT" across each page. Approved minutes
are the record of the meeting and carry none. Draft, submitted and rejected
minutes are all unapproved — ``minutes_print_data`` passes ``approval`` only
for approved minutes, so its absence is the test.

The mark is drawn over the page, after its content, and is translucent. It
cannot go beneath: a table row's opaque fill paints over anything under it,
which left the first attempt invisible on an attendance page.
"""

from io import BytesIO
from typing import Any, Dict, List, Optional

import pytest
from pypdf import PdfReader

from app.utils.minutes_pdf import render_minutes_pdf

pytestmark = pytest.mark.unit

_APPROVAL = {
    "submitted_by": "Pat Clerk",
    "approved_by": "Sam Chief",
    "approved_at_display": "November 20, 2026 at 07:30 PM EST",
    "version": 1,
    "content_hash": "ab" * 32,
}


def _minutes(approval: Optional[Dict[str, Any]]) -> bytes:
    data = {
        "title": "Monthly Business Meeting",
        # Enough attendees to run onto a second and third page.
        "attendees": [
            {"name": f"Member {i}", "role": "Firefighter", "status": "present"}
            for i in range(90)
        ],
        "approval": approval,
    }
    meta = {"org_name": "Falls Church Volunteer Fire Department"}
    return render_minutes_pdf(data, meta).read()


def _runs_in_order(page: Any) -> List[str]:
    runs: List[str] = []

    def visit(text: str, *_args: Any) -> None:
        if text.strip():
            runs.append(text.strip())

    page.extract_text(visitor_text=visit)
    return runs


def test_unapproved_minutes_are_marked_draft_on_every_page():
    pages = PdfReader(BytesIO(_minutes(None))).pages
    assert len(pages) >= 3
    for number, page in enumerate(pages, start=1):
        assert "DRAFT" in _runs_in_order(page), f"page {number} is unmarked"


def test_approved_minutes_carry_no_draft_mark():
    for page in PdfReader(BytesIO(_minutes(_APPROVAL))).pages:
        assert "DRAFT" not in _runs_in_order(page)


def test_the_mark_is_drawn_over_the_content_and_lets_it_show_through():
    for page in PdfReader(BytesIO(_minutes(None))).pages:
        runs = _runs_in_order(page)
        assert runs[-1] == "DRAFT", runs[-3:]
        states = page["/Resources"]["/ExtGState"].values()
        alphas = [float(s.get_object()["/ca"]) for s in states if "/ca" in s]
        assert alphas, "no translucent fill on the page"
        assert max(alphas) < 0.3, alphas
