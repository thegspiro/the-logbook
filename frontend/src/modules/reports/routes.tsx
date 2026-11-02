/**
 * Reports Module Routes
 *
 * Returns route elements for the reports module.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ReportsPage = lazyWithRetry(() => import('./pages/ReportsPage'));
const SavedReportsPage = lazyWithRetry(() => import('./pages/SavedReportsPage'));
const EvaluationsPage = lazyWithRetry(() => import('./pages/EvaluationsPage'));
const EvaluationTemplateBuilderPage = lazyWithRetry(() => import('./pages/EvaluationTemplateBuilderPage'));
const EvaluationListPage = lazyWithRetry(() => import('./pages/EvaluationListPage'));
const EvaluationDetailPage = lazyWithRetry(() => import('./pages/EvaluationDetailPage'));
const MyEvaluationsPage = lazyWithRetry(() => import('./pages/MyEvaluationsPage'));

export const getReportsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/reports"
        element={
          <ProtectedRoute requiredModule="reports" moduleLabel="Reports" requiredPermission="reports.view">
            <Suspense fallback={null}>
              <ReportsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/saved"
        element={
          <ProtectedRoute requiredModule="reports" moduleLabel="Reports" requiredPermission="reports.view">
            <Suspense fallback={null}>
              <SavedReportsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/evaluations"
        element={
          <ProtectedRoute
            requiredModule="reports"
            moduleLabel="Reports"
            requiredAnyPermission={['evaluations.configure', 'evaluations.manage']}
          >
            <Suspense fallback={null}>
              <EvaluationsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/evaluations/templates/:templateId"
        element={
          <ProtectedRoute requiredModule="reports" moduleLabel="Reports" requiredPermission="evaluations.configure">
            <Suspense fallback={null}>
              <EvaluationTemplateBuilderPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/evaluations/conduct"
        element={
          <ProtectedRoute
            requiredModule="reports"
            moduleLabel="Reports"
            requiredAnyPermission={['evaluations.conduct', 'evaluations.view_all', 'evaluations.manage']}
          >
            <Suspense fallback={null}>
              <EvaluationListPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      {/* A member's own evaluations need no grant: the server lists only the
          caller's, and a member must be able to reach the record they
          acknowledge. */}
      <Route
        path="/reports/evaluations/mine"
        element={
          <ProtectedRoute requiredModule="reports" moduleLabel="Reports">
            <Suspense fallback={null}>
              <MyEvaluationsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      {/* Open to anyone signed in: the server answers 404 to anyone without
          a part in the evaluation and decides what the rest may see. */}
      <Route
        path="/reports/evaluations/:evaluationId"
        element={
          <ProtectedRoute requiredModule="reports" moduleLabel="Reports">
            <Suspense fallback={null}>
              <EvaluationDetailPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
