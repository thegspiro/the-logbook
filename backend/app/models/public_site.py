"""
Public Website Models

The website a department publishes for its own community, rendered by this
installation and served on its own port (``app/api/public/site.py``). Distinct
from the Public Portal (``public_portal.py``), which is a keyed JSON API for a
website the department hosts somewhere else.
"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.user import Organization


class PublicSiteTheme(str, Enum):
    """The looks a department may choose between."""

    CLASSIC = "classic"
    MODERN = "modern"
    HERITAGE = "heritage"


TAGLINE_MAX_LENGTH = 200
EMERGENCY_NOTICE_MAX_LENGTH = 200
THEME_MAX_LENGTH = 20


class PublicSiteSettings(Base):
    """What a department's public website shows, one row per department.

    Everything starts off: the site answers 404 until ``enabled`` is set, and
    each page and each contact detail has its own switch. The contact details
    themselves are not stored here. They are the department's own record
    (``Organization.phone``, ``email`` and address), so the website cannot
    drift from what the rest of the application holds.

    All text is plain text. The templates escape it and split it into
    paragraphs; no markup an administrator types reaches a public page.
    """

    __tablename__ = "public_site_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # A string, not a SQL enum, so adding a theme is a code change and not an
    # ALTER on every installation. PublicSiteTheme is the authority; a stored
    # value it no longer names renders as the default theme.
    theme: Mapped[str] = mapped_column(
        String(THEME_MAX_LENGTH),
        nullable=False,
        default=PublicSiteTheme.CLASSIC.value,
        server_default=PublicSiteTheme.CLASSIC.value,
    )
    tagline: Mapped[Optional[str]] = mapped_column(
        String(TAGLINE_MAX_LENGTH), nullable=True
    )
    welcome_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    about_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    emergency_notice: Mapped[Optional[str]] = mapped_column(
        String(EMERGENCY_NOTICE_MAX_LENGTH), nullable=True
    )

    show_about: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    show_contact: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    show_phone: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    show_email: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    show_address: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    show_member_login: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    updated_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
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

    organization: Mapped["Organization"] = relationship("Organization")

    def __repr__(self) -> str:
        return (
            f"<PublicSiteSettings(org_id={self.organization_id}, "
            f"enabled={self.enabled})>"
        )
