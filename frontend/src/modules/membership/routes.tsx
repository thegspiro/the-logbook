/**
 * Membership Module Routes
 *
 * This function returns route elements for the membership module.
 * Pages are lazy-loaded for performance.
 *
 * Member-facing routes:
 *   /members - Member directory
 *   /members/:userId - Member profile
 *   /members/:userId/training - Member training history
 *
 * Admin hub:
 *   /members/admin - Tabbed admin hub (manage, add, import)
 *
 * Legacy redirects:
 *   /admin/members → /members/admin
 *   /members/add → /members/admin?tab=add
 *   /members/import → /members/admin?tab=import
 */

import React, { lazy } from 'react';
import { Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';

// Lazy-loaded pages
const Members = lazy(() => import('../../pages/Members'));
const MemberProfilePage = lazy(() =>
  import('../../pages/MemberProfilePage').then((m) => ({
    default: m.MemberProfilePage,
  }))
);
const MemberTrainingHistoryPage = lazy(() =>
  import('../../pages/MemberTrainingHistoryPage').then((m) => ({
    default: m.MemberTrainingHistoryPage,
  }))
);
const MembersAdminHub = lazy(() =>
  import('../../pages/MembersAdminHub').then((m) => ({
    default: m.MembersAdminHub,
  }))
);

export const getMembershipRoutes = () => {
  return (
    <React.Fragment>
      {/* Member-facing */}
      <Route path="/members" element={<Members />} />
      <Route path="/members/:userId" element={<MemberProfilePage />} />
      <Route path="/members/:userId/training" element={<MemberTrainingHistoryPage />} />

      {/* Admin Hub */}
      <Route
        path="/members/admin"
        element={
          <ProtectedRoute requiredPermission="members.manage">
            <MembersAdminHub />
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
