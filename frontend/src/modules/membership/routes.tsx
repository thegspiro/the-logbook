/**
 * Membership Module Routes
 *
 * This function returns route elements for the membership module.
 * Pages are lazy-loaded for performance.
 *
 * Member-facing routes:
 *   /members - Member directory
 *   /members/scan - Scan a member ID (QR or barcode)
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

import React from "react";
import { Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "../../components/ProtectedRoute";
import { lazyWithRetry } from "../../utils/lazyWithRetry";

// Lazy-loaded pages
const Members = lazyWithRetry(() => import("../../pages/Members"));
const MemberProfilePage = lazyWithRetry(() =>
  import("../../pages/MemberProfilePage").then((m) => ({
    default: m.MemberProfilePage,
  })),
);
const MemberTrainingHistoryPage = lazyWithRetry(() =>
  import("../../pages/MemberTrainingHistoryPage").then((m) => ({
    default: m.MemberTrainingHistoryPage,
  })),
);
const MembersAdminHub = lazyWithRetry(() =>
  import("../../pages/MembersAdminHub").then((m) => ({
    default: m.MembersAdminHub,
  })),
);
const MemberAdminEditPage = lazyWithRetry(() =>
  import("../../pages/MemberAdminEditPage").then((m) => ({
    default: m.MemberAdminEditPage,
  })),
);
const MemberAuditHistoryPage = lazyWithRetry(() =>
  import("../../pages/MemberAuditHistoryPage").then((m) => ({
    default: m.MemberAuditHistoryPage,
  })),
);
const MemberIdCardPage = lazyWithRetry(() =>
  import("../../pages/MemberIdCardPage").then((m) => ({
    default: m.MemberIdCardPage,
  })),
);
const MemberScanPage = lazyWithRetry(() =>
  import("../../pages/MemberScanPage").then((m) => ({
    default: m.MemberScanPage,
  })),
);
const WaiverManagementPage = lazyWithRetry(() =>
  import("../../pages/WaiverManagementPage").then((m) => ({
    default: m.WaiverManagementPage,
  })),
);

export const getMembershipRoutes = () => {
  return (
    <React.Fragment>
      {/* Member-facing */}
      <Route path="/members" element={<Members />} />
      <Route path="/members/scan" element={<MemberScanPage />} />
      <Route path="/members/:userId" element={<MemberProfilePage />} />
      <Route
        path="/members/:userId/training"
        element={<MemberTrainingHistoryPage />}
      />
      <Route path="/members/:userId/id-card" element={<MemberIdCardPage />} />

      {/* Admin Hub */}
      <Route
        path="/members/admin"
        element={
          <ProtectedRoute requiredPermission="members.manage">
            <MembersAdminHub />
          </ProtectedRoute>
        }
      />

      {/* Admin Edit & History */}
      <Route
        path="/members/admin/edit/:userId"
        element={
          <ProtectedRoute requiredPermission="members.manage">
            <MemberAdminEditPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/members/admin/history/:userId"
        element={
          <ProtectedRoute requiredPermission="members.manage">
            <MemberAuditHistoryPage />
          </ProtectedRoute>
        }
      />

      {/* Waiver Management */}
      <Route
        path="/members/admin/waivers"
        element={
          <ProtectedRoute requiredPermission="members.manage">
            <WaiverManagementPage />
          </ProtectedRoute>
        }
      />

      {/* Legacy redirects to admin hub */}
      <Route
        path="/admin/members"
        element={<Navigate to="/members/admin" replace />}
      />
      <Route
        path="/members/add"
        element={<Navigate to="/members/admin?tab=add" replace />}
      />
      <Route
        path="/members/import"
        element={<Navigate to="/members/admin?tab=import" replace />}
      />
    </React.Fragment>
  );
};
