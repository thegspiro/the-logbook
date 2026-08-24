/**
 * A member profile is a directory card: the contact details a colleague is
 * meant to be able to look up. The gear a member signed for is not part of
 * that — it is quartermaster business, and it used to be rendered (and
 * fetched) for anyone who opened the page, because the section was gated on
 * "is the inventory module enabled" alone. `inventory.view` cannot be the gate
 * either: every member holds it as part of the baseline Member position.
 */

import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../test/utils';
import type { UserWithRoles } from '../types/role';
import { UserStatus } from '../constants/enums';

const VIEWER_ID = 'viewer-1';
const TARGET_ID = 'target-2';

let routeUserId = TARGET_ID;
let grantedPermissions: string[] = [];

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useParams: () => ({ userId: routeUserId }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: VIEWER_ID },
    checkPermission: (permission: string) => grantedPermissions.includes(permission),
  }),
}));

vi.mock('../modules/membership/components/MemberIdCardsPanel', () => ({
  MemberIdCardsPanel: () => null,
}));

// Pin the department timezone so assigned-date formatting is stable and does
// not depend on the org-settings store the page normally reads it from.
vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

const getUserInventory = vi.fn();
const getEnabledModules = vi.fn();

vi.mock('../services/api', () => ({
  userService: {
    getUserWithRoles: () => Promise.resolve(targetUser),
  },
  organizationService: {
    getEnabledModules: () => getEnabledModules() as unknown,
  },
  trainingService: {
    getRecords: () => Promise.resolve([]),
    getComplianceSummary: () => Promise.resolve(null),
  },
  inventoryService: {
    getUserInventory: (...args: unknown[]) => getUserInventory(...args) as unknown,
  },
  memberStatusService: {
    getMemberLeaves: () => Promise.resolve([]),
  },
}));

vi.mock('../modules/admin-hours/services/api', () => ({
  adminHoursEntryService: { getSummary: () => Promise.resolve(null) },
  adminHoursComplianceService: { getUserCompliance: () => Promise.resolve([]) },
}));

const targetUser: UserWithRoles = {
  id: TARGET_ID,
  organization_id: 'org-1',
  username: 'jdoe',
  first_name: 'Jane',
  last_name: 'Doe',
  status: UserStatus.ACTIVE,
  roles: [],
};

// Imported after the mocks so the page picks them up.
const { MemberProfilePage } = await import('./MemberProfilePage');

describe('MemberProfilePage assigned inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeUserId = TARGET_ID;
    grantedPermissions = [];
    getEnabledModules.mockResolvedValue({ enabled_modules: ['inventory'] });
    getUserInventory.mockResolvedValue({
      permanent_assignments: [
        {
          assignment_id: 'a-1',
          item_name: 'Turnout Coat',
          serial_number: 'SN-1',
          asset_tag: null,
          condition: 'Good',
          assigned_date: '2026-01-05T00:00:00Z',
        },
      ],
    });
  });

  it('hides a colleague’s gear from a member without inventory.manage', async () => {
    renderWithRouter(<MemberProfilePage />);

    await screen.findByText('Quick Stats');
    await waitFor(() => expect(getEnabledModules).toHaveBeenCalled());
    // Let the module-enabled state settle; the inventory fetch would fire on
    // the commit that follows it.
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

    expect(screen.queryByText('Assigned Inventory')).not.toBeInTheDocument();
    expect(screen.queryByText('Turnout Coat')).not.toBeInTheDocument();
    // The section is not merely hidden — the read never leaves the browser.
    expect(getUserInventory).not.toHaveBeenCalled();
  });

  it('shows a colleague’s gear to a quartermaster', async () => {
    grantedPermissions = ['inventory.manage'];

    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByText('Assigned Inventory')).toBeInTheDocument();
    expect(await screen.findByText('Turnout Coat')).toBeInTheDocument();
    expect(getUserInventory).toHaveBeenCalledWith(TARGET_ID);
  });

  it('shows a member their own gear without any inventory permission', async () => {
    routeUserId = VIEWER_ID;

    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByText('Assigned Inventory')).toBeInTheDocument();
    expect(getUserInventory).toHaveBeenCalledWith(VIEWER_ID);
  });
});
