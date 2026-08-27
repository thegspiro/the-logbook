/**
 * Testing Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /testing               — the testing home
 *   /testing/report/print  — the run as a printable report
 *
 * **No permission gate, on purpose.** The screen's second job is proving the
 * gates on every other page, and that is done by signing in as a firefighter,
 * a lieutenant and a chief in turn and checking that the boxes it marks
 * "should refuse" actually refuse. A page only an administrator could open
 * could not be used for that. Reading *other* testers' marks is what carries a
 * grant, and the server enforces it.
 *
 * The module gate is a different question and does apply: a department that
 * has finished setting up switches the whole thing off.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const TestingChecklistPage = lazyWithRetry(() => import('./pages/TestingChecklistPage'));
const TestingReportPrintPage = lazyWithRetry(() => import('./pages/TestingReportPrintPage'));

export const getTestingRoutes = () => (
  <React.Fragment>
    <Route
      path="/testing"
      element={
        <ProtectedRoute requiredModule="testing" moduleLabel="The Testing Checklist">
          <Suspense fallback={null}>
            <TestingChecklistPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
    <Route
      path="/testing/report/print"
      element={
        <ProtectedRoute requiredModule="testing" moduleLabel="The Testing Checklist">
          <Suspense fallback={null}>
            <TestingReportPrintPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
  </React.Fragment>
);
