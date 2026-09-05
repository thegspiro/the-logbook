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

const SchedulingPlanningPage = lazyWithRetry(
  () => import('../../pages/scheduling/admin/planning/SchedulingPlanningPage')
);

const SchedulingAdminReportsPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingAdminReportsPage'));

const SchedulingSettingsPage = lazyWithRetry(() => import('../../pages/scheduling/SchedulingSettingsPage'));

const SchedulingSettingsRedirect = lazyWithRetry(
  () => import('../../pages/scheduling/admin/SchedulingSettingsRedirect')
);

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
      {/* One grant runs this whole area. The hub admitted the training grants
          for a while, because the position roster inside it did — but a hub
          gate wider than every card behind it only ever opens an empty page,
          and administering the schedule is what `scheduling.manage` is for. */}
      <Route
        path="/scheduling/admin"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingAdminHub />
            </ProtectedRoute>
          </Suspense>
        }
      />
      {/* Templates and patterns are sections of planning, not screens beside it:
          the reason to open a template is a shift that keeps coming up short,
          and that is on the gaps view one tab away. */}
      <Route
        path="/scheduling/admin/planning"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingPlanningPage section="gaps" />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/planning/templates"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingPlanningPage section="templates" />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/scheduling/admin/planning/patterns"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingPlanningPage section="patterns" />
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
      {/* This page used to accept `training.view_all` / `training.manage` as
          well, on the grounds that it reads as a training-compliance view. It
          no longer does: nothing in the app ever linked a training officer to
          it, so the wider gate bought a page reachable only by typing its URL
          while making every gate above it wider to match. Scheduling
          administration is one grant. */}
      <Route
        path="/scheduling/admin/positions"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <PositionRosterPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      {/* Sections are routes, so the bare path names none. It forwards to the
          one its `?tab=` names, which is what keeps every link written against
          the older query-parameter contract landing somewhere real instead of
          on the catch-all's redirect to the dashboard. */}
      <Route
        path="/scheduling/admin/settings"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredModule="scheduling" moduleLabel="Scheduling" requiredPermission="scheduling.manage">
              <SchedulingSettingsRedirect />
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
