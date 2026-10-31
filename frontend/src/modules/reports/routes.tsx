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

// Template builders and period managers may each read the other's list.
const EVALUATION_SETUP = ['evaluations.configure', 'evaluations.manage'];

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
          <ProtectedRoute requiredModule="reports" moduleLabel="Reports" requiredAnyPermission={EVALUATION_SETUP}>
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
    </React.Fragment>
  );
};
