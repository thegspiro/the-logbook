"""
The finalized member performance evaluation, as a PDF.

It shares the election documents' letterhead (department logo and name),
grayscale palette and heading bands, so a department's formal documents look
like one set and survive a black-and-white copier. The renderer takes plain,
already-formatted data: what the record says, and in which words, is decided
by ``EvaluationDocumentService``; this module only lays it out.

What it never prints: calibration (hidden from the member), drafts, and the
IP address or user agent recorded with a signature (kept for audit, not for
circulation).

The same layout also prints a template builder's preview
(:func:`render_evaluation_preview_pdf`), so what leadership reviews before a
form is published is laid out as the record will be. A preview is marked as
one on every page and carries no fingerprint, since nothing was signed.
"""

from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Spacer

from app.utils.election_pdf_style import (
    BOTTOM_MARGIN,
    MUTED,
    SIDE_MARGIN,
    VERTICAL_MARGIN,
    base_styles,
    esc,
    key_value_table,
    letterhead,
    padded,
    page_footer,
    ruled_table,
    section,
)
from app.utils.pdf_fonts import BODY_FONT, BOLD_FONT
from app.utils.pdf_running_header import HeadedDocTemplate, RunningHeader
from app.utils.pdfa import to_pdfa

PREVIEW_MARK = "PREVIEW"
PREVIEW_NOTICE = "NOT A RECORD"
_MARK_INK = colors.HexColor("#9ca3af")
_MARK_ALPHA = 0.18
_MARK_SIZE = 110
_NOTICE_SIZE = 40


def _multiline(text: Any) -> str:
    return esc(text).replace("\n", "<br/>")


def _draw_preview_mark(canvas: Any) -> None:
    """A pale diagonal "PREVIEW / NOT A RECORD" across the middle of the page.

    A preview is passed round on paper and by email, away from the builder
    that said what it was, and it is laid out exactly as a signed evaluation
    is; with a member's figures in it, a page without the mark could be
    taken for that member's record.
    """
    width, height = letter
    canvas.saveState()
    canvas.setFillColor(_MARK_INK)
    canvas.setFillAlpha(_MARK_ALPHA)
    canvas.translate(width / 2, height / 2)
    canvas.rotate(45)
    canvas.setFont(BOLD_FONT, _MARK_SIZE)
    canvas.drawCentredString(0, 0, PREVIEW_MARK)
    canvas.setFont(BOLD_FONT, _NOTICE_SIZE)
    canvas.drawCentredString(0, -_NOTICE_SIZE * 1.4, PREVIEW_NOTICE)
    canvas.restoreState()


def _layout(record: Dict[str, Any], total_pages: Optional[int]) -> Tuple[bytes, int]:
    """One layout pass: the PDF bytes, before PDF/A, and its page count.

    *record* keys: ``org_name``, ``logo``, ``title``, ``member_name``,
    ``evaluator_name``, ``period``, ``coverage``, ``excluded`` (list of
    text), ``figures`` (list of ``(label, value)``), ``sections`` (each
    ``{"title", "items": [{"label", "evaluator", "self"}]}`` where each
    answer is ``{"answer", "notes": [(label, text)]}`` or None),
    ``overall``, ``overall_override`` (``{"label", "reason"}`` when the
    evaluator changed a calculated overall grade, else None), ``grade_rows``
    (``(section, weight, grade)`` for a form graded by section, else empty),
    each section's ``grade`` (``{"calculated", "override", "reason"}`` or
    None), ``overall_comment``, ``self_status``, ``self_comment``,
    ``signatures`` (each ``{"label", "name", "disposition", "comment",
    "signed_at"}``), ``amendments`` (each ``{"revision", "by", "at",
    "reason"}``, absent or empty when never amended), ``response`` (``{"text",
    "submitted_at"}`` for the PDF that carries the member's written response,
    else None), ``content_hash``, ``generated_at``.

    A builder's preview adds ``preview`` (``{"form"}``, which form it shows,
    in words) and may give a section a ``description`` and leave
    ``signatures`` as None for a form nobody signs.
    """
    preview = record.get("preview")
    buf = BytesIO()
    doc = HeadedDocTemplate(
        buf,
        running_header=RunningHeader(
            record.get("org_name"),
            "Member Performance Evaluation",
            record.get("title") if preview else record.get("member_name"),
            record.get("logo"),
        ),
        banner=(
            f"{PREVIEW_MARK} – {PREVIEW_NOTICE} · {record.get('title') or ''} · "
            f"Generated {record.get('generated_at') or ''}"
            if preview
            else None
        ),
        overlay=_draw_preview_mark if preview else None,
        # The canvas otherwise declares Helvetica, never embedded, on every page.
        initialFontName=BODY_FONT,
        pagesize=letter,
        topMargin=VERTICAL_MARGIN,
        bottomMargin=BOTTOM_MARGIN,
        leftMargin=SIDE_MARGIN,
        rightMargin=SIDE_MARGIN,
        title="Member Performance Evaluation",
        author=str(record.get("org_name") or ""),
    )
    styles = base_styles("Eval")
    styles["body"] = ParagraphStyle(
        "EvalBody", parent=styles["panel"], fontSize=10, leading=14
    )
    styles["cell"] = ParagraphStyle(
        "EvalCell", parent=styles["panel"], fontSize=10, leading=12
    )
    styles["item"] = ParagraphStyle(
        "EvalItem",
        parent=styles["body"],
        fontName=BOLD_FONT,
        spaceBefore=8,
    )
    styles["small"] = ParagraphStyle(
        "EvalSmall", parent=styles["panel"], fontSize=9, leading=12, textColor=MUTED
    )

    heading_lines = [
        Paragraph(esc(record.get("title")), styles["election"]),
        Paragraph(f"Generated {esc(record.get('generated_at'))}", styles["small"]),
    ]
    if preview:
        heading_lines.append(
            Paragraph(
                f"Preview of {esc(preview.get('form'))}. Not a record of any "
                "member's evaluation.",
                styles["small"],
            )
        )
    story: List[Any] = [
        letterhead(
            record.get("org_name"),
            "MEMBER PERFORMANCE EVALUATION",
            heading_lines,
            record.get("logo"),
            styles,
            "Member Performance Evaluation",
            identity=record.get("identity"),
        ),
        Spacer(1, 10),
    ]

    # Values are Paragraphs because a bare table cell prints its text
    # literally: an escaped string there puts "O&#x27;Brien" on the page,
    # while an unescaped one in a Paragraph would be parsed as markup.
    def value(text: Any) -> Paragraph:
        return Paragraph(esc(text), styles["cell"])

    details = [
        ["Member", value(record.get("member_name"))],
        ["Evaluator", value(record.get("evaluator_name") or "—")],
        ["Review period", value(record.get("period"))],
        ["Measured over", value(record.get("coverage") or "—")],
    ]
    for line in record.get("excluded") or []:
        details.append(["Left out", value(line)])
    story.append(section("Details", [key_value_table(details)], styles))

    figures = record.get("figures") or []
    if figures:
        rows: List[List[Any]] = [["Figure", "Value"]]
        rows.extend(
            [
                Paragraph(esc(label), styles["cell"]),
                Paragraph(esc(value), styles["cell"]),
            ]
            for label, value in figures
        )
        story.append(section("Figures", [ruled_table(rows, [0.55, 0.45], [])], styles))

    for block in record.get("sections") or []:
        body: List[Any] = []
        if block.get("description"):
            body.append(
                Paragraph(_multiline(block.get("description")), styles["small"])
            )
        for item in block.get("items") or []:
            body.append(Paragraph(esc(item.get("label")), styles["item"]))
            for who, answer in (
                ("Evaluator", item.get("evaluator")),
                ("Self", item.get("self")),
            ):
                if not answer:
                    continue
                body.append(
                    Paragraph(
                        f"<b>{who}:</b> {_multiline(answer.get('answer'))}",
                        styles["body"],
                    )
                )
                for label, text in answer.get("notes") or []:
                    body.append(
                        Paragraph(
                            f"<i>{esc(label)}:</i> {_multiline(text)}", styles["body"]
                        )
                    )
        grade = block.get("grade")
        if grade:
            body.append(
                Paragraph(
                    f"<b>Section grade:</b> {esc(grade.get('calculated'))}",
                    styles["body"],
                )
            )
            if grade.get("override"):
                body.append(
                    Paragraph(
                        f"<b>Evaluator's grade:</b> {esc(grade.get('override'))}",
                        styles["body"],
                    )
                )
                body.append(
                    Paragraph(
                        f"<i>Why:</i> {_multiline(grade.get('reason'))}", styles["body"]
                    )
                )
        story.append(section(esc(block.get("title")), [padded(body)], styles))

    summary: List[Any] = []
    # Beside the padded summary rather than inside it, as the figures table
    # is: padding added to a full-width table pushes it past the margin.
    grade_table: List[Any] = []
    grade_rows = record.get("grade_rows") or []
    if grade_rows:
        rows = [["Section", "Weight", "Grade"]]
        rows.extend(
            [
                Paragraph(esc(title), styles["cell"]),
                Paragraph(esc(weight), styles["cell"]),
                Paragraph(esc(grade), styles["cell"]),
            ]
            for title, weight, grade in grade_rows
        )
        grade_table.append(ruled_table(rows, [0.4, 0.15, 0.45], []))
    if record.get("overall"):
        summary.append(
            Paragraph(f"<b>Overall:</b> {esc(record.get('overall'))}", styles["body"])
        )
    override = record.get("overall_override")
    if override:
        summary.append(
            Paragraph(
                f"<b>Evaluator's overall grade:</b> {esc(override.get('label'))}",
                styles["body"],
            )
        )
        summary.append(
            Paragraph(
                f"<i>Why:</i> {_multiline(override.get('reason'))}", styles["body"]
            )
        )
    if record.get("overall_comment"):
        summary.append(
            Paragraph(
                f"<b>Evaluator's summary:</b> {_multiline(record.get('overall_comment'))}",
                styles["body"],
            )
        )
    summary.append(
        Paragraph(
            f"<b>Self-evaluation:</b> {esc(record.get('self_status'))}", styles["body"]
        )
    )
    if record.get("self_comment"):
        summary.append(
            Paragraph(
                f"<b>Member's comments:</b> {_multiline(record.get('self_comment'))}",
                styles["body"],
            )
        )
    story.append(section("Summary", [*grade_table, padded(summary)], styles))

    # Only a preview leaves the signatures out: a self-evaluation is
    # submitted, not signed. A record always prints the table, empty or not.
    if not (preview and record.get("signatures") is None):
        signature_rows: List[List[Any]] = [["Step", "Signed by", "Signature", "Date"]]
        for sig in record.get("signatures") or []:
            disposition = esc(sig.get("disposition"))
            if sig.get("comment"):
                disposition += f"<br/><i>Reason:</i> {_multiline(sig.get('comment'))}"
            signature_rows.append(
                [
                    Paragraph(esc(sig.get("label")), styles["cell"]),
                    Paragraph(esc(sig.get("name")), styles["cell"]),
                    Paragraph(disposition, styles["cell"]),
                    Paragraph(esc(sig.get("signed_at")), styles["cell"]),
                ]
            )
        signature_note = (
            "These are the signatures this form's workflow collects, in "
            "order. Nobody has signed this preview. A member's "
            "acknowledgement records that they received the evaluation. It "
            "does not mean they agree with it."
            if preview
            else "A member's acknowledgement records that they received this "
            "evaluation. It does not mean they agree with it. Each "
            "signature was given by the signer, signed in and having "
            "re-confirmed their identity, on the record fingerprinted below."
        )
        story.append(
            section(
                "Signatures",
                [
                    ruled_table(signature_rows, [0.22, 0.24, 0.32, 0.22], []),
                    Spacer(1, 6),
                    Paragraph(signature_note, styles["small"]),
                ],
                styles,
            )
        )
    amendments = record.get("amendments") or []
    if amendments:
        amendment_rows: List[List[Any]] = [["Revision", "Amended by", "Date", "Reason"]]
        for amendment in amendments:
            amendment_rows.append(
                [
                    Paragraph(esc(amendment.get("revision")), styles["cell"]),
                    Paragraph(esc(amendment.get("by")), styles["cell"]),
                    Paragraph(esc(amendment.get("at")), styles["cell"]),
                    Paragraph(_multiline(amendment.get("reason")), styles["cell"]),
                ]
            )
        story.append(
            section(
                "Amendments",
                [
                    ruled_table(amendment_rows, [0.12, 0.22, 0.22, 0.44], []),
                    Spacer(1, 6),
                    Paragraph(
                        "This evaluation was reopened after it was finalized. "
                        "The text of each earlier revision was not kept; the "
                        "signatures above are those given on this revision.",
                        styles["small"],
                    ),
                ],
                styles,
            )
        )
    response = record.get("response")
    if response:
        story.append(
            section(
                "Member's written response",
                [
                    padded(
                        [
                            Paragraph(_multiline(response.get("text")), styles["body"]),
                            Paragraph(
                                f"Submitted {esc(response.get('submitted_at'))}, after "
                                "the evaluation was final. The signatures above were "
                                "given on the evaluation before this response; the "
                                "fingerprint below does not cover it.",
                                styles["small"],
                            ),
                        ]
                    )
                ],
                styles,
            )
        )
    story.append(
        Paragraph(
            (
                "This preview was made from a form as it stood in the template "
                "builder, which may differ from any published version. It is "
                "stored nowhere and has no record fingerprint."
                if preview
                else f"Record fingerprint (SHA-256): {esc(record.get('content_hash'))}"
            ),
            styles["small"],
        )
    )

    footer = page_footer(
        (
            f"{PREVIEW_MARK} – {PREVIEW_NOTICE} · {record.get('title') or ''}"
            if preview
            else f"Member performance evaluation · {record.get('member_name') or ''}"
        ),
        total_pages,
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue(), doc.page


def render_evaluation_pdf(record: Dict[str, Any]) -> bytes:
    """Lay out a finalized evaluation and return the PDF bytes.

    See :func:`_layout` for the *record* keys.
    """
    # Laid out twice: the footer is drawn on the canvas, outside the frame, so
    # it cannot change the layout, and the first pass's page count is the
    # second's total.
    _, pages = _layout(record, None)
    pdf, _ = _layout(record, pages)
    # The finalized evaluation is a personnel record: archival PDF/A-2b.
    return to_pdfa(pdf)


def render_evaluation_preview_pdf(record: Dict[str, Any]) -> bytes:
    """Lay out a template builder's preview and return the PDF bytes.

    *record* is :func:`_layout`'s, with ``preview`` set. Not converted to
    PDF/A: that profile is for records a department keeps, which a preview
    is not.
    """
    if not record.get("preview"):
        raise ValueError("A preview record must say which form it shows.")
    _, pages = _layout(record, None)
    pdf, _ = _layout(record, pages)
    return pdf
