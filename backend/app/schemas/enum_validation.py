"""
Shared enum-string validation for request schemas.

Several request schemas accept enum-backed columns (training_type, status,
frequency) as plain strings for backward compatibility with existing
clients. Without validation, an invalid value passes Pydantic and then
blows up inside SQLAlchemy at flush time as a 500. These helpers normalize
(lowercase) and validate the value at the schema boundary so the client
gets a clean 422 instead.
"""

from enum import Enum
from typing import Optional, Type, overload


# Overloaded so a required field's validator gets ``str`` back rather than an
# ``Optional[str]`` it would have to narrow: only a None input returns None.
@overload
def validate_enum_value(value: str, enum_cls: Type[Enum], field_name: str) -> str:
    """A string in, the normalized string out."""


@overload
def validate_enum_value(
    value: Optional[str], enum_cls: Type[Enum], field_name: str
) -> Optional[str]:
    """An optional value in: None passes through unchanged."""


def validate_enum_value(
    value: Optional[str],
    enum_cls: Type[Enum],
    field_name: str,
) -> Optional[str]:
    """Normalize a string to lowercase and require it to be a valid value
    of ``enum_cls``. Returns None unchanged so it works for optional fields.
    """
    if value is None:
        return None
    normalized = value.strip().lower()
    valid_values = {e.value for e in enum_cls}
    if normalized not in valid_values:
        raise ValueError(
            f"Invalid {field_name} '{value}'. "
            f"Valid values: {', '.join(sorted(valid_values))}"
        )
    return normalized
