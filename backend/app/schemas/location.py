"""
Location Pydantic Schemas

Request and response schemas for location-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime
from uuid import UUID


class LocationBase(BaseModel):
    """Base location schema"""
    name: str = Field(..., min_length=1, max_length=200, description="Location name (e.g., Main Meeting Hall)")
    description: Optional[str] = Field(None, description="Additional details about the location")
    building: Optional[str] = Field(None, max_length=100, description="Building name or identifier")
    floor: Optional[str] = Field(None, max_length=20, description="Floor number or name")
    room_number: Optional[str] = Field(None, max_length=50, description="Room number or identifier")
    capacity: Optional[int] = Field(None, ge=1, description="Maximum occupancy")
    is_active: bool = Field(default=True, description="Whether location is available for events")


class LocationCreate(LocationBase):
    """Schema for creating a new location"""
    pass


class LocationUpdate(BaseModel):
    """Schema for updating a location"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    building: Optional[str] = Field(None, max_length=100)
    floor: Optional[str] = Field(None, max_length=20)
    room_number: Optional[str] = Field(None, max_length=50)
    capacity: Optional[int] = Field(None, ge=1)
    is_active: Optional[bool] = None


class LocationResponse(LocationBase):
    """Schema for location response"""
    id: UUID
    organization_id: UUID
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LocationListItem(BaseModel):
    """Schema for location list items"""
    id: UUID
    name: str
    building: Optional[str] = None
    floor: Optional[str] = None
    room_number: Optional[str] = None
    capacity: Optional[int] = None
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class LocationWithCurrentEvents(LocationResponse):
    """Location with information about current/upcoming events"""
    current_events: list = Field(default_factory=list, description="Events currently in check-in window")
    next_event: Optional[dict] = Field(None, description="Next upcoming event")


class LocationDisplayInfo(BaseModel):
    """Information for location display screens (iPads, etc.)"""
    location_id: UUID
    location_name: str
    current_events: list = Field(default_factory=list, description="Events with active check-in windows")
    has_overlap: bool = Field(default=False, description="Whether multiple events are overlapping")

    model_config = ConfigDict(from_attributes=True)
