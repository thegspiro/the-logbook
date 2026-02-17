/**
 * User Permissions Page
 *
 * Displays all permissions for a specific user, grouped by module/category.
 * Accessed from the Role Management page via the "View Permissions" button.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Shield,
  Loader2,
  AlertTriangle,
  CheckCircle,
  User,
} from 'lucide-react';
import { roleService, userService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

interface UserPermissionsData {
  user_id: string;
  permissions: string[];
  roles: string[];
}

interface GroupedPermissions {
  module: string;
  permissions: string[];
}

export const UserPermissionsPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const [permissionsData, setPermissionsData] = useState<UserPermissionsData | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPermissions = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);

      const [permsData, users] = await Promise.all([
        roleService.getUserPermissions(userId),
        userService.getUsers(),
      ]);

      setPermissionsData(permsData);

      // Find the user name from the users list
      const user = users.find((u) => u.id === userId);
      if (user) {
        const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
        setUserName(fullName || user.username || user.email || 'User');
      } else {
        setUserName('Unknown User');
      }
    } catch (err) {
      const message = getErrorMessage(err, 'Unable to load user permissions.');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const groupPermissionsByModule = (permissions: string[]): GroupedPermissions[] => {
    const grouped: Record<string, string[]> = {};

    permissions.forEach((perm) => {
      const parts = perm.split('.');
      const module = parts.length > 1 ? parts[0] : 'general';
      if (!grouped[module]) {
        grouped[module] = [];
      }
      grouped[module].push(perm);
    });

    return Object.entries(grouped)
      .map(([module, perms]) => ({
        module,
        permissions: perms.sort(),
      }))
      .sort((a, b) => a.module.localeCompare(b.module));
  };

  const formatModuleName = (module: string): string => {
    return module
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatPermissionAction = (perm: string): string => {
    const parts = perm.split('.');
    const action = parts.length > 1 ? parts.slice(1).join('.') : perm;
    return action
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64">
            <Loader2 className="w-8 h-8 text-red-600 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Role Management
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0">
              <User className="w-5 h-5 text-blue-700 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-theme-text-primary">{userName}</h2>
              <p className="text-sm text-theme-text-muted">User Permissions</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          </div>
        )}

        {permissionsData && (
          <>
            {/* Roles Summary */}
            <div className="mb-6 bg-theme-surface rounded-lg border border-theme-surface-border p-4">
              <h3 className="text-sm font-semibold text-theme-text-primary mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Assigned Roles
              </h3>
              {permissionsData.roles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {permissionsData.roles.map((role) => (
                    <span
                      key={role}
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-theme-text-muted">No roles assigned.</p>
              )}
            </div>

            {/* Permissions */}
            {permissionsData.permissions.length === 0 ? (
              <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-12 text-center">
                <Shield className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
                <h3 className="text-lg font-medium text-theme-text-primary mb-1">No Permissions</h3>
                <p className="text-sm text-theme-text-muted">
                  This user does not have any permissions assigned through their roles.
                </p>
              </div>
            ) : permissionsData.permissions.includes('*') ? (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-6">
                <div className="flex items-start gap-3">
                  <Shield className="w-6 h-6 text-yellow-700 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-lg font-semibold text-yellow-700 dark:text-yellow-300">
                      Full Access (Wildcard)
                    </h3>
                    <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                      This user has full access through a wildcard permission. All current and future permissions are granted.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-theme-text-primary">
                    Permissions ({permissionsData.permissions.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groupPermissionsByModule(permissionsData.permissions).map((group) => (
                    <div
                      key={group.module}
                      className="bg-theme-surface rounded-lg border border-theme-surface-border p-4"
                    >
                      <h4 className="text-sm font-semibold text-theme-text-primary mb-3 uppercase tracking-wide">
                        {formatModuleName(group.module)}
                      </h4>
                      <ul className="space-y-2">
                        {group.permissions.map((perm) => (
                          <li key={perm} className="flex items-start gap-2">
                            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-sm text-theme-text-primary">
                                {formatPermissionAction(perm)}
                              </span>
                              <p className="text-xs text-theme-text-muted font-mono">{perm}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default UserPermissionsPage;
