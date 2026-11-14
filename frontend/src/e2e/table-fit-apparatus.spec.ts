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
  name: 'In Service - Front Line',
  code: 'in_service',
  description: null,
  isSystem: true,
  defaultStatus: null,
  isAvailable: true,
  isOperational: true,
  requiresReason: false,
  isArchivedStatus: false,
  color: '#166534',
  icon: null,
  sortOrder: 1,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const APPARATUS = {
  id: 'apparatus-1',
  organizationId: 'org-1',
  unitNumber: 'Tower-Ladder-101',
  name: 'Greater Northfield Station 12 Reserve Quint',
  vin: null,
  licensePlate: null,
  licenseState: null,
  radioId: null,
  assetTag: null,
  apparatusTypeId: 'type-1',
  statusId: 'status-1',
  statusReason: null,
  statusChangedAt: null,
  statusChangedBy: null,
  year: 2019,
  make: 'Pierce Manufacturing',
  model: 'Velocity Ascendant 107-foot Heavy-Duty Aerial',
  bodyManufacturer: null,
  color: null,
  fuelType: 'diesel',
  fuelCapacityGallons: 65,
  seatingCapacity: 6,
  gvwr: null,
  minStaffing: 4,
  crewPositions: null,
  requiredEvocLevelId: null,
  pumpCapacityGpm: null,
  tankCapacityGallons: null,
  foamCapacityGallons: null,
  ladderLengthFeet: null,
  primaryStationId: null,
  currentLocationId: null,
  currentMileage: 123456,
  currentHours: 12345,
  mileageUpdatedAt: null,
  hoursUpdatedAt: null,
  purchaseDate: null,
  purchasePrice: null,
  purchaseVendor: null,
  purchaseOrderNumber: null,
  inServiceDate: null,
  isFinanced: false,
  financingCompany: null,
  financingEndDate: null,
  monthlyPayment: null,
  originalValue: null,
  currentValue: null,
  valueUpdatedAt: null,
  depreciationMethod: null,
  depreciationYears: null,
  salvageValue: null,
  warrantyExpiration: null,
  extendedWarrantyExpiration: null,
  warrantyProvider: null,
  warrantyNotes: null,
  insurancePolicyNumber: null,
  insuranceProvider: null,
  insuranceExpiration: null,
  registrationExpiration: null,
  inspectionExpiration: null,
  isArchived: false,
  archivedAt: null,
  archivedBy: null,
  soldDate: null,
  soldPrice: null,
  soldTo: null,
  soldToContact: null,
  disposalDate: null,
  disposalMethod: null,
  disposalReason: null,
  disposalNotes: null,
  nfpaTrackingEnabled: false,
  hasDeficiency: false,
  deficiencySince: null,
  customFieldValues: {},
  description: null,
  notes: null,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  apparatusType: APPARATUS_TYPE,
  statusRecord: APPARATUS_STATUS,
};

const FUEL_LOGS = [0, 1, 2, 3].map((i) => ({
  id: `fuel-${i}`,
  organizationId: 'org-1',
  apparatusId: 'apparatus-1',
  fuelDate: `2026-10-1${i}`,
  fuelType: 'diesel_ultra_low_sulfur',
  gallons: '123.456',
  pricePerGallon: '4.899',
  totalCost: '123456.78',
  mileageAtFill: 123456,
  hoursAtFill: '1234.5',
  isFullTank: i % 2 === 0,
  stationName: 'Northfield Municipal Fuel Depot',
  stationAddress: null,
  notes: null,
  recordedBy: 'Alexandra Ayala-Montgomery',
  createdAt: `2026-10-1${i}T15:30:00Z`,
}));

// The fuel log on an apparatus record: date, fuel type, gallons, price per
// gallon, a six-digit cost, mileage and full tank. Overflows its card on a
// tablet with the side navigation open.
test.describe('Apparatus fuel logs table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/apparatus/:id?tab=fuel — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'apparatus.view', 'apparatus.manage'] });
      await page.route('**/api/v1/apparatus/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/apparatus/fuel-logs')) return void route.fulfill(json(FUEL_LOGS));
        if (path.endsWith('/apparatus/types')) return void route.fulfill(json([APPARATUS_TYPE]));
        if (path.endsWith('/apparatus/statuses')) return void route.fulfill(json([APPARATUS_STATUS]));
        if (path.endsWith('/apparatus/apparatus-1')) return void route.fulfill(json(APPARATUS));
        return void route.fulfill(json([]));
      });
      await page.goto('/apparatus/apparatus-1?tab=fuel');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Price/Gal', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Fuel logs table');
    });
  }
});
