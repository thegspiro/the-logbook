/**
 * Minutes Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /minutes              — Minutes list
 *   /minutes/:minutesId   — Minutes detail
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const MinutesPage = lazyWithRetry(() => import('../../pages/MinutesPage'));
const MinutesDetailPage = lazyWithRetry(
  () => import('../../pages/MinutesDetailPage'),
);

/** Protected minutes routes (rendered inside AppLayout). */
export const getMinutesRoutes = () => (
  <React.Fragment>
    <Route
      path="/minutes"
      element={
        <Suspense fallback={null}>
          <MinutesPage />
        </Suspense>
      }
    />
    <Route
      path="/minutes/:minutesId"
      element={
        <Suspense fallback={null}>
          <MinutesDetailPage />
        </Suspense>
      }
    />
  </React.Fragment>
);
