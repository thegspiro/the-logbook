"""The finalized evaluation PDF prints the record in words, escapes what
members typed, states that an acknowledgement is not agreement, and leaves
out what was recorded for audit only."""

from io import BytesIO

import pytest
from pypdf import PdfReader

from app.services.evaluation_document_service import (
    excluded_line,
    figure_detail,
    format_figure,
)
from app.utils.evaluation_pdf import (
    render_evaluation_pdf,
    render_evaluation_preview_pdf,
)

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


PREVIEW = {
    **RECORD,
    "member_name": "Sample member",
    "evaluator_name": None,
    "content_hash": None,
    "signatures": [
        {
            "label": "Chief's approval",
            "name": "Fire Chief",
            "disposition": "Not signed",
            "comment": None,
            "signed_at": "—",
        }
    ],
    "preview": {"form": "the evaluator's form"},
}


def _pages(pdf: bytes) -> list[str]:
    return [
        " ".join(page.extract_text().split()) for page in PdfReader(BytesIO(pdf)).pages
    ]


def test_a_preview_says_so_on_every_page_and_claims_no_fingerprint():
    # Enough sections to run past the first page.
    record = {**PREVIEW, "sections": RECORD["sections"] * 30}
    pages = _pages(render_evaluation_preview_pdf(record))

    assert len(pages) > 1
    for page in pages:
        # The banner, the footer and the diagonal mark each carry it.
        assert page.count("NOT A RECORD") >= 3, page
        assert "PREVIEW" in page
    text = " ".join(pages)
    assert "Preview of the evaluator's form" in text
    assert "Operational Annual" in text
    assert "Chief's approval" in text
    assert "Nobody has signed this preview" in text
    assert "has no record fingerprint" in text
    assert "Record fingerprint (SHA-256)" not in text
    assert "on the record fingerprinted below" not in text


def test_a_preview_of_a_form_nobody_signs_has_no_signature_table():
    record = {
        **PREVIEW,
        "signatures": None,
        "preview": {"form": "the self-evaluation form"},
    }
    text = " ".join(_pages(render_evaluation_preview_pdf(record)))

    assert "Preview of the self-evaluation form" in text
    assert "Signatures" not in text
    assert "Signed by" not in text


def test_a_record_is_never_marked_a_preview():
    text = " ".join(_pages(render_evaluation_pdf(RECORD)))

    assert "PREVIEW" not in text
    assert "NOT A RECORD" not in text
    assert "Record fingerprint (SHA-256)" in text
    assert "Signed by" in text


def test_the_preview_renderer_refuses_a_record():
    with pytest.raises(ValueError, match="which form it shows"):
        render_evaluation_preview_pdf(RECORD)


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


@pytest.mark.parametrize(
    ("key", "entry", "expected"),
    [
        (
            "events.meeting_attendance_pct",
            {"available": True, "value": 75.0, "attended": 6, "held": 8},
            "6 of 8 meetings attended",
        ),
        (
            "training.requirements_met_pct",
            {"available": True, "value": 100.0, "met": 1, "total": 1},
            "1 of 1 requirement met",
        ),
        (
            "training.session_attendance_pct",
            {
                "available": True,
                "value": 90.0,
                "attended": 9,
                "held": 12,
                "excused": 2,
                "required_pct": 60.0,
                "requirement": "Drill attendance",
            },
            "9 of 10 sessions attended (2 excused); Drill attendance requires 60%",
        ),
        (
            "calls.response_pct",
            {
                "available": True,
                "value": 100.0,
                "responses": 130,
                "department_calls": 120,
                "capped": True,
            },
            "130 responses to 120 department calls; shown as 100% because shift "
            "call credit exceeds the department's call log",
        ),
        (
            "shifts.hours",
            {"available": True, "value": 40.0, "external_hours": 12.5},
            "Not included: 12.5 h for other agencies",
        ),
        (
            "shifts.hours",
            {"available": True, "value": 40.0, "external_hours": 0.0},
            None,
        ),
        (
            "shifts.hours",
            {
                "available": True,
                "value": 40.0,
                "external_hours": 12.5,
                "breakdown": "4 shifts",
            },
            "4 shifts. Not included: 12.5 h for other agencies",
        ),
        (
            "training.hours",
            {
                "available": True,
                "value": 68.75,
                "breakdown": "9 training records: Continuing Education 68.75 h",
            },
            "9 training records: Continuing Education 68.75 h",
        ),
        (
            "meetings.waivers_summary",
            {"available": True, "value": 3, "breakdown": "2 approved, 1 denied"},
            "2 approved, 1 denied",
        ),
        # A snapshot taken before a source stored its counts has no detail,
        # and an unavailable figure's note already says everything.
        ("events.meeting_attendance_pct", {"available": True, "value": 75.0}, None),
        ("calls.response_pct", {"available": False, "value": None, "note": "x"}, None),
    ],
)
def test_figure_details_state_the_counts_behind_the_value(key, entry, expected):
    assert figure_detail(key, entry) == expected


@pytest.mark.parametrize(
    ("excluded", "expected"),
    [
        (
            {"start": "2026-08-10", "end": "2026-12-31", "reason": "leave"},
            "Leave of absence, Aug 10, 2026 – Dec 31, 2026",
        ),
        (
            {"start": "2026-04-01", "end": "2026-06-30", "reason": "separation"},
            "Not a member, Apr 1, 2026 – Jun 30, 2026",
        ),
        # A value that is not a date is printed as stored, not dropped.
        (
            {"start": "soon", "end": None, "reason": "leave"},
            "Leave of absence, soon – —",
        ),
    ],
)
def test_left_out_ranges_print_dates_like_the_rest_of_the_page(excluded, expected):
    assert excluded_line(excluded) == expected


def test_detail_values_print_as_written_not_as_escape_codes():
    """The Details block is a table, and a bare table cell prints its text
    literally: escaping the value there put "O&#x27;Brien" on a member's
    permanent record."""
    record = {
        **RECORD,
        "member_name": "Sean O'Brien",
        "evaluator_name": "Lt. A & B <Ops>",
        "period": "Q1 & Q2",
        "coverage": "Jan – Jun",
        "excluded": ['Leave: "medical" & admin'],
    }
    text = " ".join(_text(render_evaluation_pdf(record)).split())
    for literal in (
        "Sean O'Brien",
        "Lt. A & B <Ops>",
        "Q1 & Q2",
        'Leave: "medical" & admin',
    ):
        assert literal in text
    for code in ("&amp;", "&#x27;", "&lt;", "&gt;", "&quot;"):
        assert code not in text
