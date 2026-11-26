"""The department's public website: its settings, and what its pages show.

The pages (``app/api/public/site.py``) and the settings screen
(``app/api/v1/endpoints/public_site.py``) both read the department's contact
details through ``contact_on_record`` here, so the screen's preview and the
published page cannot disagree about what the record holds.
"""

from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.public_site import PublicSiteSettings, PublicSiteTheme
from app.models.user import Organization
from app.utils.model_updates import apply_updates

#: The module a department must have on for its website to answer.
PUBLIC_SITE_MODULE = "public_info"

#: Every on/off column on the settings row.
SWITCHES = (
    "enabled",
    "show_about",
    "show_contact",
    "show_phone",
    "show_email",
    "show_address",
    "show_member_login",
)

TEXT_FIELDS = ("tagline", "welcome_text", "about_text", "emergency_notice")

THEMES: tuple[dict[str, str], ...] = (
    {
        "value": PublicSiteTheme.CLASSIC.value,
        "label": "Classic",
        "description": "White pages under a deep red header.",
    },
    {
        "value": PublicSiteTheme.MODERN.value,
        "label": "Modern",
        "description": "Cool greys under a navy header, with blue accents.",
    },
    {
        "value": PublicSiteTheme.HERITAGE.value,
        "label": "Heritage",
        "description": "Cream pages, serif headings and a dark green header.",
    },
)

_THEME_VALUES = frozenset(theme["value"] for theme in THEMES)


@dataclass(frozen=True)
class ContactDetails:
    phone: Optional[str] = None
    email: Optional[str] = None
    address_lines: list[str] = field(default_factory=list)

    @property
    def any(self) -> bool:
        return bool(self.phone or self.email or self.address_lines)

    @property
    def phone_href(self) -> Optional[str]:
        """The phone number as a ``tel:`` address, or ``None`` when what is on
        record holds no digits to dial (a note such as "see station")."""
        if not self.phone:
            return None
        digits = "".join(ch for ch in self.phone if ch.isdigit())
        if not digits:
            return None
        return f"tel:{'+' if self.phone.lstrip().startswith('+') else ''}{digits}"


def theme_of(row: PublicSiteSettings) -> str:
    """The row's theme, or the default when it names one no longer offered."""
    return row.theme if row.theme in _THEME_VALUES else PublicSiteTheme.CLASSIC.value


def _clean(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _address_lines(org: Organization) -> list[str]:
    """Where the department is, as the lines of a postal address.

    The physical address when one is kept separately, the mailing address
    otherwise: a visitor wants the station, not the post office box.
    """
    if not org.physical_address_same and _clean(org.physical_address_line1):
        parts = (
            org.physical_address_line1,
            org.physical_address_line2,
            org.physical_city,
            org.physical_state,
            org.physical_zip,
        )
    else:
        parts = (
            org.mailing_address_line1,
            org.mailing_address_line2,
            org.mailing_city,
            org.mailing_state,
            org.mailing_zip,
        )
    line1, line2, city, state, postcode = (_clean(part) for part in parts)
    region = " ".join(part for part in (state, postcode) if part)
    locality = ", ".join(part for part in (city, region) if part)
    return [line for line in (line1, line2, locality) if line]


def contact_on_record(org: Organization) -> ContactDetails:
    """The department's contact details as its own record holds them."""
    return ContactDetails(
        phone=_clean(org.phone),
        email=_clean(org.email),
        address_lines=_address_lines(org),
    )


def public_contact(org: Organization, row: PublicSiteSettings) -> ContactDetails:
    """The contact details the website may show: each one only while its own
    switch is on, whatever the record holds."""
    record = contact_on_record(org)
    return ContactDetails(
        phone=record.phone if row.show_phone else None,
        email=record.email if row.show_email else None,
        address_lines=record.address_lines if row.show_address else [],
    )


def paragraphs(text: Optional[str]) -> list[str]:
    """Plain text as paragraphs, split on blank lines."""
    if not text:
        return []
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    return [block.strip() for block in normalized.split("\n\n") if block.strip()]


class PublicSiteService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def settings(self, organization_id: str) -> PublicSiteSettings:
        """The department's row, or an unsaved one with everything off."""
        row = await self.db.scalar(
            select(PublicSiteSettings).where(
                PublicSiteSettings.organization_id == str(organization_id)
            )
        )
        if row is not None:
            return row
        return PublicSiteSettings(
            organization_id=str(organization_id),
            **{name: False for name in SWITCHES},
            theme=PublicSiteTheme.CLASSIC.value,
        )

    async def update_settings(
        self, organization_id: str, values: dict[str, Any], actor_id: str
    ) -> PublicSiteSettings:
        """Write the fields sent. A text field sent as null or blank is
        cleared; a null for a switch or the theme is refused."""
        row = await self.settings(organization_id)
        updates = dict(values)
        for name in TEXT_FIELDS:
            if name in updates:
                updates[name] = _clean(updates[name])
        apply_updates(row, updates)
        row.updated_by = actor_id
        if row.id is None:
            self.db.add(row)
        await self.db.flush()
        return row

    async def is_servable(self) -> bool:
        """Whether this installation has exactly one department.

        An anonymous visitor carries no department, so the website answers
        only where there is no choice to make.
        """
        count = await self.db.scalar(select(func.count()).select_from(Organization))
        return count == 1
