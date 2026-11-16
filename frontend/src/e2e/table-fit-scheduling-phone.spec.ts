import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'scheduling.view', 'scheduling.manage', 'scheduling.reports'];

const MEMBERS = [
  'Alexandra Ayala-Montgomery',
  'Christopher Vanderbilt-Okonkwo',
  'Maximiliano Fitzgerald-Hernandez',
  'Bartholomew Kowalczyk-Richardson',
];

const AVAILABILITY = MEMBERS.map((name, i) => ({
  user_id: `user-${i}`,
  user_name: name,
  email: `${name.split(' ')[0]?.toLowerCase() ?? 'member'}.longsurname@northwestvolunteerfirecompany.org`,
  available_dates: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'],
  unavailable_dates: ['2026-10-06', '2026-10-07'],
  total_shifts_assigned: 148,
  time_off_days: 12,
}));

const COVERAGE = [0, 1, 2, 3].map((i) => ({
  date: `2026-10-1${i}`,
  total_shifts: 148,
  total_assigned: 1184,
  total_confirmed: 1102,
  understaffed_shifts: 24,
}));

const CALL_VOLUME = [0, 1, 2, 3].map((i) => ({
  period: `2026-W4${i} (October 12 - October 18)`,
  total_calls: 1284,
  by_type: {
    'Structure Fire': 148,
    'Emergency Medical Service': 842,
    'Motor Vehicle Accident with Entrapment': 96,
    'Hazardous Materials': 24,
  },
  avg_response_seconds: 384,
}));

const VIEWPORTS = [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS];

async function openReportsTab(
  page: Page,
  viewport: { width: number; height: number },
  endpoint: string,
  body: unknown,
  tab: RegExp
) {
  await page.setViewportSize(viewport);
  await signIn(page, { permissions: PERMISSIONS });
  await page.route(endpoint, (route) => void route.fulfill(json(body)));
  await page.goto('/scheduling/admin/reports');
  await page.getByRole('tab', { name: tab }).click();
}

// Availability: a member's name over a long email, beside four counts.
test.describe('Scheduling reports — availability table', () => {
  for (const viewport of VIEWPORTS) {
    test(`/scheduling/admin/reports (Availability) — ${viewport.name}`, async ({ page }) => {
      await openReportsTab(page, viewport, '**/api/v1/scheduling/availability**', AVAILABILITY, /Availability/);
      const table = page.getByRole('region', { name: 'Member availability' }).getByRole('table');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Availability table');
    });
  }
});

// Coverage: a date and four counts per day.
test.describe('Scheduling reports — coverage table', () => {
  for (const viewport of VIEWPORTS) {
    test(`/scheduling/admin/reports (Coverage) — ${viewport.name}`, async ({ page }) => {
      await openReportsTab(page, viewport, '**/api/v1/scheduling/reports/coverage**', COVERAGE, /Coverage/);
      const table = page.getByRole('region', { name: 'Daily coverage' }).getByRole('table');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Coverage table');
    });
  }
});

// Call volume: a period label, a total, wrapping call-type chips and a time.
test.describe('Scheduling reports — call volume table', () => {
  for (const viewport of VIEWPORTS) {
    test(`/scheduling/admin/reports (Call Volume) — ${viewport.name}`, async ({ page }) => {
      await openReportsTab(page, viewport, '**/api/v1/scheduling/reports/call-volume**', CALL_VOLUME, /Call Volume/);
      const table = page.getByRole('region', { name: 'Call volume' }).getByRole('table');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Call volume table');
    });
  }
});
