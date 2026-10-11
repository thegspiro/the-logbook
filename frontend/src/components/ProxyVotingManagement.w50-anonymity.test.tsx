/**
 * W50-2 / ELEC-43: a proxy on an anonymous election needs the delegating
 * member's acknowledgement that the proxy ballot is attributable (owner
 * decision 2026-10-08). The form shows the warning and will not submit until
 * the acknowledgement is ticked; on a named election neither appears.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetProxyAuthorizations = vi.fn();
const mockAddProxyAuthorization = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    getProxyAuthorizations: (...args: unknown[]) => mockGetProxyAuthorizations(...args) as unknown,
    addProxyAuthorization: (...args: unknown[]) => mockAddProxyAuthorization(...args) as unknown,
    revokeProxyAuthorization: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ProxyVotingManagement } from './ProxyVotingManagement';

const fillForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: '+ Add Authorization' }));
  await user.type(screen.getByPlaceholderText('User ID of the absent member'), 'u-absent');
  await user.type(screen.getByPlaceholderText('User ID of the proxy voter'), 'u-proxy');
  await user.type(screen.getByPlaceholderText(/Reason for proxy authorization/), 'Deployed');
};

describe('ProxyVotingManagement — anonymous-election acknowledgement', () => {
  beforeEach(() => {
    mockGetProxyAuthorizations.mockReset();
    mockAddProxyAuthorization.mockReset();
    mockAddProxyAuthorization.mockResolvedValue({
      id: 'a1',
      delegating_user_id: 'u-absent',
      proxy_user_id: 'u-proxy',
      proxy_type: 'single_election',
      reason: 'Deployed',
      authorized_by: 'sec',
      authorized_at: '2026-10-08T12:00:00Z',
    });
  });

  it('requires the acknowledgement on an anonymous election and sends it', async () => {
    mockGetProxyAuthorizations.mockResolvedValue({
      authorizations: [],
      proxy_voting_enabled: true,
      anonymous_voting: true,
    });
    const user = userEvent.setup();
    renderWithRouter(<ProxyVotingManagement electionId="el1" canManage />);
    await fillForm(user);

    expect(screen.getByText(/a proxy ballot is not anonymous/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Add Authorization' });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /has been told this and accepts it/ }));
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(mockAddProxyAuthorization).toHaveBeenCalledWith('el1', {
      delegating_user_id: 'u-absent',
      proxy_user_id: 'u-proxy',
      proxy_type: 'single_election',
      reason: 'Deployed',
      anonymity_acknowledged: true,
    });
  });

  it('shows no warning and sends no acknowledgement on a named election', async () => {
    mockGetProxyAuthorizations.mockResolvedValue({
      authorizations: [],
      proxy_voting_enabled: true,
      anonymous_voting: false,
    });
    const user = userEvent.setup();
    renderWithRouter(<ProxyVotingManagement electionId="el1" canManage />);
    await fillForm(user);

    expect(screen.queryByText(/a proxy ballot is not anonymous/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Authorization' }));
    expect(mockAddProxyAuthorization).toHaveBeenCalledWith('el1', {
      delegating_user_id: 'u-absent',
      proxy_user_id: 'u-proxy',
      proxy_type: 'single_election',
      reason: 'Deployed',
    });
  });
});
