import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import { GoogleAccountPanel } from './GoogleAccountPanel';
import type { GoogleAccount } from '../types/googleAccount';

const mockRetry = vi.fn();
vi.mock('../services/googleAccountService', () => ({
  googleAccountService: {
    retry: (...args: unknown[]) => mockRetry(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const base: GoogleAccount = {
  user_id: 'u-1',
  primary_email: 'jordan.hale@firedept.org',
  status: 'created',
  credentials_sent: true,
  pending_groups: [],
  last_error: null,
  attempts: 1,
  last_attempt_at: '2026-10-15T12:00:00Z',
  created_at: '2026-10-15T12:00:00Z',
};

const onChange = vi.fn();
const onReload = vi.fn();

const renderPanel = (account: GoogleAccount) =>
  render(
    <ConfirmProvider>
      <GoogleAccountPanel userId="u-1" account={account} onChange={onChange} onReload={onReload} />
    </ConfirmProvider>
  );

describe('GoogleAccountPanel', () => {
  beforeEach(() => {
    mockRetry.mockReset();
    mockRetry.mockResolvedValue({ account: base });
    onChange.mockReset();
    onReload.mockReset();
    onReload.mockResolvedValue(undefined);
  });

  it('shows a finished account with nothing to retry', () => {
    renderPanel(base);
    expect(screen.getByText('jordan.hale@firedept.org')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('retries a failed account straight away and reports the result', async () => {
    const user = userEvent.setup();
    renderPanel({ ...base, status: 'failed', last_error: 'No licenses left.' });

    expect(screen.getByRole('alert')).toHaveTextContent('No licenses left.');
    await user.click(screen.getByRole('button', { name: 'Retry creating account' }));

    expect(mockRetry).toHaveBeenCalledWith('u-1');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(base));
  });

  it('asks before resetting the password of an account whose password never arrived', async () => {
    const user = userEvent.setup();
    renderPanel({ ...base, credentials_sent: false });

    await user.click(screen.getByRole('button', { name: 'Finish setup' }));
    expect(await screen.findByText('Send a new Google password?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('re-reads the account when a retry is refused', async () => {
    const user = userEvent.setup();
    mockRetry.mockRejectedValue(new Error('too soon'));
    renderPanel({ ...base, status: 'failed' });

    await user.click(screen.getByRole('button', { name: 'Retry creating account' }));

    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers no retry on an existing account it must not touch', () => {
    renderPanel({ ...base, status: 'linked_existing', last_error: 'Already exists.' });
    expect(screen.getByText('Existing account')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
