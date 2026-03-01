/**
 * Facilities Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /facilities           — Full facilities management
 *   /locations            — Lightweight locations list (when Facilities module is off)
 *   /apparatus-basic      — Lightweight apparatus view (when Apparatus module is off)
 *
 * Public routes (no auth):
 *   /display/:code        — Location kiosk display (for tablets in rooms)
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const FacilitiesPage = lazyWithRetry(
  () => import('../../pages/FacilitiesPage'),
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
    <Route
      path="/facilities"
      element={
        <Suspense fallback={null}>
          <FacilitiesPage />
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
