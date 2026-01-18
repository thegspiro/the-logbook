"""
User Service

Business logic for user-related operations.
"""

from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.models.user import User, Organization
from app.schemas.user import UserListResponse


class UserService:
    """Service for user-related business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_users_for_organization(
        self,
        organization_id: UUID,
        include_contact_info: bool = False,
        contact_settings: Optional[Dict[str, Any]] = None
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
            .where(User.organization_id == organization_id)
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
                "last_name": user.last_name,
                "full_name": user.full_name,
                "badge_number": user.badge_number,
                "photo_url": user.photo_url,
                "status": user.status.value if user.status else "active",
                "hire_date": user.hire_date,
            }

            # Conditionally include contact information based on settings
            if include_contact_info and contact_settings:
                visibility = contact_settings.get("contact_info_visibility", {})

                if visibility.get("show_email", False):
                    user_dict["email"] = user.email

                if visibility.get("show_phone", False):
                    user_dict["phone"] = user.phone

                if visibility.get("show_mobile", False):
                    user_dict["mobile"] = user.mobile
            else:
                # Don't include contact info if not enabled
                user_dict["email"] = None
                user_dict["phone"] = None
                user_dict["mobile"] = None

            user_responses.append(UserListResponse(**user_dict))

        return user_responses

    async def get_user_by_id(
        self,
        user_id: UUID,
        organization_id: UUID
    ) -> Optional[User]:
        """Get a user by ID within an organization"""
        result = await self.db.execute(
            select(User)
            .where(User.id == user_id)
            .where(User.organization_id == organization_id)
            .where(User.deleted_at.is_(None))
            .options(selectinload(User.roles))
        )
        return result.scalar_one_or_none()
