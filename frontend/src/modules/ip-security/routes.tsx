/**
 * IP Security Module Routes
 *
 * - /ip-security: Admin management page (requires security.manage or settings.manage)
 * - /ip-security/my-requests: User's own IP exception requests (any authenticated user)
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const IPSecurityAdminPage = lazyWithRetry(
  () => import('./pages/IPSecurityAdminPage'),
);
const MyIPExceptionsPage = lazyWithRetry(
  () => import('./pages/MyIPExceptionsPage'),
);

export const getIPSecurityRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/ip-security"
        element={
          <ProtectedRoute requiredPermission="security.manage">
            <Suspense fallback={null}>
              <IPSecurityAdminPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/ip-security/my-requests"
        element={
          <ProtectedRoute>
            <Suspense fallback={null}>
              <MyIPExceptionsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
