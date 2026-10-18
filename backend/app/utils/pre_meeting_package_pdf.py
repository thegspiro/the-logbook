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

It shares the ballot's and certified results' letterhead, grayscale palette,
heading bands and table style (``election_pdf_style``): the three are
filed together with the minutes and should read as one set.
"""

from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    Flowable,
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

from app.utils.election_pdf_style import (
    INK,
    MUTED,
    SIDE_MARGIN,
    VERTICAL_MARGIN,
    base_styles,
    esc,
    heading_band,
    key_value_table,
    letterhead,
    padded,
    page_footer,
    ruled_table,
    section,
)

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


def summarize_item_eligibility(
    ballot_items: List[Dict[str, Any]],
    roster_members: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Fold the roster's per-member ``item_eligibility`` into one row per
    ballot item.

    The election-level counts answer "who receives a ballot at all", and a
    member blocked on a single attendance-gated item still receives one — so
    those counts read "Not eligible 0" while most of the room cannot vote on
    that item. The per-item rows are what make that visible. They consume the
    roster's own verdicts rather than re-checking attendance or tiers here
    (Pitfall #29): the roster is the one place eligibility is decided.
    """
    by_item: Dict[str, Dict[str, Any]] = {}
    for item in ballot_items:
        item_id = item.get("id") or ""
        by_item[item_id] = {
            "ballot_item_id": item_id,
            "title": item.get("title") or "",
            "eligible_count": 0,
            "eligible_by_override": 0,
            "blocked_count": 0,
            "blocked_reasons": {},
            "blocked_members": [],
        }
    for member in roster_members:
        for verdict in member.get("item_eligibility") or []:
            row = by_item.get(verdict.get("ballot_item_id") or "")
            if row is None:
                continue
            if verdict.get("eligible"):
                row["eligible_count"] += 1
                if member.get("has_override"):
                    row["eligible_by_override"] += 1
                continue
            reason = verdict.get("reason") or "Not eligible"
            row["blocked_count"] += 1
            row["blocked_reasons"][reason] = row["blocked_reasons"].get(reason, 0) + 1
            row["blocked_members"].append(
                {"full_name": member.get("full_name") or "", "reason": reason}
            )
    summary: List[Dict[str, Any]] = []
    for row in by_item.values():
        reasons = row.pop("blocked_reasons")
        row["blocked_reasons"] = [
            {"reason": reason, "count": count}
            for reason, count in sorted(reasons.items(), key=lambda kv: -kv[1])
        ]
        summary.append(row)
    return summary


def _subhead(text: str, styles: Dict[str, ParagraphStyle]) -> Paragraph:
    return Paragraph(text, styles["subhead"])


def _kv(rows: List[List[str]], styles: Dict[str, ParagraphStyle]) -> Flowable:
    """Label/value rows with the value as wrapping, escaped text.

    The value goes in a Paragraph rather than a bare string: a bare table
    cell is printed literally, so escaping it put "&gt;" on the page, and an
    unescaped Paragraph would read a "<" in a meeting title as markup.
    """
    return key_value_table(
        [[label, Paragraph(esc(value), styles["cell"])] for label, value in rows],
        label_fraction=0.3,
    )


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
      ``overrides`` lists, plus ``items`` from
      :func:`summarize_item_eligibility`).
    *meta*: ``org_name``, ``generated_at`` (datetime, org-local), and
    optional ``logo`` — the organization's stored logo data URI.
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=VERTICAL_MARGIN,
        bottomMargin=VERTICAL_MARGIN,
        leftMargin=SIDE_MARGIN,
        rightMargin=SIDE_MARGIN,
        title="Pre-Meeting Package",
    )

    styles = base_styles("Pkg")
    styles["body"] = ParagraphStyle(
        "PkgBody", parent=styles["panel"], fontSize=10, leading=14
    )
    styles["cell"] = ParagraphStyle(
        "PkgCell", parent=styles["panel"], fontSize=10, leading=12
    )
    styles["meta"] = ParagraphStyle(
        "PkgMeta",
        parent=styles["panel"],
        fontSize=9,
        leading=12,
        textColor=MUTED,
        spaceBefore=2,
    )
    styles["subhead"] = ParagraphStyle(
        "PkgSubhead",
        parent=styles["panel"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        leftIndent=8,
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True,
    )

    election: Dict[str, Any] = data.get("election") or {}
    meeting: Optional[Dict[str, Any]] = data.get("meeting")
    ballot_items: List[Dict[str, Any]] = data.get("ballot_items") or []
    candidates: List[Dict[str, Any]] = data.get("candidates") or []
    roster: Dict[str, Any] = data.get("roster") or {}

    # ---- Header ----
    generated_at: datetime = meta.get("generated_at") or datetime.utcnow()
    story: List[Any] = [
        letterhead(
            meta.get("org_name"),
            "PRE-MEETING PACKAGE",
            [
                Paragraph(esc(election.get("title")), styles["election"]),
                Paragraph(f"Generated {esc(_fmt_dt(generated_at))}", styles["meta"]),
            ],
            meta.get("logo"),
            styles,
            "Pre-Meeting Package",
        ),
        Spacer(1, 8),
        HRFlowable(width="100%", thickness=2, color=INK),
        Spacer(1, 10),
    ]
    if election.get("description"):
        story += [
            padded([Paragraph(esc(election.get("description")), styles["body"])]),
            Spacer(1, 14),
        ]

    # ---- Meeting ----
    if meeting:
        meeting_body: List[Any] = [
            _kv(
                [
                    ["Meeting", meeting.get("title") or ""],
                    ["Type", meeting.get("meeting_type") or "—"],
                    ["Date", meeting.get("date_display") or "—"],
                    ["Location", meeting.get("location") or "—"],
                ],
                styles,
            )
        ]
        if meeting.get("agenda"):
            # Preserve line breaks from the free-text agenda field
            agenda_html = esc(meeting["agenda"]).replace("\n", "<br/>")
            meeting_body += [
                _subhead("Agenda", styles),
                padded([Paragraph(agenda_html, styles["body"])]),
            ]
        story.append(section("Meeting", meeting_body, styles))

    # ---- Voting window / election configuration ----
    victory_condition: Optional[str] = election.get("victory_condition")
    # A missing condition is never a key, so "" falls through to the "—" default
    # exactly as a None lookup would.
    victory = _VICTORY_LABELS.get(victory_condition or "", victory_condition or "—")
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
        ["Voting opens", election.get("start_display") or "—"],
        ["Voting closes", election.get("end_display") or "—"],
        [
            "Voting method",
            _VOTING_METHOD_LABELS.get(
                election.get("voting_method") or "",
                election.get("voting_method") or "—",
            ),
        ],
        ["Victory condition", victory],
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
        ["Quorum", quorum],
        [
            "Proxy voting",
            (
                "Available (authorized proxies may vote for absent members)"
                if election.get("proxy_voting_enabled")
                else "Not enabled"
            ),
        ],
        ["Runoffs", runoffs],
    ]
    story.append(section("Election Configuration", [_kv(config_rows, styles)], styles))

    # ---- Ballot preview ----
    # Each block is one item (or position) kept whole; the band is bound to
    # the first so it never sits alone at the foot of a page, without
    # dragging the whole preview — which can run for pages — along with it.
    preview: List[Any] = []
    if not ballot_items:
        # Positional election without structured ballot items — group by position
        positions: List[str] = election.get("positions") or []
        if positions:
            for position in positions:
                pos_candidates = [
                    c for c in candidates if c.get("position") == position
                ]
                preview.append(
                    KeepTogether(
                        [
                            _subhead(esc(position), styles),
                            _candidate_list(pos_candidates, styles),
                        ]
                    )
                )
        elif candidates:
            preview.append(
                KeepTogether(
                    [
                        _subhead("Candidates", styles),
                        _candidate_list(candidates, styles),
                    ]
                )
            )
        else:
            preview.append(
                padded(
                    [
                        Paragraph(
                            "No ballot items or candidates configured.",
                            styles["body"],
                        )
                    ]
                )
            )
    else:
        for idx, item in enumerate(ballot_items, start=1):
            item_parts: List[Any] = [
                _subhead(f"{idx}. {esc(item.get('title'))}", styles)
            ]
            lines: List[Paragraph] = []
            if item.get("description"):
                lines.append(Paragraph(esc(item["description"]), styles["body"]))
            detail_bits = [f"Eligible to vote: {esc(_eligibility_summary(item))}"]
            if item.get("victory_condition"):
                item_victory = _VICTORY_LABELS.get(
                    item["victory_condition"], item["victory_condition"]
                )
                if item.get("victory_percentage"):
                    item_victory += f" ({item['victory_percentage']}%)"
                detail_bits.append(f"Passes by: {esc(item_victory)}")
            lines.append(Paragraph(" &middot; ".join(detail_bits), styles["note"]))
            item_parts.append(padded(lines))
            item_candidates = _candidates_for_item(item, candidates)
            if item_candidates:
                item_parts.append(_candidate_list(item_candidates, styles))
            elif item.get("vote_type") == "approval":
                item_parts.append(
                    padded(
                        [
                            Paragraph(
                                "<i>Approve / Deny / Abstain vote</i>", styles["body"]
                            )
                        ]
                    )
                )
            preview.append(KeepTogether(item_parts))
    story.append(
        KeepTogether(
            [
                heading_band(f"Ballot Preview ({len(ballot_items)} items)", [], styles),
                preview[0],
            ]
        )
    )
    story += preview[1:]
    story.append(Spacer(1, 14))

    # ---- Eligible voters ----
    eligible: List[Dict[str, Any]] = roster.get("eligible") or []
    story.append(
        section(
            "Voter Eligibility",
            [
                key_value_table(
                    [
                        ["Active members", str(roster.get("total_members", 0))],
                        ["Eligible to vote", str(roster.get("total_eligible", 0))],
                        ["Not eligible", str(roster.get("total_ineligible", 0))],
                        [
                            "Eligibility overrides granted",
                            str(roster.get("total_overrides", 0)),
                        ],
                    ],
                    label_fraction=0.45,
                )
            ],
            styles,
        )
    )

    # ---- Per-item eligibility ----
    # The counts above are election-level ("receives a ballot"); an
    # attendance- or tier-gated item can still block most of the room, and
    # nothing above would say so.
    item_summary: List[Dict[str, Any]] = roster.get("items") or []
    any_item_blocked = any(row.get("blocked_count") for row in item_summary)
    if item_summary:
        story.append(_subhead("Eligibility by Ballot Item", styles))
        rows: List[List[Any]] = [["Ballot Item", "Eligible", "Not eligible", "Why not"]]
        for row in item_summary:
            eligible_text = str(row.get("eligible_count", 0))
            if row.get("eligible_by_override"):
                eligible_text += f" ({row['eligible_by_override']} by override)"
            why = "; ".join(
                f"{esc(r.get('reason'))}: {r.get('count', 0)}"
                for r in row.get("blocked_reasons") or []
            )
            rows.append(
                [
                    Paragraph(esc(row.get("title")), styles["cell"]),
                    Paragraph(eligible_text, styles["cell"]),
                    str(row.get("blocked_count", 0)),
                    Paragraph(why or "—", styles["cell"]),
                ]
            )
        story.append(ruled_table(rows, [0.34, 0.2, 0.14, 0.32], []))

    story.append(_subhead(f"Eligible Voters ({len(eligible)})", styles))
    if eligible:
        rows = [["Member", "Membership Type", ""]]
        for member in eligible:
            rows.append(
                [
                    Paragraph(esc(member.get("full_name")), styles["cell"]),
                    Paragraph(
                        esc(member.get("membership_type") or "—"), styles["cell"]
                    ),
                    "override" if member.get("has_override") else "",
                ]
            )
        story.append(ruled_table(rows, [0.48, 0.34, 0.18], []))
    else:
        story.append(padded([Paragraph("No eligible voters found.", styles["body"])]))

    # ---- Full variant: ineligibility detail + overrides ----
    if include_ineligibility_detail:
        ineligible: List[Dict[str, Any]] = roster.get("ineligible") or []
        story.append(
            _subhead(
                f"Ineligible Members ({len(ineligible)}) — leadership detail",
                styles,
            )
        )
        if ineligible:
            rows = [["Member", "Reason"]]
            for member in ineligible:
                rows.append(
                    [
                        Paragraph(esc(member.get("full_name")), styles["cell"]),
                        Paragraph(
                            esc(member.get("reason") or "Not eligible"),
                            styles["cell"],
                        ),
                    ]
                )
            story.append(ruled_table(rows, [0.34, 0.66], []))
        elif any_item_blocked:
            story.append(
                padded(
                    [
                        Paragraph(
                            "None — every active member receives a ballot; the "
                            "members blocked on individual items are listed below.",
                            styles["body"],
                        )
                    ]
                )
            )
        else:
            story.append(
                padded(
                    [
                        Paragraph(
                            "None — every active member is eligible.", styles["body"]
                        )
                    ]
                )
            )

        # Who is blocked on each item, and why — leadership detail, like the
        # per-member reasons above.
        for row in item_summary:
            blocked = row.get("blocked_members") or []
            if not blocked:
                continue
            story.append(
                _subhead(
                    f"Not eligible for {esc(row.get('title'))} ({len(blocked)})",
                    styles,
                )
            )
            rows = [["Member", "Reason"]]
            for member in blocked:
                rows.append(
                    [
                        Paragraph(esc(member.get("full_name")), styles["cell"]),
                        Paragraph(esc(member.get("reason")), styles["cell"]),
                    ]
                )
            story.append(ruled_table(rows, [0.34, 0.66], []))

        overrides: List[Dict[str, Any]] = roster.get("overrides") or []
        if overrides:
            story.append(_subhead(f"Eligibility Overrides ({len(overrides)})", styles))
            rows = [["Member", "Reason", "Granted By"]]
            for record in overrides:
                rows.append(
                    [
                        Paragraph(esc(record.get("full_name")), styles["cell"]),
                        Paragraph(esc(record.get("reason") or "—"), styles["cell"]),
                        Paragraph(
                            esc(record.get("overridden_by_name") or "—"),
                            styles["cell"],
                        ),
                    ]
                )
            story.append(ruled_table(rows, [0.3, 0.42, 0.28], []))

    # ---- Footer ----
    story += [
        Spacer(1, 16),
        HRFlowable(width="100%", thickness=0.75, color=MUTED),
        Spacer(1, 4),
        Paragraph(
            "Generated by The Logbook. Figures reflect voter eligibility at "
            "generation time; eligibility is re-checked when each vote is cast.",
            styles["footer"],
        ),
    ]

    footer = page_footer(f"Pre-Meeting Package · {election.get('title') or ''}")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    buf.seek(0)
    return buf


def _candidate_list(
    candidates: List[Dict[str, Any]], styles: Dict[str, ParagraphStyle]
) -> Flowable:
    """A candidate list (with optional statements), inset under its item."""
    if not candidates:
        return padded(
            [Paragraph("<i>No candidates nominated yet.</i>", styles["body"])]
        )
    lines = []
    for c in candidates:
        line = f"&bull; <b>{esc(c.get('name'))}</b>"
        if c.get("statement"):
            line += f" — {esc(c['statement'])}"
        lines.append(Paragraph(line, styles["body"]))
    return padded(lines)
