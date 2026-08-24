"""
Organizational Chart Pydantic Schemas

Request/response shapes for Governance -> Organizational Chart, the screen that
answers "who is in charge of this?" for the general membership.
"""

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.schemas.base import UTCResponseBase

_RESPONSE_CONFIG = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)

# Requests are camelCase too. The frontend sends the same casing it receives,
# and `populate_by_name` keeps the snake_case names working for anything
# posting to the API directly (tests, scripts, integrations).
_REQUEST_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)


def _blank_to_none(value: Optional[str]) -> Optional[str]:
    """Treat a whitespace-only field as absent.

    The editor sends every field it owns on every save (pitfall #1), so an
    emptied box arrives as ``""`` rather than being omitted; storing that would
    make a seat look like it has a display name of nothing.
    """
    if value is None:
        return None
    return value.strip() or None


class OrgChartNodeCreate(BaseModel):
    """A new seat on the chart."""

    model_config = _REQUEST_CONFIG

    title: str = Field(..., max_length=150)
    parent_id: Optional[str] = Field(None, max_length=36)
    responsibility: Optional[str] = Field(None, max_length=2000)
    user_id: Optional[str] = Field(None, max_length=36)
    display_name: Optional[str] = Field(None, max_length=200)
    contact_email: Optional[str] = Field(None, max_length=320)
    contact_phone: Optional[str] = Field(None, max_length=50)
    is_published: bool = True

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, v: str) -> str:
        title = v.strip()
        if not title:
            raise ValueError("Title cannot be blank")
        return title

    @field_validator(
        "parent_id",
        "responsibility",
        "user_id",
        "display_name",
        "contact_email",
        "contact_phone",
    )
    @classmethod
    def _optional_blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        return _blank_to_none(v)


class OrgChartNodeUpdate(BaseModel):
    """Edit to an existing seat.

    Every field is ``Optional`` and the service applies the payload with
    ``exclude_unset``, so an omitted key leaves the column alone while an
    explicit ``null`` clears it — the three-state contract in pitfall #1.
    ``parent_id`` is deliberately absent: re-parenting goes through ``/move``,
    which also renumbers the siblings it lands among.
    """

    model_config = _REQUEST_CONFIG

    title: Optional[str] = Field(None, max_length=150)
    responsibility: Optional[str] = Field(None, max_length=2000)
    user_id: Optional[str] = Field(None, max_length=36)
    display_name: Optional[str] = Field(None, max_length=200)
    contact_email: Optional[str] = Field(None, max_length=320)
    contact_phone: Optional[str] = Field(None, max_length=50)
    is_published: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        title = v.strip()
        if not title:
            raise ValueError("Title cannot be blank")
        return title

    @field_validator(
        "responsibility",
        "user_id",
        "display_name",
        "contact_email",
        "contact_phone",
    )
    @classmethod
    def _optional_blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        return _blank_to_none(v)


class OrgChartNodeMove(BaseModel):
    """Where a seat should sit after a drag or an up/down nudge."""

    model_config = _REQUEST_CONFIG

    # NULL means "make this a root of the chart".
    parent_id: Optional[str] = Field(None, max_length=36)
    # Index among the new parent's children; clamped server-side.
    position: int = Field(0, ge=0)

    @field_validator("parent_id")
    @classmethod
    def _blank_parent_is_root(cls, v: Optional[str]) -> Optional[str]:
        return _blank_to_none(v)


class OrgChartNodeResponse(UTCResponseBase):
    """One resolved seat.

    ``holder_name`` is the resolved answer to "who is this?" — the typed
    override if there is one, otherwise the linked member's name. The contact
    fields are the seat's own published details and are never filled in from
    the holder's member record; see the model docstring.
    """

    model_config = _RESPONSE_CONFIG

    id: str
    parent_id: Optional[str] = None
    title: str
    responsibility: Optional[str] = None
    user_id: Optional[str] = None
    holder_name: Optional[str] = None
    display_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    sort_order: int = 0
    is_published: bool = True
    # Depth from the chart's root, so the reader can render the hierarchy
    # without walking the list itself.
    depth: int = 0


class OrgChartMemberOption(BaseModel):
    """A member who can be linked to a seat, for the editor's picker."""

    model_config = _RESPONSE_CONFIG

    id: str
    name: str


class OrgChartResponse(BaseModel):
    """The whole chart, plus what the caller may do with it."""

    model_config = _RESPONSE_CONFIG

    # Depth-first, parents before children, siblings in sort order — the order
    # the page renders in, so the client never has to sort.
    nodes: List[OrgChartNodeResponse] = []
    can_manage: bool = False
    # Populated only for a caller who can manage the chart: the picker is an
    # editing affordance, and the roster is not the chart's to publish.
    members: List[OrgChartMemberOption] = []
