"""
Pre-meeting package layout: the same letterhead as the ballot and the
certified results, page numbers on every page, and table text printed as
written rather than as escape codes.

Plain table cells print their text literally, so the old renderer's escaped
values reached the page as "&gt;50%"; values now go in wrapping paragraphs
that are escaped once.
"""

import base64
from datetime import datetime
from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfReader

from app.utils.pre_meeting_package_pdf import render_pre_meeting_package_pdf

pytestmark = pytest.mark.unit


def _data(**election):
    return {
        "election": {
            "title": "Annual Election",
            "voting_method": "simple_majority",
            "victory_condition": "majority",
            **election,
        },
        "meeting": {
            "title": "Q&A <Town Hall>",
            "meeting_type": "Business",
            "date_display": "August 1, 2026",
            "location": "Station 1",
        },
        "ballot_items": [
            {"id": "chief", "title": "Fire Chief", "position": "Chief"},
        ],
        "candidates": [{"name": "Casey Cole", "position": "Chief"}],
        "roster": {
            "total_members": 2,
            "total_eligible": 2,
            "eligible": [
                {"full_name": "Casey Cole", "membership_type": "active"},
                {"full_name": "Drew Dunn", "membership_type": "life"},
            ],
        },
    }


def _meta(**extra):
    return {
        "org_name": "Test FD",
        "generated_at": datetime(2026, 10, 17, 9, 0),
        **extra,
    }


def _logo_uri() -> str:
    image = Image.new("RGBA", (64, 32), (153, 27, 27, 255))
    out = BytesIO()
    image.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def _reader(data=None, **meta) -> PdfReader:
    buf = render_pre_meeting_package_pdf(data or _data(), _meta(**meta))
    return PdfReader(BytesIO(buf.getvalue()))


def _text(reader: PdfReader) -> str:
    return " ".join(" ".join(page.extract_text().split()) for page in reader.pages)


def _image_count(reader: PdfReader) -> int:
    return sum(len(page.images) for page in reader.pages)


def test_letterhead_names_the_department_and_document():
    text = _text(_reader())
    assert "Test FD" in text
    assert "PRE-MEETING PACKAGE" in text
    assert "Annual Election" in text
    assert "Generated October 17, 2026 at 09:00 AM" in text


def test_logo_is_drawn_in_the_letterhead():
    assert _image_count(_reader(logo=_logo_uri())) == 1


@pytest.mark.parametrize(
    "logo", [None, "", "https://example.com/logo.png", "data:image/png;base64,x"]
)
def test_missing_or_unusable_logo_still_renders(logo):
    reader = _reader(logo=logo)
    assert _image_count(reader) == 0
    assert "PRE-MEETING PACKAGE" in _text(reader)


def test_table_values_print_as_written_not_as_escape_codes():
    text = _text(_reader())
    assert "Majority (>50% of votes cast)" in text
    assert "Q&A <Town Hall>" in text
    assert "&gt;" not in text
    assert "&amp;" not in text


def test_every_page_is_numbered_and_names_the_election():
    data = _data()
    data["roster"]["eligible"] = [
        {"full_name": f"Member {n}", "membership_type": "active"} for n in range(80)
    ]
    reader = _reader(data)
    assert len(reader.pages) > 1
    for number, page in enumerate(reader.pages, start=1):
        assert (
            f"Pre-Meeting Package · Annual Election · Page {number}"
            in page.extract_text()
        )
