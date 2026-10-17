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

It shares the paper ballot's letterhead, grayscale palette and heading band
(``election_pdf_style``), so the ballot and its certified result read as
one set when they are filed together.
"""

from io import BytesIO
from typing import Any, Dict, List

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.utils.election_pdf_style import (
    CONTENT_WIDTH,
    INK,
    MUTED,
    SIDE_MARGIN,
    VERTICAL_MARGIN,
    base_styles,
    esc,
    key_value_table,
    letterhead,
    padded,
    page_footer,
    panel,
    ruled_table,
    section,
)

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


def _quorum_cell(results: Dict[str, Any]) -> str:
    """Quorum row text. ``quorum_met`` is None when the election has no
    quorum rule, and that must not print as "Met" (W50-48).

    Returned unescaped: it lands in a bare table cell, which prints its text
    literally, so escaping it would put "&amp;" on the page."""
    if results.get("quorum_detail"):
        return str(results["quorum_detail"])
    met = results.get("quorum_met")
    if met is None:
        return "No quorum requirement"
    return "Met" if met else "NOT MET"


def render_certified_results_pdf(data: Dict[str, Any], meta: Dict[str, Any]) -> BytesIO:
    """Render the certified results, returning a BytesIO at position 0.

    *data*: ``election`` (display fields), ``results`` (ElectionResults
    dump), ``stats`` (ElectionStats dump), ``batches`` (paper batches with
    status + attester names), ``integrity`` (verify_vote_integrity dict).
    *meta*: ``org_name``, ``generated_at`` (display string), and optional
    ``logo`` — the organization's stored logo data URI.
    """
    election = data.get("election", {})
    results = data.get("results", {})
    stats = data.get("stats", {})
    integrity = data.get("integrity", {})

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=VERTICAL_MARGIN,
        bottomMargin=VERTICAL_MARGIN,
        leftMargin=SIDE_MARGIN,
        rightMargin=SIDE_MARGIN,
        title="Certified Election Results",
    )

    styles = base_styles("Cert")
    styles["body"] = ParagraphStyle(
        "CertBody", parent=styles["panel"], fontSize=10, leading=14
    )
    styles["cell"] = ParagraphStyle(
        "CertCell", parent=styles["panel"], fontSize=10, leading=12
    )
    styles["cell_bold"] = ParagraphStyle(
        "CertCellBold", parent=styles["cell"], fontName="Helvetica-Bold"
    )
    styles["small"] = ParagraphStyle(
        "CertSmall", parent=styles["panel"], fontSize=9, leading=12, textColor=MUTED
    )
    styles["meta"] = ParagraphStyle("CertMeta", parent=styles["small"], spaceBefore=2)
    styles["notice"] = ParagraphStyle(
        "CertNotice", parent=styles["panel"], fontName="Helvetica-Bold"
    )

    story: List[Any] = [
        letterhead(
            meta.get("org_name"),
            "CERTIFIED ELECTION RESULTS",
            [
                Paragraph(esc(election.get("title")), styles["election"]),
                Paragraph(
                    f"Election closed {esc(election.get('closed_display'))} "
                    f"by {esc(election.get('closed_by_display'))} · "
                    f"Generated {esc(meta.get('generated_at'))}",
                    styles["meta"],
                ),
            ],
            meta.get("logo"),
            styles,
            "Certified Election Results",
        ),
        Spacer(1, 8),
        HRFlowable(width="100%", thickness=2, color=INK),
        Spacer(1, 10),
    ]
    # A correction after close is allowed but never silent (W50-9): each one
    # is printed under the close line, before anything that reads as final.
    revisions = election.get("revisions_display") or []
    if revisions:
        story.append(
            panel([Paragraph(esc(rev), styles["notice"]) for rev in revisions])
        )
        story.append(Spacer(1, 14))

    # ── Turnout & quorum ─────────────────────────────────────────────
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
        ["Quorum", _quorum_cell(results)],
    ]
    story.append(
        section(
            "Turnout &amp; Quorum",
            [key_value_table(turnout_rows)],
            styles,
        )
    )

    # ── Results per contest ──────────────────────────────────────────
    # One table per position and per ballot item, each graded on its own
    # (W50-7). ``overall_results`` holds only candidates no contest claims
    # (a legacy election whose candidates have no position); it is printed
    # as its own table rather than dropped, and never pools contests.
    contests = list(results.get("results_by_position", []))
    if results.get("overall_results"):
        contests.append(
            {
                "position": None if not contests else "Other candidates",
                "candidates": results["overall_results"],
                "is_tie": any(c.get("is_tied") for c in results["overall_results"]),
            }
        )
    for position in contests:
        # A ballot item's position is its id; its title is what the reader knows.
        contest = position.get("label") or position.get("position")
        heading = f"Results — {esc(contest)}" if contest else "Results"
        rows: List[List[str | Paragraph]] = [["Candidate", "Votes", "%", "Outcome"]]
        winners: List[int] = []
        for cand in position.get("candidates", []):
            if cand.get("is_winner"):
                outcome = "WINNER"
                winners.append(len(rows))
            elif cand.get("is_tied"):
                outcome = "TIED"
            else:
                outcome = ""
            rows.append(
                [
                    Paragraph(
                        esc(cand.get("candidate_name")),
                        styles["cell_bold" if cand.get("is_winner") else "cell"],
                    ),
                    str(cand.get("vote_count", 0)),
                    f"{cand.get('percentage', 0)}%",
                    outcome,
                ]
            )
        body: List[Any] = [ruled_table(rows, [0.52, 0.14, 0.14, 0.2], winners)]
        if position.get("is_tie"):
            policy = data.get("election", {}).get("tie_policy") or "co_winners"
            tie_heading = "TIE" if policy == "co_winners" else "UNRESOLVED TIE"
            body += [
                Spacer(1, 6),
                panel(
                    [
                        Paragraph(
                            f"{tie_heading} for {esc(contest or 'this election')} — "
                            f"{_TIE_POLICY_LABELS.get(policy, policy)}.",
                            styles["notice"],
                        )
                    ]
                ),
            ]
        story.append(section(heading, body, styles))

    # ── Paper-ballot batches ─────────────────────────────────────────
    batches = data.get("batches", [])
    if batches:
        rows = [["Status", "Ballots", "Recorded by", "Attested by"]]
        for batch in batches:
            rows.append(
                [
                    Paragraph(
                        _BATCH_STATUS_LABELS.get(
                            batch.get("status"), esc(batch.get("status"))
                        ),
                        styles["cell"],
                    ),
                    str(batch.get("total_ballots", 0)),
                    Paragraph(
                        esc(batch.get("recorded_by_name") or "unknown"),
                        styles["cell"],
                    ),
                    Paragraph(
                        esc(", ".join(batch.get("attester_names", []) or ["—"])),
                        styles["cell"],
                    ),
                ]
            )
        story.append(
            section(
                "Paper-Ballot Batches",
                [ruled_table(rows, [0.34, 0.12, 0.27, 0.27], [])],
                styles,
            )
        )

    # ── Integrity verification ───────────────────────────────────────
    status = integrity.get("integrity_status") or integrity.get("error") or "—"
    checked = integrity.get("total_votes", integrity.get("total", 0))
    # The chain holds test ballots and pending paper batches beside counted
    # votes; "13 votes checked" over a tally of 11 read as a discrepancy
    # unless the extra rows are named (W50-65).
    extras = [
        f"{integrity[key]} {label}"
        for key, label in (
            ("pending_paper_votes", "pending paper"),
            ("test_votes", "test"),
        )
        if integrity.get(key)
    ]
    breakdown = ""
    if extras:
        breakdown = f": {integrity.get('counted_votes', 0)} counted, " + ", ".join(
            extras
        )
    integrity_body: List[Any] = [
        Paragraph(
            f"Cryptographic vote-signature and chain verification: "
            f"<b>{esc(status)}</b> "
            f"({checked} votes checked{breakdown}).",
            styles["body"],
        )
    ]
    # A sanctioned void stays in the chain and is verified with it (W50-31);
    # the certificate names each one rather than letting it read as either
    # tampering or nothing at all.
    for void in integrity.get("voids") or []:
        officer = void.get("voided_by_name") or "an officer"
        reason = void.get("reason") or "no reason recorded"
        integrity_body.append(
            Paragraph(
                f"{int(void.get('count') or 0)} vote(s) voided by "
                f"{esc(officer)}: {esc(reason)}. Voided votes are kept, "
                "verified with the chain and excluded from the results.",
                styles["meta"],
            )
        )
    if election.get("anonymous_voting"):
        proxy_votes = int(election.get("proxy_votes") or 0)
        text = (
            "This was an anonymous election: the per-election anonymity "
            "salt was destroyed at close, making voter de-anonymization "
            "impossible"
        )
        if proxy_votes:
            # Proxy ballots are allowed on anonymous elections only with the
            # delegating member's acknowledgement that they are attributable
            # (W50-2), so the statement names the exception.
            text += (
                f", except for {proxy_votes} proxy vote(s), which are recorded "
                "against the member they were cast for, as each delegating "
                "member acknowledged when the proxy was authorized"
            )
        integrity_body.append(Paragraph(text + ".", styles["meta"]))
    story.append(
        section(
            "Integrity Verification",
            [padded(integrity_body)],
            styles,
        )
    )

    # ── Certification signatures ─────────────────────────────────────
    # Drawn rules rather than typed underscores: an underscore run's length
    # depends on the font and never meets the column edge.
    # Two signature columns with a gutter between them, so each officer
    # signs on a line of their own rather than on one rule across the page.
    gutter = 0.4 * inch
    line_width = (CONTENT_WIDTH - gutter) / 2
    signatures = Table(
        [
            ["", "", ""],
            ["President", "", "Chief"],
            ["", "", ""],
            ["Secretary", "", "Date"],
        ],
        colWidths=[line_width, gutter, line_width],
        rowHeights=[34, None, 34, None],
        style=TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (-1, -1), MUTED),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("LINEABOVE", (0, 1), (0, 1), 1, INK),
                ("LINEABOVE", (2, 1), (2, 1), 1, INK),
                ("LINEABOVE", (0, 3), (0, 3), 1, INK),
                ("LINEABOVE", (2, 3), (2, 3), 1, INK),
            ]
        ),
    )
    story.append(
        section(
            "Certification",
            [
                padded(
                    [
                        Paragraph(
                            "We certify that the results above are true and "
                            "correct and were produced in accordance with the "
                            "department's bylaws.",
                            styles["body"],
                        )
                    ]
                ),
                Spacer(1, 10),
                signatures,
            ],
            styles,
        )
    )

    footer = page_footer(f"Certified Election Results · {election.get('title') or ''}")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    buf.seek(0)
    return buf
