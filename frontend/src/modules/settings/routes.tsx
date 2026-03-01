/**
 * Settings Module Routes
 *
 * Organization settings, role management, department setup,
 * user account settings, and reports.
 *
 * To disable the settings module, simply remove or comment out
 * the call to getSettingsRoutes() in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const SettingsPage = lazyWithRetry(() =>
  import('../../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const UserSettingsPage = lazyWithRetry(() =>
  import('../../pages/UserSettingsPage').then((m) => ({
    default: m.UserSettingsPage,
  })),
);
const RoleManagementPage = lazyWithRetry(() =>
  import('../../pages/RoleManagementPage').then((m) => ({
    default: m.RoleManagementPage,
  })),
);
const ReportsPage = lazyWithRetry(() =>
  import('../../pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const DepartmentSetupPage = lazyWithRetry(
  () => import('../../pages/DepartmentSetupPage'),
);

export const getSettingsRoutes = () => {
  return (
    <React.Fragment>
      {/* Organization Settings */}
      <Route
        path="/settings"
        element={
          <ProtectedRoute requiredPermission="settings.manage">
            <Suspense fallback={null}>
              <SettingsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Role Management */}
      <Route
        path="/settings/roles"
        element={
          <ProtectedRoute requiredPermission="positions.manage_permissions">
            <Suspense fallback={null}>
              <RoleManagementPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Department Setup */}
      <Route
        path="/setup"
        element={
          <ProtectedRoute requiredPermission="settings.manage">
            <Suspense fallback={null}>
              <DepartmentSetupPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* User Account Settings (accessible to all authenticated users) */}
      <Route
        path="/account"
        element={
          <Suspense fallback={null}>
            <UserSettingsPage />
          </Suspense>
        }
      />
      <Route
        path="/settings/account"
        element={<Navigate to="/account" replace />}
      />

      {/* Reports */}
      <Route
        path="/reports"
        element={
          <Suspense fallback={null}>
            <ReportsPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
