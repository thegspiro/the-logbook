import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const APPARATUS_TYPE = {
  id: 'type-1',
  organizationId: null,
  name: 'Aerial Ladder Platform Quint',
  code: 'quint',
  description: null,
  category: 'fire',
  isSystem: true,
  defaultType: null,
  icon: null,
  color: '#991b1b',
  sortOrder: 1,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const APPARATUS_STATUS = {
  id: 'status-1',
  organizationId: null,
  name: 'Out of Service - Mechanical',
  code: 'out_of_service',
  description: null,
  isSystem: true,
  defaultStatus: null,
  isAvailable: false,
  isOperational: false,
  requiresReason: false,
  isArchivedStatus: false,
  color: '#b45309',
  icon: null,
  sortOrder: 1,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const APPARATUS_LIST = {
  items: [0, 1, 2, 3].map((i) => ({
    id: `apparatus-${i}`,
    unitNumber: `Tower-Ladder-10${i}`,
    name: 'Greater Northfield Station 12 Reserve Quint',
    year: 2019,
    make: 'Pierce Manufacturing',
    model: 'Velocity Ascendant 107-foot Heavy-Duty Aerial',
    apparatusTypeId: 'type-1',
    statusId: 'status-1',
    primaryStationId: null,
    currentMileage: 123456,
    currentHours: 123456,
    minStaffing: 4,
    isArchived: false,
    hasDeficiency: true,
    deficiencySince: '2026-10-03T00:00:00Z',
    requiredEvocLevelId: null,
    apparatusType: APPARATUS_TYPE,
    statusRecord: APPARATUS_STATUS,
  })),
  total: 4,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

// The fleet list: unit with its name, type badge, vehicle, a long status with
// a deficiency flag, crew, mileage, hours and up to four row actions. Wider
// than a laptop's card before its free-text cells could wrap.
test.describe('Apparatus list table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/apparatus — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'apparatus.view', 'apparatus.manage'] });
      await page.route('**/api/v1/apparatus**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/apparatus')) return void route.fulfill(json(APPARATUS_LIST));
        if (path.endsWith('/apparatus/types')) return void route.fulfill(json([APPARATUS_TYPE]));
        if (path.endsWith('/apparatus/statuses')) return void route.fulfill(json([APPARATUS_STATUS]));
        if (path.endsWith('/apparatus/summary')) return void route.fulfill(json({ totalApparatus: 4 }));
        return void route.fulfill(json([]));
      });
      await page.goto('/apparatus');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Min Crew', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Apparatus list table');
    });
  }
});
