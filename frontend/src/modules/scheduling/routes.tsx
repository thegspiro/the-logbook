/**
 * Scheduling Module Routes
 *
 * Returns route elements for the scheduling/shifts module.
 * Admin sub-pages (templates, patterns, reports, settings) are broken out
 * into dedicated routes so the main /scheduling page stays focused on
 * member-facing features.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { ProtectedRoute } from '../../components/ProtectedRoute';

const SchedulingPage = lazyWithRetry(
  () => import('../../pages/SchedulingPage'),
);

const SchedulingTemplatesPage = lazyWithRetry(
  () => import('../../pages/scheduling/SchedulingTemplatesPage'),
);

const SchedulingPatternsPage = lazyWithRetry(
  () => import('../../pages/scheduling/SchedulingPatternsPage'),
);

const SchedulingAdminReportsPage = lazyWithRetry(
  () => import('../../pages/scheduling/SchedulingAdminReportsPage'),
);

const SchedulingSettingsPage = lazyWithRetry(
  () => import('../../pages/scheduling/SchedulingSettingsPage'),
);

const EquipmentCheckTemplateBuilder = lazyWithRetry(
  () => import('../../pages/scheduling/EquipmentCheckTemplateBuilder'),
);

const EquipmentCheckReportsPage = lazyWithRetry(
  () => import('../../pages/scheduling/EquipmentCheckReportsPage'),
);

const ShiftCheckInPage = lazyWithRetry(
  () => import('../../pages/scheduling/ShiftCheckInPage'),
);

const ShiftCheckInPrintPage = lazyWithRetry(
  () => import('../../pages/scheduling/ShiftCheckInPrintPage'),
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
      <Route
        path="/scheduling/templates"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredPermission="scheduling.manage">
              <SchedulingTemplatesPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/patterns"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredPermission="scheduling.manage">
              <SchedulingPatternsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/reports"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredPermission="scheduling.manage">
              <SchedulingAdminReportsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/settings"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredPermission="scheduling.manage">
              <SchedulingSettingsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment-check-templates/new"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredPermission="scheduling.manage">
              <EquipmentCheckTemplateBuilder />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment-check-templates/:templateId"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredPermission="scheduling.manage">
              <EquipmentCheckTemplateBuilder />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment-check-reports"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredPermission="scheduling.manage">
              <EquipmentCheckReportsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/checkin"
        element={
          <Suspense fallback={null}>
            <ShiftCheckInPage />
          </Suspense>
        }
      />
      <Route
        path="/scheduling/checkin/print"
        element={
          <Suspense fallback={null}>
            <ShiftCheckInPrintPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
