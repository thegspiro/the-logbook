/**
 * History Module Routes
 *
 * Reading published history needs only a signed-in member: the server decides
 * what each caller receives. Writing and configuring are gated here as well
 * as on the API.
 */

import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const HistoryHomePage = lazyWithRetry(() => import('./pages/HistoryHomePage'));
const HistoryPeoplePage = lazyWithRetry(() => import('./pages/HistoryPeoplePage'));
const HistoryPersonPage = lazyWithRetry(() => import('./pages/HistoryPersonPage'));
const HistoryPersonFormPage = lazyWithRetry(() => import('./pages/HistoryPersonFormPage'));
const HistoryHonorRollPage = lazyWithRetry(() => import('./pages/HistoryHonorRollPage'));
const HistorySettingsPage = lazyWithRetry(() => import('./pages/HistorySettingsPage'));
const HistoryClearanceReviewPage = lazyWithRetry(() => import('./pages/HistoryClearanceReviewPage'));
const HistoryImportListPage = lazyWithRetry(() => import('./pages/HistoryImportListPage'));
const HistoryImportReviewPage = lazyWithRetry(() => import('./pages/HistoryImportReviewPage'));
const HistoryMergePage = lazyWithRetry(() => import('./pages/HistoryMergePage'));

export function getHistoryRoutes() {
  return (
    <>
      <Route
        path="/history"
        element={
          <ProtectedRoute requiredModule="history" moduleLabel="History">
            <HistoryHomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history/people"
        element={
          <ProtectedRoute requiredModule="history" moduleLabel="History">
            <HistoryPeoplePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history/people/new"
        element={
          <ProtectedRoute requiredPermission="history.manage" requiredModule="history" moduleLabel="History">
            <HistoryPersonFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history/people/:personId"
        element={
          <ProtectedRoute requiredModule="history" moduleLabel="History">
            <HistoryPersonPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history/people/:personId/edit"
        element={
          <ProtectedRoute requiredPermission="history.manage" requiredModule="history" moduleLabel="History">
            <HistoryPersonFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history/people/:personId/merge"
        element={
          <ProtectedRoute requiredPermission="history.manage" requiredModule="history" moduleLabel="History">
            <HistoryMergePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history/import"
        element={
          <ProtectedRoute requiredPermission="history.manage" requiredModule="history" moduleLabel="History">
            <HistoryImportListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history/import/:importId"
        element={
          <ProtectedRoute requiredPermission="history.manage" requiredModule="history" moduleLabel="History">
            <HistoryImportReviewPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history/honor-roll"
        element={
          <ProtectedRoute requiredModule="history" moduleLabel="History">
            <HistoryHonorRollPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history/clearance/:requestId"
        element={
          <ProtectedRoute requiredModule="history" moduleLabel="History">
            <HistoryClearanceReviewPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history/settings"
        element={
          <ProtectedRoute
            requiredAnyPermission={['history.manage', 'settings.manage']}
            requiredModule="history"
            moduleLabel="History"
          >
            <HistorySettingsPage />
          </ProtectedRoute>
        }
      />
    </>
  );
}
