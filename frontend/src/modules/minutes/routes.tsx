/**
 * Minutes Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /minutes              — Minutes list
 *   /minutes/attendance   — Meeting attendance dashboard (meetings.manage)
 *   /minutes/outlines     — Standard outlines (minutes.manage)
 *   /minutes/settings     — Department-wide minutes settings (minutes.manage)
 *   /minutes/:minutesId   — Minutes detail
 *   /minutes/attendance/waiver-settings — Meeting waiver policy (meetings.manage)
 *   /meetings/waiver-requests      — Meeting waiver requests the caller decides
 *   /meetings/waiver-requests/:id  — One meeting waiver request
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { MEETING_WAIVER_WORKFLOW } from '../../utils/attendanceWaiverWorkflows';

const MinutesPage = lazyWithRetry(() => import('./pages/MinutesPage'));
const MinutesDetailPage = lazyWithRetry(() => import('./pages/MinutesDetailPage'));
const AttendanceDashboardPage = lazyWithRetry(() => import('./pages/AttendanceDashboardPage'));
const OutlinesPage = lazyWithRetry(() => import('./pages/OutlinesPage'));
const MinutesSettingsPage = lazyWithRetry(() => import('./pages/MinutesSettingsPage'));
const MeetingWaiverSettingsPage = lazyWithRetry(() => import('./pages/MeetingWaiverSettingsPage'));
const AttendanceWaiverQueuePage = lazyWithRetry(() => import('../../pages/training/AttendanceWaiverQueuePage'));
const AttendanceWaiverDecisionPage = lazyWithRetry(() => import('../../pages/training/AttendanceWaiverDecisionPage'));

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
      path="/minutes/attendance/waiver-settings"
      element={
        <ProtectedRoute requiredModule="minutes" moduleLabel="Meeting Minutes" requiredPermission="meetings.manage">
          <Suspense fallback={null}>
            <MeetingWaiverSettingsPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
    {/* Business-meeting waiver requests. No permission gate, on purpose, as for
        training's /attendance-waivers: who decides is the positions the
        department chose, the Chief and President and the Secretary and
        meetings-manager fallback, not a permission the route could name. The
        API lists only the requests the caller may decide and answers 404 for
        one they may not see. The paths are fixed by the backend's
        decider_action_url (MEETING_SPEC.decider_path), which the deciders'
        emails and prompts link to. */}
    <Route
      path="/meetings/waiver-requests"
      element={
        <ProtectedRoute requiredModule="minutes" moduleLabel="Meeting Minutes">
          <Suspense fallback={null}>
            <AttendanceWaiverQueuePage workflow={MEETING_WAIVER_WORKFLOW} />
          </Suspense>
        </ProtectedRoute>
      }
    />
    <Route
      path="/meetings/waiver-requests/:id"
      element={
        <ProtectedRoute requiredModule="minutes" moduleLabel="Meeting Minutes">
          <Suspense fallback={null}>
            <AttendanceWaiverDecisionPage workflow={MEETING_WAIVER_WORKFLOW} />
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
      path="/minutes/settings"
      element={
        <ProtectedRoute requiredModule="minutes" moduleLabel="Meeting Minutes" requiredPermission="minutes.manage">
          <Suspense fallback={null}>
            <MinutesSettingsPage />
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
