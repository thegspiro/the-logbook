/**
 * Public Portal Module Routes
 *
 * Returns route elements for the public portal admin module.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const PublicPortalAdmin = lazyWithRetry(
  () => import('./pages/PublicPortalAdmin'),
);

export const getPublicPortalRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/admin/public-portal"
        element={
          <ProtectedRoute requiredPermission="settings.manage">
            <Suspense fallback={null}>
              <PublicPortalAdmin />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
