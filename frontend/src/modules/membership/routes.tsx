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

import React, { Suspense } from "react";
import { Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "../../components/ProtectedRoute";
import { lazyWithRetry } from "../../utils/lazyWithRetry";

// Lazy-loaded pages
const Members = lazyWithRetry(() => import("../../pages/Members"));
const MemberProfilePage = lazyWithRetry(() => import("../../pages/MemberProfilePage"));
const MemberTrainingHistoryPage = lazyWithRetry(() => import("../../pages/MemberTrainingHistoryPage"));
const MembersAdminHub = lazyWithRetry(() => import("../../pages/MembersAdminHub"));
const MemberAdminEditPage = lazyWithRetry(() => import("../../pages/MemberAdminEditPage"));
const MemberAuditHistoryPage = lazyWithRetry(() => import("../../pages/MemberAuditHistoryPage"));
const MemberIdCardPage = lazyWithRetry(() => import("../../pages/MemberIdCardPage"));
const MemberScanPage = lazyWithRetry(() => import("../../pages/MemberScanPage"));
const WaiverManagementPage = lazyWithRetry(() => import("../../pages/WaiverManagementPage"));

export const getMembershipRoutes = () => {
  return (
    <React.Fragment>
      {/* Member-facing */}
      <Route path="/members" element={<Suspense fallback={null}><Members /></Suspense>} />
      <Route path="/members/scan" element={<Suspense fallback={null}><MemberScanPage /></Suspense>} />
      <Route path="/members/:userId" element={<Suspense fallback={null}><MemberProfilePage /></Suspense>} />
      <Route
        path="/members/:userId/training"
        element={<Suspense fallback={null}><MemberTrainingHistoryPage /></Suspense>}
      />
      <Route path="/members/:userId/id-card" element={<Suspense fallback={null}><MemberIdCardPage /></Suspense>} />

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
