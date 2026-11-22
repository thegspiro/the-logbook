"""Request and response shapes for community risk reduction (CRR).

snake_case on the wire, like the events and event-request modules the CRR
screens sit beside (pitfall #5: a module picks one casing and keeps it).
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.base import UTCResponseBase

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


class CrrTagResponse(UTCResponseBase):
    id: str
    kind: Literal["risk", "population"]
    code: str
    label: str
    is_system: bool
    is_active: bool
    sort_order: int


class CrrCatalogueResponse(UTCResponseBase):
    activity_types: List[CrrActivityTypeResponse]
    tags: List[CrrTagResponse]


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
