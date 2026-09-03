"""
Who may see a member's work contact details on a member-facing list.

Two decisions combine, and every list that shows one member's email or phone
to another has to make both — the roster, the directory, the forms member
lookup — or the member's "Only you and leadership" choice is only as strong as
the least careful list:

* the organisation's ``contact_info_visibility`` ceiling over the three work
  fields, read fail-closed (an unreadable settings row hides, never reveals);
* the member's own ``profile_visibility`` choice, from which members-managers
  are exempt because they maintain the records the choice governs.

Personal email and the home address have no place on such lists at all; this
policy deliberately covers only ``email``, ``phone`` and ``mobile``.
"""

from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.user import resolve_profile_visibility


@dataclass(frozen=True)
class ContactPolicy:
    show_email: bool
    show_phone: bool
    show_mobile: bool
    honor_member_choice: bool

    def _allowed(self, user: object, field: str, org_allows: bool) -> bool:
        if not org_allows:
            return False
        if not self.honor_member_choice:
            return True
        return bool(getattr(resolve_profile_visibility(user), field))

    def email_for(self, user: object) -> Optional[str]:
        return (
            getattr(user, "email", None)
            if self._allowed(user, "email", self.show_email)
            else None
        )

    def phone_for(self, user: object) -> Optional[str]:
        return (
            getattr(user, "phone", None)
            if self._allowed(user, "phone", self.show_phone)
            else None
        )

    def mobile_for(self, user: object) -> Optional[str]:
        return (
            getattr(user, "mobile", None)
            if self._allowed(user, "mobile", self.show_mobile)
            else None
        )


HIDE_ALL = ContactPolicy(
    show_email=False, show_phone=False, show_mobile=False, honor_member_choice=True
)


async def load_contact_policy(
    db: AsyncSession, organization_id: UUID | str, *, is_manager: bool
) -> ContactPolicy:
    """The policy for a caller reading a member-facing list in this organisation.

    Fails closed: if the organisation's settings cannot be read, nothing is
    shown — the same stance ``GET /users/{id}/with-roles`` takes.
    """
    from app.services.organization_service import OrganizationService

    try:
        settings = await OrganizationService(db).get_organization_settings(
            organization_id
        )
    except Exception as exc:
        logger.warning(
            f"Failed to load contact visibility settings, hiding contact "
            f"details for organization {organization_id}: {exc}"
        )
        return HIDE_ALL

    contact = settings.contact_info_visibility
    if not contact.enabled:
        return ContactPolicy(
            show_email=False,
            show_phone=False,
            show_mobile=False,
            honor_member_choice=not is_manager,
        )
    return ContactPolicy(
        show_email=contact.show_email,
        show_phone=contact.show_phone,
        show_mobile=contact.show_mobile,
        honor_member_choice=not is_manager,
    )
