/**
 * Forms Module Routes
 *
 * Includes both the admin form builder (management-only) and
 * the public form submission page (no auth required).
 *
 * The builder screen carries the `forms` module gate, matching the
 * navigation, which has always gated its Forms entry on the same flag. The
 * **API is deliberately not gated** and that asymmetry is the point: the
 * `forms` flag governs whether this department builds its own forms, not
 * whether the form engine runs. Other modules consume `/api/v1/forms`
 * directly — Prospective Members' stage configuration lists published forms,
 * and `FieldRenderer` calls `/forms/member-lookup` from inside prospect
 * applications and event requests — so gating the router would break screens
 * belonging to modules that are still switched on.
 *
 * The public submission page is ungated on purpose. It answers from
 * `/api/public/v1/forms`, its caller has no session to resolve an
 * organization from, and a published form's link must not stop working
 * because an admin tidied the builder away.
 *
 * Turning the module off is a Settings > Modules toggle. Do not disable it by
 * removing the getFormsRoutes() call in App.tsx — that would take the builder
 * away from every organization on the deployment, not from the one that asked.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
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
          <ProtectedRoute requiredPermission="forms.manage" requiredModule="forms" moduleLabel="Custom Forms">
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
