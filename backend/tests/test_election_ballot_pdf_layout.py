"""
Printed-ballot layout: department logo in the header, and mark boxes that
print as boxes.

The mark boxes were typed as "☐" (U+2610), a glyph the built-in PDF fonts
do not have, so every box printed as a solid black block. They are now
drawn as vector outlines, and the organization's logo heads the page when
one is configured.
"""

import base64
from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfReader

from app.utils.election_ballot_pdf import render_printable_ballot_pdf

pytestmark = pytest.mark.unit

DATA = {
    "election": {
        "title": "Test Election",
        "voting_method": "simple_majority",
        "allow_write_ins": True,
    },
    "positions": [
        {"name": "President", "candidates": ["Christopher Davis", "Amanda Wilson"]}
    ],
    "approval_items": [{"title": "Approve the Budget", "description": None}],
}


def _logo_uri() -> str:
    image = Image.new("RGBA", (64, 32), (153, 27, 27, 255))
    out = BytesIO()
    image.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def _render(**meta) -> PdfReader:
    buf = render_printable_ballot_pdf(
        DATA, {"org_name": "Test FD", "generated_at": "today", **meta}
    )
    return PdfReader(BytesIO(buf.getvalue()))


def _image_count(reader: PdfReader) -> int:
    return sum(len(page.images) for page in reader.pages)


def test_mark_boxes_are_not_a_missing_glyph():
    reader = _render()
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "☐" not in text
    assert "■" not in text
    for expected in ("Christopher Davis", "Write-in:", "Approve", "Deny"):
        assert expected in text


def test_logo_is_drawn_in_the_header():
    assert _image_count(_render(logo=_logo_uri())) == 1


def test_no_logo_renders_text_only_header():
    reader = _render()
    assert _image_count(reader) == 0
    assert "Test FD" in reader.pages[0].extract_text()


@pytest.mark.parametrize(
    "logo",
    [
        "https://example.com/logo.png",
        "data:image/png;base64,not-an-image",
        "",
    ],
)
def test_unusable_logo_still_prints_the_ballot(logo):
    reader = _render(logo=logo)
    assert _image_count(reader) == 0
    assert "OFFICIAL BALLOT" in reader.pages[0].extract_text()


def test_ranked_ballot_renders_as_a_grid():
    # Two candidates plus two write-in lines: four options, four rank columns.
    data = {**DATA, "election": {**DATA["election"], "voting_method": "ranked_choice"}}
    buf = render_printable_ballot_pdf(data, {"org_name": "Test FD"})
    text = " ".join(PdfReader(BytesIO(buf.getvalue())).pages[0].extract_text().split())
    assert "mark one box in the 1st column for your first choice" in text
    assert "1st 2nd 3rd 4th" in text
    assert "5th" not in text
    assert "write 1 next to your first choice" not in text


def test_a_ranked_race_too_wide_for_the_grid_takes_written_ranks():
    candidates = [f"Candidate {n}" for n in range(1, 13)]
    data = {
        "election": {"title": "Big Race", "voting_method": "ranked_choice"},
        "positions": [{"name": "Board", "candidates": candidates}],
    }
    buf = render_printable_ballot_pdf(data, {"org_name": "Test FD"})
    text = " ".join(PdfReader(BytesIO(buf.getvalue())).pages[0].extract_text().split())
    assert "write 1 next to your first choice" in text
    assert "1st 2nd" not in text
