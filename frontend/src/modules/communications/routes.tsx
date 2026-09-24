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

const MessageDetailPage = lazyWithRetry(() => import('./pages/MessageDetailPage'));

const PhotoUseConsentPage = lazyWithRetry(() => import('./pages/PhotoUseConsentPage'));

const SuggestionBoxesAdminPage = lazyWithRetry(() => import('./pages/SuggestionBoxesAdminPage'));

const SuggestionsPage = lazyWithRetry(() => import('./pages/SuggestionsPage'));

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
          <ProtectedRoute
            requiredAnyPermission={['users.view_consents', 'notifications.manage', 'members.manage', 'users.edit']}
          >
            <Suspense fallback={null}>
              <PhotoUseConsentPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/communications/suggestion-boxes"
        element={
          <ProtectedRoute requiredPermission="suggestions.manage">
            <Suspense fallback={null}>
              <SuggestionBoxesAdminPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      {/* Sign-in only: every member may submit, and who may review is decided
          per box by the backend, not by a permission this route could check. */}
      <Route
        path="/suggestions"
        element={
          <ProtectedRoute>
            <Suspense fallback={null}>
              <SuggestionsPage />
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
      {/* Sits under /messages so the breadcrumb path back to the inbox is the
          URL's own parent — no permission beyond sign-in, because the backend
          only serves a message the caller was actually targeted with. */}
      <Route
        path="/messages/:messageId"
        element={
          <ProtectedRoute>
            <Suspense fallback={null}>
              <MessageDetailPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
