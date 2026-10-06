/**
 * Integrations Module Routes
 *
 * To disable the integrations module, simply remove or comment out
 * the call to getIntegrationsRoutes() in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const IntegrationsPage = lazyWithRetry(() => import('../../pages/IntegrationsPage'));
const IntegrationDetailPage = lazyWithRetry(() => import('../../pages/IntegrationDetailPage'));

export const getIntegrationsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/integrations"
        element={
          <ProtectedRoute requiredModule="integrations" moduleLabel="Integrations" requiredPermission="settings.manage">
            <Suspense fallback={null}>
              <IntegrationsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/integrations/:integrationId"
        element={
          <ProtectedRoute requiredModule="integrations" moduleLabel="Integrations" requiredPermission="settings.manage">
            <Suspense fallback={null}>
              <IntegrationDetailPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
