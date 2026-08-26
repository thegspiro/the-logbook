/**
 * Scheduling Module Routes
 *
 * Returns route elements for the scheduling/shifts module.
 * Admin sub-pages (templates, patterns, reports, settings) are broken out
 * into dedicated routes so the main /scheduling page stays focused on
 * member-facing features.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { ProtectedRoute } from '../../components/ProtectedRoute';

const SchedulingPage = lazyWithRetry(() => import('../../pages/SchedulingPage'));

const SchedulingTemplatesPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingTemplatesPage'));

const SchedulingPatternsPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingPatternsPage'));

const SchedulingAdminReportsPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingAdminReportsPage'));

const SchedulingSettingsPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingSettingsPage'));

const SchedulingPlatoonsPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingPlatoonsPage'));

const PositionRosterPage = lazyWithRetry(() => import('../../pages/scheduling/PositionRosterPage'));

const EquipmentCheckTemplateBuilder = lazyWithRetry(
  () => import('../../pages/scheduling/EquipmentCheckTemplateBuilder')
);

const EquipmentCheckReportsPage = lazyWithRetry(() => import('../../pages/scheduling/EquipmentCheckReportsPage'));

const SupplyExpiringPage = lazyWithRetry(() => import('../../pages/scheduling/SupplyExpiringPage'));

const ApparatusInventoryPage = lazyWithRetry(() => import('../../pages/scheduling/ApparatusInventoryPage'));

const FleetBoardPage = lazyWithRetry(() => import('../../pages/scheduling/FleetBoardPage'));

const CheckLogPage = lazyWithRetry(() => import('../../pages/scheduling/CheckLogPage'));

const ApparatusDetailPage = lazyWithRetry(() => import('../../pages/scheduling/ApparatusDetailPage'));

const ShiftCheckInPage = lazyWithRetry(() => import('../../pages/scheduling/ShiftCheckInPage'));

const ShiftCheckInPrintPage = lazyWithRetry(() => import('../../pages/scheduling/ShiftCheckInPrintPage'));
const ShiftReportPrintPage = lazyWithRetry(() => import('../../pages/scheduling/ShiftReportPrintPage'));

export const getSchedulingRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/scheduling"
        element={
          <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling">
            <Suspense fallback={null}>
              <SchedulingPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/scheduling/templates"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingTemplatesPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/patterns"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingPatternsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/reports"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingAdminReportsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/settings"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingSettingsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/qualifications"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute
              requiredModule="scheduling"
              moduleLabel="Scheduling"
              requiredAnyPermission={['scheduling.manage', 'training.view_all', 'training.manage']}
            >
              <PositionRosterPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/platoons"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingPlatoonsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment-check-templates/new"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <EquipmentCheckTemplateBuilder />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment-check-templates/:templateId"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <EquipmentCheckTemplateBuilder />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment-check-reports"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <EquipmentCheckReportsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/supply/expiring"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute
              requiredModule="scheduling"
              moduleLabel="Scheduling"
              requiredAnyPermission={['scheduling.manage', 'equipment_check.view', 'inventory.manage']}
            >
              <SupplyExpiringPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/apparatus-inventory"
        element={
          <Suspense fallback={null}>
            {/* Crew-level, not officer-level: recording what you just used is
                the whole point, so the default member permission opens it. */}
            <ProtectedRoute
              requiredModule="scheduling"
              moduleLabel="Scheduling"
              requiredAnyPermission={['equipment_check.submit', 'equipment_check.view', 'inventory.view']}
            >
              <ApparatusInventoryPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      {/* Fleet board and its sub-pages. `/checks` is declared before the
          dynamic apparatus route so the literal segment cannot be swallowed
          as an apparatus id. */}
      <Route
        path="/scheduling/equipment"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute
              requiredModule="scheduling"
              moduleLabel="Scheduling"
              requiredAnyPermission={['equipment_check.view', 'scheduling.manage']}
            >
              <FleetBoardPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment/checks"
        element={
          <Suspense fallback={null}>
            {/* Crew-level: the server narrows a member without
                equipment_check.view to their own checks rather than 403ing,
                so the route opens for anyone who can submit one. */}
            <ProtectedRoute
              requiredModule="scheduling"
              moduleLabel="Scheduling"
              requiredAnyPermission={['equipment_check.submit', 'equipment_check.view', 'scheduling.manage']}
            >
              <CheckLogPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment/:apparatusId"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute
              requiredModule="scheduling"
              moduleLabel="Scheduling"
              requiredAnyPermission={['equipment_check.view', 'scheduling.manage']}
            >
              <ApparatusDetailPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/checkin"
        element={
          <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling">
            <Suspense fallback={null}>
              <ShiftCheckInPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/scheduling/checkin/print"
        element={
          <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling">
            <Suspense fallback={null}>
              <ShiftCheckInPrintPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/scheduling/shift-reports/print"
        element={
          <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling">
            <Suspense fallback={null}>
              <ShiftReportPrintPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
