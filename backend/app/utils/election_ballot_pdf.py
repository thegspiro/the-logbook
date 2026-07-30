"""
Printable blank paper-ballot renderer.

Renders the official paper ballot for in-room voting directly from the
election setup, so the paper exactly matches the system: positions in
order, accepted candidates in ballot order, write-in lines when the
election allows them, and method-specific voting instructions. Pairs with
paper-ballot entry + officer attestation: print → collect → key in →
attest.

Kept separate from the service so the layout logic lives in one place and
can be unit-tested without a database (same convention as
``pre_meeting_package_pdf``).
"""

import html
from io import BytesIO
from typing import Any, Dict, List

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_GRID = colors.HexColor("#9ca3af")
_MUTED = colors.HexColor("#6b7280")

# One instruction line per voting method; {n} = max votes per position.
_INSTRUCTIONS = {
    "simple_majority": "Mark ONE box per position.",
    "supermajority": "Mark ONE box per position.",
    "approval": "Mark the box next to EVERY candidate you approve of.",
    "ranked_choice": (
        "Rank the candidates: write 1 next to your first choice, "
        "2 next to your second, and so on."
    ),
}


def _esc(value: Any) -> str:
    return html.escape(str(value)) if value is not None else ""


def render_printable_ballot_pdf(data: Dict[str, Any], meta: Dict[str, Any]) -> BytesIO:
    """Render the blank ballot, returning a BytesIO at position 0.

    *data*: ``election`` (title, voting_method, max_votes_per_position,
    allow_write_ins) and ``positions`` — ordered list of
    ``{name, candidates: [names]}``.
    *meta*: ``org_name``, ``generated_at`` (display string).
    """
    election = data.get("election", {})
    method = election.get("voting_method") or "simple_majority"
    max_votes = int(election.get("max_votes_per_position") or 1)
    ranked = method == "ranked_choice"

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        title="Official Ballot",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "BallotTitle", parent=styles["Title"], fontSize=16, spaceAfter=2
    )
    sub_style = ParagraphStyle(
        "BallotSub", parent=styles["Normal"], fontSize=9, textColor=_MUTED
    )
    pos_style = ParagraphStyle(
        "BallotPos",
        parent=styles["Heading2"],
        fontSize=12,
        spaceBefore=10,
        spaceAfter=2,
    )
    instr_style = ParagraphStyle(
        "BallotInstr",
        parent=styles["Normal"],
        fontSize=8,
        textColor=_MUTED,
        spaceAfter=4,
    )

    story: List[Any] = [
        Paragraph(_esc(meta.get("org_name")) or "Official Ballot", title_style),
        Paragraph(f"OFFICIAL BALLOT — {_esc(election.get('title'))}", sub_style),
        Spacer(1, 8),
        HRFlowable(width="100%", thickness=1, color=_GRID),
    ]

    instruction = _INSTRUCTIONS.get(method, _INSTRUCTIONS["simple_majority"])
    if not ranked and max_votes > 1 and method != "approval":
        instruction = f"Mark UP TO {max_votes} boxes per position."

    for position in data.get("positions", []):
        story.append(Paragraph(_esc(position.get("name")), pos_style))
        story.append(Paragraph(instruction, instr_style))

        mark_cell = "____" if ranked else "☐"  # rank line or empty box
        rows = [
            [mark_cell, Paragraph(_esc(name), styles["Normal"])]
            for name in position.get("candidates", [])
        ]
        if election.get("allow_write_ins"):
            for _ in range(2):
                rows.append(
                    [
                        mark_cell,
                        Paragraph(
                            "Write-in: ______________________________",
                            styles["Normal"],
                        ),
                    ]
                )
        if rows:
            story.append(
                Table(
                    rows,
                    colWidths=[0.5 * inch, 6.0 * inch],
                    style=TableStyle(
                        [
                            ("FONTSIZE", (0, 0), (-1, -1), 11),
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LINEBELOW", (0, 0), (-1, -1), 0.25, _GRID),
                            ("TOPPADDING", (0, 0), (-1, -1), 6),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                        ]
                    ),
                )
            )

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=_GRID))
    story.append(
        Paragraph(
            f"Generated {_esc(meta.get('generated_at'))} — fold and place "
            f"this ballot in the ballot box. Do not sign your name.",
            sub_style,
        )
    )

    doc.build(story)
    buf.seek(0)
    return buf
