/**
 * Inventory Module Routes
 *
 * Returns route elements for the inventory module.
 * Pages are split by concern: items list, pool items, categories,
 * maintenance, members, checkouts, storage, and admin sub-pages.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

// Lazy-loaded pages
const InventoryItemsPage = lazyWithRetry(() => import('./pages/InventoryItemsPage'));
const MyEquipmentPage = lazyWithRetry(() => import('./pages/MyEquipmentPage'));
const InventoryAdminHub = lazyWithRetry(() =>
  import('./pages/InventoryAdminHub').then((m) => ({
    default: m.InventoryAdminHub,
  }))
);
const InventoryCheckoutsPage = lazyWithRetry(() => import('../../pages/InventoryCheckoutsPage'));
const StorageAreasPage = lazyWithRetry(() => import('./pages/StorageAreasPage'));
const ImportInventoryPage = lazyWithRetry(() => import('../../pages/ImportInventory'));
const InventoryBarcodePrintPage = lazyWithRetry(() => import('./pages/InventoryBarcodePrintPage'));
const ItemDetailPage = lazyWithRetry(() => import('./pages/ItemDetailPage'));
const PoolItemsPage = lazyWithRetry(() => import('./pages/PoolItemsPage'));
const InventoryCategoriesPage = lazyWithRetry(() => import('./pages/InventoryCategoriesPage'));
const InventoryMaintenancePage = lazyWithRetry(() => import('./pages/InventoryMaintenancePage'));
const InventoryMembersPage = lazyWithRetry(() => import('./pages/InventoryMembersPage'));
const ChargesPage = lazyWithRetry(() => import('./pages/ChargesPage'));
const ReturnRequestsPage = lazyWithRetry(() => import('./pages/ReturnRequestsPage'));
const EquipmentRequestsPage = lazyWithRetry(() => import('./pages/EquipmentRequestsPage'));
const WriteOffsPage = lazyWithRetry(() => import('./pages/WriteOffsPage'));
const ReorderRequestsPage = lazyWithRetry(() => import('./pages/ReorderRequestsPage'));
const EquipmentKitsPage = lazyWithRetry(() => import('./pages/EquipmentKitsPage'));
const VariantGroupsPage = lazyWithRetry(() => import('./pages/VariantGroupsPage'));
const AllowancesPage = lazyWithRetry(() => import('./pages/AllowancesPage'));
const VendorsPage = lazyWithRetry(() => import('./pages/VendorsPage'));
const ImpactPlannerPage = lazyWithRetry(() => import('./pages/ImpactPlannerPage'));
const InventorySetupPage = lazyWithRetry(() => import('./pages/InventorySetupPage'));

// Equipment checklists — the whole feature, authoring through performing.
// Scheduling links in from a shift; it hosts none of this.
const EquipmentCheckTemplateBuilder = lazyWithRetry(() => import('./pages/EquipmentCheckTemplateBuilder'));
const EquipmentCheckReportsPage = lazyWithRetry(() => import('./pages/EquipmentCheckReportsPage'));
const SupplyExpiringPage = lazyWithRetry(() => import('./pages/SupplyExpiringPage'));
const FleetBoardPage = lazyWithRetry(() => import('./pages/FleetBoardPage'));
const CheckLogPage = lazyWithRetry(() => import('./pages/CheckLogPage'));
const ApparatusDetailPage = lazyWithRetry(() => import('./pages/ApparatusDetailPage'));
const ApparatusInventoryPage = lazyWithRetry(() => import('./pages/ApparatusInventoryPage'));
const MyChecklistsPage = lazyWithRetry(() => import('./pages/MyChecklistsPage'));
const ChecklistsAdminPage = lazyWithRetry(() => import('./pages/ChecklistsAdminPage'));
const ChecklistSettingsPage = lazyWithRetry(() => import('./pages/ChecklistSettingsPage'));

export const getInventoryRoutes = () => {
  return (
    <React.Fragment>
      {/* Inventory - Browse all equipment.

          Manager-gated, unlike the member pages below it. This is the whole
          department's gear, and a member's business with the catalogue is
          their own issued items and the request they raise against one —
          both of which live on /inventory/my-equipment and stay open.

          `inventory.view` cannot be the gate here: the seeded member and
          firefighter roles hold it, and they need it, because the request
          picker on My Issued Gear searches GET /items to find something to
          ask for. Gating this page on it would have gated nothing. */}
      <Route
        path="/inventory"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryItemsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - My personal equipment */}
      <Route
        path="/inventory/my-equipment"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory">
            <Suspense fallback={null}>
              <MyEquipmentPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - Admin Hub */}
      <Route
        path="/inventory/admin"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryAdminHub />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - Guided first-run setup */}
      <Route
        path="/inventory/admin/setup"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventorySetupPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Admin sub-pages */}
      <Route
        path="/inventory/admin/items"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryItemsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/pool"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <PoolItemsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/categories"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryCategoriesPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/maintenance"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryMaintenancePage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/members"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryMembersPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/charges"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <ChargesPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/returns"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <ReturnRequestsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/requests"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <EquipmentRequestsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/write-offs"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <WriteOffsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/reorder"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <ReorderRequestsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/kits"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <EquipmentKitsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/variant-groups"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <VariantGroupsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/allowances"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <AllowancesPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/vendors"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <VendorsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory/admin/impact-planner"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <ImpactPlannerPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - Checkouts management */}
      <Route
        path="/inventory/checkouts"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryCheckoutsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - Storage areas (management tool: create/edit/delete) */}
      <Route
        path="/inventory/storage-areas"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <StorageAreasPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - CSV Import */}
      <Route
        path="/inventory/import"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <ImportInventoryPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - Items list (breadcrumb target from detail page).
          Same page and same gate as /inventory — leaving this one open would
          have left the full catalogue one breadcrumb away. */}
      <Route
        path="/inventory/items"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryItemsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - Item Detail Page */}
      <Route
        path="/inventory/items/:id"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory">
            <Suspense fallback={null}>
              <ItemDetailPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Inventory - Barcode Label Printing.

          Manage-gated to match POST /inventory/labels/generate, which this
          page is the only caller of. That endpoint takes arbitrary item ids
          and returns a document describing them, so leaving either on
          `inventory.view` kept a read of the catalogue open after the
          catalogue page itself was closed. */}
      <Route
        path="/inventory/print-labels"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.manage">
            <Suspense fallback={null}>
              <InventoryBarcodePrintPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* ==============================================================
          Equipment checklists

          A checklist is a list of inventory items, so the whole feature
          lives here — authoring it, performing it, and reporting on it.
          Scheduling links in from a shift and hosts none of it.

          Admin-gated screens sit under /inventory/admin/checklists, matching
          the module's existing convention; the crew-facing board, log, own
          checklists and apparatus views sit under /inventory/checklists.

          Route gates are the API's gates, not the Scheduling page's: the
          builder and reports asked for `scheduling.manage` while their
          endpoints require the check-manage grant, so an officer with one and
          not the other met either a page they could not use or a page they
          were refused for no stated reason.
          ============================================================== */}
      <Route
        path="/inventory/admin/checklists"
        element={
          <ProtectedRoute
            requiredModule="inventory"
            moduleLabel="Inventory"
            requiredPermission="inventory.check_manage"
          >
            <Suspense fallback={null}>
              <ChecklistsAdminPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      {/* The gate is the ENDPOINT's, not the feature's. These four values are
          stored in org.settings, so they are written through
          PATCH /organizations/settings, which requires settings.manage or
          organization.update_settings. Gating this page on
          inventory.check_manage instead would read as "the quartermaster owns
          checklist settings" and deliver a page that 403s on every toggle —
          the same mismatch the builder and reports routes above were fixed for. */}
      <Route
        path="/inventory/admin/checklists/settings"
        element={
          <ProtectedRoute
            requiredModule="inventory"
            moduleLabel="Inventory"
            requiredAnyPermission={['settings.manage', 'organization.update_settings']}
          >
            <Suspense fallback={null}>
              <ChecklistSettingsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/admin/checklists/templates/new"
        element={
          <ProtectedRoute
            requiredModule="inventory"
            moduleLabel="Inventory"
            requiredPermission="inventory.check_manage"
          >
            <Suspense fallback={null}>
              <EquipmentCheckTemplateBuilder />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/admin/checklists/templates/:templateId"
        element={
          <ProtectedRoute
            requiredModule="inventory"
            moduleLabel="Inventory"
            requiredPermission="inventory.check_manage"
          >
            <Suspense fallback={null}>
              <EquipmentCheckTemplateBuilder />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/admin/checklists/reports"
        element={
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory" requiredPermission="inventory.check_view">
            <Suspense fallback={null}>
              <EquipmentCheckReportsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/admin/checklists/supply"
        element={
          <ProtectedRoute
            requiredModule="inventory"
            moduleLabel="Inventory"
            requiredAnyPermission={['scheduling.manage', 'inventory.check_view', 'inventory.manage']}
          >
            <Suspense fallback={null}>
              <SupplyExpiringPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Fleet board and its sub-pages. `/log` and `/apparatus-inventory` are
          declared before the dynamic apparatus route so a literal segment
          cannot be swallowed as an apparatus id. */}
      <Route
        path="/inventory/checklists"
        element={
          <ProtectedRoute
            requiredModule="inventory"
            moduleLabel="Inventory"
            requiredAnyPermission={['inventory.check_view', 'scheduling.manage']}
          >
            <Suspense fallback={null}>
              <FleetBoardPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/checklists/log"
        element={
          /* Crew-level: the server narrows a member without
             inventory.check_view to their own checks rather than 403ing, so
             the route opens for anyone who can submit one. */
          <ProtectedRoute
            requiredModule="inventory"
            moduleLabel="Inventory"
            requiredAnyPermission={['inventory.check_submit', 'inventory.check_view', 'scheduling.manage']}
          >
            <Suspense fallback={null}>
              <CheckLogPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/checklists/my"
        element={
          /* No permission gate. Performing your own check is the one thing
             every member does, the API narrows /my-checklists to the caller,
             and this is now their only route to it — the Scheduling tab that
             used to carry them here is gone. */
          <ProtectedRoute requiredModule="inventory" moduleLabel="Inventory">
            <Suspense fallback={null}>
              <MyChecklistsPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/checklists/apparatus-inventory"
        element={
          /* Crew-level, not officer-level: recording what you just used is
             the whole point, so the default member permission opens it. */
          <ProtectedRoute
            requiredModule="inventory"
            moduleLabel="Inventory"
            requiredAnyPermission={['inventory.check_submit', 'inventory.check_view', 'inventory.view']}
          >
            <Suspense fallback={null}>
              <ApparatusInventoryPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/checklists/apparatus/:apparatusId"
        element={
          <ProtectedRoute
            requiredModule="inventory"
            moduleLabel="Inventory"
            requiredAnyPermission={['inventory.check_view', 'scheduling.manage']}
          >
            <Suspense fallback={null}>
              <ApparatusDetailPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
