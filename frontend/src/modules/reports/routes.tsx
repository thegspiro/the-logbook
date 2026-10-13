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
const SavedReportsPage = lazyWithRetry(() => import('./pages/SavedReportsPage'));

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
      <Route
        path="/reports/saved"
        element={
          <ProtectedRoute requiredModule="reports" moduleLabel="Reports" requiredPermission="reports.view">
            <Suspense fallback={null}>
              <SavedReportsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
