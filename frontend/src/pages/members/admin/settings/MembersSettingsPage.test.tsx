/**
 * Members settings: who is admitted, and what happens when they are not.
 *
 * The subject is the gap between the route's grant and the endpoints'. Every
 * route under `/members/admin` stands on `members.manage`, and neither section
 * here saves through an endpoint that accepts it — contact visibility wants a
 * settings grant, membership IDs want `settings.edit`. A members officer who
 * reaches this screen on the hub's grant alone must not be shown toggles the
 * server will refuse, which is the defect that took six review rounds to settle
 * on the scheduling close-out queue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../../../test/utils';

const mockGetSettings = vi.fn();
vi.mock('../../../../services/userServices', () => ({
  organizationService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    updateContactInfoSettings: vi.fn(),
    updateMembershipIdSettings: vi.fn(),
  },
}));

const mockGetRanks = vi.fn();
const mockValidateRanks = vi.fn();
vi.mock('../../../../services/api', () => ({
  ranksService: {
    getRanks: (...args: unknown[]) => mockGetRanks(...args) as unknown,
    validateRanks: (...args: unknown[]) => mockValidateRanks(...args) as unknown,
    createRank: vi.fn(),
    updateRank: vi.fn(),
    deleteRank: vi.fn(),
    reorderRanks: vi.fn(),
  },
}));
vi.mock('../../../../hooks/useRanks', () => ({ invalidateRanksCache: vi.fn() }));

const granted = { current: [] as string[] };
vi.mock('../../../../stores/authStore', () => {
  const state = () => ({
    user: { id: 'user-1' },
    checkPermission: (permission: string) => granted.current.includes(permission),
  });
  return {
    useAuthStore: Object.assign(
      (selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state()),
      { getState: state }
    ),
  };
});

import MembersSettingsPage from './MembersSettingsPage';

describe('MembersSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({
      contact_info_visibility: { enabled: true, show_email: true, show_phone: false, show_mobile: false },
      membership_id: { enabled: true, auto_generate: true, prefix: 'FD-', next_number: 7 },
    });
    mockGetRanks.mockResolvedValue([]);
    mockValidateRanks.mockResolvedValue({ issues: [], total: 0 });
    granted.current = ['members.manage', 'settings.manage', 'settings.edit'];
    // BrowserRouter drives the real history, and a redirect assertion below
    // reads it — so each test starts from a known address rather than wherever
    // the previous one navigated to.
    window.history.replaceState({}, '', '/members/admin/settings');
  });

  it('shows the section an officer holds the endpoint’s grant for', async () => {
    renderWithRouter(<MembersSettingsPage section="visibility" />);

    expect(await screen.findByText('Contact Information Visibility')).toBeInTheDocument();
  });

  // The whole reason the sections carry their own permissions. `members.manage`
  // opens the route; of the four sections it opens exactly one — the rank
  // ladder, whose endpoints were widened to accept it when the ladder moved
  // here. Contact visibility and membership IDs still want a settings grant,
  // and EVOC wants the apparatus one.
  it('sends a roster officer to the one section their grant opens', async () => {
    granted.current = ['members.manage'];

    renderWithRouter(<MembersSettingsPage section="visibility" />);

    // Redirected, not rendered in place: the address has to name what is shown,
    // or the breadcrumb and the URL describe a section the officer is not
    // looking at.
    await waitFor(() => expect(window.location.pathname).toBe('/members/admin/settings/ranks'));
    expect(screen.queryByText('Contact Information Visibility')).not.toBeInTheDocument();
    expect(screen.queryByText(/does not hold that grant/)).not.toBeInTheDocument();
  });

  // EVOC is the one section gated on another module entirely: the levels are
  // served by the apparatus API, and widening that was deliberately not part of
  // moving the page.
  it('withholds EVOC from an officer without the apparatus grant', async () => {
    granted.current = ['members.manage'];

    renderWithRouter(<MembersSettingsPage section="evoc" />);

    // The hub links every section unconditionally, so this is the click a
    // roster officer actually makes. Landing on Ranks while the URL still said
    // evoc was the defect.
    await waitFor(() => expect(window.location.pathname).toBe('/members/admin/settings/ranks'));
    expect(screen.queryByText('Driver certification ladder and certifying programs.')).not.toBeInTheDocument();
  });

  it('offers nothing at all to an account holding none of the four grants', async () => {
    granted.current = [];

    renderWithRouter(<MembersSettingsPage section="visibility" />);

    expect(await screen.findByText(/does not hold that grant/)).toBeInTheDocument();
    expect(screen.queryByText('Show Contact Information')).not.toBeInTheDocument();
  });

  // The routes admit the settings grants as well as the hub's, so an officer
  // holding settings.manage and not members.manage reaches this screen
  // legitimately — from the relocation link on /settings, or a legacy ?tab=
  // redirect. /members/admin refuses them, so a back control pointing there
  // answered Access Denied from the page's own chrome.
  it('sends an officer without the hub grant back to organization settings', async () => {
    granted.current = ['settings.manage'];

    renderWithRouter(<MembersSettingsPage section="visibility" />);

    expect(await screen.findByRole('button', { name: /back to organization settings/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back to members administration/i })).not.toBeInTheDocument();
  });

  it('keeps the members administration destination for an officer who holds it', async () => {
    granted.current = ['members.manage', 'settings.manage'];

    renderWithRouter(<MembersSettingsPage section="visibility" />);

    expect(await screen.findByRole('button', { name: /back to members administration/i })).toBeInTheDocument();
  });

  // A grant per section, not one for the screen: an officer with settings.edit
  // alone can number members without being able to change what they see of
  // each other.
  it('falls back to a section the officer can open rather than rendering a refused one', async () => {
    granted.current = ['members.manage', 'settings.edit'];

    renderWithRouter(<MembersSettingsPage section="visibility" />);

    await waitFor(() => expect(window.location.pathname).toBe('/members/admin/settings/ids'));
    expect(screen.queryByText('Contact Information Visibility')).not.toBeInTheDocument();
  });

  it('says the settings did not load rather than showing defaults as the answer', async () => {
    mockGetSettings.mockRejectedValue(new Error('nope'));

    renderWithRouter(<MembersSettingsPage section="visibility" />);

    // Every toggle is false before the load lands, which reads as a department
    // that has turned contact information off — the fifth instance of an absent
    // answer presented as a confident one across this work.
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not load/);
  });
});
