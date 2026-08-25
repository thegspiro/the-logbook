/**
 * Communications Module Routes
 *
 * Defines route components for the communications module.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const EmailTemplatesPage = lazyWithRetry(() => import('./pages/EmailTemplatesPage'));

const MessagesAdminPage = lazyWithRetry(() => import('./pages/MessagesAdminPage'));

const MessagesInboxPage = lazyWithRetry(() => import('./pages/MessagesInboxPage'));

const PhotoUseConsentPage = lazyWithRetry(() => import('./pages/PhotoUseConsentPage'));

export const getCommunicationsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/communications/email-templates"
        element={
          <ProtectedRoute requiredPermission="settings.manage">
            <Suspense fallback={null}>
              <EmailTemplatesPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/communications/messages"
        element={
          <ProtectedRoute requiredPermission="notifications.manage">
            <Suspense fallback={null}>
              <MessagesAdminPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/communications/photo-use-consent"
        element={
          <ProtectedRoute requiredPermission="users.view">
            <Suspense fallback={null}>
              <PhotoUseConsentPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/messages"
        element={
          <ProtectedRoute>
            <Suspense fallback={null}>
              <MessagesInboxPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
