/**
 * Governance Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /governance/legal — public privacy notice / terms, and proposed revisions
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';

import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const LegalDocumentsPage = lazyWithRetry(() => import('./pages/LegalDocumentsPage'));

/** Permissions that reach the legal-documents screen (read + propose). */
export const LEGAL_DOCUMENTS_PERMISSIONS = ['legal.propose', 'legal.publish', 'settings.manage'];

export const getGovernanceRoutes = () => (
  <React.Fragment>
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
