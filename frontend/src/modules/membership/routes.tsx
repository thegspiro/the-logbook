/**
 * Membership Module Routes
 *
 * This function returns route elements for the membership module.
 * Pages are lazy-loaded for performance.
 *
 * Member-facing routes:
 *   /members - Member directory
 *   /members/scan - Scan a member ID (QR or barcode)
 *   /members/check-in-station - Tap ID cards to check members into a shift, event or admin hours
 *   /members/:userId - Member profile
 *   /members/:userId/training - Member training history
 *   /members/:userId/id-card - Digital member ID card with QR code
 *
 * Admin hub:
 *   /members/admin - Tabbed admin hub (manage, add, import)
 *   /members/admin/edit/:userId - Admin member edit page
 *   /members/admin/history/:userId - Member audit history
 *
 * Legacy redirects:
 *   /admin/members → /members/admin
 *   /members/add → /members/admin?tab=add
 *   /members/import → /members/admin?tab=import
 */

import React, { Suspense } from 'react';
import { Route, Navigate } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

// Lazy-loaded pages
const Members = lazyWithRetry(() => import('../../pages/Members'));
const MemberProfilePage = lazyWithRetry(() => import('../../pages/MemberProfilePage'));
const MemberTrainingHistoryPage = lazyWithRetry(() => import('../../pages/MemberTrainingHistoryPage'));
const MembersAdminHub = lazyWithRetry(() => import('../../pages/MembersAdminHub'));
const MembersSettingsPage = lazyWithRetry(() => import('../../pages/members/admin/settings/MembersSettingsPage'));
const MembersSettingsRedirect = lazyWithRetry(
  () => import('../../pages/members/admin/settings/MembersSettingsRedirect')
);

/**
 * What each Members settings route admits — the section's own endpoint grants,
 * plus the hub's.
 *
 * Gating these on `members.manage` alone locked out the people the move took
 * the page away from. An officer holding `settings.manage` and not
 * `members.manage` ran Contact Visibility, Membership IDs and the rank ladder
 * from `/settings`; after the move the legacy redirect lands them here and a
 * `members.manage` gate refuses them before `MembersSettingsPage` can apply the
 * per-section filtering that would have admitted them. The endpoints still
 * accept them, so that was access lost to the route rather than to any
 * decision. `members.manage` stays in each list so a roster officer still
 * reaches the screen and is told which sections their grants open, rather than
 * meeting a bare Access Denied.
 *
 * Literal arrays declared here rather than derived from
 * `membersSettingsSections.ts`, matching `MEDICAL_VIEW_PERMISSIONS` and
 * `LEGAL_DOCUMENTS_PERMISSIONS`. Three separate checkers read route gates
 * straight out of this file — `scripts/check_route_permissions.py`,
 * `breadcrumbRoutes.test.ts` and `testingRegistry.test.ts` — and none of them
 * evaluates TypeScript or follows an import. A gate they cannot resolve is a
 * gate nothing verifies, so `membersSettingsRoutes.test.ts` asserts each of
 * these equals its section's declared permissions instead: the manifest stays
 * the single source of truth, enforced by a test rather than by an import the
 * tooling cannot see through.
 */
export const MEMBERS_SETTINGS_VISIBILITY_GATE = [
  'settings.manage',
  'settings.manage_contact_visibility',
  'organization.update_settings',
  'members.manage',
];
export const MEMBERS_SETTINGS_IDS_GATE = ['settings.edit', 'organization.update_settings', 'members.manage'];
export const MEMBERS_SETTINGS_RANKS_GATE = ['settings.manage', 'members.manage'];
export const MEMBERS_SETTINGS_EVOC_GATE = ['apparatus.manage', 'members.manage'];

/**
 * Anything that admits an officer to at least one section, for the bare path.
 *
 * Spelled out rather than spread from the four above for the same reason they
 * are literals: `check_route_permissions.py` reads the first `[...]` after the
 * name, so a computed union scored this route as authenticated-only — the
 * silently-permissive answer that checker exists to refuse. The union is
 * asserted against the four in `membersSettingsRoutes.test.ts`.
 */
export const MEMBERS_SETTINGS_ANY_PERMISSION = [
  'settings.manage',
  'settings.manage_contact_visibility',
  'organization.update_settings',
  'members.manage',
  'settings.edit',
  'apparatus.manage',
];
const MemberAdminEditPage = lazyWithRetry(() => import('../../pages/MemberAdminEditPage'));
const MemberAuditHistoryPage = lazyWithRetry(() => import('../../pages/MemberAuditHistoryPage'));
const MemberIdCardPage = lazyWithRetry(() => import('../../pages/MemberIdCardPage'));
const MemberScanPage = lazyWithRetry(() => import('../../pages/MemberScanPage'));
const CheckInStationPage = lazyWithRetry(() => import('./pages/CheckInStationPage'));
const WaiverManagementPage = lazyWithRetry(() => import('../../pages/WaiverManagementPage'));
const MemberLabelPrintPage = lazyWithRetry(() => import('../../pages/MemberLabelPrintPage'));

export const getMembershipRoutes = () => {
  return (
    <React.Fragment>
      {/* Member-facing */}
      <Route
        path="/members"
        element={
          <Suspense fallback={null}>
            <Members />
          </Suspense>
        }
      />
      <Route
        path="/members/print-labels"
        element={
          <Suspense fallback={null}>
            <ProtectedRoute requiredPermission="members.view">
              <MemberLabelPrintPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/members/scan"
        element={
          <Suspense fallback={null}>
            {/* Deliberately narrower than the directory (members.view): the
                scanner is a validation tool for positions that check people
                in (quartermaster etc.), not a general lookup surface. */}
            <ProtectedRoute requiredAnyPermission={['users.view', 'members.manage']}>
              <MemberScanPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/members/check-in-station"
        element={
          <Suspense fallback={null}>
            {/* Recording attendance for other members is its own grant: a duty
                officer running the station does not thereby gain the ability
                to edit the shift or the event it writes to. */}
            <ProtectedRoute requiredPermission="members.check_in">
              <CheckInStationPage />
            </ProtectedRoute>
          </Suspense>
        }
      />
      <Route
        path="/members/:userId"
        element={
          <Suspense fallback={null}>
            <MemberProfilePage />
          </Suspense>
        }
      />
      {/* A member's training history is Training's data on a Membership
          route, and the page's only fetch is trainingService.getRecords().
          Without the module gate a department that switched Training off
          reached this from the member profile and got the page's generic
          "check your connection" error, because the gate answers 403 and the
          page cannot tell that apart from a network fault. Gated on the
          module alone: who may read another member's training record is a
          separate question this route already answers its own way. */}
      <Route
        path="/members/:userId/training"
        element={
          <ProtectedRoute requiredModule="training" moduleLabel="Training">
            <Suspense fallback={null}>
              <MemberTrainingHistoryPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/members/:userId/id-card"
        element={
          <Suspense fallback={null}>
            <MemberIdCardPage />
          </Suspense>
        }
      />

      {/* Admin Hub */}
      <Route
        path="/members/admin"
        element={
          <ProtectedRoute requiredPermission="members.manage">
            <Suspense fallback={null}>
              <MembersAdminHub />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Members settings, moved out of the global settings page.

          Gated on `members.manage` like the rest of this area, but that is the
          gate for *reaching* the screen only — neither setting here saves
          through an endpoint that accepts it, so the page itself filters the
          sections to the ones the officer's grants admit. See
          `membersSettingsSections.ts`; putting the endpoint's own answer beside
          the section is what stops a members officer meeting a 403 on every
          toggle. */}
      <Route
        path="/members/admin/settings"
        element={
          <ProtectedRoute requiredAnyPermission={MEMBERS_SETTINGS_ANY_PERMISSION}>
            <Suspense fallback={null}>
              <MembersSettingsRedirect />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/members/admin/settings/visibility"
        element={
          <ProtectedRoute requiredAnyPermission={MEMBERS_SETTINGS_VISIBILITY_GATE}>
            <Suspense fallback={null}>
              <MembersSettingsPage section="visibility" />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/members/admin/settings/ids"
        element={
          <ProtectedRoute requiredAnyPermission={MEMBERS_SETTINGS_IDS_GATE}>
            <Suspense fallback={null}>
              <MembersSettingsPage section="ids" />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/members/admin/settings/ranks"
        element={
          <ProtectedRoute requiredAnyPermission={MEMBERS_SETTINGS_RANKS_GATE}>
            <Suspense fallback={null}>
              <MembersSettingsPage section="ranks" />
            </Suspense>
          </ProtectedRoute>
        }
      />
      {/* EVOC's route admits `apparatus.manage` (what its endpoints want) and
          `members.manage` (so a roster officer reaches the screen and is told
          which sections their grants open). The page still filters the section
          itself, rather than offering a ladder every write refuses. */}
      <Route
        path="/members/admin/settings/evoc"
        element={
          <ProtectedRoute requiredAnyPermission={MEMBERS_SETTINGS_EVOC_GATE}>
            <Suspense fallback={null}>
              <MembersSettingsPage section="evoc" />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Admin Edit & History */}
      <Route
        path="/members/admin/edit/:userId"
        element={
          <ProtectedRoute requiredPermission="members.manage">
            <Suspense fallback={null}>
              <MemberAdminEditPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/members/admin/history/:userId"
        element={
          <ProtectedRoute requiredPermission="members.manage">
            <Suspense fallback={null}>
              <MemberAuditHistoryPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Waiver Management */}
      <Route
        path="/members/admin/waivers"
        element={
          <ProtectedRoute requiredPermission="members.manage">
            <Suspense fallback={null}>
              <WaiverManagementPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Legacy redirects to admin hub */}
      <Route path="/admin/members" element={<Navigate to="/members/admin" replace />} />
      <Route path="/members/add" element={<Navigate to="/members/admin?tab=add" replace />} />
      <Route path="/members/import" element={<Navigate to="/members/admin?tab=import" replace />} />
    </React.Fragment>
  );
};
