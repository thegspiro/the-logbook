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
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../../test/utils';

const mockGetSettings = vi.fn();
vi.mock('../../../../services/userServices', () => ({
  organizationService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    updateContactInfoSettings: vi.fn(),
    updateMembershipIdSettings: vi.fn(),
  },
}));

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
    granted.current = ['members.manage', 'settings.manage', 'settings.edit'];
  });

  it('shows the section an officer holds the endpoint’s grant for', async () => {
    renderWithRouter(<MembersSettingsPage section="visibility" />);

    expect(await screen.findByText('Contact Information Visibility')).toBeInTheDocument();
  });

  // The whole reason the sections carry their own permissions. `members.manage`
  // opens the route; it does not open either endpoint.
  it('offers nothing to an officer who manages the roster but not the settings', async () => {
    granted.current = ['members.manage'];

    renderWithRouter(<MembersSettingsPage section="visibility" />);

    expect(await screen.findByText(/does not hold that grant/)).toBeInTheDocument();
    expect(screen.queryByText('Show Contact Information')).not.toBeInTheDocument();
  });

  // A grant per section, not one for the screen: an officer with settings.edit
  // alone can number members without being able to change what they see of
  // each other.
  it('falls back to a section the officer can open rather than rendering a refused one', async () => {
    granted.current = ['members.manage', 'settings.edit'];

    renderWithRouter(<MembersSettingsPage section="visibility" />);

    expect(await screen.findByText('Membership ID Number')).toBeInTheDocument();
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
