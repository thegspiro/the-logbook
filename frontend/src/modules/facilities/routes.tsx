/**
 * Facilities Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /facilities              — Dashboard with summary cards and alerts
 *   /facilities/:id          — Full-page facility detail with sidebar nav
 *   /facilities/maintenance  — Cross-facility maintenance records
 *   /facilities/inspections  — Cross-facility inspections
 *   /locations               — Lightweight locations list (when Facilities module is off)
 *   /apparatus-basic         — Lightweight apparatus view (when Apparatus module is off)
 *
 * Public routes (no auth):
 *   /display/:code           — Location kiosk display (for tablets in rooms)
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const FacilitiesDashboard = lazyWithRetry(
  () => import('./pages/FacilitiesDashboard'),
);
const FacilityDetailPage = lazyWithRetry(
  () => import('./pages/FacilityDetailPage'),
);
const MaintenanceListPage = lazyWithRetry(
  () => import('./pages/MaintenanceListPage'),
);
const InspectionsListPage = lazyWithRetry(
  () => import('./pages/InspectionsListPage'),
);
const LocationsPage = lazyWithRetry(() => import('../../pages/LocationsPage'));
const ApparatusBasicPage = lazyWithRetry(
  () => import('../../pages/ApparatusBasicPage'),
);
const LocationKioskPage = lazyWithRetry(
  () => import('../../pages/LocationKioskPage'),
);

/** Protected facilities routes (rendered inside AppLayout). */
export const getFacilitiesRoutes = () => (
  <React.Fragment>
    {/* Cross-facility list pages — must be before /:id to avoid route conflicts */}
    <Route
      path="/facilities/maintenance"
      element={
        <Suspense fallback={null}>
          <MaintenanceListPage />
        </Suspense>
      }
    />
    <Route
      path="/facilities/inspections"
      element={
        <Suspense fallback={null}>
          <InspectionsListPage />
        </Suspense>
      }
    />
    {/* Facility detail page */}
    <Route
      path="/facilities/:id"
      element={
        <Suspense fallback={null}>
          <FacilityDetailPage />
        </Suspense>
      }
    />
    {/* Dashboard (landing page) */}
    <Route
      path="/facilities"
      element={
        <Suspense fallback={null}>
          <FacilitiesDashboard />
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
      path="/apparatus-basic"
      element={
        <Suspense fallback={null}>
          <ApparatusBasicPage />
        </Suspense>
      }
    />
  </React.Fragment>
);

/** Public location kiosk route (no auth — for tablets in rooms). */
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
  </React.Fragment>
);
