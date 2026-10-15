/**
 * Minutes Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /minutes              — Minutes list
 *   /minutes/attendance   — Meeting attendance dashboard (meetings.manage)
 *   /minutes/outlines     — Standard outlines (minutes.manage)
 *   /minutes/:minutesId   — Minutes detail
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const MinutesPage = lazyWithRetry(() => import('./pages/MinutesPage'));
const MinutesDetailPage = lazyWithRetry(() => import('./pages/MinutesDetailPage'));
const AttendanceDashboardPage = lazyWithRetry(() => import('./pages/AttendanceDashboardPage'));
const OutlinesPage = lazyWithRetry(() => import('./pages/OutlinesPage'));

/** Protected minutes routes (rendered inside AppLayout). */
export const getMinutesRoutes = () => (
  <React.Fragment>
    <Route
      path="/minutes"
      element={
        <ProtectedRoute requiredModule="minutes" moduleLabel="Meeting Minutes">
          <Suspense fallback={null}>
            <MinutesPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
    <Route
      path="/minutes/attendance"
      element={
        <ProtectedRoute requiredModule="minutes" moduleLabel="Meeting Minutes" requiredPermission="meetings.manage">
          <Suspense fallback={null}>
            <AttendanceDashboardPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
    <Route
      path="/minutes/outlines"
      element={
        <ProtectedRoute requiredModule="minutes" moduleLabel="Meeting Minutes" requiredPermission="minutes.manage">
          <Suspense fallback={null}>
            <OutlinesPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
    <Route
      path="/minutes/:minutesId"
      element={
        <ProtectedRoute requiredModule="minutes" moduleLabel="Meeting Minutes">
          <Suspense fallback={null}>
            <MinutesDetailPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
  </React.Fragment>
);
