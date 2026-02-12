/**
 * Membership Module Routes
 *
 * This function returns route elements for the membership module.
 * Pages are lazy-loaded for performance.
 *
 * To disable the membership module, simply remove or comment out
 * the call to this function in App.tsx.
 */

import React, { lazy } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';

// Lazy-loaded pages (still in pages/ directory — will be migrated incrementally)
const Members = lazy(() => import('../../pages/Members'));
const AddMember = lazy(() => import('../../pages/AddMember'));
const ImportMembers = lazy(() => import('../../pages/ImportMembers'));
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
const MembersAdminPage = lazy(() =>
  import('../../pages/MembersAdminPage').then((m) => ({
    default: m.MembersAdminPage,
  }))
);

export const getMembershipRoutes = () => {
  return (
    <React.Fragment>
      {/* Member List */}
      <Route path="/members" element={<Members />} />

      {/* Add Member */}
      <Route
        path="/members/add"
        element={
          <ProtectedRoute requiredPermission="members.create">
            <AddMember />
          </ProtectedRoute>
        }
      />

      {/* Import Members */}
      <Route
        path="/members/import"
        element={
          <ProtectedRoute requiredPermission="members.create">
            <ImportMembers />
          </ProtectedRoute>
        }
      />

      {/* Member Profile */}
      <Route path="/members/:userId" element={<MemberProfilePage />} />

      {/* Member Training History */}
      <Route
        path="/members/:userId/training"
        element={<MemberTrainingHistoryPage />}
      />

      {/* Admin: Member Management */}
      <Route
        path="/admin/members"
        element={
          <ProtectedRoute requiredPermission="members.manage">
            <MembersAdminPage />
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
