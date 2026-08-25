"""
Organizational Chart Pydantic Schemas

Request/response shapes for Governance -> Organizational Chart, the screen that
answers "who is in charge of this?" for the general membership.
"""

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.models.org_chart import (
    HOLDER_SOURCE_MANUAL,
    HOLDER_SOURCE_POSITION,
    HOLDER_SOURCE_RANK,
    HOLDER_SOURCES,
)
from app.schemas.base import UTCResponseBase

_RESPONSE_CONFIG = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)

# Requests are camelCase too. The frontend sends the same casing it receives,
# and `populate_by_name` keeps the snake_case names working for anything
# posting to the API directly (tests, scripts, integrations).
_REQUEST_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)

# A seat with more people in it than this is a mailing list, not a box on an
# org chart, and the diagram stops being readable well before it.
MAX_HOLDERS_PER_NODE = 25


def _blank_to_none(value: Optional[str]) -> Optional[str]:
    """Treat a whitespace-only field as absent.

    The editor sends every field it owns on every save (pitfall #1), so an
    emptied box arrives as ``""`` rather than being omitted; storing that would
    make a seat look like it has a display name of nothing.
    """
    if value is None:
        return None
    return value.strip() or None


class OrgChartHolderInput(BaseModel):
    """One person the editor listed in a seat.

    Either a member id, a typed name, or both — a linked member with a typed
    name is how a department announces somebody differently from their roster
    record ("Chief Ramirez" rather than "Miguel Ramirez").
    """

    model_config = _REQUEST_CONFIG

    user_id: Optional[str] = Field(None, max_length=36)
    display_name: Optional[str] = Field(None, max_length=200)

    @field_validator("user_id", "display_name")
    @classmethod
    def _optional_blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        return _blank_to_none(v)

    @model_validator(mode="after")
    def _names_somebody(self) -> "OrgChartHolderInput":
        if not self.user_id and not self.display_name:
            raise ValueError(
                "Each person in a position needs either a member or a name"
            )
        return self


class _HolderSourceFields(BaseModel):
    """The three fields that decide where a seat's holders come from.

    Cross-validated rather than merely typed: a seat sourced from a position
    with no ``position_id``, or from a rank with no ``rank_code``, resolves as
    permanently vacant with nothing on the screen to explain why. Refusing it
    at the schema is the only place that mismatch is still visible.
    """

    holder_source: str = Field(HOLDER_SOURCE_MANUAL, max_length=20)
    position_id: Optional[str] = Field(None, max_length=36)
    rank_code: Optional[str] = Field(None, max_length=100)

    @field_validator("holder_source")
    @classmethod
    def _known_source(cls, v: str) -> str:
        source = (v or "").strip().lower()
        if source not in HOLDER_SOURCES:
            raise ValueError(f"Unknown holder source: {v}")
        return source

    @field_validator("position_id", "rank_code")
    @classmethod
    def _optional_blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        return _blank_to_none(v)

    @model_validator(mode="after")
    def _source_matches_its_reference(self) -> "_HolderSourceFields":
        if self.holder_source == HOLDER_SOURCE_POSITION and not self.position_id:
            raise ValueError("Choose the role this position follows")
        if self.holder_source == HOLDER_SOURCE_RANK and not self.rank_code:
            raise ValueError("Choose the rank this position follows")
        # The unused reference is cleared rather than left lying in the row:
        # kept, it would silently come back into effect the next time somebody
        # switched the source back, naming a role nobody chose.
        if self.holder_source != HOLDER_SOURCE_POSITION:
            self.position_id = None
        if self.holder_source != HOLDER_SOURCE_RANK:
            self.rank_code = None
        return self


class OrgChartNodeCreate(_HolderSourceFields):
    """A new seat on the chart."""

    model_config = _REQUEST_CONFIG

    title: str = Field(..., max_length=150)
    parent_id: Optional[str] = Field(None, max_length=36)
    responsibility: Optional[str] = Field(None, max_length=2000)
    holders: List[OrgChartHolderInput] = Field(
        default_factory=list, max_length=MAX_HOLDERS_PER_NODE
    )
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

    @field_validator("parent_id", "responsibility", "contact_email", "contact_phone")
    @classmethod
    def _optional_blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        return _blank_to_none(v)


class OrgChartNodeUpdate(BaseModel):
    """Edit to an existing seat.

    Every scalar field is ``Optional`` and the service applies the payload with
    ``exclude_unset``, so an omitted key leaves the column alone while an
    explicit ``null`` clears it — the three-state contract in pitfall #1.
    ``parent_id`` is deliberately absent: re-parenting goes through ``/move``,
    which also renumbers the siblings it lands among.

    ``holders`` is a whole-collection replace rather than a patch, which is why
    it is the one field where an omitted key and an empty list differ in the
    obvious way: omit it to leave the people alone, send ``[]`` to empty the
    seat.
    """

    model_config = _REQUEST_CONFIG

    title: Optional[str] = Field(None, max_length=150)
    responsibility: Optional[str] = Field(None, max_length=2000)
    holders: Optional[List[OrgChartHolderInput]] = Field(
        None, max_length=MAX_HOLDERS_PER_NODE
    )
    holder_source: Optional[str] = Field(None, max_length=20)
    position_id: Optional[str] = Field(None, max_length=36)
    rank_code: Optional[str] = Field(None, max_length=100)
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

    @field_validator("holder_source")
    @classmethod
    def _known_source(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        source = v.strip().lower()
        if source not in HOLDER_SOURCES:
            raise ValueError(f"Unknown holder source: {v}")
        return source

    @field_validator(
        "responsibility",
        "position_id",
        "rank_code",
        "contact_email",
        "contact_phone",
    )
    @classmethod
    def _optional_blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        return _blank_to_none(v)

    @model_validator(mode="after")
    def _source_matches_its_reference(self) -> "OrgChartNodeUpdate":
        """Only checked when the source itself is part of the payload.

        An update that touches nothing but the title must not be refused for a
        reference it never mentioned, so the guard runs only for a request that
        is actually re-pointing the seat. The editor always sends the whole
        source triple together, which is what makes that safe.
        """
        if self.holder_source is None:
            return self
        if self.holder_source == HOLDER_SOURCE_POSITION and not self.position_id:
            raise ValueError("Choose the role this position follows")
        if self.holder_source == HOLDER_SOURCE_RANK and not self.rank_code:
            raise ValueError("Choose the rank this position follows")
        return self


class OrgChartNodeMove(BaseModel):
    """Where a seat should sit after a drag or an up/down nudge."""

    model_config = _REQUEST_CONFIG

    # Required, but nullable: an explicit ``null`` means "make this a root of
    # the chart". It has no default because a body of just ``{"position": 2}``
    # would otherwise read as "promote to root" when the caller meant "reorder
    # where it already is" — a partial request that silently detaches a whole
    # subtree. Saying which parent is now part of asking for the move.
    parent_id: Optional[str] = Field(..., max_length=36)
    # Index among the new parent's children; clamped server-side.
    position: int = Field(0, ge=0)

    @field_validator("parent_id")
    @classmethod
    def _blank_parent_is_root(cls, v: Optional[str]) -> Optional[str]:
        return _blank_to_none(v)


class OrgChartHolder(BaseModel):
    """One resolved person in a seat.

    ``name`` is the answer to "who is this?" — the typed override if there is
    one, otherwise the linked member's name. ``user_id`` is present whenever
    the person has a member record, whichever source produced them.
    """

    model_config = _RESPONSE_CONFIG

    user_id: Optional[str] = None
    name: str


class OrgChartNodeResponse(UTCResponseBase):
    """One resolved seat.

    The contact fields are the seat's own published details and are never
    filled in from a holder's member record; see the model docstring.
    """

    model_config = _RESPONSE_CONFIG

    id: str
    parent_id: Optional[str] = None
    title: str
    responsibility: Optional[str] = None
    holders: List[OrgChartHolder] = []
    holder_source: str = HOLDER_SOURCE_MANUAL
    position_id: Optional[str] = None
    rank_code: Optional[str] = None
    # The role or rank this seat follows, resolved to its display name so the
    # reader is told *why* a seat lists who it lists without a second lookup.
    # None for a manual seat, and also for a source whose target has since been
    # deleted — which is exactly when the seat reads as vacant.
    source_label: Optional[str] = None
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


class OrgChartPositionOption(BaseModel):
    """A corporate position a seat can follow, and how many hold it now.

    ``holder_count`` is shown in the picker because a seat pointed at a role
    nobody holds renders as vacant, and finding that out after saving reads as
    the feature being broken.
    """

    model_config = _RESPONSE_CONFIG

    id: str
    name: str
    holder_count: int = 0


class OrgChartRankOption(BaseModel):
    """An operational rank a seat can follow."""

    model_config = _RESPONSE_CONFIG

    code: str
    name: str
    holder_count: int = 0


class OrgChartResponse(BaseModel):
    """The whole chart, plus what the caller may do with it."""

    model_config = _RESPONSE_CONFIG

    # Depth-first, parents before children, siblings in sort order — the order
    # the page renders in, so the client never has to sort.
    nodes: List[OrgChartNodeResponse] = []
    can_manage: bool = False
    # The three lists below are populated only for a caller who can manage the
    # chart: they are editing affordances, and the roster is not the chart's to
    # publish.
    members: List[OrgChartMemberOption] = []
    positions: List[OrgChartPositionOption] = []
    ranks: List[OrgChartRankOption] = []
