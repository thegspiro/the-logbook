/**
 * Reports Module Routes
 *
 * Returns route elements for the reports module.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ReportsPage = lazyWithRetry(() => import('./pages/ReportsPage'));

export const getReportsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/reports"
        element={
          <Suspense fallback={null}>
            <ReportsPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
