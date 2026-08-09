"""
Shared schema for a CHECKLIST requirement's steps.

Requests may send a step either as a bare string (what every client sent before
per-step visibility existed, and what the sample templates still declare) or as
an object. Both land as :class:`ChecklistItem`, so an endpoint never has to care
which shape it was handed.
"""

from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from app.utils.checklist import normalize_checklist_items


class ChecklistItem(BaseModel):
    """One step of a checklist requirement."""

    # Assigned server-side when a step is created; sent back by editors so an
    # existing step keeps its identity (and the ticks recorded against it)
    # through a rename or a reorder.
    id: Optional[str] = Field(None, max_length=64)
    text: str = Field(..., min_length=1, max_length=500)
    # Officer-only steps (references called, background check returned) stay off
    # the member's view. Visible by default — hiding a step is the deliberate
    # choice, not the fallback.
    member_visible: bool = True

    @field_validator("id", "text", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v


def coerce_checklist_items(value: Any) -> Optional[List[dict]]:
    """Validator body for a ``checklist_items`` field: accept strings, objects,
    or a mix, and hand back the normalized object form."""
    if value is None:
        return None
    return normalize_checklist_items(value)
