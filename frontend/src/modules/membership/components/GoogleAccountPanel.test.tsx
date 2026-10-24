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
  provider: 'google',
  provider_name: 'Google Workspace',
  primary_email: 'jordan.hale@firedept.org',
  status: 'created',
  credentials_sent: true,
  pending_groups: [],
  license_pending: false,
  managed_on_premises: false,
  last_error: null,
  attempts: 1,
  last_attempt_at: '2026-10-15T12:00:00Z',
  created_at: '2026-10-15T12:00:00Z',
  suspension_wanted: false,
  suspension_settled: true,
  suspended_by_logbook: false,
  suspended_at: null,
  suspension_error: null,
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

  it('shows an account suspended when the member left, with nothing to retry', () => {
    renderPanel({ ...base, suspension_wanted: true, suspended_by_logbook: true, suspended_at: '2026-10-15T13:00:00Z' });
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    expect(screen.getByTestId('google-suspension')).toHaveTextContent(/lifted automatically if they return/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says a suspension it did not apply will not be lifted', () => {
    renderPanel({ ...base, status: 'linked_existing', suspension_wanted: true, suspended_by_logbook: false });
    expect(screen.getByTestId('google-suspension')).toHaveTextContent(/will not lift it/);
  });

  it('retries a suspension that failed, without asking about passwords', async () => {
    const user = userEvent.setup();
    renderPanel({
      ...base,
      credentials_sent: false,
      suspension_wanted: true,
      suspension_settled: false,
      suspension_error: 'Google is busy.',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Google is busy.');
    await user.click(screen.getByRole('button', { name: 'Retry suspending' }));

    expect(screen.queryByText('Send a new Google password?')).not.toBeInTheDocument();
    expect(mockRetry).toHaveBeenCalledWith('u-1');
  });

  it('offers to retry lifting a suspension after a return', () => {
    renderPanel({ ...base, suspension_wanted: false, suspension_settled: false, suspended_by_logbook: true });
    expect(screen.getByTestId('google-suspension')).toHaveTextContent(/still suspended/);
    expect(screen.getByRole('button', { name: 'Retry unsuspending' })).toBeInTheDocument();
  });

  it('offers no retry on an existing account it must not touch', () => {
    renderPanel({ ...base, status: 'linked_existing', last_error: 'Already exists.' });
    expect(screen.getByText('Existing account')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('GoogleAccountPanel with a Microsoft 365 account', () => {
  const microsoft: GoogleAccount = { ...base, provider: 'microsoft', provider_name: 'Microsoft 365' };

  beforeEach(() => {
    mockRetry.mockReset();
    mockRetry.mockResolvedValue({ account: microsoft });
    onChange.mockReset();
    onReload.mockReset();
    onReload.mockResolvedValue(undefined);
  });

  it('is headed with the directory it belongs to', () => {
    renderPanel(microsoft);
    expect(screen.getByRole('heading', { name: 'Microsoft 365' })).toBeInTheDocument();
    expect(screen.queryByText(/Google/)).not.toBeInTheDocument();
  });

  it('offers to finish setup while the license is outstanding', async () => {
    const user = userEvent.setup();
    renderPanel({ ...microsoft, license_pending: true });
    expect(screen.getByText(/Not licensed yet, so the account has no mailbox/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith('u-1'));
    expect(onChange).toHaveBeenCalledWith(microsoft);
  });

  it('says an on-premises account is disabled in Active Directory', () => {
    renderPanel({ ...microsoft, managed_on_premises: true });
    expect(screen.getByTestId('directory-on-premises')).toHaveTextContent(/disable it in Active Directory/);
  });

  it('names Microsoft when asking to send a new password', async () => {
    const user = userEvent.setup();
    renderPanel({ ...microsoft, credentials_sent: false });

    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(await screen.findByText('Send a new Microsoft password?')).toBeInTheDocument();
  });
});
