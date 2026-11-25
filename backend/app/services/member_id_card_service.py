"""
Printable CR80 member ID cards.

Turns a set of members into a card-printer PDF (see
:mod:`app.utils.id_card_renderer`) and keeps the department's chosen card
layout — orientation, one or two sides, barcode or QR, and whether the card
carries the member's certifications — in
``organization.settings["id_card_print"]``. The layout is a department
decision rather than an officer's: it follows the badge holders the
department bought and the printer it owns, so whoever prints next gets the
same card.
"""

import copy
from dataclasses import dataclass
from datetime import date
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.operational_rank import OperationalRank
from app.models.training import RequirementType, TrainingRequirement
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User
from app.services.label_service import member_badge_value
from app.services.member_badge_service import MemberBadgeService
from app.services.member_service_history_service import (
    MemberServiceHistoryService,
)
from app.services.training_compliance import (
    ComplianceGrading,
    _load_compliance_config,
    evaluate_member_requirement_detail,
    load_graded_records,
    member_join_date,
)
from app.utils.id_card_renderer import (
    ORIENTATION_LANDSCAPE,
    SIDES_FRONT,
    IdCardCertification,
    IdCardDepartment,
    IdCardSpec,
    render_id_cards,
    validate_orientation,
    validate_sides,
)
from app.utils.label_renderer import SYMBOLOGY_CODE128, validate_symbology
from app.utils.membership import is_administrative
from app.utils.org_timezone import resolve_org_today

SETTINGS_KEY = "id_card_print"

# What a department that has never chosen gets: the card every single-sided
# printer can produce, with the barcode every scanner in the app already reads.
# Certifications are off until an officer turns them on (owner decision,
# 2026-11-24): a printed date goes stale the day a certificate is renewed, so
# a department opts in knowingly, and no department's next print run changes
# without anyone asking for it.
DEFAULT_LAYOUT: Dict[str, Any] = {
    "orientation": ORIENTATION_LANDSCAPE,
    "sides": SIDES_FRONT,
    "symbology": SYMBOLOGY_CODE128,
    "certifications": False,
}

# A department prints its roster in one go when it first adopts cards. This is
# well above any volunteer department's roster, and keeps a single request
# from tying up a worker rendering thousands of pages.
MAX_CARDS_PER_JOB = 500


def _read_layout(settings: Any) -> Dict[str, Any]:
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
    # Only a stored true turns it on: a layout saved before the option
    # existed, or a value somebody typed wrong, keeps today's card.
    layout["certifications"] = stored.get("certifications") is True
    return layout


@dataclass(frozen=True)
class _CardCertificate:
    name: str
    state: str  # "on_file" | "expired" | "missing"
    expiry: Optional[date]


def _card_date(day: date) -> str:
    """ "Mar 14, 2027", as the app writes a calendar date."""
    return f"{day:%b} {day.day}, {day.year}"


def _valid_through(certificates: List[_CardCertificate]) -> Optional[date]:
    """The soonest expiry among the certificates held now.

    The date the digital card shows as "Card valid through" (owner decision,
    2026-11-23); ``cardValidThrough`` in frontend/src/utils/certificationState.ts
    is the same rule over the same server grading. A lapsed certificate is not
    held, and one that never expires sets no date.
    """
    held = [c.expiry for c in certificates if c.state == "on_file" and c.expiry]
    return min(held) if held else None


def _card_certifications(
    certificates: List[_CardCertificate],
) -> List[IdCardCertification]:
    """The back-of-card lines, in the words the digital card uses."""
    lines = []
    for cert in certificates:
        if cert.state == "on_file":
            status = f"Exp {_card_date(cert.expiry)}" if cert.expiry else "On file"
        elif cert.state == "expired" and cert.expiry:
            status = f"Expired {_card_date(cert.expiry)}"
        elif cert.state == "expired":
            status = "Expired"
        else:
            status = "Not recorded"
        lines.append(IdCardCertification(name=cert.name, status=status))
    return lines


def _year(day: Optional[date]) -> Optional[str]:
    return str(day.year) if day else None


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

    async def get_layout(self, organization_id) -> Dict[str, Any]:
        org = await self._organization(organization_id)
        return _read_layout(org.settings)

    async def save_layout(
        self,
        organization_id,
        orientation: str,
        sides: str,
        symbology: str,
        certifications: bool = False,
    ) -> Dict[str, Any]:
        layout: Dict[str, Any] = {
            "orientation": validate_orientation(orientation),
            "sides": validate_sides(sides),
            "symbology": validate_symbology(symbology),
            "certifications": bool(certifications),
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

    async def _certificates_by_user(
        self, organization_id, users: List[User]
    ) -> Dict[str, List[_CardCertificate]]:
        """Each member's certification requirements, graded.

        Graded by the compliance matrix's own grader — the same requirement
        set per member (``ComplianceGrading.for_member``), the same records
        (``load_graded_records``) and the same evaluation — so a printed card
        cannot disagree with the matrix or the digital card. A member the
        matrix does not grade (a former member, or one exempt from
        compliance) gets no certifications on the card.
        """
        org_id = str(organization_id)
        requirements = list(
            await self.db.scalars(
                select(TrainingRequirement)
                .where(
                    TrainingRequirement.organization_id == org_id,
                    TrainingRequirement.active == True,  # noqa: E712
                )
                .order_by(TrainingRequirement.name)
            )
        )
        graded = [
            u
            for u in users
            if u.status in ACTIVE_ACCOUNT_STATUSES and not u.compliance_exempt
        ]
        if not requirements or not graded:
            return {}
        today = await resolve_org_today(self.db, org_id)
        grading = ComplianceGrading.from_config(
            await _load_compliance_config(self.db, org_id)
        )
        records_by_user: Dict[str, list] = {}
        for record in await load_graded_records(
            self.db,
            org_id,
            [u.id for u in graded],
            requirements,
            today,
            grading.include_current_month,
        ):
            records_by_user.setdefault(str(record.user_id), []).append(record)

        result: Dict[str, List[_CardCertificate]] = {}
        for user in graded:
            certificates = []
            for req in grading.for_member(user, requirements).requirements:
                req_type = getattr(req.requirement_type, "value", req.requirement_type)
                if req_type != RequirementType.CERTIFICATION.value:
                    continue
                ev = evaluate_member_requirement_detail(
                    req,
                    records_by_user.get(str(user.id), []),
                    today,
                    org_include_current_month=grading.include_current_month,
                    join_date=member_join_date(user),
                )
                expiry = date.fromisoformat(ev.expiry_date) if ev.expiry_date else None
                if ev.status == "completed":
                    state = "on_file"
                elif ev.status == "expired":
                    state = "expired"
                else:
                    state = "missing"
                certificates.append(_CardCertificate(req.name, state, expiry))
            result[str(user.id)] = certificates
        return result

    async def generate(
        self,
        organization_id,
        user_ids: List[str],
        orientation: Optional[str] = None,
        sides: Optional[str] = None,
        symbology: Optional[str] = None,
        certifications: Optional[bool] = None,
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
        if certifications is None:
            certifications = bool(layout["certifications"])

        rows = await self.db.scalars(
            select(User)
            .where(
                User.organization_id == str(organization_id),
                User.id.in_([str(i) for i in user_ids]),
                User.deleted_at.is_(None),
            )
            # Compliance profiles match on positions, a lazy relationship.
            .options(selectinload(User.positions))
            .order_by(User.last_name, User.first_name)
        )
        users = rows.all()
        if not users:
            raise ValueError("No members found to print ID cards for")
        await MemberBadgeService(self.db).ensure_codes(users)

        ranks = await self._rank_names(organization_id)
        # "Member since" is the year credited service runs from (owner
        # decision 2026-11-01), the same date the digital card shows.
        since = await MemberServiceHistoryService(self.db).service_since_by_user(
            organization_id, users
        )
        certificates = (
            await self._certificates_by_user(organization_id, list(users))
            if certifications
            else {}
        )
        cards = []
        for user in users:
            held = certificates.get(str(user.id), [])
            valid_through = _valid_through(held)
            if is_administrative(user.member_class, user.membership_type):
                title = "Administrative"
            elif user.rank:
                title = ranks.get(user.rank) or user.rank.replace("_", " ").title()
            else:
                title = None
            # The name the member goes by, as the digital card shows it, so the
            # printed card and the phone agree.
            name = user.display_name
            cards.append(
                IdCardSpec(
                    name=name or user.username or "Member",
                    barcode_value=member_badge_value(user),
                    title=title,
                    station=user.station,
                    member_number=user.membership_number,
                    member_since=_year(since.get(str(user.id))),
                    photo=user.photo_url,
                    valid_through=_card_date(valid_through) if valid_through else None,
                    certifications=_card_certifications(held),
                )
            )

        department = IdCardDepartment(
            name=org.name, logo=org.logo, return_lines=_return_lines(org)
        )
        pdf = render_id_cards(cards, department, orientation, sides, symbology)
        return pdf, len(cards)
