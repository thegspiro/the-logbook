/**
 * Admin Module Routes
 *
 * Error monitoring, analytics dashboards, and platform analytics.
 *
 * To disable the admin module, simply remove or comment out
 * the call to getAdminRoutes() in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ErrorMonitoringPage = lazyWithRetry(
  () => import('../../pages/ErrorMonitoringPage'),
);
const AnalyticsDashboardPage = lazyWithRetry(
  () => import('../../pages/AnalyticsDashboardPage'),
);
const PlatformAnalyticsPage = lazyWithRetry(
  () => import('../../pages/PlatformAnalyticsPage'),
);
const AuditLogPage = lazyWithRetry(
  () => import('../../pages/AuditLogPage'),
);

export const getAdminRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/admin/errors"
        element={
          <ProtectedRoute requiredPermission="settings.manage">
            <Suspense fallback={null}>
              <ErrorMonitoringPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/analytics"
        element={
          <ProtectedRoute requiredPermission="analytics.view">
            <Suspense fallback={null}>
              <AnalyticsDashboardPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/platform-analytics"
        element={
          <ProtectedRoute requiredPermission="settings.manage">
            <Suspense fallback={null}>
              <PlatformAnalyticsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/audit-log"
        element={
          <ProtectedRoute requiredPermission="audit.view">
            <Suspense fallback={null}>
              <AuditLogPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
