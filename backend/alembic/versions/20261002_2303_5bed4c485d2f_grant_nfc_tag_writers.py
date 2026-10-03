"""Grant the NFC tag writers on the seeded positions already stored.

The owner's decision of 2026-10-02 on who writes which NFC tag:

* **Apparatus tags** (``apparatus.manage_nfc_tags``, new) — department
  leadership and the Apparatus Officer.
* **Room tags** (``locations.manage_nfc_tags``, new) — department leadership
  and the Facilities Manager.
* **Member ID cards** (``members.manage_id_cards``, existing) — leadership and
  the Membership Coordinator already hold it; the Assistant Membership
  Coordinator is added. Nobody loses it: the owner kept the Captain, Deputy
  Chief and every other current holder.

Leadership is the President, Vice President, Chief, Deputy Chief and Assistant
Chief. The registry change in ``app/core/permissions.py`` reaches only
departments onboarded from now on; ``DEFAULT_POSITIONS`` is copied into
``positions`` at onboarding, so every installation that has already onboarded
keeps rows without these grants until this writes them (CLAUDE.md pitfall #23).
The three chief positions mirror their ranks, whose runtime defaults pick the
new grants up on their own — the stored rows are the half that needs writing.

**Direction: additions, so each is gated on evidence rather than written to
every row** (``docs/rules/migrations.md``). ``is_system = True`` separates the
seeded positions from ones a department created and nothing more, because
``RoleService.update_role`` lets an administrator edit a system position in
place. A row is written only when it is the named system position, is not
empty (a position somebody stripped), and does not already cover the grant by
any spelling — the grant itself, its module wildcard, or ``*``. In addition:

* The two tag grants are new in this build, so no department can have granted
  or removed them: their absence is the signal no build could have produced
  otherwise, and the row is written.
* ``members.manage_id_cards`` predates this revision. It is written to the
  Assistant Membership Coordinator only while the row still holds
  ``prospective_members.manage`` — the applicant pipeline that makes issuing a
  new member's card part of the job. A department that moved the pipeline
  elsewhere is left as it chose.

Deliberately not a comparison against the row's whole stored list: that
snapshot is pinned to one build and silently skips rows written by any other
(``b4d1c8e37f52`` → ``c7a4e91d3b68``).

**What it costs when wrong.** The tag grants decide only which officers the app
offers the tag writer to — writing a tag never reaches the server, and the tag
carries no secret — so an unwanted grant discloses nothing; an administrator
removes it on the positions screen. The ID-card grant is weightier: it lets the
holder issue and revoke attendance credentials and open other members' digital
ID cards. Before this revision no build seeded it on the assistant coordinator,
so a row without it is the seeded shape rather than a department's refusal;
the one case overridden is a department that granted it and then took it away
again.

Idempotent: a row that already covers a grant is skipped for that grant.

Guarded on the table existing, defensively: ``positions`` is built by the
migration chain (the initial ``roles`` table, renamed by 20260805_0008), so the
guard is not load-bearing.

Revision ID: 5bed4c485d2f
Revises: f73b449bdb8b
Create Date: 2026-10-02 23:03:00.000000
"""

import json
from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5bed4c485d2f"
down_revision: Union[str, None] = "f73b449bdb8b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_APPARATUS_TAGS = "apparatus.manage_nfc_tags"
_ROOM_TAGS = "locations.manage_nfc_tags"
_ID_CARDS = "members.manage_id_cards"

# Slug -> the grants this revision adds to it. Frozen rather than derived from
# the registry (CLAUDE.md pitfall #20): the migration must keep writing what it
# wrote the day it ran. ``tests/test_storefront_grant_backfill.py`` reads this
# to subtract later grants from its own frozen snapshot.
_GRANTS: dict[str, tuple[str, ...]] = {
    "president": (_APPARATUS_TAGS, _ROOM_TAGS),
    "vice_president": (_APPARATUS_TAGS, _ROOM_TAGS),
    "fire_chief": (_APPARATUS_TAGS, _ROOM_TAGS),
    "deputy_chief": (_APPARATUS_TAGS, _ROOM_TAGS),
    "assistant_chief": (_APPARATUS_TAGS, _ROOM_TAGS),
    "apparatus_officer": (_APPARATUS_TAGS,),
    "facilities_manager": (_ROOM_TAGS,),
    "assistant_membership_coordinator": (_ID_CARDS,),
}
_SLUGS = tuple(_GRANTS)

# A grant that predates this revision is written only while the row still
# carries the duty the grant serves.
_REQUIRES: dict[str, str] = {
    _ID_CARDS: "prospective_members.manage",
}


def _covers(held: set, permission: str) -> bool:
    module = permission.partition(".")[0]
    return bool(held & {permission, f"{module}.*", "*"})


def _load_permissions(raw) -> list:
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def grant(slug: str, permissions: Sequence[str]) -> Optional[list]:
    """The row with this revision's grants appended, or None to leave it."""
    original = list(permissions)
    held = set(original)
    if not held:
        return None
    added = [
        permission
        for permission in _GRANTS.get(slug, ())
        if not _covers(held, permission)
        and (_REQUIRES.get(permission) is None or _REQUIRES[permission] in held)
    ]
    return original + added if added else None


def revoke(slug: str, permissions: Sequence[str]) -> Optional[list]:
    """The row without this revision's grants, or None when it holds none."""
    removing = set(_GRANTS.get(slug, ()))
    if not removing & set(permissions):
        return None
    return [p for p in permissions if p not in removing]


def _rewrite(transform) -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return
    for slug in _SLUGS:
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = :is_system"
            ),
            {"slug": slug, "is_system": True},
        ).fetchall()
        for row in rows:
            updated = transform(slug, _load_permissions(row.permissions))
            if updated is None:
                continue
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(updated), "id": row.id},
            )


def upgrade() -> None:
    _rewrite(grant)


def downgrade() -> None:
    # Returns the named positions to the grants they had before this revision.
    # It cannot tell a grant this wrote from one an administrator added
    # afterwards, so it removes either — including an ID-card grant a
    # department had given its assistant coordinator by hand before this ran;
    # the two tag grants did not exist before this build, so for them the
    # downgrade is exact. Re-add on the positions screen anything that should
    # outlive a downgrade.
    _rewrite(revoke)
