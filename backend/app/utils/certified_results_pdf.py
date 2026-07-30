"""
Certified election results renderer.

The formal record of a closed election for the meeting minutes and the
department's files: final tallies per position (winners and unresolved
ties flagged), turnout and quorum, the paper-ballot batch attestation
trail (including voided and never-attested batches), the cryptographic
integrity-verification outcome, and signature lines for the certifying
officers.

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

_HEADER_BG = colors.HexColor("#1f2937")
_ROW_ALT = colors.HexColor("#f3f4f6")
_GRID = colors.HexColor("#d1d5db")
_MUTED = colors.HexColor("#6b7280")

_TIE_POLICY_LABELS = {
    "co_winners": "All tied candidates are declared winners",
    "runoff": "Resolved by a runoff round",
    "revote": "Resolved by a revote at the meeting",
    "chair_decides": "Resolved by the chair per the bylaws",
}

_BATCH_STATUS_LABELS = {
    "confirmed": "Confirmed",
    "pending": "NEVER ATTESTED — excluded from results",
    "voided": "Voided — excluded from results",
}


def _esc(value: Any) -> str:
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


def render_certified_results_pdf(data: Dict[str, Any], meta: Dict[str, Any]) -> BytesIO:
    """Render the certified results, returning a BytesIO at position 0.

    *data*: ``election`` (display fields), ``results`` (ElectionResults
    dump), ``stats`` (ElectionStats dump), ``batches`` (paper batches with
    status + attester names), ``integrity`` (verify_vote_integrity dict).
    *meta*: ``org_name``, ``generated_at`` (display string).
    """
    election = data.get("election", {})
    results = data.get("results", {})
    stats = data.get("stats", {})
    integrity = data.get("integrity", {})

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        title="Certified Election Results",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CertTitle", parent=styles["Title"], fontSize=16, spaceAfter=2
    )
    sub_style = ParagraphStyle(
        "CertSub", parent=styles["Normal"], fontSize=9, textColor=_MUTED
    )
    section_style = ParagraphStyle(
        "CertSection",
        parent=styles["Heading2"],
        fontSize=12,
        spaceBefore=12,
        spaceAfter=4,
    )
    warn_style = ParagraphStyle(
        "CertWarn",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#b45309"),
    )

    story: List[Any] = [
        Paragraph("Certified Election Results", title_style),
        Paragraph(
            f"{_esc(election.get('title'))} — {_esc(meta.get('org_name'))}",
            sub_style,
        ),
        Paragraph(
            f"Election closed {_esc(election.get('closed_display'))} · "
            f"Generated {_esc(meta.get('generated_at'))}",
            sub_style,
        ),
        Spacer(1, 8),
        HRFlowable(width="100%", thickness=1, color=_GRID),
    ]

    # ── Turnout & quorum ─────────────────────────────────────────────
    story.append(Paragraph("Turnout & Quorum", section_style))
    turnout_rows = [
        ["Eligible voters", str(results.get("total_eligible_voters", "—"))],
        ["Ballots cast", str(results.get("total_votes", "—"))],
        [
            "Turnout",
            f"{results.get('voter_turnout_percentage', 0)}%",
        ],
        [
            "Electronic / paper votes",
            f"{stats.get('electronic_votes', 0)} / {stats.get('manual_votes', 0)}",
        ],
        [
            "Quorum",
            (
                _esc(results.get("quorum_detail"))
                if results.get("quorum_detail")
                else ("Met" if results.get("quorum_met", True) else "NOT MET")
            ),
        ],
    ]
    story.append(
        Table(
            turnout_rows,
            colWidths=[2.0 * inch, 5.0 * inch],
            style=TableStyle(
                [
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            ),
        )
    )

    # ── Results per position ─────────────────────────────────────────
    for position in results.get("results_by_position", []):
        story.append(
            Paragraph(f"Results — {_esc(position.get('position'))}", section_style)
        )
        rows = [["Candidate", "Votes", "%", "Outcome"]]
        for cand in position.get("candidates", []):
            if cand.get("is_winner"):
                outcome = "WINNER"
            elif cand.get("is_tied"):
                outcome = "TIED"
            else:
                outcome = ""
            rows.append(
                [
                    Paragraph(_esc(cand.get("candidate_name")), styles["Normal"]),
                    str(cand.get("vote_count", 0)),
                    f"{cand.get('percentage', 0)}%",
                    outcome,
                ]
            )
        story.append(
            _styled_table(rows, [3.6 * inch, 1.0 * inch, 1.0 * inch, 1.4 * inch])
        )
        if position.get("is_tie"):
            policy = data.get("election", {}).get("tie_policy") or "co_winners"
            story.append(Spacer(1, 3))
            story.append(
                Paragraph(
                    f"UNRESOLVED TIE for {_esc(position.get('position'))} — "
                    f"{_TIE_POLICY_LABELS.get(policy, policy)}.",
                    warn_style,
                )
            )

    # ── Paper-ballot batches ─────────────────────────────────────────
    batches = data.get("batches", [])
    if batches:
        story.append(Paragraph("Paper-Ballot Batches", section_style))
        rows = [["Status", "Ballots", "Recorded by", "Attested by"]]
        for batch in batches:
            rows.append(
                [
                    _BATCH_STATUS_LABELS.get(
                        batch.get("status"), _esc(batch.get("status"))
                    ),
                    str(batch.get("total_ballots", 0)),
                    Paragraph(
                        _esc(batch.get("recorded_by_name") or "unknown"),
                        styles["Normal"],
                    ),
                    Paragraph(
                        _esc(", ".join(batch.get("attester_names", []) or ["—"])),
                        styles["Normal"],
                    ),
                ]
            )
        story.append(
            _styled_table(rows, [2.4 * inch, 0.8 * inch, 1.9 * inch, 1.9 * inch])
        )

    # ── Integrity verification ───────────────────────────────────────
    story.append(Paragraph("Integrity Verification", section_style))
    status = integrity.get("integrity_status") or integrity.get("error") or "—"
    story.append(
        Paragraph(
            f"Cryptographic vote-signature and chain verification: "
            f"<b>{_esc(status)}</b> "
            f"({integrity.get('total_votes', integrity.get('total', 0))} "
            f"votes checked).",
            styles["Normal"],
        )
    )
    if election.get("anonymous_voting"):
        story.append(
            Paragraph(
                "This was an anonymous election: the per-election anonymity "
                "salt was destroyed at close, making voter de-anonymization "
                "impossible.",
                sub_style,
            )
        )

    # ── Certification signatures ─────────────────────────────────────
    story.append(Paragraph("Certification", section_style))
    story.append(
        Paragraph(
            "We certify that the results above are true and correct and "
            "were produced in accordance with the department's bylaws.",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 24))
    sig_rows = [
        ["_________________________", "_________________________"],
        ["President", "Chief"],
        ["", ""],
        ["_________________________", "_________________________"],
        ["Secretary", "Date"],
    ]
    story.append(
        Table(
            sig_rows,
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

    doc.build(story)
    buf.seek(0)
    return buf
