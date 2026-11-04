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
const ClaudeAuthorizePage = lazyWithRetry(() => import('../../pages/ClaudeAuthorizePage'));
const ClaudeConnectionsPage = lazyWithRetry(() => import('../../pages/ClaudeConnectionsPage'));
const HistoricalImportPage = lazyWithRetry(
  () => import('../../pages/integrations/historicalImport/HistoricalImportPage')
);
const HistoricalImportDetailPage = lazyWithRetry(
  () => import('../../pages/integrations/historicalImport/HistoricalImportDetailPage')
);

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
      {/* IT administrator only: integrations.historical_import is granted to
          no default role. Declared before /integrations/:integrationId for the
          reader; the router ranks a static segment above a parameter anyway. */}
      <Route
        path="/integrations/historical-import"
        element={
          <ProtectedRoute
            requiredModule="integrations"
            moduleLabel="Integrations"
            requiredPermission="integrations.historical_import"
          >
            <Suspense fallback={null}>
              <HistoricalImportPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/integrations/historical-import/:importId"
        element={
          <ProtectedRoute
            requiredModule="integrations"
            moduleLabel="Integrations"
            requiredPermission="integrations.historical_import"
          >
            <Suspense fallback={null}>
              <HistoricalImportDetailPage />
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
      {/* The Claude (MCP) consent screen and a member's own connections. No
          permission: any signed-in member may connect a client, and what the
          connection can reach is bounded by that member's own permissions on
          the server. The backend's /api/oauth/authorize sends the browser to
          the first of these; its path is fixed there (CONSENT_PATH). Not under
          /integrations: that page is settings.manage, and nesting beneath it
          would put a crumb most members cannot open into every trail. */}
      <Route
        path="/claude/authorize"
        element={
          <ProtectedRoute requiredModule="integrations" moduleLabel="Integrations">
            <Suspense fallback={null}>
              <ClaudeAuthorizePage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/claude/connections"
        element={
          <ProtectedRoute requiredModule="integrations" moduleLabel="Integrations">
            <Suspense fallback={null}>
              <ClaudeConnectionsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
