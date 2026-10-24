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

The page shares its letterhead, palette and heading band with the certified
results (``election_pdf_style``), so the two documents read as one set.
"""

from io import BytesIO
from typing import Any, Dict, List

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    Flowable,
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.utils.election_pdf_style import (
    CONTENT_WIDTH,
    GRID,
    INK,
    SIDE_MARGIN,
    VERTICAL_MARGIN,
    base_styles,
    esc,
    heading_band,
    letterhead,
    page_of_footer,
    panel,
)

_MARK_COL = 0.6 * inch
# A ranked race prints one mark column per rank. Below this name width a
# candidate's name wraps to a third line, so a race with more options than
# fit falls back to a box the voter writes a rank number in.
_RANK_COL = 0.5 * inch
_MIN_NAME_COL = 2.4 * inch
_MAX_RANK_COLUMNS = int((CONTENT_WIDTH - _MIN_NAME_COL) // _RANK_COL)

_RANK_GRID_INSTRUCTION = (
    "Rank the candidates in order of preference: mark one box in the 1st "
    "column for your first choice, one in the 2nd column for your second, "
    "and so on. Mark no more than one box in any row or column."
)

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


class _MarkBox(Flowable):
    """An empty outlined box for the voter to mark.

    Drawn as a vector rectangle rather than typed as a glyph: the built-in
    PDF fonts have no "☐" (U+2610), so the character printed as a solid
    black block — the opposite of a box to mark.
    """

    def __init__(self, width: float, height: float) -> None:
        super().__init__()
        self.box_width = width
        self.box_height = height

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        return self.box_width, self.box_height

    def draw(self) -> None:
        self.canv.setStrokeColor(INK)
        self.canv.setFillColor(colors.white)
        self.canv.setLineWidth(1.2)
        self.canv.roundRect(
            0, 0, self.box_width, self.box_height, radius=2, stroke=1, fill=1
        )


def _contest(
    heading: str,
    notes: List[str],
    rows: List[List[Any]] | Table,
    styles: Dict[str, ParagraphStyle],
) -> KeepTogether:
    """One race or question: shaded heading band, instructions, choices.

    Kept together so a contest never starts at the bottom of one page and
    finishes on the next, where a voter can miss the remaining choices.
    """
    head = heading_band(heading, notes, styles)
    parts: List[Any] = [head]
    if isinstance(rows, Table):
        parts.append(rows)
    elif rows:
        parts.append(
            Table(
                rows,
                colWidths=[_MARK_COL, CONTENT_WIDTH - _MARK_COL],
                style=TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("ALIGN", (0, 0), (0, -1), "CENTER"),
                        ("LINEBELOW", (0, 0), (-1, -2), 0.5, GRID),
                        ("LINEBELOW", (0, -1), (-1, -1), 1, INK),
                        ("TOPPADDING", (0, 0), (-1, -1), 8),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ]
                ),
            )
        )
    parts.append(Spacer(1, 14))
    return KeepTogether(parts)


def _ordinal(n: int) -> str:
    if 11 <= n % 100 <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _ranked_grid(labels: List[Paragraph], styles: Dict[str, ParagraphStyle]) -> Table:
    """A ranked race as a grid: one row per option, one column per rank.

    A box under "1st", "2nd", ... is marked the same way as every other box
    on the ballot, where a written number had to be read and could be
    ambiguous ("1" or "7"), and each column visibly takes one mark.
    """
    columns = len(labels)
    header: List[Any] = [""] + [
        Paragraph(_ordinal(rank), styles["rank_header"])
        for rank in range(1, columns + 1)
    ]
    rows: List[List[Any]] = [header] + [
        [label] + [_MarkBox(0.22 * inch, 0.22 * inch) for _ in range(columns)]
        for label in labels
    ]
    return Table(
        rows,
        colWidths=[CONTENT_WIDTH - columns * _RANK_COL] + [_RANK_COL] * columns,
        repeatRows=1,
        style=TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (1, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (0, -1), 8),
                ("LINEBELOW", (0, 0), (-1, 0), 0.75, INK),
                ("LINEBELOW", (0, 1), (-1, -2), 0.5, GRID),
                ("LINEBELOW", (0, -1), (-1, -1), 1, INK),
                ("LINEBEFORE", (1, 1), (-1, -1), 0.5, GRID),
                ("TOPPADDING", (0, 0), (-1, 0), 4),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
                ("TOPPADDING", (0, 1), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 8),
            ]
        ),
    )


def _instruction(method: str, max_votes: int) -> str:
    """The marking instruction for one contest under *method*.

    Mirrors the electronic ballot's ``itemForm``: approval has no cap, a
    multi-vote limit applies to every other single-choice method.
    """
    if method not in ("ranked_choice", "approval") and max_votes > 1:
        return f"Mark UP TO {max_votes} boxes per position."
    return _INSTRUCTIONS.get(method, _INSTRUCTIONS["simple_majority"])


def render_printable_ballot_pdf(data: Dict[str, Any], meta: Dict[str, Any]) -> BytesIO:
    """Render the blank ballot, returning a BytesIO at position 0.

    *data*: ``election`` (title, voting_method, max_votes_per_position,
    allow_write_ins), ``positions`` — ordered list of
    ``{name, candidates: [names], voting_method}``, where ``voting_method``
    is the contest's effective method (the election's when omitted) — and
    optional ``approval_items``,
    ordered ``{title, description}`` questions answered Approve / Deny.
    ``election.date_display`` is the date the ballot is for, already in the
    organization's timezone.
    *meta*: ``org_name``, ``generated_at`` (display string), and optional
    ``logo`` — the organization's stored logo data URI.

    The page is laid out twice: once to learn how many pages it runs to, then
    with a "Page X of Y" footer that tells the voter when there is more.
    """
    election = data.get("election", {})
    footer_label = f"Official Ballot · {election.get('title') or ''}"

    def build(onpage: Any) -> BytesIO:
        buf = BytesIO()
        doc = SimpleDocTemplate(
            buf,
            pagesize=letter,
            topMargin=VERTICAL_MARGIN,
            bottomMargin=VERTICAL_MARGIN,
            leftMargin=SIDE_MARGIN,
            rightMargin=SIDE_MARGIN,
            title="Official Ballot",
        )
        doc.build(_story(data, meta), onFirstPage=onpage, onLaterPages=onpage)
        buf.seek(0)
        return buf

    pages = {"count": 0}

    def count(canvas: Any, document: Any) -> None:
        pages["count"] = document.page

    build(count)
    return build(
        page_of_footer(
            footer_label, pages["count"], "Ballot continues on the next page"
        )
    )


def _story(data: Dict[str, Any], meta: Dict[str, Any]) -> List[Any]:
    """The ballot's flowables, built fresh for each layout pass (platypus
    splits and consumes flowables as it lays them out)."""
    election = data.get("election", {})
    method = election.get("voting_method") or "simple_majority"
    max_votes = int(election.get("max_votes_per_position") or 1)

    styles = base_styles("Ballot")
    styles["choice"] = ParagraphStyle(
        "BallotChoice",
        parent=styles["panel"],
        fontSize=12,
        leading=15,
    )
    styles["rank_header"] = ParagraphStyle(
        "BallotRankHeader",
        parent=styles["panel"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=11,
        alignment=1,
    )
    styles["date"] = ParagraphStyle(
        "BallotDate", parent=styles["election"], fontSize=10, leading=13
    )

    heading_lines = [Paragraph(esc(election.get("title")), styles["election"])]
    if election.get("date_display"):
        heading_lines.append(
            Paragraph(esc(election.get("date_display")), styles["date"])
        )

    story: List[Any] = [
        letterhead(
            meta.get("org_name"),
            "OFFICIAL BALLOT",
            heading_lines,
            meta.get("logo"),
            styles,
            "Official Ballot",
        ),
        Spacer(1, 8),
        HRFlowable(width="100%", thickness=2, color=INK),
        Spacer(1, 8),
        panel(
            [
                Paragraph(
                    "<b>Instructions:</b> Use a pen with dark ink. Follow "
                    "the instruction under each heading. Do not sign or "
                    "otherwise identify yourself on this ballot. If you make "
                    "a mistake, ask an election official for a new ballot.",
                    styles["panel"],
                )
            ]
        ),
        Spacer(1, 16),
    ]

    for position in data.get("positions", []):
        # A Ballot Builder item can override the election's method; the
        # service resolves that override the way vote submission does, so
        # paper asks for what the electronic ballot accepts.
        contest_method = position.get("voting_method") or method
        instruction = _instruction(contest_method, max_votes)
        labels = [
            Paragraph(esc(name), styles["choice"])
            for name in position.get("candidates", [])
        ]
        if election.get("allow_write_ins"):
            labels += [
                Paragraph("Write-in: _______________________", styles["choice"])
                for _ in range(2)
            ]
        if contest_method == "ranked_choice" and 0 < len(labels) <= _MAX_RANK_COLUMNS:
            story.append(
                _contest(
                    esc(position.get("name")),
                    [_RANK_GRID_INSTRUCTION],
                    _ranked_grid(labels, styles),
                    styles,
                )
            )
            continue
        # A ranked race too wide for the grid takes a written number, so its
        # box is wider.
        box = (
            (0.42 * inch, 0.28 * inch)
            if contest_method == "ranked_choice"
            else (0.22 * inch, 0.22 * inch)
        )

        rows: List[List[Any]] = [
            [_MarkBox(*box), Paragraph(esc(name), styles["choice"])]
            for name in position.get("candidates", [])
        ]
        if election.get("allow_write_ins"):
            for _ in range(2):
                rows.append(
                    [
                        _MarkBox(*box),
                        Paragraph(
                            "Write-in: ____________________________________",
                            styles["choice"],
                        ),
                    ]
                )
        story.append(_contest(esc(position.get("name")), [instruction], rows, styles))

    # Approval items are yes/no questions, so they take a fixed Approve /
    # Deny pair regardless of the election's voting method: a ranked or
    # multi-vote instruction would make no sense on a motion.
    for item in data.get("approval_items", []):
        notes = []
        if item.get("description"):
            notes.append(esc(item.get("description")))
        notes.append("Mark ONE box.")
        rows = [
            [
                _MarkBox(0.22 * inch, 0.22 * inch),
                Paragraph("Approve", styles["choice"]),
            ],
            [
                _MarkBox(0.22 * inch, 0.22 * inch),
                Paragraph("Deny", styles["choice"]),
            ],
        ]
        story.append(_contest(esc(item.get("title")), notes, rows, styles))

    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=0.75, color=GRID))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            f"Generated {esc(meta.get('generated_at'))} — fold and place "
            f"this ballot in the ballot box. Do not sign your name.",
            styles["footer"],
        )
    )
    return story
