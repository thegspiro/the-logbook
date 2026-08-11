/**
 * Training Module Routes
 *
 * This function returns route elements for the training module,
 * including member-facing pages, admin hub, skills testing,
 * and legacy redirects to the unified admin hub.
 *
 * To disable the training module, simply remove or comment out
 * the call to getTrainingRoutes() in App.tsx.
 */

import React from 'react';
import { Route, Navigate } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { CourseLibraryRoute } from './components/CourseLibraryRoute';

// Training Module - Member-facing
const MyTrainingPage = lazyWithRetry(() => import('../../pages/MyTrainingPage'));
const SubmitTrainingPage = lazyWithRetry(() => import('../../pages/SubmitTrainingPage'));
const TrainingProgramsPage = lazyWithRetry(() => import('../../pages/TrainingProgramsPage'));
const PipelineDetailPage = lazyWithRetry(() => import('../../pages/PipelineDetailPage'));
const MyProgramProgressPage = lazyWithRetry(() => import('../../pages/MyProgramProgressPage'));
const MySkillTestResultPage = lazyWithRetry(() => import('../../pages/MySkillTestResultPage'));

// Training Module - Course Cohorts (multi-class courses)
const CohortsPage = lazyWithRetry(() => import('../../pages/training/CohortsPage'));
const CohortDetailPage = lazyWithRetry(() => import('../../pages/training/CohortDetailPage'));

// Training Module - Admin
const TrainingAdminPage = lazyWithRetry(() =>
  import('../../pages/TrainingAdminPage').then((m) => ({
    default: m.TrainingAdminPage,
  }))
);

// Compliance Requirements Configuration
const ComplianceRequirementsConfigPage = lazyWithRetry(() => import('../../pages/ComplianceRequirementsConfigPage'));

// Skills Testing Module
const SkillsTestingPage = lazyWithRetry(() =>
  import('../../pages/SkillsTestingPage').then((m) => ({
    default: m.SkillsTestingPage,
  }))
);
const SkillTemplateBuilderPage = lazyWithRetry(() => import('../../pages/SkillTemplateBuilderPage'));
const StartSkillTestPage = lazyWithRetry(() => import('../../pages/StartSkillTestPage'));
const ActiveSkillTestPage = lazyWithRetry(() => import('../../pages/ActiveSkillTestPage'));

// Training Module - Manual Shift Report (scheduling module disabled)
const ManualShiftReportPage = lazyWithRetry(() => import('../../pages/training/ManualShiftReportPage'));

// Training Module - Print Pages
const MemberTrainingPrintPage = lazyWithRetry(() => import('../../pages/training/MemberTrainingPrintPage'));
const ProgramPrintPage = lazyWithRetry(() => import('../../pages/training/ProgramPrintPage'));
const CompliancePrintPage = lazyWithRetry(() => import('../../pages/training/CompliancePrintPage'));
const SkillSheetPrintPage = lazyWithRetry(() => import('../../pages/training/SkillSheetPrintPage'));

export const getTrainingRoutes = () => {
  return (
    <React.Fragment>
      {/* Training Module - Member-facing */}
      <Route path="/training" element={<MyTrainingPage />} />
      <Route path="/training/my-training" element={<MyTrainingPage />} />
      <Route path="/training/submit" element={<SubmitTrainingPage />} />
      <Route path="/training/courses" element={<CourseLibraryRoute />} />
      <Route path="/training/programs" element={<TrainingProgramsPage />} />
      <Route path="/training/programs/:programId" element={<PipelineDetailPage />} />
      {/* Member-facing read-only progression view for one enrollment */}
      <Route path="/training/my-progress/:enrollmentId" element={<MyProgramProgressPage />} />
      {/* Member-facing read-only skills-test result. Auth-only on purpose: the
          examiner routes below require training.manage, which is exactly why a
          candidate previously could not see their own result. The API scopes a
          non-officer to tests they are party to, so this cannot expose someone
          else's scorecard. */}
      <Route path="/training/my-skill-tests/:testId" element={<MySkillTestResultPage />} />

      {/* Course Cohorts — scheduled runs of a multi-class course */}
      <Route
        path="/training/cohorts"
        element={
          <ProtectedRoute requiredPermission="training.manage">
            <CohortsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/cohorts/:cohortId"
        element={
          <ProtectedRoute requiredPermission="training.manage">
            <CohortDetailPage />
          </ProtectedRoute>
        }
      />

      {/* Training Module - Admin Hub */}
      <Route
        path="/training/admin"
        element={
          <ProtectedRoute requiredPermission="training.manage">
            <TrainingAdminPage />
          </ProtectedRoute>
        }
      />

      {/* Compliance Requirements Configuration */}
      <Route
        path="/training/compliance-config"
        element={
          <ProtectedRoute requiredPermission="settings.manage">
            <ComplianceRequirementsConfigPage />
          </ProtectedRoute>
        }
      />

      {/* Training Module - Legacy redirects to admin hub sub-pages */}
      <Route path="/training/officer" element={<Navigate to="/training/admin?page=dashboard&tab=overview" replace />} />
      <Route
        path="/training/submissions"
        element={<Navigate to="/training/admin?page=records&tab=submissions" replace />}
      />
      <Route
        path="/training/requirements"
        element={<Navigate to="/training/admin?page=setup&tab=requirements" replace />}
      />
      <Route
        path="/training/sessions/new"
        element={<Navigate to="/training/admin?page=records&tab=sessions" replace />}
      />
      <Route
        path="/training/programs/new"
        element={<Navigate to="/training/admin?page=setup&tab=pipelines" replace />}
      />
      <Route
        path="/training/shift-reports"
        element={<Navigate to="/training/admin?page=records&tab=shift-reports" replace />}
      />
      <Route
        path="/training/integrations"
        element={<Navigate to="/training/admin?page=setup&tab=integrations" replace />}
      />

      {/* Manual Shift Report — fallback for orgs without scheduling */}
      <Route
        path="/training/log-shift"
        element={
          <ProtectedRoute requiredPermission="training.manage">
            <ManualShiftReportPage />
          </ProtectedRoute>
        }
      />

      {/* Skills Testing Module.
          Template authoring stays officer-only (training.manage). Taking and
          running tests is auth-only: any member may drill on their own and any
          member may examine, because departments routinely use senior members
          as evaluators. The officer's authority is at validation, which the
          backend enforces — as it does per-record read access, so a member
          reaching a test they are not party to gets a 404 from the API rather
          than a route they should not have been able to open. */}
      <Route
        path="/training/skills-testing"
        element={
          <ProtectedRoute>
            <SkillsTestingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/skills-testing/templates/new"
        element={
          <ProtectedRoute requiredPermission="training.manage">
            <SkillTemplateBuilderPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/skills-testing/templates/:id"
        element={
          <ProtectedRoute requiredPermission="training.manage">
            <SkillTemplateBuilderPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/skills-testing/templates/:id/edit"
        element={
          <ProtectedRoute requiredPermission="training.manage">
            <SkillTemplateBuilderPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/skills-testing/test/new"
        element={
          <ProtectedRoute>
            <StartSkillTestPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/skills-testing/test/:testId"
        element={
          <ProtectedRoute>
            <ActiveSkillTestPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/skills-testing/test/:testId/active"
        element={
          <ProtectedRoute>
            <ActiveSkillTestPage />
          </ProtectedRoute>
        }
      />
      {/* Training Module - Print Pages */}
      {/* Member/program print are auth-only (not training.manage) because
          members print their own history; per-record authorization is
          enforced by the backend, which scopes non-officers to their own
          records. */}
      <Route
        path="/training/print/member"
        element={
          <ProtectedRoute>
            <React.Suspense fallback={null}>
              <MemberTrainingPrintPage />
            </React.Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/print/program"
        element={
          <ProtectedRoute>
            <React.Suspense fallback={null}>
              <ProgramPrintPage />
            </React.Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/training/print/compliance"
        element={
          <ProtectedRoute requiredPermission="training.manage">
            <React.Suspense fallback={null}>
              <CompliancePrintPage />
            </React.Suspense>
          </ProtectedRoute>
        }
      />
      {/* A blank skill sheet carries no member data — it is the empty form, and
          the templates list that links to it is already visible to members
          under the template's own visibility rules. Auth-only, like the member
          and program prints; the backend's template fetch enforces visibility
          and org scoping. */}
      <Route
        path="/training/skills-testing/print/template"
        element={
          <ProtectedRoute>
            <React.Suspense fallback={null}>
              <SkillSheetPrintPage />
            </React.Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
