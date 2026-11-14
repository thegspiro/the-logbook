/**
 * Elections Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /elections            — Elections list
 *   /elections/settings   — Election Settings (elections.manage)
 *   /elections/attendance — Meeting attendance against an election (elections.manage)
 *   /elections/:electionId            — Election overview
 *   /elections/:electionId/<section>  — One section of it (results, ballot, …)
 *
 * Public routes (no auth):
 *   /ballot               — Ballot voting (token-based)
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ElectionsPage = lazyWithRetry(() => import('../../pages/ElectionsPage'));
// The route element, not the page: it forwards `?tab=` links to section paths.
const ElectionDetailRoute = lazyWithRetry(() => import('./ElectionDetailRoute'));
const ElectionsSettingsPage = lazyWithRetry(() => import('../../pages/ElectionsSettingsPage'));
const ElectionAttendancePage = lazyWithRetry(() => import('../../pages/ElectionAttendancePage'));
const BallotVotingPage = lazyWithRetry(() => import('../../pages/BallotVotingPage'));

/** Protected election routes (rendered inside AppLayout). */
export const getElectionsRoutes = () => (
  <React.Fragment>
    <Route
      path="/elections"
      element={
        <ProtectedRoute requiredModule="elections" moduleLabel="Elections">
          <Suspense fallback={null}>
            <ElectionsPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
    <Route
      path="/elections/settings"
      element={
        <ProtectedRoute requiredModule="elections" moduleLabel="Elections" requiredPermission="elections.manage">
          <Suspense fallback={null}>
            <ElectionsSettingsPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
    <Route
      path="/elections/attendance"
      element={
        <ProtectedRoute requiredModule="elections" moduleLabel="Elections" requiredPermission="elections.manage">
          <Suspense fallback={null}>
            <ElectionAttendancePage />
          </Suspense>
        </ProtectedRoute>
      }
    />
    {/* One splat route for the Overview and every section, so moving between
        sections never remounts the page (and so never drops a vote receipt or
        an open dialog); the page reads the section from the splat. */}
    <Route
      path="/elections/:electionId/*"
      element={
        <ProtectedRoute requiredModule="elections" moduleLabel="Elections">
          <Suspense fallback={null}>
            <ElectionDetailRoute />
          </Suspense>
        </ProtectedRoute>
      }
    />
  </React.Fragment>
);

/** Public ballot voting route (token-based, no auth required). */
export const getElectionsPublicRoutes = () => (
  <React.Fragment>
    <Route
      path="/ballot"
      element={
        <Suspense fallback={null}>
          <BallotVotingPage />
        </Suspense>
      }
    />
  </React.Fragment>
);
