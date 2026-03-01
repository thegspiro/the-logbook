/**
 * Prospective Members Module Routes
 *
 * This function returns route elements for the prospective members module.
 * To disable this module, simply remove or comment out
 * the call to this function in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ProspectiveMembersPage = lazyWithRetry(
  () => import('./pages/ProspectiveMembersPage'),
);
const PipelineSettingsPage = lazyWithRetry(
  () => import('./pages/PipelineSettingsPage'),
);
const ApplicationStatusPage = lazyWithRetry(() =>
  import('./pages/ApplicationStatusPage').then((m) => ({
    default: m.ApplicationStatusPage,
  })),
);

export const getProspectiveMembersRoutes = () => {
  return (
    <React.Fragment>
      {/* Prospective Members Pipeline */}
      <Route
        path="/prospective-members"
        element={
          <ProtectedRoute requiredPermission="prospective_members.manage">
            <Suspense fallback={null}>
              <ProspectiveMembersPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Pipeline Settings */}
      <Route
        path="/prospective-members/settings"
        element={
          <ProtectedRoute requiredPermission="prospective_members.manage">
            <Suspense fallback={null}>
              <PipelineSettingsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};

/**
 * Public routes for the prospective members module (no auth required).
 * These must be rendered OUTSIDE the ProtectedRoute/AppLayout wrapper.
 */
export const getProspectiveMembersPublicRoutes = () => {
  return (
    <React.Fragment>
      {/* Public Application Status (no auth required) */}
      <Route
        path="/application-status/:token"
        element={
          <Suspense fallback={null}>
            <ApplicationStatusPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
