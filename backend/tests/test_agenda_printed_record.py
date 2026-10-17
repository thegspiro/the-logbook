"""What a printed or published copy of the minutes shows for agenda sections.

The claim under test: an item the meeting never reached appears as *Not taken
up* instead of vanishing as an empty section, a presenter is credited, and a
section that is merely empty is still left out.
"""

import pytest
from pypdf import PdfReader

from app.utils.minutes_pdf import render_minutes_pdf
from tests.test_document_service import _minutes, _svc

pytestmark = [pytest.mark.unit]

SECTIONS = [
    {
        "order": 0,
        "key": "agenda-treasurer",
        "title": "Treasurer's report",
        "content": "Balance reported.",
        "presenter": "Lee Treasurer",
    },
    {
        "order": 1,
        "key": "agenda-old",
        "title": "Old business",
        "content": "",
        "not_taken_up": True,
    },
    {"order": 2, "key": "agenda-empty", "title": "Empty heading", "content": ""},
]


def _pdf_text() -> str:
    pdf = render_minutes_pdf(
        {
            "title": "Minutes",
            "meeting_type_display": "Business",
            "meeting_date_display": "Jan 15, 2026",
            "sections": SECTIONS,
        },
        {},
    )
    return "".join(page.extract_text() for page in PdfReader(pdf).pages)


def _published_html() -> str:
    return _svc()._generate_minutes_html(_minutes(sections=SECTIONS))


class TestPdf:
    def test_a_not_taken_up_item_is_printed_as_such(self):
        text = _pdf_text()
        assert "Old business" in text
        assert "Not taken up." in text

    def test_the_presenter_is_credited(self):
        assert "Presented by Lee Treasurer" in _pdf_text()

    def test_an_empty_unflagged_section_is_still_left_out(self):
        assert "Empty heading" not in _pdf_text()


class TestPublishedCopy:
    def test_a_not_taken_up_item_is_published_as_such(self):
        html = _published_html()
        assert "Old business" in html
        assert "Not taken up." in html

    def test_the_presenter_is_credited(self):
        assert "Presented by Lee Treasurer" in _published_html()

    def test_an_empty_unflagged_section_is_still_left_out(self):
        assert "Empty heading" not in _published_html()

    def test_a_presenter_name_is_escaped(self):
        sections = [
            {
                "order": 0,
                "key": "k",
                "title": "T",
                "content": "x",
                "presenter": "<script>bad()</script>",
            }
        ]
        html = _svc()._generate_minutes_html(_minutes(sections=sections))
        assert "<script>" not in html
