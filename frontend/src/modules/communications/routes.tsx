/**
 * Communications Module Routes
 *
 * Defines route components for the communications module.
 */

import React from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const EmailTemplatesPage = lazyWithRetry(
  () => import('./pages/EmailTemplatesPage'),
);

export const getCommunicationsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/communications/email-templates"
        element={
          <ProtectedRoute requiredPermission="settings.manage">
            <EmailTemplatesPage />
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
