"""
Multi-tenant org-scoping helpers.

The dominant class of finding in the 2026-07 module audit (see
``docs/module-audit/CROSS-CUTTING.md``, XC-1) is create/update paths that
store a client-supplied foreign-key id (``user_id``, ``category_id``,
``apparatus_id``, ``form_id``, …) without verifying the referenced row belongs
to the caller's organization. Even when the write itself is org-stamped, an
unvalidated FK persists a dangling/mis-attributed reference — and when the FK
is later eager-loaded, it leaks the other org's data back in the response.

These helpers exist so every create/update path validates client-supplied FKs
through **one** implementation that fails **closed**, instead of the ad-hoc
per-service checkers that were added piecemeal after the audit. Prefer
``assert_in_org`` (raises ``ValueError`` → 400) at the top of a service
create/update method; use ``is_in_org`` when you need the boolean directly.
"""

from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def is_in_org(
    db: AsyncSession, model: Any, entity_id: Any, organization_id: Any
) -> bool:
    """Return True iff a row of ``model`` with ``entity_id`` exists in the org.

    Fails **closed**: a falsy ``entity_id`` or ``organization_id``, or a row
    that does not exist / belongs to another org, all return ``False``. The
    caller decides whether that is a hard error (create/update FK) or an
    allowed "not set" (optional FK — pass through only when the id is None).

    ``model`` must expose ``id`` and ``organization_id`` columns. Ids are
    compared as strings to match the ``String(36)`` UUID primary keys used
    across the models.
    """
    if not entity_id or not organization_id:
        return False
    result = await db.execute(
        select(model.id).where(
            model.id == str(entity_id),
            model.organization_id == str(organization_id),
        )
    )
    return result.scalar_one_or_none() is not None


async def assert_in_org(
    db: AsyncSession,
    model: Any,
    entity_id: Any,
    organization_id: Any,
    *,
    allow_none: bool = False,
    label: str | None = None,
) -> None:
    """Raise ``ValueError`` unless ``entity_id`` names a row in the org.

    Intended for the top of service create/update methods that accept
    client-supplied foreign-key ids. The raised ``ValueError`` is passed
    through ``safe_error_detail`` by the endpoint layer, becoming a 400 that
    does not confirm whether the id exists in another org (no cross-tenant
    existence oracle).

    Args:
        allow_none: when True, a falsy ``entity_id`` is accepted (the FK is
            optional and simply not being set). When False (default), a
            missing id is itself an error.
        label: human-friendly name of the reference for the error message
            (defaults to the model class name).
    """
    if entity_id is None or entity_id == "":
        if allow_none:
            return
        raise ValueError(
            f"{label or getattr(model, '__name__', 'reference')} is required"
        )

    if not await is_in_org(db, model, entity_id, organization_id):
        name = label or getattr(model, "__name__", "referenced record")
        # Deliberately generic: do not reveal whether the id exists in another
        # org (avoids a cross-tenant existence oracle).
        raise ValueError(f"Invalid {name}")


async def assert_all_in_org(
    db: AsyncSession,
    model: Any,
    entity_ids: Optional[Iterable[Any]],
    organization_id: Any,
    *,
    label: Optional[str] = None,
) -> None:
    """Raise ``ValueError`` unless *every* id in ``entity_ids`` is in the org.

    The list counterpart of ``assert_in_org``, for the JSON id arrays several
    models store (``required_courses``, ``category_ids``, …). An empty or
    missing collection is accepted — "no references" is a valid state; it is a
    *present but foreign* id that is the XC-1 violation.

    Resolved in a single query rather than one per id, and reports only that
    something was invalid — never which id — so it cannot be used to probe
    another org for existence.
    """
    if not entity_ids:
        return

    unique_ids = {str(eid) for eid in entity_ids if eid and str(eid).strip()}
    if not unique_ids:
        return

    if not organization_id:
        raise ValueError(f"Invalid {label or getattr(model, '__name__', 'reference')}")

    result = await db.execute(
        select(model.id).where(
            model.id.in_(unique_ids),
            model.organization_id == str(organization_id),
        )
    )
    found = {str(row[0]) for row in result.all()}
    if unique_ids - found:
        name = label or getattr(model, "__name__", "referenced record")
        raise ValueError(f"Invalid {name}")


async def assert_current_members(
    db: AsyncSession,
    user_ids: Optional[Iterable[Any]],
    organization_id: Any,
    *,
    keep: Optional[Iterable[Any]] = None,
    label: str = "member",
) -> None:
    """Raise ``ValueError`` unless every id names a *current* member of the org.

    A current member is one ``User.is_active`` accepts: active or probationary,
    and not deleted. The roster import brings in former members (archived,
    retired, dropped, inactive), and a picker hiding them is not a guard, so a
    path that names a member to do something — coordinate, approve, instruct,
    enrol — checks here.

    ``keep`` is the set of ids the record already holds. They are let through
    unchecked, so a record naming someone who has since left can still be
    saved unchanged; only a newly chosen former member is refused. An empty
    or missing ``user_ids`` is accepted.

    The message is the same for a former member, a deleted one and an id from
    another organization, so it cannot be used to probe for existence.
    """
    from app.models.user import User

    kept = {str(uid) for uid in keep or () if uid}
    wanted = {str(uid) for uid in user_ids or () if uid and str(uid).strip()}
    to_check = wanted - kept
    if not to_check:
        return

    message = f"Only current members can be chosen as {label}"
    if not organization_id:
        raise ValueError(message)

    result = await db.execute(
        select(User.id).where(
            User.id.in_(to_check),
            User.organization_id == str(organization_id),
            User.is_active,
        )
    )
    found = {str(row[0]) for row in result.all()}
    if to_check - found:
        raise ValueError(message)
