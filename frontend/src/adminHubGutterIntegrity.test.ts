/**
 * The administration hubs sit inside AppLayout's page gutter (1rem / 1.5rem /
 * 2rem by width). A hub frame, hub body or hub-only tab that adds its own
 * `px-4 sm:px-6 lg:px-8` page container indents everything a second time:
 * every hub sat 32px in on a phone and 64px on a desktop, where ordinary pages
 * sit at 16px and 32px. The duplicate had been copied into each hub and into
 * the tabs that render only inside one, so it is checked across all of them.
 *
 * Scoped to page containers (`mx-auto` with a `max-w-*` width), the shape the
 * duplicate always took. Padding inside a card or a button is not a gutter.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HUB_SURFACES = [
  'components/admin/AdminHubFrame.tsx',
  'modules/inventory/pages/InventoryAdminHub.tsx',
  'modules/storefront/pages/StoreAdminPage.tsx',
  'pages/scheduling/admin/SchedulingAdminHub.tsx',
  'pages/TrainingAdminPage.tsx',
  'pages/MembersAdminHub.tsx',
  'pages/EventsAdminHub.tsx',
  // Rendered only as tabs of a hub.
  'pages/MembersAdminPage.tsx',
  'pages/AddMember.tsx',
  'pages/ImportMembers.tsx',
  'pages/EventCreatePage.tsx',
  'pages/PastEventsTab.tsx',
  'pages/EventRequestsTab.tsx',
  'pages/CommunityEngagementTab.tsx',
  'pages/EventsSettingsTab.tsx',
  'pages/TrainingOfficerDashboard.tsx',
  'pages/ExpiringCertsTab.tsx',
  'pages/TrainingWaiversTab.tsx',
  'pages/ReviewSubmissionsPage.tsx',
  'pages/CreateTrainingSessionPage.tsx',
  'pages/ShiftReportPage.tsx',
  'pages/TrainingRequirementsPage.tsx',
];

const PAGE_CONTAINER_WITH_GUTTER = /className="(?=[^"]*\bmx-auto\b)(?=[^"]*\bmax-w-)(?=[^"]*\bpx-\d)[^"]*"/g;

describe('administration hub gutters', () => {
  it.each(HUB_SURFACES)('%s adds no side gutter of its own', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    expect(source.match(PAGE_CONTAINER_WITH_GUTTER) ?? []).toEqual([]);
  });
});
