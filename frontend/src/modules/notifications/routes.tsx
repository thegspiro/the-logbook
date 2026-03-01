/**
 * Notifications Module Routes
 *
 * To disable the notifications module, simply remove or comment out
 * the call to getNotificationsRoutes() in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const NotificationsPage = lazyWithRetry(
  () => import('../../pages/NotificationsPage'),
);

export const getNotificationsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/notifications"
        element={
          <Suspense fallback={null}>
            <NotificationsPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
