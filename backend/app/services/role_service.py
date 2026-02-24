"""
Role Management Service

Comprehensive service for managing roles, permissions, and user-role assignments.
Includes audit logging for all role-related changes.
"""

from typing import Any, Dict, List, Optional, Set
from uuid import uuid4

from loguru import logger
from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.permissions import DEFAULT_ROLES, get_all_permissions
from app.models.user import Role, User, user_roles


class RoleManagementService:
    """
    Service for comprehensive role management.

    Features:
    - CRUD operations for roles
    - User-role assignments
    - Permission validation
    - Role cloning
    - Audit logging for all changes
    """

    # ============================================
    # Role CRUD Operations
    # ============================================

    async def list_roles(
        self,
        db: AsyncSession,
        organization_id: str,
        include_user_count: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        List all roles for an organization.

        Args:
            organization_id: Organization ID
            include_user_count: Whether to include count of users per role

        Returns:
            List of role dictionaries with optional user counts
        """
        query = (
            select(Role)
            .where(Role.organization_id == str(organization_id))
            .order_by(Role.priority.desc(), Role.name)
        )

        result = await db.execute(query)
        roles = result.scalars().all()

        role_list = []
        for role in roles:
            role_dict = {
                "id": str(role.id),
                "organization_id": role.organization_id,
                "name": role.name,
                "slug": role.slug,
                "description": role.description,
                "permissions": role.permissions or [],
                "is_system": role.is_system,
                "priority": role.priority,
                "created_at": role.created_at,
                "updated_at": role.updated_at,
            }

            if include_user_count:
                count_result = await db.execute(
                    select(func.count())
                    .select_from(user_roles)
                    .where(user_roles.c.position_id == role.id)
                )
                role_dict["user_count"] = count_result.scalar() or 0

            role_list.append(role_dict)

        return role_list

    async def get_role(
        self,
        db: AsyncSession,
        role_id: str,
        organization_id: str,
    ) -> Optional[Role]:
        """Get a specific role by ID."""
        result = await db.execute(
            select(Role).where(
                Role.id == role_id, Role.organization_id == organization_id
            )
        )
        return result.scalar_one_or_none()

    async def get_role_by_slug(
        self,
        db: AsyncSession,
        slug: str,
        organization_id: str,
    ) -> Optional[Role]:
        """Get a role by its slug."""
        result = await db.execute(
            select(Role).where(
                Role.slug == slug, Role.organization_id == organization_id
            )
        )
        return result.scalar_one_or_none()

    async def create_role(
        self,
        db: AsyncSession,
        organization_id: str,
        name: str,
        slug: str,
        permissions: List[str],
        created_by: str,
        description: Optional[str] = None,
        priority: int = 0,
        is_system: bool = False,
    ) -> Role:
        """
        Create a new role.

        Args:
            organization_id: Organization ID
            name: Role display name
            slug: Role slug (unique per organization)
            permissions: List of permission names
            created_by: User ID creating the role
            description: Optional description
            priority: Role priority (higher = more powerful)
            is_system: Whether this is a system role

        Returns:
            Created Role object

        Raises:
            ValueError: If slug already exists or permissions are invalid
        """
        # Check for existing slug
        existing = await self.get_role_by_slug(db, slug, organization_id)
        if existing:
            raise ValueError(f"Role with slug '{slug}' already exists")

        # Validate permissions
        valid_permissions = set(get_all_permissions())
        invalid = set(permissions) - valid_permissions
        if invalid:
            raise ValueError(f"Invalid permissions: {', '.join(invalid)}")

        # Create role
        role = Role(
            id=str(uuid4()),
            organization_id=organization_id,
            name=name,
            slug=slug,
            description=description,
            permissions=permissions,
            is_system=is_system,
            priority=priority,
        )

        db.add(role)
        await db.commit()
        await db.refresh(role)

        # Audit log
        await log_audit_event(
            db=db,
            event_type="role_created",
            event_category="roles",
            severity="info",
            event_data={
                "role_id": str(role.id),
                "role_name": name,
                "role_slug": slug,
                "permissions_count": len(permissions),
            },
            user_id=created_by,
        )

        logger.info(f"Role created: {name} ({slug}) by user {created_by}")

        return role

    async def update_role(
        self,
        db: AsyncSession,
        role_id: str,
        organization_id: str,
        updated_by: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        permissions: Optional[List[str]] = None,
        priority: Optional[int] = None,
    ) -> Role:
        """
        Update a role.

        System roles can only have their permissions and description updated.

        Args:
            role_id: Role ID to update
            organization_id: Organization ID
            updated_by: User ID making the update
            name: New name (ignored for system roles)
            description: New description
            permissions: New permissions list
            priority: New priority (ignored for system roles)

        Returns:
            Updated Role object

        Raises:
            ValueError: If role not found or update is invalid
        """
        role = await self.get_role(db, role_id, organization_id)
        if not role:
            raise ValueError("Role not found")

        changes = {}

        # System roles: only allow description and permissions updates
        if role.is_system:
            if description is not None:
                changes["description"] = {"old": role.description, "new": description}
                role.description = description
            if permissions is not None:
                valid_permissions = set(get_all_permissions())
                invalid = set(permissions) - valid_permissions
                if invalid:
                    raise ValueError(f"Invalid permissions: {', '.join(invalid)}")
                changes["permissions"] = {
                    "old_count": len(role.permissions or []),
                    "new_count": len(permissions),
                }
                role.permissions = permissions
        else:
            # Custom roles: allow all updates
            if name is not None:
                changes["name"] = {"old": role.name, "new": name}
                role.name = name
            if description is not None:
                changes["description"] = {"old": role.description, "new": description}
                role.description = description
            if permissions is not None:
                valid_permissions = set(get_all_permissions())
                invalid = set(permissions) - valid_permissions
                if invalid:
                    raise ValueError(f"Invalid permissions: {', '.join(invalid)}")
                changes["permissions"] = {
                    "old_count": len(role.permissions or []),
                    "new_count": len(permissions),
                }
                role.permissions = permissions
            if priority is not None:
                changes["priority"] = {"old": role.priority, "new": priority}
                role.priority = priority

        await db.commit()
        await db.refresh(role)

        # Audit log
        if changes:
            await log_audit_event(
                db=db,
                event_type="role_updated",
                event_category="roles",
                severity="info",
                event_data={
                    "role_id": str(role.id),
                    "role_name": role.name,
                    "changes": changes,
                },
                user_id=updated_by,
            )

            logger.info(f"Role updated: {role.name} by user {updated_by}")

        return role

    async def delete_role(
        self,
        db: AsyncSession,
        role_id: str,
        organization_id: str,
        deleted_by: str,
    ) -> bool:
        """
        Delete a role.

        System roles cannot be deleted.
        Users with this role will have it removed.

        Args:
            role_id: Role ID to delete
            organization_id: Organization ID
            deleted_by: User ID deleting the role

        Returns:
            True if deleted successfully

        Raises:
            ValueError: If role not found or is a system role
        """
        role = await self.get_role(db, role_id, organization_id)
        if not role:
            raise ValueError("Role not found")

        if role.is_system:
            raise ValueError("System roles cannot be deleted")

        role_name = role.name
        role_slug = role.slug

        # Get count of affected users before deletion
        count_result = await db.execute(
            select(func.count())
            .select_from(user_roles)
            .where(user_roles.c.position_id == str(role_id))
        )
        affected_users = count_result.scalar() or 0

        # Delete role (cascade will remove user_roles entries)
        await db.delete(role)
        await db.commit()

        # Audit log
        await log_audit_event(
            db=db,
            event_type="role_deleted",
            event_category="roles",
            severity="warning",
            event_data={
                "role_id": role_id,
                "role_name": role_name,
                "role_slug": role_slug,
                "affected_users": affected_users,
            },
            user_id=deleted_by,
        )

        logger.info(
            f"Role deleted: {role_name} ({role_slug}) by user {deleted_by}, {affected_users} users affected"
        )

        return True

    async def clone_role(
        self,
        db: AsyncSession,
        source_role_id: str,
        organization_id: str,
        new_name: str,
        new_slug: str,
        created_by: str,
        new_description: Optional[str] = None,
    ) -> Role:
        """
        Clone an existing role with new name and slug.

        Copies all permissions from the source role.

        Args:
            source_role_id: Role ID to clone
            organization_id: Organization ID
            new_name: Name for the new role
            new_slug: Slug for the new role
            created_by: User ID creating the clone
            new_description: Optional new description

        Returns:
            New Role object
        """
        source = await self.get_role(db, source_role_id, organization_id)
        if not source:
            raise ValueError("Source role not found")

        return await self.create_role(
            db=db,
            organization_id=organization_id,
            name=new_name,
            slug=new_slug,
            permissions=source.permissions or [],
            created_by=created_by,
            description=new_description or f"Clone of {source.name}",
            priority=source.priority,
            is_system=False,  # Cloned roles are never system roles
        )

    # ============================================
    # User-Role Assignments
    # ============================================

    async def get_users_with_role(
        self,
        db: AsyncSession,
        role_id: str,
        organization_id: str,
    ) -> List[User]:
        """Get all users that have a specific role."""
        result = await db.execute(
            select(User)
            .join(user_roles, User.id == user_roles.c.user_id)
            .where(
                user_roles.c.position_id == role_id,
                User.organization_id == organization_id,
            )
            .order_by(User.last_name, User.first_name)
        )
        return list(result.scalars().all())

    async def get_user_roles(
        self,
        db: AsyncSession,
        user_id: str,
    ) -> List[Role]:
        """Get all roles assigned to a user."""
        result = await db.execute(
            select(Role)
            .join(user_roles, Role.id == user_roles.c.position_id)
            .where(user_roles.c.user_id == str(user_id))
            .order_by(Role.priority.desc(), Role.name)
        )
        return list(result.scalars().all())

    async def assign_role_to_user(
        self,
        db: AsyncSession,
        user_id: str,
        role_id: str,
        assigned_by: str,
    ) -> bool:
        """
        Assign a role to a user.

        Args:
            user_id: User ID
            role_id: Role ID to assign
            assigned_by: User ID making the assignment

        Returns:
            True if assigned, False if already assigned
        """
        # Check if already assigned
        result = await db.execute(
            select(user_roles).where(
                user_roles.c.user_id == user_id, user_roles.c.position_id == role_id
            )
        )
        if result.first():
            return False  # Already assigned

        # Insert assignment
        await db.execute(
            insert(user_roles).values(
                user_id=user_id,
                position_id=role_id,
                assigned_by=assigned_by,
            )
        )
        await db.commit()

        # Get role name for audit
        role = await db.execute(select(Role.name).where(Role.id == str(role_id)))
        role_name = role.scalar()

        # Audit log
        await log_audit_event(
            db=db,
            event_type="role_assigned",
            event_category="roles",
            severity="info",
            event_data={
                "user_id": user_id,
                "role_id": role_id,
                "role_name": role_name,
            },
            user_id=assigned_by,
        )

        logger.info(f"Role '{role_name}' assigned to user {user_id} by {assigned_by}")

        return True

    async def remove_role_from_user(
        self,
        db: AsyncSession,
        user_id: str,
        role_id: str,
        removed_by: str,
    ) -> bool:
        """
        Remove a role from a user.

        Args:
            user_id: User ID
            role_id: Role ID to remove
            removed_by: User ID making the removal

        Returns:
            True if removed, False if wasn't assigned
        """
        # Get role name for audit before deletion
        role = await db.execute(select(Role.name).where(Role.id == str(role_id)))
        role_name = role.scalar()

        # Delete assignment
        result = await db.execute(
            delete(user_roles).where(
                user_roles.c.user_id == user_id, user_roles.c.position_id == role_id
            )
        )
        await db.commit()

        if result.rowcount == 0:
            return False  # Wasn't assigned

        # Audit log
        await log_audit_event(
            db=db,
            event_type="role_removed",
            event_category="roles",
            severity="info",
            event_data={
                "user_id": user_id,
                "role_id": role_id,
                "role_name": role_name,
            },
            user_id=removed_by,
        )

        logger.info(f"Role '{role_name}' removed from user {user_id} by {removed_by}")

        return True

    async def set_user_roles(
        self,
        db: AsyncSession,
        user_id: str,
        role_ids: List[str],
        set_by: str,
    ) -> List[Role]:
        """
        Set all roles for a user (replaces existing roles).

        Args:
            user_id: User ID
            role_ids: List of role IDs to assign
            set_by: User ID making the change

        Returns:
            List of newly assigned Role objects
        """
        # Get current roles
        current_roles = await self.get_user_roles(db, user_id)
        current_role_ids = {str(r.id) for r in current_roles}

        # Calculate changes
        new_role_ids = set(role_ids)
        to_add = new_role_ids - current_role_ids
        to_remove = current_role_ids - new_role_ids

        # Remove old roles
        for role_id in to_remove:
            await self.remove_role_from_user(db, user_id, role_id, set_by)

        # Add new roles
        for role_id in to_add:
            await self.assign_role_to_user(db, user_id, role_id, set_by)

        # Audit log the bulk change
        if to_add or to_remove:
            await log_audit_event(
                db=db,
                event_type="user_roles_replaced",
                event_category="roles",
                severity="warning",
                event_data={
                    "user_id": user_id,
                    "roles_added": list(to_add),
                    "roles_removed": list(to_remove),
                    "new_role_ids": role_ids,
                },
                user_id=set_by,
            )

        # Return updated roles
        return await self.get_user_roles(db, user_id)

    # ============================================
    # Permission Utilities
    # ============================================

    async def get_user_permissions(
        self,
        db: AsyncSession,
        user_id: str,
    ) -> Set[str]:
        """
        Get all permissions for a user based on their roles.

        Returns:
            Set of permission names
        """
        roles = await self.get_user_roles(db, user_id)

        permissions = set()
        for role in roles:
            if role.permissions:
                permissions.update(role.permissions)

        return permissions

    async def user_has_permission(
        self,
        db: AsyncSession,
        user_id: str,
        permission: str,
    ) -> bool:
        """Check if a user has a specific permission."""
        permissions = await self.get_user_permissions(db, user_id)
        return "*" in permissions or permission in permissions

    async def user_has_any_permission(
        self,
        db: AsyncSession,
        user_id: str,
        permissions: List[str],
    ) -> bool:
        """Check if a user has any of the specified permissions."""
        user_permissions = await self.get_user_permissions(db, user_id)
        return "*" in user_permissions or bool(
            user_permissions.intersection(permissions)
        )

    # ============================================
    # Initialization
    # ============================================

    async def initialize_default_roles(
        self,
        db: AsyncSession,
        organization_id: str,
        created_by: str,
    ) -> List[Role]:
        """
        Initialize default roles for an organization.

        Should be called when creating a new organization.

        Args:
            organization_id: Organization ID
            created_by: User ID creating the roles

        Returns:
            List of created Role objects
        """
        created_roles = []

        for slug, role_def in DEFAULT_ROLES.items():
            # Check if role already exists
            existing = await self.get_role_by_slug(db, slug, organization_id)
            if existing:
                continue

            role = Role(
                id=str(uuid4()),
                organization_id=organization_id,
                name=role_def["name"],
                slug=role_def["slug"],
                description=role_def["description"],
                permissions=role_def["permissions"],
                is_system=role_def["is_system"],
                priority=role_def["priority"],
            )

            db.add(role)
            created_roles.append(role)

        if created_roles:
            await db.commit()
            for role in created_roles:
                await db.refresh(role)

            logger.info(
                f"Initialized {len(created_roles)} default roles for organization {organization_id}"
            )

        return created_roles


# Global service instance
role_service = RoleManagementService()
