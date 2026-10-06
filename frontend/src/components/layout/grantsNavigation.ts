/**
 * The Grants & Fundraising pages both navigations list. One list so the side
 * and top navigation cannot drift apart. The module had no navigation entry
 * at all until 2026-10-05: its pages were reachable only by typing the URL.
 */
export const GRANTS_NAV_ITEMS: ReadonlyArray<{ label: string; path: string }> = [
  { label: 'Dashboard', path: '/grants' },
  { label: 'Opportunities', path: '/grants/opportunities' },
  { label: 'Applications', path: '/grants/applications' },
  { label: 'Campaigns', path: '/grants/campaigns' },
  { label: 'Donors', path: '/grants/donors' },
  { label: 'Donations', path: '/grants/donations' },
  { label: 'Reports', path: '/grants/reports' },
];
