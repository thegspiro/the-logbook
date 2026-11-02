"""The finalized evaluation PDF prints the record in words, escapes what
members typed, states that an acknowledgement is not agreement, and leaves
out what was recorded for audit only."""

from io import BytesIO

import pytest
from pypdf import PdfReader

from app.services.evaluation_document_service import format_figure
from app.utils.evaluation_pdf import render_evaluation_pdf

pytestmark = [pytest.mark.unit]

RECORD = {
    "org_name": "Falls Church VFD",
    "logo": None,
    "title": "Operational Annual",
    "member_name": "Pat Rivera-Núñez",
    "evaluator_name": "Jordan Captain",
    "period": "2025 Annual · Jan 1, 2025 – Dec 31, 2025",
    "coverage": "Feb 1, 2025 – Dec 31, 2025",
    "excluded": ["Leave of absence, 2025-06-01 – 2025-06-30"],
    "figures": [("Training hours", "42.5 h"), ("Business meeting attendance", "75%")],
    "sections": [
        {
            "title": "Core duties",
            "items": [
                {
                    "label": "Training",
                    "evaluator": {
                        "answer": "Exceeds",
                        "notes": [
                            (
                                "Why the rating differs from the figures",
                                "Led <every> drill & more",
                            )
                        ],
                    },
                    "self": {"answer": "Meets", "notes": []},
                }
            ],
        }
    ],
    "overall": "75% (weighted)",
    "overall_comment": "A strong year.",
    "self_status": "Submitted",
    "self_comment": None,
    "signatures": [
        {
            "label": "Member acknowledgement",
            "name": "Pat Rivera-Núñez",
            "disposition": "Refused to sign",
            "comment": "I dispute the training rating.",
            "signed_at": "Jan 20, 2026 9:15 AM EST",
        }
    ],
    "content_hash": "a" * 64,
    "generated_at": "Jan 20, 2026 9:15 AM EST",
}


def _text(pdf: bytes) -> str:
    return " ".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)


def test_it_prints_the_record():
    pdf = render_evaluation_pdf(RECORD)
    assert pdf.startswith(b"%PDF")
    text = " ".join(_text(pdf).split())
    for expected in (
        "Falls Church VFD",
        "MEMBER PERFORMANCE EVALUATION",
        "Pat Rivera-Núñez",
        "Jordan Captain",
        "42.5 h",
        "Leave of absence",
        "Exceeds",
        "Led <every> drill & more",
        "75% (weighted)",
        "Refused to sign",
        "I dispute the training rating.",
        "does not mean they agree",
        "a" * 64,
    ):
        assert expected in text, expected


def test_a_member_cannot_inject_markup():
    record = {**RECORD, "overall_comment": "<b>bold</b> <font size=40>x</font>"}
    text = _text(render_evaluation_pdf(record))
    assert "<b>bold</b>" in text


@pytest.mark.parametrize(
    ("entry", "unit", "expected"),
    [
        ({"available": True, "value": 66.7}, "percent", "66.7%"),
        ({"available": True, "value": 11.5}, "hours", "11.5 h"),
        ({"available": True, "value": 4.2}, "rating", "4.2 / 5"),
        ({"available": True, "value": 12}, "count", "12"),
        (
            {"available": False, "value": None, "note": "Call tracking is off."},
            "percent",
            "Call tracking is off.",
        ),
        (
            {
                "available": True,
                "value": [{"label": "EMT", "expires_on": "2027-03-01"}],
            },
            "list",
            "EMT (expires 2027-03-01)",
        ),
        ({"available": True, "value": []}, "list", "None"),
        (None, "count", "Not measured"),
    ],
)
def test_figures_read_as_the_screens_show_them(entry, unit, expected):
    assert format_figure(entry, unit) == expected
