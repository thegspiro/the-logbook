"""The separation-of-duties check shared by every grant that excuses a member.

A leave of absence, a Chief's requirement override and a training waiver each
count a member as meeting requirements they did not meet, so the officer who
records one may never be its member (owner decisions 2026-11-16, ADV2-9, and
2026-11-22/23 for training waivers). There is no exception for a Chief who is
the department's only officer: their own excusal goes through a request that
someone else decides.
"""


def is_own_grant(granted_by: object, member_id: object) -> bool:
    """True when the officer recording a grant is the member it excuses.

    Ids are compared as strings because callers hold a mix of ``str`` ids and
    UUID objects. A missing ``granted_by`` (a system-made grant) is never one's
    own.
    """
    if granted_by is None or member_id is None:
        return False
    return str(granted_by) == str(member_id)
