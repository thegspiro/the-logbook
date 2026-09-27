/**
 * A session that will not start is tried once, not in a loop.
 *
 * After an onboarding reset the browser still held credentials for the
 * account the reset deleted, so every attempt to start a session was refused.
 * The page retried whenever its loading flag cleared — which a failed attempt
 * does — and fired about 75 requests a second into the endpoint's rate limit
 * for as long as it stayed open (workflow review W01-10).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/api-client', () => ({ apiClient: { getStatus: vi.fn() } }));

const startAttempt = vi.fn();
vi.mock('../hooks/useOnboardingSession', () => ({
  // Mirrors the real hook's shape: loading goes true, then false again when
  // the attempt fails, and the attempt resolves to false rather than throwing.
  useOnboardingSession: () => {
    const [isLoading, setIsLoading] = useState(false);
    return {
      hasSession: false,
      isLoading,
      initializeSession: async () => {
        setIsLoading(true);
        await Promise.resolve(startAttempt());
        setIsLoading(false);
        return false;
      },
      saveOrganization: vi.fn(),
    };
  },
}));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) as unknown },
}));

import OrganizationSetup from './OrganizationSetup';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderPage = () =>
  render(
    <ThemeProvider>
      <OrganizationSetup />
    </ThemeProvider>
  );

describe('OrganizationSetup — starting the setup session', () => {
  beforeEach(() => {
    startAttempt.mockReset();
    toastError.mockReset();
  });

  it('tries once on arrival and says so when it fails', async () => {
    renderPage();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/could not start the setup session/i))
    );
    // Give a loop every chance to show itself.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(startAttempt).toHaveBeenCalledTimes(1);
  });

  it('tries again when the operator presses Continue', async () => {
    renderPage();
    await waitFor(() => expect(startAttempt).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /^continue/i }));

    await waitFor(() => expect(startAttempt).toHaveBeenCalledTimes(2));
  });
});
