/**
 * The encryption key step: required, no skip, and the confirmation names the
 * key the administrator was shown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

const getKeyCustody = vi.fn();
const confirmKeyCustody = vi.fn();
vi.mock('../services/api-client', () => ({
  apiClient: {
    getKeyCustody: () => getKeyCustody() as unknown,
    confirmKeyCustody: (...args: unknown[]) => confirmKeyCustody(...args) as unknown,
  },
}));

// The real hook's execute is stable across renders; the page's load effect
// depends on that, so the stand-in must be stable too.
const { execute } = vi.hoisted(() => ({
  execute: async (fn: () => Promise<unknown>) => {
    try {
      return { data: await fn(), error: null };
    } catch {
      return { data: null, error: 'failed' };
    }
  },
}));
vi.mock('../hooks', () => ({
  useApiRequest: () => ({ execute, isLoading: false, error: null, canRetry: false, clearError: vi.fn() }),
}));

import KeyCustody from './KeyCustody';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { nextStepPath } from '../config/steps';

const renderPage = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <KeyCustody />
      </MemoryRouter>
    </ThemeProvider>
  );

describe('KeyCustody', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    getKeyCustody.mockReset();
    confirmKeyCustody.mockReset();
    getKeyCustody.mockResolvedValue({ data: { key_fingerprint: '0123456789abcdef', confirmed: false } });
    confirmKeyCustody.mockResolvedValue({ data: { success: true } });
    useOnboardingStore.setState({ departmentName: 'Engine Co.' });
  });

  it('cannot continue until the administrator confirms, and offers no skip', async () => {
    renderPage();

    expect(await screen.findByText('0123456789abcdef')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm and Continue' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });

  it('confirms the fingerprint it showed and moves on', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Confirm and Continue' }));

    expect(confirmKeyCustody).toHaveBeenCalledWith('0123456789abcdef');
    expect(mockNavigate).toHaveBeenCalledWith(nextStepPath('key_custody'));
  });

  it('stays put and asks again when the server refuses', async () => {
    confirmKeyCustody.mockResolvedValue({ error: 'The key has changed', statusCode: 409 });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Confirm and Continue' }));

    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
    expect(mockNavigate).not.toHaveBeenCalledWith(nextStepPath('key_custody'));
  });

  it('shows a key already confirmed as such', async () => {
    getKeyCustody.mockResolvedValue({ data: { key_fingerprint: '0123456789abcdef', confirmed: true } });
    renderPage();

    expect(await screen.findByText(/already been confirmed/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
