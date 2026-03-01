/**
 * Apparatus Module Routes
 *
 * This function returns route elements for the apparatus module.
 * To disable the apparatus module, simply remove or comment out
 * the call to this function in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ApparatusListPage = lazyWithRetry(
  () => import('./pages/ApparatusListPage'),
);
const ApparatusDetailPage = lazyWithRetry(
  () => import('./pages/ApparatusDetailPage'),
);
const ApparatusFormPage = lazyWithRetry(
  () => import('./pages/ApparatusFormPage'),
);

export const getApparatusRoutes = () => {
  return (
    <React.Fragment>
      {/* Apparatus List */}
      <Route
        path="/apparatus"
        element={
          <Suspense fallback={null}>
            <ApparatusListPage />
          </Suspense>
        }
      />

      {/* Add New Apparatus */}
      <Route
        path="/apparatus/new"
        element={
          <ProtectedRoute requiredPermission="apparatus.manage">
            <Suspense fallback={null}>
              <ApparatusFormPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Apparatus Detail */}
      <Route
        path="/apparatus/:id"
        element={
          <Suspense fallback={null}>
            <ApparatusDetailPage />
          </Suspense>
        }
      />

      {/* Edit Apparatus */}
      <Route
        path="/apparatus/:id/edit"
        element={
          <ProtectedRoute requiredPermission="apparatus.manage">
            <Suspense fallback={null}>
              <ApparatusFormPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
