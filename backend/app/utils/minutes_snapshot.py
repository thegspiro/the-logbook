"""The ratifiable content of a set of minutes, and its fingerprint.

Approving minutes stores one of these snapshots with its SHA-256 hash, so a
later reader can prove the record has not changed since it was approved and a
reopened-and-corrected record keeps the version it replaced.

What the snapshot covers is a decision, and the line is "what the body voted
to approve":

* In: the heading, attendance, quorum, content sections, motions, the action
  items *as assigned*, the election results frozen into the minutes, and a
  manifest of the attachments (by hash, not by bytes).
* Out: an action item's progress (status, completion notes) — assignees update
  those on approved minutes by design, so including them would make every
  completed task "tamper" with the record. And a ``signed_copy`` attachment,
  which is scanned and filed *after* approval; it is evidence of the approval,
  not part of what was approved.

Building and verifying must use the same function, or the hash proves nothing.
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

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


def build_snapshot(
    minutes: Any,
    election_results: Iterable[Any],
    attachments: Iterable[Any],
) -> dict[str, Any]:
    """The snapshot dict for *minutes*.

    ``minutes`` must have ``motions`` and ``action_items`` loaded.
    ``election_results`` are ``MinutesElectionResult`` rows and ``attachments``
    ``MinutesAttachment`` rows; a ``signed_copy`` among the latter is skipped.
    """
    sections = sorted(
        minutes.get_sections(), key=lambda s: (s.get("order", 0), s.get("key", ""))
    )
    return {
        "title": minutes.title,
        "meeting_type": _val(minutes.meeting_type),
        "meeting_date": _iso(minutes.meeting_date),
        "location": minutes.location,
        "called_by": minutes.called_by,
        "called_to_order_at": _iso(minutes.called_to_order_at),
        "adjourned_at": _iso(minutes.adjourned_at),
        "attendees": minutes.attendees or [],
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
        "sections": [
            {
                "order": s.get("order", 0),
                "key": s.get("key", ""),
                "title": s.get("title", ""),
                "content": s.get("content", ""),
            }
            for s in sections
        ],
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
