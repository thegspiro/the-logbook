/**
 * Scheduling Module Routes
 *
 * Returns route elements for the scheduling/shifts module.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const SchedulingPage = lazyWithRetry(
  () => import('../../pages/SchedulingPage'),
);

export const getSchedulingRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/scheduling"
        element={
          <Suspense fallback={null}>
            <SchedulingPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
