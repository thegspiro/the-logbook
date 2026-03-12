import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock apiClient BEFORE importing the service
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    put: (...args: unknown[]) => mockPut(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
    defaults: { baseURL: '/api/v1' },
  },
}));

// Import services AFTER mocks
import { userService, organizationService, roleService } from './userServices';

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// userService
// ============================================================================
describe('userService', () => {
  // ── getUsers ─────────────────────────────────────────────────────────
  describe('getUsers', () => {
    it('should GET /users and return an array of users', async () => {
      const users = [
        { id: 'u1', username: 'alice', email: 'alice@example.com' },
        { id: 'u2', username: 'bob', email: 'bob@example.com' },
      ];
      mockGet.mockResolvedValue({ data: users });

      const result = await userService.getUsers();

      expect(mockGet).toHaveBeenCalledWith('/users');
      expect(result).toEqual(users);
    });

    it('should propagate API errors', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      await expect(userService.getUsers()).rejects.toThrow('Network error');
    });
  });

  // ── checkContactInfoEnabled ──────────────────────────────────────────
  describe('checkContactInfoEnabled', () => {
    it('should GET /users/contact-info-enabled and return settings', async () => {
      const settings = { phone_visible: true, email_visible: false };
      mockGet.mockResolvedValue({ data: settings });

      const result = await userService.checkContactInfoEnabled();

      expect(mockGet).toHaveBeenCalledWith('/users/contact-info-enabled');
      expect(result).toEqual(settings);
    });
  });

  // ── getUsersWithRoles ────────────────────────────────────────────────
  describe('getUsersWithRoles', () => {
    it('should GET /users/with-roles and return users with roles', async () => {
      const usersWithRoles = [
        { id: 'u1', username: 'alice', roles: [{ id: 'r1', name: 'Admin' }] },
      ];
      mockGet.mockResolvedValue({ data: usersWithRoles });

      const result = await userService.getUsersWithRoles();

      expect(mockGet).toHaveBeenCalledWith('/users/with-roles');
      expect(result).toEqual(usersWithRoles);
    });
  });

  // ── getUserWithRoles ─────────────────────────────────────────────────
  describe('getUserWithRoles', () => {
    it('should GET /users/:id/with-roles and return user with roles', async () => {
      const userWithRoles = { id: 'u1', username: 'alice', roles: [{ id: 'r1', name: 'Admin' }] };
      mockGet.mockResolvedValue({ data: userWithRoles });

      const result = await userService.getUserWithRoles('u1');

      expect(mockGet).toHaveBeenCalledWith('/users/u1/with-roles');
      expect(result).toEqual(userWithRoles);
    });
  });

  // ── getUserRoles ─────────────────────────────────────────────────────
  describe('getUserRoles', () => {
    it('should GET /users/:id/roles and return role response', async () => {
      const roleResponse = { user_id: 'u1', roles: ['admin', 'member'] };
      mockGet.mockResolvedValue({ data: roleResponse });

      const result = await userService.getUserRoles('u1');

      expect(mockGet).toHaveBeenCalledWith('/users/u1/roles');
      expect(result).toEqual(roleResponse);
    });
  });

  // ── assignUserRoles ──────────────────────────────────────────────────
  describe('assignUserRoles', () => {
    it('should PUT role_ids to /users/:id/roles', async () => {
      const roleResponse = { user_id: 'u1', roles: ['admin'] };
      mockPut.mockResolvedValue({ data: roleResponse });

      const result = await userService.assignUserRoles('u1', ['role-1', 'role-2']);

      expect(mockPut).toHaveBeenCalledWith('/users/u1/roles', {
        role_ids: ['role-1', 'role-2'],
      });
      expect(result).toEqual(roleResponse);
    });
  });

  // ── addRoleToUser ────────────────────────────────────────────────────
  describe('addRoleToUser', () => {
    it('should POST to /users/:id/roles/:roleId', async () => {
      const roleResponse = { user_id: 'u1', roles: ['admin', 'editor'] };
      mockPost.mockResolvedValue({ data: roleResponse });

      const result = await userService.addRoleToUser('u1', 'role-2');

      expect(mockPost).toHaveBeenCalledWith('/users/u1/roles/role-2');
      expect(result).toEqual(roleResponse);
    });
  });

  // ── removeRoleFromUser ───────────────────────────────────────────────
  describe('removeRoleFromUser', () => {
    it('should DELETE /users/:id/roles/:roleId', async () => {
      const roleResponse = { user_id: 'u1', roles: ['member'] };
      mockDelete.mockResolvedValue({ data: roleResponse });

      const result = await userService.removeRoleFromUser('u1', 'role-1');

      expect(mockDelete).toHaveBeenCalledWith('/users/u1/roles/role-1');
      expect(result).toEqual(roleResponse);
    });
  });

  // ── updateContactInfo ────────────────────────────────────────────────
  describe('updateContactInfo', () => {
    it('should PATCH contact info to /users/:id/contact-info', async () => {
      const updatedUser = { id: 'u1', phone: '555-1234' };
      mockPatch.mockResolvedValue({ data: updatedUser });

      const contactInfo = { phone: '555-1234', email: 'new@example.com' };
      const result = await userService.updateContactInfo('u1', contactInfo as never);

      expect(mockPatch).toHaveBeenCalledWith('/users/u1/contact-info', contactInfo);
      expect(result).toEqual(updatedUser);
    });
  });

  // ── updateUserProfile ────────────────────────────────────────────────
  describe('updateUserProfile', () => {
    it('should PATCH profile data to /users/:id/profile', async () => {
      const updatedUser = { id: 'u1', first_name: 'Jane' };
      mockPatch.mockResolvedValue({ data: updatedUser });

      const profileData = { first_name: 'Jane', last_name: 'Smith' };
      const result = await userService.updateUserProfile('u1', profileData as never);

      expect(mockPatch).toHaveBeenCalledWith('/users/u1/profile', profileData);
      expect(result).toEqual(updatedUser);
    });
  });

  // ── deleteUser ───────────────────────────────────────────────────────
  describe('deleteUser', () => {
    it('should DELETE /users/:id', async () => {
      mockDelete.mockResolvedValue({ data: undefined });

      await userService.deleteUser('u1');

      expect(mockDelete).toHaveBeenCalledWith('/users/u1');
    });

    it('should propagate errors when deletion fails', async () => {
      mockDelete.mockRejectedValue(new Error('Forbidden'));

      await expect(userService.deleteUser('u1')).rejects.toThrow('Forbidden');
    });
  });

  // ── createMember ─────────────────────────────────────────────────────
  describe('createMember', () => {
    it('should POST member data to /users and return user with roles', async () => {
      const createdUser = { id: 'u-new', username: 'newmember', roles: [] };
      mockPost.mockResolvedValue({ data: createdUser });

      const memberData = {
        username: 'newmember',
        email: 'new@example.com',
        first_name: 'New',
        last_name: 'Member',
        password: 'Secure123!',
        send_welcome_email: true,
      };
      const result = await userService.createMember(memberData);

      expect(mockPost).toHaveBeenCalledWith('/users', memberData);
      expect(result).toEqual(createdUser);
    });

    it('should handle optional fields', async () => {
      const createdUser = { id: 'u-new', username: 'minimal' };
      mockPost.mockResolvedValue({ data: createdUser });

      const memberData = {
        username: 'minimal',
        email: 'minimal@example.com',
        first_name: 'Min',
        last_name: 'Imal',
      };
      const result = await userService.createMember(memberData);

      expect(mockPost).toHaveBeenCalledWith('/users', memberData);
      expect(result).toEqual(createdUser);
    });
  });

  // ── adminResetPassword ───────────────────────────────────────────────
  describe('adminResetPassword', () => {
    it('should POST new password to /users/:id/reset-password with default force_change', async () => {
      const response = { message: 'Password reset successfully' };
      mockPost.mockResolvedValue({ data: response });

      const result = await userService.adminResetPassword('u1', 'NewPass123!');

      expect(mockPost).toHaveBeenCalledWith('/users/u1/reset-password', {
        new_password: 'NewPass123!',
        force_change: true,
      });
      expect(result).toEqual(response);
    });

    it('should accept forceChange=false', async () => {
      const response = { message: 'Password reset successfully' };
      mockPost.mockResolvedValue({ data: response });

      await userService.adminResetPassword('u1', 'NewPass123!', false);

      expect(mockPost).toHaveBeenCalledWith('/users/u1/reset-password', {
        new_password: 'NewPass123!',
        force_change: false,
      });
    });
  });

  // ── getNotificationPreferences ───────────────────────────────────────
  describe('getNotificationPreferences', () => {
    it('should GET /users/:id/with-roles and return notification preferences', async () => {
      const prefs = {
        email: true,
        sms: true,
        push: false,
        email_notifications: true,
        event_reminders: true,
        training_reminders: false,
        announcement_notifications: true,
      };
      mockGet.mockResolvedValue({ data: { notification_preferences: prefs } });

      const result = await userService.getNotificationPreferences('u1');

      expect(mockGet).toHaveBeenCalledWith('/users/u1/with-roles');
      expect(result).toEqual(prefs);
    });

    it('should return defaults when notification_preferences is null', async () => {
      mockGet.mockResolvedValue({ data: { notification_preferences: null } });

      const result = await userService.getNotificationPreferences('u1');

      expect(result).toEqual({
        email: true,
        sms: false,
        push: false,
        email_notifications: true,
        event_reminders: true,
        training_reminders: true,
        announcement_notifications: true,
      });
    });

    it('should return defaults when notification_preferences is undefined', async () => {
      mockGet.mockResolvedValue({ data: {} });

      const result = await userService.getNotificationPreferences('u1');

      expect(result).toEqual({
        email: true,
        sms: false,
        push: false,
        email_notifications: true,
        event_reminders: true,
        training_reminders: true,
        announcement_notifications: true,
      });
    });
  });

  // ── updateNotificationPreferences ────────────────────────────────────
  describe('updateNotificationPreferences', () => {
    it('should PATCH notification preferences to /users/:id/contact-info', async () => {
      mockPatch.mockResolvedValue({ data: undefined });

      const prefs = { email: false, sms: true };
      await userService.updateNotificationPreferences('u1', prefs);

      expect(mockPatch).toHaveBeenCalledWith('/users/u1/contact-info', {
        notification_preferences: prefs,
      });
    });
  });

  // ── getDeletionImpact ────────────────────────────────────────────────
  describe('getDeletionImpact', () => {
    it('should GET /users/:id/deletion-impact and return impact data', async () => {
      const impact = { events_count: 5, documents_count: 2 };
      mockGet.mockResolvedValue({ data: impact });

      const result = await userService.getDeletionImpact('u1');

      expect(mockGet).toHaveBeenCalledWith('/users/u1/deletion-impact');
      expect(result).toEqual(impact);
    });
  });

  // ── deleteUserWithMode ───────────────────────────────────────────────
  describe('deleteUserWithMode', () => {
    it('should DELETE /users/:id with hard=false by default', async () => {
      mockDelete.mockResolvedValue({ data: undefined });

      await userService.deleteUserWithMode('u1');

      expect(mockDelete).toHaveBeenCalledWith('/users/u1', { params: { hard: false } });
    });

    it('should DELETE /users/:id with hard=true when specified', async () => {
      mockDelete.mockResolvedValue({ data: undefined });

      await userService.deleteUserWithMode('u1', true);

      expect(mockDelete).toHaveBeenCalledWith('/users/u1', { params: { hard: true } });
    });
  });

  // ── uploadPhoto ──────────────────────────────────────────────────────
  describe('uploadPhoto', () => {
    it('should POST FormData to /users/:id/photo with multipart headers', async () => {
      const response = { message: 'Photo uploaded', photo_url: '/photos/u1.jpg' };
      mockPost.mockResolvedValue({ data: response });

      const file = new File(['photo-data'], 'avatar.jpg', { type: 'image/jpeg' });
      const result = await userService.uploadPhoto('u1', file);

      expect(mockPost).toHaveBeenCalledWith(
        '/users/u1/photo',
        expect.any(FormData),
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      expect(result).toEqual(response);

      // Verify the FormData contains the file
      const calledFormData = mockPost.mock.calls[0]?.[1] as FormData;
      expect(calledFormData.get('file')).toBe(file);
    });
  });

  // ── deletePhoto ──────────────────────────────────────────────────────
  describe('deletePhoto', () => {
    it('should DELETE /users/:id/photo', async () => {
      mockDelete.mockResolvedValue({ data: undefined });

      await userService.deletePhoto('u1');

      expect(mockDelete).toHaveBeenCalledWith('/users/u1/photo');
    });
  });

  // ── changeMembershipType ─────────────────────────────────────────────
  describe('changeMembershipType', () => {
    it('should PATCH membership type to /users/:id/membership-type', async () => {
      const response = { id: 'u1', membership_type: 'honorary' };
      mockPatch.mockResolvedValue({ data: response });

      const result = await userService.changeMembershipType('u1', 'honorary', 'Distinguished service');

      expect(mockPatch).toHaveBeenCalledWith('/users/u1/membership-type', {
        membership_type: 'honorary',
        reason: 'Distinguished service',
      });
      expect(result).toEqual(response);
    });

    it('should handle missing reason', async () => {
      const response = { id: 'u1', membership_type: 'active' };
      mockPatch.mockResolvedValue({ data: response });

      await userService.changeMembershipType('u1', 'active');

      expect(mockPatch).toHaveBeenCalledWith('/users/u1/membership-type', {
        membership_type: 'active',
        reason: undefined,
      });
    });
  });

  // ── getMemberAuditHistory ────────────────────────────────────────────
  describe('getMemberAuditHistory', () => {
    it('should GET /users/:id/audit-history with default params', async () => {
      const auditEntries = [{ id: 'a1', event_type: 'login', timestamp: '2024-01-01' }];
      mockGet.mockResolvedValue({ data: auditEntries });

      const result = await userService.getMemberAuditHistory('u1');

      expect(mockGet).toHaveBeenCalledWith('/users/u1/audit-history', {
        params: { page: 1, page_size: 50, event_type: undefined },
      });
      expect(result).toEqual(auditEntries);
    });

    it('should pass custom page and eventType params', async () => {
      mockGet.mockResolvedValue({ data: [] });

      await userService.getMemberAuditHistory('u1', 3, 'password_change');

      expect(mockGet).toHaveBeenCalledWith('/users/u1/audit-history', {
        params: { page: 3, page_size: 50, event_type: 'password_change' },
      });
    });

    it('should convert empty string eventType to undefined', async () => {
      mockGet.mockResolvedValue({ data: [] });

      await userService.getMemberAuditHistory('u1', 1, '');

      expect(mockGet).toHaveBeenCalledWith('/users/u1/audit-history', {
        params: { page: 1, page_size: 50, event_type: undefined },
      });
    });
  });
});

// ============================================================================
// organizationService
// ============================================================================
describe('organizationService', () => {
  // ── getSettings ──────────────────────────────────────────────────────
  describe('getSettings', () => {
    it('should GET /organization/settings and return settings', async () => {
      const settings = {
        contact_info_visibility: { phone_visible: true },
        email_service: { provider: 'smtp' },
      };
      mockGet.mockResolvedValue({ data: settings });

      const result = await organizationService.getSettings();

      expect(mockGet).toHaveBeenCalledWith('/organization/settings');
      expect(result).toEqual(settings);
    });
  });

  // ── updateContactInfoSettings ────────────────────────────────────────
  describe('updateContactInfoSettings', () => {
    it('should PATCH to /organization/settings/contact-info', async () => {
      const updated = { phone_visible: false, email_visible: true };
      mockPatch.mockResolvedValue({ data: updated });

      const result = await organizationService.updateContactInfoSettings(updated as never);

      expect(mockPatch).toHaveBeenCalledWith('/organization/settings/contact-info', updated);
      expect(result).toEqual(updated);
    });
  });

  // ── updateEmailSettings ──────────────────────────────────────────────
  describe('updateEmailSettings', () => {
    it('should PATCH to /organization/settings/email', async () => {
      const settings = { provider: 'sendgrid', api_key: 'sg-key' };
      mockPatch.mockResolvedValue({ data: settings });

      const result = await organizationService.updateEmailSettings(settings as never);

      expect(mockPatch).toHaveBeenCalledWith('/organization/settings/email', settings);
      expect(result).toEqual(settings);
    });
  });

  // ── updateFileStorageSettings ────────────────────────────────────────
  describe('updateFileStorageSettings', () => {
    it('should PATCH to /organization/settings/file-storage', async () => {
      const settings = { provider: 'minio', bucket: 'uploads' };
      mockPatch.mockResolvedValue({ data: settings });

      const result = await organizationService.updateFileStorageSettings(settings as never);

      expect(mockPatch).toHaveBeenCalledWith('/organization/settings/file-storage', settings);
      expect(result).toEqual(settings);
    });
  });

  // ── updateAuthSettings ───────────────────────────────────────────────
  describe('updateAuthSettings', () => {
    it('should PATCH to /organization/settings/auth', async () => {
      const settings = { mfa_required: true, session_timeout: 60 };
      mockPatch.mockResolvedValue({ data: settings });

      const result = await organizationService.updateAuthSettings(settings as never);

      expect(mockPatch).toHaveBeenCalledWith('/organization/settings/auth', settings);
      expect(result).toEqual(settings);
    });
  });

  // ── updateMembershipIdSettings ───────────────────────────────────────
  describe('updateMembershipIdSettings', () => {
    it('should PATCH to /organization/settings/membership-id', async () => {
      const settings = { enabled: true, prefix: 'MBR', next_number: 100 };
      mockPatch.mockResolvedValue({ data: settings });

      const result = await organizationService.updateMembershipIdSettings(settings as never);

      expect(mockPatch).toHaveBeenCalledWith('/organization/settings/membership-id', settings);
      expect(result).toEqual(settings);
    });
  });

  // ── getEnabledModules ────────────────────────────────────────────────
  describe('getEnabledModules', () => {
    it('should GET /organization/modules and return enabled modules', async () => {
      const response = {
        enabled_modules: ['training', 'scheduling'],
        module_settings: { training: true, scheduling: true, inventory: false },
      };
      mockGet.mockResolvedValue({ data: response });

      const result = await organizationService.getEnabledModules();

      expect(mockGet).toHaveBeenCalledWith('/organization/modules');
      expect(result).toEqual(response);
    });
  });

  // ── updateModuleSettings ─────────────────────────────────────────────
  describe('updateModuleSettings', () => {
    it('should PATCH module updates to /organization/modules', async () => {
      const response = {
        enabled_modules: ['training'],
        module_settings: { training: true, scheduling: false },
      };
      mockPatch.mockResolvedValue({ data: response });

      const result = await organizationService.updateModuleSettings({ scheduling: false });

      expect(mockPatch).toHaveBeenCalledWith('/organization/modules', { scheduling: false });
      expect(result).toEqual(response);
    });
  });

  // ── isModuleEnabled ──────────────────────────────────────────────────
  describe('isModuleEnabled', () => {
    it('should return true when module is in the enabled list', async () => {
      mockGet.mockResolvedValue({
        data: { enabled_modules: ['training', 'scheduling'], module_settings: {} },
      });

      const result = await organizationService.isModuleEnabled('training');

      expect(result).toBe(true);
    });

    it('should return false when module is not in the enabled list', async () => {
      mockGet.mockResolvedValue({
        data: { enabled_modules: ['training'], module_settings: {} },
      });

      const result = await organizationService.isModuleEnabled('elections');

      expect(result).toBe(false);
    });
  });

  // ── previewNextMembershipId ──────────────────────────────────────────
  describe('previewNextMembershipId', () => {
    it('should GET /organization/settings/membership-id/preview', async () => {
      const response = { enabled: true, next_id: 'MBR-0042' };
      mockGet.mockResolvedValue({ data: response });

      const result = await organizationService.previewNextMembershipId();

      expect(mockGet).toHaveBeenCalledWith('/organization/settings/membership-id/preview');
      expect(result).toEqual(response);
    });
  });

  // ── getSetupChecklist ────────────────────────────────────────────────
  describe('getSetupChecklist', () => {
    it('should GET /organization/setup-checklist', async () => {
      const response = {
        items: [{ key: 'add_members', title: 'Add members', is_complete: false }],
        completed_count: 0,
        total_count: 1,
        enabled_modules: [],
      };
      mockGet.mockResolvedValue({ data: response });

      const result = await organizationService.getSetupChecklist();

      expect(mockGet).toHaveBeenCalledWith('/organization/setup-checklist');
      expect(result).toEqual(response);
    });
  });

  // ── updateSettings ───────────────────────────────────────────────────
  describe('updateSettings', () => {
    it('should PATCH updates to /organization/settings', async () => {
      const updates = { timezone: 'America/Chicago' };
      mockPatch.mockResolvedValue({ data: updates });

      const result = await organizationService.updateSettings(updates);

      expect(mockPatch).toHaveBeenCalledWith('/organization/settings', updates);
      expect(result).toEqual(updates);
    });
  });

  // ── getAddress ───────────────────────────────────────────────────────
  describe('getAddress', () => {
    it('should GET /organization/address', async () => {
      const address = { address: '123 Main St', city: 'Springfield', state: 'IL', zip: '62701' };
      mockGet.mockResolvedValue({ data: address });

      const result = await organizationService.getAddress();

      expect(mockGet).toHaveBeenCalledWith('/organization/address');
      expect(result).toEqual(address);
    });
  });

  // ── getProfile ───────────────────────────────────────────────────────
  describe('getProfile', () => {
    it('should GET /organization/profile', async () => {
      const profile = { name: 'Springfield FD', timezone: 'America/Chicago' };
      mockGet.mockResolvedValue({ data: profile });

      const result = await organizationService.getProfile();

      expect(mockGet).toHaveBeenCalledWith('/organization/profile');
      expect(result).toEqual(profile);
    });
  });

  // ── updateProfile ────────────────────────────────────────────────────
  describe('updateProfile', () => {
    it('should PATCH updates to /organization/profile', async () => {
      const updates = { name: 'Springfield Fire Department' };
      mockPatch.mockResolvedValue({ data: { ...updates, timezone: 'America/Chicago' } });

      const result = await organizationService.updateProfile(updates);

      expect(mockPatch).toHaveBeenCalledWith('/organization/profile', updates);
      expect(result).toEqual({ name: 'Springfield Fire Department', timezone: 'America/Chicago' });
    });
  });
});

// ============================================================================
// roleService
// ============================================================================
describe('roleService', () => {
  // ── getPermissions ───────────────────────────────────────────────────
  describe('getPermissions', () => {
    it('should GET /roles/permissions and return permissions array', async () => {
      const permissions = [
        { id: 'p1', name: 'events.view', description: 'View events' },
        { id: 'p2', name: 'events.manage', description: 'Manage events' },
      ];
      mockGet.mockResolvedValue({ data: permissions });

      const result = await roleService.getPermissions();

      expect(mockGet).toHaveBeenCalledWith('/roles/permissions');
      expect(result).toEqual(permissions);
    });
  });

  // ── getPermissionsByCategory ─────────────────────────────────────────
  describe('getPermissionsByCategory', () => {
    it('should GET /roles/permissions/by-category', async () => {
      const categories = [
        { category: 'Events', permissions: [{ id: 'p1', name: 'events.view' }] },
      ];
      mockGet.mockResolvedValue({ data: categories });

      const result = await roleService.getPermissionsByCategory();

      expect(mockGet).toHaveBeenCalledWith('/roles/permissions/by-category');
      expect(result).toEqual(categories);
    });
  });

  // ── getRoles ─────────────────────────────────────────────────────────
  describe('getRoles', () => {
    it('should GET /roles and return roles array', async () => {
      const roles = [
        { id: 'r1', name: 'Admin', slug: 'admin' },
        { id: 'r2', name: 'Member', slug: 'member' },
      ];
      mockGet.mockResolvedValue({ data: roles });

      const result = await roleService.getRoles();

      expect(mockGet).toHaveBeenCalledWith('/roles');
      expect(result).toEqual(roles);
    });
  });

  // ── getRole ──────────────────────────────────────────────────────────
  describe('getRole', () => {
    it('should GET /roles/:id and return a single role', async () => {
      const role = { id: 'r1', name: 'Admin', slug: 'admin', permissions: ['*'] };
      mockGet.mockResolvedValue({ data: role });

      const result = await roleService.getRole('r1');

      expect(mockGet).toHaveBeenCalledWith('/roles/r1');
      expect(result).toEqual(role);
    });
  });

  // ── createRole ───────────────────────────────────────────────────────
  describe('createRole', () => {
    it('should POST role data to /roles', async () => {
      const newRole = { id: 'r-new', name: 'Editor', slug: 'editor', permissions: ['events.view'] };
      mockPost.mockResolvedValue({ data: newRole });

      const roleData = { name: 'Editor', permissions: ['events.view'] };
      const result = await roleService.createRole(roleData);

      expect(mockPost).toHaveBeenCalledWith('/roles', roleData);
      expect(result).toEqual(newRole);
    });
  });

  // ── updateRole ───────────────────────────────────────────────────────
  describe('updateRole', () => {
    it('should PATCH updates to /roles/:id', async () => {
      const updated = { id: 'r1', name: 'Super Admin', permissions: ['*'] };
      mockPatch.mockResolvedValue({ data: updated });

      const updates = { name: 'Super Admin' };
      const result = await roleService.updateRole('r1', updates);

      expect(mockPatch).toHaveBeenCalledWith('/roles/r1', updates);
      expect(result).toEqual(updated);
    });
  });

  // ── deleteRole ───────────────────────────────────────────────────────
  describe('deleteRole', () => {
    it('should DELETE /roles/:id', async () => {
      mockDelete.mockResolvedValue({ data: undefined });

      await roleService.deleteRole('r1');

      expect(mockDelete).toHaveBeenCalledWith('/roles/r1');
    });

    it('should propagate errors when role is in use', async () => {
      mockDelete.mockRejectedValue(new Error('Role is assigned to users'));

      await expect(roleService.deleteRole('r1')).rejects.toThrow('Role is assigned to users');
    });
  });

  // ── cloneRole ────────────────────────────────────────────────────────
  describe('cloneRole', () => {
    it('should POST to /roles/:id/clone and return the cloned role', async () => {
      const cloned = { id: 'r-clone', name: 'Admin (Copy)', slug: 'admin-copy' };
      mockPost.mockResolvedValue({ data: cloned });

      const result = await roleService.cloneRole('r1');

      expect(mockPost).toHaveBeenCalledWith('/roles/r1/clone');
      expect(result).toEqual(cloned);
    });
  });

  // ── getUserPermissions ───────────────────────────────────────────────
  describe('getUserPermissions', () => {
    it('should GET /roles/user/:id/permissions', async () => {
      const permsResponse = { user_id: 'u1', permissions: ['events.view'], roles: ['member'] };
      mockGet.mockResolvedValue({ data: permsResponse });

      const result = await roleService.getUserPermissions('u1');

      expect(mockGet).toHaveBeenCalledWith('/roles/user/u1/permissions');
      expect(result).toEqual(permsResponse);
    });
  });

  // ── getMyRoles ───────────────────────────────────────────────────────
  describe('getMyRoles', () => {
    it('should GET /roles/my/roles', async () => {
      const roles = [{ id: 'r1', name: 'Admin' }];
      mockGet.mockResolvedValue({ data: roles });

      const result = await roleService.getMyRoles();

      expect(mockGet).toHaveBeenCalledWith('/roles/my/roles');
      expect(result).toEqual(roles);
    });
  });

  // ── getMyPermissions ─────────────────────────────────────────────────
  describe('getMyPermissions', () => {
    it('should GET /roles/my/permissions', async () => {
      const response = { user_id: 'me', permissions: ['events.view'], roles: ['member'] };
      mockGet.mockResolvedValue({ data: response });

      const result = await roleService.getMyPermissions();

      expect(mockGet).toHaveBeenCalledWith('/roles/my/permissions');
      expect(result).toEqual(response);
    });
  });

  // ── checkAdminAccess ─────────────────────────────────────────────────
  describe('checkAdminAccess', () => {
    it('should GET /roles/admin-access/check and return access info', async () => {
      const response = {
        has_access: true,
        admin_roles: ['admin'],
        user_roles: ['admin', 'member'],
        admin_permissions: ['settings.manage'],
      };
      mockGet.mockResolvedValue({ data: response });

      const result = await roleService.checkAdminAccess();

      expect(mockGet).toHaveBeenCalledWith('/roles/admin-access/check');
      expect(result).toEqual(response);
    });

    it('should return has_access false for non-admin users', async () => {
      const response = {
        has_access: false,
        admin_roles: [],
        user_roles: ['member'],
        admin_permissions: [],
      };
      mockGet.mockResolvedValue({ data: response });

      const result = await roleService.checkAdminAccess();

      expect(result.has_access).toBe(false);
    });
  });
});
