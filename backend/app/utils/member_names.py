"""How a member is named on everyday screens versus on records of note.

A member may go by a name other than their legal first name — John Terry
Heather is "Terry Heather" to everyone on the shift. Two names therefore exist
and each surface must pick one deliberately:

* ``format_display_name`` — preferred name (falling back to first name) plus
  last name. Shift boards, event rosters, dashboards, notifications, messages
  and every other place that is simply referring to a person.
* ``format_legal_name`` — first plus last name, ignoring the preferred name.
  Reports, exports, training records, certificates, ballots, signatures and
  legal documents: anything that may be handed to a government body or has to
  match an ID card.

``User.display_name`` and ``User.full_name`` wrap these for an ORM row; the
functions exist for queries that select name columns rather than whole rows.
"""

from typing import Optional


def _join(*parts: Optional[str]) -> str:
    return " ".join(p.strip() for p in parts if p and p.strip())


def format_legal_name(first_name: Optional[str], last_name: Optional[str]) -> str:
    return _join(first_name, last_name)


def format_display_name(
    first_name: Optional[str],
    last_name: Optional[str],
    preferred_name: Optional[str] = None,
) -> str:
    given = preferred_name if preferred_name and preferred_name.strip() else first_name
    return _join(given, last_name)
