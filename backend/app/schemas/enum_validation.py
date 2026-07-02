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
from typing import Optional, Type


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
