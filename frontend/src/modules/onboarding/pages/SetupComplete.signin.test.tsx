/**
 * Workflow review W01, 2026-10-31: a fresh install chose Google on the
 * Sign-In Method step with no Google client configured on the server. The
 * send-off reported "Sign-in method: Google", while the sign-in page showed the
 * password form and nobody could sign in with Google at all. The server decides
 * whether a provider is live (`/auth/oauth-config`); the summary now asks it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn() };
});

const { getSetupChecklist, axiosGet } = vi.hoisted(() => ({ getSetupChecklist: vi.fn(), axiosGet: vi.fn() }));
vi.mock('../../../services/api', () => ({
  organizationService: { getSetupChecklist: () => getSetupChecklist() as unknown },
}));
// Only `get` is replaced: modules this page imports build their own instances
// with the real `axios.create`.
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    ...actual,
    default: Object.assign(Object.create(actual.default) as typeof actual.default, {
      create: actual.default.create,
      get: (...args: unknown[]) => axiosGet(...args) as unknown,
    }),
  };
});

import SetupComplete from './SetupComplete';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderPage = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <SetupComplete />
      </MemoryRouter>
    </ThemeProvider>
  );

const oauth = (over: Record<string, boolean>) =>
  axiosGet.mockResolvedValue({
    data: { googleEnabled: false, microsoftEnabled: false, authentikEnabled: false, ...over },
  });

describe('SetupComplete — sign-in method', () => {
  beforeEach(() => {
    getSetupChecklist.mockReset();
    getSetupChecklist.mockResolvedValue({ items: [], completed_count: 0, total_count: 0, enabled_modules: [] });
    axiosGet.mockReset();
    useOnboardingStore.setState({ departmentName: 'Test FD', authPlatform: 'google' });
  });

  it('says members use passwords when the chosen provider is not set up on the server', async () => {
    oauth({});
    renderPage();

    expect(await screen.findByText('Google — passwords until the server is configured')).toBeInTheDocument();
    expect(axiosGet).toHaveBeenCalledWith('/api/v1/auth/oauth-config');
  });

  it('names the provider alone once the server can sign people in with it', async () => {
    oauth({ googleEnabled: true });
    renderPage();

    expect(await screen.findByText('Google')).toBeInTheDocument();
    expect(screen.queryByText(/passwords until/)).not.toBeInTheDocument();
  });

  it('does not ask the server when passwords were chosen', async () => {
    useOnboardingStore.setState({ authPlatform: 'local' });
    renderPage();

    expect(await screen.findByText('Username & password')).toBeInTheDocument();
    expect(axiosGet).not.toHaveBeenCalled();
  });
});
