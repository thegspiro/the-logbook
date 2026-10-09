"""
Location Models

Database models for managing physical locations (meeting halls, offices, etc.)
where events can take place.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.event import Event
    from app.models.facilities import Facility, FacilityRoom


class Location(Base):
    """
    Location model for managing physical spaces

    Tracks locations where events can be held, such as meeting halls,
    conference rooms, offices, etc. Supports room booking and QR code
    display for event check-ins.
    """

    __tablename__ = "locations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Location details
    name: Mapped[str] = mapped_column(
        String(200), nullable=False
    )  # e.g., "Main Meeting Hall", "Conference Room A"
    description: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # Additional info, amenities, equipment

    # Address
    address: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )  # Street address
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    zip: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    latitude: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    longitude: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Physical details
    building: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # Building name or identifier
    floor: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # Floor number or name
    room_number: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # Room number or identifier
    capacity: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Maximum occupancy

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )  # Can be used for events

    # Public display code — short, non-guessable code for kiosk/tablet URLs.
    # Allows tablets to display QR codes at `/display/{code}` without authentication.
    display_code: Mapped[Optional[str]] = mapped_column(
        String(12), nullable=True, unique=True, index=True
    )

    # Whether this room's kiosk accepts member ID card taps. Off by default and
    # switched on room by room: a tap at the kiosk records attendance with
    # nobody signed in, so the display code above becomes the only thing
    # standing between a copied card serial and an attendance record. A
    # department turns it on only where a reader is actually mounted.
    nfc_badge_check_in_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    # Facility link — when the Facilities module is enabled, this location can
    # optionally reference a Facility record for deep building management data.
    # The locations table remains the universal "place picker" for all modules.
    facility_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("facilities.id", ondelete="SET NULL"), nullable=True
    )

    # Room link — when a Location represents a specific room within a facility.
    # Auto-populated when rooms are created via the Facilities module, making
    # rooms available to Events, Storage, and other modules that use Locations.
    facility_room_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("facility_rooms.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )

    # Metadata
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    events: Mapped[list["Event"]] = relationship("Event", back_populates="location_obj")
    facility: Mapped[Optional["Facility"]] = relationship(
        "Facility", foreign_keys=[facility_id]
    )
    facility_room: Mapped[Optional["FacilityRoom"]] = relationship(
        "FacilityRoom", foreign_keys=[facility_room_id]
    )

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
