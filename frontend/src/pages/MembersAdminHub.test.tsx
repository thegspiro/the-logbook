/**
 * Which member admin tabs a member can actually open.
 *
 * members.manage lets an officer work the roster; users.create is what puts a
 * new person on it. The tab bar honours that split, and so must the URL — a
 * bookmarked link cannot be a way around a permission.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

  // Area cards and page tabs both carry a description as well as their name,
  // so each level is compared by accessible name (the label alone), in order.
  const namesIn = (tablist: string) =>
    within(screen.getByRole('tablist', { name: tablist }))
      .getAllByRole('tab')
      .map((tab) => tab.id);

  it('offers the create pages to a member who may create', async () => {
    mockCheckPermission.mockReturnValue(true);
    renderAt('?tab=add');

    await waitFor(() => {
      expect(namesIn('Members admin areas')).toEqual([
        'members-admin-area-tab-roster',
        'members-admin-area-tab-add_import',
        'members-admin-area-tab-settings',
      ]);
    });
    expect(within(screen.getByRole('tablist', { name: 'Add & Import pages' })).getAllByRole('tab')).toEqual([
      screen.getByRole('tab', { name: 'Add Member' }),
      screen.getByRole('tab', { name: 'Import Members' }),
      screen.getByRole('tab', { name: 'Import Qualifications' }),
    ]);
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

  it('hides the create pages from a member who may not create', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderAt('?tab=qualifications');

    // Import Qualifications writes onto existing members, so members.manage —
    // which the hub already requires — is enough, and keeps the area alive.
    await waitFor(() => {
      expect(within(screen.getByRole('tablist', { name: 'Add & Import pages' })).getAllByRole('tab')).toEqual([
        screen.getByRole('tab', { name: 'Import Qualifications' }),
      ]);
    });
    expect(screen.queryByRole('tab', { name: 'Add Member' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Import Members' })).not.toBeInTheDocument();
  });

  // A bookmarked or redirected ?tab=add used to select a tab that was neither
  // in the bar nor allowed to render its body, leaving the hub showing a header
  // and nothing underneath it.
  it('falls back to management when the URL names a tab the member cannot open', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderAt('?tab=add');

    expect(await screen.findByText('Member management body')).toBeInTheDocument();
    expect(screen.queryByText('Add member body')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Roster' })).toHaveAttribute('aria-selected', 'true');
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
      const areas = screen.getByRole('tablist', { name: 'Members admin areas' });
      expect(within(areas).getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    });
    const pages = screen.getByRole('tablist', { name: 'Settings pages' });
    expect(within(pages).getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  });

  it('lands on an area’s first page when its card is chosen', async () => {
    const user = userEvent.setup();
    mockCheckPermission.mockReturnValue(true);
    renderAt('');

    await user.click(await screen.findByRole('tab', { name: 'Add & Import' }));

    expect(window.location.search).toBe('?tab=add');
    expect(await screen.findByText('Add member body')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Import Qualifications' }));
    expect(window.location.search).toBe('?tab=qualifications');
    expect(await screen.findByText('Qualification import body')).toBeInTheDocument();
  });

  it('keeps a panel in the document for every page tab of the area', async () => {
    mockCheckPermission.mockReturnValue(true);
    renderAt('?tab=import');

    const strip = await screen.findByRole('tablist', { name: 'Add & Import pages' });
    const panelIds = screen.getAllByRole('tabpanel', { hidden: true }).map((panel) => panel.id);
    const controlled = within(strip)
      .getAllByRole('tab')
      .map((tab) => tab.getAttribute('aria-controls'));
    expect(controlled).toHaveLength(3);
    for (const id of controlled) expect(panelIds).toContain(id);
  });

  it('badges the page and its area from the attention queue', async () => {
    mockCheckPermission.mockReturnValue(true);
    mockGetSummary.mockResolvedValue({
      moduleKey: 'members',
      generatedAt: '2026-08-23T12:00:00Z',
      timezone: 'UTC',
      metrics: [],
      attention: [
        {
          key: 'pending-imports',
          title: 'Something to do',
          detail: '',
          actionLabel: 'Review',
          href: '/members/admin?tab=import',
          severity: 'warning',
          count: 4,
          oldestAgeDays: null,
        },
      ],
    });
    renderAt('?tab=import');

    const strip = await screen.findByRole('tablist', { name: 'Add & Import pages' });
    expect(await within(strip).findByText('4')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Add & Import' })).toHaveAccessibleDescription(/4 need attention/);
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
