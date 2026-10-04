"""
Printable CR80 member ID cards.

Turns a set of members into a card-printer PDF (see
:mod:`app.utils.id_card_renderer`) and keeps the department's chosen card
layout — orientation, one or two sides, barcode or QR — in
``organization.settings["id_card_print"]``. The layout is a department
decision rather than an officer's: it follows the badge holders the
department bought and the printer it owns, so whoever prints next gets the
same card.
"""

import copy
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operational_rank import OperationalRank
from app.models.user import Organization, User
from app.services.label_service import member_badge_value
from app.utils.id_card_renderer import (
    ORIENTATION_LANDSCAPE,
    SIDES_FRONT,
    IdCardDepartment,
    IdCardSpec,
    render_id_cards,
    validate_orientation,
    validate_sides,
)
from app.utils.label_renderer import SYMBOLOGY_CODE128, validate_symbology
from app.utils.membership import is_administrative

SETTINGS_KEY = "id_card_print"

# What a department that has never chosen gets: the card every single-sided
# printer can produce, with the barcode every scanner in the app already reads.
DEFAULT_LAYOUT: Dict[str, str] = {
    "orientation": ORIENTATION_LANDSCAPE,
    "sides": SIDES_FRONT,
    "symbology": SYMBOLOGY_CODE128,
}

# A department prints its roster in one go when it first adopts cards. This is
# well above any volunteer department's roster, and keeps a single request
# from tying up a worker rendering thousands of pages.
MAX_CARDS_PER_JOB = 500


def _read_layout(settings: Any) -> Dict[str, str]:
    """The stored layout, falling back field by field to the default.

    ``settings`` is free-form JSON. A value that no longer validates — hand
    edited, or from an option since removed — degrades to the default rather
    than refusing to print.
    """
    stored = settings.get(SETTINGS_KEY) if isinstance(settings, dict) else None
    stored = stored if isinstance(stored, dict) else {}
    validators = {
        "orientation": validate_orientation,
        "sides": validate_sides,
        "symbology": validate_symbology,
    }
    layout = dict(DEFAULT_LAYOUT)
    for key, validate in validators.items():
        value = stored.get(key)
        if isinstance(value, str):
            try:
                layout[key] = validate(value)
            except ValueError:
                pass
    return layout


def _return_lines(org: Organization) -> List[str]:
    """Where a found card should be sent: the mailing address, else physical."""
    if org.mailing_address_line1:
        street = [org.mailing_address_line1, org.mailing_address_line2]
        city, state, zip_code = org.mailing_city, org.mailing_state, org.mailing_zip
    else:
        street = [org.physical_address_line1, org.physical_address_line2]
        city, state, zip_code = (
            org.physical_city,
            org.physical_state,
            org.physical_zip,
        )
    locality = ", ".join(
        filter(None, [city, " ".join(filter(None, [state, zip_code]))])
    )
    lines = ["If found, please return to:", org.name]
    lines.extend(line for line in street if line)
    if locality:
        lines.append(locality)
    if org.phone:
        lines.append(org.phone)
    return lines


class MemberIdCardService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _organization(self, organization_id, for_update: bool = False):
        query = select(Organization).where(Organization.id == str(organization_id))
        if for_update:
            query = query.with_for_update()
        org = await self.db.scalar(query)
        if org is None:
            raise ValueError("Organization not found")
        return org

    async def get_layout(self, organization_id) -> Dict[str, str]:
        org = await self._organization(organization_id)
        return _read_layout(org.settings)

    async def save_layout(
        self, organization_id, orientation: str, sides: str, symbology: str
    ) -> Dict[str, str]:
        layout = {
            "orientation": validate_orientation(orientation),
            "sides": validate_sides(sides),
            "symbology": validate_symbology(symbology),
        }
        # Locked read-modify-write: org.settings holds every module's
        # configuration, and two officers saving different sections at once
        # must not drop each other's change.
        org = await self._organization(organization_id, for_update=True)
        settings = copy.deepcopy(org.settings or {})
        settings[SETTINGS_KEY] = layout
        org.settings = settings
        await self.db.flush()
        return layout

    async def _rank_names(self, organization_id) -> Dict[str, str]:
        rows = await self.db.execute(
            select(OperationalRank.rank_code, OperationalRank.display_name).where(
                OperationalRank.organization_id == str(organization_id)
            )
        )
        return {row.rank_code: row.display_name for row in rows}

    async def generate(
        self,
        organization_id,
        user_ids: List[str],
        orientation: Optional[str] = None,
        sides: Optional[str] = None,
        symbology: Optional[str] = None,
    ) -> Tuple[BytesIO, int]:
        """Render cards for *user_ids* in the caller's organization.

        Options left as ``None`` take the department's saved layout. Ids from
        another organization, or that do not exist, are skipped — the same
        as the label path — and only the cards actually rendered are counted.
        """
        if not user_ids:
            raise ValueError("Select at least one member")
        if len(user_ids) > MAX_CARDS_PER_JOB:
            raise ValueError(f"Print at most {MAX_CARDS_PER_JOB} ID cards at a time")

        org = await self._organization(organization_id)
        layout = _read_layout(org.settings)
        orientation = orientation or layout["orientation"]
        sides = sides or layout["sides"]
        symbology = symbology or layout["symbology"]

        rows = await self.db.scalars(
            select(User)
            .where(
                User.organization_id == str(organization_id),
                User.id.in_([str(i) for i in user_ids]),
                User.deleted_at.is_(None),
            )
            .order_by(User.last_name, User.first_name)
        )
        users = rows.all()
        if not users:
            raise ValueError("No members found to print ID cards for")

        ranks = await self._rank_names(organization_id)
        cards = []
        for user in users:
            if is_administrative(user.member_class, user.membership_type):
                title = "Administrative"
            elif user.rank:
                title = ranks.get(user.rank) or user.rank.replace("_", " ").title()
            else:
                title = None
            name = " ".join(filter(None, [user.first_name, user.last_name]))
            cards.append(
                IdCardSpec(
                    name=name or user.username or "Member",
                    barcode_value=member_badge_value(user),
                    title=title,
                    station=user.station,
                    member_number=user.membership_number,
                    member_since=str(user.hire_date.year) if user.hire_date else None,
                    photo=user.photo_url,
                )
            )

        department = IdCardDepartment(
            name=org.name, logo=org.logo, return_lines=_return_lines(org)
        )
        pdf = render_id_cards(cards, department, orientation, sides, symbology)
        return pdf, len(cards)
