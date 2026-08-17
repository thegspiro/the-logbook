/**
 * Medical Supplies Module Routes
 *
 * The route gate lists both permissions rather than relying on the narrow one
 * alone, mirroring the backend's OR check exactly. A department that runs one
 * supply line holds `inventory.view`; one that appointed an EMS supply officer
 * grants only `inventory.view_medical`. Gating on the narrow permission by
 * itself would bounce the first group off a page the API would have served
 * them — a redirect to the dashboard with no explanation.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

/** Either grant opens the medical pages, matching the API's OR logic. */
export const MEDICAL_VIEW_PERMISSIONS = ['inventory.view_medical', 'inventory.view'];

const MedicalSuppliesPage = lazyWithRetry(() => import('./pages/MedicalSuppliesPage'));
const MedicalCategoriesPage = lazyWithRetry(() => import('./pages/MedicalCategoriesPage'));

export const getMedicalSuppliesRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/medical-supplies"
        element={
          <ProtectedRoute requiredAnyPermission={MEDICAL_VIEW_PERMISSIONS}>
            <Suspense fallback={null}>
              <MedicalSuppliesPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/medical-supplies/categories"
        element={
          <ProtectedRoute requiredAnyPermission={MEDICAL_VIEW_PERMISSIONS}>
            <Suspense fallback={null}>
              <MedicalCategoriesPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
