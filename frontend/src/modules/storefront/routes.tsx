/**
 * Storefront Module Routes
 *
 * Member-facing store and my-orders, plus the quartermaster admin console.
 */

import React, { Suspense } from 'react';
import { Navigate, Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const StorefrontPage = lazyWithRetry(() => import('./pages/StorefrontPage'));
const CheckoutPage = lazyWithRetry(() => import('./pages/CheckoutPage'));
const MyOrdersPage = lazyWithRetry(() => import('./pages/MyOrdersPage'));
const StoreAdminPage = lazyWithRetry(() => import('./pages/StoreAdminPage'));

export const getStorefrontRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/store"
        element={
          <ProtectedRoute
            requiredPermission="storefront.view"
            requiredModule="storefront"
            moduleLabel="The Department Store"
          >
            <Suspense fallback={null}>
              <StorefrontPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/store/checkout"
        element={
          <ProtectedRoute
            requiredPermission="storefront.view"
            requiredModule="storefront"
            moduleLabel="The Department Store"
          >
            <Suspense fallback={null}>
              <CheckoutPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/store/orders"
        element={
          <ProtectedRoute
            requiredPermission="storefront.view"
            requiredModule="storefront"
            moduleLabel="The Department Store"
          >
            <Suspense fallback={null}>
              <MyOrdersPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* The admin console lives inside Inventory Administration: the store
          sells the uniforms the inventory module tracks, and it is the same
          officer's job. It is declared here rather than in the inventory
          module's routes so the page stays with its own module — and keeps
          its own gates, which are orthogonal to the inventory ones. A
          department can run either without the other. */}
      <Route
        path="/inventory/admin/store"
        element={
          <ProtectedRoute
            requiredPermission="storefront.manage"
            requiredModule="storefront"
            moduleLabel="The Department Store"
          >
            <Suspense fallback={null}>
              <StoreAdminPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* The console's old address, kept for bookmarks. Unwrapped, like the
          other redirects in the app: the target route carries the gate, and
          refusing here would only change which page says no. */}
      <Route path="/store/admin" element={<Navigate to="/inventory/admin/store" replace />} />
    </React.Fragment>
  );
};
