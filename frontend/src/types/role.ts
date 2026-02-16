/**
 * Role and Permission type definitions
 */

import type { NotificationPreferences } from './user';

export interface Role {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description?: string;
  permissions: string[];
  is_system: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface Permission {
  name: string;
  description: string;
  category: string;
}

export interface PermissionCategory {
  category: string;
  permissions: Permission[];
}

export interface UserWithRoles {
  id: string;
  organization_id: string;
  username: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  badge_number?: string;
  membership_id?: string;
  phone?: string;
  mobile?: string;
  photo_url?: string;
  status: string;
  hire_date?: string;
  notification_preferences?: NotificationPreferences;
  roles: Role[];
}

export interface RoleWithUserCount extends Role {
  user_count: number;
}

export interface RoleUserItem {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  is_active: boolean;
}

export interface RoleUsersResponse {
  role_id: string;
  role_name: string;
  users: RoleUserItem[];
  total_count: number;
}

export interface RoleAssignment {
  role_ids: string[];
}

export interface UserRoleResponse {
  user_id: string;
  username: string;
  full_name?: string;
  roles: Role[];
}
