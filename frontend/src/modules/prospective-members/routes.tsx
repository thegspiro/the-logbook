/**
 * Prospective Members Module Routes
 *
 * This function returns route elements for the prospective members module.
 * To disable this module, simply remove or comment out
 * the call to this function in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ProspectiveMembersPage = lazyWithRetry(() => import('./pages/ProspectiveMembersPage'));
const PipelineSettingsPage = lazyWithRetry(() => import('./pages/PipelineSettingsPage'));
const ApplicationStatusPage = lazyWithRetry(() =>
  import('./pages/ApplicationStatusPage').then((m) => ({
    default: m.ApplicationStatusPage,
  }))
);
const InterviewPage = lazyWithRetry(() => import('./pages/InterviewPage'));
const ProspectLabelPrintPage = lazyWithRetry(() => import('./pages/ProspectLabelPrintPage'));
const SignOffsPage = lazyWithRetry(() => import('./pages/SignOffsPage'));

export const getProspectiveMembersRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/prospective-members/print-labels"
        element={
          <Suspense fallback={null}>
            {/* View or manage, as the label API accepts: a coordinator holds
                manage alone, and the pipeline's own Print Labels button sent
                them to an Access Denied page. */}
            <ProtectedRoute
              requiredModule="prospective_members"
              moduleLabel="Prospective Members"
              requiredAnyPermission={['prospective_members.view', 'prospective_members.manage']}
            >
              <ProspectLabelPrintPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      {/* Prospective Members Pipeline */}
      <Route
        path="/prospective-members"
        element={
          <ProtectedRoute
            requiredModule="prospective_members"
            moduleLabel="Prospective Members"
            requiredPermission="prospective_members.manage"
          >
            <Suspense fallback={null}>
              <ProspectiveMembersPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Pipeline Settings */}
      <Route
        path="/prospective-members/settings"
        element={
          <ProtectedRoute
            requiredModule="prospective_members"
            moduleLabel="Prospective Members"
            requiredPermission="prospective_members.manage"
          >
            <Suspense fallback={null}>
              <PipelineSettingsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Sign-offs: no permission beyond the module. The officers a
          Multi-Signer Approval stage names rarely hold prospective_members
          access, and the server lists only stages asking for a role the
          caller holds. */}
      <Route
        path="/prospective-members/sign-offs"
        element={
          <ProtectedRoute requiredModule="prospective_members" moduleLabel="Prospective Members">
            <Suspense fallback={null}>
              <SignOffsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Interview View */}
      <Route
        path="/prospective-members/:applicantId/interview"
        element={
          <ProtectedRoute
            requiredModule="prospective_members"
            moduleLabel="Prospective Members"
            requiredPermission="prospective_members.manage"
          >
            <Suspense fallback={null}>
              <InterviewPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};

/**
 * Public routes for the prospective members module (no auth required).
 * These must be rendered OUTSIDE the ProtectedRoute/AppLayout wrapper.
 */
export const getProspectiveMembersPublicRoutes = () => {
  return (
    <React.Fragment>
      {/* Public Application Status (no auth required) */}
      <Route
        path="/application-status/:token"
        element={
          <Suspense fallback={null}>
            <ApplicationStatusPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
