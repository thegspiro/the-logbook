"""The ratifiable content of a set of minutes, and its fingerprint.

Approving minutes stores one of these snapshots with its SHA-256 hash, so a
later reader can prove the record has not changed since it was approved and a
reopened-and-corrected record keeps the version it replaced.

What the snapshot covers is a decision, and the line is "what the body voted
to approve":

* In: the heading, attendance, quorum, content sections, motions (with the
  ballot that decided them), closed sessions, the action items *as assigned*,
  the election results frozen into the minutes, a manifest of the attachments
  (by hash, not by bytes), and how the body adopted them.
* Out: an action item's progress (status, completion notes) — assignees update
  those on approved minutes by design, so including them would make every
  completed task "tamper" with the record. A ``signed_copy`` attachment, which
  is scanned and filed *after* approval. And an election result filed once the
  minutes were submitted (an addendum): the election closed after the minutes
  were written, so it cannot be part of what they said.

Building and verifying must use the same function, or the hash proves nothing.
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from app.utils.rich_text import FORMAT_HTML, normalize_format

# Filed after approval and so outside what approval covers; see the module
# docstring. Shared with the attachment service so the two cannot disagree.
POST_APPROVAL_CATEGORY = "signed_copy"


def _iso(value: Optional[datetime]) -> Optional[str]:
    """UTC ISO-8601 to the second, so a value read back from MySQL (which
    drops fractions) hashes the same as the in-memory one it was saved from."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def _val(value: Any) -> Any:
    return getattr(value, "value", value)


def _section_snapshot(section: dict) -> dict:
    """One section as hashed.

    ``format`` is written only for rich text. Plain-text sections keep the shape
    they were approved with, so a version approved before the editor existed
    still verifies byte for byte.
    """
    entry = {
        "order": section.get("order", 0),
        "key": section.get("key", ""),
        "title": section.get("title", ""),
        "content": section.get("content", ""),
    }
    if normalize_format(section.get("format")) == FORMAT_HTML:
        entry["format"] = FORMAT_HTML
    # Like ``format``, written only when set, so a version sealed before
    # agendas existed verifies byte for byte.
    if section.get("presenter"):
        entry["presenter"] = section["presenter"]
    if section.get("not_taken_up"):
        entry["not_taken_up"] = True
    return entry


def _vote_detail(motion: Any) -> dict[str, Any]:
    """How a motion's vote was taken, only for the parts that were recorded, so
    a snapshot sealed before they existed keeps the hash it was sealed with."""
    detail: dict[str, Any] = {}
    for key in ("threshold", "votes_recused", "roll_call"):
        value = getattr(motion, key, None)
        if value is not None:
            detail[key] = value
    return detail


def build_snapshot(
    minutes: Any,
    election_results: Iterable[Any],
    attachments: Iterable[Any],
    closed_sessions: Iterable[Any] = (),
) -> dict[str, Any]:
    """The snapshot dict for *minutes*.

    ``minutes`` must have ``motions`` and ``action_items`` loaded.
    ``election_results`` are ``MinutesElectionResult`` rows (addenda skipped),
    ``attachments`` ``MinutesAttachment`` rows (a ``signed_copy`` skipped) and
    ``closed_sessions`` ``MinutesClosedSession`` rows.
    """
    sections = sorted(
        minutes.get_sections(), key=lambda s: (s.get("order", 0), s.get("key", ""))
    )
    adoption = {
        "adopted_on": _iso(getattr(minutes, "adopted_on", None)),
        "as_amended": getattr(minutes, "adopted_as_amended", None),
        "adopting_minutes_id": getattr(minutes, "adopting_minutes_id", None),
    }
    # Left out when unset so a snapshot taken before the motion was recorded
    # keeps the hash it was sealed with.
    for field, attribute in (
        ("moved_by", "adoption_moved_by"),
        ("seconded_by", "adoption_seconded_by"),
    ):
        value = getattr(minutes, attribute, None)
        if value:
            adoption[field] = value
    return {
        "title": minutes.title,
        "meeting_type": _val(minutes.meeting_type),
        "meeting_date": _iso(minutes.meeting_date),
        "location": minutes.location,
        "called_by": minutes.called_by,
        "called_to_order_at": _iso(minutes.called_to_order_at),
        "adjourned_at": _iso(minutes.adjourned_at),
        "attendees": minutes.attendees or [],
        "adoption": adoption,
        "quorum_met": minutes.quorum_met,
        "quorum_count": minutes.quorum_count,
        "quorum_type": minutes.quorum_type,
        # A MySQL FLOAT column hands back single precision (66.7 reads as
        # 66.69999694824219), so the value is rounded before it is hashed.
        "quorum_threshold": (
            None
            if minutes.quorum_threshold is None
            else round(float(minutes.quorum_threshold), 4)
        ),
        "sections": [_section_snapshot(s) for s in sections],
        "motions": [
            {
                "order": m.order,
                "motion_text": m.motion_text,
                "moved_by": m.moved_by,
                "seconded_by": m.seconded_by,
                "discussion_notes": m.discussion_notes,
                "status": _val(m.status),
                "votes_for": m.votes_for,
                "votes_against": m.votes_against,
                "votes_abstain": m.votes_abstain,
                "election_id": getattr(m, "election_id", None),
                "ballot_item_id": getattr(m, "ballot_item_id", None),
                **(
                    {"section_key": m.section_key}
                    if getattr(m, "section_key", None)
                    else {}
                ),
                **_vote_detail(m),
            }
            for m in sorted(minutes.motions or [], key=lambda m: (m.order, m.id))
        ],
        "action_items": [
            {
                "description": a.description,
                "assignee_id": a.assignee_id,
                "assignee_name": a.assignee_name,
                "due_date": _iso(a.due_date),
                "priority": _val(a.priority),
            }
            for a in sorted(minutes.action_items or [], key=lambda a: a.id)
        ],
        "election_results": [
            {
                "election_id": r.election_id,
                "election_title": r.election_title,
                "snapshot": r.snapshot,
            }
            for r in sorted(election_results, key=lambda r: r.id)
            if not getattr(r, "is_addendum", False)
        ],
        "closed_sessions": [
            {
                "reason": c.reason,
                "legal_basis": c.legal_basis,
                "started_at": _iso(c.started_at),
                "ended_at": _iso(c.ended_at),
                "motion_id": c.motion_id,
                "participants": c.participants or [],
                "summary": c.summary,
            }
            for c in sorted(closed_sessions, key=lambda c: (c.started_at, c.id))
        ],
        "attachments": [
            {
                "id": a.id,
                "title": a.title,
                "category": a.category,
                "original_name": a.original_name,
                "sha256": a.sha256,
                "size": a.file_size,
            }
            for a in sorted(attachments, key=lambda a: a.id)
            if a.category != POST_APPROVAL_CATEGORY
        ],
    }


def content_hash(snapshot: dict[str, Any]) -> str:
    """SHA-256 over the snapshot's canonical JSON (sorted keys, no padding)."""
    canonical = json.dumps(
        snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
