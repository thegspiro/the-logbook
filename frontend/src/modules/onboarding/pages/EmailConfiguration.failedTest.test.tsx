/**
 * Owner decision 2026-11-01 (workflow review W01-27): when the email
 * connection test fails, warn, but let the settings be saved.
 *
 * Before, a failed test showed a toast that disappeared after a few seconds,
 * and Continue then answered "Email settings saved" as if nothing had
 * happened. Saving settings for a mail server that is not reachable yet is
 * reasonable; saying nothing about it is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));
const { saveEmailConfig, testEmailConnection } = vi.hoisted(() => ({
  saveEmailConfig: vi.fn(),
  testEmailConnection: vi.fn(),
}));
vi.mock('../services/api-client', () => ({
  apiClient: {
    saveEmailConfig: (...args: unknown[]) => saveEmailConfig(...args) as unknown,
    testEmailConnection: (...args: unknown[]) => testEmailConnection(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import EmailConfiguration from './EmailConfiguration';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import { nextStepPath } from '../config/steps';

const FAILURE = 'Could not reach an SMTP server with these settings.';

const renderPage = () =>
  render(
    <ThemeProvider>
      <ConfirmProvider>
        <MemoryRouter>
          <EmailConfiguration />
        </MemoryRouter>
      </ConfirmProvider>
    </ThemeProvider>
  );

const fillSmtp = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/From Email Address/), 'noreply@example.org');
  await user.type(screen.getByLabelText(/SMTP Host/), 'mail.example.org');
};

describe('EmailConfiguration — a failed connection test', () => {
  beforeEach(() => {
    navigate.mockReset();
    saveEmailConfig.mockReset();
    saveEmailConfig.mockResolvedValue({ data: {} });
    testEmailConnection.mockReset();
    testEmailConnection.mockResolvedValue({ data: { success: false, message: FAILURE } });
    useOnboardingStore.setState({ departmentName: 'Test FD', emailPlatform: 'selfhosted' });
  });

  it('keeps the failure on the page, not only in a toast', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillSmtp(user);

    await user.click(screen.getByRole('button', { name: 'Test Email Connection' }));

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent(FAILURE);
    expect(warning).toHaveTextContent(/can still save/i);
  });

  it('clears the warning once the settings change', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillSmtp(user);
    await user.click(screen.getByRole('button', { name: 'Test Email Connection' }));
    await screen.findByRole('alert');

    await user.type(screen.getByLabelText(/SMTP Host/), 'x');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks before saving, and saves when told to', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillSmtp(user);
    await user.click(screen.getByRole('button', { name: 'Test Email Connection' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/failed their connection test/i);
    expect(saveEmailConfig).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Save anyway' }));

    await waitFor(() => expect(saveEmailConfig).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith(nextStepPath('email'));
  });

  it('stays on the page, saving nothing, when the operator goes back', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillSmtp(user);
    await user.click(screen.getByRole('button', { name: 'Test Email Connection' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Fix the settings' }));

    expect(saveEmailConfig).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalledWith(nextStepPath('email'));
  });

  it('saves without asking when the test passed', async () => {
    testEmailConnection.mockResolvedValue({ data: { success: true, message: 'Connected' } });
    const user = userEvent.setup();
    renderPage();
    await fillSmtp(user);
    await user.click(screen.getByRole('button', { name: 'Test Email Connection' }));
    await screen.findByRole('button', { name: /Connection Test Passed/ });

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(saveEmailConfig).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('treats a refused request like a failed test', async () => {
    testEmailConnection.mockResolvedValue({ error: 'Authentication failed' });
    const user = userEvent.setup();
    renderPage();
    await fillSmtp(user);

    await user.click(screen.getByRole('button', { name: 'Test Email Connection' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Authentication failed');
  });
});
