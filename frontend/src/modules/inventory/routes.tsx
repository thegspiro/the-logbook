/**
 * Inventory Module Routes
 *
 * Returns route elements for the inventory module.
 * Includes equipment browsing, personal equipment, admin hub,
 * checkouts management, and storage areas.
 *
 * To disable this module, simply remove or comment out
 * the call to getInventoryRoutes() in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

// Lazy-loaded pages
const InventoryPage = lazyWithRetry(
  () => import('../../pages/InventoryPage'),
);
const MyEquipmentPage = lazyWithRetry(
  () => import('../../pages/MyEquipmentPage'),
);
const InventoryAdminHub = lazyWithRetry(() =>
  import('../../pages/InventoryAdminHub').then((m) => ({
    default: m.InventoryAdminHub,
  })),
);
const InventoryCheckoutsPage = lazyWithRetry(
  () => import('../../pages/InventoryCheckoutsPage'),
);
const StorageAreasPage = lazyWithRetry(
  () => import('../../pages/StorageAreasPage'),
);
const ImportInventoryPage = lazyWithRetry(
  () => import('../../pages/ImportInventory'),
);

export const getInventoryRoutes = () => {
  return (
    <React.Fragment>
      {/* Inventory - Browse all equipment */}
      <Route
        path="/inventory"
        element={
          <Suspense fallback={null}>
            <InventoryPage />
          </Suspense>
        }
      />

      {/* Inventory - My personal equipment */}
      <Route
        path="/inventory/my-equipment"
        element={
          <Suspense fallback={null}>
            <MyEquipmentPage />
          </Suspense>
        }
      />

      {/* Inventory - Admin Hub */}
      <Route
        path="/inventory/admin"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryAdminHub />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - Checkouts management */}
      <Route
        path="/inventory/checkouts"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryCheckoutsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - Storage areas */}
      <Route
        path="/inventory/storage-areas"
        element={
          <Suspense fallback={null}>
            <StorageAreasPage />
          </Suspense>
        }
      />

      {/* Inventory - CSV Import */}
      <Route
        path="/inventory/import"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <ImportInventoryPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
