/**
 * Integrations Module Routes
 *
 * To disable the integrations module, simply remove or comment out
 * the call to getIntegrationsRoutes() in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const IntegrationsPage = lazyWithRetry(
  () => import('../../pages/IntegrationsPage'),
);

export const getIntegrationsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/integrations"
        element={
          <ProtectedRoute requiredPermission="settings.manage">
            <Suspense fallback={null}>
              <IntegrationsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
