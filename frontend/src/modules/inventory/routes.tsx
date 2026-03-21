/**
 * Inventory Module Routes
 *
 * Returns route elements for the inventory module.
 * Pages are split by concern: items list, pool items, categories,
 * maintenance, members, checkouts, storage, and admin sub-pages.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

// Lazy-loaded pages
const InventoryItemsPage = lazyWithRetry(
  () => import('./pages/InventoryItemsPage'),
);
const MyEquipmentPage = lazyWithRetry(
  () => import('./pages/MyEquipmentPage'),
);
const InventoryAdminHub = lazyWithRetry(() =>
  import('./pages/InventoryAdminHub').then((m) => ({
    default: m.InventoryAdminHub,
  })),
);
const InventoryCheckoutsPage = lazyWithRetry(
  () => import('../../pages/InventoryCheckoutsPage'),
);
const StorageAreasPage = lazyWithRetry(
  () => import('./pages/StorageAreasPage'),
);
const ImportInventoryPage = lazyWithRetry(
  () => import('../../pages/ImportInventory'),
);
const InventoryBarcodePrintPage = lazyWithRetry(
  () => import('./pages/InventoryBarcodePrintPage'),
);
const ItemDetailPage = lazyWithRetry(
  () => import('./pages/ItemDetailPage'),
);
const PoolItemsPage = lazyWithRetry(
  () => import('./pages/PoolItemsPage'),
);
const InventoryCategoriesPage = lazyWithRetry(
  () => import('./pages/InventoryCategoriesPage'),
);
const InventoryMaintenancePage = lazyWithRetry(
  () => import('./pages/InventoryMaintenancePage'),
);
const InventoryMembersPage = lazyWithRetry(
  () => import('./pages/InventoryMembersPage'),
);
const ChargesPage = lazyWithRetry(
  () => import('./pages/ChargesPage'),
);
const ReturnRequestsPage = lazyWithRetry(
  () => import('./pages/ReturnRequestsPage'),
);
const EquipmentRequestsPage = lazyWithRetry(
  () => import('./pages/EquipmentRequestsPage'),
);
const WriteOffsPage = lazyWithRetry(
  () => import('./pages/WriteOffsPage'),
);
const ReorderRequestsPage = lazyWithRetry(
  () => import('./pages/ReorderRequestsPage'),
);
const EquipmentKitsPage = lazyWithRetry(
  () => import('./pages/EquipmentKitsPage'),
);
const VariantGroupsPage = lazyWithRetry(
  () => import('./pages/VariantGroupsPage'),
);

export const getInventoryRoutes = () => {
  return (
    <React.Fragment>
      {/* Inventory - Browse all equipment */}
      <Route
        path="/inventory"
        element={
          <Suspense fallback={null}>
            <InventoryItemsPage />
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

      {/* Admin sub-pages */}
      <Route
        path="/inventory/admin/items"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryItemsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/pool"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <PoolItemsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/categories"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryCategoriesPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/maintenance"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryMaintenancePage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/members"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryMembersPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/charges"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <ChargesPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/returns"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <ReturnRequestsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/requests"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <EquipmentRequestsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/write-offs"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <WriteOffsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/reorder"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <ReorderRequestsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/kits"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <EquipmentKitsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/variant-groups"
        element={
          <ProtectedRoute requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <VariantGroupsPage />
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

      {/* Inventory - Item Detail Page */}
      <Route
        path="/inventory/items/:id"
        element={
          <Suspense fallback={null}>
            <ItemDetailPage />
          </Suspense>
        }
      />

      {/* Inventory - Barcode Label Printing */}
      <Route
        path="/inventory/print-labels"
        element={
          <Suspense fallback={null}>
            <InventoryBarcodePrintPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
