"""
Location Models

Database models for managing physical locations (meeting halls, offices, etc.)
where events can take place.
"""

from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.utils import generate_uuid

from app.core.database import Base


class Location(Base):
    """
    Location model for managing physical spaces

    Tracks locations where events can be held, such as meeting halls,
    conference rooms, offices, etc. Supports room booking and QR code
    display for event check-ins.
    """
    __tablename__ = "locations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)

    # Location details
    name = Column(String(200), nullable=False)  # e.g., "Main Meeting Hall", "Conference Room A"
    description = Column(Text, nullable=True)  # Additional info, amenities, equipment

    # Address
    address = Column(String(255), nullable=True)  # Street address
    city = Column(String(100), nullable=True)
    state = Column(String(50), nullable=True)
    zip = Column(String(20), nullable=True)
    latitude = Column(String(20), nullable=True)
    longitude = Column(String(20), nullable=True)

    # Physical details
    building = Column(String(100), nullable=True)  # Building name or identifier
    floor = Column(String(20), nullable=True)  # Floor number or name
    room_number = Column(String(50), nullable=True)  # Room number or identifier
    capacity = Column(Integer, nullable=True)  # Maximum occupancy

    # Status
    is_active = Column(Boolean, nullable=False, default=True)  # Can be used for events

    # Facility link — when the Facilities module is enabled, this location can
    # optionally reference a Facility record for deep building management data.
    # The locations table remains the universal "place picker" for all modules.
    facility_id = Column(String(36), ForeignKey("facilities.id", ondelete="SET NULL"), nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    events = relationship("Event", back_populates="location_obj")
    facility = relationship("Facility", foreign_keys=[facility_id])

    __table_args__ = (
        Index("ix_locations_organization_id", "organization_id"),
        Index("ix_locations_name", "name"),
        Index("ix_locations_is_active", "is_active"),
        Index("ix_locations_facility_id", "facility_id"),
    )

    def __repr__(self):
        return f"<Location(name={self.name}, building={self.building})>"

    @property
    def full_location(self) -> str:
        """Get full location string with building, floor, and room"""
        parts = [self.name]
        if self.building:
            parts.append(f"Building {self.building}")
        if self.floor:
            parts.append(f"Floor {self.floor}")
        if self.room_number:
            parts.append(f"Room {self.room_number}")
        return " - ".join(parts)
