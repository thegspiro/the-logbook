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
"""

from io import BytesIO
from typing import Any, Dict, List

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from app.utils.election_pdf_style import (
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


def _multiline(text: Any) -> str:
    return esc(text).replace("\n", "<br/>")


def render_evaluation_pdf(record: Dict[str, Any]) -> bytes:
    """Lay out a finalized evaluation and return the PDF bytes.

    *record* keys: ``org_name``, ``logo``, ``title``, ``member_name``,
    ``evaluator_name``, ``period``, ``coverage``, ``excluded`` (list of
    text), ``figures`` (list of ``(label, value)``), ``sections`` (each
    ``{"title", "items": [{"label", "evaluator", "self"}]}`` where each
    answer is ``{"answer", "notes": [(label, text)]}`` or None),
    ``overall``, ``overall_comment``, ``self_status``, ``self_comment``,
    ``signatures`` (each ``{"label", "name", "disposition", "comment",
    "signed_at"}``), ``content_hash``, ``generated_at``.
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=VERTICAL_MARGIN,
        bottomMargin=VERTICAL_MARGIN,
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
        fontName="Helvetica-Bold",
        spaceBefore=8,
    )
    styles["small"] = ParagraphStyle(
        "EvalSmall", parent=styles["panel"], fontSize=9, leading=12, textColor=MUTED
    )

    story: List[Any] = [
        letterhead(
            record.get("org_name"),
            "MEMBER PERFORMANCE EVALUATION",
            [
                Paragraph(esc(record.get("title")), styles["election"]),
                Paragraph(
                    f"Generated {esc(record.get('generated_at'))}", styles["small"]
                ),
            ],
            record.get("logo"),
            styles,
            "Member Performance Evaluation",
        ),
        Spacer(1, 10),
    ]

    details = [
        ["Member", esc(record.get("member_name"))],
        ["Evaluator", esc(record.get("evaluator_name") or "—")],
        ["Review period", esc(record.get("period"))],
        ["Measured over", esc(record.get("coverage") or "—")],
    ]
    for line in record.get("excluded") or []:
        details.append(["Left out", esc(line)])
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
        story.append(section(esc(block.get("title")), [padded(body)], styles))

    summary: List[Any] = []
    if record.get("overall"):
        summary.append(
            Paragraph(f"<b>Overall:</b> {esc(record.get('overall'))}", styles["body"])
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
    story.append(section("Summary", [padded(summary)], styles))

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
    story.append(
        section(
            "Signatures",
            [
                ruled_table(signature_rows, [0.22, 0.24, 0.32, 0.22], []),
                Spacer(1, 6),
                Paragraph(
                    "A member's acknowledgement records that they received this "
                    "evaluation. It does not mean they agree with it. Each "
                    "signature was given by the signer, signed in and having "
                    "re-confirmed their identity, on the record fingerprinted below.",
                    styles["small"],
                ),
            ],
            styles,
        )
    )
    story.append(
        Paragraph(
            f"Record fingerprint (SHA-256): {esc(record.get('content_hash'))}",
            styles["small"],
        )
    )

    footer = page_footer(
        f"Member performance evaluation · {record.get('member_name') or ''}"
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
