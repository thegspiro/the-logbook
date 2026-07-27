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

from typing import Any

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
