/**
 * Scheduling Module Routes
 *
 * Returns route elements for the scheduling/shifts module.
 *
 * Everything an administrator does lives under `/scheduling/admin`, reached
 * from the Administration section of the nav like Training Admin and Inventory
 * Admin — not from a row of cards on the member-facing page, where an officer
 * had to open the schedule to find the settings. `/scheduling` itself is the
 * member's page: the board, their shifts, open shifts, requests.
 *
 * Each settings section is its own route rather than a `?tab=` on one page, so
 * a hub card, a link from another module and a bookmark all address the same
 * screen. The paths are written down once in `schedulingSettingsSections.ts`.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { ProtectedRoute } from '../../components/ProtectedRoute';

const SchedulingPage = lazyWithRetry(() => import('../../pages/SchedulingPage'));

const SchedulingAdminHub = lazyWithRetry(() => import('../../pages/scheduling/admin/SchedulingAdminHub'));

const SchedulingTemplatesPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingTemplatesPage'));

const SchedulingPatternsPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingPatternsPage'));

const SchedulingAdminReportsPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingAdminReportsPage'));

const SchedulingSettingsPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingSettingsPage'));

const SchedulingPlatoonsPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingPlatoonsPage'));

const PositionRosterPage = lazyWithRetry(() => import('../../pages/scheduling/PositionRosterPage'));

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
      {/* The hub admits the position roster's audience as well as scheduling
          managers — a training officer holds no scheduling grant and the roster
          is a training-compliance view. The hub's own body shows each of them
          only the cards their permissions open. */}
      <Route
        path="/scheduling/admin"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute
              requiredModule="scheduling"
              moduleLabel="Scheduling"
              requiredAnyPermission={['scheduling.manage', 'training.view_all', 'training.manage']}
            >
              <SchedulingAdminHub />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/templates"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingTemplatesPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/patterns"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingPatternsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/reports"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingAdminReportsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/platoons"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingPlatoonsPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      {/* Training permissions open this one, not just scheduling ones: it is a
          training-compliance view as much as a scheduling one, and a training
          officer holding neither scheduling grant has always been able to read
          it. Moving the page must not narrow who it admits. */}
      <Route
        path="/scheduling/admin/positions"
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
        path="/scheduling/admin/settings/general"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingSettingsPage section="general" />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/settings/apparatus"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingSettingsPage section="apparatus" />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/settings/platoons"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingSettingsPage section="platoons" />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/settings/eligibility"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingSettingsPage section="eligibility" />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/settings/notifications"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingSettingsPage section="notifications" />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/settings/shift-reports"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingSettingsPage section="shift-reports" />
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
