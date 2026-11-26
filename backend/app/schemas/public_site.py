"""Schemas for the department's public website settings.

Field names are snake_case on the wire, as the model names them.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.models.public_site import (
    EMERGENCY_NOTICE_MAX_LENGTH,
    TAGLINE_MAX_LENGTH,
)

WELCOME_TEXT_MAX_LENGTH = 2_000
ABOUT_TEXT_MAX_LENGTH = 20_000

ThemeName = Literal["classic", "modern", "heritage"]


class PublicSiteThemeOption(BaseModel):
    value: str
    label: str
    description: str


class PublicSiteContactOnRecord(BaseModel):
    """The department's own contact details, which the website shows when
    their switches are on. Edited in Organization Settings, not here."""

    phone: Optional[str] = None
    email: Optional[str] = None
    address_lines: list[str] = Field(default_factory=list)


class PublicSiteSettingsView(BaseModel):
    enabled: bool
    theme: str
    tagline: Optional[str] = None
    welcome_text: Optional[str] = None
    about_text: Optional[str] = None
    emergency_notice: Optional[str] = None
    show_about: bool
    show_contact: bool
    show_phone: bool
    show_email: bool
    show_address: bool
    show_member_login: bool
    themes: list[PublicSiteThemeOption]
    contact_on_record: PublicSiteContactOnRecord
    #: False when this installation holds more than one department: the
    #: website answers only where there is exactly one to answer for.
    servable: bool


class PublicSiteSettingsUpdate(BaseModel):
    """Only the fields sent change. A text field sent as null is cleared."""

    enabled: Optional[bool] = None
    theme: Optional[ThemeName] = None
    tagline: Optional[str] = Field(None, max_length=TAGLINE_MAX_LENGTH)
    welcome_text: Optional[str] = Field(None, max_length=WELCOME_TEXT_MAX_LENGTH)
    about_text: Optional[str] = Field(None, max_length=ABOUT_TEXT_MAX_LENGTH)
    emergency_notice: Optional[str] = Field(
        None, max_length=EMERGENCY_NOTICE_MAX_LENGTH
    )
    show_about: Optional[bool] = None
    show_contact: Optional[bool] = None
    show_phone: Optional[bool] = None
    show_email: Optional[bool] = None
    show_address: Optional[bool] = None
    show_member_login: Optional[bool] = None
