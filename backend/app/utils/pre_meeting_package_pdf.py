"""
Pre-Meeting Package PDF renderer.

Renders the secretary's pre-meeting package for an election — meeting
details/agenda, election configuration, ballot preview with candidates, and
the voter-eligibility roster — to a print-ready PDF that can be emailed
ahead of an annual or special meeting and archived with the minutes.

Two variants share one renderer:
- member variant (``include_ineligibility_detail=False``): counts + the
  eligible-voter name list only
- full variant (``True``): additionally lists ineligible members with their
  per-member reasons and the granted overrides — leadership-only detail
  (membership tier / attendance shortfalls are not broadcast to members)

Kept separate from the service so the layout logic lives in one place and
can be unit-tested without a database (same convention as
``impact_plan_pdf.render_impact_plan_pdf``).
"""

import html
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_HEADER_BG = colors.HexColor("#1f2937")
_ROW_ALT = colors.HexColor("#f3f4f6")
_GRID = colors.HexColor("#d1d5db")
_MUTED = colors.HexColor("#6b7280")

_VOTING_METHOD_LABELS = {
    "simple_majority": "Simple majority (one choice per position)",
    "ranked_choice": "Ranked choice (instant runoff)",
    "approval": "Approval (approve any number of candidates)",
    "supermajority": "Supermajority (single choice, higher threshold)",
}

_VICTORY_LABELS = {
    "most_votes": "Most votes",
    "majority": "Majority (>50% of votes cast)",
    "supermajority": "Supermajority",
    "threshold": "Vote-count threshold",
}

_VOTER_TYPE_LABELS = {
    "all": "All members",
    "operational": "Operational (active) members",
    "administrative": "Administrative members",
    "regular": "Regular members (active + life)",
    "life": "Life members",
    "probationary": "Probationary members",
}


def _esc(value: Any) -> str:
    """Escape arbitrary text for use inside reportlab mini-HTML paragraphs."""
    return html.escape(str(value)) if value is not None else ""


def _styled_table(data: List[List[Any]], col_widths: List[float]) -> Table:
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), _HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ROW_ALT]),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    return Table(data, colWidths=col_widths, repeatRows=1, style=TableStyle(style))


def _plain_table(rows: List[List[Any]], col_widths: List[float]) -> Table:
    """Two-column label/value table without a header row."""
    style = [
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, _ROW_ALT]),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    return Table(rows, colWidths=col_widths, style=TableStyle(style))


def _fmt_dt(value: Optional[datetime]) -> str:
    if not value:
        return "—"
    return value.strftime("%B %d, %Y at %I:%M %p")


def _eligibility_summary(item: Dict[str, Any]) -> str:
    """Human-readable restriction summary for a ballot item."""
    types = item.get("eligible_voter_types") or ["all"]
    if "all" in types:
        label = "All members"
    else:
        label = ", ".join(_VOTER_TYPE_LABELS.get(t, t) for t in types)
    if item.get("require_attendance"):
        label += " — must be checked in at the meeting"
    return label


def _candidates_for_item(
    item: Dict[str, Any], candidates: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Match candidates to a ballot item by exact position (same rule the
    ballot page uses: item.position, else item title / item id)."""
    position = item.get("position")
    if position:
        return [c for c in candidates if c.get("position") == position]
    return [
        c
        for c in candidates
        if c.get("position")
        and c.get("position") in (item.get("title"), item.get("id"))
    ]


def render_pre_meeting_package_pdf(
    data: Dict[str, Any],
    meta: Dict[str, Any],
    include_ineligibility_detail: bool = False,
) -> BytesIO:
    """Render the package *data* into a PDF, returning a BytesIO at pos 0.

    *data* is assembled by the service (no DB access here):
      ``election`` (dict of display fields), optional ``meeting`` dict,
      ``ballot_items`` (ordered dicts), ``candidates`` (accepted, ordered),
      ``roster`` (summary counts + ``eligible`` / ``ineligible`` /
      ``overrides`` lists).
    *meta*: ``org_name``, ``generated_at`` (datetime, org-local).
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
        title="Pre-Meeting Package",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "PkgTitle", parent=styles["Title"], fontSize=18, spaceAfter=2
    )
    sub_style = ParagraphStyle(
        "PkgSub", parent=styles["Normal"], fontSize=9, textColor=_MUTED
    )
    section_style = ParagraphStyle(
        "PkgSection",
        parent=styles["Heading2"],
        fontSize=12,
        spaceBefore=14,
        spaceAfter=6,
    )
    item_title_style = ParagraphStyle(
        "PkgItemTitle",
        parent=styles["Heading3"],
        fontSize=10,
        spaceBefore=8,
        spaceAfter=2,
    )
    body_style = ParagraphStyle(
        "PkgBody", parent=styles["Normal"], fontSize=8.5, leading=11
    )
    cell_style = ParagraphStyle(
        "PkgCell", parent=styles["Normal"], fontSize=8, leading=10
    )

    election: Dict[str, Any] = data.get("election") or {}
    meeting: Optional[Dict[str, Any]] = data.get("meeting")
    ballot_items: List[Dict[str, Any]] = data.get("ballot_items") or []
    candidates: List[Dict[str, Any]] = data.get("candidates") or []
    roster: Dict[str, Any] = data.get("roster") or {}

    story: List[Any] = []

    # ---- Header ----
    story.append(Paragraph("Pre-Meeting Package", title_style))
    generated_at: datetime = meta.get("generated_at") or datetime.utcnow()
    org_name = meta.get("org_name") or ""
    story.append(
        Paragraph(
            f"{_esc(org_name)} &middot; Generated {_esc(_fmt_dt(generated_at))}",
            sub_style,
        )
    )
    story.append(Spacer(1, 6))
    story.append(Paragraph(_esc(election.get("title")), section_style))
    if election.get("description"):
        story.append(Paragraph(_esc(election.get("description")), body_style))

    # ---- Meeting ----
    if meeting:
        story.append(Paragraph("Meeting", section_style))
        meeting_rows = [
            ["Meeting", _esc(meeting.get("title"))],
            ["Type", _esc(meeting.get("meeting_type") or "—")],
            ["Date", _esc(meeting.get("date_display") or "—")],
            ["Location", _esc(meeting.get("location") or "—")],
        ]
        story.append(_plain_table(meeting_rows, [1.4 * inch, 5.6 * inch]))
        if meeting.get("agenda"):
            story.append(Paragraph("Agenda", item_title_style))
            # Preserve line breaks from the free-text agenda field
            agenda_html = _esc(meeting["agenda"]).replace("\n", "<br/>")
            story.append(Paragraph(agenda_html, body_style))

    # ---- Voting window / election configuration ----
    story.append(Paragraph("Election Configuration", section_style))
    victory = _VICTORY_LABELS.get(
        election.get("victory_condition"), election.get("victory_condition") or "—"
    )
    if election.get("victory_percentage"):
        victory += f" ({election['victory_percentage']}%)"
    if election.get("victory_threshold"):
        victory += f" ({election['victory_threshold']} votes)"

    quorum_type = election.get("quorum_type") or "none"
    if quorum_type == "percentage":
        quorum = f"{election.get('quorum_value')}% voter turnout required"
    elif quorum_type == "count":
        quorum = f"{election.get('quorum_value')} voters required"
    else:
        quorum = "None"

    runoffs = "Disabled"
    if election.get("enable_runoffs"):
        runoff_type = (
            "top two advance"
            if election.get("runoff_type") == "top_two"
            else "eliminate lowest"
        )
        runoffs = (
            f"Automatic ({runoff_type}, up to "
            f"{election.get('max_runoff_rounds')} rounds)"
        )

    config_rows = [
        ["Voting opens", _esc(election.get("start_display") or "—")],
        ["Voting closes", _esc(election.get("end_display") or "—")],
        [
            "Voting method",
            _esc(
                _VOTING_METHOD_LABELS.get(
                    election.get("voting_method"),
                    election.get("voting_method") or "—",
                )
            ),
        ],
        ["Victory condition", _esc(victory)],
        [
            "Ballot secrecy",
            (
                "Anonymous (secret ballot)"
                if election.get("anonymous_voting")
                else "Recorded (non-anonymous)"
            ),
        ],
        [
            "Write-in candidates",
            "Allowed" if election.get("allow_write_ins") else "Not allowed",
        ],
        ["Quorum", _esc(quorum)],
        [
            "Proxy voting",
            (
                "Available (authorized proxies may vote for absent members)"
                if election.get("proxy_voting_enabled")
                else "Not enabled"
            ),
        ],
        ["Runoffs", _esc(runoffs)],
    ]
    story.append(_plain_table(config_rows, [1.4 * inch, 5.6 * inch]))

    # ---- Ballot preview ----
    story.append(
        Paragraph(f"Ballot Preview ({len(ballot_items)} items)", section_style)
    )
    if not ballot_items:
        # Positional election without structured ballot items — group by position
        positions: List[str] = election.get("positions") or []
        if positions:
            for position in positions:
                story.append(Paragraph(_esc(position), item_title_style))
                pos_candidates = [
                    c for c in candidates if c.get("position") == position
                ]
                _append_candidates(story, pos_candidates, body_style)
        elif candidates:
            story.append(Paragraph("Candidates", item_title_style))
            _append_candidates(story, candidates, body_style)
        else:
            story.append(
                Paragraph("No ballot items or candidates configured.", body_style)
            )
    else:
        for idx, item in enumerate(ballot_items, start=1):
            story.append(
                Paragraph(f"{idx}. {_esc(item.get('title'))}", item_title_style)
            )
            if item.get("description"):
                story.append(Paragraph(_esc(item["description"]), body_style))
            detail_bits = [f"Eligible to vote: {_esc(_eligibility_summary(item))}"]
            if item.get("victory_condition"):
                item_victory = _VICTORY_LABELS.get(
                    item["victory_condition"], item["victory_condition"]
                )
                if item.get("victory_percentage"):
                    item_victory += f" ({item['victory_percentage']}%)"
                detail_bits.append(f"Passes by: {_esc(item_victory)}")
            story.append(
                Paragraph(
                    f"<font color='#6b7280'>{' &middot; '.join(detail_bits)}</font>",
                    body_style,
                )
            )
            item_candidates = _candidates_for_item(item, candidates)
            if item_candidates:
                _append_candidates(story, item_candidates, body_style)
            elif item.get("vote_type") == "approval":
                story.append(
                    Paragraph(
                        "<i>Approve / Deny / Abstain vote</i>",
                        body_style,
                    )
                )

    # ---- Eligible voters ----
    eligible: List[Dict[str, Any]] = roster.get("eligible") or []
    story.append(Paragraph("Voter Eligibility", section_style))
    summary_rows = [
        ["Active members", str(roster.get("total_members", 0))],
        ["Eligible to vote", str(roster.get("total_eligible", 0))],
        ["Not eligible", str(roster.get("total_ineligible", 0))],
        ["Eligibility overrides granted", str(roster.get("total_overrides", 0))],
    ]
    story.append(_plain_table(summary_rows, [2.6 * inch, 1.4 * inch]))

    story.append(Paragraph(f"Eligible Voters ({len(eligible)})", item_title_style))
    if eligible:
        rows: List[List[Any]] = [["Member", "Membership Type", ""]]
        for member in eligible:
            rows.append(
                [
                    Paragraph(_esc(member.get("full_name")), cell_style),
                    _esc(member.get("membership_type") or "—"),
                    "override" if member.get("has_override") else "",
                ]
            )
        story.append(_styled_table(rows, [3.2 * inch, 2.2 * inch, 1.0 * inch]))
    else:
        story.append(Paragraph("No eligible voters found.", body_style))

    # ---- Full variant: ineligibility detail + overrides ----
    if include_ineligibility_detail:
        ineligible: List[Dict[str, Any]] = roster.get("ineligible") or []
        story.append(
            Paragraph(
                f"Ineligible Members ({len(ineligible)}) — leadership detail",
                item_title_style,
            )
        )
        if ineligible:
            rows = [["Member", "Reason"]]
            for member in ineligible:
                rows.append(
                    [
                        Paragraph(_esc(member.get("full_name")), cell_style),
                        Paragraph(
                            _esc(member.get("reason") or "Not eligible"),
                            cell_style,
                        ),
                    ]
                )
            story.append(_styled_table(rows, [2.4 * inch, 4.6 * inch]))
        else:
            story.append(
                Paragraph("None — every active member is eligible.", body_style)
            )

        overrides: List[Dict[str, Any]] = roster.get("overrides") or []
        if overrides:
            story.append(
                Paragraph(f"Eligibility Overrides ({len(overrides)})", item_title_style)
            )
            rows = [["Member", "Reason", "Granted By"]]
            for record in overrides:
                rows.append(
                    [
                        Paragraph(_esc(record.get("full_name")), cell_style),
                        Paragraph(_esc(record.get("reason") or "—"), cell_style),
                        Paragraph(
                            _esc(record.get("overridden_by_name") or "—"),
                            cell_style,
                        ),
                    ]
                )
            story.append(_styled_table(rows, [2.0 * inch, 3.0 * inch, 2.0 * inch]))

    # ---- Footer ----
    story.append(Spacer(1, 12))
    story.append(
        Paragraph(
            "Generated by The Logbook. Figures reflect voter eligibility at "
            "generation time; eligibility is re-checked when each vote is cast.",
            sub_style,
        )
    )

    doc.build(story)
    buf.seek(0)
    return buf


def _append_candidates(
    story: List[Any], candidates: List[Dict[str, Any]], body_style: ParagraphStyle
) -> None:
    """Append a candidate list (with optional statements) to the story."""
    if not candidates:
        story.append(Paragraph("<i>No candidates nominated yet.</i>", body_style))
        return
    for c in candidates:
        line = f"&bull; <b>{_esc(c.get('name'))}</b>"
        if c.get("statement"):
            line += f" — {_esc(c['statement'])}"
        story.append(Paragraph(line, body_style))
