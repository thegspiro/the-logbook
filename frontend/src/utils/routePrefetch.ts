/**
 * Route Prefetch Utility
 *
 * Pre-loads lazy-loaded route chunks when the user hovers or focuses a
 * navigation link.  This eliminates the loading spinner that would normally
 * appear while the browser downloads the JS bundle for the target route.
 *
 * Each path is mapped to the same dynamic `import()` used by the lazy()
 * calls in App.tsx, so Vite recognises them as the same chunk.
 */

/** Map of route paths to their dynamic import functions. */
const routeImportMap: Record<string, () => Promise<unknown>> = {
  // Events
  '/events': () => import('../pages/EventsPage'),
  '/events/admin': () => import('../pages/EventsAdminHub'),

  // Training
  '/training': () => import('../pages/MyTrainingPage'),
  '/training/my-training': () => import('../pages/MyTrainingPage'),
  '/training/submit': () => import('../pages/SubmitTrainingPage'),
  '/training/courses': () => import('../pages/CourseLibraryPage'),
  '/training/programs': () => import('../pages/TrainingProgramsPage'),
  '/training/admin': () => import('../pages/TrainingAdminPage'),

  // Documents
  '/documents': () => import('../pages/DocumentsPage'),

  // Inventory / Operations
  '/inventory': () => import('../pages/InventoryPage'),
  '/inventory/my-equipment': () => import('../pages/MyEquipmentPage'),
  '/inventory/admin': () => import('../pages/InventoryAdminHub'),
  '/inventory/storage-areas': () => import('../pages/StorageAreasPage'),
  '/inventory/checkouts': () => import('../pages/InventoryCheckoutsPage'),

  // Scheduling
  '/scheduling': () => import('../pages/SchedulingPage'),

  // Facilities / Locations
  '/facilities': () => import('../pages/FacilitiesPage'),
  '/locations': () => import('../pages/LocationsPage'),

  // Apparatus
  '/apparatus-basic': () => import('../pages/ApparatusBasicPage'),

  // Governance
  '/elections': () => import('../pages/ElectionsPage'),
  '/minutes': () => import('../pages/MinutesPage'),
  '/action-items': () => import('../pages/ActionItemsPage'),

  // Notifications
  '/notifications': () => import('../pages/NotificationsPage'),

  // Forms & Integrations
  '/forms': () => import('../pages/FormsPage'),
  '/integrations': () => import('../pages/IntegrationsPage'),

  // Settings
  '/settings': () => import('../pages/SettingsPage'),
  '/settings/roles': () => import('../pages/RoleManagementPage'),
  '/account': () => import('../pages/UserSettingsPage'),
  '/setup': () => import('../pages/DepartmentSetupPage'),
  '/reports': () => import('../pages/ReportsPage'),

  // Admin
  '/admin/analytics': () => import('../pages/AnalyticsDashboardPage'),
  '/admin/platform-analytics': () => import('../pages/PlatformAnalyticsPage'),
  '/admin/errors': () => import('../pages/ErrorMonitoringPage'),
};

/** Tracks which routes have already been prefetched to avoid redundant work. */
const prefetched = new Set<string>();

/**
 * Trigger a prefetch of the JS chunk for the given route path.
 * Safe to call multiple times — subsequent calls for the same path are no-ops.
 */
export function prefetchRoute(path: string): void {
  if (prefetched.has(path)) return;

  const importFn = routeImportMap[path];
  if (!importFn) return;

  prefetched.add(path);

  // Use requestIdleCallback where available so prefetching doesn't compete
  // with user-initiated work; fall back to a short setTimeout.
  const schedule = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 50);

  schedule(() => {
    importFn().catch(() => {
      // If prefetch fails (e.g. offline), remove from set so it can be retried
      prefetched.delete(path);
    });
  });
}
