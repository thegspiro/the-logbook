/**
 * Which member admin tabs a member can actually open.
 *
 * members.manage lets an officer work the roster; users.create is what puts a
 * new person on it. The tab bar honours that split, and so must the URL — a
 * bookmarked link cannot be a way around a permission.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const mockCheckPermission = vi.fn();
const mockGetSummary = vi.fn();
const mockIsConnected = vi.fn();

vi.mock('../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({
    connected: new Set<string>(),
    loading: false,
    isConnected: (type: string) => mockIsConnected(type) as boolean,
  }),
}));

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
vi.mock('./QualificationImport', () => ({ default: () => <p>Qualification import body</p> }));

import { renderWithRouter } from '../test/utils';
import MembersAdminHub from './MembersAdminHub';

const renderAt = (search: string) => {
  window.history.pushState({}, '', `/members/admin${search}`);
  return renderWithRouter(<MembersAdminHub />);
};

describe('MembersAdminHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockReset();
    mockIsConnected.mockReturnValue(false);
    mockGetSummary.mockResolvedValue({
      moduleKey: 'members',
      generatedAt: '2026-08-23T12:00:00Z',
      timezone: 'UTC',
      metrics: [],
      attention: [],
    });
  });

  // Each tab is a card carrying a description as well as its name, so the bar
  // is compared by accessible name (the label alone), in order.
  const tabsNamed = (names: string[]) => names.map((name) => screen.getByRole('tab', { name }));

  it('offers the create tabs to a member who may create', async () => {
    mockCheckPermission.mockReturnValue(true);
    renderAt('');

    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toEqual(
        tabsNamed(['Member Management', 'Add Member', 'Import Members', 'Import Qualifications', 'Settings'])
      );
    });
  });

  // Both create tabs submit through userService.createMember, which posts to
  // POST /users -- and that endpoint requires users.create. These tabs asked
  // members.create until 2026-09-06, which reads like the right grant and gates
  // the prospect pipeline instead. The names are only distinguishable by
  // asserting the one asked for, because the two are held by the same seeded
  // positions and any boolean mock passes either way.
  it('asks for the grant POST /users actually enforces', async () => {
    mockCheckPermission.mockReturnValue(true);
    renderAt('');

    await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
    expect(mockCheckPermission).toHaveBeenCalledWith('users.create');
    expect(mockCheckPermission).not.toHaveBeenCalledWith('members.create');
  });

  it('hides the create tabs from a member who may not create', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderAt('');

    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toEqual(
        tabsNamed([
          'Member Management',
          // Writes onto existing members, so members.manage — which the hub
          // already requires — is enough; no users.create.
          'Import Qualifications',
          'Settings',
        ])
      );
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

  // The ID card page is gated on the card grant alone, so the hub links to it
  // as an action -- and only where the department actually issues cards.
  it('links to the ID card page only when cards are on and the grant is held', async () => {
    mockCheckPermission.mockReturnValue(true);
    mockIsConnected.mockImplementation((type: string) => type === 'nfc-id-cards');
    renderAt('');
    expect(await screen.findByRole('button', { name: /Member ID cards/ })).toBeInTheDocument();
    expect(mockCheckPermission).toHaveBeenCalledWith('members.manage_id_cards');
  });

  it('offers no ID card link while cards are turned off', async () => {
    mockCheckPermission.mockReturnValue(true);
    renderAt('');
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /Member ID cards/ })).not.toBeInTheDocument();
  });
});
