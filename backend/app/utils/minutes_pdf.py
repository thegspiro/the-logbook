"""
Meeting minutes renderer.

The printable record of a meeting: heading, attendance and quorum, the content
sections, motions with their votes, action items, the election results filed
with the minutes, the attachment list, and signature lines. For approved
minutes the footer carries the approved version's number and SHA-256, so a
printed copy can be checked against the system.

Takes plain dicts rather than ORM rows so the layout lives in one place and can
be unit-tested without a database (same convention as
``certified_results_pdf``).
"""

import html
from io import BytesIO
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.utils.rich_text import (
    FORMAT_HTML,
    html_to_pdf_blocks,
    normalize_format,
    section_is_printed,
)

_HEADER_BG = colors.HexColor("#1f2937")
_ROW_ALT = colors.HexColor("#f3f4f6")
_GRID = colors.HexColor("#d1d5db")
_MUTED = colors.HexColor("#6b7280")

_STATUS_LABELS = {
    "present": "Present",
    "late": "Present (arrived late)",
    "left_early": "Present (left early)",
    "excused": "Excused",
    "absent": "Absent",
    "guest": "Guest",
}
_STATUS_ORDER = ["present", "late", "left_early", "excused", "absent", "guest"]


def _esc(value: Any) -> str:
    return html.escape(str(value)) if value is not None else ""


def _text(value: Any) -> str:
    """Escaped text with line breaks kept, for a Paragraph."""
    return _esc(value).replace("\r\n", "\n").replace("\n", "<br/>")


def _styled_table(data: List[List[Any]], col_widths: List[float]) -> Table:
    style = TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), _HEADER_BG),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ROW_ALT]),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]
    )
    return Table(data, colWidths=col_widths, repeatRows=1, style=style)


def _election_block(
    election: Dict[str, Any], styles: Any, section_style: ParagraphStyle
) -> List[Any]:
    snapshot = election.get("snapshot") or {}
    out: List[Any] = [
        Paragraph(f"Election result — {_esc(election.get('title'))}", section_style)
    ]
    if election.get("addendum"):
        out.append(
            Paragraph(
                "<i>Addendum: filed "
                f"{_esc(election.get('filed_display') or '')} after these minutes "
                "were circulated. It records the final result of an election held "
                "at this meeting that closed later; it is not part of the text "
                "that was adopted.</i>",
                styles["Normal"],
            )
        )
    closed = election.get("closed_display")
    facts = [
        f"Eligible voters: {snapshot.get('total_eligible_voters', '—')}",
        f"Ballots cast: {snapshot.get('total_votes', '—')}",
        f"Turnout: {snapshot.get('voter_turnout_percentage', '—')}%",
    ]
    if snapshot.get("quorum_detail"):
        facts.append(f"Quorum: {snapshot['quorum_detail']}")
    elif snapshot.get("quorum_met") is not None:
        facts.append(f"Quorum: {'met' if snapshot['quorum_met'] else 'NOT met'}")
    if closed:
        facts.append(f"Closed {closed}")
    out.append(Paragraph(_esc(" · ".join(facts)), styles["Normal"]))

    contests = list(snapshot.get("results_by_position") or [])
    if snapshot.get("overall_results"):
        contests.append(
            {
                "position": "Other candidates" if contests else None,
                "candidates": snapshot["overall_results"],
            }
        )
    for contest in contests:
        label = contest.get("label") or contest.get("position")
        rows: List[List[Any]] = [["Candidate", "Votes", "%", "Outcome"]]
        for cand in contest.get("candidates", []):
            outcome = (
                "WINNER"
                if cand.get("is_winner")
                else "TIED" if cand.get("is_tied") else ""
            )
            rows.append(
                [
                    Paragraph(_esc(cand.get("candidate_name")), styles["Normal"]),
                    str(cand.get("vote_count", 0)),
                    f"{cand.get('percentage', 0)}%",
                    outcome,
                ]
            )
        out.append(Spacer(1, 4))
        if label:
            out.append(Paragraph(f"<b>{_esc(label)}</b>", styles["Normal"]))
        out.append(
            _styled_table(rows, [3.6 * inch, 1.0 * inch, 1.0 * inch, 1.4 * inch])
        )
    return out


def render_minutes_pdf(data: Dict[str, Any], meta: Dict[str, Any]) -> BytesIO:
    """Render the minutes, returning a BytesIO at position 0.

    *data* — ``title``, ``meeting_type_display``, ``meeting_date_display``,
    ``location``, ``called_by``, ``called_to_order``, ``adjourned``,
    ``status_display``, ``attendees`` (name, role, status, note),
    ``quorum_display``, ``sections`` (title, content), ``motions``,
    ``action_items``, ``election_results`` (title, closed_display, snapshot),
    ``attachments`` (title, category, name, sha256), ``approval`` (submitted_by,
    approved_by, approved_at_display, version, content_hash) or None,
    ``header`` and ``footer`` configs.

    *meta* — ``org_name``, ``generated_at``.
    """
    header: Dict[str, Any] = data.get("header") or {}
    footer: Dict[str, Any] = data.get("footer") or {}
    approval: Optional[Dict[str, Any]] = data.get("approval")

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.75 * inch,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        title=str(data.get("title") or "Meeting Minutes"),
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "MinTitle", parent=styles["Title"], fontSize=17, spaceAfter=2
    )
    sub_style = ParagraphStyle(
        "MinSub", parent=styles["Normal"], fontSize=9, textColor=_MUTED
    )
    section_style = ParagraphStyle(
        "MinSection",
        parent=styles["Heading2"],
        fontSize=12,
        spaceBefore=12,
        spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "MinBody", parent=styles["Normal"], fontSize=10, leading=13
    )
    # Rich-text blocks. Sub-headings sit under the section heading, so they are
    # smaller than it; a list item hangs its marker; a quote is indented.
    block_styles = {
        "p": body_style,
        "h2": ParagraphStyle(
            "MinH2",
            parent=body_style,
            fontName="Helvetica-Bold",
            fontSize=11,
            spaceBefore=6,
            spaceAfter=2,
        ),
        "h3": ParagraphStyle(
            "MinH3",
            parent=body_style,
            fontName="Helvetica-BoldOblique",
            fontSize=10,
            spaceBefore=4,
            spaceAfter=2,
        ),
        "li": ParagraphStyle(
            "MinItem", parent=body_style, leftIndent=18, firstLineIndent=-10
        ),
        "quote": ParagraphStyle(
            "MinQuote",
            parent=body_style,
            leftIndent=18,
            textColor=_MUTED,
            fontName="Helvetica-Oblique",
        ),
    }

    org_name = header.get("org_name") or meta.get("org_name")
    story: List[Any] = []
    if org_name:
        story.append(Paragraph(_esc(org_name), title_style))
    story.append(
        Paragraph(_esc(header.get("subtitle") or "Official Meeting Minutes"), sub_style)
    )
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"<b>{_esc(data.get('title'))}</b>", styles["Heading2"]))

    facts: List[str] = []
    if header.get("show_meeting_type", True) and data.get("meeting_type_display"):
        facts.append(f"Type: {data['meeting_type_display']}")
    if header.get("show_date", True) and data.get("meeting_date_display"):
        facts.append(f"Date: {data['meeting_date_display']}")
    if data.get("location"):
        facts.append(f"Location: {data['location']}")
    if data.get("called_by"):
        facts.append(f"Called by: {data['called_by']}")
    if data.get("called_to_order"):
        facts.append(f"Called to order: {data['called_to_order']}")
    if data.get("adjourned"):
        facts.append(f"Adjourned: {data['adjourned']}")
    if data.get("status_display"):
        facts.append(f"Status: {data['status_display']}")
    story.append(Paragraph(_esc("  |  ".join(facts)), sub_style))
    story.append(HRFlowable(width="100%", thickness=1, color=_GRID))

    # ── Attendance ───────────────────────────────────────────────────
    attendees = data.get("attendees") or []
    if attendees:
        story.append(Paragraph("Attendance", section_style))
        rows: List[List[Any]] = [["Name", "Role", "Attendance", "Note"]]
        for entry in sorted(
            attendees,
            key=lambda a: (
                (
                    _STATUS_ORDER.index(a["status"])
                    if a.get("status") in _STATUS_ORDER
                    else 99
                ),
                str(a.get("name") or "").lower(),
            ),
        ):
            rows.append(
                [
                    Paragraph(_esc(entry.get("name")), styles["Normal"]),
                    Paragraph(_esc(entry.get("role") or ""), styles["Normal"]),
                    _STATUS_LABELS.get(entry.get("status"), _esc(entry.get("status"))),
                    Paragraph(_esc(entry.get("note") or ""), styles["Normal"]),
                ]
            )
        story.append(
            _styled_table(rows, [2.4 * inch, 1.4 * inch, 1.6 * inch, 1.7 * inch])
        )
        if data.get("quorum_display"):
            story.append(Spacer(1, 4))
            story.append(
                Paragraph(f"<b>{_esc(data['quorum_display'])}</b>", body_style)
            )

    # ── Content sections ─────────────────────────────────────────────
    for section in data.get("sections") or []:
        if not section_is_printed(section):
            continue
        story.append(Paragraph(_esc(section.get("title")), section_style))
        if section.get("presenter"):
            story.append(
                Paragraph(f"Presented by {_esc(section['presenter'])}", body_style)
            )
        if section.get("not_taken_up"):
            story.append(Paragraph("<i>Not taken up.</i>", body_style))
        if normalize_format(section.get("format")) == FORMAT_HTML:
            for kind, markup in html_to_pdf_blocks(section.get("content")):
                story.append(Paragraph(markup, block_styles[kind]))
        else:
            story.append(Paragraph(_text(section["content"].strip()), body_style))

    # ── Motions ──────────────────────────────────────────────────────
    motions = data.get("motions") or []
    if motions:
        story.append(Paragraph(f"Motions ({len(motions)})", section_style))
        for motion in motions:
            lines = [
                f"<b>Motion {motion.get('number')}</b> — "
                f"<b>{_esc(str(motion.get('status') or '').upper())}</b>",
                _text(motion.get("text")),
            ]
            detail = [
                f"Moved by {motion['moved_by']}" if motion.get("moved_by") else "",
                (
                    f"Seconded by {motion['seconded_by']}"
                    if motion.get("seconded_by")
                    else ""
                ),
                motion.get("vote_display") or "",
            ]
            detail_text = " · ".join(d for d in detail if d)
            if detail_text:
                lines.append(
                    f'<font size="8" color="#6b7280">{_esc(detail_text)}</font>'
                )
            if motion.get("ballot"):
                lines.append(
                    f'<font size="9">Decided by ballot: {_esc(motion["ballot"])}</font>'
                )
            if motion.get("notes"):
                lines.append(
                    f'<font size="9">Discussion: {_text(motion["notes"])}</font>'
                )
            story.append(
                KeepTogether([Paragraph("<br/>".join(lines), body_style), Spacer(1, 6)])
            )

    # ── Closed sessions ──────────────────────────────────────────────
    for number, closed in enumerate(data.get("closed_sessions") or [], 1):
        story.append(Paragraph(f"Closed session {number}", section_style))
        span = f"{closed.get('started') or ''}"
        if closed.get("ended"):
            span += f" to {closed['ended']}"
        facts = [f"Reason: {closed.get('reason')}", f"Time: {span}"]
        if closed.get("legal_basis"):
            facts.append(f"Authority: {closed['legal_basis']}")
        story.append(Paragraph("<br/>".join(_esc(f) for f in facts), body_style))
        people = closed.get("participants") or []
        if people:
            rows = [["In the room", "Joined", "Left"]]
            for person in people:
                rows.append(
                    [
                        Paragraph(_esc(person.get("name")), styles["Normal"]),
                        person.get("joined") or "—",
                        person.get("left") or "—",
                    ]
                )
            story.append(Spacer(1, 4))
            story.append(_styled_table(rows, [3.8 * inch, 1.5 * inch, 1.5 * inch]))
        if closed.get("summary"):
            story.append(Spacer(1, 4))
            story.append(Paragraph(_text(closed["summary"]), body_style))

    # ── Action items ─────────────────────────────────────────────────
    items = data.get("action_items") or []
    if items:
        story.append(Paragraph(f"Action Items ({len(items)})", section_style))
        rows = [["Description", "Assignee", "Due", "Priority", "Status"]]
        for item in items:
            rows.append(
                [
                    Paragraph(_esc(item.get("description")), styles["Normal"]),
                    Paragraph(_esc(item.get("assignee") or "—"), styles["Normal"]),
                    item.get("due") or "—",
                    _esc(item.get("priority")),
                    _esc(str(item.get("status") or "").replace("_", " ")),
                ]
            )
        story.append(
            _styled_table(
                rows, [3.0 * inch, 1.5 * inch, 0.9 * inch, 0.7 * inch, 1.0 * inch]
            )
        )

    # ── Election results filed with the minutes ──────────────────────
    for election in data.get("election_results") or []:
        story.extend(_election_block(election, styles, section_style))

    # ── Attachments ──────────────────────────────────────────────────
    attachments = data.get("attachments") or []
    if attachments:
        story.append(Paragraph("Attachments", section_style))
        rows = [["Title", "Kind", "File", "SHA-256"]]
        for att in attachments:
            rows.append(
                [
                    Paragraph(_esc(att.get("title")), styles["Normal"]),
                    _esc(str(att.get("category") or "").replace("_", " ")),
                    Paragraph(_esc(att.get("name")), styles["Normal"]),
                    _esc(str(att.get("sha256") or "")[:16] + "…"),
                ]
            )
        story.append(
            _styled_table(rows, [2.4 * inch, 1.2 * inch, 2.2 * inch, 1.3 * inch])
        )

    # ── Approval and signatures ──────────────────────────────────────
    sign: List[Any] = [Paragraph("Approval", section_style)]
    if approval:
        sign.append(
            Paragraph(
                f"Submitted by {_esc(approval.get('submitted_by') or 'unknown')}; "
                f"approved by {_esc(approval.get('approved_by') or 'unknown')} "
                f"on {_esc(approval.get('approved_at_display'))} "
                f"(version {_esc(approval.get('version'))}).",
                body_style,
            )
        )
        if approval.get("adopted_on_display"):
            how = (
                " as amended"
                if approval.get("as_amended")
                else " as presented" if approval.get("as_amended") is False else ""
            )
            where = (
                f", at the meeting recorded in {approval['adopting_title']}"
                if approval.get("adopting_title")
                else ""
            )
            sign.append(
                Paragraph(
                    f"Adopted by the body on {_esc(approval['adopted_on_display'])}"
                    f"{_esc(how)}{_esc(where)}.",
                    body_style,
                )
            )
            movers = [
                f"{label} {approval[key]}"
                for label, key in (
                    ("Moved by", "moved_by"),
                    ("seconded by", "seconded_by"),
                )
                if approval.get(key)
            ]
            if movers:
                sign.append(Paragraph(_esc(", ".join(movers)) + ".", body_style))
        for signature in approval.get("signatures") or []:
            sign.append(
                Paragraph(
                    f"<b>{_esc(signature.get('title'))}:</b> "
                    f"{_esc(signature.get('name'))}, signed in the Logbook on "
                    f"{_esc(signature.get('signed_at_display'))}.",
                    body_style,
                )
            )
    else:
        sign.append(
            Paragraph(
                "These minutes have not been approved. They are a draft and "
                "may still change.",
                body_style,
            )
        )
    sign.append(Spacer(1, 26))
    sign.append(
        Table(
            [
                ["_________________________", "_________________________"],
                ["Recording Secretary", "Presiding Officer"],
                ["", ""],
                ["_________________________", "_________________________"],
                ["Date", "Date"],
            ],
            colWidths=[3.4 * inch, 3.4 * inch],
            style=TableStyle(
                [
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 2), (-1, 2), 14),
                ]
            ),
        )
    )
    story.append(KeepTogether(sign))

    footer_left = " · ".join(
        part
        for part in (
            footer.get("left_text"),
            footer.get("center_text"),
            footer.get("right_text"),
        )
        if part
    )
    notice = footer.get("confidentiality_notice")
    show_pages = footer.get("show_page_numbers", True)
    fingerprint = (
        f"Version {approval.get('version')} · SHA-256 {approval.get('content_hash')}"
        if approval and approval.get("content_hash")
        else ""
    )
    generated = f"Generated {meta.get('generated_at', '')}"

    def _decorate(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(_MUTED)
        width = letter[0]
        y = 0.5 * inch
        if notice:
            canvas.drawString(0.7 * inch, y + 20, str(notice)[:160])
        if fingerprint:
            canvas.drawString(0.7 * inch, y + 10, fingerprint)
        canvas.drawString(0.7 * inch, y, (footer_left or generated)[:110])
        if show_pages:
            canvas.drawRightString(width - 0.7 * inch, y, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_decorate, onLaterPages=_decorate)
    buf.seek(0)
    return buf
