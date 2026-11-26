/**
 * Public Portal Module Routes
 *
 * Returns route elements for the public portal admin module.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const PublicPortalAdmin = lazyWithRetry(() => import('./pages/PublicPortalAdmin'));
const PublicWebsiteSettingsPage = lazyWithRetry(() => import('./pages/PublicWebsiteSettingsPage'));

export const getPublicPortalRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/admin/public-portal"
        element={
          <ProtectedRoute
            requiredModule="public_info"
            moduleLabel="Public Information"
            requiredPermission="settings.manage"
          >
            <Suspense fallback={null}>
              <PublicPortalAdmin />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/public-website"
        element={
          <ProtectedRoute
            requiredModule="public_info"
            moduleLabel="Public Information"
            requiredPermission="settings.manage"
          >
            <Suspense fallback={null}>
              <PublicWebsiteSettingsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
