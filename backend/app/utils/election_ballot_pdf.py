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

The page is grayscale throughout: ballots are run off on whatever office
printer or copier the department has, often in black and white, and a
colour tint that looks fine on screen can turn into a muddy block or
vanish entirely on a copy.
"""

import html
from io import BytesIO
from typing import Any, Dict, List, Optional

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Flowable,
    HRFlowable,
)
from reportlab.platypus import Image as PdfImage
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.utils.app_icons import decode_logo

_INK = colors.HexColor("#111827")
_GRID = colors.HexColor("#9ca3af")
_MUTED = colors.HexColor("#4b5563")
# Light enough to stay a pale band on a copier, dark enough to survive one.
_BAND = colors.HexColor("#e5e7eb")
_PANEL = colors.HexColor("#f3f4f6")

# Page width less the side margins and the frame's own 6pt padding each side.
_CONTENT_WIDTH = letter[0] - 1.4 * inch - 12
_MARK_COL = 0.6 * inch
_LOGO_BOX = 0.9 * inch

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
        self.canv.setStrokeColor(_INK)
        self.canv.setFillColor(colors.white)
        self.canv.setLineWidth(1.2)
        self.canv.roundRect(
            0, 0, self.box_width, self.box_height, radius=2, stroke=1, fill=1
        )


def _esc(value: Any) -> str:
    return html.escape(str(value)) if value is not None else ""


def _logo_flowable(stored: Optional[str]) -> Optional[PdfImage]:
    """The department logo sized for the ballot header, or ``None``.

    ``decode_logo`` reads only ``data:`` URIs (never fetches a URL) and
    returns ``None`` for anything it cannot render, so a missing or broken
    logo leaves a text-only header rather than failing the print.
    """
    logo = decode_logo(stored)
    if logo is None:
        return None
    # Transparent pixels are composited onto white: left transparent they
    # print black on some PDF viewers and drivers.
    flat = Image.new("RGB", logo.size, (255, 255, 255))
    flat.paste(logo, mask=logo.split()[-1])
    scale = _LOGO_BOX / max(flat.width, flat.height)
    png = BytesIO()
    flat.save(png, format="PNG")
    png.seek(0)
    return PdfImage(
        png,
        width=flat.width * scale,
        height=flat.height * scale,
    )


def _contest(
    heading: str,
    notes: List[str],
    rows: List[List[Any]],
    styles: Dict[str, ParagraphStyle],
) -> KeepTogether:
    """One race or question: shaded heading band, instructions, choices.

    Kept together so a contest never starts at the bottom of one page and
    finishes on the next, where a voter can miss the remaining choices.
    """
    head_cells: List[List[Any]] = [[Paragraph(heading, styles["contest"])]]
    head_cells.extend([[Paragraph(note, styles["note"])] for note in notes])
    head = Table(
        head_cells,
        colWidths=[_CONTENT_WIDTH],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), _BAND),
                ("LINEABOVE", (0, 0), (-1, 0), 1.5, _INK),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, 0), 6),
                ("TOPPADDING", (0, 1), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 6),
            ]
        ),
    )
    parts: List[Any] = [head]
    if rows:
        parts.append(
            Table(
                rows,
                colWidths=[_MARK_COL, _CONTENT_WIDTH - _MARK_COL],
                style=TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("ALIGN", (0, 0), (0, -1), "CENTER"),
                        ("LINEBELOW", (0, 0), (-1, -2), 0.5, _GRID),
                        ("LINEBELOW", (0, -1), (-1, -1), 1, _INK),
                        ("TOPPADDING", (0, 0), (-1, -1), 8),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ]
                ),
            )
        )
    parts.append(Spacer(1, 14))
    return KeepTogether(parts)


def render_printable_ballot_pdf(data: Dict[str, Any], meta: Dict[str, Any]) -> BytesIO:
    """Render the blank ballot, returning a BytesIO at position 0.

    *data*: ``election`` (title, voting_method, max_votes_per_position,
    allow_write_ins), ``positions`` — ordered list of
    ``{name, candidates: [names]}`` — and optional ``approval_items``,
    ordered ``{title, description}`` questions answered Approve / Deny.
    *meta*: ``org_name``, ``generated_at`` (display string), and optional
    ``logo`` — the organization's stored logo data URI.
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

    base = getSampleStyleSheet()
    styles = {
        "org": ParagraphStyle(
            "BallotOrg",
            parent=base["Title"],
            fontSize=17,
            leading=21,
            alignment=0,
            spaceAfter=0,
            textColor=_INK,
        ),
        "kicker": ParagraphStyle(
            "BallotKicker",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=_INK,
        ),
        "election": ParagraphStyle(
            "BallotElection",
            parent=base["Normal"],
            fontSize=12,
            leading=15,
            textColor=_MUTED,
        ),
        "contest": ParagraphStyle(
            "BallotContest",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=_INK,
        ),
        "note": ParagraphStyle(
            "BallotNote",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9,
            leading=12,
            textColor=_INK,
        ),
        "choice": ParagraphStyle(
            "BallotChoice",
            parent=base["Normal"],
            fontSize=12,
            leading=15,
            textColor=_INK,
        ),
        "panel": ParagraphStyle(
            "BallotPanel",
            parent=base["Normal"],
            fontSize=9.5,
            leading=13,
            textColor=_INK,
        ),
        "footer": ParagraphStyle(
            "BallotFooter",
            parent=base["Normal"],
            fontSize=8,
            leading=11,
            textColor=_MUTED,
            alignment=1,
        ),
    }

    heading_text = [
        Paragraph(_esc(meta.get("org_name")) or "Official Ballot", styles["org"]),
        Spacer(1, 3),
        Paragraph("OFFICIAL BALLOT", styles["kicker"]),
        Paragraph(_esc(election.get("title")), styles["election"]),
    ]
    logo = _logo_flowable(meta.get("logo"))
    if logo is not None:
        header = Table(
            [[logo, heading_text]],
            colWidths=[_LOGO_BOX + 0.2 * inch, _CONTENT_WIDTH - _LOGO_BOX - 0.2 * inch],
            style=TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ]
            ),
        )
    else:
        header = Table(
            [[heading_text]],
            colWidths=[_CONTENT_WIDTH],
            style=TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0)]),
        )

    story: List[Any] = [
        header,
        Spacer(1, 8),
        HRFlowable(width="100%", thickness=2, color=_INK),
        Spacer(1, 8),
        Table(
            [
                [
                    Paragraph(
                        "<b>Instructions:</b> Use a pen with dark ink. Follow "
                        "the instruction under each heading. Do not sign or "
                        "otherwise identify yourself on this ballot.",
                        styles["panel"],
                    )
                ]
            ],
            colWidths=[_CONTENT_WIDTH],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), _PANEL),
                    ("BOX", (0, 0), (-1, -1), 0.75, _GRID),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]
            ),
        ),
        Spacer(1, 16),
    ]

    instruction = _INSTRUCTIONS.get(method, _INSTRUCTIONS["simple_majority"])
    if not ranked and max_votes > 1 and method != "approval":
        instruction = f"Mark UP TO {max_votes} boxes per position."

    def mark() -> _MarkBox:
        # A ranked ballot takes a written number, so its box is wider.
        if ranked:
            return _MarkBox(0.42 * inch, 0.28 * inch)
        return _MarkBox(0.22 * inch, 0.22 * inch)

    for position in data.get("positions", []):
        rows: List[List[Any]] = [
            [mark(), Paragraph(_esc(name), styles["choice"])]
            for name in position.get("candidates", [])
        ]
        if election.get("allow_write_ins"):
            for _ in range(2):
                rows.append(
                    [
                        mark(),
                        Paragraph(
                            "Write-in: ____________________________________",
                            styles["choice"],
                        ),
                    ]
                )
        story.append(_contest(_esc(position.get("name")), [instruction], rows, styles))

    # Approval items are yes/no questions, so they take a fixed Approve /
    # Deny pair regardless of the election's voting method: a ranked or
    # multi-vote instruction would make no sense on a motion.
    for item in data.get("approval_items", []):
        notes = []
        if item.get("description"):
            notes.append(_esc(item.get("description")))
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
        story.append(_contest(_esc(item.get("title")), notes, rows, styles))

    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=0.75, color=_GRID))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            f"Generated {_esc(meta.get('generated_at'))} — fold and place "
            f"this ballot in the ballot box. Do not sign your name.",
            styles["footer"],
        )
    )

    doc.build(story)
    buf.seek(0)
    return buf
