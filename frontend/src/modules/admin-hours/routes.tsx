/**
 * Admin Hours Module Routes
 *
 * Returns route elements for the admin hours module.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const AdminHoursPage = lazyWithRetry(
  () => import('./pages/AdminHoursPage'),
);
const AdminHoursManagePage = lazyWithRetry(
  () => import('./pages/AdminHoursManagePage'),
);
const AdminHoursQRCodePage = lazyWithRetry(
  () => import('./pages/AdminHoursQRCodePage'),
);
const AdminHoursClockInPage = lazyWithRetry(
  () => import('./pages/AdminHoursClockInPage'),
);

export const getAdminHoursRoutes = () => {
  return (
    <React.Fragment>
      {/* Member-facing: personal hours log */}
      <Route
        path="/admin-hours"
        element={
          <Suspense fallback={null}>
            <AdminHoursPage />
          </Suspense>
        }
      />

      {/* QR code display page (any authenticated user can view/print) */}
      <Route
        path="/admin-hours/categories/:categoryId/qr-code"
        element={
          <Suspense fallback={null}>
            <AdminHoursQRCodePage />
          </Suspense>
        }
      />

      {/* Clock-in landing page (QR scan destination) */}
      <Route
        path="/admin-hours/:categoryId/clock-in"
        element={
          <Suspense fallback={null}>
            <AdminHoursClockInPage />
          </Suspense>
        }
      />

      {/* Admin: manage categories, review entries, summaries */}
      <Route
        path="/admin-hours/manage"
        element={
          <ProtectedRoute requiredPermission="admin_hours.manage">
            <Suspense fallback={null}>
              <AdminHoursManagePage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
