/**
 * Storefront Module Routes
 *
 * Member-facing store and my-orders, plus the quartermaster admin console.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const StorefrontPage = lazyWithRetry(() => import('./pages/StorefrontPage'));
const MyOrdersPage = lazyWithRetry(() => import('./pages/MyOrdersPage'));
const StoreAdminPage = lazyWithRetry(() => import('./pages/StoreAdminPage'));

export const getStorefrontRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/store"
        element={
          <ProtectedRoute requiredPermission="storefront.view">
            <Suspense fallback={null}>
              <StorefrontPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/store/orders"
        element={
          <ProtectedRoute requiredPermission="storefront.view">
            <Suspense fallback={null}>
              <MyOrdersPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/store/admin"
        element={
          <ProtectedRoute requiredPermission="storefront.manage">
            <Suspense fallback={null}>
              <StoreAdminPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
