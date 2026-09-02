/**
 * Facilities Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /facilities              — Dashboard with summary cards and alerts
 *   /facilities/settings     — Manager-only lookup configuration
 *   /facilities/:id          — Full-page facility detail with sidebar nav
 *   /facilities/maintenance  — Cross-facility maintenance records
 *   /facilities/inspections  — Cross-facility inspections
 *   /locations               — Lightweight locations list (when Facilities module is off)
 *   /locations/qr-codes      — Printable directory of all room kiosk QR codes
 *   /apparatus-basic         — Lightweight apparatus view (when Apparatus module is off)
 *
 * Public routes (no auth):
 *   /display/:code           — Location kiosk display (for tablets in rooms)
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

/** Permissions that may enter the Facilities module from any discovery surface. */
export const FACILITY_ENTRY_PERMISSIONS = ['facilities.view', 'facilities.manage'] as const;

const FacilitiesDashboard = lazyWithRetry(() => import('./pages/FacilitiesDashboard'));
const FacilityLabelPrintPage = lazyWithRetry(() => import('./pages/FacilityLabelPrintPage'));
const FacilityDetailPage = lazyWithRetry(() => import('./pages/FacilityDetailPage'));
const MaintenanceListPage = lazyWithRetry(() => import('./pages/MaintenanceListPage'));
const InspectionsListPage = lazyWithRetry(() => import('./pages/InspectionsListPage'));
const FacilitiesSettingsPage = lazyWithRetry(() => import('./pages/FacilitiesSettingsPage'));
const LocationsPage = lazyWithRetry(() => import('../../pages/LocationsPage'));
const RoomQRCodesPage = lazyWithRetry(() => import('../../pages/RoomQRCodesPage'));
const ApparatusBasicPage = lazyWithRetry(() => import('../../pages/ApparatusBasicPage'));
const LocationKioskPage = lazyWithRetry(() => import('../../pages/LocationKioskPage'));
const GuestCheckInPage = lazyWithRetry(() => import('../../pages/GuestCheckInPage'));

/** Entry permission shared by every page in the Facilities workspace. */
/** Protected facilities routes (rendered inside AppLayout). */
export const getFacilitiesRoutes = () => (
  <React.Fragment>
    <Route
      path="/facilities/print-labels"
      element={
        <Suspense fallback={null}>
          <ProtectedRoute
            requiredModule="facilities"
            moduleLabel="Facilities"
            requiredAnyPermission={[...FACILITY_ENTRY_PERMISSIONS]}
          >
            <FacilityLabelPrintPage />
          </ProtectedRoute>
        </Suspense>
      }
    />
    {/* Cross-facility list pages — must be before /:id to avoid route conflicts */}
    <Route
      path="/facilities/settings"
      element={
        <Suspense fallback={null}>
          <ProtectedRoute requiredModule="facilities" moduleLabel="Facilities" requiredPermission="facilities.manage">
            <FacilitiesSettingsPage />
          </ProtectedRoute>
        </Suspense>
      }
    />
    <Route
      path="/facilities/maintenance"
      element={
        <Suspense fallback={null}>
          <ProtectedRoute
            requiredModule="facilities"
            moduleLabel="Facilities"
            requiredAnyPermission={[...FACILITY_ENTRY_PERMISSIONS]}
          >
            <MaintenanceListPage />
          </ProtectedRoute>
        </Suspense>
      }
    />
    <Route
      path="/facilities/inspections"
      element={
        <Suspense fallback={null}>
          <ProtectedRoute
            requiredModule="facilities"
            moduleLabel="Facilities"
            requiredAnyPermission={[...FACILITY_ENTRY_PERMISSIONS]}
          >
            <InspectionsListPage />
          </ProtectedRoute>
        </Suspense>
      }
    />
    {/* Facility detail page */}
    <Route
      path="/facilities/:id"
      element={
        <Suspense fallback={null}>
          <ProtectedRoute
            requiredModule="facilities"
            moduleLabel="Facilities"
            requiredAnyPermission={[...FACILITY_ENTRY_PERMISSIONS]}
          >
            <FacilityDetailPage />
          </ProtectedRoute>
        </Suspense>
      }
    />
    {/* Dashboard (landing page) */}
    <Route
      path="/facilities"
      element={
        <Suspense fallback={null}>
          <ProtectedRoute
            requiredModule="facilities"
            moduleLabel="Facilities"
            requiredAnyPermission={[...FACILITY_ENTRY_PERMISSIONS]}
          >
            <FacilitiesDashboard />
          </ProtectedRoute>
        </Suspense>
      }
    />
    <Route
      path="/locations"
      element={
        <Suspense fallback={null}>
          <LocationsPage />
        </Suspense>
      }
    />
    <Route
      path="/locations/qr-codes"
      element={
        <Suspense fallback={null}>
          {/* apparatus.view may enter for the apparatus shift check-in cards
              (permanent id-based URLs, no secret). Room kiosk codes are bearer
              credentials the backend redacts for non-managers, so those cards
              simply don't render for apparatus-only viewers. */}
          <ProtectedRoute
            requiredModule="facilities"
            moduleLabel="Facilities"
            requiredAnyPermission={['locations.manage', 'facilities.manage', 'apparatus.view']}
          >
            <RoomQRCodesPage />
          </ProtectedRoute>
        </Suspense>
      }
    />
    <Route
      path="/apparatus-basic"
      element={
        <Suspense fallback={null}>
          <ApparatusBasicPage />
        </Suspense>
      }
    />
  </React.Fragment>
);

/** Public location kiosk routes (no auth — for tablets in rooms). */
export const getFacilitiesPublicRoutes = () => (
  <React.Fragment>
    <Route
      path="/display/:code"
      element={
        <Suspense fallback={null}>
          <LocationKioskPage />
        </Suspense>
      }
    />
    {/* Guest sign-in landing page. Addressed through the room's display code
        so the backend can resolve the department without a session. */}
    <Route
      path="/display/:code/events/:eventId/guest"
      element={
        <Suspense fallback={null}>
          <GuestCheckInPage />
        </Suspense>
      }
    />
  </React.Fragment>
);
