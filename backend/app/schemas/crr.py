"""Request and response shapes for community risk reduction (CRR).

snake_case on the wire, like the events and event-request modules the CRR
screens sit beside (pitfall #5: a module picks one casing and keeps it).
"""

from datetime import datetime
from typing import Annotated, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.base import UTCDateTime, UTCResponseBase
from app.schemas.column_bounds import INT32_MAX

_NAME = Field(min_length=1, max_length=120)


class CrrMeasureResponse(UTCResponseBase):
    id: str
    code: str
    label: str
    is_active: bool
    sort_order: int


class CrrActivityTypeResponse(UTCResponseBase):
    id: str
    code: str
    name: str
    description: Optional[str] = None
    is_system: bool
    is_active: bool
    sort_order: int
    measures: List[CrrMeasureResponse]
    tag_ids: List[str]
    admin_hours_category_id: Optional[str] = None


class CrrTagResponse(UTCResponseBase):
    id: str
    kind: Literal["risk", "population"]
    code: str
    label: str
    is_system: bool
    is_active: bool
    sort_order: int


class CrrOption(UTCResponseBase):
    id: str
    name: str


class CrrCatalogueResponse(UTCResponseBase):
    activity_types: List[CrrActivityTypeResponse]
    tags: List[CrrTagResponse]
    # Active Admin Hours categories, for the per-type picker.
    admin_hours_categories: List[CrrOption] = Field(default_factory=list)
    resident_details_retention_months: int


class CrrActivityTypeCreate(BaseModel):
    name: str = _NAME
    description: Optional[str] = Field(default=None, max_length=1000)
    # The counts the new type records, e.g. ["People trained"].
    measures: List[str] = Field(default_factory=list, max_length=20)


class CrrActivityTypeUpdate(BaseModel):
    """Every field optional: an omitted key is left alone (pitfall #1)."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0, le=10000)
    # null clears it: back to the Public Education mapping.
    admin_hours_category_id: Optional[str] = None


class CrrMeasureCreate(BaseModel):
    label: str = _NAME


class CrrMeasureUpdate(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=120)
    is_active: Optional[bool] = None


class CrrTagCreate(BaseModel):
    kind: Literal["risk", "population"]
    label: str = _NAME


class CrrTagUpdate(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=120)
    is_active: Optional[bool] = None


class CrrTypeTagsUpdate(BaseModel):
    tag_ids: List[str] = Field(default_factory=list, max_length=50)


class ZipLookupResponse(UTCResponseBase):
    zip_code: str
    city: str
    state: str
    county: str


class CrrSettingsUpdate(BaseModel):
    resident_details_retention_months: int = Field(ge=1, le=120)


class CrrSettingsResponse(UTCResponseBase):
    resident_details_retention_months: int


# ----------------------------------------------------------------------
# Activities

_SHORT = Field(default=None, max_length=255)

# A count lands in crr_activity_counts.quantity (Integer, checked >= 0); a
# member's minutes in crr_activity_members.minutes (checked 0..1440, a day).
_Quantity = Annotated[int, Field(ge=0, le=INT32_MAX)]
_Minutes = Annotated[int, Field(ge=0, le=1440)]


class CrrActivityCreate(BaseModel):
    activity_type_id: str
    occurred_at: UTCDateTime
    event_id: Optional[str] = None
    # measure id -> how many
    counts: Dict[str, _Quantity] = Field(default_factory=dict)
    # Omitted: the type's default tags. An explicit list replaces them.
    tag_ids: Optional[List[str]] = Field(default=None, max_length=50)
    zip_code: Optional[str] = Field(default=None, max_length=10)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=50)
    has_resident_details: bool = False
    street_address: Optional[str] = _SHORT
    resident_name: Optional[str] = _SHORT
    resident_phone: Optional[str] = Field(default=None, max_length=40)
    resident_email: Optional[str] = _SHORT
    notes: Optional[str] = Field(default=None, max_length=2000)
    # member id -> minutes spent; ignored on an event's activity, whose
    # attendance already credits the time.
    members: Dict[str, _Minutes] = Field(default_factory=dict, max_length=50)


class CrrActivityUpdate(BaseModel):
    """Every field optional: an omitted key is left alone, null clears (pitfall #1)."""

    counts: Optional[Dict[str, _Quantity]] = None
    tag_ids: Optional[List[str]] = Field(default=None, max_length=50)
    zip_code: Optional[str] = Field(default=None, max_length=10)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=50)
    street_address: Optional[str] = _SHORT
    resident_name: Optional[str] = _SHORT
    resident_phone: Optional[str] = Field(default=None, max_length=40)
    resident_email: Optional[str] = _SHORT
    notes: Optional[str] = Field(default=None, max_length=2000)


class CrrActivityCountResponse(UTCResponseBase):
    measure_id: str
    label: str
    quantity: int


class CrrActivityTagResponse(UTCResponseBase):
    id: str
    label: str


class CrrActivityMemberResponse(UTCResponseBase):
    user_id: str
    name: str
    minutes: int


class CrrActivityResponse(UTCResponseBase):
    id: str
    activity_type_id: str
    activity_type_name: str
    event_id: Optional[str] = None
    event_title: Optional[str] = None
    occurred_at: datetime
    zip_code: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    county: Optional[str] = None
    counts: List[CrrActivityCountResponse]
    tags: List[CrrActivityTagResponse]
    members: List[CrrActivityMemberResponse]
    recorded_by_name: Optional[str] = None
    # Whether resident details are stored, said to everyone; the details
    # themselves only to crr.view_contact holders (null otherwise).
    has_resident_details: bool
    resident_details_cleared: bool
    street_address: Optional[str] = None
    resident_name: Optional[str] = None
    resident_phone: Optional[str] = None
    resident_email: Optional[str] = None
    notes: Optional[str] = None
    can_edit: bool


class CrrActivityListResponse(UTCResponseBase):
    items: List[CrrActivityResponse]
    total: int


class CrrMemberOption(UTCResponseBase):
    id: str
    name: str


class CrrFormOptionsResponse(UTCResponseBase):
    activity_types: List[CrrActivityTypeResponse]
    tags: List[CrrTagResponse]
    default_city: Optional[str] = None
    default_state: Optional[str] = None
    zip_lookup_enabled: bool
    members: List[CrrMemberOption]
    retention_months: int
    can_view_contact: bool
