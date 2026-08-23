/**
 * Enabling a module from the setup wizard's module step.
 *
 * `handleModuleAction` used to enable a module only when it carried a
 * `configRoute`. A registry entry without one fell through every branch, so
 * its enable button did nothing at all — no status, no toast, no navigation —
 * and onboarding saved the module disabled while the administrator believed
 * they had turned it on. That is how the Department Store, and Medical
 * Supplies before it, could not be enabled during setup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../services/api-client', () => ({
  apiClient: {
    saveModuleConfig: vi.fn(),
    completeOnboarding: vi.fn(),
  },
}));

vi.mock('../hooks', () => ({
  useApiRequest: () => ({
    execute: vi.fn(),
    isLoading: false,
    error: null,
    canRetry: false,
    clearError: vi.fn(),
  }),
}));

import ModuleOverview from './ModuleOverview';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderPage = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <ModuleOverview />
      </MemoryRouter>
    </ThemeProvider>
  );

describe('ModuleOverview enabling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOnboardingStore.setState({
      departmentName: 'Falls Church Fire',
      moduleStatuses: {},
      selectedModules: [],
    });
  });

  // Medical Supplies carries no configRoute, so it is the module the old
  // branch dropped on the floor entirely.
  it('enables a module that has no config route, and stays on the page', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Configure Now Medical Supplies' }));

    expect(useOnboardingStore.getState().moduleStatuses.medical_supplies).toBe('enabled');
    expect(useOnboardingStore.getState().selectedModules).toContain('medical_supplies');
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/config'));
  });

  it('enables the Department Store and opens its config step', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Enable Department Store' }));

    expect(useOnboardingStore.getState().moduleStatuses.storefront).toBe('enabled');
    expect(useOnboardingStore.getState().selectedModules).toContain('storefront');
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding/modules/storefront/config');
  });

  it('leaves the negative action meaning not-enabled', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Skip Department Store' }));

    expect(useOnboardingStore.getState().moduleStatuses.storefront).toBe('ignored');
    expect(useOnboardingStore.getState().selectedModules).not.toContain('storefront');
  });
});
