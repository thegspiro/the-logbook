"""
Certified-results layout: the same letterhead as the paper ballot, page
numbers on every page, and nothing the restyle dropped from the record.

The results document used a dark filled header row and amber warnings,
neither of which survives a black-and-white copier. It now shares the
ballot's grayscale letterhead and section bands (``election_pdf_style``).
"""

import base64
from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfReader

from app.utils.certified_results_pdf import render_certified_results_pdf

pytestmark = pytest.mark.unit


def _data(**election):
    return {
        "election": {
            "title": "Annual Election",
            "closed_display": "2026-10-16 21:00",
            "closed_by_display": "Alice Anderson",
            "tie_policy": "runoff",
            **election,
        },
        "results": {
            "total_eligible_voters": 20,
            "total_votes": 12,
            "voter_turnout_percentage": 60.0,
            "results_by_position": [
                {
                    "position": "Chief",
                    "candidates": [
                        {
                            "candidate_name": "Casey Cole",
                            "vote_count": 8,
                            "percentage": 66.7,
                            "is_winner": True,
                        },
                        {
                            "candidate_name": "Drew Dunn",
                            "vote_count": 4,
                            "percentage": 33.3,
                        },
                    ],
                },
                {
                    "position": "Captain",
                    "is_tie": True,
                    "candidates": [
                        {
                            "candidate_name": "Pat Quinn",
                            "vote_count": 6,
                            "percentage": 50.0,
                            "is_tied": True,
                        },
                        {
                            "candidate_name": "Sam Rivera",
                            "vote_count": 6,
                            "percentage": 50.0,
                            "is_tied": True,
                        },
                    ],
                },
            ],
        },
        "stats": {"electronic_votes": 10, "manual_votes": 2},
        "batches": [
            {
                "status": "pending",
                "total_ballots": 2,
                "recorded_by_name": "Bob Brown",
                "attester_names": [],
            }
        ],
        "integrity": {"integrity_status": "PASS", "total_votes": 12},
    }


def _logo_uri() -> str:
    image = Image.new("RGBA", (64, 32), (153, 27, 27, 255))
    out = BytesIO()
    image.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def _render(data=None, **meta) -> PdfReader:
    buf = render_certified_results_pdf(
        data or _data(), {"org_name": "Test FD", "generated_at": "today", **meta}
    )
    return PdfReader(BytesIO(buf.getvalue()))


def _text(reader: PdfReader) -> str:
    return "\n".join(page.extract_text() for page in reader.pages)


def _image_count(reader: PdfReader) -> int:
    return sum(len(page.images) for page in reader.pages)


def test_letterhead_names_the_department_and_document():
    text = _text(_render())
    assert "Test FD" in text
    assert "CERTIFIED ELECTION RESULTS" in text
    assert "Annual Election" in text
    assert "Election closed 2026-10-16 21:00 by Alice Anderson" in text


def test_logo_is_drawn_in_the_letterhead():
    assert _image_count(_render(logo=_logo_uri())) == 1


@pytest.mark.parametrize(
    "logo", [None, "", "https://example.com/logo.png", "data:image/png;base64,x"]
)
def test_missing_or_unusable_logo_still_renders(logo):
    reader = _render(logo=logo)
    assert _image_count(reader) == 0
    assert "CERTIFIED ELECTION RESULTS" in _text(reader)


def test_every_page_is_numbered_and_names_the_election():
    # Enough contests to run past one page.
    data = _data()
    data["results"]["results_by_position"] *= 6
    reader = _render(data)
    assert len(reader.pages) > 1
    for number, page in enumerate(reader.pages, start=1):
        assert (
            f"Certified Election Results · Annual Election · Page {number}"
            in page.extract_text()
        )


def test_record_content_survives_the_restyle():
    # Table cells now wrap rather than overflow, so a long status can break
    # across lines in the extracted text.
    text = " ".join(_text(_render()).split())
    for expected in (
        "Results — Chief",
        "Casey Cole",
        "WINNER",
        "TIED",
        "UNRESOLVED TIE for Captain",
        "NEVER ATTESTED — excluded from results",
        "PASS",
        "President",
        "Secretary",
    ):
        assert expected in text, expected


def test_revisions_print_before_the_results():
    data = _data(revisions_display=["Results revised by Alice: a vote was voided"])
    text = _text(_render(data))
    assert text.index("Results revised by Alice") < text.index("Results — Chief")
