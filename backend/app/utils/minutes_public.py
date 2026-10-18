"""What a public copy of a set of minutes may show.

``narrow_for_public`` takes the printed copy's data (``build_print_data``) and
returns a new dict built by **naming** each field that may go out. It never
copies the input and deletes from it: a field someone adds to the printed copy
later stays private until it is added here, on purpose.

Stricter than the PDF, deliberately. The printed copy is handed to members and
carries their names; a page anyone can open does not:

* **Attendance** is counts, plus the officers who were present with their
  titles, never the roll.
* **Motions** keep the wording, who moved and seconded, the totals and the
  result. Individual votes and the discussion notes stay out.
* **Closed sessions** show why, on what authority, and when. Who was in the room
  and the summary stay out.
* **Elections** show turnout and each contest's candidates and counts, as the
  PDF does, and no voter-level detail.
* **Attachments** are not listed and not linked; the files stay private.
* **Library links** an agenda item carried are dropped.

The result is stored as a snapshot when the minutes are published and served
as-is, so what the public sees cannot change under it when the minutes are
edited or reopened.
"""

from typing import Any, Dict, List, Optional

from app.utils.rich_text import (
    FORMAT_HTML,
    normalize_format,
    sanitize_html,
    section_is_printed,
)

MAX_TEXT = 20_000
MAX_SHORT = 500
MAX_ITEMS = 500


def _text(value: Any, limit: int = MAX_SHORT) -> Optional[str]:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned[:limit] if cleaned else None


def _list(value: Any) -> List[Any]:
    return list(value)[:MAX_ITEMS] if isinstance(value, (list, tuple)) else []


def _dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _attendance(attendees: List[Any]) -> Dict[str, Any]:
    counts = {"present": 0, "excused": 0, "absent": 0, "guests": 0}
    officers: List[Dict[str, str]] = []
    for entry in attendees:
        entry = _dict(entry)
        status = str(entry.get("status") or "").lower()
        if status == "guest":
            counts["guests"] += 1
            continue
        if status == "excused":
            counts["excused"] += 1
        elif status in ("absent", "no_show"):
            counts["absent"] += 1
        else:
            counts["present"] += 1
            name, role = _text(entry.get("name")), _text(entry.get("role"), 100)
            # An officer is a member with a title who was in the room.
            if name and role:
                officers.append({"name": name, "role": role})
    return {**counts, "officers_present": officers}


def _section(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not section_is_printed(entry):
        return None
    title = _text(entry.get("title"), 200)
    if not title:
        return None
    is_html = normalize_format(entry.get("format")) == FORMAT_HTML
    raw = entry.get("content")
    content = ""
    if isinstance(raw, str):
        # Cleaned again on the way out: the stored value was cleaned on write,
        # and a public page is the last place to rely on that.
        content = sanitize_html(raw) if is_html else raw.strip()
    section: Dict[str, Any] = {
        "title": title,
        "content": content[:MAX_TEXT],
        "format": "html" if is_html else "text",
    }
    presenter = _text(entry.get("presenter"), 200)
    if presenter:
        section["presenter"] = presenter
    if entry.get("not_taken_up"):
        section["not_taken_up"] = True
    return section


def _motion(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "number": entry.get("number") if isinstance(entry.get("number"), int) else None,
        "text": _text(entry.get("text"), MAX_TEXT),
        "status": _text(entry.get("status"), 50),
        "moved_by": _text(entry.get("moved_by"), 200),
        "seconded_by": _text(entry.get("seconded_by"), 200),
        "vote_display": _text(entry.get("vote_display"), 300),
    }


def _action_item(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "description": _text(entry.get("description"), 2000),
        "assignee": _text(entry.get("assignee"), 200),
        "due": _text(entry.get("due"), 50),
        "status": _text(entry.get("status"), 50),
    }


def _closed_session(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "reason": _text(entry.get("reason"), 1000),
        "legal_basis": _text(entry.get("legal_basis"), 1000),
        "started": _text(entry.get("started"), 50),
        "ended": _text(entry.get("ended"), 50),
    }


def _candidates(rows: Any) -> List[Dict[str, Any]]:
    return [
        {
            "name": _text(_dict(c).get("candidate_name"), 200),
            "votes": _number(_dict(c).get("vote_count")),
            "percentage": _number(_dict(c).get("percentage")),
            "outcome": (
                "winner"
                if _dict(c).get("is_winner")
                else "tied" if _dict(c).get("is_tied") else None
            ),
        }
        for c in _list(rows)
    ]


def _election(entry: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = _dict(entry.get("snapshot"))
    contests = []
    for contest in _list(snapshot.get("results_by_position")):
        contest = _dict(contest)
        contests.append(
            {
                "label": _text(contest.get("label") or contest.get("position"), 200),
                "candidates": _candidates(contest.get("candidates")),
            }
        )
    overall = _candidates(snapshot.get("overall_results"))
    if overall:
        contests.append(
            {
                "label": "Other candidates" if contests else None,
                "candidates": overall,
            }
        )
    return {
        "title": _text(entry.get("title"), 300),
        "closed": _text(entry.get("closed_display"), 100),
        "addendum": bool(entry.get("addendum")),
        "eligible_voters": _number(snapshot.get("total_eligible_voters")),
        "ballots_cast": _number(snapshot.get("total_votes")),
        "turnout_percentage": _number(snapshot.get("voter_turnout_percentage")),
        "contests": contests,
    }


def _approval(approval: Any) -> Optional[Dict[str, Any]]:
    approval = _dict(approval)
    if not approval:
        return None
    return {
        "adopted_on": _text(approval.get("adopted_on_display"), 100),
        "as_amended": bool(approval.get("as_amended")),
        "version": (
            approval.get("version")
            if isinstance(approval.get("version"), int)
            else None
        ),
        "signatures": [
            {
                "title": _text(_dict(s).get("title"), 100),
                "name": _text(_dict(s).get("name"), 200),
                "signed_at": _text(_dict(s).get("signed_at_display"), 100),
            }
            for s in _list(approval.get("signatures"))
        ],
    }


def narrow_for_public(data: Dict[str, Any]) -> Dict[str, Any]:
    """The public view of a printed copy's data. See the module docstring."""
    sections = [
        s
        for s in (_section(_dict(e)) for e in _list(data.get("sections")))
        if s is not None
    ]
    return {
        "title": _text(data.get("title"), 255),
        "meeting_type_display": _text(data.get("meeting_type_display"), 100),
        "meeting_date_display": _text(data.get("meeting_date_display"), 100),
        "location": _text(data.get("location"), 255),
        "called_by": _text(data.get("called_by"), 255),
        "called_to_order": _text(data.get("called_to_order"), 50),
        "adjourned": _text(data.get("adjourned"), 50),
        "quorum_display": _text(data.get("quorum_display"), 200),
        "attendance": _attendance(_list(data.get("attendees"))),
        "sections": sections,
        "motions": [_motion(_dict(m)) for m in _list(data.get("motions"))],
        "action_items": [
            _action_item(_dict(a)) for a in _list(data.get("action_items"))
        ],
        "closed_sessions": [
            _closed_session(_dict(c)) for c in _list(data.get("closed_sessions"))
        ],
        "election_results": [
            _election(_dict(e)) for e in _list(data.get("election_results"))
        ],
        "approval": _approval(data.get("approval")),
    }
