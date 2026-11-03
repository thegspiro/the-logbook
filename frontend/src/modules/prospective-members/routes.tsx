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
const FollowUpFormPage = lazyWithRetry(() => import('./pages/FollowUpFormPage'));
const ProspectLabelPrintPage = lazyWithRetry(() => import('./pages/ProspectLabelPrintPage'));
const SignOffsPage = lazyWithRetry(() => import('./pages/SignOffsPage'));
const MyApplicantsPage = lazyWithRetry(() => import('./pages/MyApplicantsPage'));

export const getProspectiveMembersRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/prospective-members/print-labels"
        element={
          <Suspense fallback={null}>
            {/* view_all, as the label API accepts: a label names applicants
                by id, and without view_all a member sees only the applicants
                assigned to them. */}
            <ProtectedRoute
              requiredModule="prospective_members"
              moduleLabel="Prospective Members"
              requiredPermission="prospective_members.view_all"
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

      {/* My Applicants: the applicants the caller is assigned to as case
          manager or interviewer. No permission beyond the module, like
          Sign-offs: an assigned board member holds none, and the server lists
          only the applicants the caller's assignments cover. */}
      <Route
        path="/prospective-members/my-applicants"
        element={
          <ProtectedRoute requiredModule="prospective_members" moduleLabel="Prospective Members">
            <Suspense fallback={null}>
              <MyApplicantsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Interview View */}
      <Route
        path="/prospective-members/:applicantId/interview"
        element={
          /*
            No permission here: an interviewer assigned to the applicant (a
            board member, a trustee) holds none. The backend admits the caller
            per applicant and answers 404 for anyone it does not.
          */
          <ProtectedRoute requiredModule="prospective_members" moduleLabel="Prospective Members">
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
      {/* Applicant follow-up form (no auth required; the link's token is the credential) */}
      <Route
        path="/application-form/:token"
        element={
          <Suspense fallback={null}>
            <FollowUpFormPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
