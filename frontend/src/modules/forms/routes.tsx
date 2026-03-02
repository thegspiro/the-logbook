/**
 * Forms Module Routes
 *
 * Includes both the admin form builder (protected) and
 * the public form submission page (no auth required).
 *
 * To disable the forms module, simply remove or comment out
 * the calls to getFormsRoutes() and getFormsPublicRoutes() in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const FormsPage = lazyWithRetry(() => import('../../pages/FormsPage'));
const PublicFormPage = lazyWithRetry(() => import('../../pages/PublicFormPage'));

/** Protected routes (inside AppLayout) */
export const getFormsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/forms"
        element={
          <ProtectedRoute requiredPermission="settings.manage">
            <Suspense fallback={null}>
              <FormsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};

/** Public routes (no auth required) */
export const getFormsPublicRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/f/:slug"
        element={
          <Suspense fallback={null}>
            <PublicFormPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
