/**
 * Admin Hours Module Routes
 *
 * Returns route elements for the admin hours module.
 */

import React from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import {
  AdminHoursPage,
  AdminHoursManagePage,
  AdminHoursQRCodePage,
  AdminHoursClockInPage,
} from './pages';

export const getAdminHoursRoutes = () => {
  return (
    <React.Fragment>
      {/* Member-facing: personal hours log */}
      <Route path="/admin-hours" element={<AdminHoursPage />} />

      {/* QR code display page (any authenticated user can view/print) */}
      <Route path="/admin-hours/categories/:categoryId/qr-code" element={<AdminHoursQRCodePage />} />

      {/* Clock-in landing page (QR scan destination) */}
      <Route path="/admin-hours/:categoryId/clock-in" element={<AdminHoursClockInPage />} />

      {/* Admin: manage categories, review entries, summaries */}
      <Route path="/admin-hours/manage" element={<ProtectedRoute requiredPermission="admin_hours.manage"><AdminHoursManagePage /></ProtectedRoute>} />
    </React.Fragment>
  );
};
