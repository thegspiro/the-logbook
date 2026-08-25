/**
 * Governance Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /governance/legal — public privacy notice / terms, and proposed revisions
 *   /governance/org-chart — the department's real chain of command
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';

import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const LegalDocumentsPage = lazyWithRetry(() => import('./pages/LegalDocumentsPage'));
const OrgChartPage = lazyWithRetry(() => import('./pages/OrgChartPage'));

/** Permissions that reach the legal-documents screen (read + propose). */
export const LEGAL_DOCUMENTS_PERMISSIONS = ['legal.propose', 'legal.publish', 'settings.manage'];

export const getGovernanceRoutes = () => (
  <React.Fragment>
    {/*
      Deliberately gated on authentication alone. The chart exists so any
      member can work out who is in charge of an area without asking around;
      a permission here would leave the general membership — the audience —
      outside the one screen built for them. Editing is gated server-side on
      orgchart.manage, and the page renders read-only without it.
    */}
    <Route
      path="/governance/org-chart"
      element={
        <ProtectedRoute>
          <Suspense fallback={null}>
            <OrgChartPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
    <Route
      path="/governance/legal"
      element={
        <ProtectedRoute requiredAnyPermission={LEGAL_DOCUMENTS_PERMISSIONS}>
          <Suspense fallback={null}>
            <LegalDocumentsPage />
          </Suspense>
        </ProtectedRoute>
      }
    />
  </React.Fragment>
);
