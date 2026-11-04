"""Medical screening: the view_details grant, and links for unlinked records.

Two steps for the owner decisions of 2026-11-01 on medical screening.

**1. ``medical_screening.view_details`` for every position holding
``medical_screening.view``** (MS-14). From this build ``.view`` reads a record
without its clinical narrative — provider, result summary, structured results,
notes come back null — and the new permission reads them. Before this revision
``.view`` read all of it, so without the grant every position that could open
a member's result this morning would lose it on upgrade. System and
department-created positions alike, as ``c588f525fdbb`` did for the same
reason: the evidence is the ``.view`` grant itself, which is what showed the
position the narrative before, so the addition preserves access rather than
extending it (docs/rules/migrations.md, "Adding a grant is gated on some
positive evidence"). Not written where it is already covered: the grant
itself, ``medical_screening.*`` or ``*``. A position holding only ``.manage``
is not written either: ``.manage`` reads the narrative by rule (its edit form
writes those fields), so a row grant there would be one an administrator could
remove without effect. **What it costs when wrong:** a position the department
meant to see status only keeps reading the narrative until an administrator
removes ``view_details`` on the positions screen — the access it had before
the upgrade. docs/UPGRADING.md says so.

**2. Link each unlinked screening record to a requirement where exactly one
fits.** A record now counts only toward the requirement it is linked to
(owner decision 2026-11-01); before, an unlinked record counted toward every
requirement of its screening type. A record with ``requirement_id`` NULL is
linked to the organization's one active requirement of the same type; with
no active one, to its one requirement of that type, active or not. So a
department with one requirement per type — the common case — sees no change
in anyone's standing. **Ambiguous rows are left unlinked**: a record whose type
matches two or more active requirements (or, with none active, two or more
inactive ones) cannot be attributed without a guess, so it counts toward
nothing after the upgrade and an officer links it from the record's Edit
dialog. A record whose type matches no requirement at all counted toward
nothing before and still does. Records that already name a requirement are
never touched, nor is anything across organizations.

**Downgrade.** Step 1 is reversed exactly: ``view_details`` did not exist
before this revision, so it is removed from every position. Step 2 is left in
place on purpose: under the previous build's rule a record's link is harmless
— it was graded by type whatever it named, and the link only chose which
frequency an undated record fell due by, which for a sole requirement of the
type is the same one the grader used — and which links this revision wrote is
not recorded, so removing them would also remove links officers made.

Safe to run twice: each step writes only what is missing.

Revision ID: d6906e3dd76c
Revises: d75ecbc15bae
Create Date: 2026-11-04 05:03:39.081970
"""

import json
from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d6906e3dd76c"
down_revision: Union[str, None] = "d75ecbc15bae"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen rather than imported from the registry (CLAUDE.md pitfall #20).
_PERMISSION = "medical_screening.view_details"
_EVIDENCE = "medical_screening.view"
_ALREADY_COVERED = {"*", "medical_screening.*", _PERMISSION}


def _load_permissions(raw) -> list:
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def grant(permissions: Sequence[str]) -> Optional[list]:
    """The row with ``view_details`` appended, or None to leave it."""
    held = set(permissions)
    if _EVIDENCE not in held or held & _ALREADY_COVERED:
        return None
    return list(permissions) + [_PERMISSION]


def revoke(permissions: Sequence[str]) -> Optional[list]:
    """The row without ``view_details``, or None when it does not hold it."""
    if _PERMISSION not in permissions:
        return None
    return [p for p in permissions if p != _PERMISSION]


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _rewrite_positions(transform) -> None:
    bind = op.get_bind()
    if "positions" not in _tables():
        return
    for row in bind.execute(sa.text("SELECT id, permissions FROM positions")):
        updated = transform(_load_permissions(row.permissions))
        if updated is None:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(updated), "id": row.id},
        )


def _is_active(value) -> bool:
    # A boolean column reads back as bool, int or (SQLite) a string.
    return str(value).strip().lower() in {"1", "true"}


def choose_requirement(candidates: Sequence[tuple]) -> Optional[str]:
    """The one requirement an unlinked record belongs to, or None if ambiguous.

    ``candidates`` are ``(id, is_active)`` for the record's organization and
    screening type. The single active one; with none active, the single one.
    """
    active = [rid for rid, is_active in candidates if _is_active(is_active)]
    if active:
        return active[0] if len(active) == 1 else None
    return candidates[0][0] if len(candidates) == 1 else None


def _link_unlinked_records() -> None:
    bind = op.get_bind()
    if not {"screening_records", "screening_requirements"} <= _tables():
        return
    by_type: dict = {}
    for req in bind.execute(
        sa.text(
            "SELECT id, organization_id, screening_type, is_active "
            "FROM screening_requirements"
        )
    ):
        key = (req.organization_id, str(req.screening_type).lower())
        by_type.setdefault(key, []).append((req.id, req.is_active))
    chosen = {key: choose_requirement(rows) for key, rows in by_type.items()}
    for (organization_id, screening_type), requirement_id in chosen.items():
        if requirement_id is None:
            continue
        bind.execute(
            sa.text(
                "UPDATE screening_records SET requirement_id = :requirement_id "
                "WHERE requirement_id IS NULL AND organization_id = :org "
                "AND LOWER(screening_type) = :screening_type"
            ),
            {
                "requirement_id": requirement_id,
                "org": organization_id,
                "screening_type": screening_type,
            },
        )


def upgrade() -> None:
    _rewrite_positions(grant)
    _link_unlinked_records()


def downgrade() -> None:
    # Links are kept; see the module docstring.
    _rewrite_positions(revoke)
