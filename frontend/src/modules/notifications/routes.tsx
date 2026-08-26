/**
 * Notifications Module Routes
 *
 * Disabling the module is a per-organization setting (Settings > Modules),
 * not a code change: the route below carries `requiredModule`, and the
 * matching API router is gated on the same flag. The previous note here told
 * you to comment out getNotificationsRoutes() in App.tsx, which would have
 * removed the page from every organization on the deployment.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const NotificationsPage = lazyWithRetry(() => import('../../pages/NotificationsPage'));

export const getNotificationsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/notifications"
        element={
          <ProtectedRoute requiredModule="notifications" moduleLabel="Notifications">
            <Suspense fallback={null}>
              <NotificationsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
