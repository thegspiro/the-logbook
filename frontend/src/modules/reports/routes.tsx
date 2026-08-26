/**
 * Reports Module Routes
 *
 * Returns route elements for the reports module.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ReportsPage = lazyWithRetry(() => import('./pages/ReportsPage'));

export const getReportsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/reports"
        element={
          <ProtectedRoute requiredModule="reports" moduleLabel="Reports" requiredPermission="reports.view">
            <Suspense fallback={null}>
              <ReportsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
