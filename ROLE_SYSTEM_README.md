# Role-Based Access Control (RBAC) System

This document describes the comprehensive Role-Based Access Control system implemented in The Logbook.

## Overview

The RBAC system allows fine-grained control over what users can see and do within the platform. It includes:

- **Default System Roles**: Pre-configured roles for fire department leadership
- **Custom Roles**: Create organization-specific roles with custom permissions
- **Permission System**: Granular permissions organized by category
- **Member Administration**: Assign roles to members through an intuitive UI

## Default System Roles

The following roles are automatically created for each organization:

### Leadership Roles

1. **IT Administrator** (Priority: 100)
   - Full system access
   - All permissions enabled
   - Cannot be deleted

2. **Chief** (Priority: 95)
   - Full administrative access (equal authority to President)
   - Can manage all aspects except IT-specific tasks
   - Can create and manage roles
   - Can manage all modules including training, compliance, scheduling, inventory
   - Cannot be deleted

3. **President** (Priority: 95)
   - Full administrative access (equal authority to Chief)
   - Can manage all aspects except IT-specific tasks
   - Can create and manage roles
   - Can manage all modules including training, compliance, scheduling, inventory
   - Cannot be deleted

4. **Assistant Chief** (Priority: 90)
   - Broad administrative access
   - Can manage members and most modules
   - Cannot create roles
   - Cannot be deleted

5. **Vice President** (Priority: 80)
   - Similar to President but cannot edit organization settings
   - Cannot be deleted

6. **Secretary** (Priority: 75)
   - Record-keeping access
   - Can manage contact information visibility
   - Can manage meetings and compliance records
   - Cannot be deleted

7. **Assistant Secretary** (Priority: 70)
   - Assists the secretary
   - View-only for most areas
   - Can manage meetings
   - Cannot be deleted

8. **Member** (Priority: 10)
   - Basic member access
   - Can view members, training, compliance, schedules
   - Cannot modify most settings
   - Cannot be deleted

## Permission Categories

Permissions are organized into the following categories:

### Users & Members
- `users.view` - View user list
- `users.create` - Create new users
- `users.edit` - Edit user information
- `users.delete` - Delete users
- `users.view_contact` - View contact information
- `members.view` - View member list
- `members.manage` - Manage member profiles
- `members.assign_roles` - Assign roles to members

### Roles
- `roles.view` - View roles
- `roles.create` - Create new roles
- `roles.edit` - Edit roles
- `roles.delete` - Delete custom roles
- `roles.manage_permissions` - Manage role permissions

### Organization & Settings
- `organization.view` - View organization info
- `organization.edit` - Edit organization info
- `settings.view` - View settings
- `settings.edit` - Edit settings
- `settings.manage_contact_visibility` - Control contact info display

### Modules
Each module has view and manage permissions:
- Training (`training.view`, `training.manage`)
- Compliance (`compliance.view`, `compliance.manage`)
- Scheduling (`scheduling.view`, `scheduling.manage`)
- Inventory (`inventory.view`, `inventory.manage`)
- Meetings (`meetings.view`, `meetings.manage`)
- Elections (`elections.view`, `elections.manage`)
- Fundraising (`fundraising.view`, `fundraising.manage`)
- Audit (`audit.view`, `audit.export`)

## Using the System

### Accessing Admin Pages

The following pages are automatically visible to users with admin roles:

- **Members Admin** (`/admin/members`)
  - Assign roles to members
  - View all members with their current roles
  - Accessible to: IT Admin, Chief, Assistant Chief, President, Vice President, Secretary, Assistant Secretary

- **Role Management** (`/admin/roles`)
  - Create custom roles
  - Edit role permissions
  - Delete custom roles (system roles cannot be deleted)
  - Accessible to: IT Admin, Chief, President (roles with `roles.create` permission)

### Creating Custom Roles

1. Navigate to **Role Management**
2. Click "Create Custom Role"
3. Fill in:
   - **Name**: Display name for the role
   - **Slug**: Unique identifier (lowercase, underscores)
   - **Description**: What this role is for
   - **Priority**: 0-100 (higher = more authority)
   - **Permissions**: Select from available permissions by category
4. Click "Create Role"

### Assigning Roles to Members

1. Navigate to **Members Admin**
2. Find the member in the list
3. Click "Manage Roles"
4. Check/uncheck roles to assign
5. Click "Save Changes"

**Note**: A user can have multiple roles. Their effective permissions are the union of all their roles' permissions.

### Editing System Roles

System roles (indicated by a blue "System Role" badge) have restrictions:
- **Name and priority cannot be changed**
- **Permissions can be modified** to suit your organization
- **Cannot be deleted**

This allows you to customize permissions while maintaining the core role structure.

## Backend API

### Endpoints

**Roles**:
- `GET /api/v1/roles` - List all roles
- `GET /api/v1/roles/{id}` - Get specific role
- `POST /api/v1/roles` - Create custom role
- `PATCH /api/v1/roles/{id}` - Update role
- `DELETE /api/v1/roles/{id}` - Delete custom role
- `GET /api/v1/roles/permissions` - List all permissions
- `GET /api/v1/roles/permissions/by-category` - Permissions grouped by category

**User Roles**:
- `GET /api/v1/users/with-roles` - List users with roles
- `GET /api/v1/users/{id}/roles` - Get user's roles
- `PUT /api/v1/users/{id}/roles` - Assign roles (replaces all)
- `POST /api/v1/users/{id}/roles/{role_id}` - Add single role
- `DELETE /api/v1/users/{id}/roles/{role_id}` - Remove single role

### Database Seeding

To seed the database with default roles:

```bash
cd backend
python -m app.core.seed
```

This will:
1. Create a test organization (if it doesn't exist)
2. Create all default system roles with proper permissions

## Permission Checking (Future Enhancement)

Once authentication is implemented, the system will enforce permissions using dependency injection:

```python
from app.api.dependencies import require_permission

@router.get("/admin/users")
async def admin_route(
    user: User = Depends(require_permission("users.manage"))
):
    # Only users with users.manage permission can access
    ...
```

## Best Practices

1. **Start with System Roles**: Assign system roles that closely match user responsibilities
2. **Create Custom Roles Sparingly**: Only create custom roles for unique organizational needs
3. **Use Priority Wisely**: Keep priority differences meaningful (e.g., 10-point increments)
4. **Document Custom Roles**: Add clear descriptions to custom roles
5. **Regular Audits**: Periodically review role assignments
6. **Principle of Least Privilege**: Give users only the permissions they need

## Extending the System

### Adding New Permissions

1. Add permission constant in `backend/app/core/permissions.py`:
```python
MY_NEW_PERMISSION = Permission(
    "module.action",
    "Description of what this allows",
    PermissionCategory.MODULE
)
```

2. Add to `ALL_PERMISSIONS` list

3. Optionally add to default roles in `DEFAULT_ROLES`

### Adding New Modules

When adding new modules:
1. Create view and manage permissions
2. Add to permission categories
3. Update default roles to include appropriate permissions
4. Update frontend to check permissions before showing module UI

## Technical Architecture

- **Backend**: Python/FastAPI with SQLAlchemy
- **Database**: PostgreSQL with JSONB for flexible permission storage
- **Frontend**: React/TypeScript with Tailwind CSS
- **Permission Model**: Role-based with additive permissions (union of all assigned roles)

## Future Enhancements

- [ ] Permission groups (collections of related permissions)
- [ ] Temporary role assignments with expiration
- [ ] Role assignment audit trail
- [ ] Bulk role assignment
- [ ] Permission delegation (users granting temporary permissions)
- [ ] Role templates for quick setup
