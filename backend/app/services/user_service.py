"""
User Service

Business logic for user-related operations.
"""

from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User, UserStatus
from app.schemas.user import (
    MemberDirectoryEntry,
    UserListResponse,
    resolve_profile_visibility,
)


class UserService:
    """Service for user-related business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_users_for_organization(
        self,
        organization_id: UUID,
        include_contact_info: bool = False,
        contact_settings: Optional[Dict[str, Any]] = None,
        honor_member_choice: bool = True,
    ) -> List[UserListResponse]:
        """
        Get all users for an organization

        Args:
            organization_id: The organization ID
            include_contact_info: Whether to include contact information
            contact_settings: Settings dict controlling which contact fields to show

        Returns:
            List of UserListResponse objects with contact info conditionally included
        """
        # Query users with roles
        result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.deleted_at.is_(None))
            .options(selectinload(User.roles))
            .order_by(User.last_name, User.first_name)
        )
        users = result.scalars().all()

        # Convert to response schema
        user_responses = []
        for user in users:
            user_dict = {
                "id": user.id,
                "organization_id": user.organization_id,
                "username": user.username,
                "first_name": user.first_name,
                "middle_name": user.middle_name,
                "last_name": user.last_name,
                "preferred_name": user.preferred_name,
                "full_name": user.full_name,
                "display_name": user.display_name,
                "membership_number": user.membership_number,
                "photo_url": user.photo_url,
                "status": user.status.value if user.status else "active",
                "membership_type": user.membership_type,
                "hire_date": user.hire_date,
                "rank": user.rank,
                "station": user.station,
                "platoon": user.platoon,
                # member_class/member_status/compliance_exempt are also
                # declared on UserListResponse but deliberately left unset:
                # compliance_exempt is a plausibly sensitive field, and
                # populating it here would widen it to every members.view
                # holder. A non-manager's view is served by the narrower
                # GET /users/directory instead (USR-8).
            }

            user_dict.update(
                _visible_contact_fields(
                    user, include_contact_info, contact_settings, honor_member_choice
                )
            )
            user_responses.append(UserListResponse(**user_dict))

        return user_responses

    async def get_directory_for_organization(
        self,
        organization_id: UUID,
        include_contact_info: bool = False,
        contact_settings: Optional[Dict[str, Any]] = None,
    ) -> List[MemberDirectoryEntry]:
        """The member directory: the narrow roster a non-manager is served.

        Always honours each member's own contact-visibility choice — the
        directory is by definition the view of somebody who does not
        administer these records.

        Archived (departed) members are left out (W15-4): a former member is
        not somebody a member looks up, and the coordinators who manage their
        records see them on the management roster (``GET /users``).
        """
        result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.deleted_at.is_(None))
            .where(User.status != UserStatus.ARCHIVED)
            .order_by(User.last_name, User.first_name)
        )
        entries = []
        for user in result.scalars().all():
            entries.append(
                MemberDirectoryEntry(
                    id=user.id,
                    first_name=user.first_name,
                    middle_name=user.middle_name,
                    last_name=user.last_name,
                    preferred_name=user.preferred_name,
                    full_name=user.full_name,
                    display_name=user.display_name,
                    membership_number=user.membership_number,
                    photo_url=user.photo_url,
                    status=user.status.value if user.status else "active",
                    rank=user.rank,
                    **_visible_contact_fields(
                        user, include_contact_info, contact_settings, True
                    ),
                )
            )
        return entries


def _visible_contact_fields(
    user: User,
    include_contact_info: bool,
    contact_settings: Optional[Dict[str, Any]],
    honor_member_choice: bool,
) -> Dict[str, Optional[str]]:
    """Which of email/phone/mobile a roster row may carry.

    The organisation's setting is the ceiling, and within it the member's own
    choice decides — unless the caller is a members-manager
    (`honor_member_choice=False`), who is exempt from the choice on the profile
    endpoint and must be here too, or the management table and its CSV export
    would lose fields leadership keeps. Same rule as
    `_clear_hidden_contact_fields`, so the directory and the profile cannot
    disagree about a field.
    """
    fields: Dict[str, Optional[str]] = {"email": None, "phone": None, "mobile": None}
    if not (include_contact_info and contact_settings):
        return fields
    visibility = contact_settings.get("contact_info_visibility", {})
    member = resolve_profile_visibility(user)
    if visibility.get("show_email", False) and (
        member.email or not honor_member_choice
    ):
        fields["email"] = user.email
    if visibility.get("show_phone", False) and (
        member.phone or not honor_member_choice
    ):
        fields["phone"] = user.phone
    if visibility.get("show_mobile", False) and (
        member.mobile or not honor_member_choice
    ):
        fields["mobile"] = user.mobile
    return fields
