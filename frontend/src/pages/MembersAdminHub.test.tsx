/**
 * Which member admin tabs a member can actually open.
 *
 * members.manage lets an officer work the roster; members.create is what puts
 * a new person on it. The tab bar honours that split, and so must the URL —
 * a bookmarked link cannot be a way around a permission.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const mockCheckPermission = vi.fn();
const mockGetSummary = vi.fn();

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean }),
}));

vi.mock('../services/adminHubService', () => ({
  adminHubService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
  },
}));

vi.mock('./MembersAdminPage', () => ({ default: () => <p>Member management body</p> }));
vi.mock('./AddMember', () => ({ default: () => <p>Add member body</p> }));
vi.mock('./ImportMembers', () => ({ default: () => <p>Import members body</p> }));

import { renderWithRouter } from '../test/utils';
import MembersAdminHub from './MembersAdminHub';

const renderAt = (search: string) => {
  window.history.pushState({}, '', `/members/admin${search}`);
  return renderWithRouter(<MembersAdminHub />);
};

describe('MembersAdminHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSummary.mockResolvedValue({
      moduleKey: 'members',
      generatedAt: '2026-08-23T12:00:00Z',
      timezone: 'UTC',
      metrics: [],
      attention: [],
    });
  });

  it('offers the create tabs to a member who may create', async () => {
    mockCheckPermission.mockReturnValue(true);
    renderAt('');

    await waitFor(() => {
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
        'Member Management',
        'Add Member',
        'Import Members',
        'Settings',
      ]);
    });
  });

  it('hides the create tabs from a member who may not create', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderAt('');

    await waitFor(() => {
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Member Management', 'Settings']);
    });
  });

  // A bookmarked or redirected ?tab=add used to select a tab that was neither
  // in the bar nor allowed to render its body, leaving the hub showing a header
  // and nothing underneath it.
  it('falls back to management when the URL names a tab the member cannot open', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderAt('?tab=add');

    expect(await screen.findByText('Member management body')).toBeInTheDocument();
    expect(screen.queryByText('Add member body')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Member Management' })).toHaveAttribute('aria-selected', 'true');
  });

  it('honours the URL for a tab the member can open', async () => {
    mockCheckPermission.mockReturnValue(true);
    renderAt('?tab=add');

    expect(await screen.findByText('Add member body')).toBeInTheDocument();
  });

  it('always keeps Settings reachable', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderAt('?tab=settings');

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
