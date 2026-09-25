"""Drop the seeded "Please do not reply" line from stored email footers.

Revision ID: 3f3b315165ed
Revises: 1ae1ffbc445e
Create Date: 2026-09-25 16:23:09.367478

Replies to automated mail now go to the department's own address
(``EmailService.default_reply_to``), and the seeded "Internal — members"
footer stopped telling members not to reply. That change reaches only
departments that never saved their footer library: the library is read from
``organizations.settings["email_footers"]`` when present, and it is present
for every department that opened the footer editor and pressed Save, which
writes the whole library, seeded lines included. Those departments keep
telling members not to do the thing most likely to get them an answer.

**What this rewrites.** Any footer line whose text, trimmed, is exactly the
line the library used to seed — ``Please do not reply to this email.`` — is
removed, from whichever footer carries it. Every other line is left as it
is, including any wording of the same idea a department typed itself: that
is a choice somebody made, and this cannot tell it from a mistake. Nothing
outside ``email_footers`` is written, and a row is only written when one of
its footers actually changed.

**Frozen line.** The text is written out here rather than read from
``app.services.email_footers``. A migration has to transform rows the way it
did the day it ran; the service no longer contains the line at all.

**Downgrade** puts the line back only where it can tell the footer is the
seeded one, untouched: the ``internal`` footer whose lines are exactly the
seeded first line on its own. That is every footer the upgrade stripped from
an unedited library. A library a department had edited around the line
before the upgrade does not get it back, because nothing records where it
stood. The only effect of that is one sentence missing from a footer.
"""

import copy
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3f3b315165ed"
down_revision: Union[str, Sequence[str], None] = "1ae1ffbc445e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FOOTERS_KEY = "email_footers"
NO_REPLY_LINE = "Please do not reply to this email."
INTERNAL_KEY = "internal"
INTERNAL_FIRST_LINE = "This is an automated message from {{organization_name}}."


def _organizations_table() -> sa.Table:
    return sa.table(
        "organizations",
        sa.column("id", sa.String),
        sa.column("settings", sa.JSON),
    )


def _footers(settings: Any) -> list:
    """The stored footer list, or an empty list for anything unreadable.

    The renderer tolerates a malformed blob by falling back to the seeded
    library, so this must not raise on one either.
    """
    if not isinstance(settings, dict):
        return []
    library = settings.get(FOOTERS_KEY)
    if not isinstance(library, dict):
        return []
    footers = library.get("footers")
    return footers if isinstance(footers, list) else []


def _strip_no_reply(footer: Any) -> bool:
    if not isinstance(footer, dict) or not isinstance(footer.get("lines"), list):
        return False
    kept = [
        line
        for line in footer["lines"]
        if not (isinstance(line, str) and line.strip() == NO_REPLY_LINE)
    ]
    if len(kept) == len(footer["lines"]):
        return False
    footer["lines"] = kept
    return True


def _restore_no_reply(footer: Any) -> bool:
    if not isinstance(footer, dict) or footer.get("key") != INTERNAL_KEY:
        return False
    if footer.get("lines") != [INTERNAL_FIRST_LINE]:
        return False
    footer["lines"] = [INTERNAL_FIRST_LINE, NO_REPLY_LINE]
    return True


def _rewrite(change) -> None:
    connection = op.get_bind()
    table = _organizations_table()
    rows = connection.execute(
        sa.select(table.c.id, table.c.settings).where(table.c.settings.isnot(None))
    ).all()
    for row_id, settings in rows:
        if not _footers(settings):
            continue
        # The footers are nested dicts; a shallow copy would edit the fetched
        # value in place (CLAUDE.md pitfall 12).
        updated = copy.deepcopy(settings)
        changed = [change(footer) for footer in _footers(updated)]
        if any(changed):
            connection.execute(
                table.update().where(table.c.id == row_id).values(settings=updated)
            )


def upgrade() -> None:
    _rewrite(_strip_no_reply)


def downgrade() -> None:
    _rewrite(_restore_no_reply)
