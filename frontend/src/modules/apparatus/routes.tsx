/**
 * Apparatus Module Routes
 *
 * This function returns route elements for the apparatus module.
 * To disable the apparatus module, simply remove or comment out
 * the call to this function in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ApparatusListPage = lazyWithRetry(() => import('./pages/ApparatusListPage'));
const ApparatusDetailPage = lazyWithRetry(() => import('./pages/ApparatusDetailPage'));
const ApparatusFormPage = lazyWithRetry(() => import('./pages/ApparatusFormPage'));
const ApparatusLabelPrintPage = lazyWithRetry(() => import('./pages/ApparatusLabelPrintPage'));

export const getApparatusRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/apparatus/print-labels"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute
              requiredModule="apparatus"
              moduleLabel="Apparatus"
              requiredAnyPermission={['apparatus.view', 'apparatus.manage']}
            >
              <ApparatusLabelPrintPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      {/* Apparatus List */}
      <Route
        path="/apparatus"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute
              requiredModule="apparatus"
              moduleLabel="Apparatus"
              requiredAnyPermission={['apparatus.view', 'apparatus.manage']}
            >
              <ApparatusListPage />
            </ProtectedRoute>
          </Suspense>
        }
      />

      {/* Add New Apparatus */}
      <Route
        path="/apparatus/new"
        element={
          <ProtectedRoute
            requiredModule="apparatus"
            moduleLabel="Apparatus"
            requiredAnyPermission={['apparatus.create', 'apparatus.manage']}
          >
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
            <ProtectedRoute
              requiredModule="apparatus"
              moduleLabel="Apparatus"
              requiredAnyPermission={['apparatus.view', 'apparatus.manage']}
            >
              <ApparatusDetailPage />
            </ProtectedRoute>
          </Suspense>
        }
      />

      {/* Edit Apparatus */}
      <Route
        path="/apparatus/:id/edit"
        element={
          <ProtectedRoute
            requiredModule="apparatus"
            moduleLabel="Apparatus"
            requiredAnyPermission={['apparatus.edit', 'apparatus.manage']}
          >
            <Suspense fallback={null}>
              <ApparatusFormPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
