"""Resolve the polymorphic ``shifts.apparatus_id`` reference.

``shifts.apparatus_id`` is a bare ``String(36)`` with no foreign key, carrying
whatever id ``GET /scheduling/apparatus-options`` served the shift form. That
endpoint has a documented priority — **full ``Apparatus`` module records >
``BasicApparatus`` records > hardcoded type defaults** — so the column is
polymorphic *by design*: the same column holds an ``apparatus.id`` for a
department running the Apparatus module and a ``basic_apparatus.id`` for one
that only completed onboarding.

Nothing enforced that, and the two consumers each assumed the *other* source:

* ``scheduling_service.create_shift`` / ``update_shift`` validated the id
  against ``BasicApparatus`` only, so a department on the full Apparatus module
  could not assign an apparatus to a shift at all — the options endpoint served
  an ``apparatus.id`` and the validator rejected it as "Apparatus not found".
* ``equipment_check_service.submit_check`` copied the id straight into
  ``shift_equipment_checks.apparatus_id``, which *is* a real FK to
  ``apparatus.id`` — so for a department on ``BasicApparatus`` every submission
  failed the constraint with a 500.

Those are mirror images of one defect: an id was passed across a boundary
without being told which table it came from. This module is that boundary. Use
:func:`resolve_apparatus_ref` wherever a ``shifts.apparatus_id`` value is about
to be treated as belonging to a specific table.

Both tables use ``String(36)`` UUID primary keys, so an id belongs to at most
one of them and classification is unambiguous — no unit-number matching, no
link column, and no migration. The full ``Apparatus`` table is checked first,
mirroring the options endpoint's own priority, so the answer here matches the
answer the shift form was given.
"""

from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.apparatus import Apparatus
from app.models.training import BasicApparatus


@dataclass(frozen=True)
class ApparatusRef:
    """What a ``shifts.apparatus_id`` value turned out to point at.

    ``full`` and ``basic`` are mutually exclusive; both are ``None`` when the id
    named nothing in the caller's organization (an id from another tenant, a
    deleted row, or one of the hardcoded ``source="default"`` options, which
    carry no id at all).
    """

    full: Optional[Apparatus] = None
    basic: Optional[BasicApparatus] = None

    @property
    def exists(self) -> bool:
        """True when the id resolved to a row in either table."""
        return self.full is not None or self.basic is not None

    @property
    def full_id(self) -> Optional[str]:
        """The id to store in a column whose FK targets ``apparatus.id``.

        ``None`` for a ``BasicApparatus`` shift, which is correct rather than
        lossy: that department has no full apparatus record for the vehicle, and
        the FK columns that consume this are all nullable with ``SET NULL``.
        """
        return str(self.full.id) if self.full is not None else None

    @property
    def unit_label(self) -> str:
        """A human-readable identifier for notifications and reports."""
        if self.full is not None:
            return self.full.unit_number or ""
        if self.basic is not None:
            return self.basic.unit_number or self.basic.name or ""
        return ""

    @property
    def type_slug(self) -> Optional[str]:
        """Lowercased apparatus-type name, for type-level template matching.

        The two tables spell this differently — ``BasicApparatus`` stores the
        type inline as a string, while ``Apparatus`` normalizes it into the
        ``apparatus_types`` table — so callers get one shape from here instead
        of branching.
        """
        if self.full is not None:
            apparatus_type = getattr(self.full, "apparatus_type", None)
            name = getattr(apparatus_type, "name", None)
            return name.lower() if name else None
        if self.basic is not None:
            return (self.basic.apparatus_type or "").lower() or None
        return None


async def resolve_apparatus_ref(
    db: AsyncSession,
    apparatus_id: Any,
    organization_id: Any,
) -> ApparatusRef:
    """Classify ``apparatus_id`` against both apparatus tables, org-scoped.

    Fails **closed** in the same sense as ``org_scoping.is_in_org``: a falsy id
    or organization, an id from another tenant, or an id in neither table all
    return an empty :class:`ApparatusRef` rather than raising. Callers decide
    whether "resolved to nothing" is a hard error (shift create/update, where an
    unknown id must be rejected) or an acceptable absence (an equipment check on
    a BasicApparatus shift, which simply stores no full-apparatus reference).

    The full ``Apparatus`` row is loaded with its ``apparatus_type`` eagerly, so
    :attr:`ApparatusRef.type_slug` cannot trigger a lazy load in async context —
    the failure mode that made creating an apparatus maintenance record return a
    500 after the row had already been written (2026-08-07).
    """
    if not apparatus_id or not organization_id:
        return ApparatusRef()

    apparatus_id = str(apparatus_id)
    organization_id = str(organization_id)

    full_result = await db.execute(
        select(Apparatus)
        .options(selectinload(Apparatus.apparatus_type))
        .where(
            Apparatus.id == apparatus_id,
            Apparatus.organization_id == organization_id,
        )
    )
    full = full_result.scalars().first()
    if full is not None:
        return ApparatusRef(full=full)

    basic_result = await db.execute(
        select(BasicApparatus).where(
            BasicApparatus.id == apparatus_id,
            BasicApparatus.organization_id == organization_id,
        )
    )
    basic = basic_result.scalars().first()
    if basic is not None:
        return ApparatusRef(basic=basic)

    return ApparatusRef()


@dataclass(frozen=True)
class ApparatusDisplay:
    """The fields a shift list needs about its apparatus, from either table.

    ``Apparatus`` and ``BasicApparatus`` overlap but do not match: the full
    record normalizes its type into ``apparatus_types`` and has no riding
    positions at all, while ``BasicApparatus`` stores both inline. This is the
    shared shape, so shift enrichment does not have to branch on which
    inventory the department uses.
    """

    id: str
    name: Optional[str] = None
    unit_number: Optional[str] = None
    apparatus_type: Optional[str] = None
    min_staffing: Optional[int] = None
    positions: Optional[Any] = None

    @property
    def label(self) -> str:
        return self.unit_number or self.name or ""


async def resolve_apparatus_display_map(
    db: AsyncSession,
    apparatus_ids: Any,
    organization_id: Any,
) -> dict[str, ApparatusDisplay]:
    """Batch-load display fields for a set of ``shifts.apparatus_id`` values.

    Looks in both tables so a list of shifts renders correctly whichever
    inventory the department uses. Ids that resolve to nothing are absent from
    the result, so callers should read it with a default.

    At most two queries regardless of how many ids are passed, and the second is
    skipped entirely when the first resolved them all — which is the common case
    for a department that uses one inventory consistently.

    ``positions`` is always ``None`` for a full ``Apparatus``: riding positions
    are a ``BasicApparatus`` concept and the full module does not model them.
    Callers already fall back to the shift's own positions, so this reads as
    "not specified" rather than "empty".
    """
    ids = {str(i) for i in (apparatus_ids or []) if i}
    if not ids or not organization_id:
        return {}

    organization_id = str(organization_id)
    found: dict[str, ApparatusDisplay] = {}

    full_result = await db.execute(
        select(Apparatus)
        .options(selectinload(Apparatus.apparatus_type))
        .where(
            Apparatus.id.in_(ids),
            Apparatus.organization_id == organization_id,
        )
    )
    for row in full_result.scalars().all():
        type_name = getattr(row.apparatus_type, "name", None)
        found[str(row.id)] = ApparatusDisplay(
            id=str(row.id),
            name=row.name,
            unit_number=row.unit_number,
            apparatus_type=type_name.lower() if type_name else None,
            min_staffing=row.min_staffing,
        )

    remaining = ids - set(found)
    if remaining:
        basic_result = await db.execute(
            select(BasicApparatus).where(
                BasicApparatus.id.in_(remaining),
                BasicApparatus.organization_id == organization_id,
            )
        )
        for row in basic_result.scalars().all():
            found[str(row.id)] = ApparatusDisplay(
                id=str(row.id),
                name=row.name,
                unit_number=row.unit_number,
                apparatus_type=row.apparatus_type,
                min_staffing=row.min_staffing,
                positions=row.positions,
            )

    return found


async def resolve_apparatus_labels(
    db: AsyncSession,
    apparatus_ids: Any,
    organization_id: Any,
) -> dict[str, str]:
    """Batch counterpart of :attr:`ApparatusRef.unit_label`.

    Thin wrapper over :func:`resolve_apparatus_display_map` for callers that
    only need a display string.
    """
    display_map = await resolve_apparatus_display_map(
        db, apparatus_ids, organization_id
    )
    return {key: value.label for key, value in display_map.items()}


async def apparatus_ref_exists(
    db: AsyncSession,
    apparatus_id: Any,
    organization_id: Any,
) -> bool:
    """True iff ``apparatus_id`` names an in-org row in *either* table.

    The validation counterpart of ``org_scoping.is_in_org`` for this one
    polymorphic column. Use it where a shift's ``apparatus_id`` is being written
    from client input: the id must be real and in-org, but which of the two
    inventories it came from is the department's configuration, not an error.
    """
    ref = await resolve_apparatus_ref(db, apparatus_id, organization_id)
    return ref.exists
