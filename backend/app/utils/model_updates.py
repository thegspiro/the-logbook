"""
Apply partial-update payloads to ORM instances without dropping explicit nulls.

The long-standing idiom across the service layer was:

    for key, value in updates.items():
        if value is not None:
            setattr(instance, key, value)

Paired with a `model_dump(exclude_unset=True)` payload, that guard is a silent
data-loss bug: `exclude_unset` already removed every field the client did not
send, so a `None` that survives to the service is an *explicit* null — the user
cleared the box — and skipping it means the write is acknowledged with a 200
while the old value stays in the database.

`apply_updates` distinguishes the three cases the old loop collapsed into one:

* field absent from the payload -> untouched (the caller's `exclude_unset`)
* field present and non-null    -> written
* field present and null        -> cleared, if the column is nullable;
                                   otherwise a ValueError the API turns into a
                                   400 rather than a silent no-op or a
                                   flush-time IntegrityError
"""

from typing import Any, Iterable, Mapping

from sqlalchemy import inspect as sa_inspect

__all__ = ["apply_updates"]


def _nullable_columns(instance: Any) -> dict[str, bool]:
    """Map attribute name -> whether the underlying column accepts NULL.

    Attributes that are not plain columns (relationships, association proxies,
    hybrids) are absent from the result; callers treat those as always
    settable since there is no NOT NULL constraint to violate.
    """
    mapper = sa_inspect(type(instance))
    return {key: bool(column.nullable) for key, column in mapper.columns.items()}


def apply_updates(
    instance: Any,
    updates: Mapping[str, Any],
    *,
    skip: Iterable[str] = (),
) -> set[str]:
    """Write `updates` onto `instance`, honoring explicit nulls as "clear this".

    Args:
        instance: A mapped ORM object.
        updates: Partial payload, normally `Schema.model_dump(exclude_unset=True)`.
            Keys absent from this mapping are left untouched.
        skip: Field names the caller handles itself (nested collections such as
            `variants` or `offerings`, which need bespoke replace logic).

    Returns:
        The set of attribute names actually written, so callers can react to a
        specific field changing without re-deriving it.

    Raises:
        ValueError: If a field has no corresponding model attribute, or if a
            null is sent for a NOT NULL column. Both are reported rather than
            skipped — an update the caller believes succeeded must not have
            silently dropped part of its payload.
    """
    skipped = set(skip)
    nullable = _nullable_columns(instance)
    written: set[str] = set()

    for key, value in updates.items():
        if key in skipped:
            continue
        if not hasattr(instance, key):
            raise ValueError(
                f"Cannot update unknown field '{key}' on {type(instance).__name__}"
            )
        # `nullable.get(key, True)`: non-column attributes carry no NOT NULL
        # constraint, so there is nothing to reject.
        if value is None and not nullable.get(key, True):
            raise ValueError(f"Field '{key}' cannot be cleared")
        setattr(instance, key, value)
        written.add(key)

    return written
